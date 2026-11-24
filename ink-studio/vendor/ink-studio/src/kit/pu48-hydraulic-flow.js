/* Conservative hydraulic head and bounded storage on a sparse graph. */
(function(K){
  const W=K.world, {clamp}=W.fields;
  const head=(node,stock)=>node.elevation+node.precharge+stock/node.area;
  const drop=(nodes,stocks,pipe,boost)=>head(nodes[pipe.from],stocks[pipe.from])+boost-head(nodes[pipe.to],stocks[pipe.to]);
  const zero=n=>new Float64Array(n);

  function advance({nodes,pipes,leaks,specificWeight},state,controls,dt){
    const volume=Float64Array.from(state.volume), position=state.position.slice(), size=nodes.length;
    const pipeFlow=zero(pipes.length), leakFlow=zero(leaks.length), outgoing=zero(size), incoming=zero(size), change=zero(size);
    const k=zero(size), heads=zero(size), amounts=zero(pipes.length), vents=zero(leaks.length);
    const conductance=pipes.map((edge,i)=>edge.conductance*controls.valves[i]);
    const venting=leaks.map((edge,i)=>edge.conductance*controls.leaks[i]);
    for(let i=0;i<pipes.length;i++){
      const {from,to}=pipes[i];
      k[from]+=conductance[i];k[to]+=conductance[i];
    }
    for(let i=0;i<leaks.length;i++)k[leaks[i].node]+=venting[i];
    const steps=Math.min(256,Math.max(1,Math.ceil(dt/.05))), h=dt/steps;
    const relax=nodes.map(({area},i)=>h*k[i]/area);
    let lost=0;
    for(let tick=0;tick<steps;tick++){
      outgoing.fill(0);incoming.fill(0);change.fill(0);
      for(let i=0;i<size;i++)heads[i]=head(nodes[i],volume[i]);
      for(let i=0;i<pipes.length;i++){
        const {from,to,oneWay,maxFlow,piston}=pipes[i];
        let force=heads[from]+controls.boosts[i]-heads[to];
        if(piston)force=Math.sign(force)*Math.max(0,Math.abs(force)-controls.loads[i]/(specificWeight*piston.area));
        let amount=conductance[i]*h*force/(1+relax[from]+relax[to]);
        amount=clamp(amount,oneWay?0:-maxFlow*h,maxFlow*h);
        if(piston)amount=clamp(amount,-position[i]*piston.area,(piston.stroke-position[i])*piston.area);
        amounts[i]=amount;
        const [source,target]=amount>=0?[from,to]:[to,from];
        outgoing[source]+=Math.abs(amount);incoming[target]+=Math.abs(amount);
      }
      for(let i=0;i<leaks.length;i++){
        const {node,outsideHead,maxFlow}=leaks[i];
        const amount=Math.min(maxFlow*h,venting[i]*h*Math.max(0,heads[node]-outsideHead)/(1+relax[node]));
        vents[i]=amount;outgoing[node]+=amount;
      }
      for(let i=0;i<pipes.length;i++){
        const requested=amounts[i];
        if(!requested)continue;
        const {from,to,piston}=pipes[i], [source,target]=requested>0?[from,to]:[to,from];
        const amount=Math.abs(requested)*Math.min(1,volume[source]/outgoing[source],
          (nodes[target].capacity-volume[target])/incoming[target]);
        change[source]-=amount;change[target]+=amount;
        const signed=Math.sign(requested)*amount;
        pipeFlow[i]+=signed;
        if(piston)position[i]=clamp(position[i]+signed/piston.area,0,piston.stroke);
      }
      for(let i=0;i<leaks.length;i++){
        if(!vents[i])continue;
        const {node}=leaks[i], amount=vents[i]*Math.min(1,volume[node]/outgoing[node]);
        change[node]-=amount;leakFlow[i]+=amount;lost+=amount;
      }
      for(let i=0;i<size;i++)volume[i]=clamp(volume[i]+change[i],0,nodes[i].capacity);
    }
    return {volume:Array.from(volume),position,pipeFlow:Array.from(pipeFlow,n=>n/dt),leakFlow:Array.from(leakFlow,n=>n/dt),lost};
  }
  W.hydraulicFlow=Object.freeze({head,drop,advance});
})(KIT);
