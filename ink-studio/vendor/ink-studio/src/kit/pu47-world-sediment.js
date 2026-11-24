/* Suspended sediment rides the hydraulic solver's conservative water flux. */
(function(K){
  const W=K.world, {record,check}=W.data, {regions,patchList}=W.fields;
  const minHeight=-1e7, maxHeight=1e7;
  const number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
  const counters=['initial','fed','editedIn','editedOut','eroded','deposited','advected','pumped','exported'];
  const sum=values=>values.reduce((total,n)=>total+n,0);

  function create(config,{width,height,cellArea,point}){
    check(record(config)&&Object.keys(config).every(key=>['erodibleDepth','erodible','initial','capacity',
      'maxConcentration','settling','erosion','drainFraction'].includes(key)), 'Invalid live sediment settings');
    const {erodibleDepth=.5,capacity=.18,maxConcentration=.55,settling=1.4,drainFraction=0}=config;
    const erosion=config.erosion??{}, {threshold=.12,rate=.06}=erosion;
    check(record(erosion)&&Object.keys(erosion).every(key=>['threshold','rate'].includes(key))&&
      number(erodibleDepth,0,1e7)&&number(capacity,0,1e4)&&number(maxConcentration,0,1e4)&&
      number(settling,0,1e4)&&number(drainFraction,0,1)&&number(threshold,0,1e4)&&number(rate,0,1e4),
    'Invalid sediment capacity, erodibility or settling rate');
    const erodible=patchList(config.erodible??[],2), initial=patchList(config.initial??[],2), size=width*height;
    check([...erodible,...initial].every(row=>number(row.value,0,1e7)),'Sediment layers need nonnegative thickness');

    function boot(bed){
      const bedrock=bed.map((y,i)=>Math.max(minHeight,y-regions(erodible,point(i),erodibleDepth)));
      const suspended=bed.map((_,i)=>regions(initial,point(i),0));
      const totals=Object.fromEntries(counters.map(key=>[key,0]));
      totals.initial=(sum(suspended)+bed.reduce((n,y,i)=>n+(y-bedrock[i]),0))*cellArea;
      return {bedrock,datum:bed.slice(),suspended,totals};
    }
    function report(state,bed){
      const bedVolume=bed.reduce((n,y,i)=>n+(y-state.bedrock[i]),0)*cellArea;
      const suspendedVolume=sum(state.suspended)*cellArea, {totals}=state;
      return {bed:bedVolume,suspended:suspendedVolume,volume:bedVolume+suspendedVolume,...totals,
        error:bedVolume+suspendedVolume+totals.exported+totals.editedOut-totals.initial-totals.fed-totals.editedIn};
    }
    function validate(state,bed){
      check(record(state)&&['bedrock','datum','suspended'].every(k=>Array.isArray(state[k])&&state[k].length===size)&&
        state.bedrock.every((y,i)=>number(y,minHeight,bed[i]))&&state.datum.every(y=>number(y,minHeight,maxHeight))&&
        state.suspended.every(v=>Number.isFinite(v)&&v>=0)&&record(state.totals)&&
        counters.every(k=>Number.isFinite(state.totals[k])&&state.totals[k]>=0),'Invalid saved sediment state');
      const {error,initial,fed,editedIn}=report(state,bed);
      check(Math.abs(error)<1e-7*Math.max(1,initial+fed+editedIn),'Saved sediment balance does not conserve material');
    }
    function edit(state,before,after,changed){
      const bedrock=state.bedrock.slice(), datum=state.datum.slice(), totals={...state.totals};
      for(const i of changed){
        const previous=before[i]-bedrock[i];
        bedrock[i]=Math.min(after[i],bedrock[i]);
        const change=(after[i]-bedrock[i]-previous)*cellArea;
        totals.editedIn+=Math.max(0,change);totals.editedOut+=Math.max(0,-change);
        datum[i]=after[i];
      }
      return {...state,bedrock,datum,totals};
    }
    function feed(state,cells,thickness){
      const suspended=state.suspended.slice(), totals={...state.totals};
      for(const i of cells){
        const next=suspended[i]+thickness;
        totals.fed+=(next-suspended[i])*cellArea;
        suspended[i]=next;
      }
      return {...state,suspended,totals};
    }
    function coupling(state,materialAt){
      const suspended=Float64Array.from(state.suspended), {bedrock}=state, totals={...state.totals};
      const out=new Float64Array(size), delta=new Float64Array(size), share=new Float64Array(size);
      const src=new Uint32Array(size*2), dst=new Uint32Array(size*2), flux=new Float64Array(size*2);
      let count=0, dt, lost, minX=width,minZ=height,maxX=-1,maxZ=-1;
      function changed(i){
        const x=i%width,z=Math.floor(i/width);
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
      }
      function take(i,amount,available){
        const part=suspended[i]*Math.min(1,amount/available), old=suspended[i];
        suspended[i]=old-part;
        return old-suspended[i];
      }
      return {begin(seconds){
        dt=seconds;count=0;out.fill(0);lost?.fill(0);
      },face(left,right,rate){
        const source=rate>0?left:right, destination=rate>0?right:left, volume=Math.abs(rate)*dt;
        src[count]=source;dst[count]=destination;flux[count++]=volume;
        out[source]+=volume;
      },exit(source,rate){
        lost??=new Float64Array(size);
        const amount=rate*dt;
        lost[source]+=amount;
        out[source]+=amount;
      },advect(depth){
        delta.fill(0);
        for(let i=0;i<size;i++)share[i]=out[i]>0?suspended[i]/Math.max(out[i],depth[i]):0;
        for(let k=0;k<count;k++){
          const moved=flux[k]*share[src[k]];
          delta[src[k]]-=moved;delta[dst[k]]+=moved;
          totals.advected+=moved*cellArea;
        }
        if(lost)for(let i=0;i<size;i++)if(lost[i]){
          const exported=lost[i]*share[i];
          delta[i]-=exported;
          totals.exported+=exported*cellArea;
        }
        for(let i=0;i<size;i++)suspended[i]=Math.max(0,suspended[i]+delta[i]);
      },drain(i,amount,available){
        if(drainFraction)totals.exported+=take(i,amount*drainFraction,available)*cellArea;
      },pump(from,to,amount,available){
        const moved=take(from,amount,available);
        suspended[to]+=moved;
        totals.pumped+=moved*cellArea;
      },settle(bed,depth,mx,mz,seconds,dry){
        const settlingFraction=-Math.expm1(-settling*seconds);
        for(let i=0;i<size;i++){
          const water=depth[i], wet=water>dry, speed=wet?Math.hypot(mx[i],mz[i])/water:0;
          const carrying=water*Math.min(maxConcentration,capacity*speed), gap=carrying-suspended[i];
          const floor=bed[i];
          if(gap>0&&wet&&floor>bedrock[i]){
            const profile=materialAt?.(i)?.erosion;
            const wear=Math.max(0,speed-(profile?.threshold??threshold))*(profile?.rate??rate)*seconds;
            bed[i]=Math.max(bedrock[i],floor-Math.min(gap,wear));
            const eroded=floor-bed[i];
            suspended[i]+=eroded;
            totals.eroded+=eroded*cellArea;
          }else if(gap<0){
            bed[i]=Math.min(maxHeight,floor-gap*(wet?settlingFraction:1));
            const deposited=bed[i]-floor;
            suspended[i]=Math.max(0,suspended[i]-deposited);
            totals.deposited+=deposited*cellArea;
          }
          if(bed[i]!==floor)changed(i);
        }
      },checkpoint(){return {...state,suspended:Array.from(suspended),totals};},
        dirty:()=>maxX<0?null:{minX,minZ,maxX,maxZ}};
    }
    return Object.freeze({boot,report,validate,edit,feed,coupling});
  }
  W.sediment=Object.freeze({create});
})(KIT);
