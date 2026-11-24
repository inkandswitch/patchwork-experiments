/* Shared world queries for library callers, simulations and headless tools. */
(function (K) {
  const W = K.world, freeze = K.procedural.data.freeze;
  const {check,own,record,vector,copy,read,selector,equal,portOf} = W.data;
  const ok = value => ({status:'ok',value});
  const missing = (reason, status = 'unavailable') => ({status,reason});
  const sorted = object => Object.keys(object).sort();
  const origin = Object.freeze([0,0,0]);
  function condition(rule, value) {
    if (rule === undefined) return true;
    check(record(rule), 'Expected a condition');
    if (own(rule,'all') || own(rule,'any')) {
      const list = rule.all ?? rule.any;
      check(Array.isArray(list) && list.length <= 128, 'Invalid logical condition');
      const results = list.map(part => condition(part,value));
      return own(rule,'all') ? results.every(Boolean) : results.some(Boolean);
    }
    if (own(rule,'not')) return !condition(rule.not,value);
    check(Object.keys(rule).every(key => ['path','op','value'].includes(key)), 'Unknown condition property');
    const actual = rule.path === undefined ? value : read(value,selector(rule.path));
    const expected = rule.value, numeric = Number.isFinite(actual) && Number.isFinite(expected);
    switch (rule.op ?? 'eq') {
      case 'eq': return equal(actual,expected);
      case 'ne': return !equal(actual,expected);
      case 'exists': return actual !== undefined;
      case 'lt': return numeric && actual < expected;
      case 'lte': return numeric && actual <= expected;
      case 'gt': return numeric && actual > expected;
      case 'gte': return numeric && actual >= expected;
      case 'in': return Array.isArray(expected) && expected.some(item => equal(actual,item));
      default: throw Error('Unknown condition operator ' + rule.op);
    }
  }
  const parentOf = entity => entity?.anchor?.entity ?? entity?.parent;
  function projection(systems) {
    const poses=Object.entries(systems).filter(([,system])=>system.pose);
    if(poses.some(([,system])=>typeof system.poseEntities!=='function'))return null;
    const children=new Map();
    let tree, current, revision, bounds;
    function attach(parent,id) {
      if(!parent)return;
      const key=String(parent);
      if(!children.has(key))children.set(key,new Set());
      children.get(key).add(id);
    }
    function detach(parent,id) {
      if(!parent)return;
      const key=String(parent), attached=children.get(key);
      if(!attached)return;
      attached.delete(id);
      if(!attached.size)children.delete(key);
    }
    function update(entities,states,location) {
      const before=current;
      if(before?.entities===entities&&poses.every(([id])=>before.states[id]===states[id]))return false;
      // A failed or historical read can safely rebind the index to its own snapshot.
      current=undefined;
      const edits=revision&&revision.before===before?.entities&&revision.after===entities?revision.ids:null;
      const rebuild=!before||before.entities!==entities&&!edits;
      if(!rebuild){
        const dirty=new Set(edits);
        for(const id of dirty){
          detach(parentOf(own(before.entities,id)?before.entities[id]:null),id);
          attach(parentOf(own(entities,id)?entities[id]:null),id);
        }
        for(const [id,system] of poses){
          if(before.states[id]===states[id])continue;
          for(const state of [before.states[id],states[id]])
            for(const entity of system.poseEntities(state))
              if(typeof entity==='string'||typeof entity==='number')dirty.add(String(entity));
        }
        // Iteration includes new members, so parent changes reach nested attachments.
        for(const id of dirty){
          for(const child of children.get(id)??[])dirty.add(child);
          set(entities,id,location);
        }
      }else{
        tree=W.spatial.create();
        bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
        children.clear();
        for(const id of Object.keys(entities)){
          attach(parentOf(entities[id]),id);
          set(entities,id,location);
        }
      }
      current={entities,states};
      if(revision?.after===entities)revision=undefined;
      return rebuild;
    }
    function set(entities,id,location) {
      const row=own(entities,id)&&entities[id];
      const p=row&&(!poses.length&&!parentOf(row)?row.position??origin:location(id)?.point);
      if(!p||!vector(p)){tree.remove(id);return;}
      for(let axis=0;axis<3;axis++){
        bounds.min[axis]=Math.min(bounds.min[axis],p[axis]);
        bounds.max[axis]=Math.max(bounds.max[axis],p[axis]);
      }
      tree.set(id,{min:p,max:p,value:freeze({...row,id,position:p}),rank:0});
    }
    function change(before,after,ids) {
      if(current?.entities===before&&before!==after)revision={before,after,ids};
    }
    function spatial(entities,states,location,point,radius,where) {
      const cold=update(entities,states,location);
      const result=[];
      const min=point.map(n=>n-radius-Math.max(Math.abs(n),radius)*Number.EPSILON);
      const max=point.map(n=>n+radius+Math.max(Math.abs(n),radius)*Number.EPSILON);
      const sceneWide=min.every((n,axis)=>n<=bounds.min[axis]&&max[axis]>=bounds.max[axis]);
      tree.overlap(min,max,({value})=>{
        if(K.V.dist(point,value.position)<=radius&&condition(where,value))result.push(value);
      },cold||sceneWide);
      return result.sort((a,b)=>a.id.localeCompare(b.id));
    }
    return Object.freeze({change,spatial});
  }

  const lookFields = ['output', 'provenance', 'sample'].map(key => ({name:'look/'+key,type:'record',selector:true}));
  function create(view, systems = {}, projected, visual, sceneInputs) {
    const {world, states:visible = {}, signals = {}, tick = 0, history = [], dropped = 0} = view;
    const states=view[W.simulationAggregate.rawStates]??visible;
    const fields = new Map(), traces = new Map();
    const base = {world, states:visible, signals, tick, time:view.time ?? tick * world.dt};
    const locations = new Map(), active = new Set();
    let spatialIndex, spatialBatchRead, aliases, appearance, picker, renderScene;
    const navigationSources=new Map();
    const scene = () => renderScene ??= (visual ? visual() : W.visual({makeBuilder,makeSculpt},view,api));
    const transfers = () => W.transfers.bind(systems);
    const look = () => appearance ??= W.lookQuery(scene,base.time);
    const physical = () => W.materials.catalog(world);
    const overlay = view[W.entityLifecycle?.projection];
    let dataInputs = sceneInputs?.dataInputs;

    function location(id) {
      if (locations.has(id)) return locations.get(id);
      const entity = own(world.entities,id) && world.entities[id];
      let point = null, socketTurn = null, material, deformation;
      if(!own(overlay?.entities,id))for (const system of Object.keys(systems)) {
        const pose = systems[system].pose?.(states[system],id);
        if (pose === false) { locations.set(id,null); return null; }
        if (pose) {
          point = pose.position ?? pose;
          socketTurn = pose.rotation ?? null;
          if(pose.bend)deformation={bend:pose.bend,half:pose.half};
          if (pose.materialAsset!==undefined) material={materialAsset:pose.materialAsset,materialWetness:pose.materialWetness};
          break;
        }
      }
      if (!point && entity) {
        point = entity.position ?? [0,0,0];
        socketTurn = own(overlay?.rotations,id) ? overlay.rotations[id] : null;
        const parent = parentOf(entity);
        if (parent) {
          const host = location(parent);
          const origin = host&&socket(host,entity.anchor?.socket);
          if (!origin) { locations.set(id,null); return null; }
          const offset=host.bend&&!entity.anchor?.socket?W.durability.bendPoint(host,point):point;
          point = K.V.add(origin,host.rotation ? K.M.app(host.rotation,offset) : offset);
          socketTurn = host.rotation;
        }
      }
      const pose = point ? {point,rotation:socketTurn,entity,material,...deformation} : null;
      locations.set(id,pose);
      return pose;
    }
    function socket(pose,name) {
      if (!name) return pose.point;
      if (!own(pose.entity?.sockets,name)) return null;
      const offset = W.durability.bendPoint(pose,pose.entity.sockets[name]);
      return K.V.add(pose.point,pose.rotation ? K.M.app(pose.rotation,offset) : offset);
    }
    function fieldFrame({entity,socket:name}) {
      const pose = location(entity);
      const point = pose && socket(pose,name);
      return point && {point,rotation:pose.rotation};
    }
    function target(spec = {}) {
      if (vector(spec)) return {point:spec.slice()};
      check(record(spec), 'Expected a point or an entity selector');
      if (spec.entity !== undefined) {
        const pose = location(spec.entity);
        if (!pose) return null;
        const point = socket(pose,spec.socket);
        return point && {...spec,point};
      }
      if (spec.point !== undefined) check(vector(spec.point), 'Expected a finite XYZ point');
      return spec.point ? {...spec,point:spec.point.slice()} : spec;
    }
    function occupancy(){
      return spatialBatchRead??=W.occupancy.create({entities:world.entities,states,systems,frame:fieldFrame,target,
        condition,probe:(name,site,args)=>api.probe(name,site,args)});
    }
    function spatialBatch(spec) {
      return freeze({tick,time:base.time,results:occupancy()(spec)});
    }
    function add(descriptors, system, collection, handler) {
      for (const [key,item] of Object.entries(collection ?? {})) {
        check(W.data.id(key) && record(item) && typeof item[handler] === 'function', 'Invalid query descriptor ' + key);
        const { [handler]: read, ...description } = item;
        const execute = handler === 'read' && description.spatial ? context => {
          context.field = key;
          return read(context,fieldFrame);
        } : read;
        descriptors.set(system + '/' + key,{system,key,execute,description});
      }
    }
    add(fields,'world',{
      entity:{type:'record',read:({target:site}) => own(world.entities,site.entity) ? ok(world.entities[site.entity]) : missing('unknown entity','missing')},
      ...(world.simulationChunks&&{chunks:{type:'record',selector:true,read({target:site,args}){
        const snapshot=view.simulationChunks;
        if(!snapshot)return missing('simulation chunks are unavailable');
        if(args.system!==undefined)return own(snapshot.clocks,args.system)?ok(snapshot.clocks[args.system]):
          missing('unknown chunk solver','missing');
        const name=args.chunk??site?.entity;
        if(name!==undefined)return own(snapshot.entries,name)?ok(snapshot.entries[name]):missing('unknown simulation chunk','missing');
        return ok(snapshot);
      }}}),
      ...(world.simulationChunks&&Object.values(systems).some(system=>system.simulationRepresentation)&&{
        representation:{type:'record',selector:true,read({target:site,args}){
          const name=args.system??site?.entity;
          if(name!==undefined)return own(systems,name)&&systems[name].simulationRepresentation&&own(states,name)?
            ok(systems[name].simulationRepresentation(states[name])):missing('unknown aggregate solver','missing');
          return ok(Object.fromEntries(Object.entries(systems).flatMap(([key,system])=>
            system.simulationRepresentation&&own(states,key)?[[key,system.simulationRepresentation(states[key])]]:[])));
        }}
      }),
      ...((world.dataInputs !== undefined || dataInputs) && { data: { type: 'value', read({target, args, time}) {
        dataInputs ??= K.dataInputs.prepare(world.dataInputs);
        const options = target.point && args.at === undefined ? { ...args, at: target.point } : args;
        return dataInputs.sample(options, time);
      } } }),
      ...((world.visual?.dataMarks !== undefined || sceneInputs?.dataMarks) && { 'data-mark': { type: 'record', read({args}) {
        const marks = sceneInputs?.dataMarks ?? scene().dataMarks;
        if (args.id !== undefined) {
          check(typeof args.id === 'string', 'Expected a data mark ID');
          const mark = marks?.get(args.id);
          return mark ? ok(mark) : missing('unknown data mark','missing');
        }
        return ok(marks?.list(args) ?? { total: 0, marks: [] });
      } } }),
      position:{type:'vec3',units:'world',read:({target:site}) => site.point ? ok(site.point) : missing('point or entity required')},
      'spatial-batch':{type:'record',selector:true,qualified:true,read:({args})=>ok(spatialBatch(args))},
      neighborhood:{type:'record',selector:true,qualified:true,read:({target:site,args})=>{
        const {field:name,...options}=args;
        return neighborhood(name,site,options);
      }},
      history:{type:'records',read:({args}) => {
        const {after=-1e15,before=tick,entity,where,limit=history.length}=args;
        check(Number.isSafeInteger(after)&&Number.isSafeInteger(before)&&before>=after&&Number.isSafeInteger(limit)&&limit>=0,
          'Invalid history range or result limit');
        const events=history.filter(event=>event.tick>=after&&event.tick<=before&&
          (entity===undefined||[event.entity,event.body,event.place].includes(entity))&&condition(where,event));
        return ok({events:events.slice(0,limit),matched:events.length,dropped});
      }},
      account:{type:'record',read:({args}) => {
        const balance = transfers().inspect(states,args.account);
        return balance ? ok(balance.at===undefined?balance:{...balance,position:W.worksites.frame(api,balance.at)?.point??null}) :
          missing('unknown transfer account','missing');
      }},
      transfers:{type:'record',read:()=>ok({tick:view.transfers?.[0]?.tick??tick,receipts:view.transfers??[]})},
      ...(view.weatherTrackState && { 'weather-tracks':{type:'record',read:()=>ok(view.weatherTrackState)} }),
      signal:{type:'value',read:({args}) => {
        const port=typeof args.port==='string'?portOf(world,args.port):null;
        return own(signals,port)?ok(signals[port]):missing('unknown signal port');
      }}
    },'read');
    add(fields,'look',Object.fromEntries(lookFields.map(({name,type,selector}) => {
      const key = name.slice(5);
      return [key,{type,selector,read:({target:site,args}) => look()[key](site,args)}];
    })),'read');
    if (world.assetPacks?.some(pack=>pack?.materials?.length)) add(fields,'world',{
      material:{type:'record',selector:true,read:({target,args})=>{
        if (args.id!==undefined) {
          const entry=physical()?.getMaterial(args.id);
          return entry?ok(W.materials.profile(entry,args.wetness??0)):missing('unknown physical material','missing');
        }
        if (typeof target.entity!=='string') return missing('material asset ID or entity required');
        const pose=location(target.entity);
        if (!pose) return missing('unknown material entity','missing');
        const binding=pose.material;
        const profile=W.materials.forBody(physical(),world,{entity:target.entity,...binding,
          materialWetness:args.wetness??binding?.materialWetness});
        return profile?ok(profile):missing('entity has no physical material','missing');
      }}
    },'read');
    add(traces,'world',{
      contributions:{selector:true,run:({target,args})=>{
        picker ??= K.procedural.contributions.create(scene(),{time:base.time});
        return ok(picker.ray({...args,origin:args.origin??(Array.isArray(target)?target:target?.point)}));
      }},
      cause:{selector:true,run:({target,args}) => view.causality ?
        W.causality.trace(view.causality,world,tick,args,target?.entity??args.entity) :
        missing('causal recording is not enabled for this snapshot')},
      'causal-inspection':{selector:true,qualified:true,run:({target,args})=>
        W.causalInspection.inspect(view,api,transfers().describe(),target,args)},
      signal:{run:({args}) => {
        let port = args.port;
        if (typeof port !== 'string') return missing('signal port required');
        port=portOf(world,port);
        if(!own(signals,port))return missing('unknown signal port','missing');
        const edges = new Map(world.connections.map(edge => [portOf(world,edge.to),{...edge,from:portOf(world,edge.from)}]));
        const visited = new Set(), points = [];
        while (port) {
          if (visited.has(port)) return ok({status:'cycle',port,points});
          visited.add(port);
          const edge = edges.get(port);
          points.push({port,value:signals[port] ?? null,delay:edge?.delay ?? 0});
          port = edge?.from;
        }
        return ok({status:'source',points});
      }}
    },'run');
    for (const system of sorted(systems)) {
      add(fields,system,systems[system].fields,'read');
      add(traces,system,systems[system].traces,'run');
    }
    function resolve(map,name) {
      if (map.has(name)) return map.get(name);
      aliases ??= new Map();
      let byKey=aliases.get(map);
      if(!byKey){
        byKey=new Map();
        for(const row of map.values())
          if(!row.description.qualified)byKey.set(row.key,byKey.has(row.key)?null:row);
        aliases.set(map,byKey);
      }
      return byKey.get(name);
    }
    function execute(map,name,site,args) {
      const descriptor = resolve(map,name);
      if (!descriptor) return missing(descriptor === null ? 'ambiguous name; use system/name' : 'field or trace is not exposed');
      const position = descriptor.description.selector ? site : target(site);
      if (!position && !descriptor.description.selector) return missing('unknown entity or socket','missing');
      const guard=(map===fields?'field:':'trace:')+descriptor.system+'/'+descriptor.key;
      check(active.size<32&&!active.has(guard),'Cyclic query dependency at '+guard);
      active.add(guard);
      try {
        const result=descriptor.execute({...base,query:api,system:descriptor.system,
          state:states[descriptor.system],target:position,args:args ?? {}});
        check(record(result)&&typeof result.status==='string','Invalid query result at '+guard);
        return freeze(result);
      } finally {
        active.delete(guard);
      }
    }
    function field(name) {
      const descriptor = resolve(fields,name);
      if (descriptor) return {name:descriptor.system+'/'+descriptor.key,...descriptor.description};
    }
    function navigationSource(name, trackedOnly = false) {
      const descriptor=resolve(fields,name);
      const provider=descriptor&&systems[descriptor.system];
      if (!navigationSources.has(descriptor)) {
        navigationSources.set(descriptor,undefined);
        const source=provider?.navigationSource?.(descriptor.key,states[descriptor.system],api);
        navigationSources.set(descriptor,source);
      }
      return navigationSources.get(descriptor)??(trackedOnly?undefined:{key:api});
    }
    function navigation(name) {
      return own(systems,name)?systems[name].navigationTiles?.bind(api):undefined;
    }
    function sampler(name,{type,units,fallback,args} = {}) {
      const descriptor = resolve(fields,name);
      const description = descriptor?.description;
      check(description?.spatial,'Unknown or non-spatial field '+name);
      check(type === undefined || description.type === type,'Unexpected spatial field type for '+name);
      check(units === undefined || description.units === units,'Unexpected spatial field units for '+name);
      if (fallback !== undefined) {
        check(W.spatialFields.matches(description,fallback),'Invalid spatial field fallback for '+name);
        fallback = freeze(copy(fallback));
      }
      return (x,y,z) => {
        const sample = execute(fields,name,[x,y,z],args);
        return sample.status === 'ok' ? sample.value : fallback;
      };
    }
    function neighborhood(name,site,options) {
      const descriptor=field(name), spatial=W.spatialNeighborhood;
      check(descriptor?.spatial,'Unknown or non-spatial field '+name);
      const stencil=spatial.prepare(options);
      const {type,units}=spatial.output(descriptor.type,descriptor.units,stencil);
      const point=target(site)?.point;
      const result=point?spatial.sample(api,descriptor.name,point,stencil,descriptor.type):
        missing('Neighborhood needs a point or a known entity or socket','missing');
      return freeze({...result,type,units});
    }
    function describe(map) {
      return [...map].map(([name,item]) => ({name,...item.description}));
    }
    function inspect({where} = {}) {
      const entities = sorted(world.entities).flatMap(id => {
        const row = {...world.entities[id],id};
        return condition(where,row) ? [row] : [];
      });
      const accounts = transfers().describe();
      const materials = physical()?.materials;
      return {tick,time:base.time,entities,fields:describe(fields),traces:describe(traces),
        ...(materials?.length && {physicalMaterials:materials.map(({material,pack,revision})=>({id:material.id,label:material.label,pack,revision}))}),
        ...(accounts.length && {accounts}),systems:sorted(systems).map(id => ({
        id,...world.systems[id],inputs:systems[id].inputs ?? {},outputs:systems[id].outputs ?? {},
        actions:sorted(systems[id].actions ?? {})
      })),actions:['world/input','world/patch','world/event',...(accounts.length ? ['world/transfer'] : []),
        ...(world.simulationChunks?W.simulationChunks.actions.map(name=>'world/'+name):[])]};
    }
    function spatial({point,radius,where} = {}) {
      check(vector(point) && Number.isFinite(radius) && radius >= 0, 'Expected a finite spatial query');
      if(projected)return projected.spatial(world.entities,states,location,point,radius,where);
      if(!spatialIndex){
        spatialIndex=W.spatial.grid();
        for(const id of sorted(world.entities)){
          const p=location(id)?.point;
          if(!p)continue;
          const row=freeze({...world.entities[id],id,position:p});
          spatialIndex.add(p,row);
        }
      }
      const result=[];
      spatialIndex.overlap(point.map(n=>n-radius),point.map(n=>n+radius),row=>{
        if(K.V.dist(point,row.position)<=radius&&condition(where,row))result.push(row);
      });
      return result.sort((a,b)=>a.id.localeCompare(b.id));
    }
    function exportField(field, spec, args) {
      let points, grid;
      if (Array.isArray(spec.points)) points = spec.points;
      else if (spec.line) {
        const {from,to,count} = spec.line;
        check(vector(from) && vector(to) && Number.isSafeInteger(count) && count >= 2 && count <= 100000,
          'Line needs two XYZ points and 2–100000 samples');
        points = Array.from({length:count},(_,i) => from.map((value,j) => value+(to[j]-value)*i/(count-1)));
      } else {
        const {min,max,counts} = spec.grid ?? {};
        check(vector(min) && vector(max) && vector(counts) && counts.every((n,axis) => Number.isSafeInteger(n) &&
          n > 0 && min[axis] <= max[axis]) && counts.reduce((n,k) => n*k,1) <= 100000,
          'Grid needs XYZ min, max and counts within 100000 samples');
        grid = {min,max,counts,order:'x-fastest'};
        points = [];
        for (let z=0;z<counts[2];z++) for (let y=0;y<counts[1];y++) for (let x=0;x<counts[0];x++)
          points.push([x,y,z].map((index,axis) => min[axis]+(max[axis]-min[axis])*(counts[axis]===1 ? 0 : index/(counts[axis]-1))));
      }
      check(points.length <= 100000 && points.every(p => vector(p)), 'Expected a bounded list of XYZ positions');
      const description = resolve(fields,field)?.description;
      return {tick,time:base.time,field,units:description?.units ?? null,
        ...(description?.spatial && {type:description.type,spatial:description.spatial}),
        ...(grid ? {grid} : {}),samples:points.map(point => ({point,...api.probe(field,point,args)}))};
    }
    const api = Object.freeze({inspect,spatial,spatialBatch,anyAgent:(...args)=>occupancy().anyAgent(...args),target,frame:fieldFrame,field,sampler,neighborhood,navigation,navigationSource,
      simulationClock:name=>view.simulationChunks?.clocks[name],
      renderVolume:name=>own(systems,name)?systems[name].volumeFrame?.(states[name]):null,
      renderWater:name=>own(systems,name)?systems[name].waterFrame?.(states[name]):null,
      select:selector=>look().select(selector),
      inspectLook:options=>look().inspect(options,api),
      probe:(name,at,args) => execute(fields,name,at,args),
      trace:(name,at,args) => execute(traces,name,at,args),export:exportField});
    return api;
  }
  function fromScene(w, time=0) {
    if(typeof w.query==='function'){
      const wrapped=w.query(w,time), appearance=W.lookQuery(()=>w,time);
      let picker;
      const api = Object.freeze({...wrapped, select:appearance.select, inspectLook:options=>appearance.inspect(options,api),
        inspect(options){
          const result=wrapped.inspect(options);
          return {...result,fields:[...(result.fields??[]).filter(row=>!lookFields.some(field=>field.name===row.name)),...lookFields]};
        },
        probe(name,site,args) {return lookFields.some(field=>field.name===name) ?
          freeze(appearance[name.slice(5)](site,args)) : wrapped.probe(name,site,args);},
        trace(name,site,args={}){
          if(name!=='world/contributions'&&name!=='contributions')return wrapped.trace(name,site,args);
          picker??=K.procedural.contributions.create(w,{time});
          return ok(picker.ray({...args,origin:args.origin??(Array.isArray(site)?site:site?.point)}));
        }});
      return api;
    }
    const descriptors={}, configs={};
    if(w.water?.mediumAt){
      configs.water={kind:'water-scene'};
      descriptors.water={fields:{water:{type:'record',units:'world',read:({target})=>{
        if(!target.point)return missing('point required');
        const medium=w.water.mediumAt(...target.point);
        return medium.kind==='water'?ok(medium):missing('point is outside the water volume','dry');
      }}}};
    }
    const graph=w.traversalGraph;
    if(graph&&typeof graph.route==='function'){
      configs.navigation={kind:'traversal-graph'};
      descriptors.navigation={traces:{route:{run:({target,args})=>{
        check((args.from||target.point)&&args.to,'Traversal graph route needs endpoints');
        const answer=graph.route(args.from??target.point,args.to,args.options);
        return ok({status:answer.ok?'ok':answer.reason,...answer});
      }}}};
    }
    const material=w.anim?.systems?.find(system=>system.sandbox&&system.sim)?.sim;
    if(material){
      configs.matter={kind:'material-sandbox'};
      descriptors.matter={fields:{material:{type:'record',read:({target})=>{
        if(!target.point)return missing('point required');
        const value=material.at(target.point);
        return value?ok(value):missing('point is outside the material grid','outside');
      }}}};
    }
    return create({world:W.manifest({id:W.data.id(w.id)?w.id:'world',systems:configs}),tick:Math.round(time*60),time},descriptors,undefined,()=>w,{ dataInputs: w.dataInputs, dataMarks: w.dataMarks });
  }
  function keyedChanges(a,b,{limit=Infinity}={}) {
    const operations = [];
    function compare(before,after,path) {
      if (before===after||operations.length>limit) return;
      if(Array.isArray(before)&&Array.isArray(after)&&before.length===after.length){
        const budget=Math.max(1,Math.floor(after.length/4)), changed=[];
        for(let i=0;i<after.length&&changed.length<=budget;i++)
          if(!equal(before[i],after[i]))changed.push(i);
        if(changed.length<=budget){
          for(const i of changed)compare(before[i],after[i],[...path,i]);
          return;
        }
      }
      if (record(before) && record(after)) {
        for (const key of [...new Set([...Object.keys(before),...Object.keys(after)])].sort()) {
          if(operations.length>limit)break;
          if (!own(after,key)) operations.push({op:'remove',path:[...path,key]});
          else if (!own(before,key)) operations.push({op:'set',path:[...path,key],value:copy(after[key])});
          else compare(before[key],after[key],[...path,key]);
        }
      } else if (!equal(before,after)) operations.push({op:'set',path,value:copy(after)});
    }
    compare(a,b,[]);
    return freeze(operations);
  }
  W.query = Object.freeze({create,condition,ok,missing,fromScene,keyedChanges,projection});
})(KIT);
