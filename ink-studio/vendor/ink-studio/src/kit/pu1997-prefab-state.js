/* Rewrite future references and transplant checked checkpoint state at the same tick. */
(function(K){
  const W=K.world, {check,copy,endpoint,portOf,own,equal,record,selector,read}=W.data;
  const freeze=K.procedural.data.freeze, sorted=value=>Object.keys(value??{}).sort();

  function commands(rows,h,migration,target){
    const map=(value,kind,location)=>{
      const mapped=h.scoped(value,kind);
      if(!mapped)h.issue('command',{location,value,reason:'Command endpoint has no target'});
      return mapped??value;
    };
    const edits=(list,location)=>list.map(edit=>{
      const path=selector(edit.path), {mapped}=h.mapEditPath(path);
      if(!mapped)h.issue('command',{location,path,reason:'Edit target has no replacement'});
      const rewritten=mapped&&equal(path,mapped)?edit.path:mapped??edit.path;
      return {...edit,path:rewritten,...(own(edit,'value')&&{value:h.ref(edit.value)})};
    });
    const at=(value,location)=>{
      if(!record(value)||!value.entity)return value;
      const mapped=h.anchor(value);
      if(!mapped)h.issue('command',{location,value,reason:'Focus socket has no target'});
      return mapped??value;
    };
    const action=(value,location)=>value.startsWith('world/')?value:map(value,'actions',location);
    const list=(values,location)=>(values??[]).map((row,index)=>{
      const site=location+'/'+index, args=row.args??{}, path=action(row.action,site);
      let result=h.ref(args);
      if(row.action==='world/input'){
        const port=h.wire(args.port);
        if(!port)h.issue('command',{location:site,value:args.port,reason:'Input port has no target'});
        result={...args,port:port??args.port};
      }else if(row.action==='world/transfer'){
        result={...args,from:map(args.from,'accounts',site),to:map(args.to,'accounts',site)};
      }else if(row.action==='world/patch'){
        result={...args,edits:edits(args.edits,site)};
      }else if(row.action==='world/chunk-focus'){
        result={...args,at:at(args.at,site)};
      }else if(!row.action.startsWith('world/')){
        const [name,key]=endpoint(row.action), policy=h.owned.systems.has(name)&&migration.actionEdits?.[h.local(name)+'/'+key];
        if(policy)result=W.apply(result,policy,{validate:null}).world;
      }
      if(path===row.action&&equal(args,result))return row;
      h.report.commands.push({location:site,from:row.action,to:path,status:'remapped'});
      return {...row,action:path,args:result};
    });
    if(target==='pending')return list(rows,'checkpoint/pending');
    return {list,edits,at,action};
  }

  function rewriteWorld(next,source,migration,h){
    const map=commands(undefined,h,migration), scenario=source.scenario;
    let chunks=source.simulationChunks;
    if(chunks){
      const ownership=new Map();
      for(const [key,row] of Object.entries(chunks.chunks))for(const name of row.systems)ownership.set(name,key);
      const oldOwners=new Set([...h.owned.systems].map(name=>ownership.get(name)).filter(Boolean));
      const targetOwners=new Map([...ownership].filter(([name])=>!h.owned.systems.has(name)));
      const inverse=new Map([...h.owned.systems].map(name=>[h.member(name,'systems'),name]));
      const names=next.entities[h.report.instance].prefabStamp.members.systems;
      for(const name of names){
        const old=inverse.get(name), key=h.local(name);
        const owner=own(migration.chunks,key)?migration.chunks[key]:old?ownership.get(old):
          oldOwners.size===1?[...oldOwners][0]:undefined;
        if(!old&&oldOwners.size>1&&owner===undefined)
          h.issue('chunk',{system:name,reason:'Added system needs an explicit chunk'});
        if(owner!==undefined&&owner!==null){
          if(own(chunks.chunks,owner))targetOwners.set(name,owner);
          else h.issue('chunk',{system:name,reason:'Unknown target chunk '+owner});
        }
      }
      const systemsByChunk=new Map();
      for(const [name,key] of targetOwners){
        if(!systemsByChunk.has(key))systemsByChunk.set(key,[]);
        systemsByChunk.get(key).push(name);
      }
      const newChunks=Object.fromEntries(Object.entries(chunks.chunks).flatMap(([key,row])=>
        systemsByChunk.has(key)?[[key,{...row,systems:systemsByChunk.get(key)}]]:[]));
      const levels=chunks.levels.map(level=>level.instances?{...level,instances:Object.fromEntries(
        Object.entries(level.instances).flatMap(([name,rule])=>{
          const mapped=h.member(name,'systems');
          return mapped?[[mapped,rule]]:[];
        }))}:level);
      const focus=chunks.focus&&Object.fromEntries(Object.entries(chunks.focus).map(([key,row])=>
        [key,{...row,at:map.at(row.at,'simulationChunks/focus/'+key)}]));
      chunks={...chunks,chunks:newChunks,levels,...(focus&&{focus})};
    }
    const nextScenario=scenario&&{...scenario,
      ...(scenario.start&&{start:map.edits(scenario.start,'scenario/start')}),
      ...(scenario.commands&&{commands:map.list(scenario.commands,'scenario/commands')}),
      ...(scenario.allow&&{allow:scenario.allow.map(value=>map.action(value,'scenario/allow'))}),
      ...(scenario.rules&&{rules:h.ref(scenario.rules)})};
    return {...next,commands:map.list(source.commands,'commands'),...(nextScenario&&{scenario:nextScenario}),
      ...(chunks&&{simulationChunks:chunks}),...(source.visual&&{visual:h.ref(source.visual)})};
  }

  function stateEdits(value,rule){
    const moves=Object.entries(rule?.paths??{}).map(([key,to])=>({
      from:selector(key),to:to===null?null:selector(to)
    })).filter(row=>read(value,row.from)!==undefined&&(!row.to||!equal(row.from,row.to)));
    const target=path=>JSON.stringify(path);
    const sources=new Set(moves.map(row=>target(row.from))), destinations=new Set();
    const edits=[];
    for(const {from,to} of moves){
      check(record(read(value,from.slice(0,-1)))&&(!to||record(read(value,to.slice(0,-1)))),
        'State path moves need record-key parents');
      if(to){
        check(!destinations.has(target(to))&&(read(value,to)===undefined||sources.has(target(to))),
          'State path move would overwrite '+to.join('/'));
        destinations.add(target(to));
      }
      edits.push({op:'remove',path:from});
    }
    for(const {from,to} of moves)if(to)edits.push({op:'set',path:to,value:read(value,from)});
    edits.push(...(rule?.edits??[]));
    return edits.length?W.apply(value,edits,{validate:null}).world:value;
  }

  function checkpoint(saved,world,migration,h){
    const R=W.runtime,{options,report}=h;
    check(saved.world.id===world.id&&saved.world.dt===world.dt&&saved.world.seed===world.seed,
      'A checkpoint upgrade keeps the world ID, seed and timestep');
    R.create(saved.world,{...options,checkpoint:saved});
    const bootstrap=world.scenario?.start?.length?{...world,scenario:{...world.scenario,start:[]}}:world;
    const initialized=R.create(bootstrap,options), defaults=initialized.checkpoint();
    const before=R.prefabInterfaces(saved.world,options), after=R.prefabInterfaces(world,options);
    const next={...saved,world,states:{...defaults.states},pending:commands(saved.pending,h,migration,'pending')};
    const resets=new Set();
    for(const [name,value] of Object.entries(saved.states)){
      const mapped=h.member(name,'systems'), owned=h.owned.systems.has(name);
      const rule=owned?migration.state?.[h.local(name)]:undefined;
      check(rule===undefined||record(rule)&&Object.keys(rule).every(key=>['mode','edits','paths'].includes(key))&&
        ['preserve','reset','discard'].includes(rule.mode)&&
        (rule.edits===undefined||rule.mode==='preserve'&&Array.isArray(rule.edits))&&
        (rule.paths===undefined||rule.mode==='preserve'&&record(rule.paths)), 'Invalid state policy for '+name);
      let status='preserved';
      if(!mapped){
        if(rule?.mode!=='discard')h.issue('state',{system:name,reason:'Retired state needs an explicit discard policy'});
        status='discarded';
      }else if(rule?.mode==='discard'){
        h.issue('state',{system:name,to:mapped,reason:'Use reset to initialize a retained solver'});
        status='repair';
      }else if(rule?.mode==='reset'){
        resets.add(name);status='reset';
      }else{
        const oldSpec=saved.world.systems[name], nextSpec=world.systems[mapped];
        if(oldSpec.kind!==nextSpec.kind&&rule?.mode!=='preserve'){
          h.issue('state',{system:name,to:mapped,reason:'A different solver kind needs an explicit state policy'});
          status='repair';
        }else{
          let valueNext;
          try{valueNext=stateEdits(value,rule);}
          catch(error){h.issue('state',{system:name,to:mapped,reason:error.message});status='repair';valueNext=value;}
          const shape=node=>Array.isArray(node)?'array':node===null?'null':typeof node;
          if(!after.systems[mapped]?.validateState&&!equal(oldSpec,nextSpec)){
            const seed=defaults.states[mapped];
            const compatible=shape(seed)===shape(valueNext)&&(!record(seed)||
              Object.keys(seed).every(key=>own(valueNext,key)&&shape(seed[key])===shape(valueNext[key])));
            if(!compatible)h.issue('state',{system:name,to:mapped,reason:'Saved state does not match the target solver shape'});
          }
          try{
            if(valueNext?.format!=='ink-studio/aggregate-state')after.systems[mapped]?.validateState?.(valueNext);
          }
          catch(error){h.issue('state',{system:name,to:mapped,reason:error.message});status='repair';}
          next.states[mapped]=valueNext;
          if(status!=='repair')status=valueNext!==value?'migrated':name===mapped?'preserved':'remapped';
        }
      }
      if(owned)report.state.push({from:name,to:mapped,status});
    }
    const initializedNames=new Set(report.state.map(row=>row.to));
    for(const name of world.entities[report.instance].prefabStamp.members.systems)
      if(!initializedNames.has(name))report.state.push({to:name,status:'initialized'});
    if(report.issues.length)return null;

    const forward=(port,kind='pins')=>{
      const [name]=endpoint(port);
      return resets.has(name)?null:h.scoped(port,kind);
    };
    function migrate(values,template,transform=forward,allow=()=>true){
      const result={...template}, assigned=new Set();
      for(const [key,value] of Object.entries(values??{})){
        const mapped=transform(key);
        if(mapped&&own(template,mapped)&&allow(key,mapped,value)){
          if(assigned.has(mapped))h.issue('checkpoint',{to:mapped,reason:'More than one saved value maps to the same target'});
          result[mapped]=value;
          assigned.add(mapped);
        }
      }
      return result;
    }
    const sameType=(left,right)=>(key,mapped)=>left[key]?.type===right[mapped]?.type;
    const all=schema=>({...schema.inputs,...schema.outputs});
    for(const [port,value] of Object.entries(saved.manual)){
      const [name,pin]=endpoint(port), mapped=forward(port);
      if(!h.owned.systems.has(name)||resets.has(name)||equal(value,before.ports.inputs[port].default))continue;
      if((!mapped||!own(after.ports.inputs,mapped)||!sameType(before.ports.inputs,after.ports.inputs)(port,mapped))&&
        !(own(migration.pins,h.local(name)+'/'+pin)&&migration.pins[h.local(name)+'/'+pin]===null))
        h.issue('state-port',{from:port,to:mapped,reason:'Saved input override needs a compatible pin or explicit reset'});
    }
    next.manual=migrate(saved.manual,defaults.manual,forward,sameType(before.ports.inputs,after.ports.inputs));
    next.outputs=migrate(saved.outputs,defaults.outputs,forward,sameType(before.ports.outputs,after.ports.outputs));
    next.signals=migrate(saved.signals,defaults.signals,forward,sameType(all(before.ports),all(after.ports)));
    const edgeMap=source=>new Map(source.connections.map(edge=>[portOf(source,edge.to),
      {from:portOf(source,edge.from),delay:edge.delay??0,sample:edge.sample??null}]));
    const oldEdges=edgeMap(saved.world), newEdges=edgeMap(world);
    function compatibleRoute(key,mapped){
      const left=oldEdges.get(key), right=newEdges.get(mapped);
      return left&&right?equal({...left,from:forward(left.from)},right):!left&&!right;
    }
    next.delays=migrate(saved.delays,defaults.delays,forward,(key,mapped)=>compatibleRoute(key,mapped)&&
      sameType(before.ports.inputs,after.ports.inputs)(key,mapped));

    if(defaults.simulationChunks){
      const old=saved.simulationChunks, template=defaults.simulationChunks;
      const entityFocus=focus=>Object.fromEntries(Object.entries(focus??{}).map(([key,row])=>{
        const at=record(row.at)&&row.at.entity?h.anchor(row.at):row.at;
        if(!at)h.issue('checkpoint',{reason:'Saved focus socket has no target',focus:key});
        return [key,{...row,at:at??row.at}];
      }));
      next.simulationChunks={...template,...(old&&{
        clocks:migrate(old.clocks,template.clocks,key=>h.member(key,'systems')),
        entries:Object.fromEntries(Object.entries(template.entries).map(([key,row])=>[key,
          own(old.entries,key)?{...old.entries[key],address:row.address,bounds:row.bounds,systems:row.systems,place:row.place}:row])),
        focus:entityFocus(old.focus),overrides:migrate(old.overrides,Object.fromEntries(sorted(template.entries)
          .filter(key=>own(old.overrides,key)).map(key=>[key,old.overrides[key]])),key=>key)
      })};
    }else delete next.simulationChunks;

    if(defaults.sampling){
      const {subdivision,systems}=initialized.rates();
      const selected=migrate(saved.sampling,defaults.sampling,forward,(key,mapped)=>
        compatibleRoute(key,mapped)&&sameType(before.ports.inputs,after.ports.inputs)(key,mapped));
      for(const [port,row] of Object.entries(selected))if(record(row)&&own(row,'quanta')){
        const [name]=endpoint(port), clock=next.simulationChunks?.clocks[name];
        const quanta=(clock?clock.pending:saved.tick%systems[name].every)*subdivision;
        if(quanta!==row.quanta){
          const output=next.outputs[newEdges.get(port)?.from]??0;
          selected[port]={quanta,value:Array.isArray(output)?output.map(n=>n*quanta):output*quanta};
          report.state.push({to:port,status:'sampling-rebased'});
        }
      }
      next.sampling=selected;
    }else delete next.sampling;
    for(const [key,row] of Object.entries(next.delays))if(row===defaults.delays[key])
      report.state.push({to:key,status:'delay-initialized'});

    const notice=row=>({...row,writer:h.member(row.writer,'systems'),field:h.scoped(row.field,'fields')});
    if(saved.dependencyWrites)next.dependencyWrites=saved.dependencyWrites.map(notice).filter(row=>row.writer&&row.field);
    if(saved.spatialSampling)next.spatialSampling=Object.fromEntries(Object.entries(saved.spatialSampling).flatMap(([key,rows])=>{
      const name=h.member(key,'systems');
      return name?[[name,rows.map(notice).filter(row=>row.writer&&row.field)]]:[];
    }));
    if(saved.transfers)next.transfers=saved.transfers.map(row=>{
      const from=h.scoped(row.from,'accounts'),to=h.scoped(row.to,'accounts');
      const requester=h.member(row.requester,'systems');
      if(!from||!to||!requester){report.state.push({from:row.from,to:row.to,status:'receipt-retained-in-history'});return null;}
      return {...row,from,to,requester};
    }).filter(Boolean);
    if(saved.causality){
      const template=defaults.causality;
      const omitted=keys=>Object.fromEntries(sorted(keys).map(key=>[key,'omitted']));
      const sparse=(values,allowed,transform)=>Object.fromEntries(Object.entries(values??{}).flatMap(([key,value])=>{
        const mapped=transform(key);
        return mapped&&own(allowed,mapped)?[[mapped,value]]:[];
      }));
      next.causality={...saved.causality,
        outputs:migrate(saved.causality.outputs,omitted(template.outputs),forward),
        inputs:migrate(saved.causality.inputs,omitted(template.inputs),forward),
        delays:migrate(saved.causality.delays,Object.fromEntries(Object.entries(template.delays).map(([key,row])=>
          [key,row.map(()=>[])])),forward,compatibleRoute),
        actions:sparse(saved.causality.actions,world.systems,key=>h.member(key,'systems')),
        manual:sparse(saved.causality.manual,defaults.manual,forward),
        buffers:sparse(saved.causality.buffers,defaults.manual,forward)};
    }
    if(report.issues.length)return null;
    return R.create(world,{...options,checkpoint:freeze(copy(next))}).checkpoint();
  }
  W.prefabState=Object.freeze({rewriteWorld,checkpoint});
})(KIT);
