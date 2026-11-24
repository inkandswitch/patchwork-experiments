/* Fixed-step gameplay clocks, objectives, and conditional state transitions. */
(function(K){
  const W=K.world, Q=W.query, {check,id,own,record,vector}=W.data;
  const {freeze}=K.procedural.data, maxTick=W.runtime.maxTick;
  const empty=Object.freeze([]), maxPending=1024;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const timerOps=['start','pause','resume','reset'];
  const objectiveOps=['activate','advance','complete','fail','reset'];
  const inputTypes=['bool','number','event','record','vec3'];

  function table(raw,limit,label){
    check(record(raw)&&Object.keys(raw).length<=limit&&Object.keys(raw).every(name=>id(name)&&name.length<=64),
      'Invalid gameplay '+label);
    return Object.keys(raw).sort().map(name=>[name,raw[name]]);
  }
  function gameplay(config){
    check(keys(config,['inputs','timers','objectives','states','initial']),'Invalid gameplay settings');
    const inputs={signals:'event'}, outputs={events:'event',state:'record'}, probes=new Set();
    for(const [name,raw] of table(config.inputs??{},64,'inputs')){
      check(!own(inputs,name)&&(typeof raw==='string'?inputTypes.includes(raw):
        keys(raw,['type','default'])&&inputTypes.includes(raw.type)),'Invalid gameplay input '+name);
      inputs[name]=raw;
    }
    const timers=new Map(table(config.timers??{},64,'timers'));
    const objectives=new Map(table(config.objectives??{},64,'objectives'));
    const states=new Map(table(config.states??{idle:{}},64,'states'));
    const initialState=config.initial??'idle';
    check(states.has(initialState),'Unknown initial gameplay state '+initialState);

    function operation(kind,args){
      if(kind==='signal'){
        check(keys(args,['kind','detail'])&&id(args.kind)&&record(args.detail??{}),'Invalid gameplay signal');
        return {kind,event:{kind:args.kind,detail:args.detail??{}}};
      }
      if(kind==='timer'){
        check(keys(args,['timer','op'])&&timers.has(args.timer)&&timerOps.includes(args.op),'Invalid gameplay timer operation');
        return {kind,name:args.timer,op:args.op};
      }
      check(kind==='objective'&&keys(args,['objective','op','amount'])&&objectives.has(args.objective)&&
        objectiveOps.includes(args.op)&&(args.amount===undefined||args.op==='advance'&&integer(args.amount,1,1e9)),
      'Invalid gameplay objective operation');
      return {kind,name:args.objective,op:args.op,...(args.op==='advance'&&{amount:args.amount??1})};
    }

    let conditionCount=0;
    function condition(rule,depth=0){
      check(record(rule)&&depth<=16&&++conditionCount<=4096,'Invalid gameplay condition or condition budget exceeded');
      for(const key of ['all','any']){
        if(!own(rule,key))continue;
        check(keys(rule,[key])&&Array.isArray(rule[key])&&integer(rule[key].length,1,64),'Invalid gameplay '+key+' condition');
        const rules=rule[key].map(part=>condition(part,depth+1));
        return key==='all'?ctx=>rules.every(test=>test(ctx)):ctx=>rules.some(test=>test(ctx));
      }
      if(own(rule,'not')){
        check(keys(rule,['not']),'Invalid gameplay not condition');
        const test=condition(rule.not,depth+1);
        return ctx=>!test(ctx);
      }
      if(own(rule,'state')){
        check(keys(rule,['state'])&&states.has(rule.state),'Unknown state in gameplay condition');
        return ctx=>ctx.state.phase===rule.state;
      }
      const {when}=rule;
      Q.condition(when,{});
      if(own(rule,'input')){
        check(keys(rule,['input','when'])&&own(inputs,rule.input),'Unknown gameplay condition input');
        return ctx=>when===undefined?ctx.input[rule.input]===true:Q.condition(when,ctx.input[rule.input]);
      }
      if(own(rule,'event')){
        check(keys(rule,['event','when'])&&id(rule.event),'Invalid gameplay event match');
        return ctx=>(ctx.signals.get(rule.event)??empty).some(event=>Q.condition(when,event));
      }
      if(own(rule,'timer')){
        check(keys(rule,['timer','when'])&&timers.has(rule.timer),'Unknown gameplay condition timer');
        return ctx=>when===undefined?ctx.state.timers[rule.timer].status==='expired':
          Q.condition(when,timerView(rule.timer,ctx.state.timers[rule.timer],ctx.tick));
      }
      if(own(rule,'objective')){
        check(keys(rule,['objective','when'])&&objectives.has(rule.objective),'Unknown gameplay condition objective');
        return ctx=>when===undefined?ctx.state.objectives[rule.objective].status==='completed':
          Q.condition(when,objectiveView(rule.objective,ctx.state.objectives[rule.objective]));
      }
      check(keys(rule,['probe','at','args','when'])&&typeof rule.probe==='string'&&rule.probe.length>0&&
        rule.probe.length<=193&&(rule.at===undefined||record(rule.at)||vector(rule.at))&&record(rule.args??{}),
      'Invalid gameplay probe condition');
      probes.add(rule.probe);
      return ctx=>{
        const result=ctx.query.probe(rule.probe,rule.at??{},rule.args);
        return result.status==='ok'&&Q.condition(when,result.value);
      };
    }

    for(const [name,row] of timers){
      check(keys(row,['ticks','start'])&&integer(row.ticks,1,maxTick)&&typeof (row.start??false)==='boolean',
        'Invalid gameplay timer '+name);
      outputs['timer.'+name+'.remaining']='number';
      outputs['timer.'+name+'.expired']='bool';
    }
    for(const [name,row] of objectives){
      check(keys(row,['active','target','complete','fail'])&&typeof (row.active??true)==='boolean'&&
        integer(row.target??1,1,1e9),'Invalid gameplay objective '+name);
      objectives.set(name,{active:row.active??true,target:row.target??1,
        complete:row.complete===undefined?null:condition(row.complete),fail:row.fail===undefined?null:condition(row.fail)});
      outputs['objective.'+name+'.progress']='number';
      outputs['objective.'+name+'.completed']='bool';
      outputs['objective.'+name+'.failed']='bool';
    }
    for(const [name,row] of states){
      check(keys(row,['enter','transitions'])&&Array.isArray(row.enter??[])&&(row.enter??[]).length<=32&&
        Array.isArray(row.transitions??[])&&(row.transitions??[]).length<=64,'Invalid gameplay state '+name);
      const enter=(row.enter??[]).map(effect=>{
        check(record(effect)&&typeof effect.kind==='string'&&effect.kind!=='signal','Invalid gameplay entry operation');
        const {kind,...args}=effect;
        return operation(kind,args);
      });
      const transitions=(row.transitions??[]).map(edge=>{
        check(keys(edge,['to','when'])&&states.has(edge.to)&&edge.to!==name,'Invalid gameplay transition from '+name);
        return {to:edge.to,test:condition(edge.when)};
      });
      states.set(name,{enter,transitions});
      outputs['state.'+name]='bool';
    }

    const idle=()=>({status:'idle'});
    const running=(name,tick)=>({status:'running',due:tick+timers.get(name).ticks});
    const objectiveInitial=name=>({status:objectives.get(name).active?'active':'inactive',progress:0});
    function timerView(name,row,tick){
      const {ticks}=timers.get(name);
      const remaining=row.status==='running'?Math.max(0,row.due-tick):
        row.status==='paused'?row.remaining:row.status==='expired'?0:ticks;
      return {...row,ticks,remaining};
    }
    const objectiveView=(name,row)=>({...row,target:objectives.get(name).target});

    function timerChange(row,{name,op},tick){
      switch(op){
        case 'start': return running(name,tick);
        case 'reset': return idle();
        case 'pause': return row.status==='running'?{status:'paused',remaining:row.due-tick}:row;
        case 'resume': return row.status==='paused'?{status:'running',due:tick+row.remaining}:row;
      }
    }
    function objectiveChange(row,{name,op,amount}){
      if(op==='reset')return objectiveInitial(name);
      if(op==='activate')return row.status==='inactive'?{...row,status:'active'}:row;
      if(row.status!=='active')return row;
      const {target}=objectives.get(name);
      if(op==='complete')return {status:'completed',progress:target};
      if(op==='fail')return {...row,status:'failed'};
      const progress=Math.min(target,row.progress+amount);
      return {status:progress===target?'completed':'active',progress};
    }
    function apply(state,op,tick,emit){
      const {kind,name}=op;
      const rows=kind==='timer'?state.timers:state.objectives, old=rows[name];
      const next=kind==='timer'?timerChange(old,op,tick):objectiveChange(old,op);
      if(W.data.equal(old,next))return;
      rows[name]=next;
      if(kind==='timer')emit('gameplay-timer-changed',{timer:name,op:op.op,from:old.status,
        ...timerView(name,next,tick),atTick:tick});
      else emit('gameplay-objective-changed',{objective:name,op:op.op,from:old.status,
        ...objectiveView(name,next),atTick:tick});
    }
    function initial(){
      const state={phase:initialState,entered:0,previous:null,
        timers:Object.fromEntries([...timers].map(([name,spec])=>[name,spec.start?running(name,0):idle()])),
        objectives:Object.fromEntries([...objectives.keys()].map(name=>[name,objectiveInitial(name)])),pending:empty,events:empty};
      for(const op of states.get(initialState).enter)apply(state,op,0,()=>{});
      return state;
    }
    function step(previous,ctx){
      const state={...previous,timers:{...previous.timers},objectives:{...previous.objectives},pending:empty,events:[]};
      const {tick,input,query}=ctx, signals=new Map();
      function emit(kind,detail){
        ctx.emit(kind,detail);
        state.events.push({kind,...detail,tick});
      }
      function signal(event){
        if(!record(event)||!id(event.kind))return;
        if(!signals.has(event.kind))signals.set(event.kind,[]);
        signals.get(event.kind).push(event);
      }
      function expire(at){
        for(const [name,row] of Object.entries(state.timers)){
          if(row.status!=='running'||row.due>at)continue;
          state.timers[name]={status:'expired',due:row.due};
          emit('gameplay-timer-expired',{timer:name,deadline:row.due});
        }
      }
      for(const {at,op} of previous.pending){
        expire(at);
        if(op.kind==='signal'){
          signal(op.event);
          emit('gameplay-signal',{name:op.event.kind,detail:op.event.detail,atTick:at});
        }else apply(state,op,at,emit);
      }
      expire(tick);
      for(const event of input.signals)signal(event);
      const context={state,input,query,signals,tick}, changes=[];
      for(const [name,spec] of objectives){
        if(state.objectives[name].status!=='active')continue;
        const op=spec.fail?.(context)?'fail':spec.complete?.(context)?'complete':null;
        if(op)changes.push({kind:'objective',name,op});
      }
      for(const op of changes)apply(state,op,tick,emit);
      const next=states.get(state.phase).transitions.find(edge=>edge.test(context));
      if(next){
        const from=state.phase;
        state.previous=from;
        state.phase=next.to;
        state.entered=tick;
        emit('gameplay-state-changed',{from,to:state.phase});
        for(const op of states.get(state.phase).enter)apply(state,op,tick,emit);
      }
      return state;
    }

    function validateState(state){
      const exact=(bag,defs)=>record(bag)&&Object.keys(bag).length===defs.size&&[...defs.keys()].every(name=>own(bag,name));
      check(record(state)&&states.has(state.phase)&&integer(state.entered,0,maxTick)&&
        (state.previous===null?state.phase===initialState&&state.entered===0:
          states.get(state.previous)?.transitions.some(edge=>edge.to===state.phase)&&integer(state.entered,1,maxTick))&&
        exact(state.timers,timers)&&exact(state.objectives,objectives)&&Array.isArray(state.pending)&&
        state.pending.length<=maxPending&&Array.isArray(state.events)&&state.events.length<=10000,'Invalid saved gameplay state');
      for(const [name,row] of Object.entries(state.timers)){
        const duration=timers.get(name).ticks;
        check(record(row)&&(row.status==='idle'&&keys(row,['status'])||
          ['running','expired'].includes(row.status)&&keys(row,['status','due'])&&integer(row.due,1,2*maxTick)||
          row.status==='paused'&&keys(row,['status','remaining'])&&integer(row.remaining,1,duration)),
        'Invalid saved gameplay timer '+name);
      }
      for(const [name,row] of Object.entries(state.objectives)){
        const {target}=objectives.get(name);
        check(keys(row,['status','progress'])&&['inactive','active','completed','failed'].includes(row.status)&&
          integer(row.progress,0,target)&&(row.status==='completed')===(row.progress===target)&&
          (row.status!=='inactive'||row.progress===0),'Invalid saved gameplay objective '+name);
      }
      for(const [index,item] of state.pending.entries()){
        const {at,op}=item;
        check(keys(item,['at','op'])&&integer(at,state.pending[index-1]?.at??1,maxTick)&&record(op),'Invalid pending gameplay action');
        if(op.kind==='signal')check(W.data.equal(operation('signal',op.event),op),'Invalid saved gameplay signal');
        else{
          const args={[op.kind]:op.name,op:op.op,...(op.amount!==undefined&&{amount:op.amount})};
          check(W.data.equal(operation(op.kind,args),op),'Invalid saved gameplay action');
        }
      }
      for(const row of state.events)
        check(record(row)&&id(row.kind)&&integer(row.tick,1,maxTick),'Invalid saved gameplay event');
    }
    const phase=state=>({id:state.phase,previous:state.previous,enteredTick:state.entered});
    function output(state,ctx){
      const values={state:phase(state),events:state.events};
      for(const name of states.keys())values['state.'+name]=state.phase===name;
      for(const [name,row] of Object.entries(state.timers)){
        values['timer.'+name+'.remaining']=timerView(name,row,ctx.tick).remaining;
        values['timer.'+name+'.expired']=row.status==='expired';
      }
      for(const [name,row] of Object.entries(state.objectives)){
        values['objective.'+name+'.progress']=row.progress;
        values['objective.'+name+'.completed']=row.status==='completed';
        values['objective.'+name+'.failed']=row.status==='failed';
      }
      return values;
    }
    function report(state,tick){
      return {state:phase(state),timers:Object.fromEntries(Object.entries(state.timers).map(([name,row])=>[name,timerView(name,row,tick)])),
        objectives:Object.fromEntries(Object.entries(state.objectives).map(([name,row])=>[name,objectiveView(name,row)])),
        pending:state.pending.length,events:state.events};
    }
    return {initial,step,inputs,outputs,output,validateState,shareCheckpoint:true,
      ...(probes.size&&{checkFields(query){
        for(const field of probes)check(query.field(field),'Unknown gameplay probe field '+field);
      }}),
      checkAction(type,args){operation(type,args);},
      actions:Object.fromEntries(['timer','objective','signal'].map(type=>[type,(state,args,ctx)=>{
        check(state.pending.length<maxPending,'Gameplay action queue exceeds its budget');
        return {...state,pending:[...state.pending,{at:ctx.tick,op:operation(type,args)}]};
      }])),
      fields:{status:{type:'record',qualified:true,read:({state,tick})=>Q.ok(report(state,tick))}}};
  }
  W.runtime.register('gameplay',gameplay);
})(KIT);
