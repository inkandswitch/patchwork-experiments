/* Deterministic, checkpointable admission of walking route requests. */
(function(K){
  const W=K.world, {check,id,record,vector}=W.data;
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const priority=value=>integer(value,-1024,1024);
  const idle=Object.freeze({status:'idle'});
  const initial=Object.freeze({tick:0,served:Object.freeze([])});
  const same=(a,b)=>a&&b&&W.agentStorage.sameVector(a,b);
  const pending={status:'pending'};
  const kinds=['travel','activity'];
  const waiting=['waiting','safe-segment'];
  const statuses=['idle','ready','blocked','limited',...waiting];

  function order(a,b){
    const x=a.routing.request,y=b.routing.request;
    return (b.routePriority-y.tick)-(a.routePriority-x.tick)||x.tick-y.tick||(a.id<b.id?-1:a.id>b.id?1:0);
  }
  function create(options){
    check(record(options)&&Object.keys(options).every(key=>key==='maxRequestsPerTick'),'Invalid route queue settings');
    const {maxRequestsPerTick=16}=options;
    check(integer(maxRequestsPerTick,1,256),'Invalid route queue budget');

    function validateWork(work){
      check(record(work)&&integer(work.tick,0,10000000)&&Array.isArray(work.served)&&work.served.length<=maxRequestsPerTick&&
        work.served.every(row=>record(row)&&id(row.agent)&&integer(row.generation,1,Number.MAX_SAFE_INTEGER)&&
          kinds.includes(row.kind)&&id(row.status)), 'Invalid saved route queue work');
    }
    function validateAgent(agent){
      const state=agent.routing;
      check(priority(agent.routePriority)&&record(state)&&statuses.includes(state.status)&&
        (state.reason===undefined||id(state.reason)),'Invalid saved route status');
      const job=state.request;
      check(waiting.includes(state.status)?record(job)&&kinds.includes(job.kind)&&
        integer(job.tick,0,10000000)&&vector(job.to):job===undefined,'Invalid saved route request');
      if(state.rejected!==undefined)check(job?.kind==='activity'&&Array.isArray(state.rejected)&&state.rejected.length<=32&&
        state.rejected.every(row=>record(row)&&vector(row.to)&&id(row.status)),'Invalid saved activity routes');
    }
    function begin(rows,tick,previous,solve){
      const served=previous.tick===tick?previous.served.slice():[], answers=new Map();
      const available=maxRequestsPerTick-served.length;
      if(available){
        const already=new Set(served.map(row=>row.agent+'/'+row.generation));
        const requested=[...rows].filter(row=>row.routing.request.tick<tick&&!already.has(row.id+'/'+row.generation)).sort(order);
        for(const agent of requested.slice(0,available)){
          const job=agent.routing.request, answer=solve(agent,job);
          answers.set(agent.id,{...answer,job});
          served.push({agent:agent.id,generation:agent.generation,kind:job.kind,status:answer.result.status});
        }
      }
      return {work:{tick,served},session:agent=>session(agent,tick,answers.get(agent.id))};
    }
    function report(rows,work){
      return {maxRequestsPerTick,tick:work.tick,served:work.served,
        pending:[...rows].sort(order).map(({id,generation,routePriority,routing})=>
          ({agent:id,generation,priority:routePriority,status:routing.status,...routing.request}))};
    }
    return {begin,report,validateAgent,validateWork};
  }

  function session(agent,tick,answer){
    const previous=agent.routing.request;
    let request, rejected=agent.routing.rejected??[];
    function ask(kind,from,to){
      if(kind==='activity'){
        const past=rejected.find(row=>same(row.to,to));
        if(past)return past;
      }
      if(request)return pending;
      if(answer?.job.kind===kind&&same(answer.job.to,to)&&same(answer.from,from)){
        const {result}=answer;
        if(kind==='activity'&&result.status!=='ok')rejected=[...rejected,{to,status:result.status}];
        return result;
      }
      request=previous?.kind===kind&&same(previous.to,to)?previous:{kind,to,tick};
      return pending;
    }
    function finish(row,status,reason){
      const routing=request?{status:row.route[row.cursor]?'safe-segment':'waiting',request,
        ...(request.kind==='activity'&&rejected.length&&{rejected})}:{status,...(reason&&{reason})};
      return row===agent&&W.data.equal(routing,agent.routing)?agent:{...row,routing};
    }
    return {ask,finish,
      get active(){return Boolean(request);},
      target:previous?.kind==='travel'?previous.to:undefined};
  }

  W.routeRequests=Object.freeze({create,priority,idle,initial});
})(KIT);
