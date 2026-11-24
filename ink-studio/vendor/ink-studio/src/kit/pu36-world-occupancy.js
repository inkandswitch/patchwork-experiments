/* Shared broad-phase snapshots for proximity, clearance and interaction queries. */
(function(K){
  const W=K.world, {check,id,record,vector,own}=W.data, P=K.procedural;
  const providers=new WeakMap();
  const lexical=(a,b)=>a<b?-1:a>b?1:0;
  const byHandle=(a,b)=>lexical(a.kind,b.kind)||lexical(a.system,b.system)||lexical(a.id,b.id);
  const byDistance=(a,b)=>a.distance-b.distance||byHandle(a,b);
  const radiusOK=n=>Number.isFinite(n)&&n>=0&&n<=1e9;
  const rowID=value=>id(value)||typeof value==='string'&&value.split('/').length===2&&value.split('/').every(id);
  const matches=(row,ref)=>typeof ref==='string'?(ref===row.entity||ref===row.id):
    ref.kind===row.kind&&ref.system===row.system&&ref.id===row.id&&
    (ref.generation===undefined||ref.generation===row.generation);
  const validRef=ref=>typeof ref==='string'?rowID(ref):record(ref)&&id(ref.kind)&&id(ref.system)&&rowID(ref.id)&&
    (ref.generation===undefined||Number.isSafeInteger(ref.generation)&&ref.generation>0);

  function index(rows,kind,system){
    const cells=kind==='agent'?W.spatial.grid():null, tree=cells?null:W.spatial.create();
    const entries=new Map(), overflow=[], extent=[0,0,0];
    for(const item of rows){
      const {min,max,shape,...record}=item, row={...record,kind,system};
      const entry={row,shape};
      entries.set(row.id,entry);
      if(min===null||max===null){
        overflow.push(entry);
        continue;
      }
      const p=row.position;
      if(cells){
        for(let axis=0;axis<3;axis++)extent[axis]=Math.max(extent[axis],
          p[axis]-(min?.[axis]??p[axis]),(max?.[axis]??p[axis])-p[axis]);
        cells.add(p,entry);
      }else tree.set(row.id,{min:p.map((n,i)=>Math.min(n,min?.[i]??n)),
        max:p.map((n,i)=>Math.max(n,max?.[i]??n)),value:entry,rank:entries.size});
    }
    return {entries,visit(point,radius,visit,solids=false){
      const padding=Math.max(1,radius,Math.abs(point[0]),Math.abs(point[1]),Math.abs(point[2]))*1e-12;
      const min=point.map((n,i)=>n-radius-padding-(solids?extent[i]:0));
      const max=point.map((n,i)=>n+radius+padding+(solids?extent[i]:0));
      if(cells)cells.overlap(min,max,visit);
      else tree.overlap(min,max,({value})=>visit(value),entries.size<32);
      for(const entry of overflow)visit(entry);
    }};
  }

  function create({entities,states,systems,frame,target,probe,condition}){
    const active=Object.entries(systems).filter(([,system])=>system.occupancy);
    const indexes=new Map();
    function* authored(kind){
      for(const [entity,spec] of Object.entries(entities)){
        const sockets=kind==='socket'?Object.keys(spec.sockets??{}):[null];
        for(const socket of sockets){
          const pose=frame({entity,socket});
          if(!pose||!vector(pose.point))continue;
          yield {id:socket?entity+'/'+socket:entity,entity,...(socket&&{socket}),position:pose.point,
            ...(spec.kind!==undefined&&{entityKind:spec.kind}),...(spec.tags&&{tags:spec.tags})};
        }
      }
    }
    function section(kind,system,provider){
      const label=kind+'/'+system;
      if(indexes.has(label))return indexes.get(label);
      let found;
      if(provider){
        const state=states[system], key=state&&(provider.key?provider.key(state):state);
        if(state===undefined||state===null)return null;
        const shared=P.data.isImmutable(key);
        if(shared&&!providers.has(provider))providers.set(provider,new WeakMap());
        const cache=shared&&providers.get(provider);
        found=cache&&cache.get(key);
        if(!found){
          found=index(provider.rows(state),kind,system);
          if(cache)cache.set(key,found);
        }
      }else found=index(authored(kind),kind,'world');
      indexes.set(label,found);
      return found;
    }
    function* sections(kinds,selected){
      for(const [system,schema] of active){
        const provider=schema.occupancy;
        if(kinds.includes(provider.kind)&&(!selected||selected.includes(system))){
          const rows=section(provider.kind,system,provider);
          if(rows)yield {rows,distance:provider.distance};
        }
      }
      if(!selected||selected.includes('world'))
        for(const kind of kinds)if(kind==='entity'||kind==='socket')yield {rows:section(kind,'world')};
    }
    function pointAt(site){
      if(!record(site)||!own(site,'agent'))return target(site)?.point;
      const ref=site.agent;
      check(record(ref)&&validRef({...ref,kind:'agent'}),'Invalid spatial agent handle');
      const provider=own(systems,ref.system)&&systems[ref.system].occupancy;
      const row=provider?.kind==='agent'?section('agent',ref.system,provider)?.entries.get(ref.id)?.row:null;
      return row&&(ref.generation===undefined||row.generation===ref.generation)?row.position:null;
    }
    const gather=(point,radius,kinds,options)=>{
      const hits=[];
      for(const {rows} of sections(kinds,options.systems))rows.visit(point,radius,({row})=>{
        const distance=K.V.dist(point,row.position);
        if(distance<=radius&&!options.exclude.some(ref=>matches(row,ref))&&condition(options.where,row))
          hits.push({...row,distance});
      });
      return hits.sort(byDistance);
    };
    function occupancy(point,radius,options,owner){
      const hits=[], unavailable=[];
      for(const {rows,distance} of sections(options.solids,options.systems)){
        if(!distance)continue;
        rows.visit(point,radius,({row,shape})=>{
          if((owner!==undefined&&row.entity===owner)||options.exclude.some(ref=>matches(row,ref)))return;
          const d=distance(shape,point);
          if(Number.isFinite(d)){
            if(d<=radius)hits.push({...row,distance:d});
          }else unavailable.push({kind:row.kind,system:row.system,id:row.id,status:'unavailable'});
        },true);
      }
      for(const source of options.clearance){
        const sample=probe(source.field,point,source.args);
        if(sample.status==='ok'&&(Number.isFinite(sample.value)||sample.value===Infinity)){
          if(sample.value<=radius)hits.push({kind:'field',system:'world',id:source.field,field:source.field,
            distance:sample.value});
        }else if(sample.status!=='empty'){
          unavailable.push({field:source.field,status:sample.status==='ok'?'invalid-value':sample.status});
        }
      }
      return {state:hits.length?'occupied':unavailable.length?'unknown':'free',matched:hits.length,
        blockers:hits.sort(byDistance).slice(0,options.limit),unavailable};
    }
    function interactions(point,radius,options){
      const hits=[], rejected={occupied:0,unknown:0,conditions:0};
      for(const row of gather(point,radius,['socket'],{...options,systems:undefined})){
        if(options.clearance.length||options.fitRadius!==undefined){
          const fit=occupancy(row.position,options.fitRadius??0,options,options.ignoreOwner?row.entity:undefined);
          if(fit.state!=='free'){rejected[fit.state]++;continue;}
        }
        const at={entity:row.entity,socket:row.socket};
        const eligible=options.require.every(({field,args,when})=>{
          const sample=probe(field,at,args);
          return sample.status==='ok'&&condition(when,sample.value);
        });
        if(eligible)hits.push(row);
        else rejected.conditions++;
      }
      return {matched:hits.length,hits:hits.slice(0,options.limit),rejected};
    }
    const kinds=['entity','agent','body','socket'];
    const solids=[...new Set(['agent','body',...active.map(([,system])=>system.occupancy.kind)])];
    const names=[...new Set([...kinds,...solids])];
    const fields=Object.entries(systems).flatMap(([system,provider])=>provider.occupancyField?
      [{system,field:system+'/'+provider.occupancyField}]:[]);
    const list=(value,max,test)=>Array.isArray(value)&&value.length<=max&&value.every(test);
    const sourceOK=source=>record(source)&&typeof source.field==='string'&&source.field.length>0&&
      (source.args===undefined||record(source.args));
    const commonKeys=['op','at','radius','id','limit','systems','exclude','kinds'];
    const extraKeys={nearby:['where'],occupancy:['clearance'],interactions:['where','clearance','fitRadius','ignoreOwner','require']};
    function read(spec){
      check(record(spec)&&list(spec.queries,2048,record)&&
        (spec.clearance===undefined||list(spec.clearance,32,sourceOK)),'Spatial batch needs up to 2048 queries and valid clearance fields');
      const queries=spec.queries.map(request=>{
        const {op,at,radius,id:name,limit=32,where,systems:selectedSystems,exclude=[],fitRadius,ignoreOwner=true,require=[]}=request;
        const automatic=op==='occupancy'||fitRadius!==undefined?fields.filter(({system})=>
          !Array.isArray(selectedSystems)||selectedSystems.includes(system)):[];
        const clearance=request.clearance??spec.clearance??automatic;
        const selected=request.kinds??(op==='nearby'?['agent']:solids);
        check(own(extraKeys,op)&&Object.keys(request).every(key=>commonKeys.includes(key)||extraKeys[op].includes(key))&&
          (name===undefined||id(name))&&at!==undefined&&
          radiusOK(radius)&&Number.isSafeInteger(limit)&&limit>=0&&limit<=256&&
          list(selected,32,kind=>(op==='nearby'?names:solids).includes(kind))&&new Set(selected).size===selected.length&&
          (selectedSystems===undefined||list(selectedSystems,256,name=>name==='world'||own(systems,name)))&&
          list(exclude,256,validRef)&&(request.clearance===undefined||list(request.clearance,32,sourceOK))&&list(require,32,sourceOK)&&
          (fitRadius===undefined||radiusOK(fitRadius))&&typeof ignoreOwner==='boolean','Invalid spatial batch query');
        condition(where,{});
        for(const rule of require)condition(rule.when,{});
        return {op,at,radius,id:name,options:{limit,where,systems:selectedSystems,exclude,fitRadius,ignoreOwner,require,clearance,
          kinds:selected,solids:selected}};
      });
      return queries.map(({op,at,radius,id,options})=>{
        const point=pointAt(at), base={op,...(id!==undefined&&{id})};
        if(!point)return {...base,status:'missing',reason:'unknown spatial origin'};
        if(op==='occupancy')return {...base,status:'ok',point,...occupancy(point,radius,options)};
        if(op==='interactions')return {...base,status:'ok',point,...interactions(point,radius,options)};
        const hits=gather(point,radius,options.kinds,options);
        return {...base,status:'ok',point,matched:hits.length,hits:hits.slice(0,options.limit)};
      });
    }
    read.anyAgent=(point,radius,test)=>{
      for(const {rows} of sections(['agent'])){
        let found=false;
        rows.visit(point,radius,({row})=>{
          if(!found&&K.V.dist(point,row.position)<=radius&&test(row))found=true;
        });
        if(found)return true;
      }
      return false;
    };
    return read;
  }
  W.occupancy=Object.freeze({create});
})(KIT);
