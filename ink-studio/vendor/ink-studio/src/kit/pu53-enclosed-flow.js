/* Conservative liquid exchange and isothermal air in a graph of chambers. */
(function(K){
  const W=K.world, {clamp}=W.fields;
  const total=values=>values.reduce((a,b)=>a+b,0);
  const level=(room,water)=>Math.min(room.ceiling,room.floor+water/room.area);
  const empty=(room,water)=>Math.max(0,room.capacity-water);
  const airSpace=(room,water)=>Math.max(room.capacity*1e-6,empty(room,water));
  const dryVent=(room,height,surface)=>surface<height||height===room.ceiling;

  function air(layout,water,gas,opening,vent){
    const {rooms,doors,vents}=layout;
    const levels=rooms.map((room,i)=>level(room,water[i]));
    const space=rooms.map((room,i)=>airSpace(room,water[i]));
    const physical=rooms.map((room,i)=>empty(room,water[i]));
    const parent=rooms.map((_,i)=>i);
    function root(i){
      while(parent[i]!==i){
        parent[i]=parent[parent[i]];
        i=parent[i];
      }
      return i;
    }
    doors.forEach(({from,to,inlet,outlet},i)=>{
      if(opening[i]>0&&levels[from]<inlet.crown&&levels[to]<outlet.crown)parent[root(to)]=root(from);
    });
    const groups=rooms.map(()=>({gas:0,space:0,vented:false}));
    vents.forEach(({room,height},i)=>{
      if(vent[i]&&dryVent(rooms[room],height,levels[room]))groups[root(room)].vented=true;
    });
    for(let i=0;i<rooms.length;i++){
      const group=groups[root(i)];
      group.gas+=gas[i];
      group.space+=physical[i];
    }
    const vented=[];
    const contents=rooms.map((_,i)=>{
      const group=groups[root(i)];
      vented.push(group.vented);
      if(group.vented)return physical[i];
      if(group.space===0)return gas[i];
      return group.gas*(physical[i]/group.space);
    });
    const ratios=rooms.map((_,i)=>vented[i]?1:contents[i]/space[i]);
    const exchanged=total(groups.map(group=>group.vented?group.space-group.gas:0));
    return {gas:contents,ratios,vented,exchanged};
  }

  function hydraulic(layout,index,water,ratios,vented,port){
    const {rooms,ambient,specificWeight}=layout, room=rooms[index];
    const surface=level(room,water[index]), head=Math.max(surface,port.sill)+(ratios[index]-1)*ambient/specificWeight;
    const slope=1/room.area+(vented[index]?0:ratios[index]*ambient/(specificWeight*airSpace(room,water[index])));
    const stock=Math.max(0,Math.min(water[index],(surface-port.sill)*room.area));
    return {head,slope,stock,fraction:clamp((surface-port.sill)/(port.crown-port.sill),0,1)};
  }
  function exchange(layout,state,opening,vent,dt){
    const {rooms,doors}=layout, water=state.water.slice(), flow=doors.map(()=>0);
    const steps=Math.min(128,Math.max(1,Math.ceil(dt/.04))), h=dt/steps;
    let gas=state.gas, airExchange=state.airExchange;
    for(let step=0;step<steps;step++){
      const mixed=air(layout,water,gas,opening,vent);
      gas=mixed.gas;
      airExchange+=mixed.exchanged;
      const incoming=rooms.map(()=>0), outgoing=rooms.map(()=>[]), conductance=rooms.map(()=>0), candidates=[];
      doors.forEach(({from,to,inlet,outlet,k,maxFlow},i)=>{
        if(opening[i]===0||k===0||maxFlow===0)return;
        const a=hydraulic(layout,from,water,mixed.ratios,mixed.vented,inlet);
        const b=hydraulic(layout,to,water,mixed.ratios,mixed.vented,outlet);
        const sign=Math.sign(a.head-b.head);
        if(sign===0)return;
        const [source,target,donor,receiver]=sign>0?[from,to,a,b]:[to,from,b,a];
        const strength=k*opening[i]*donor.fraction;
        if(strength===0||donor.stock===0)return;
        conductance[source]+=strength;
        conductance[target]+=strength;
        candidates.push({i,sign,source,target,stock:donor.stock,strength,drop:Math.abs(a.head-b.head),
          sourceSlope:donor.slope,targetSlope:receiver.slope,maxFlow});
      });
      for(const row of candidates){
        const {source,target,stock,strength,drop,sourceSlope,targetSlope,maxFlow}=row;
        const relax=h*(conductance[source]*sourceSlope+conductance[target]*targetSlope);
        row.request=Math.min(stock,maxFlow*h,strength*h*drop/(1+relax));
        outgoing[source].push(row);
      }
      // Higher sills can use only the water above them. Share that layer among equal sills.
      for(const group of outgoing){
        group.sort((a,b)=>a.stock-b.stock);
        let used=0;
        for(let start=0;start<group.length;){
          let end=start+1, request=group[start].request;
          while(end<group.length&&group[end].stock===group[start].stock)request+=group[end++].request;
          const scale=request>0?Math.min(1,Math.max(0,group[start].stock-used)/request):0;
          for(let i=start;i<end;i++){
            const row=group[i];
            row.amount=row.request*scale;
            used+=row.amount;
            incoming[row.target]+=row.amount;
          }
          start=end;
        }
      }
      const change=rooms.map(()=>0);
      for(const {i,source,target,sign,amount} of candidates){
        if(!amount)continue;
        const accepted=amount*Math.min(1,empty(rooms[target],water[target])/incoming[target]);
        change[source]-=accepted;
        change[target]+=accepted;
        flow[i]+=sign*accepted;
      }
      for(let i=0;i<rooms.length;i++)water[i]=clamp(water[i]+change[i],0,rooms[i].capacity);
    }
    const mixed=air(layout,water,gas,opening,vent);
    return {water,gas:mixed.gas,vented:mixed.vented,flow:flow.map(value=>value/dt),
      airExchange:airExchange+mixed.exchanged};
  }
  W.enclosedFlow=Object.freeze({level,empty,airSpace,dryVent,air,hydraulic,exchange,total});
})(KIT);
