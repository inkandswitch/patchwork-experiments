/* Deterministic reservations over named capacity and single-use jobs. */
(function(K){
  const W=K.world, Q=W.query, {check,id,record,own,vector}=W.data;
  const {freeze}=K.procedural.data;
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const tick=n=>integer(n,0,10000000);
  const positive=n=>integer(n,1,Number.MAX_SAFE_INTEGER);
  const capacity=n=>integer(n,1,65536);
  const keys=(obj,allowed)=>record(obj)&&Object.keys(obj).every(key=>allowed.includes(key));
  const at=value=>vector(value)||keys(value,['entity','socket'])&&id(value.entity)&&
    (value.socket===undefined||id(value.socket));
  const ownerOK=owner=>record(owner)&&id(owner.system)&&id(owner.agent)&&positive(owner.generation)&&positive(owner.sequence);
  const token=owner=>owner.system+'/'+owner.generation+'/'+owner.sequence;
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const byAge=(a,b)=>a.since-b.since||compare(a.owner.system,b.owner.system)||
    compare(a.owner.agent,b.owner.agent)||a.owner.generation-b.owner.generation||a.owner.sequence-b.owner.sequence;
  const selected=entry=>Boolean(entry.grants.length);
  const phases=['waiting','held','paused','failed'];
  const jobsLimit=4096;

  function checkSpec(spec){
    check(keys(spec,['board','require'])&&id(spec.board)&&record(spec.require)&&
      integer(Object.keys(spec.require).length,1,8),'Invalid order reservation');
    for(const [name,need] of Object.entries(spec.require)){
      check(id(name)&&keys(need,['anyOf','job','units'])&&own(need,'anyOf')!==own(need,'job')&&
        (need.units===undefined||capacity(need.units)),'Invalid reservation requirement '+name);
      if(own(need,'job')){
        check((need.job===true||record(need.job))&&(need.units===undefined||need.units===1),'Invalid job filter '+name);
        if(need.job!==true)Q.condition(need.job,null);
      }else{
        const list=need.anyOf;
        check(Array.isArray(list)&&integer(list.length,1,32)&&list.every(id)&&new Set(list).size===list.length,
          'Invalid reservation candidates '+name);
      }
    }
  }

  function board(config){
    const {pools:poolSpecs={},jobs:jobSpecs={}}=config;
    check(keys(config,['pools','jobs'])&&record(poolSpecs)&&record(jobSpecs)&&
      Object.keys(poolSpecs).length<=jobsLimit&&Object.keys(jobSpecs).length<=jobsLimit,'Invalid reservation board');
    const catalogItem=spec=>(spec.at===undefined||at(spec.at))&&
      (spec.metadata===undefined||record(spec.metadata))&&(spec.leaseTicks===undefined||capacity(spec.leaseTicks));
    const jobOK=spec=>keys(spec,['at','metadata','leaseTicks','expires'])&&catalogItem(spec)&&
      (spec.expires===undefined||tick(spec.expires)&&spec.expires>0);
    const pools=freeze(Object.fromEntries(Object.entries(poolSpecs).map(([name,spec])=>{
      check(id(name)&&keys(spec,['capacity','at','metadata','leaseTicks'])&&capacity(spec.capacity)&&catalogItem(spec),
        'Invalid reservation pool '+name);
      return [name,{...spec,id:name,kind:'pool',revision:0}];
    })));
    let serial=0;
    const makeJob=(name,spec,revision,posted)=>({...spec,id:name,kind:'job',capacity:1,revision,posted,status:'open'});
    const jobs=Object.fromEntries(Object.keys(jobSpecs).sort().map(name=>{
      check(id(name)&&!own(pools,name)&&jobOK(jobSpecs[name]),'Invalid reservation job '+name);
      return [name,makeJob(name,jobSpecs[name],++serial,0)];
    }));
    const initial=freeze({serial,jobs,sessions:{}});
    const lookup=(jobs,name)=>own(pools,name)?pools[name]:own(jobs,name)?jobs[name]:null;
    const stats=new WeakMap();
    function used(sessions){
      const result=new Map();
      for(const entry of Object.values(sessions))if(entry.status==='held')
        for(const {pool,units} of entry.grants)result.set(pool,(result.get(pool)??0)+units);
      return result;
    }
    function summary(state,entry){
      if(!stats.has(state))stats.set(state,used(state.sessions));
      const reserved=stats.get(state).get(entry.id)??0;
      return {...entry,reserved,available:entry.status&&entry.status!=='open'?0:entry.capacity-reserved};
    }
    function table(label,bucket){
      return {type:'record',qualified:true,selector:true,read({state,args,target}){
        const rows=bucket(state), name=args[label]??target?.entity;
        if(name!==undefined)return own(rows,name)?Q.ok(summary(state,rows[name])):Q.missing('Unknown '+label,'missing');
        return Q.ok(Object.fromEntries(Object.entries(rows).flatMap(([key,entry])=>{
          const row=summary(state,entry);
          return Q.condition(args.where,row)?[[key,row]]:[];
        })));
      }};
    }
    function checkAction(action,args){
      check(id(args.job)&&!own(pools,args.job),'Invalid job ID');
      if(action==='withdraw-job')check(keys(args,['job']),'Invalid job withdrawal');
      else {
        const {job,...spec}=args;
        check(jobOK(spec),'Invalid posted job '+job);
      }
    }

    function validateState(state){
      check(keys(state,['serial','jobs','sessions'])&&integer(state.serial,0,Number.MAX_SAFE_INTEGER)&&
        record(state.jobs)&&Object.keys(state.jobs).length<=jobsLimit&&record(state.sessions),'Invalid saved reservations');
      const revisions=new Set();
      for(const [name,row] of Object.entries(state.jobs)){
        check(record(row),'Invalid saved job '+name);
        const {id:key,kind,capacity,revision,posted,status,closed,completedBy,...spec}=row;
        check(id(name)&&key===name&&!own(pools,name)&&kind==='job'&&capacity===1&&jobOK(spec)&&
          integer(revision,1,state.serial)&&!revisions.has(revision)&&tick(posted)&&
          (status==='open'?closed===undefined:['completed','expired'].includes(status)&&tick(closed)&&closed>=posted)&&
          (status==='completed'?ownerOK(completedBy):completedBy===undefined)&&
          (spec.expires===undefined||spec.expires>posted),'Invalid saved job '+name);
        revisions.add(revision);
      }
      for(const [key,row] of Object.entries(state.sessions)){
        check(record(row)&&ownerOK(row.owner)&&key===token(row.owner)&&tick(row.since)&&phases.includes(row.status)&&
          (row.reason===null||id(row.reason))&&(row.until===null||positive(row.until))&&
          (row.status==='held'||row.until===null)&&Array.isArray(row.grants)&&row.grants.length<=8&&
          (row.status!=='held'||selected(row)),'Invalid saved reservation '+key);
        const grants=new Set();
        for(const grant of row.grants){
          check(keys(grant,['claim','pool','revision','units','at'])&&id(grant.claim)&&id(grant.pool)&&
            !grants.has(grant.claim)&&integer(grant.revision,0,state.serial)&&capacity(grant.units)&&
            (grant.at===undefined||at(grant.at)),'Invalid saved reservation grant '+key);
          grants.add(grant.claim);
          if(row.status==='held'){
            const entry=lookup(state.jobs,grant.pool);
            check(entry&&entry.revision===grant.revision&&(!entry.status||entry.status==='open')&&
              W.data.equal(grant.at,entry.at),'Invalid held reservation '+key);
          }
        }
      }
      for(const [name,total] of used(state.sessions))
        check(total<=lookup(state.jobs,name).capacity,'Saved reservations exceed capacity for '+name);
    }

    function reconcile(previous,requests,ctx,outcome,allocate){
      const {tick,emit}=ctx;
      let jobs=previous.jobs, dirty=false;
      const sessions={};
      function updateJob(entry,status,completedBy){
        if(jobs===previous.jobs)jobs={...jobs};
        jobs[entry.id]={...entry,status,closed:tick,...(completedBy&&{completedBy})};
        emit('job-'+status,{job:entry.id,revision:entry.revision,...(completedBy&&{completedBy})});
      }
      if(allocate)for(const entry of Object.values(jobs))
        if(entry.status==='open'&&entry.expires!==undefined&&tick>=entry.expires)updateJob(entry,'expired');
      const get=name=>lookup(jobs,name);
      const event=(kind,row,reason)=>emit('reservation-'+kind,{...row.owner,grants:row.grants,reason,
        ...(row.until!==null&&{until:row.until})});
      function change(row,status,reason,changes={}){
        if(row.status===status&&row.reason===reason&&!Object.keys(changes).length)return row;
        dirty=true;
        return {...row,status,reason,until:null,...changes};
      }
      function unusable(grant){
        const entry=get(grant.pool);
        if(!entry||entry.revision!==grant.revision)return 'reservation-withdrawn';
        if(entry.status==='expired')return 'reservation-expired';
        if(entry.status==='completed')return 'job-completed';
      }
      for(const [key,entry] of Object.entries(previous.sessions)){
        const request=requests.get(key);
        let row=entry;
        if(!request){
          dirty=true;
          if(row.status==='held'){
            const result=outcome(row.owner), success=result?.phase==='succeeded';
            if(success)for(const grant of row.grants){
              const item=get(grant.pool);
              if(item?.kind==='job'&&item.revision===grant.revision&&item.status==='open')updateJob(item,'completed',row.owner);
            }
            event('released',row,result?.reason??result?.phase??'owner-gone');
          }
          continue;
        }
        if(row.status!=='failed'){
          if(request.paused){
            if(row.status==='held')event('released',row,'interrupted');
            row=change(row,'paused',null);
          }else if(allocate){
            if(row.status==='paused')row=change(row,'waiting','pending',{since:tick});
            if(row.status==='held'){
              const reason=row.grants.map(unusable).find(Boolean)??
                (row.until!==null&&tick>=row.until?'reservation-expired':null);
              if(reason){
                event('released',row,reason);
                row=change(row,'failed',reason);
              }
            }
          }
        }
        sessions[key]=row;
      }
      if(!allocate)return dirty||jobs!==previous.jobs?freeze({...previous,jobs,sessions}):previous;

      for(const [key,request] of requests)if(!own(sessions,key)){
        sessions[key]={owner:request.owner,since:tick,status:request.paused?'paused':'waiting',
          reason:request.paused?null:'pending',until:null,grants:[]};
        dirty=true;
      }
      const remaining=used(sessions);
      const openJobs=Object.values(jobs).filter(entry=>entry.status==='open')
        .sort((a,b)=>a.revision-b.revision);
      const waiting=Object.values(sessions).filter(row=>row.status==='waiting'&&requests.get(token(row.owner)).eligible);
      waiting.sort(byAge);
      for(const row of waiting){
        const key=token(row.owner), spec=requests.get(key).spec;
        let groups, reason;
        if(selected(row)){
          reason=row.grants.map(unusable).find(Boolean);
          groups=row.grants.map(({claim,pool,units})=>({claim,units,options:[get(pool)]}));
        }else{
          groups=Object.entries(spec.require).map(([claim,need])=>({
            claim,units:need.units??1,
            options:need.anyOf?need.anyOf.map(get):openJobs.filter(entry=>need.job===true||Q.condition(need.job,entry))
          }));
          for(const {options} of groups)if(options.length&&options.every(item=>item&&['completed','expired'].includes(item.status))){
            reason=options.every(item=>item.status==='completed')?'job-completed':'reservation-expired';
            break;
          }
        }
        if(reason){
          event('failed',row,reason);
          sessions[key]=change(row,'failed',reason);
          continue;
        }

        const choices=groups.map(({claim,units,options},index)=>({claim,units,index,options:options.filter(item=>
          item&&(!item.status||item.status==='open')&&item.capacity>=units)}));
        if(choices.some(group=>!group.options.length)){
          sessions[key]=change(row,'waiting','not-offered');
          continue;
        }
        const assignments=[], trial=new Map();
        let budget=4096;
        // Search whole bundles, trying the most constrained claims first.
        choices.sort((a,b)=>a.options.length-b.options.length||a.index-b.index);
        function match(i){
          if(i===choices.length)return true;
          const {index,units,options}=choices[i];
          for(const item of options){
            if(--budget<0)return false;
            const count=trial.get(item.id)??0;
            if(item.capacity<(remaining.get(item.id)??0)+count+units)continue;
            trial.set(item.id,count+units);
            assignments[index]=item;
            if(match(i+1))return true;
            trial.set(item.id,count);
          }
          return false;
        }
        if(!match(0)){
          sessions[key]=change(row,'waiting',budget<0?'matching-budget':'capacity');
          continue;
        }
        let expiry=Infinity;
        const grants=groups.map(({claim,units},i)=>{
          const item=assignments[i];
          remaining.set(item.id,(remaining.get(item.id)??0)+units);
          expiry=Math.min(expiry,item.expires??Infinity,item.leaseTicks===undefined?Infinity:tick+item.leaseTicks);
          return {claim,pool:item.id,units,revision:item.revision,...(item.at!==undefined&&{at:item.at})};
        });
        const next=change(row,'held',null,{grants,until:Number.isFinite(expiry)?expiry:null});
        sessions[key]=next;
        event('granted',next,null);
      }
      return dirty||jobs!==previous.jobs?freeze({...previous,jobs,sessions}):previous;
    }

    function validateOwners(state,requests,tick){
      for(const [key,row] of Object.entries(state.sessions)){
        const request=requests.get(key);
        check(request&&request.owner.agent===row.owner.agent&&row.since<=tick,'Missing saved reservation owner '+key);
        if(row.status!=='held')continue;
        const require=request.spec.require;
        check(!request.paused&&(row.until===null||row.until>tick)&&row.grants.length===Object.keys(require).length&&
          row.grants.every(grant=>{
            const need=own(require,grant.claim)&&require[grant.claim], item=lookup(state.jobs,grant.pool);
            return need&&(need.units??1)===grant.units&&(need.anyOf?need.anyOf.includes(grant.pool):
              item.kind==='job'&&(need.job===true||Q.condition(need.job,item)));
          }),'Invalid grant for saved reservation '+key);
      }
    }

    return {initial:()=>initial,shareCheckpoint:true,validateState,checkAction,reservationBoard:{reconcile,validateOwners},
      actions:{
        'post-job'(state,{job,...spec},ctx){
          check(!own(state.jobs,job),'Job already exists '+job);
          check(Object.keys(state.jobs).length<jobsLimit,'Reservation board job capacity exceeded');
          const serial=state.serial+1;
          check(positive(serial)&&(spec.expires===undefined||spec.expires>ctx.tick),'Invalid job revision or deadline '+job);
          ctx.emit('job-posted',{job,revision:serial});
          return {...state,serial,jobs:{...state.jobs,[job]:makeJob(job,spec,serial,ctx.tick)}};
        },
        'withdraw-job'(state,{job},ctx){
          check(own(state.jobs,job),'Unknown reservation job '+job);
          const jobs={...state.jobs};
          ctx.emit('job-withdrawn',{job,revision:jobs[job].revision});
          delete jobs[job];
          return {...state,jobs};
        }
      },fields:{
        pools:table('pool',()=>pools), jobs:table('job',state=>state.jobs),
        claims:{type:'records',qualified:true,selector:true,read({state,args}){
          const rows=Object.values(state.sessions).filter(row=>(args.pool===undefined||row.grants.some(grant=>grant.pool===args.pool))&&
            Q.condition(args.where,row)).sort(byAge);
          return Q.ok(rows);
        }},
        claim:{type:'record',qualified:true,selector:true,read({state,args}){
          const row=ownerOK(args)&&state.sessions[token(args)];
          return row&&row.owner.agent===args.agent?Q.ok(row):Q.missing('No reservation for this order','missing');
        }}
      }
    };
  }

  function bind(systems){
    const names=Object.keys(systems).sort(), boards=names.filter(name=>systems[name].reservationBoard);
    const consumers=names.filter(name=>systems[name].reservationOrders);
    for(const name of consumers)systems[name].reservationOrders.check(link=>{
      check(own(systems,link.board)&&systems[link.board].reservationBoard,'Unknown reservation board '+link.board);
    });
    if(!boards.length)return null;

    function registrations(states,canClaim){
      const requests=new Map(boards.map(name=>[name,new Map()]));
      for(const name of consumers){
        const eligible=canClaim?.(name)??false;
        for(const {agent,generation,entry,paused} of systems[name].reservationOrders.rows(states[name])){
          const owner={system:name,agent,generation,sequence:entry.sequence}, spec=entry.reservation;
          requests.get(spec.board).set(token(owner),{owner,paused,eligible,spec});
        }
      }
      return requests;
    }
    function run(states,ctx,canClaim){
      const requests=registrations(states,canClaim);
      let next=states;
      const outcome=owner=>systems[owner.system]?.reservationOrders?.outcome(states[owner.system],owner);
      for(const name of boards){
        const updated=systems[name].reservationBoard.reconcile(states[name],requests.get(name),
          {tick:ctx.tick,emit:ctx.emit(name)},outcome,Boolean(canClaim));
        if(updated!==states[name]){
          if(next===states)next={...states};
          next[name]=updated;
        }
      }
      return next;
    }
    return {run,validate(states,tick){
      const requests=registrations(states);
      for(const name of boards)systems[name].reservationBoard.validateOwners(states[name],requests.get(name),tick);
    }};
  }
  W.reservations=Object.freeze({bind,checkSpec});
  W.runtime.register('reservations',board);
})(KIT);
