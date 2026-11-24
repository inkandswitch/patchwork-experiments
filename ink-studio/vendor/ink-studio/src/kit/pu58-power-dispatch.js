/* Deterministic lossless power routing on the live bus graph. */
(function(K){
  const W=K.world;
  const zeros=rows=>rows.map(()=>0);
  const sum=values=>values.reduce((a,b)=>a+b,0);
  function paths(layout,closed){
    const adjacent=layout.buses.map(()=>[]);
    layout.lines.forEach(({from,to},i)=>{
      if(!closed[i])return;
      adjacent[from].push({to,line:i,sign:1});
      adjacent[to].push({to:from,line:i,sign:-1});
    });
    const cache=new Map();
    return start=>{
      if(cache.has(start))return cache.get(start);
      const queue=[start], route=new Map([[start,[]]]);
      for(let i=0;i<queue.length;i++){
        const at=queue[i];
        for(const edge of adjacent[at]){
          if(route.has(edge.to))continue;
          route.set(edge.to,[...route.get(at),edge]);queue.push(edge.to);
        }
      }
      cache.set(start,route);
      return route;
    };
  }
  function dispatch(layout,state,commands,closed,dt){
    const {lines,generators,batteries,loads,loadOrder}=layout;
    const route=paths(layout,closed), flows=zeros(lines), generated=zeros(generators), delivered=zeros(loads);
    const charge=zeros(batteries), discharge=zeros(batteries), allocations=[];
    const supply=commands.supply.slice(), stored=batteries.map((row,i)=>Math.min(row.dischargeWatts,
      state.energy[i]*row.dischargeEfficiency/dt));
    const providers=[...generators.map((row,i)=>({kind:'generator',i,bus:row.bus,available:supply,used:generated})),
      ...batteries.map((row,i)=>({kind:'battery',i,bus:row.bus,available:stored,used:discharge}))];
    function deliver(to,need,sink,candidates,accepted){
      const reach=route(to);
      const available=candidates.filter(row=>row.available[row.i]>0&&reach.has(row.bus));
      available.sort((a,b)=>Number(a.kind==='battery')-Number(b.kind==='battery')||
        reach.get(a.bus).length-reach.get(b.bus).length||a.i-b.i);
      for(const row of available){
        if(need<=0)break;
        const watts=Math.min(need,row.available[row.i]);
        if(watts<=0)continue;
        row.available[row.i]-=watts;row.used[row.i]+=watts;need-=watts;accepted(watts);
        const path=reach.get(row.bus).slice().reverse().map(({line,sign})=>({line,sign:-sign}));
        for(const {line,sign} of path)flows[line]+=watts*sign;
        allocations.push({from:{kind:row.kind,index:row.i},to:sink,watts,path});
      }
    }
    for(const i of loadOrder){
      deliver(loads[i].bus,commands.demand[i],{kind:'load',index:i},providers,watts=>{delivered[i]+=watts;});
    }
    const production=providers.slice(0,generators.length);
    batteries.forEach((row,i)=>{
      if(discharge[i]>0)return;
      const room=(row.capacity-state.energy[i])/(row.chargeEfficiency*dt);
      deliver(row.bus,Math.min(row.chargeWatts,room),{kind:'battery',index:i},production,watts=>{charge[i]+=watts;});
    });
    return {flows,generated,delivered,charge,discharge,allocations};
  }
  W.powerDispatch=Object.freeze({dispatch,sum,zeros});
})(KIT);
