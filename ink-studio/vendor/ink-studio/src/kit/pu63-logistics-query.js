/* Follow current shortages through stock accounts, routes and scheduled recipes. */
(function(K){
  const W=K.world, Q=W.query;
  function create(layout,system){
    const {accounts,processes,routes,resources,processIndex,routeIndex,accountIndex}=layout;
    const suppliers=accounts.map(()=>[]);
    processes.forEach((row,i)=>{
      for(const part of row.outputs)suppliers[part.account].push({kind:'process',i});
    });
    routes.forEach((row,i)=>suppliers[row.to].push({kind:'link',i}));
    const rows={stock:accounts,link:routes,process:processes};
    const pin=i=>system+'/'+accounts[i].key;
    const nodeKey=({kind,i})=>kind+'/'+rows[kind][i].key;
    function supply({state,target,args}){
      const key=args.process??args.link??args.account??target?.entity;
      let root;
      if(args.link!==undefined)root={kind:'link',i:routeIndex.get(key)};
      else if(args.account!==undefined)root={kind:'stock',i:accountIndex.get(typeof key==='string'&&key.startsWith(system+'/')?key.slice(system.length+1):key)};
      else if(args.container!==undefined&&args.resource!==undefined){
        const i=accountIndex.get(args.container+'.'+args.resource);
        if(accounts[i]?.container===args.container&&resources[accounts[i].resource].key===args.resource)root={kind:'stock',i};
      }else root={kind:'process',i:processIndex.get(key)};
      if(root?.i===undefined)return Q.missing('Choose a known process, link or stock account','missing');
      const limit=args.limit??128;
      W.data.check(Number.isInteger(limit)&&limit>=1&&limit<=512,'Logistics trace limit must be between 1 and 512');
      const queue=[root], seen=new Map([[nodeKey(root),root]]), nodes=[], edges=[], bottlenecks=[];
      let truncated=false;
      function add(from,to,relation){
        const id=nodeKey(from);
        if(!seen.has(id)){
          if(seen.size>=limit){truncated=true;return;}
          queue.push(from);seen.set(id,from);
        }
        edges.push({from:id,to:nodeKey(to),relation});
      }
      function stop(node,reason,detail={}){
        bottlenecks.push({node:nodeKey(node),reason,...detail});
      }
      for(const node of queue){
        const {i,kind}=node, row=rows[kind][i], id=nodeKey(node);
        if(kind==='stock'){
          const stock=state.stocks[i];
          nodes.push({id,kind,account:pin(i),stock,capacity:row.max,units:resources[row.resource].units});
          if(suppliers[i].length){
            for(const upstream of suppliers[i])add(upstream,node,'supplies');
          }else if(!stock)stop(node,'no-configured-supplier',{account:pin(i)});
        }else if(kind==='link'){
          const report=state.links[i];
          const inTransit=state.shipments[i].reduce((total,shipment)=>total+shipment.amount,0);
          nodes.push({id,kind,from:pin(row.from),to:pin(row.to),inTransit,...report});
          if(report.reason==='source-empty'){
            stop(node,report.reason,{account:pin(row.from),available:state.stocks[row.from]});
            add({kind:'stock',i:row.from},node,'draws-from');
          }else if(report.reason)stop(node,report.reason,
            report.reason==='destination-full'?{account:pin(row.to)}:report.obstruction??{});
          else if(report.status==='disabled')stop(node,'disabled');
          else add({kind:'stock',i:row.from},node,'draws-from');
        }else{
          const report=state.process[i], blocked=report.blocked.map(part=>({...part,account:pin(part.account)}));
          nodes.push({id,kind,recipe:row.recipe,remaining:state.jobs[i],completed:state.complete[i],...report,blocked});
          if(['disabled','paused','batch-limit'].includes(report.status))stop(node,report.status);
          else if(report.blocked.length){
            for(const item of report.blocked){
              const {account,amount,available,reason}=item;
              stop(node,reason,{account:pin(account),amount,available});
              if(reason==='missing-stock')add({kind:'stock',i:account},node,'requires');
            }
          }else if(node===root&&state.jobs[i]===null){
            for(const {account} of row.inputs)add({kind:'stock',i:account},node,'requires');
          }
        }
      }
      return Q.ok({root:nodeKey(root),time:state.time,nodes,edges,bottlenecks,truncated});
    }
    return {supply,pin};
  }
  W.logisticsQuery=Object.freeze({create});
})(KIT);
