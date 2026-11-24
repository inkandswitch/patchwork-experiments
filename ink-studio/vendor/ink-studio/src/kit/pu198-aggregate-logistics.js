/* Stock, reservations and transit with cached route eligibility. */
(function(K){
  const W=K.world, Q=W.query, {check,record}=W.data, freeze=K.procedural.data.freeze;

  function ledger(settings,{layout,validateDetail,accounts,stocks,stockBodies}){
    const F=W.logisticsFlow;
    check(settings.model==='ledger'&&Object.keys(settings).every(key=>key==='model'),
      'Invalid logistics aggregate model');
    const {resources,processes,routes}=layout;
    const staffed=processes.some(row=>row.work);
    const quantities=Object.fromEntries(resources.map(({key,units,type})=>[key,{units,exact:type==='integer'}]));
    function pack(state,closed){
      const {process,links,...work}=state;
      return freeze({work,closed,process:process.map(({status,batches,blocked})=>[status,batches,blocked]),
        links:links.map(({status,reason,dispatched,arrived,obstruction})=>[status,reason,dispatched,arrived,obstruction??null])});
    }
    function reduce(state){
      const closed=routes.map((row,i)=>Boolean(row.checkRoute&&
        (state.links[i].reason==='route-closed'||!(state.links[i].dispatched>0||state.shipments[i].length))));
      return pack(state,closed);
    }
    function expand({work,process,links}){
      return freeze({...work,process:process.map(([status,batches,blocked])=>({status,batches,blocked})),
        links:links.map(([status,reason,dispatched,arrived,obstruction])=>({status,reason,dispatched,arrived,
          ...(obstruction!==null&&{obstruction})}))});
    }
    const indices=new Map(routes.map(({key},i)=>[key,i]));
    return {quantities,reduce,expand,
      measure(state,aggregate){
        const report=F.ledger(layout,aggregate?state.work:state);
        return Object.fromEntries(Object.entries(report).map(([key,{stored,inProgress,inTransit}])=>[key,[stored,inProgress,inTransit]]));
      },
      validate(state){
        check(record(state?.work)&&Array.isArray(state.closed)&&state.closed.length===routes.length&&
          state.closed.every((value,i)=>typeof value==='boolean'&&(!value||routes[i].checkRoute))&&
          Array.isArray(state.process)&&state.process.length===processes.length&&state.process.every(row=>Array.isArray(row)&&row.length===3)&&
          Array.isArray(state.links)&&state.links.length===routes.length&&state.links.every(row=>Array.isArray(row)&&row.length===5),
        'Invalid aggregate logistics state');
        validateDetail(expand(state));
      },
      step(state,ctx){
        const next=F.advance(layout,staffed?expand(state):state.work,ctx,row=>state.closed[indices.get(row.key)]?{status:'closed-at-sampling'}:null);
        return pack(next,state.closed);
      },
      output(state){
        const values={};
        layout.accounts.forEach((row,i)=>{values['stock.'+row.key]=state.work.stocks[i];});
        processes.forEach(({key},i)=>{
          values['completed.'+key]=state.work.complete[i];
          values['blocked.'+key]=state.process[i][0]==='blocked';
        });
        routes.forEach(({key},i)=>{
          values['delivered.'+key]=state.links[i][3];
          values['link-blocked.'+key]=state.links[i][0]==='blocked';
        });
        return values;
      },
      accounts:Object.fromEntries(Object.entries(accounts).map(([key,account])=>[key,{
        read:state=>account.read(state.work),
        write:(state,value)=>freeze({...state,work:account.write(state.work,value)})
      }])),
      fields:{stocks:ctx=>stocks({...ctx,state:ctx.state.work}),
        ledger:({state})=>Q.ok(F.ledger(layout,state.work)), 'stock-bodies':({state,query})=>stockBodies(state.work,query)},
      describe:state=>({routes:routes.length,cachedRoutes:routes.filter(row=>row.checkRoute).length,blockedRoutes:state.closed.filter(Boolean).length})
    };
  }
  W.aggregateLogistics=ledger;
})(KIT);
