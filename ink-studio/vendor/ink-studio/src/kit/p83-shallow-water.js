/* Conservative shallow-water fluxes with hydrostatic reconstruction on a terrain grid. */
(function (K) {
  const P=K.procedural,M=P.motion,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    vector=p=>Array.isArray(p)&&p.length===2&&p.every(v=>number(v,-1e6,1e6));

  function shallowWater(options={}){
    const domain=M.gridDomain(options),{width,height,size,dx,dz,open,center,inside}=domain,
      {terrain=()=>0,initial,gravity=9.81,cfl=0.42,maxDt=0.055,maxSteps=2400,
        maxWork=90000000,maxDepth=2000,maxSpeed=80,dry=1e-6}=options;
    if(typeof terrain!=='function'||(initial!==undefined&&typeof initial!=='function')||
      !number(gravity,1e-5,1000)||!number(cfl,0.05,0.49)||!number(maxDt,1e-6,2)||
      !integer(maxSteps,1,12000)||!integer(maxWork,1,240000000)||
      !number(maxDepth,1e-4,1e5)||!number(maxSpeed,0.001,1e5)||!number(dry,1e-10,0.01))
      throw new Error('Shallow water needs bounded terrain, CFL and physical controls');
    let bed=new Float64Array(size), sharedBed;
    const initialDepth=new Float64Array(size),
      initialX=new Float64Array(size),initialZ=new Float64Array(size),cellArea=dx*dz;
    let time=0,added=0,drained=0,moved=0;
    for(let i=0;i<size;i++){
      const p=center(i), y=terrain(...p,i);
      if(!number(y,-1e7,1e7))throw new Error('Shallow water terrain heights must be finite');
      bed[i]=y;
      if(!open[i]||!initial)continue;
      const raw=initial(...p,y,i),{depth=0,velocity=[0,0]}=typeof raw==='number'?{depth:raw}:raw??{};
      if(!number(depth,0,maxDepth)||!vector(velocity)||Math.hypot(...velocity)>maxSpeed)
        throw new Error('Initial water needs bounded depth and velocity');
      initialDepth[i]=depth;
      initialX[i]=depth>dry?depth*velocity[0]:0;
      initialZ[i]=depth>dry?depth*velocity[1]:0;
    }
    const volume=data=>data.reduce((sum,v)=>sum+v,0)*cellArea,
      initialVolume=volume(initialDepth);
    let startVolume=initialVolume;
    let layer={depth:initialDepth,x:initialX,z:initialZ};
    function snapshot(substeps=0){
      const depth=layer.depth.slice(),bedCopy=bed.slice(),level=bed.map((v,i)=>v+depth[i]),
        vx=layer.x.map((v,i)=>depth[i]>dry?v/depth[i]:0),vz=layer.z.map((v,i)=>depth[i]>dry?v/depth[i]:0),
        water=volume(depth);
      return Object.freeze({time,width,height,bounds:domain.bounds,depth,level,bed:bedCopy,vx,vz,substeps,
        mass:Object.freeze({initial:startVolume,added,drained,transferred:moved,volume:water,error:water-startVolume-added+drained}),
        sample(x,z){return inside(x,z)?{
          depth:domain.sample(depth,x,z),level:domain.sample(level,x,z),
          bed:domain.sample(bedCopy,x,z),velocity:[domain.sample(vx,x,z),domain.sample(vz,x,z)]
        }:null;}});
    }
    function checkpoint({shareBed=false}={}){
      const terrain=shareBed?(sharedBed??=P.data.freeze(Array.from(bed))):Array.from(bed);
      return {time,added,drained,moved,startVolume,bed:terrain,depth:Array.from(layer.depth),
        mx:Array.from(layer.x),mz:Array.from(layer.z)};
    }
    function restore(state){
      if(!state||![state.time,state.added,state.drained,state.moved,state.startVolume].every(v=>number(v,0,1e15))||
        ![state.bed,state.depth,state.mx,state.mz].every(values=>Array.isArray(values)&&values.length===size)||
        (state.bed!==sharedBed&&!state.bed.every(v=>number(v,-1e7,1e7)))||
        !state.depth.every((v,i)=>number(v,0,maxDepth)&&(open[i]||v===0))||
        !state.mx.every((v,i)=>Number.isFinite(v)&&Number.isFinite(state.mz[i])&&
          Math.hypot(v,state.mz[i])<=maxSpeed*state.depth[i]+1e-7))
        throw new Error('Invalid shallow-water checkpoint');
      if(state.bed!==sharedBed)bed=Float64Array.from(state.bed);
      sharedBed=P.data.isImmutable(state.bed)?state.bed:undefined;
      layer={depth:Float64Array.from(state.depth),x:Float64Array.from(state.mx),z:Float64Array.from(state.mz)};
      ({time,added,drained,moved,startVolume}=state);
    }
    function setTerrain(height){
      if(typeof height!=='function')throw new Error('Terrain update needs a height sampler');
      const changed=bed.map((old,i)=>{
        const value=height(...center(i),i,old);
        if(!number(value,-1e7,1e7))throw new Error('Shallow water terrain heights must be finite');
        return value;
      });
      bed=changed;
      sharedBed=undefined;
    }
    function step(duration,{rain,drain,friction=0.13,opening,boundary,transfers=[],transport,bedOffset,
      cfl:stepCFL=cfl,maxDt:stepLimit=maxDt}={}){

      if(!number(duration,0,120)||!number(friction,0,1e6)||!number(stepCFL,.05,.49)||!number(stepLimit,1e-6,2)||
        (opening!==undefined&&typeof opening!=='function')||!Array.isArray(transfers)||transfers.length>4096||
        (boundary!==undefined&&!['edge','export','cell','apply'].every(key=>typeof boundary?.[key]==='function'))||
        (transport!==undefined&&!['begin','face','advect','drain','pump','settle'].every(key=>typeof transport?.[key]==='function'))||
        (bedOffset!==undefined&&(!Array.isArray(bedOffset)||bedOffset.length!==size||!bedOffset.every(v=>number(v,0,1e7))))||
        transfers.some(p=>!p||!integer(p.from,0,size-1)||!integer(p.to,0,size-1)||p.from===p.to||
          !open[p.from]||!open[p.to]||!number(p.rate,0,1e9))||
        [rain,drain].some(v=>v!==undefined&&typeof v!=='function'&&!number(v,0,1e4)))
        throw new Error('Water steps need bounded time, friction and nonnegative source rates');
      if(!duration)return snapshot();
      const depth=layer.depth.slice(),mx=layer.x.slice(),mz=layer.z.slice(),
        dh=new Float64Array(size),du=new Float64Array(size),dv=new Float64Array(size),heightmap=transport?bed.slice():bed;
      const floor=i=>heightmap[i]+(bedOffset?.[i]??0);
      let elapsed=0,substeps=0,totalRain=0,totalDrain=0,totalMoved=0,dt;
      function faceFlux(left,right,axis,fraction,edge){
        if(!fraction||left<0&&right<0)return;
        const li=left<0?right:left,ri=right<0?left:right,
          a=edge!==undefined&&left<0?0:depth[li],b=edge!==undefined&&right<0?0:depth[ri],az=floor(li),bz=floor(ri),
          surface=Math.max(az,bz),al=Math.max(0,a+az-surface),br=Math.max(0,b+bz-surface);
        if(a<=0&&b<=0)return;
        let ax=a>dry?mx[li]/a:0,ay=a>dry?mz[li]/a:0,bx=b>dry?mx[ri]/b:0,by=b>dry?mz[ri]/b:0;
        if(axis===0){if(left<0)ax=-ax;if(right<0)bx=-bx;}
        else{if(left<0)ay=-ay;if(right<0)by=-by;}
        const au=axis===0?ax:ay,bu=axis===0?bx:by,av=axis===0?ay:ax,bv=axis===0?by:bx,
          alU=al*au,alV=al*av,brU=br*bu,brV=br*bv,
          g0=gravity*0.5, speed=Math.max(Math.abs(au)+Math.sqrt(gravity*al),Math.abs(bu)+Math.sqrt(gravity*br)),
          fluxH=0.5*(alU+brU-speed*(br-al)),
          fluxU=0.5*(alU*au+brU*bu+g0*(al*al+br*br)-speed*(brU-alU)),
          fluxV=0.5*(alU*av+brU*bv-speed*(brV-alV)),
          correctedL=fluxU+g0*(a*a-al*al),correctedR=fluxU+g0*(b*b-br*br),
          measure=fraction/(axis===0?dx:dz);
        if(edge!==undefined&&fluxH){
          const cell=left<0?right:left, loss=Math.abs(measure*fluxH);
          transport?.exit?.(cell,loss);
          const volume=loss*dt*cellArea;
          boundary.export(cell,edge,volume);
          totalDrain+=volume;
        }else if(transport&&left>=0&&right>=0&&fluxH)transport.face(left,right,measure*fluxH);
        if(left>=0){
          dh[left]-=measure*fluxH;
          du[left]-=measure*(axis===0?correctedL:fluxV);
          dv[left]-=measure*(axis===0?fluxV:correctedL);
        }
        if(right>=0){
          dh[right]+=measure*fluxH;
          du[right]+=measure*(axis===0?correctedR:fluxV);
          dv[right]+=measure*(axis===0?fluxV:correctedR);
        }
      }
      function interfaceFlux(left,right,axis,edge){
        if(boundary&&edge!==undefined&&(left>=0||right>=0)){
          const fraction=boundary.edge(Math.max(left,right),edge);
          if(!number(fraction,0,1))throw new Error('Water edge opening must be in [0, 1]');
          faceFlux(left,right,axis,fraction,edge);
          faceFlux(left,right,axis,1-fraction);
          return;
        }
        if(!opening||left<0||right<0){faceFlux(left,right,axis,1);return;}
        const [x,z]=center(left).map((v,i)=>(v+center(right)[i])*.5);
        const a=floor(left), b=floor(right);
        const fraction=opening(x,z,axis,left,right,{time:time+elapsed,bed:[a,b],level:[a+depth[left],b+depth[right]],
          ...(bedOffset&&{terrain:[heightmap[left],heightmap[right]]})});
        if(!number(fraction,0,1))throw new Error('Water face opening must be in [0, 1]');
        faceFlux(left,right,axis,fraction);
        if(fraction<1){
          faceFlux(left,-1,axis,1-fraction);
          faceFlux(-1,right,axis,1-fraction);
        }
      }
      while(elapsed<duration-1e-13){
        if(substeps>=maxSteps||(substeps+1)*size*9>maxWork)
          throw new Error('Water step exceeds its work or CFL budget');
        let waveX=0,waveZ=0;
        for(let i=0;i<size;i++)if(open[i]){
          const d=depth[i], wave=Math.sqrt(gravity*d);
          waveX=Math.max(waveX,wave+(d>dry?Math.abs(mx[i]/d):0));
          waveZ=Math.max(waveZ,wave+(d>dry?Math.abs(mz[i]/d):0));
        }
        const speed=waveX/dx+waveZ/dz;
        dt=Math.min(duration-elapsed,stepLimit,speed?stepCFL/speed:Infinity);
        dh.fill(0);du.fill(0);dv.fill(0);
        transport?.begin(dt);
        for(let z=0;z<height;z++)for(let x=0;x<=width;x++){
          const j=z*width+x,left=x>0&&open[j-1]?j-1:-1,right=x<width&&open[j]?j:-1;
          interfaceFlux(left,right,0,boundary?(x===0?0:x===width?1:undefined):undefined);
        }
        for(let z=0;z<=height;z++)for(let x=0;x<width;x++){
          const j=z*width+x,left=z>0&&open[j-width]?j-width:-1,right=z<height&&open[j]?j:-1;
          interfaceFlux(left,right,1,boundary?(z===0?2:z===height?3:undefined):undefined);
        }
        transport?.advect(depth);
        const t=time+elapsed,drag=Math.exp(-friction*dt);
        for(let i=0;i<size;i++){
          if(!open[i])continue;
          const wet=depth[i]+dt*dh[i];
          if(wet < -1e-7 || !number(wet,-1e-7,maxDepth))throw new Error('Water depth left its stable range');
          const d=Math.max(0,wet),
            u=(mx[i]+dt*du[i])*drag,v=(mz[i]+dt*dv[i])*drag;
          let inFlow=0,outFlow=0;
          if(rain||drain){
            const p=center(i),state={depth:d,level:floor(i)+d,bed:floor(i)},
              r=typeof rain==='function'?rain(...p,t,state):rain??0,
              s=typeof drain==='function'?drain(...p,t,state):drain??0;
            if(!number(r,0,1e4)||!number(s,0,1e4))throw new Error('Water source and drainage rates must be finite');
            inFlow=r*dt;
            outFlow=Math.min(d+inFlow,s*dt);
            if(inFlow)transport?.rain?.(i,inFlow);
            if(outFlow)transport?.drain(i,outFlow,d+inFlow);
          }
          const next=d+inFlow-outFlow,retain=next<=dry||d<=dry?0:Math.min(1,next/d),
            magnitude=retain*Math.hypot(u,v);
          if(!number(next,0,maxDepth)||!Number.isFinite(magnitude))throw new Error('Water state left its finite range');
          const lim=magnitude?Math.min(1,maxSpeed*next/magnitude):1;
          depth[i]=next;
          mx[i]=u*retain*lim;
          mz[i]=v*retain*lim;
          totalRain+=inFlow*cellArea;
          totalDrain+=outFlow*cellArea;
          if(boundary?.cell(i))boundary.apply(i,dt,floor(i),next,amount=>{
            if(!Number.isFinite(amount))throw new Error('Water boundary exchange needs a finite depth');
            const before=depth[i], after=Math.min(maxDepth,Math.max(0,before+amount)), applied=after-before;
            if(applied>0){
              transport?.rain?.(i,applied);
              totalRain+=applied*cellArea;
            }else if(applied<0){
              transport?.drain(i,-applied,before);
              totalDrain-=applied*cellArea;
              mx[i]*=after/before;
              mz[i]*=after/before;
            }
            depth[i]=after;
            return applied;
          });
        }
        for(const {from,to,rate} of transfers){
          const take=Math.min(depth[from],maxDepth-depth[to],rate*dt/cellArea);
          if(!take)continue;
          transport?.pump(from,to,take,depth[from]);
          const remaining=(depth[from]-take)/depth[from];
          depth[from]-=take;depth[to]+=take;
          mx[from]*=remaining;mz[from]*=remaining;
          totalMoved+=take*cellArea;
        }
        transport?.settle(heightmap,depth,mx,mz,dt,dry);
        elapsed+=dt;substeps++;
      }
      layer={depth,x:mx,z:mz};
      if(bed!==heightmap)sharedBed=undefined;
      bed=heightmap;
      time+=duration;added+=totalRain;drained+=totalDrain;moved+=totalMoved;
      return snapshot(substeps);
    }
    return Object.freeze({step,snapshot,checkpoint,restore,setTerrain});
  }
  M.shallowWater=shallowWater;
})(KIT);
