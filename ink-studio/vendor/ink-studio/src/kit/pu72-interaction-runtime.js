/* Resolve access, capacity and consequences at a single world commit boundary. */
(function(K){
  const W=K.world, E=W.targetedEffects, {check,endpoint}=W.data;
  const {actorAt,equalActor,capacityBlocker}=W.targetedInteractions;
  const ownerKey=ref=>ref.system+'/'+ref.id+'/'+ref.generation;
  const orderKey=(actor,sequence,step)=>ownerKey(actor)+'/'+sequence+'/'+step;

  function bind(plan){
    const {systems,chunks}=plan, services=new Map(), clients=[];
    for(const [name,provider] of Object.entries(systems)){
      if(provider.orderInteractions)clients.push([name,provider.orderInteractions]);
      const spec=provider.targetedInteractions;
      if(!spec)continue;
      check(!chunks?.managed.has(name),'Targeted interactions must run outside simulation chunks');
      const effects=new Map();
      for(const [target,{bindings}] of spec.offers)
        for(const [verb,rule] of bindings)effects.set(target+'/'+verb,E.compile(rule.effect,plan));
      services.set(name,{...spec,effects});
    }
    function checkOffering(path,target,verb){
      const [system,key]=endpoint(path), service=services.get(system);
      check(service&&key==='offering','Unknown targeted interaction service '+path);
      if(target!==undefined)service.support(target,verb);
    }
    for(const [,client] of clients)client.check(checkOffering);
    if(!services.size)return null;

    function run(states,ctx){
      const pending=new Map();
      let query;
      const snapshot=()=>query??=ctx.query();
      for(const [system,client] of clients){
        if(!ctx.detailed(system))continue;
        for(const {path,sequence,step,agent,generation,target,verb} of client.rows(states[system],{
          id:system,tick:ctx.tick,query:snapshot()
        })){
          const actor={system,id:agent,generation}, id=orderKey(actor,sequence,step), service=endpoint(path)[0];
          if(!pending.has(service))pending.set(service,new Map());
          pending.get(service).set(id,{id:id+'/'+ctx.tick,actor,target,verb,order:id,sequence,step,client});
        }
      }

      for(const [name,{definitions,offers,effects,maxActive,historyLimit,evaluate}] of services){
        const original=states[name], requests=pending.get(name)??new Map();
        if(!original.commands.length&&!original.active.length&&!requests.size)continue;
        let values=original.values, changed=false, outcomes=original.outcomes.slice();
        const active=new Map(original.active.map(job=>[job.id,job]));
        const actors=new Set(original.active.map(({actor})=>ownerKey(actor)));
        const occupied=new Map();
        const remembered=new Set(outcomes.map(row=>row.id));
        for(const {target} of active.values())occupied.set(target,(occupied.get(target)??0)+1);
        const emit=ctx.emit(name);
        function finish(job,status,reason,detail={}){
          const {id,actor,target,verb,started=null,order}=job;
          if(active.delete(id)){
            actors.delete(ownerKey(actor));
            occupied.set(target,occupied.get(target)-1);
          }
          const row={id,actor,target,verb,started,ended:ctx.tick,status,reason,...detail};
          outcomes.push(row);
          remembered.add(id);
          if(outcomes.length>historyLimit)remembered.delete(outcomes.shift().id);
          changed=true;
          const {id:attempt,...event}=row;
          const cause=emit('interaction-'+status,{attempt,...event});
          const request=order&&requests.get(order);
          if(request){
            const {client,sequence,step}=request;
            states[actor.system]=ctx.root(client.receive(states[actor.system],{actor,sequence,step},row,{
              id:actor.system,tick:ctx.tick,emit:ctx.emit(actor.system)
            }));
            query=undefined;
          }
          return cause;
        }
        function assess(job,locked){
          if(!ctx.detailed(job.actor.system))return {reason:'actor-unavailable'};
          const target=offers.get(job.target).at.agent;
          if(target&&!ctx.detailed(target.system))return {reason:'target-unavailable'};
          return evaluate(snapshot(),ctx.world,{values},job,locked);
        }
        function start(job){
          if(active.has(job.id)||remembered.has(job.id)){
            emit('interaction-denied',{attempt:job.id,actor:job.actor,reason:'duplicate-attempt'});
            return;
          }
          const {reason,actor=job.actor,subject,field}=assess(job);
          const key=ownerKey(actor), n=occupied.get(job.target)??0;
          const blocked=reason??capacityBlocker(actors.has(key),n,offers.get(job.target).capacity,active.size,maxActive);
          if(blocked){finish({...job,actor},'rejected',blocked,field?{field}:{});return;}
          const running={id:job.id,actor,target:job.target,verb:job.verb,started:ctx.tick,
            due:ctx.tick+definitions.get(job.verb).ticks,targetActor:subject.agent??null,...(job.order&&{order:job.order})};
          active.set(job.id,running);
          actors.add(key);
          occupied.set(job.target,n+1);
          changed=true;
          emit('interaction-started',{attempt:job.id,actor,target:job.target,verb:job.verb,due:running.due,at:subject.position});
        }
        function cancel(args){
          const job=active.get(args.id);
          const row=job&&actorAt(snapshot(),args.actor);
          if(!job||job.order||!row||!equalActor(job.actor,{system:args.actor.system,id:row.id,generation:row.generation})){
            emit('interaction-denied',{attempt:args.id,actor:args.actor,reason:'cancel-not-owner'});
            return;
          }
          finish(job,'cancelled','cancelled');
        }

        // Release interrupted orders before admitting new work this tick.
        for(const job of active.values())
          if(job.order&&!requests.has(job.order))finish(job,'cancelled','order-inactive');
        for(const {key,args} of original.commands){if(key==='start')start(args);else cancel(args);}
        const runningOrders=new Set([...active.values()].map(job=>job.order));
        for(const [order,job] of requests)if(!runningOrders.has(order))start(job);
        for(const job of active.values()){
          const {target,verb,started,due,targetActor}=job;
          if(started===ctx.tick&&due>ctx.tick)continue;
          const {reason,subject,field}=assess(job,targetActor);
          if(reason){
            finish(job,'failed',reason,field?{field}:{});
            continue;
          }
          if(due>ctx.tick)continue;
          const binding=offers.get(target), result=E.adjust(values[target],binding.attributes,binding.bindings.get(verb).changes);
          const effect=effects.get(target+'/'+verb);
          const settled=result.reason?result:effect?ctx.effect(name,effect,snapshot()):{};
          const {reason:failure,...detail}=settled;
          if(failure){finish(job,'failed',failure,detail);continue;}
          if(effect)query=undefined;
          if(Object.keys(result.applied).length){
            values={...values,[target]:result.values};
            states[name]=ctx.root({...original,values});
            query=undefined;
          }
          const cause=finish(job,'completed',null,{at:subject.position,changes:result.applied,...detail});
          if(effect?.kind==='input')ctx.input(effect.port,effect.value,cause);
          const cue=definitions.get(verb).cue;
          if(cue)emit(cue,{attempt:job.id,actor:job.actor,target,verb,at:subject.position,started});
        }
        if(changed||original.commands.length)
          states[name]=ctx.root({values,active:[...active.values()],outcomes,commands:[]});
      }
    }
    return {run};
  }

  W.interactionRuntime=Object.freeze({bind});
})(KIT);
