/* Atomic batches and capacity-limited shipments in a single owned logistics ledger. */
(function(K){
  const W=K.world;
  const zeros=rows=>rows.map(()=>0);
  const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-12,Math.abs(b)*1e-8);
  const rounded=(a,b)=>Math.abs(a-b)<=32*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
  function delta(stocks,index,amount,accounts){
    const {max,type}=accounts[index], before=stocks[index], raw=before+amount;
    const boundary=raw<0?0:max!==null&&raw>max?max:raw;
    if(boundary!==raw&&!rounded(boundary-before,amount))return null;
    if(!Number.isFinite(boundary)||type==='integer'&&!Number.isSafeInteger(boundary))return null;
    if(amount&&(!close(boundary-before,amount)||boundary===before))return null;
    return boundary;
  }
  function batch(stocks,parts,sign,accounts){
    const changed=[], blocked=[];
    for(const {account,amount} of parts){
      const value=delta(stocks,account,amount*sign,accounts);
      if(value!==null){
        changed.push({account,value});
        continue;
      }
      const {max}=accounts[account], balance=stocks[account], available=sign<0?balance:max===null?null:max-balance;
      blocked.push({account,amount,available,reason:available!==null&&available<amount?
        sign<0?'missing-stock':'output-full':'precision'});
    }
    if(blocked.length)return blocked;
    for(const {account,value} of changed)stocks[account]=value;
    return [];
  }
  function transfer(stocks,route,operation,accounts,requested){
    const {from,to,exact}=route, {max}=accounts[to];
    const arriving=operation==='arrival', departing=operation==='dispatch';
    const available=arriving?Infinity:stocks[from], room=departing||max===null?Infinity:max-stocks[to];
    let amount=Math.min(requested,available,room);
    if(amount>0&&rounded(requested,amount))amount=requested;
    if(!amount||exact&&amount<requested)
      return {amount:0,reason:available<=room?'source-empty':'destination-full'};
    const debit=arriving?null:delta(stocks,from,-amount,accounts);
    const credit=departing?null:delta(stocks,to,amount,accounts);
    if(!arriving&&debit===null||!departing&&credit===null)return {amount:0,reason:'precision'};
    if(debit!==null)stocks[from]=debit;
    if(credit!==null)stocks[to]=credit;
    return {amount};
  }

  function advance(layout,state,ctx,routeCheck){
    const {processes,routes,accounts,processOrder,routeOrder,maxBatches}=layout;
    const stocks=state.stocks.slice(), time=ctx.time, complete=state.complete.slice();
    const jobs=state.jobs.slice(), nextProcesses=[], nextRoutes=[], shipments=state.shipments.map(row=>row.slice());
    const produced=state.produced.slice(), consumed=state.consumed.slice(), credit=state.credit.slice();
    function routeReport(i){
      return nextRoutes[i]??={dispatched:0,arrived:0,status:shipments[i].length?'in-transit':'idle',reason:null};
    }
    for(const i of routeOrder){
      const row=routes[i], queue=shipments[i], report=routeReport(i);
      while(queue.length&&(queue[0].at<=time||rounded(queue[0].at,time))){
        const oldest=queue[0], posted=transfer(stocks,row,'arrival',accounts,oldest.amount);
        report.arrived+=posted.amount;
        if(posted.amount<oldest.amount){
          queue[0]={...oldest,amount:oldest.amount-posted.amount};
          report.status='blocked';report.reason=posted.reason??'destination-full';
          break;
        }
        queue.shift();
      }
      if(report.arrived&&!queue.length)report.status='delivered';
    }
    for(const i of processOrder){
      const row=processes[i], {key,inputs,outputs,duration}=row;
      if(row.work){nextProcesses[i]=state.process[i];continue;}
      const enabled=ctx.input['enable-process.'+key], speed=W.fields.clamp(ctx.input['speed.'+key],0,64);
      let left=ctx.dt*speed, job=jobs[i], count=0, blocked=[], status='idle';
      if(!enabled||!speed)status=enabled?'paused':'disabled';
      else {
        while(count<maxBatches){
          if(job===null){
            if(left<=0)break;
            blocked=batch(stocks,inputs,-1,accounts);
            if(blocked.length){status='blocked';break;}
            job=duration;
          }
          const same=rounded(job,left);
          if(job>left&&!same){job-=left;status='working';break;}
          left=same?0:left-job;
          job=0;
          blocked=batch(stocks,outputs,1,accounts);
          if(blocked.length){status='blocked';break;}
          for(const {account,amount} of inputs)consumed[accounts[account].resource]+=amount;
          for(const {account,amount} of outputs)produced[accounts[account].resource]+=amount;
          complete[i]++;count++;job=null;
          if(left<=0){status='completed';break;}
        }
        if(count===maxBatches&&left>0)status='batch-limit';
      }
      jobs[i]=job;
      nextProcesses[i]={status,blocked,batches:count};
    }
    for(const i of routeOrder){
      const row=routes[i], report=routeReport(i), queue=shipments[i];
      if(!ctx.input['enable-link.'+row.key]){
        if(report.status!=='blocked')report.status='disabled';
        continue;
      }
      let amount=row.amount;
      if(row.rate!==null){
        const total=credit[i]+row.rate*ctx.dt;
        const integral=accounts[row.from].type==='integer';
        amount=integral?Math.floor(total+1e-12):total;
        credit[i]=Math.max(0,total-amount);
      }
      if(!amount)continue;
      if(queue.length>=row.slots){
        if(report.status!=='blocked'){report.status='blocked';report.reason='in-transit-full';}
        continue;
      }
      const obstruction=routeCheck(row);
      if(obstruction){
        report.status='blocked';report.reason='route-closed';report.obstruction=obstruction;
        continue;
      }
      const posting=transfer(stocks,row,row.travel?'dispatch':'direct',accounts,amount);
      report.dispatched=posting.amount;
      if(!posting.amount){
        if(report.status!=='blocked'){report.status='blocked';report.reason=posting.reason;}
        continue;
      }
      if(report.status!=='blocked')report.status=row.travel?'in-transit':'delivered';
      if(row.travel)queue.push({amount:posting.amount,departed:time,at:time+row.travel});
      else report.arrived+=posting.amount;
    }
    return {...state,stocks,time,complete,jobs,shipments,credit,produced,consumed,process:nextProcesses,links:nextRoutes};
  }
  function work(layout,state,i,{workers,arrived,dt,enabled,speed},effect){
    const row=layout.processes[i], {key,inputs,outputs,duration,work}=row, previous=state.workSites[key];
    const speedLimit=W.fields.clamp(speed,0,64);
    let job=state.jobs[i], stocks=state.stocks, blocked=[], finished=false, labor=0, status='paused', reason=null;
    if(state.complete[i]>=work.batches)status='completed';
    else if(!enabled||!speedLimit){status=enabled?'paused':'disabled';reason='disabled';}
    else if(!arrived)reason='worksite-missing';
    else if(workers.length<work.minWorkers)reason='workers';
    else {
      if(job===null){
        const draft=stocks.slice();
        blocked=batch(draft,inputs,-1,layout.accounts);
        if(!blocked.length){stocks=draft;job=duration;}
      }
      if(blocked.length){status='blocked';reason='materials';}
      else{
        const effort=dt*speedLimit*workers.reduce((sum,worker)=>sum+worker.rate,0);
        labor=Math.min(effort,job);
        job=effort>=job||rounded(effort,job)?0:job-effort;
        status='working';
        if(job===0){
          const draft=stocks.slice();
          blocked=batch(draft,outputs,1,layout.accounts);
          reason=blocked.length?'output':effect();
          status=reason?'blocked':'completed';
          if(!reason){stocks=draft;job=null;finished=true;}
        }
      }
    }
    const summary={workers,labor,reason};
    const process={status,blocked,batches:Number(finished)};
    const result={state,finished,reason,demandChanged:reason!==previous.reason};
    if(!finished&&job===state.jobs[i]&&stocks===state.stocks&&W.data.equal(summary,previous)&&
      W.data.equal(process,state.process[i]))return result;
    const jobs=state.jobs.slice(), processes=state.process.slice();
    jobs[i]=job;processes[i]=process;
    const next={...state,stocks,jobs,process:processes,workSites:{...state.workSites,[key]:summary}};
    if(finished){
      const complete=state.complete.slice(), consumed=state.consumed.slice(), produced=state.produced.slice();
      complete[i]++;
      for(const {account,amount} of inputs)consumed[layout.accounts[account].resource]+=amount;
      for(const {account,amount} of outputs)produced[layout.accounts[account].resource]+=amount;
      Object.assign(next,{complete,consumed,produced});
    }
    return {...result,state:next};
  }

  function ledger(layout,state){
    const {resources,accounts,processes,routes}=layout;
    const stored=zeros(resources), inProgress=zeros(resources), inTransit=zeros(resources), initial=zeros(resources);
    accounts.forEach((row,i)=>{stored[row.resource]+=state.stocks[i];initial[row.resource]+=row.initial;});
    processes.forEach((row,i)=>{
      if(state.jobs[i]===null)return;
      for(const {account,amount} of row.inputs)inProgress[accounts[account].resource]+=amount;
    });
    routes.forEach((row,i)=>{
      for(const shipment of state.shipments[i])inTransit[accounts[row.from].resource]+=shipment.amount;
    });
    return Object.fromEntries(resources.map(({key,units},i)=>{
      const {produced,consumed,received,sent}=state;
      const total=stored[i]+inProgress[i]+inTransit[i];
      return [key,{units,stored:stored[i],inProgress:inProgress[i],inTransit:inTransit[i],total,initial:initial[i],
        produced:produced[i],consumed:consumed[i],received:received[i],sent:sent[i],
        error:total-initial[i]-produced[i]+consumed[i]-received[i]+sent[i]}];
    }));
  }
  W.logisticsFlow=Object.freeze({advance,work,ledger,zeros});
})(KIT);
