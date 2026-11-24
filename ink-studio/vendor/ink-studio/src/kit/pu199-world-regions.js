/* Transport-independent region snapshots and changes against an applied revision. */
(function(K){
  const W=K.world, P=K.procedural, {check,copy,equal,id,own,record,vector}=W.data, freeze=P.data.freeze;
  const format='ink-studio/region-update', globalRegion='@global';
  const regionId=value=>id(value)||value===globalRegion;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const endpoint=value=>value.split('/')[0];
  const allowed=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));

  function cursor(value){
    check(allowed(value,['stream','revision','regions'])&&id(value.stream)&&integer(value.revision,0,10000000)&&
      Array.isArray(value.regions)&&value.regions.length<=513&&value.regions.every((name,i)=>
        regionId(name)&&(i===0||name>value.regions[i-1])), 'Invalid region revision cursor');
    return value;
  }

  function capture(world, options, providers){
    check(allowed(options,['stream','retain','maxEdits','maxActions']), 'Invalid region revision options');
    const {stream,retain=16,maxEdits=4096,maxActions=1024}=options;
    check(id(stream)&&integer(retain,1,256)&&integer(maxEdits,1,10000)&&integer(maxActions,1,100000),
      'Region revisions need a stream ID and bounded retention');
    const frames=new Map(), layout=new Map(), addresses=new Map(), owners=new Map(), ports=new Map();
    const source=world.simulationChunks, dimensions=source?.grid?.dimensions??2;
    const grid=source&&P.chunks.grid({...source.grid,dimensions});
    const coord=point=>dimensions===2?[point[0],point[2]]:point;
    for(const [name,raw] of Object.entries(source?.chunks??{}).sort(([a],[b])=>a<b?-1:1)){
      const place=raw.place??world.id, address=grid.key(place,raw.index), bounds=grid.bounds(raw.index);
      const systems=raw.systems.slice().sort();
      layout.set(name,freeze({id:name,place,address,bounds,systems}));
      addresses.set(address,name);
      for(const system of systems)owners.set(system,name);
    }
    const owner=name=>owners.get(name)??globalRegion;
    layout.set(globalRegion,freeze({id:globalRegion,systems:Object.keys(world.systems).filter(key=>!owners.has(key)).sort()}));
    let latest;

    function ownership(frame){
      if(frame.entities)return frame.entities;
      const entities=frame.view.world.entities, query=W.query.create(frame.view,providers), pages=new Map(), membership=new Map();
      const states=frame.view[W.simulationAggregate.rawStates], places=new Map(), posed=new Map();
      for(const [system,provider] of Object.entries(providers))if(provider.poseEntities){
        for(const name of provider.poseEntities(states[system]))
          if(id(name)&&!posed.has(name))posed.set(name,layout.get(owner(system)).place??world.id);
      }
      function placeOf(name){
        if(places.has(name))return places.get(name);
        const entity=own(entities,name)?entities[name]:null, parent=entity?.anchor?.entity??entity?.parent;
        const place=entity?.place??(parent&&own(entities,parent)?placeOf(parent):posed.get(name)??world.id);
        places.set(name,place);
        return place;
      }
      for(const name of new Set([...Object.keys(entities),...posed.keys()])){
        const entity=own(entities,name)?entities[name]:null;
        const position=query.target({entity:name})?.point??null, place=placeOf(name);
        if(!entity&&!position)continue;
        let region=globalRegion;
        if(grid&&position&&vector(position)&&id(place)){
          try {
            region=addresses.get(grid.key(place,grid.index(coord(position))))??globalRegion;
          } catch(error) {
            if(!(error instanceof RangeError))throw error;
          }
        }
        membership.set(name,region);
        if(!pages.has(region))pages.set(region,{});
        pages.get(region)[name]=freeze({entity,position});
      }
      frame.entities={pages,membership};
      return frame.entities;
    }

    function section(frame, name){
      if(frame.sections.has(name))return frame.sections.get(name);
      const entry=layout.get(name), {view}=frame, states=view[W.simulationAggregate.rawStates]??view.states;
      const runtime=view.simulationChunks?.entries[name];
      const systems=Object.fromEntries(entry.systems.map(system=>[system,{
        kind:view.world.systems[system].kind,state:states[system],
        signals:Object.fromEntries((ports.get(system)??[]).map(port=>[port.slice(system.length+1),view.signals[port]])),
        ...(own(view.simulationChunks?.clocks,system)&&{clock:view.simulationChunks.clocks[system]})
      }]));
      const entities=ownership(frame).pages.get(name)??{};
      const result=freeze({id:name,...(runtime&&{place:entry.place,address:entry.address,bounds:entry.bounds,
        level:runtime.level,sleeping:runtime.sleeping}),systems,entities});
      frame.sections.set(name,result);
      return result;
    }
    const project=(frame,scope)=>freeze({regions:Object.fromEntries(scope.map(name=>[name,section(frame,name)]))});

    function select(spec={}){
      check(allowed(spec,['regions','at','place','radius','includeGlobal'])&&
        (spec.includeGlobal===undefined||typeof spec.includeGlobal==='boolean'), 'Invalid region interest');
      const {regions,at,place=world.id,radius=0,includeGlobal=false}=spec;
      let selected;
      if(regions!==undefined){
        check(spec.at===undefined&&spec.radius===undefined&&spec.place===undefined&&Array.isArray(regions)&&
          regions.length<=513&&regions.every(name=>layout.has(name)), 'Unknown or invalid region selection');
        selected=regions.slice();
      }else if(at!==undefined){
        check(vector(at)&&id(place)&&Number.isFinite(radius)&&radius>=0, 'Invalid nearby region interest');
        const point=coord(at);
        selected=[];
        for(const [name,entry] of layout){
          if(entry.place!==place)continue;
          const {min,max}=entry.bounds;
          const distance=Math.hypot(...point.map((x,i)=>Math.max(0,min[i]-x,x-max[i])));
          if(distance<=radius)selected.push(name);
        }
      }else{
        check(spec.radius===undefined&&spec.place===undefined, 'Nearby regions need an XYZ point');
        selected=[...layout.keys()].filter(name=>name!==globalRegion);
      }
      if(includeGlobal)selected.push(globalRegion);
      return Object.freeze([...new Set(selected)].sort());
    }

    function relevant(command,before,after,regions){
      const [system,key]=W.data.endpoint(command.action), args=command.args;
      if(system!=='world')return regions.has(owner(system))?command:null;
      if(key==='input')return regions.has(owner(endpoint(args.port)))?command:null;
      if(key==='transfer')return [args.from,args.to].some(port=>regions.has(owner(endpoint(port))))?command:null;
      if(key==='chunk-level')return regions.has(args.chunk)?command:null;
      const includesEntity=name=>[before,after].some(frame=>regions.has(ownership(frame).membership.get(name)));
      if(key==='patch'){
        const edits=args.edits.filter(edit=>{
          const [root,entity]=W.data.selector(edit.path);
          return root==='entities'&&typeof entity==='string'&&includesEntity(entity);
        });
        return edits.length?{...command,args:{edits}}:null;
      }
      if(key==='event'&&id(args.entity))return includesEntity(args.entity)?command:null;
      return regions.has(globalRegion)?command:null;
    }

    function publish(view,commands=[]){
      const revision=view.tick;
      if(!latest)for(const port of Object.keys(view.signals)){
        const system=endpoint(port);
        if(!ports.has(system))ports.set(system,[]);
        ports.get(system).push(port);
      }
      const frameView={world:view.world,states:view.states,signals:view.signals,tick:revision,
        ...(view.simulationChunks&&{simulationChunks:view.simulationChunks}),
        [W.simulationAggregate.rawStates]:view[W.simulationAggregate.rawStates]??view.states};
      latest={revision,view:frameView,sections:new Map(),commands:commands.length<=maxActions?commands:null};
      frames.set(revision,latest);
      if(frames.size>retain)frames.delete(frames.keys().next().value);
    }

    function pull(spec, {since}={}){
      const regions=select(spec), current={stream,revision:latest.revision,regions};
      if(since!==undefined)cursor(since);
      const before=since?.stream===stream&&frames.get(since.revision);
      const comparable=before&&since.regions.every(name=>layout.has(name));
      const state=project(latest,regions), header={format,version:1,cursor:current};
      if(!comparable)return freeze({...header,type:'snapshot',state,actions:[],actionsComplete:false,
        ...(since?.stream===stream&&since.revision<=latest.revision&&{base:copy(since)}),
        reason:since===undefined?'initial':since.stream!==stream?'stream-mismatch':'history-gap'});
      const selected=new Set(regions), actions=[];
      let actionsComplete=true;
      for(let revision=since.revision+1;revision<=latest.revision;revision++){
        const frame=frames.get(revision);
        if(!frame.commands){actionsComplete=false;break;}
        for(const command of frame.commands){
          const row=relevant(command,frames.get(revision-1),frame,selected);
          if(row)actions.push(row);
          if(actions.length>maxActions){actionsComplete=false;break;}
        }
        if(!actionsComplete)break;
      }
      const actionData={actions:actionsComplete?actions:[],actionsComplete};
      const edits=W.query.keyedChanges(project(before,since.regions),state,{limit:maxEdits});
      if(edits.length>maxEdits)return freeze({...header,type:'snapshot',base:copy(since),state,
        reason:'edit-budget',...actionData});
      return freeze({...header,type:'delta',base:copy(since),edits,...actionData});
    }
    const catalog=()=>freeze([...layout.values()]);
    const status=()=>freeze({stream,revision:latest.revision,oldestRevision:frames.keys().next().value});
    return {publish,api:Object.freeze({catalog,select,pull,status})};
  }

  function receiver({snapshot:initial}={}){
    let current, state;
    function validateState(value,revision){
      check(allowed(value,['regions'])&&record(value.regions)&&
        equal(Object.keys(value.regions).sort(),revision.regions)&&
        Object.entries(value.regions).every(([key,row])=>record(row)&&row.id===key&&
          record(row.systems)&&record(row.entities)), 'Invalid region snapshot membership');
    }
    function apply(update){
      check(record(update)&&update.format===format&&update.version===1&&['snapshot','delta'].includes(update.type)&&
        Array.isArray(update.actions)&&typeof update.actionsComplete==='boolean', 'Invalid region update');
      const next=cursor(update.cursor);
      const base=update.base===undefined?undefined:cursor(update.base);
      if(base)check(base.stream===next.stream&&base.revision<=next.revision,'Invalid region update baseline');
      if(current&&next.stream!==current.stream)return {status:'stream-mismatch',cursor:current};
      if(equal(next,current))return {status:'duplicate',cursor:current};
      if(current&&(next.revision<current.revision||!base&&next.revision===current.revision))
        return {status:'stale',cursor:current};
      if(base&&current&&!equal(base,current))return {status:'needs-snapshot',cursor:current};
      let draft;
      if(update.type==='snapshot'){
        draft=freeze(copy(update.state));
      }else{
        check(base&&Array.isArray(update.edits)&&update.edits.length<=10000&&update.edits.every(edit=>
          record(edit)&&['set','remove'].includes(edit.op)&&Array.isArray(edit.path)&&
          edit.path.length>=2&&edit.path[0]==='regions'&&regionId(edit.path[1])), 'Invalid region delta edits');
        if(!equal(current,base))return {status:'needs-snapshot',cursor:current};
        draft=W.apply(state,update.edits,{validate:null}).world;
      }
      validateState(draft,next);
      const actions=freeze(copy(update.actions));
      current=freeze(copy(next));
      state=draft;
      return {status:'applied',cursor:current,actions,actionsComplete:update.actionsComplete};
    }
    const snapshot=()=>current&&freeze({format,version:1,type:'snapshot',cursor:current,state,actions:[],actionsComplete:false});
    if(initial!==undefined){
      check(initial?.type==='snapshot','A region receiver needs a saved snapshot');
      apply(initial);
    }
    return Object.freeze({apply,snapshot});
  }
  W.regionRevisions=Object.freeze({capture,receiver,format,globalRegion});
})(KIT);
