/* Retained selections, saved membership, and batch edits with application-owned transforms. */
(function (K) {
  const A=K.authoring, T=(K.procedural || A).transforms, {V,M}=K, {clone,freeze,derivedId}=A.data;
  const xyz=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  const frame=p=>p&&xyz(p.t)&&Array.isArray(p.R)&&p.R.length===9&&p.R.every(Number.isFinite)&&M.det(p.R)!==0;
  const snapshot=source=>typeof source.snapshot==='function'?source.snapshot():source;
  const batch=(doc,label,run)=>doc.pending()?run():doc.transact(label,run);
  const owns=(map,id)=>Object.hasOwn(map,id);
  const bookmarkKey=id=>typeof id==='string'&&id.length>0&&id.length<=80&&!['__proto__','prototype','constructor'].includes(id);

  function select(source, ids) {
    const view=snapshot(source), entities=view.entities;
    if(!Array.isArray(ids)||ids.length>1024||ids.some(id=>typeof id!=='string'||!owns(entities,id)))
      throw Error('Groups need existing entity IDs');
    const members=[...new Set(ids)], chosen=new Set(members), dependents=new Map();
    for(const e of Object.values(entities)) {
      const owners=new Set([e.parent,e.anchor?.host,e.derived?.owner]);
      for(const id of owners)if(id) {
        if(!dependents.has(id))dependents.set(id,[]);
        dependents.get(id).push(e.id);
      }
    }
    const roots=members.filter(id=>{
      const visited=new Set([id]);
      let e=entities[id];
      while(e.anchor||e.parent) {
        const owner=e.anchor?.host||e.parent;
        if(chosen.has(owner))return false;
        if(visited.has(owner))throw Error('Cyclic group transform ancestry');
        visited.add(owner);
        e=entities[owner];
      }
      return true;
    });
    const closure=members.slice(), seen=new Set(closure);
    for(let i=0;i<closure.length;i++)for(const id of dependents.get(closure[i])||[]) {
      const owner=entities[id].derived?.owner;
      if(seen.has(id)||owner&&!seen.has(owner))continue;
      seen.add(id);
      closure.push(id);
    }
    return freeze({members,roots,closure});
  }

  function capture(source, ids, { frame: resolve, pivot } = {}) {
    const view=A.data.documentView(snapshot(source)), graph=select(view,ids);
    if(!graph.roots.length)throw Error('Select something to transform');
    const read=resolve||(entity=>A.worldFrame?A.worldFrame(source,entity.id):A.transforms.world(source,entity.id));
    const entries=graph.roots.map(id=>{
      const entity=view.entities[id], pose=read(entity,view);
      if(!frame(pose))throw Error('Group roots need finite, invertible frames');
      return {id,pose:clone(pose)};
    });
    const center=pivot??V.mul(entries.reduce((sum,e)=>V.add(sum,e.pose.t),[0,0,0]),1/entries.length);
    if(!xyz(center))throw Error('Group pivot must be an XYZ point');
    return freeze({view, graph, entries, pivot:center.slice()});
  }

  function delta(plan, {translate=[0,0,0],yaw=0,pivot=plan.pivot} = {}) {
    if(!xyz(translate)||!xyz(pivot)||!Number.isFinite(yaw))throw Error('Group transform needs finite translation, yaw and pivot');
    const R=M.rot([0,1,0],yaw),t=V.add(translate,V.sub(pivot,M.app(R,pivot)));
    return {R,t};
  }

  // Transform a free root using the existing Euler and scale encoding.
  function uprightPatch(entity, pose, change) {
    if(entity.parent||entity.anchor)throw Error('A selected attachment needs a group transform adapter');
    const original=entity.parameters.transform||{}, raw=original.rotation??0;
    if(!Array.isArray(raw))return {parameters:{transform:{position:pose.t,rotation:raw+change.yaw}}};
    const scale=original.scale??1, s=Array.isArray(scale)?scale:[scale,scale,scale], r=pose.R.map((v,i)=>v/s[i%3]);
    const run=Math.hypot(r[0],r[3]), pitch=Math.atan2(-r[6],run);
    const rotation=run>1e-8?[Math.atan2(r[7],r[8]),pitch,Math.atan2(r[3],r[0])]:[Math.atan2(-r[5],r[4]),pitch,0];
    return {parameters:{transform:{position:pose.t,rotation}}};
  }

  function patches(plan, change, write) {
    if(!plan?.graph||!plan?.view||typeof write!=='function')throw Error('Group edit needs a captured selection and transform adapter');
    const motion=delta(plan,change), options={...change,yaw:change?.yaw??0,translate:change?.translate??[0,0,0],pivot:change?.pivot??plan.pivot};
    return new Map(plan.entries.map(({id,pose})=>{
      const patch=write(plan.view.entities[id],T.combine(motion,pose),options,plan.view);
      if(!patch||Array.isArray(patch)||typeof patch!=='object')throw Error('Group transform adapters must return an entity patch');
      return [id,clone(patch)];
    }));
  }

  function apply(doc, plan, change, {write=uprightPatch,label='Transform group'} = {}) {
    const edits=patches(plan,change,write);
    for(const id of edits.keys())if(!doc.get(id))throw Error('Missing group root: '+id);
    return batch(doc,label,()=>{
      for(const [id,patch] of edits)doc.update(id,patch);
      return plan.graph.roots;
    });
  }

  function copy(doc, ids, {plan,change,write=uprightPatch,remap,label='Duplicate group'} = {}) {
    const source=doc.snapshot(), graph=select(source,ids), entities=source.entities, selected=new Set(graph.closure);
    if(remap!==undefined&&typeof remap!=='function')throw Error('Group reference adapter must be a function');
    if(graph.closure.some(id=>entities[id].derived&&!selected.has(entities[id].derived.owner)))
      throw Error('Include the owner to duplicate generated details');
    if(!graph.members.length)return freeze({ids:{},members:[]});
    const fixed=change ? plan||capture(source,ids) : null;
    const edits=fixed ? patches(fixed,change,write) : new Map();
    if(fixed && (edits.size!==graph.roots.length||graph.roots.some(id=>!edits.has(id))))
      throw Error('Copy transform must capture the same selected roots');
    // Clone dependencies in source order whenever possible to preserve paint ordering.
    const records=Object.values(entities).filter(e=>selected.has(e.id));
    return batch(doc,label,()=>{
      const names=new Map();
      for(const e of records)if(!e.derived)names.set(e.id,doc.create(e.type,{seed:e.seed}));
      function mapped(id) {
        if(!id||!selected.has(id))return id;
        if(names.has(id))return names.get(id);
        const {owner,rule,key}=entities[id].derived, next=derivedId(mapped(owner),rule,key);
        names.set(id,next);
        return next;
      }
      records.forEach(e=>mapped(e.id));
      const move=fixed?delta(fixed,change):null, derived=new Map();
      function links(e) {
        if(e.parent)e.parent=mapped(e.parent);
        if(!e.anchor)return;
        const host=e.anchor.host;
        e.anchor.host=mapped(host);
        if(!move||host===e.anchor.host||!e.anchor.fallback)return;
        const f=e.anchor.fallback;
        f.p=T.point(move,f.p);
        for(const key of ['n','tangent','bitangent'])f[key]=M.app(move.R,f[key]);
      }
      for(const e of records) {
        let fields=clone(e);
        for(const key of ['id','type','derived'])delete fields[key];
        links(fields);
        links(fields.overrides);
        if(edits.has(e.id))fields=A.data.merge(fields,edits.get(e.id));
        if(remap)fields=remap(fields,mapped,e,source);
        if(!fields||typeof fields!=='object'||Array.isArray(fields))throw Error('Group reference adapter must return entity fields');
        if(!e.derived) {
          delete fields.seed;
          doc.update(mapped(e.id),fields);
          continue;
        }
        const owner=mapped(e.derived.owner), rule=e.derived.rule, group=JSON.stringify([owner,rule]);
        if(!derived.has(group))derived.set(group,{owner,rule,specs:[]});
        derived.get(group).specs.push({...fields,key:e.derived.key,type:e.type});
      }
      while(derived.size) {
        const size=derived.size;
        for(const [key,{owner,rule,specs}] of derived)if(doc.get(owner)) {
          doc.derive(owner,rule,specs);
          derived.delete(key);
        }
        if(derived.size===size)throw Error('Could not resolve copied generated owners');
      }
      return freeze({ids:Object.fromEntries(names),members:graph.members.map(mapped)});
    });
  }

  function remove(doc, ids, {label='Remove group'} = {}) {
    const {members}=select(doc,ids);
    return batch(doc,label,()=>{
      const removed=new Set();
      for(const id of members)if(doc.get(id))for(const key of doc.remove(id))removed.add(key);
      return freeze([...removed]);
    });
  }

  function bookmarks(source) {
    const s=snapshot(source), entries=s.environment.presentation?.groups;
    if(!Array.isArray(entries))return [];
    return freeze(entries.filter(e=>e&&bookmarkKey(e.id)&&typeof e.name==='string'&&Array.isArray(e.members))
      .map(e=>{
        const members=[...new Set(e.members.filter(id=>typeof id==='string'))];
        return {id:e.id,name:e.name,members,active:members.filter(id=>owns(s.entities,id))};
      }));
  }
  function store(doc, entries, label) {
    return batch(doc,label,()=>doc.setEnvironment({presentation:{groups:entries.map(({id,name,members})=>({id,name,members}))}}));
  }
  function remember(doc, ids, {id,name=id} = {}) {
    const {members}=select(doc,ids), current=bookmarks(doc);
    if(!bookmarkKey(id)||typeof name!=='string'||!name.trim()||name.length>120||!members.length)
      throw Error('A group bookmark needs an ID, name and selection');
    if(current.length>=128&&!current.some(e=>e.id===id))throw Error('This document already contains 128 group bookmarks');
    store(doc,[...current.filter(e=>e.id!==id),{id,name:name.trim(),members}],'Bookmark group');
    return id;
  }
  function forget(doc,id) {
    const current=bookmarks(doc), next=current.filter(e=>e.id!==id);
    if(next.length===current.length)return false;
    store(doc,next,'Remove group bookmark');
    return true;
  }

  A.groups=Object.freeze({select,capture,delta,apply,copy,remove,bookmarks,remember,forget});
})(KIT);
