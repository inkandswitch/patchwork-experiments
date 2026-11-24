/* Periodic Hermite tracks and material-coordinate transport on deforming charts. */
const SurfaceVelocityProjection = (du, dv, velocity) => {
  const V = KIT.V, a = V.dot(du, du), b = V.dot(du, dv), c = V.dot(dv, dv);
  const u = V.dot(du, velocity), w = V.dot(dv, velocity), det = a * c - b * b;
  if (det <= 1e-10 * a * c || det <= 1e-24) return [0, 0];
  return [(c * u - b * w) / det, (a * w - b * u) / det];
};

(function (K) {
  const P=K.procedural,V=K.V,
    EPS=1e-10,
    bounded=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    point=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(v=>bounded(v,-1e7,1e7)),
    wrap=(n,a,b)=>a+(((n-a)%(b-a))+(b-a))%(b-a);

  function loopTrajectory(input,{period=1,tension=0}={}){
    if(!Array.isArray(input)||!integer(input.length,2,2048)||!bounded(period,1e-5,1e6)||!bounded(tension,0,1))
      throw new Error('Loop trajectories need a bounded periodic sequence');
    const knots=input.map((raw,i)=>{
      const {point:p,at=i/input.length,velocity} = Array.isArray(raw) ? {point:raw} : raw??{};
      if(!point(p,3)||!bounded(at,0,1)||at===1||(velocity!==undefined&&!point(velocity,3)))
        throw new Error('Loop knots need a phase below one and a finite position');
      return {at,p:p.slice(),provided:velocity?.slice()};
    });
    if(knots[0].at!==0||knots.some((k,i)=>i&&k.at-knots[i-1].at<EPS)||1-knots.at(-1).at<EPS)
      throw new Error('Loop phases must increase from zero with positive seam spacing');
    const velocities=knots.map((k,i)=>{
      const low=knots[(i+knots.length-1)%knots.length],high=knots[(i+1)%knots.length],
        span=high.at-low.at+(i===0||i===knots.length-1?1:0);
      return k.provided??V.mul(V.sub(high.p,low.p),(1-tension)/(period*span));
    });
    function sample(time){
      if(!Number.isFinite(time))throw new Error('Loop sample time must be finite');
      const tt=time%period, phase=(tt===0?0:tt<0?tt+period:tt)/period;
      let lo=0,hi=knots.length;
      while(hi-lo>1){
        const k=(lo+hi)>>1;
        if(knots[k].at<=phase)lo=k;
        else hi=k;
      }
      const a=knots[lo],b=knots[hi%knots.length],
        span=(hi===knots.length?1:b.at)-a.at,
        duration=span*period,t=(phase-a.at)/span,t2=t*t,t3=t2*t,
        va=velocities[lo],vb=velocities[hi%knots.length];
      return {phase,segment:lo,
        point:a.p.map((v,i)=>v*(2*t3-3*t2+1)+b.p[i]*(-2*t3+3*t2)+duration*(va[i]*(t3-2*t2+t)+vb[i]*(t3-t2))),
        velocity:a.p.map((v,i)=>(v*(6*t2-6*t)+b.p[i]*(-6*t2+6*t))/duration+
          va[i]*(3*t2-4*t+1)+vb[i]*(3*t2-2*t))
      };
    }
    return P.data.freeze({period,points:knots.map((k,i)=>({at:k.at,point:k.p,velocity:velocities[i]})),sample});
  }

  function surfaceAdvection(carrier,input,{
    velocity,time=0,step=0.05,epsilon=0.0025,min=[0,0],max=[1,1],wrap:periodic,boundary='clamp',
    maxUpdates=180000
  }={}){
    if(!(typeof carrier==='function'||typeof carrier?.sample==='function')||
      !Array.isArray(input)||input.length>18000||typeof velocity!=='function'||
      !bounded(time,-1e8,1e8)||!bounded(step,1e-5,5)||!bounded(epsilon,1e-7,0.1)||
      !point(min,2)||!point(max,2)||min.some((v,i)=>max[i]-v<1e-7)||
      (periodic!==undefined&&(!Array.isArray(periodic)||periodic.length!==2||!periodic.every(v=>typeof v==='boolean')))||
      !['clamp','stop'].includes(boundary)||!integer(maxUpdates,1,3000000))
      throw new Error('Surface advection needs a chart, bounded UV domain and velocity field');
    const lo=min.slice(),hi=max.slice(),ids=new Set(), explicit=periodic?.slice();
    let state=Array.from(input,(raw,i)=>{
      const {id=String(i),uv,data={}}=Array.isArray(raw)?{uv:raw}:raw??{};
      if(typeof id!=='string'||!id||id.length>240||ids.has(id)||!point(uv,2)||uv.some((v,i)=>!bounded(v,lo[i],hi[i])))
        throw new Error('Surface seeds need unique IDs and UV coordinates inside the chart');
      ids.add(id);
      return {id,uv:uv.slice(),data:P.data.freeze(P.data.clone(data)),active:true};
    });
    const original=state.slice(),started=time;
    function chartAt(t){
      const chart=typeof carrier==='function'?carrier(t):carrier;
      if(typeof chart?.sample!=='function')throw new Error('Surface carrier returned no chart');
      const topology=SurfaceChartTopologies.has(chart.topology)?chart.topology:null;
      const joins=topology?[topology.periodicU,topology.periodicV]:[Boolean(chart.periodicU),Boolean(chart.periodicV)];
      if(topology&&(lo.some((v,i)=>v!==0||hi[i]!==1)||
        explicit?.some((periodic,i)=>periodic&&!joins[i])))
        throw new Error('Lifted surface charts need their unit domain and can only wrap joined axes');
      return {chart,topology,periodic:explicit??joins};
    }
    function normalize(uv,chart){
      return uv.map((v,i)=>{
        if(chart.periodic[i])return chart.topology?v:wrap(v,lo[i],hi[i]);
        return Math.min(hi[i],Math.max(lo[i],v));
      });
    }
    function frame(chart,uv,t,derivatives){
      const lift=normalize(uv,chart),source=chart.chart.sample(lift,t);
      if(!point(source?.p,3)||!point(source?.n,3)||V.len(source.n)<EPS)
        throw new Error('Surface charts must return a finite position and normal');
      const normal=V.norm(source.n),sample={position:source.p.slice(),normal};
      if(chart.topology)Object.assign(sample,chart.topology.canonical(lift),{lift});
      if(!derivatives){
        const ref=point(source.tangent,3)?source.tangent:Math.abs(normal[0])<0.85?[1,0,0]:[0,0,1],
          tangent=V.mad(ref,normal,-V.dot(ref,normal));
        sample.tangent=V.len(tangent)>EPS?V.norm(tangent):V.norm(V.cross(Math.abs(normal[0])<0.85?[1,0,0]:[0,0,1],normal));
        sample.bitangent=V.cross(normal,sample.tangent);
        return sample;
      }
      const explicit=[source.du,source.dv];
      const d=uv.map((value,i)=>{
        if(point(explicit[i],3))return explicit[i];
        const a=uv.slice(),b=uv.slice(),h=Math.min(epsilon,(hi[i]-lo[i])*0.15);
        a[i]=chart.periodic[i]?value-h:Math.max(lo[i],value-h);
        b[i]=chart.periodic[i]?value+h:Math.min(hi[i],value+h);
        const A=chart.chart.sample(normalize(a,chart),t)?.p,C=chart.chart.sample(normalize(b,chart),t)?.p;
        if(!point(A,3)||!point(C,3))throw new Error('Surface finite differences must return finite positions');
        return V.mul(V.sub(C,A),1/(b[i]-a[i]));
      });
      sample.du=d[0];
      sample.dv=d[1];
      return sample;
    }
    function speed(chart,uv,t,particle){
      const s=frame(chart,uv,t,true),v=velocity(...s.position,t,{uv:s.uv??uv.slice(),normal:s.normal,id:particle.id,data:particle.data,
        ...(chart.topology&&{lift:s.lift,orientation:s.orientation,du:s.du.slice(),dv:s.dv.slice()})});
      if(!point(v,3))throw new Error('Surface velocities must be finite XYZ');
      return SurfaceVelocityProjection(s.du,s.dv,v);
    }
    function snapshot(){
      const chart=chartAt(time);
      return P.data.freeze({time,particles:state.map(({id,uv,data,active})=>({
        id, uv:uv.slice(),data,active,...frame(chart,uv,time,false)
      }))});
    }
    function advance(duration){
      if(!bounded(duration,0,60))throw new Error('Surface advection needs a nonnegative bounded duration');
      if(!duration)return snapshot();
      const n=Math.ceil(duration/step),h=duration/n;
      if(n*state.length>maxUpdates||n>60000)throw new Error('Surface advection exceeds its step budget');
      let draft=state;
      for(let j=0;j<n;j++){
        const t=time+j*h,a=chartAt(t),b=chartAt(t+h/2),c=chartAt(t+h);
        draft=draft.map(p=>{
          if(!p.active)return p;
          const q=speed(a,p.uv,t,p),half=normalize(p.uv.map((v,i)=>v+q[i]*h/2),b),
            final=speed(b,half,t+h/2,p),direct=p.uv.map((v,i)=>v+h*final[i]),
            active=boundary!=='stop'||direct.every((v,i)=>c.periodic[i]||bounded(v,lo[i],hi[i]));
          return {...p,uv:normalize(direct,c),active};
        });
      }
      // Resolve output before committing the new state, so a failed chart sample leaves the old state available.
      const nextTime=time+duration, chart=chartAt(nextTime), output=P.data.freeze({time:nextTime,particles:
        draft.map(p=>({...p,uv:p.uv.slice(),...frame(chart,p.uv,nextTime,false)}))});
      state=draft;
      time=nextTime;
      return output;
    }
    return Object.freeze({advance,snapshot,reset(){state=original.slice();time=started;return snapshot();}});
  }
  Object.assign(P.motion,{loopTrajectory,surfaceAdvection});
})(KIT);
