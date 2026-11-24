/* Reusable interaction pieces composed at one durable publication boundary. */
(function(K){
  const W=K.world, {check,record,id,own,vector,copy,equal}=W.data, {freeze}=K.procedural.data;
  const named=new WeakSet(), modes=['world','held','docked'];
  const shape=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const tick=value=>Number.isSafeInteger(value)&&value>=0;
  const fraction=value=>Number.isFinite(value)&&value>=0&&value<=1;
  const limit=256;
  const identity=row=>shape(row,['id','generation'])&&id(row.id)&&(row.generation===null||tick(row.generation)&&row.generation>0);
  function owner(actor){
    const identity={id:actor?.id,generation:actor?.entityHandle?.generation??actor?.generation??null};
    return id(identity.id)&&(identity.generation===null||tick(identity.generation)&&identity.generation>0)?identity:null;
  }
  const keyFor=actor=>actor.id+(actor.generation===null?'':'@'+actor.generation);
  const nearby=(actor,site,range)=>vector(actor?.position)&&vector(site?.point)&&K.V.dist(actor.position,site.point)<=range;
  const mark=ctx=>ctx.actorId&&nearby(ctx.actor,ctx.site,ctx.range)?ctx.site:null;
  function definition(kind,{at,range=1,when}={},data){
    check((at===undefined||W.worksites.target(at))&&Number.isFinite(range)&&range>=0&&range<=128,
    'Invalid interaction component anchor or range');
    W.query.condition(when,{});
    const value=freeze({kind,...(at!==undefined&&{at:copy(at)}),range,
      ...(when!==undefined&&{when:copy(when)}),...data});
    named.add(value);
    return value;
  }
  function anchored(options){
    check(options?.at!==undefined,'This component needs a point or socket anchor');
    return options;
  }

  function trigger(options={}){
    W.spatialFields.checkBounds(options.bounds,3);
    const bounds=freeze(copy(options.bounds));
    return definition('trigger',options,{
      initial:{inside:[]},
      validate:state=>Array.isArray(state?.inside)&&state.inside.length<=limit&&
        state.inside.every(identity)&&new Set(state.inside.map(keyFor)).size===state.inside.length,
      actions:{sample({state,actor,actorId,args}){
        if(!actorId||args?.present!==false&&!vector(actor.position))return null;
        const present=args?.present!==false&&W.spatialFields.inside(actor.position,bounds);
        const index=state.inside.findIndex(row=>equal(actorId,row));
        if(present===(index>=0)||present&&state.inside.length>=limit)return null;
        return {state:{inside:present?[...state.inside,actorId]:state.inside.filter((_,i)=>i!==index)},
          cue:present?'trigger-entered':'trigger-left',detail:{inside:present,actor:actorId},
          ...(present&&{point:actor.position})};
      }}
    });
  }

  function handle(options={}){
    const {value=0}=options;
    check(fraction(value),'Handle values need to be in [0, 1]');
    return definition('handle',anchored(options),{
      initial:{holder:null,value},
      validate:state=>record(state)&&fraction(state.value)&&(state.holder===null||identity(state.holder)),
      actions:{
        grab(ctx){
          if(ctx.state.holder||!mark(ctx))return null;
          return {state:{...ctx.state,holder:ctx.actorId},cue:'handle-grabbed'};
        },
        move(ctx){
          const {state,actorId,args}=ctx;
          if(!actorId||!equal(state.holder,actorId)||!mark(ctx))return null;
          check(fraction(args?.value),'Handle values need to be in [0, 1]');
          if(state.value===args.value)return null;
          return {state:{...state,value:args.value},cue:'handle-moved',detail:{value:args.value}};
        },
        release({state,actorId}){
          if(!actorId||!equal(state.holder,actorId))return null;
          return {state:{...state,holder:null},cue:'handle-released'};
        }
      }
    });
  }

  function pickup(options={}){
    return definition('pickup',anchored(options),{
      initial:{mode:'world',point:null},
      validate(state){
        return record(state)&&modes.includes(state.mode)&&
          (state.mode==='world'?shape(state,['mode','point'])&&(state.point===null||vector(state.point)):
          state.mode==='held'?shape(state,['mode','owner'])&&identity(state.owner):
          shape(state,['mode','socket'])&&id(state.socket));
      },
      actions:{
        take({state,actor,actorId,site,range}){
          if(!actorId||state.mode!=='world')return null;
          const placement=state.point===null?site:{point:state.point};
          if(!nearby(actor,placement,range))return null;
          return {state:{mode:'held',owner:actorId},cue:'pickup-taken',point:placement.point};
        },
        drop({state,actor,actorId}){
          if(state.mode!=='held'||!equal(state.owner,actorId)||!vector(actor?.position))return null;
          return {state:{mode:'world',point:actor.position},cue:'pickup-dropped',point:actor.position};
        }
      }
    });
  }

  function socket(options={}){
    const {accepts}=options;
    check(accepts===undefined||Array.isArray(accepts)&&accepts.length>0&&accepts.length<=64&&
      accepts.every(id)&&new Set(accepts).size===accepts.length,'Socket accepts need distinct pickup names');
    return definition('socket',anchored(options),{
      ...(accepts!==undefined&&{accepts:accepts.slice()}),initial:{item:null},
      validate:state=>record(state)&&(state.item===null||id(state.item)),
      actions:{
        insert(ctx){
          const item=ctx.args?.item;
          if(!mark(ctx)||ctx.state.item!==null||!own(ctx.parts,item)||ctx.parts[item].kind!=='pickup'||
            accepts!==undefined&&!ctx.parts[ctx.name].accepts.includes(item))return null;
          const held=ctx.states[item];
          if(held.mode!=='held'||!equal(held.owner,ctx.actorId))return null;
          return {state:{item},peers:{[item]:{mode:'docked',socket:ctx.name}},cue:'socket-inserted',detail:{item}};
        },
        remove(ctx){
          const {item}=ctx.state;
          if(!mark(ctx)||item===null)return null;
          return {state:{item:null},peers:{[item]:{mode:'held',owner:ctx.actorId}},cue:'socket-removed',detail:{item}};
        }
      }
    });
  }

  function checkpoint(options={}){
    return definition('checkpoint',anchored(options),{
      initial:{actors:{}},
      validate:state=>record(state?.actors)&&Object.keys(state.actors).length<=limit&&
        Object.entries(state.actors).every(([key,row])=>record(row)&&identity(row.actor)&&key===keyFor(row.actor)&&
          tick(row.tick)&&vector(row.point)&&(row.rotation===null||K.anim.keyframeTrack.orientation(row.rotation))),
      actions:{
        activate(ctx){
          const site=mark(ctx);
          if(!site)return null;
          const key=keyFor(ctx.actorId), {actors}=ctx.state;
          if(!own(actors,key)&&Object.keys(actors).length>=limit)return null;
          const saved={actor:ctx.actorId,tick:ctx.tick,point:site.point,rotation:site.rotation??null};
          return {state:{actors:{...actors,[key]:saved}},cue:'checkpoint-activated',detail:saved};
        },
        respawn({state,actorId}){
          const key=actorId&&keyFor(actorId), saved=own(state.actors,key)&&state.actors[key];
          return saved?{state,cue:'checkpoint-respawn',detail:saved,point:saved.point}:null;
        }
      }
    });
  }

  function timedSwitch(options={}){
    const {ticks=60,onCue,offCue}=options;
    check(tick(ticks)&&ticks>0,'A timed switch needs a positive duration');
    const latch=W.interactions.latch({ticks,onCue,offCue});
    return definition('timed-switch',options,{initial:latch.initial,validate:latch.validate,
      actions:{
        press(ctx){return ctx.at===undefined||mark(ctx)?latch.actions.press(ctx):null;},
        reset:latch.actions.reset
      }
    });
  }

  function compose({id:name,point,components,routes=[],query:queryFor}={}){
    check(id(name)&&record(components)&&Object.keys(components).length>0&&Object.keys(components).length<=64&&
      (queryFor===undefined||typeof queryFor==='function')&&Array.isArray(routes)&&routes.length<=128,
    'Invalid interaction component assembly');
    const parts=Object.freeze({...components}), verbs=new Map(), edges=new Map();
    for(const [key,part] of Object.entries(parts)){
      check(id(key)&&named.has(part)&&(!part.accepts||part.accepts.every(item=>own(parts,item)&&parts[item].kind==='pickup')),
      'Invalid interaction component '+key);
      for(const [action,run] of Object.entries(part.actions)){
        const verb=key+'/'+action;
        verbs.set(verb,{name:key,part,action,run,timerOnly:part.kind==='timed-switch'&&action==='reset'});
        edges.set(verb,[]);
      }
    }
    for(const route of copy(routes)){
      check(shape(route,['from','to','when','args','required'])&&verbs.has(route.from)&&verbs.has(route.to)&&
        !verbs.get(route.from).timerOnly&&!verbs.get(route.to).timerOnly&&
        (route.required===undefined||typeof route.required==='boolean'),'Invalid interaction component route');
      W.query.condition(route.when,{});
      edges.get(route.from).push(freeze(route));
    }
    const done=new Set(), active=new Set();
    function visit(verb){
      if(done.has(verb))return;
      check(!active.has(verb),'Interaction component route cycle at '+verb);
      active.add(verb);
      for(const {to} of edges.get(verb))visit(to);
      active.delete(verb);done.add(verb);
    }
    for(const verb of verbs.keys())visit(verb);

    const initial=Object.fromEntries(Object.entries(parts).map(([key,part])=>[key,part.initial]));
    function validate(states){
      return record(states)&&Object.keys(states).length===Object.keys(parts).length&&
        Object.entries(parts).every(([name,part])=>{
          if(!own(states,name)||!part.validate(states[name]))return false;
          const row=states[name];
          if(part.kind==='pickup'&&row.mode==='docked')
            return own(parts,row.socket)&&parts[row.socket].kind==='socket'&&states[row.socket]?.item===name;
          if(part.kind==='socket'&&row.item!==null)
            return own(parts,row.item)&&parts[row.item].kind==='pickup'&&
              (!part.accepts||part.accepts.includes(row.item))&&states[row.item]?.mode==='docked'&&states[row.item].socket===name;
          return true;
        });
    }

    function frames(revision){
      let resolved=false, query;
      return at=>{
        if(at===undefined)return null;
        if(vector(at))return {point:at,rotation:null};
        if(!resolved){
          query=queryFor?queryFor(revision):typeof revision?.query==='function'?revision.query():revision?.query;
          if(typeof query?.then==='function'){
            Promise.resolve(query).catch(()=>{});
            throw Error('Interaction anchor query must be synchronous');
          }
          resolved=true;
        }
        const result=query&&W.worksites.frame(query,at);
        return vector(result?.point)?result:null;
      };
    }
    function frame(component,snapshot){
      const part=own(parts,component)&&parts[component], states=snapshot?.states?.[name];
      if(!part||!own(states,component))return null;
      const state=states[component];
      let at=part.at;
      if(part.kind==='pickup'){
        if(state.mode==='held')return null;
        if(state.mode==='world')at=state.point??at;
        if(state.mode==='docked')at=parts[state.socket]?.at;
      }
      const site=frames(snapshot.revision)(at);
      return site&&freeze(copy(site));
    }
    function handleAction(verb,context){
      const {state,actor,args,tick,timer,revision}=context, actorId=owner(actor);
      const states={...state}, timers={}, changes=[], completed=new Set(), frame=frames(revision);
      const queued=[{to:verb,args,required:true,timer}];
      for(const job of queued){
        if(completed.has(job.to))continue;
        const {name,part,action,run}=verbs.get(job.to), {at,range,when}=part;
        const localTimer=job.timer?.startsWith(name+'/')?job.timer.slice(name.length+1):null;
        const site=frame(at);
        const next=(localTimer||W.query.condition(when,{states,actor,args:job.args,tick}))&&
          run({name,part,parts,states,state:states[name],actor,actorId,args:job.args,tick,timer:localTimer,site,range,at});
        if(!next){if(job.required)return null;continue;}
        completed.add(job.to);
        states[name]=next.state;
        Object.assign(states,next.peers);
        for(const [key,rule] of Object.entries(next.timers??{}))
          timers[name+'/'+key]=rule===null?null:{...rule,action:name+'/'+rule.action};
        changes.push({component:name,action,cue:next.cue??null,detail:next.detail??null,
          point:next.point??site?.point??null});
        const scope={states,actor,detail:next.detail??null,tick};
        for(const link of edges.get(job.to))if(W.query.condition(link.when,scope))
          queued.push({to:link.to,args:own(link,'args')?link.args:job.args,required:link.required??true,timer:null});
      }
      const first=changes[0];
      return {state:states,timers,...(first.cue&&{cue:first.cue}),point:first.point??context.point,
        detail:{component:first.component,action:first.action,changes}};
    }
    return freeze({id:name,...(point!==undefined&&{point:copy(point)}),initial,validate,frame,
      actions:Object.fromEntries([...verbs.keys()].map(verb=>[verb,context=>handleAction(verb,context)]))});
  }

  W.interactionComponents=Object.freeze({compose,trigger,handle,pickup,socket,checkpoint,timedSwitch});
})(KIT);
