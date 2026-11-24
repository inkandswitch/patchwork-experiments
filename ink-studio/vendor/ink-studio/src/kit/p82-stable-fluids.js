/* Closed staggered-grid flow with implicit diffusion and semi-Lagrangian advection. */
(function (K) {
  const P=K.procedural,M=P.motion,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    vector=p=>Array.isArray(p)&&p.length===2&&number(p[0],-1e7,1e7)&&number(p[1],-1e7,1e7),
    record=v=>v!=null&&[Object.prototype,null].includes(Object.getPrototypeOf(v)),
    clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function bilinear(data,width,height,x,z,mask){
    const u=clamp(x,0,width-1),v=clamp(z,0,height-1),
      ix=Math.floor(u),iz=Math.floor(v),jx=Math.min(ix+1,width-1),jz=Math.min(iz+1,height-1),
      fx=u-ix,fz=v-iz,i=iz*width+ix,j=iz*width+jx,k=jz*width+ix,l=jz*width+jx;
    let a=(1-fx)*(1-fz),b=fx*(1-fz),c=(1-fx)*fz,d=fx*fz;
    if(mask){a*=mask[i];b*=mask[j];c*=mask[k];d*=mask[l];}
    const total=a+b+c+d;
    return total?(a*data[i]+b*data[j]+c*data[k]+d*data[l])/total:0;
  }
  function gridSpacing({width,height,cell=0.1,origin=[0,0],mask}={}){
    const spacing=typeof cell==='number'?[cell,cell]:cell;
    if(!integer(width,1,768)||!integer(height,1,768)||width*height>220000||
      !vector(spacing)||!spacing.every(v=>number(v,1e-5,10000))||!vector(origin)||
      (mask!==undefined&&typeof mask!=='function')) throw new Error('Motion grids need finite XZ dimensions and spacing');
    return spacing;
  }
  function gridDomain({width,height,cell,origin=[0,0],mask}={}){
    const [dx,dz]=gridSpacing({width,height,cell,origin,mask}),[ox,oz]=origin,size=width*height,
      bounds={min:[ox,oz],max:[ox+dx*width,oz+dz*height]},
      open=new Uint8Array(size),xAt=i=>ox+(i%width+0.5)*dx,zAt=i=>oz+(Math.floor(i/width)+0.5)*dz,
      center=i=>[xAt(i),zAt(i)];
    for(let i=0;i<size;i++)open[i]=Number(!mask||Boolean(mask(xAt(i),zAt(i),i)));
    const available=(i,j)=>i>=0&&i<width&&j>=0&&j<height&&Boolean(open[j*width+i]);
    const column=x=>Math.min(width-1,Math.floor((x-ox)/dx));
    const row=z=>Math.min(height-1,Math.floor((z-oz)/dz));
    function inside(x,z){
      return Number.isFinite(x)&&Number.isFinite(z)&&x>=ox&&x<=bounds.max[0]&&z>=oz&&z<=bounds.max[1]&&
        available(column(x),row(z));
    }
    function trace(x,z,qx,qz){
      if(!inside(x,z)||!Number.isFinite(qx)||!Number.isFinite(qz))return 0;
      let c=column(x),r=row(z);
      const ax=(qx-x)/dx,az=(qz-z)/dz,sx=Math.sign(ax),sz=Math.sign(az);
      const stepX=ax?1/Math.abs(ax):Infinity,stepZ=az?1/Math.abs(az):Infinity;
      let tx=ax?(c+Number(sx>0)-(x-ox)/dx)/ax:Infinity,
        tz=az?(r+Number(sz>0)-(z-oz)/dz)/az:Infinity;
      for(;;){
        const t=Math.min(tx,tz);
        if(t>1)return 1;
        const cx=tx<=t+1e-12,cz=tz<=t+1e-12,i=c+(cx?sx:0),j=r+(cz?sz:0);
        if(!available(i,j)||cx&&cz&&(!available(i,r)||!available(c,j))){
          const roundoff=4*Number.EPSILON,
            bx=cx?Math.max(1e-8,roundoff*Math.max(Math.abs(x),Math.abs(qx))/dx)*stepX:0,
            bz=cz?Math.max(1e-8,roundoff*Math.max(Math.abs(z),Math.abs(qz))/dz)*stepZ:0;
          return Math.max(0,t-Math.max(bx,bz));
        }
        c=i;
        r=j;
        if(cx)tx+=stepX;
        if(cz)tz+=stepZ;
      }
    }
    function distribute(x,z,write){
      if(!inside(x,z))return;
      const col=column(x),line=row(z),u=clamp((x-ox)/dx-.5,0,width-1),
        v=clamp((z-oz)/dz-.5,0,height-1),a=Math.floor(u),b=Math.floor(v),fu=u-a,fv=v-b;
      function weight(c,r,w){
        return w&&available(c,r)&&(c===col||r===line||available(c,line)&&available(col,r))?w:0;
      }
      const p=weight(a,b,(1-fu)*(1-fv)),q=weight(a+1,b,fu*(1-fv)),
        s=weight(a,b+1,(1-fu)*fv),t=weight(a+1,b+1,fu*fv),sum=p+q+s+t;
      if(p)write(b*width+a,p/sum);
      if(q)write(b*width+a+1,q/sum);
      if(s)write((b+1)*width+a,s/sum);
      if(t)write((b+1)*width+a+1,t/sum);
    }
    return {width,height,size,dx,dz,ox,oz,bounds:P.data.freeze(bounds),open,center,inside,trace,distribute,
      sample:(data,x,z)=>inside(x,z)?bilinear(data,width,height,(x-ox)/dx-0.5,(z-oz)/dz-0.5,open):0};
  }
  function stableFluid(options={}){
    const domain=gridDomain(options),{width:w,height:h,size,dx,dz,ox,oz,open,center,inside}=domain,
      {initial,maxDt=0.045,maxSpeed=12,maxDensity=50,pressureIterations=28,diffusionIterations=10,
        maxTracing=40,maxWork=92000000,dyes={}}=options;
    if(!record(dyes)||Object.keys(dyes).length>8||size*Object.keys(dyes).length>880000)
      throw new Error('Stable fluids need a bounded dye channel map');
    const names=Object.freeze(Object.keys(dyes)),indices=new Map(names.map((name,i)=>[name,i]));
    const dyeSettings=names.map(name=>{
      const settings=dyes[name];
      if(!/^[a-z][\w-]*$/i.test(name)||!record(settings)) throw new Error('Invalid fluid dye channel');
      const {diffusion=0.001,dissipation=0.025}=settings;
      if(!number(diffusion,0,1e8)||!number(dissipation,0,1e8)) throw new Error('Invalid fluid dye transport');
      return {diffusion,dissipation};
    });
    function eachDye(values,use){
      if(values==null)return;
      if(!record(values))throw new Error('Fluid dye values need a channel map');
      for(const [name,value] of Object.entries(values)){
        const i=indices.get(name);
        if(i===undefined)throw new Error('Unknown fluid dye channel '+name);
        use(i,value);
      }
    }
    if((initial!==undefined&&typeof initial!=='function')||!number(maxDt,1e-5,1)||
      !number(maxSpeed,1e-4,1e5)||!number(maxDensity,1e-4,1e6)||!integer(pressureIterations,2,240)||
      !integer(diffusionIterations,1,80)||!integer(maxTracing,4,128)||!integer(maxWork,1,260000000))
      throw new Error('Stable fluids need bounded pressure, diffusion and travel controls');
    const uw=w+1,vh=h+1,uf=new Uint8Array(uw*h),vf=new Uint8Array(w*vh),
      X=1/(dx*dx),Z=1/(dz*dz),zeroU=new Float64Array(uw*h),zeroV=new Float64Array(w*vh);
    for(let z=0;z<h;z++)for(let x=1;x<w;x++)uf[z*uw+x]=open[z*w+x-1]&open[z*w+x];
    for(let z=1;z<h;z++)for(let x=0;x<w;x++)vf[z*w+x]=open[(z-1)*w+x]&open[z*w+x];
    const fields={u:zeroU,v:zeroV,density:new Float64Array(size),dyes:names.map(()=>new Float64Array(size))};
    const saved=new WeakMap();
    let time=0,stepping=false;
    function velocityAt(u,v,x,z){
      return [bilinear(u,uw,h,(x-ox)/dx,(z-oz)/dz-0.5),bilinear(v,w,vh,(x-ox)/dx-0.5,(z-oz)/dz)];
    }
    function cellVelocity(u,v,i){
      const x=i%w,z=Math.floor(i/w),a=z*uw+x,b=z*w+x;
      return [(u[a]+u[a+1])*0.5,(v[b]+v[b+w])*0.5];
    }
    function divergence(u,v,i){
      const x=i%w,z=Math.floor(i/w),a=z*uw+x,b=z*w+x;
      return (u[a+1]-u[a])/dx+(v[b+w]-v[b])/dz;
    }
    function project(u,v){
      const pressure=new Float64Array(size), div=new Float64Array(size), local=new Float64Array(size);
      for(let z=0,i=0;z<h;z++)for(let x=0;x<w;x++,i++){
        if(!open[i])continue;
        div[i]=divergence(u,v,i);
        local[i]=X*((x&&open[i-1]?1:0)+(x+1<w&&open[i+1]?1:0))+
          Z*((z&&open[i-w]?1:0)+(z+1<h&&open[i+w]?1:0));
      }
      for(let k=0;k<pressureIterations;k++)for(let z=0,i=0;z<h;z++)for(let x=0;x<w;x++,i++){
        if(!local[i])continue;
        const p=X*((x&&open[i-1]?pressure[i-1]:0)+(x+1<w&&open[i+1]?pressure[i+1]:0))+
          Z*((z&&open[i-w]?pressure[i-w]:0)+(z+1<h&&open[i+w]?pressure[i+w]:0));
        pressure[i]=(p-div[i])/local[i];
      }
      for(let z=0;z<h;z++)for(let x=1;x<w;x++)if(uf[z*uw+x]){
        const i=z*w+x;
        u[z*uw+x]-=(pressure[i]-pressure[i-1])/dx;
      }
      for(let z=1;z<h;z++)for(let x=0;x<w;x++)if(vf[z*w+x]){
        const i=z*w+x;
        v[i]-=(pressure[i]-pressure[i-w])/dz;
      }
    }
    const initX=new Float64Array(size),initZ=new Float64Array(size);
    for(let i=0;i<size;i++){
      if(!open[i]||!initial)continue;
      const {density=0,velocity=[0,0],dyes:pigment}=initial(...center(i),i)??{};
      if(!number(density,0,maxDensity)||!vector(velocity))
        throw new Error('Initial fluid values must be finite');
      fields.density[i]=density;
      eachDye(pigment,(channel,value)=>{
        if(!number(value,0,maxDensity))throw new Error('Initial fluid dye values must be finite and bounded');
        fields.dyes[channel][i]=value;
      });
      initX[i]=clamp(velocity[0],-maxSpeed,maxSpeed);
      initZ[i]=clamp(velocity[1],-maxSpeed,maxSpeed);
    }
    for(let z=0;z<h;z++)for(let x=1;x<w;x++)if(uf[z*uw+x])zeroU[z*uw+x]=(initX[z*w+x-1]+initX[z*w+x])*0.5;
    for(let z=1;z<h;z++)for(let x=0;x<w;x++)if(vf[z*w+x])zeroV[z*w+x]=(initZ[(z-1)*w+x]+initZ[z*w+x])*0.5;
    if(initial)project(zeroU,zeroV);

    function diffuse(values,width,height,mask,nu,dt,wall){
      if(!nu)return values;
      const out=values.slice(),a=nu*dt*X,b=nu*dt*Z;
      for(let k=0;k<diffusionIterations;k++)for(let z=0,i=0;z<height;z++)for(let x=0;x<width;x++,i++){
        if(!mask[i])continue;
        let sum=values[i], count=1;
        for(const [j,weight,available] of [
          [i-1,a,x>0],[i+1,a,x+1<width],[i-width,b,z>0],[i+width,b,z+1<height]
        ]){
          if(available&&mask[j]){sum+=weight*out[j];count+=weight;}
          else if(wall)count+=weight;
        }
        out[i]=sum/count;
      }
      return out;
    }
    function advect(values,width,height,mask,u,v,dt,offsetX,offsetZ,scalar){
      const out=values.map(data=>new Float64Array(data.length));
      for(let z=0,i=0;z<height;z++)for(let x=0;x<width;x++,i++){
        if(!mask[i])continue;
        const px=ox+(x+offsetX)*dx,pz=oz+(z+offsetZ)*dz,
          [sx,sz]=velocityAt(u,v,px,pz),
          [vx,vz]=velocityAt(u,v,px-sx*dt*0.5,pz-sz*dt*0.5),
          limit=0.47*Math.min(dx,dz),ratio=Math.max(1,Math.hypot(vx,vz)*dt/(maxTracing*limit)),
          ax=-vx*dt/ratio,az=-vz*dt/ratio,
          steps=Math.max(1,Math.ceil(Math.hypot(ax,az)/limit));
        if(scalar){
          const t=domain.trace(px,pz,px+ax,pz+az);
          domain.distribute(px+ax*t,pz+az*t,(j,w)=>{
            for(let k=0;k<values.length;k++)out[k][i]+=w*values[k][j];
          });
          continue;
        }
        let tx=px,tz=pz;
        for(let j=1;j<=steps;j++){
          const qx=px+ax*j/steps,qz=pz+az*j/steps;
          if(!inside(qx,qz))break;
          tx=qx;tz=qz;
        }
        const a=(tx-ox)/dx-offsetX,b=(tz-oz)/dz-offsetZ;
        for(let k=0;k<values.length;k++)
          out[k][i]=bilinear(values[k],width,height,a,b);
      }
      return out;
    }
    function snapshot(substeps=0){
      const {density,u,v,dyes:channels}=fields,
        vx=new Float64Array(size),vz=new Float64Array(size),div=new Float64Array(size);
      for(let i=0;i<size;i++)if(open[i]){
        [vx[i],vz[i]]=cellVelocity(u,v,i);
        div[i]=divergence(u,v,i);
      }
      function dye(name){
        if(!indices.has(name))throw new Error('Unknown fluid dye channel '+name);
        return channels[indices.get(name)];
      }
      function pigment(data,x,z){
        let value=0;
        domain.distribute(x,z,(i,w)=>{value+=data[i]*w;});
        return value;
      }
      return Object.freeze({time,width:w,height:h,bounds:domain.bounds,density:density.slice(),
        vx,vz,divergence:div,substeps,dyes:names,
        dye:name=>dye(name).slice(),
        sampleDye(name,x,z){
          const data=dye(name);
          return inside(x,z)?pigment(data,x,z):null;
        },
        sampleVelocity(x,z){return inside(x,z)?velocityAt(u,v,x,z):null;},
        sample(x,z){return inside(x,z)?{density:pigment(density,x,z),velocity:velocityAt(u,v,x,z)}:null;}});
    }
    function checkpoint(){
      const token=Object.freeze({time});
      saved.set(token,{...fields,time});
      return token;
    }
    function restore(token){
      const prior=saved.get(token);
      if(stepping||!prior)throw new Error('Invalid fluid checkpoint or step in progress');
      const {time:clock,...buffers}=prior;
      Object.assign(fields,buffers);
      time=clock;
    }
    function exportState(){
      return {time,u:Array.from(fields.u),v:Array.from(fields.v),density:Array.from(fields.density),
        dyes:Object.fromEntries(names.map((name,i)=>[name,Array.from(fields.dyes[i])]))};
    }
    function importState(state){
      const {time:clock,u,v,density,dyes:channels}=state??{};
      if(stepping||!Number.isFinite(clock)||clock<0||!record(channels)||Object.keys(channels).length!==names.length)
        throw new Error('Invalid portable fluid state');
      function read(data,mask,scalar){
        if(!Array.isArray(data)||data.length!==mask.length||!Array.from(data).every((n,i)=>
          Number.isFinite(n)&&(!scalar||number(n,0,maxDensity))&&(mask[i]||n===0)))
          throw new Error('Invalid portable fluid buffer');
        return Float64Array.from(data);
      }
      const next={u:read(u,uf,false),v:read(v,vf,false),density:read(density,open,true),
        dyes:names.map(name=>read(channels[name],open,true))};
      Object.assign(fields,next);
      time=clock;
    }
    function step(duration,{
      force,source,dyeSource,viscosity=0.0002,diffusion=0.001,dissipation=0.025
    }={}){
      if(stepping)throw new Error('A fluid step is already in progress');
      if(!number(duration,0,120)||![viscosity,diffusion,dissipation].every(v=>number(v,0,1e8))||
        [force,source,dyeSource].some(fn=>fn!==undefined&&typeof fn!=='function'))
        throw new Error('Fluid steps need finite intervals and source controls');
      if(!duration)return snapshot();
      const n=Math.ceil(duration/maxDt),dt=duration/n,
        work=n*size*(26+2*pressureIterations+3*diffusionIterations+3*maxTracing+names.length*(8+diffusionIterations));
      if(n>5000||work>maxWork)throw new Error('Fluid step exceeds its work budget');
      let {u,v}=fields,scalars=[fields.density.slice(),...fields.dyes.map(data=>data.slice())];
      u=u.slice();
      v=v.slice();
      const transport=[{diffusion,dissipation},...dyeSettings],
        decay=transport.map(settings=>Math.exp(-settings.dissipation*dt));
      const forceX=new Float64Array(size),forceZ=new Float64Array(size);
      stepping=true;
      try{
        for(let k=0;k<n;k++){
          const t=time+k*dt;
          if(force||source||dyeSource)for(let i=0;i<size;i++){
            if(!open[i])continue;
            const pos=center(i),values={density:scalars[0][i],velocity:cellVelocity(u,v,i),index:i};
            if(force){
              const f=force(...pos,t,values);
              if(!vector(f))throw new Error('Fluid forces must be finite XZ vectors');
              forceX[i]=f[0];
              forceZ[i]=f[1];
            }
            if(source){
              const rate=source(...pos,t,values);
              if(!number(rate,-1e7,1e7))throw new Error('Fluid density sources must be finite and bounded');
              scalars[0][i]=clamp(scalars[0][i]+rate*dt,0,maxDensity);
            }
            if(dyeSource)eachDye(dyeSource(...pos,t,values),(channel,rate)=>{
              if(!number(rate,-1e7,1e7))throw new Error('Fluid dye sources must be finite and bounded');
              const data=scalars[channel+1];
              data[i]=clamp(data[i]+rate*dt,0,maxDensity);
            });
          }
          if(force){
            for(let z=0;z<h;z++)for(let x=1;x<w;x++)if(uf[z*uw+x]){
              const i=z*uw+x,p=z*w+x;
              u[i]=clamp(u[i]+dt*(forceX[p-1]+forceX[p])*0.5,-maxSpeed,maxSpeed);
            }
            for(let z=1;z<h;z++)for(let x=0;x<w;x++)if(vf[z*w+x]){
              const i=z*w+x,p=z*w+x;
              v[i]=clamp(v[i]+dt*(forceZ[p-w]+forceZ[p])*0.5,-maxSpeed,maxSpeed);
            }
          }
          u=diffuse(u,uw,h,uf,viscosity,dt,true);
          v=diffuse(v,w,vh,vf,viscosity,dt,true);
          project(u,v);
          const [nextU]=advect([u],uw,h,uf,u,v,dt,0,0.5,false),
            [nextV]=advect([v],w,vh,vf,u,v,dt,0.5,0,false);
          [u,v]=[nextU,nextV];
          project(u,v);
          const diffused=scalars.map((data,i)=>diffuse(data,w,h,open,transport[i].diffusion,dt,false));
          scalars=advect(diffused,w,h,open,u,v,dt,0.5,0.5,true);
          scalars.forEach((data,k)=>{
            for(let i=0;i<size;i++)data[i]*=decay[k];
          });
        }
        Object.assign(fields,{u,v,density:scalars[0],dyes:scalars.slice(1)});
        time+=duration;
        return snapshot(n);
      }finally{stepping=false;}
    }
    return Object.freeze({step,snapshot,checkpoint,restore,exportState,importState});
  }
  Object.assign(M,{stableFluid,gridDomain,gridSpacing});
})(KIT);
