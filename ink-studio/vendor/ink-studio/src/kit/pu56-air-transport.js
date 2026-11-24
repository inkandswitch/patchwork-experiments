/* Fixed-volume, well-mixed rooms with balanced airflow and implicit tracer transport. */
(function(K){
  const W=K.world;
  const zero=n=>new Float64Array(n);
  const matrix=n=>Array.from({length:n},()=>zero(n));
  const total=values=>values.reduce((a,b)=>a+b,0);

  function factor(rows){
    const size=rows.length, order=Array.from({length:size},(_,i)=>i);
    for(let i=0;i<size;i++){
      let pivot=i;
      for(let j=i+1;j<size;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;
      [rows[i],rows[pivot]]=[rows[pivot],rows[i]];
      [order[i],order[pivot]]=[order[pivot],order[i]];
      for(let j=i+1;j<size;j++){
        if(rows[j][i]===0)continue;
        const weight=rows[j][i]/rows[i][i];
        rows[j][i]=weight;
        for(let k=i+1;k<size;k++)rows[j][k]-=weight*rows[i][k];
      }
    }
    return rhs=>{
      const values=Float64Array.from(order,i=>rhs[i]);
      for(let i=0;i<size;i++)for(let j=0;j<i;j++)values[i]-=rows[i][j]*values[j];
      for(let i=size-1;i>=0;i--){
        for(let j=i+1;j<size;j++)values[i]-=rows[i][j]*values[j];
        values[i]/=rows[i][i];
      }
      return values;
    };
  }

  function airflow(size,openings,settings){
    const rows=matrix(size), rhs=zero(size);
    const parents=Array.from({length:size+1},(_,i)=>i), outdoor=size;
    function root(i){
      while(parents[i]!==i){
        parents[i]=parents[parents[i]];
        i=parents[i];
      }
      return i;
    }
    const interior=i=>i<size;
    const include=(a,b,g,flow)=>{
      if(!interior(a))return;
      rows[a][a]+=g;rhs[a]-=flow;
      if(interior(b))rows[a][b]-=g;
    };
    openings.forEach(({from,to,conductance},i)=>{
      const {open,drive}=settings[i];
      if(!open)return;
      const a=interior(from)?from:outdoor, b=interior(to)?to:outdoor, g=open*conductance;
      parents[root(b)]=root(a);
      include(from,to,g,drive);include(to,from,g,-drive);
    });
    const pinned=new Set([root(outdoor)]);
    for(let i=0;i<size;i++){
      const component=root(i);
      if(pinned.has(component))continue;
      rows[i].fill(0);rows[i][i]=1;rhs[i]=0;pinned.add(component);
    }
    const pressure=factor(rows)(rhs);
    const flow=openings.map(({from,to,conductance},i)=>{
      const {open,drive}=settings[i];
      const value=drive+open*conductance*((pressure[from]??0)-(pressure[to]??0));
      return Math.abs(value)<1e-10?0:value;
    });
    return {pressure:Array.from(pressure),flow};
  }

  function transport(rooms,exterior,openings,settings,flow,tracers,stock,emissions,dt){
    const size=rooms.length, rows=matrix(size), external=[];
    for(let i=0;i<size;i++)rows[i][i]=rooms[i].volume;
    function pass(from,to,rate){
      if(!rate)return;
      const amount=rate*dt;
      if(from<size){
        rows[from][from]+=amount;
        if(to<size)rows[to][from]-=amount;
      }
      if(from>=size||to>=size)external.push({from,to,amount});
    }
    openings.forEach(({from,to,mixing},i)=>{
      const interchange=mixing*settings[i].open;
      pass(from,to,interchange+Math.max(0, flow[i]));
      pass(to,from,interchange+Math.max(0,-flow[i]));
    });
    const solve=factor(rows);
    return tracers.map(({decay},j)=>{
      const rhs=stock[j].map((value,i)=>value+emissions[j][i]);
      let imported=0, exported=0, removed=0;
      for(const {from,to,amount} of external)if(from>=size){
        const added=amount*exterior[from-size][j];
        rhs[to]+=added;imported+=added;
      }
      const concentration=solve(rhs);
      for(const {from,to,amount} of external)if(to>=size)exported+=amount*concentration[from];
      const loss=-Math.expm1(-decay*dt);
      const next=rooms.map(({volume},i)=>{
        const amount=Math.max(0,concentration[i])*volume, deposit=amount*loss;
        removed+=deposit;
        return amount-deposit;
      });
      return {stock:next,emitted:total(emissions[j]),imported,exported,removed};
    });
  }

  W.airTransport=Object.freeze({airflow,transport,total});
})(KIT);
