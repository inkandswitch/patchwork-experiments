/* Inspectable, checkpointed resource production, consumption and transport. */
(function(K){
  const W=K.world, F=W.logisticsFlow, Q=W.query, {V}=K, {check,record}=W.data;
  function polyline(points){
    if(!points.length)return null;
    const segments=[];
    let length=0;
    for(let i=1;i<points.length;i++){
      const size=V.dist(points[i-1],points[i]);
      if(size){segments.push({a:points[i-1],b:points[i],start:length,size});length+=size;}
    }
    return progress=>{
      const at=W.fields.clamp(progress,0,1)*length;
      const segment=segments.find(row=>at<=row.start+row.size);
      return segment?V.lerp(segment.a,segment.b,(at-segment.start)/segment.size):points.at(-1);
    };
  }
  function logistics(config,{id:system}){
    const layout=W.logisticsLayout.compile(config), {resources,accounts,containers,recipes,processes,routes}=layout;
    const {supply,pin}=W.logisticsQuery.create(layout,system);
    const paths=routes.map(row=>polyline(row.path)), inputs={}, outputs={};
    const workRows=processes.filter(row=>row.work);
    const anchors=new Map(containers.map(row=>[row.key,row.at]));
    const definitions=Object.fromEntries(workRows.map(row=>[row.key,row.work]));
    const workSites=Object.fromEntries(workRows.map(row=>[row.key,{workers:[],labor:0,reason:row.enabled?'workers':'disabled'}]));
    const initial={
      stocks:accounts.map(row=>row.initial),time:0,complete:F.zeros(processes),jobs:processes.map(()=>null),
      shipments:routes.map(()=>[]),credit:F.zeros(routes),produced:F.zeros(resources),consumed:F.zeros(resources),
      received:F.zeros(resources),sent:F.zeros(resources),
      process:processes.map(row=>({status:row.enabled?'idle':'disabled',blocked:[],batches:0})),
      links:routes.map(row=>({status:row.enabled?'idle':'disabled',reason:null,dispatched:0,arrived:0})),
      ...(workRows.length&&{workSites})
    };
    for(const row of processes){
      inputs['enable-process.'+row.key]={type:'bool',default:row.enabled};
      inputs['speed.'+row.key]={type:'number',default:row.speed};
      outputs['completed.'+row.key]='number';
      outputs['blocked.'+row.key]='bool';
    }
    for(const row of routes){
      inputs['enable-link.'+row.key]={type:'bool',default:row.enabled};
      outputs['delivered.'+row.key]='number';
      outputs['link-blocked.'+row.key]='bool';
    }
    accounts.forEach(row=>{outputs['stock.'+row.key]={type:'number',default:row.initial};});
    const transferAccounts=Object.fromEntries(accounts.map(({key,resource,type,max,container},i)=>[key,{
      type,resource:resources[resource].key,units:resources[resource].units,
      ...(anchors.get(container)!==undefined&&{at:anchors.get(container)}),
      read:state=>({balance:state.stocks[i],max}),
      write(state,value){
        const stocks=state.stocks.slice(), delta=value-stocks[i], direction=delta>=0?'received':'sent';
        const sum=state[direction].slice();
        stocks[i]=value;
        sum[resource]+=Math.abs(delta);
        return {...state,stocks,[direction]:sum};
      }
    }]));
    const routeNames=new Map();
    function checkFields(query){
      const names=query.inspect().traces.map(row=>row.name);
      for(const {key,checkRoute} of routes){
        if(!checkRoute)continue;
        const {trace}=checkRoute;
        const matches=names.filter(name=>trace.includes('/')?name===trace:name.endsWith('/'+trace));
        check(matches.length===1&&!matches[0].startsWith(system+'/'),'Unknown, ambiguous or recursive logistics route trace '+trace);
        routeNames.set(key,matches[0]);
      }
    }
    function obstruction(row,query){
      if(!row.checkRoute)return null;
      const {at,to,args}=row.checkRoute, trace=routeNames.get(row.key);
      const hit=query.trace(trace,at,{...args,to});
      const status=hit.value?.status??hit.status;
      if(hit.status==='ok'&&status==='ok')return null;
      const {blocked}=hit.value??{};
      return {trace,status,...(typeof hit.reason==='string'&&{detail:hit.reason}),
        ...(record(blocked)&&{obstruction:blocked})};
    }
    function emitChanges(before,after,ctx){
      processes.forEach(({key,recipe,work},i)=>{
        if(work)return;
        const old=before.process[i], now=after.process[i];
        const code=list=>list.map(row=>row.account+' '+row.reason).join('|');
        if(now.blocked.length&&code(now.blocked)!==code(old.blocked))
          ctx.emit('recipe-blocked',{process:key,recipe,blocked:now.blocked.map(part=>({...part,account:pin(part.account)}))});
        else if(old.blocked.length&&!now.blocked.length&&!['disabled','paused'].includes(now.status))
          ctx.emit('recipe-resumed',{process:key,recipe});
        if(now.batches)ctx.emit('recipe-completed',{process:key,recipe,batches:now.batches,total:after.complete[i]});
      });
      routes.forEach(({key},i)=>{
        const old=before.links[i], now=after.links[i];
        if(now.reason&&old.reason!==now.reason)
          ctx.emit('shipment-blocked',{link:key,reason:now.reason,...now.obstruction});
        else if(old.reason&&!now.reason&&(now.dispatched||now.arrived))
          ctx.emit('shipment-resumed',{link:key,dispatched:now.dispatched,arrived:now.arrived});
      });
    }
    function signals(state){
      const values={};
      accounts.forEach((row,i)=>{values['stock.'+row.key]=state.stocks[i];});
      processes.forEach((row,i)=>{
        values['completed.'+row.key]=state.complete[i];
        values['blocked.'+row.key]=state.process[i].status==='blocked';
      });
      routes.forEach((row,i)=>{
        values['delivered.'+row.key]=state.links[i].arrived;
        values['link-blocked.'+row.key]=state.links[i].status==='blocked';
      });
      return values;
    }
    function validateState(state){
      const list=(values,rows,fn)=>Array.isArray(values)&&values.length===rows.length&&rows.every((row,i)=>fn(values[i],row,i));
      const positive=n=>Number.isFinite(n)&&n>=0;
      const amount=(n,type)=>positive(n)&&(type!=='integer'||Number.isSafeInteger(n));
      const processStatuses=['idle','paused','disabled','working','blocked','completed','batch-limit'];
      const linkStatuses=['idle','disabled','blocked','in-transit','delivered'];
      const routeReasons=['source-empty','destination-full','in-transit-full','route-closed','precision'];
      const partReasons=['missing-stock','output-full','precision'];
      check(record(state)&&positive(state.time)&&list(state.stocks,accounts,(n,row)=>amount(n,row.type)&&(row.max===null||n<=row.max))&&
        list(state.jobs,processes,(n,row)=>n===null||positive(n)&&n<=row.duration)&&
        list(state.complete,processes,n=>Number.isSafeInteger(n)&&n>=0)&&list(state.credit,routes,n=>positive(n)&&n<1)&&
        ['produced','consumed','received','sent'].every(key=>list(state[key],resources,positive))&&
        list(state.shipments,routes,(queue,row)=>Array.isArray(queue)&&queue.length<=row.slots&&queue.every((ship,k)=>
          record(ship)&&amount(ship.amount,accounts[row.from].type)&&ship.amount>0&&positive(ship.departed)&&
          ship.departed<=state.time&&ship.at===ship.departed+row.travel&&row.travel>0&&(!k||queue[k-1].at<=ship.at)))&&
        list(state.process,processes,row=>record(row)&&processStatuses.includes(row.status)&&Number.isInteger(row.batches)&&row.batches>=0&&
          row.batches<=layout.maxBatches&&Array.isArray(row.blocked)&&row.blocked.length<=32&&row.blocked.every(part=>
          record(part)&&Number.isInteger(part.account)&&accounts[part.account]&&positive(part.amount)&&
          (part.available===null||positive(part.available))&&partReasons.includes(part.reason)))&&
        list(state.links,routes,row=>record(row)&&linkStatuses.includes(row.status)&&positive(row.dispatched)&&positive(row.arrived)&&
          (row.reason===null||routeReasons.includes(row.reason))&&(row.obstruction===undefined||record(row.obstruction))),
      'Invalid saved logistics state');
      check(workRows.length?record(state.workSites)&&Object.keys(state.workSites).length===workRows.length&&
        workRows.every(({key,work})=>{
          const row=state.workSites[key], i=layout.processIndex.get(key);
          return state.complete[i]<=work.batches&&record(row)&&Array.isArray(row.workers)&&row.workers.length<=work.maxWorkers&&
            row.workers.every(worker=>record(worker)&&[worker.system,worker.agent].every(W.data.id)&&
              Number.isSafeInteger(worker.generation)&&worker.generation>0&&W.worksites.rate(worker.rate))&&
            positive(row.labor)&&(row.reason===null||W.data.id(row.reason));
        }):state.workSites===undefined,'Invalid saved worksite state');
      for(const row of Object.values(F.ledger(layout,state)))
        check(Math.abs(row.error)<=1e-8*Math.max(1,row.initial+row.produced+row.received),'Unbalanced saved logistics ledger');
    }
    function records(rows,label,describe){
      return {type:'record',selector:true,read({state,target,args,query}){
        const key=args[label]??target?.entity;
        if(key===undefined){
          const matches=rows.flatMap((row,i)=>{
            const value=describe(state,row,i,args,query);
            return value===undefined?[]:[[row.key,value]];
          });
          return Q.ok(Object.fromEntries(matches));
        }
        const i=rows.findIndex(row=>row.key===key);
        if(i<0)return Q.missing('unknown logistics '+label,'missing');
        const result=describe(state,rows[i],i,args,query);
        return result===undefined?Q.missing('unknown logistics stock','missing'):Q.ok(result);
      }};
    }
    function stock(state,i){
      const row=accounts[i], {key:resource,units,type}=resources[row.resource];
      return {account:pin(i),resource,units,type,stock:state.stocks[i],capacity:row.max};
    }
    function container(state,row,i,args,query){
      const stocks=Object.fromEntries(row.stocks.map(index=>{
        const value=stock(state,index);
        return [value.resource,value];
      }));
      if(args.resource!==undefined)return Object.hasOwn(stocks,args.resource)?stocks[args.resource]:undefined;
      const position=row.at===undefined?null:W.worksites.frame(query,row.at)?.point;
      return {id:row.key,...(position&&{position}),stocks};
    }
    function cargo(state){
      const bodies={};
      routes.forEach((row,i)=>{
        const path=paths[i];
        if(!path)return;
        for(const shipment of state.shipments[i]){
          const id=row.key+'.'+shipment.departed, {look}=resources[accounts[row.from].resource];
          const position=path((state.time-shipment.departed)/row.travel);
          bodies[id]={id,position,look,half:[.19,.17,.19]};
        }
      });
      return Q.ok(bodies);
    }
    function stockBodies(state,query){
      const bodies={};
      accounts.forEach(({key,resource,display,max},i)=>{
        if(!display||!state.stocks[i])return;
        const {half,offset}=display, height=Math.max(.01,half[1]*(state.stocks[i]/max));
        const anchor=anchors.get(accounts[i].container);
        const frame=offset?W.worksites.frame(query,anchor):null;
        const base=offset?frame?.point:display.at;
        if(!base)return;
        const {V,M}=K, position=offset?V.add(base,frame?.rotation?M.app(frame.rotation,offset):offset):base;
        bodies[key]={id:key,position:V.add(position,[0,height,0]),look:resources[resource].look,half:[half[0],height,half[2]]};
      });
      return Q.ok(bodies);
    }
    const stockField=records(containers,'container',container);
    const worksites=records(workRows,'process',(state,row,_,args,query)=>{
      const i=layout.processIndex.get(row.key), {work}=row, completed=state.complete[i], current=state.workSites[row.key];
      const point=W.worksites.frame(query,work.at)?.point??null, remaining=state.jobs[i];
      const needs=remaining===null&&completed<work.batches?row.inputs.map(({account,amount})=>({
        account:pin(account),required:amount,available:state.stocks[account],missing:Math.max(0,amount-state.stocks[account])})): [];
      return {id:row.key,recipe:row.recipe,...work,position:point,completed,remaining,duration:row.duration,
        status:state.process[i].status,workers:current.workers,labor:current.labor,reason:current.reason,
        workersNeeded:completed>=work.batches?0:Math.max(0,work.minWorkers-current.workers.length),materials:needs};
    });
    return {initial:()=>initial,inputs,outputs,accounts:transferAccounts,checkFields,validateState,output:signals,
      partitionStep:!workRows.length&&routes.every(row=>!row.checkRoute),
      ...(workRows.length&&{worksites:{definitions,
        completed:(state,key)=>state.complete[layout.processIndex.get(key)],
        step:(state,key,ctx,effect)=>F.work(layout,state,layout.processIndex.get(key),ctx,effect)
      }}),
      simulationAggregate(settings){
        return W.aggregateLogistics(settings,{layout,validateDetail:validateState,accounts:transferAccounts,
          stocks:stockField.read,stockBodies});
      },
      step(state,ctx){
        const next=F.advance(layout,state,ctx,row=>obstruction(row,ctx.query));
        emitChanges(state,next,ctx);
        return next;
      },fields:{
        recipes:records(recipes,'recipe',(_,row)=>row),
        stocks:stockField,
        processes:records(processes,'process',(state,row,i)=>({
          id:row.key,recipe:row.recipe,duration:row.duration,remaining:state.jobs[i],completed:state.complete[i],
          ...state.process[i],blocked:state.process[i].blocked.map(part=>({...part,account:pin(part.account)}))
        })),
        links:records(routes,'link',(state,row,i)=>({
          id:row.key,from:pin(row.from),to:pin(row.to),...state.links[i],
          travel:row.travel,shipments:state.shipments[i],
          inTransit:state.shipments[i].reduce((sum,ship)=>sum+ship.amount,0)
        })),
        ...(workRows.length&&{worksite:worksites}),
        ledger:{type:'record',read:({state})=>Q.ok(F.ledger(layout,state))},
        cargo:{type:'record',read:({state})=>cargo(state)},
        'stock-bodies':{type:'record',read:({state,query})=>stockBodies(state,query)}
      },traces:{supply:{selector:true,run:supply}}
    };
  }
  W.runtime.register('logistics',logistics,{worker:true});
})(KIT);
