/* Fixed-tick, range-checked interactions over live targets and authored effects. */
(function(K){
  const W=K.world, Q=W.query, E=W.targetedEffects, {V}=K;
  const {check,record,id,own,vector,selector,read,endpoint}=W.data;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const between=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const tick=n=>between(n,0,10000000);
  const handle=ref=>keys(ref,['system','id','generation'])&&id(ref.system)&&id(ref.id)&&
    (ref.generation===undefined||between(ref.generation,1,Number.MAX_SAFE_INTEGER));
  const equalActor=(a,b)=>a.system===b.system&&a.id===b.id&&a.generation===b.generation;
  const capacityBlocker=(busy,targetCount,targetMax,activeCount,activeMax)=>busy?'actor-busy':
    targetCount>=targetMax?'target-busy':activeCount>=activeMax?'capacity':null;
  const sameLifetime=(a,b)=>a===null?b===null:b!==null&&equalActor(a,b);
  const validToken=key=>typeof key==='string'&&key.length<=400&&key.split('/').every(id);
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const rows=(table,limit,label)=>{
    check(record(table)&&Object.keys(table).length<=limit&&Object.keys(table).every(id),'Invalid interaction '+label);
    return Object.entries(table).sort(([a],[b])=>compare(a,b));
  };

  function actorAt(query,ref){
    const result=query.probe(ref.system+'/agent',undefined,{agent:ref.id,generation:ref.generation});
    const row=result.value;
    return result.status==='ok'&&row?.id===ref.id&&row.mode!=='dormant'&&vector(row.position)&&
      between(row.generation,1,Number.MAX_SAFE_INTEGER)?row:null;
  }

  function build(config){
    check(keys(config,['targets','verbs','factionPath','maxActive','historyLimit']),'Invalid targeted interaction config');
    const {targets,verbs,factionPath=['metadata','faction'],maxActive=256,historyLimit=128}=config;
    check(between(maxActive,1,1024)&&between(historyLimit,1,1024),'Invalid interaction limits');
    const path=selector(factionPath), definitions=new Map(), offers=new Map(), sources=new Set();
    const emits=new Set(['started','completed','rejected','failed','cancelled','denied'].map(status=>'interaction-'+status));
    for(const [name,rule] of rows(verbs,128,'verbs')){
      check(keys(rule,['range','ticks','access','actorWhen','targetWhen','requires','cue'])&&
        Number.isFinite(rule.range)&&rule.range>=0&&rule.range<=128&&tick(rule.ticks??0)&&
        (rule.cue===undefined||id(rule.cue)),'Invalid interaction verb '+name);
      const access=rule.access??{};
      check(keys(access,['factions','relation'])&&
        (access.factions===undefined||Array.isArray(access.factions)&&access.factions.length>0&&
          access.factions.length<=64&&access.factions.every(id)&&new Set(access.factions).size===access.factions.length)&&
        (access.relation===undefined||['same','different'].includes(access.relation)),'Invalid interaction access '+name);
      Q.condition(rule.actorWhen,{});
      Q.condition(rule.targetWhen,{});
      check(Array.isArray(rule.requires??[])&&(rule.requires??[]).length<=8,'Invalid interaction requirements '+name);
      for(const req of rule.requires??[]){
        check(keys(req,['field','at','args','when'])&&['actor','target'].includes(req.at??'target')&&
          record(req.args??{}),'Invalid interaction field condition '+name);
        endpoint(req.field);
        Q.condition(req.when,undefined);
        sources.add(req.field);
      }
      if(rule.cue!==undefined)emits.add(rule.cue);
      definitions.set(name,{...rule,access,ticks:rule.ticks??0});
    }
    check(definitions.size>0,'Interactions need at least one verb');
    for(const [name,target] of rows(targets,1024,'targets')){
      check(keys(target,['at','faction','tags','capacity','attributes','verbs'])&&W.worksites.target(target.at)&&
        (target.faction===undefined||id(target.faction))&&between(target.capacity??1,1,maxActive)&&
        (target.tags===undefined||Array.isArray(target.tags)&&target.tags.length<=64&&target.tags.every(id)),
        'Invalid interaction target '+name);
      const attributes=E.attributes(target.attributes??{}), bindings=new Map();
      for(const [verb,binding] of rows(target.verbs,128,'bindings')){
        check(definitions.has(verb)&&keys(binding,['changes','effect']),'Invalid interaction binding '+name+'/'+verb);
        const changes=E.changes(binding.changes??{},attributes);
        bindings.set(verb,{changes,effect:binding.effect});
        if(binding.effect?.action==='world/transfer')emits.add('transfer');
      }
      check(bindings.size>0,'Interaction target needs at least one verb '+name);
      offers.set(name,{...target,attributes,bindings,capacity:target.capacity??1});
    }

    function resolve(query,world,name,target,values){
      const agent=target.at.agent&&actorAt(query,target.at.agent);
      const frame=target.at.agent&&!agent?null:W.worksites.frame(query,target.at);
      const entity=target.at.entity, source=own(world.entities,entity)?world.entities[entity]:undefined;
      const faction=target.faction??(agent?read(agent,path):read(source,path));
      const subject=agent?{system:target.at.agent.system,id:agent.id,generation:agent.generation}:null;
      return {id:name,tags:target.tags??[],values,available:Boolean(frame),
        ...(frame&&{position:frame.point}),...(id(faction)&&{faction}),...(agent&&{agent:subject})};
    }

    function support(target,verb){
      check(offers.get(target)?.bindings.has(verb),'Unknown interaction offering '+target+'/'+verb);
    }
    function request(args,cancel=false){
      check(keys(args,cancel?['id','actor']:['id','actor','target','verb'])&&id(args.id)&&handle(args.actor),
        'Invalid targeted interaction request');
      if(!cancel)support(args.target,args.verb);
    }
    function offerAt(query,world,state,target,verb){
      const offer=offers.get(target);
      if(!offer?.bindings.has(verb))return null;
      const report=resolve(query,world,target,offer,state.values[target]);
      const {range,ticks}=definitions.get(verb);
      return {...report,verb,range,ticks};
    }
    function evaluate(query,world,state,job,locked){
      const {target,verb,actor}=job, subject=offerAt(query,world,state,target,verb), spec=definitions.get(verb);
      const row=actorAt(query,actor);
      if(!row)return {reason:'actor-unavailable'};
      const live={system:actor.system,id:row.id,generation:row.generation};
      if(!subject.available)return {reason:'target-unavailable',actor:live};
      if(locked!==undefined&&!sameLifetime(locked,subject.agent??null))
        return {reason:'target-replaced',actor:live,subject};
      const faction=read(row,path), {factions,relation}=spec.access;
      const permitted=!relation||id(faction)&&id(subject.faction)&&
        (relation==='same'?faction===subject.faction:faction!==subject.faction);
      if(!permitted||factions&&!factions.includes(faction))return {reason:'access-denied',actor:live,subject};
      if(!Q.condition(spec.actorWhen,row)||!Q.condition(spec.targetWhen,subject))
        return {reason:'ineligible',actor:live,subject};
      const distance=V.dist(row.position,subject.position);
      if(distance>spec.range+1e-8)return {reason:'out-of-range',actor:live,subject,distance};
      for(const rule of spec.requires??[]){
        const sample=query.probe(rule.field,rule.at==='actor'?row.position:subject.position,rule.args);
        if(sample.status!=='ok'||!Q.condition(rule.when,sample.value))
          return {reason:'requirement-unmet',field:rule.field,actor:live,subject,distance};
      }
      return {actor:live,subject,distance};
    }
    function checkFields(query){
      for(const source of sources)check(query.field(source),'Unknown interaction requirement field '+source);
    }

    const initial={values:Object.fromEntries([...offers].map(([name,offer])=>[name,
      Object.fromEntries(Object.entries(offer.attributes).map(([attribute,{initial}])=>[attribute,initial]))])),
      active:[],outcomes:[],commands:[]};

    function validateState(state){
      check(record(state)&&record(state.values)&&Object.keys(state.values).length===offers.size&&
        Array.isArray(state.active)&&state.active.length<=maxActive&&Array.isArray(state.outcomes)&&
        state.outcomes.length<=historyLimit&&Array.isArray(state.commands)&&state.commands.length===0,
        'Invalid saved targeted interaction state');
      for(const [name,offer] of offers){
        const values=own(state.values,name)&&state.values[name];
        check(record(values)&&Object.keys(values).length===Object.keys(offer.attributes).length&&
          Object.entries(offer.attributes).every(([key,{min=-Infinity,max=Infinity}])=>
            own(values,key)&&Number.isFinite(values[key])&&values[key]>=min&&values[key]<=max),
          'Invalid saved interaction attributes '+name);
      }
      const used=new Set(), actors=new Map(), seats=new Map();
      for(const attempt of state.active){
        check(record(attempt)&&validToken(attempt.id)&&!used.has(attempt.id)&&handle(attempt.actor)&&
          attempt.actor.generation!==undefined&&offers.get(attempt.target)?.bindings.has(attempt.verb)&&
          tick(attempt.started)&&between(attempt.due,attempt.started,20000000)&&
          attempt.due===attempt.started+definitions.get(attempt.verb).ticks&&
          (attempt.targetActor===null||handle(attempt.targetActor)&&attempt.targetActor.generation!==undefined)&&
          (attempt.order===undefined||validToken(attempt.order)),'Invalid saved active interaction');
        const key=attempt.actor.system+'/'+attempt.actor.id+'/'+attempt.actor.generation;
        const count=(seats.get(attempt.target)??0)+1;
        check(!actors.has(key)&&count<=offers.get(attempt.target).capacity,'Invalid saved interaction capacity');
        used.add(attempt.id);
        actors.set(key,true);
        seats.set(attempt.target,count);
      }
      for(const outcome of state.outcomes){
        check(record(outcome)&&validToken(outcome.id)&&!used.has(outcome.id)&&handle(outcome.actor)&&
          ['completed','rejected','cancelled','failed'].includes(outcome.status)&&tick(outcome.ended)&&
          (outcome.started===null||tick(outcome.started)&&outcome.started<=outcome.ended)&&
          (outcome.reason===null||id(outcome.reason))&&offers.get(outcome.target)?.bindings.has(outcome.verb),
          'Invalid saved interaction outcome');
        used.add(outcome.id);
      }
    }

    const field=read=>({type:'record',qualified:true,selector:true,read});
    const missing=()=>Q.missing('unknown interaction target or verb','missing');
    return {initial:()=>initial,checkFields,validateState,shareCheckpoint:true,contract:{emits:[...emits]},
      checkAction(key,args){
        request(args,key==='cancel');
      },
      actions:Object.fromEntries(['start','cancel'].map(key=>[key,(state,args)=>{
        check(state.commands.length<1024,'Interaction request budget exceeded');
        return {...state,commands:[...state.commands,{key,args}]};
      }])),
      fields:{
        target:field(({state,args,query,world})=>offers.has(args.target)?
          Q.ok(resolve(query,world,args.target,offers.get(args.target),state.values[args.target])):missing()),
        offering:field(({state,args,query,world})=>{
          const offer=offerAt(query,world,state,args.target,args.verb);
          return offer?Q.ok(offer):missing();
        }),
        check:field(({state,args,query,world})=>{
          if(!offers.get(args.target)?.bindings.has(args.verb))return missing();
          check(handle(args.actor),'Interaction check needs an actor handle');
          const result=evaluate(query,world,state,args);
          const reason=result.reason??capacityBlocker(state.active.some(job=>equalActor(job.actor,result.actor)),
            state.active.filter(job=>job.target===args.target).length,offers.get(args.target).capacity,
            state.active.length,maxActive);
          return Q.ok({...result,eligible:reason===null,reason});
        }),
        attempts:field(({state,args})=>{
          if(args.id===undefined)return Q.ok({active:state.active,outcomes:state.outcomes});
          const attempt=state.active.find(row=>row.id===args.id)??state.outcomes.find(row=>row.id===args.id);
          return attempt?Q.ok(attempt):Q.missing('unknown interaction attempt','missing');
        }),
        catalog:field(()=>Q.ok({
          verbs:Object.fromEntries(definitions),
          targets:Object.fromEntries([...offers].map(([key,{at,capacity,bindings}])=>[key,{at,capacity,verbs:[...bindings.keys()]}]))
        }))
      },
      targetedInteractions:{offers,definitions,maxActive,historyLimit,support,evaluate}
    };
  }

  W.runtime.register('targeted-interactions',build);
  W.targetedInteractions=Object.freeze({actorAt,equalActor,validToken,capacityBlocker});
})(KIT);
