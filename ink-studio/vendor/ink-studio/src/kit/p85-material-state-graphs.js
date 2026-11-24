/* Retained material states resolved from a timed, ordered stream of scene events. */
(function (K) {
  const P=K.procedural,M=P.motion,
    name=s=>typeof s==='string'&&s.length>0&&s.length<=160,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  function materialStateGraph(machine,input,{
    time=0,maxChecks=1400000,maxEvents=20000
  }={}){
    if(!record(machine?.states)||!name(machine.initial)||!Array.isArray(machine.transitions)||
      machine.transitions.length>2048||!Array.isArray(input)||input.length>60000||
      !finite(time,-1e9,1e9)||!integer(maxChecks,1,20000000)||!integer(maxEvents,1,100000))
      throw new Error('Material state graphs need a machine, retained entities and bounded event controls');
    const names=Object.keys(machine.states);
    if(!names.length||names.length>2048||!names.every(name)||!Object.hasOwn(machine.states,machine.initial))
      throw new Error('Material graphs need unique named states and an initial state');
    const states=new Map(names.map(id=>{
      if(!record(machine.states[id]))throw new Error('Material state records must be objects');
      return [id,P.data.freeze(P.data.clone(machine.states[id]))];
    })), byEvent=new Map(),ruleIds=new Set();
    for(const entry of machine.transitions){
      const {id,from,to,event,minAge=0,priority=0,when,patch={}}=entry??{};
      if(!name(id)||ruleIds.has(id)||!states.has(from)||!states.has(to)||from===to||!name(event)||
        !finite(minAge,0,1e9)||!finite(priority,-100000,100000)||(when!==undefined&&typeof when!=='function')||
        !record(patch))throw new Error('Invalid material state transition');
      const value={id,to,minAge,priority,when,patch:P.data.freeze(P.data.clone(patch))},
        key=JSON.stringify([from,event]);
      if(!byEvent.has(key))byEvent.set(key,[]);
      byEvent.get(key).push(value);
      ruleIds.add(id);
    }
    for(const rules of byEvent.values())rules.sort((a,b)=>b.priority-a.priority||(a.id<b.id?-1:a.id>b.id?1:0));
    let entities=new Map();
    for(const entry of input){
      const {id,state=machine.initial,since=time,revision=0,data={}}=entry??{};
      if(!name(id)||entities.has(id)||!states.has(state)||!finite(since,-1e9,time)||!integer(revision,0,Number.MAX_SAFE_INTEGER)||
        !record(data))throw new Error('Material identities, states, times and data must be valid');
      entities.set(id,P.data.freeze({id,state,since,revision,data:P.data.clone(data)}));
    }
    function view(current){
      return P.data.freeze({...current,material:states.get(current.state)});
    }
    function snapshot(){
      return P.data.freeze({time,entities:[...entities.values()].map(view)});
    }
    function advance(until,input=[]){
      if(!finite(until,time,1e9)||!Array.isArray(input)||input.length>maxEvents)
        throw new Error('Material events must fit a bounded forward time interval');
      const events=Array.from(input,(raw,i)=>{
        const {at=until,type,target,payload={}}=raw??{},
          recipients=target===undefined?null:Array.isArray(target)?target.slice():[target];
        if(!finite(at,time,until)||!name(type)||(recipients&&(
          recipients.length>entities.size||new Set(recipients).size!==recipients.length||recipients.some(id=>!entities.has(id)))))
          throw new Error('Material events need a valid time, name and target');
        return {index:i,at,type,recipients,payload:P.data.freeze(P.data.clone(payload))};
      }).sort((a,b)=>a.at-b.at||a.index-b.index), draft=new Map(entities), changes=[];
      let checks=0;
      for(const e of events){
        for(const id of e.recipients??draft.keys()){
          if(checks>=maxChecks)throw new Error('Material graph exceeds its event dispatch budget');
          checks++;
          const before=draft.get(id),options=byEvent.get(JSON.stringify([before.state,e.type]));
          if(!options)continue;
          const context=Object.freeze({at:e.at,type:e.type,payload:e.payload,age:e.at-before.since,entity:view(before)});
          for(const transition of options){
            if(checks>=maxChecks)throw new Error('Material graph exceeds its transition budget');
            checks++;
            const {minAge,when,to,patch,id:rule}=transition;
            if(context.age<minAge||(when&&!when(context)))continue;
            if(before.revision===Number.MAX_SAFE_INTEGER)throw new Error('Material entity revision exceeds its range');
            const data=P.data.merge(before.data,patch),
              next=P.data.freeze({id,state:to,since:e.at,revision:before.revision+1,data});
            draft.set(id,next);
            changes.push({id,from:before.state,to,at:e.at,type:e.type,rule,revision:next.revision});
            break;
          }
        }
      }
      entities=draft;time=until;
      return P.data.freeze({...snapshot(),changes,work:{checks,events:events.length}});
    }
    const get=id=>entities.has(id)?view(entities.get(id)):null;
    const dispatch=(type,{at=time,target,payload}={})=>advance(at,[{type,at,target,payload}]);
    return Object.freeze({snapshot,advance,dispatch,get});
  }
  M.materialStateGraph=materialStateGraph;
})(KIT);
