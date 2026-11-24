/* Shared labor, spatially checked transfers and transactional recipe effects. */
(function(K){
  const W=K.world, {check,record,own,id,vector,endpoint}=W.data, {V}=K;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const measure=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const handle=ref=>keys(ref,['system','id','generation'])&&id(ref.system)&&id(ref.id)&&
    (ref.generation===undefined||integer(ref.generation,1,Number.MAX_SAFE_INTEGER));
  const target=at=>vector(at)||(keys(at,['entity','socket'])&&id(at.entity)||
    keys(at,['agent','socket'])&&handle(at.agent))&&(at.socket===undefined||id(at.socket));
  function frame(query,at){
    if(vector(at))return {point:at,rotation:null};
    if(!at.agent)return query.frame(at);
    const {system,id:agent,generation}=at.agent;
    const row=query.probe(system+'/agent',undefined,{agent,generation}).value;
    if(!row)return null;
    return at.socket?query.frame({entity:row.entity,socket:at.socket}):{point:row.position,rotation:null};
  }
  const positive=n=>integer(n,1,10000000);
  const reach=n=>measure(n,.02,128);
  const rate=n=>measure(n,.001,64);

  function configure(raw){
    check(keys(raw,['at','radius','minWorkers','maxWorkers','batches','effect'])&&target(raw.at),
      'A worksite needs a point or socket');
    const {at,radius=.6,minWorkers=1,maxWorkers=minWorkers,batches=1,effect}=raw;
    check(reach(radius)&&integer(minWorkers,1,64)&&integer(maxWorkers,minWorkers,64)&&positive(batches),
      'Invalid worksite range, labor capacity or batch count');
    if(effect!==undefined){
      check(keys(effect,['action','args'])&&record(effect.args??{}),'Invalid worksite effect');
      endpoint(effect.action);
    }
    return {at,radius,minWorkers,maxWorkers,batches,...(effect!==undefined&&{effect})};
  }

  function contact(query,request,position,radius){
    for(const account of [request.from,request.to]){
      const sample=query.probe('world/account',undefined,{account}).value;
      if(!sample?.position)return 'transfer-endpoint-missing';
      if(V.dist(position,sample.position)>radius+1e-8)return 'transfer-out-of-reach';
    }
    return null;
  }

  function bind(systems){
    const names=Object.keys(systems).sort(), sites=new Map();
    const consumers=names.filter(name=>systems[name].orderWork);
    for(const name of names){
      for(const [process,spec] of Object.entries(systems[name].worksites?.definitions??{})){
        let effect;
        if(spec.effect){
          const [destination,action]=endpoint(spec.effect.action);
          const provider=own(systems,destination)&&systems[destination].workEffects;
          const handler=own(provider,action)&&provider[action];
          check(destination!==name&&handler,'Unsupported worksite effect '+spec.effect.action);
          const args=spec.effect.args??{};
          handler.check(args,spec.batches);
          effect={destination,handler,args};
        }
        sites.set(name+'/'+process,{name,process,spec,effect});
      }
    }
    const checkWork=(site,batch)=>{
      const row=sites.get(site);
      check(row,'Unknown worksite '+site);
      check(positive(batch)&&batch<=row.spec.batches,'Work order batch is outside the worksite plan');
    };
    for(const name of consumers)systems[name].orderWork.check(checkWork);
    if(!sites.size)return null;

    function run(states,ctx){
      const available=new Map();
      let snapshot=ctx.query();
      for(const name of consumers){
        if(!ctx.detailed(name)||W.simulationAggregate.isAggregate(states[name]))continue;
        for(const item of systems[name].orderWork.rows(states[name],{id:name,tick:ctx.tick,query:snapshot})){
          const {site,batch,rate,agent,generation,at}=item, key=site+'/'+batch;
          if(!available.has(key))available.set(key,[]);
          available.get(key).push({system:name,agent,generation,rate,at});
        }
      }
      for(const [path,{name,process,spec,effect}] of sites){
        if(!ctx.detailed(name)||W.simulationAggregate.isAggregate(states[name]))continue;
        const provider=systems[name].worksites, state=states[name], batch=provider.completed(state,process)+1;
        const point=frame(snapshot,spec.at)?.point, workers=[];
        if(point)for(const {at,...worker} of available.get(path+'/'+batch)??[]){
          if(V.dist(at,point)>spec.radius+1e-8)continue;
          workers.push(worker);
          if(workers.length===spec.maxWorkers)break;
        }
        const input=ctx.input(name);
        let effectApplied=false;
        const result=provider.step(state,process,{workers,arrived:Boolean(point),dt:ctx.dt,
          enabled:input['enable-process.'+process],speed:input['speed.'+process]},()=>{
          if(!effect)return null;
          const {destination,handler,args}=effect;
          if(!ctx.detailed(destination)||W.simulationAggregate.isAggregate(states[destination]))return 'effect-asleep';
          const prepared=handler.run(states[destination],args,batch,ctx.context(destination,ctx.query()));
          if(prepared.reason)return prepared.reason;
          states[destination]=ctx.root(prepared.state);
          effectApplied=true;
          return null;
        });
        if(result.state!==state)states[name]=ctx.root(result.state);
        if(effectApplied)snapshot=ctx.query();
        const say=ctx.emit(name);
        if(result.finished)say('work-completed',{process,batch,workers});
        if(result.demandChanged&&result.reason)say('work-demand',{process,batch,reason:result.reason,workers:workers.length});
      }
    }
    return {run};
  }

  W.worksites=Object.freeze({configure,bind,target,frame,reach,rate,positive,contact});
})(KIT);
