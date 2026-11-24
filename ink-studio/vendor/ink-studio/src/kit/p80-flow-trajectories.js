/* Vector-field paths and analytic obstacle wakes in bounded scenes. */
(function (K) {
  const P=K.procedural,V=K.V,
    EPS=1e-9,
    number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    vector=(p,max=1e7)=>Array.isArray(p)&&p.length===3&&p.every(v=>number(v,-max,max)),
    clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function streamline(field,start,{
    direction='forward', step=0.08,minStep=step/32,tolerance=0.001, time=0, normalize=true,
    maxLength=14,maxSteps=1800,maxChecks=120000,bounds, mask, obstacle,clearance=0,closeDistance=0
  }={}){
    if(typeof field!=='function'||!vector(start)||!['forward','backward','both'].includes(direction)||
      !number(step,1e-6,1e4)||!number(minStep,1e-7,step)||!number(tolerance,0,1e2)||
      !number(time,-1e8,1e8)||typeof normalize!=='boolean'||!number(maxLength,1e-6,1e7)||
      !integer(maxSteps,1,30000)||!integer(maxChecks,1,2000000)||
      (mask!==undefined&&typeof mask!=='function')||(obstacle!==undefined&&typeof obstacle!=='function')||
      !number(clearance,0,1e3)||!number(closeDistance,0,1e3))
      throw new Error('Streamlines need a field, start and bounded integration controls');
    const box=bounds===undefined?null:P.spatial.bounds(bounds), work={checks:0,retries:0,accepted:0};
    function valid(p,t){
      if(!vector(p)|| (box&&!P.spatial.contains(box,p))||(mask&&!mask(...p,t)))return false;
      if(!obstacle)return true;
      const d=obstacle(...p,t);
      if(!Number.isFinite(d))throw new Error('Streamline obstacle distances must be finite');
      return d>=clearance;
    }
    if(!valid(start,time))throw new Error('Streamline start lies outside the travel domain');
    function trace(sign){
      let p=start.slice(),t=time,run=0,signedStep=step*sign,status='steps',stopped=null;
      const points=[p],times=[t];
      function velocity(q,u){
        if(work.checks>=maxChecks){stopped='budget';return null;}
        if(!valid(q,u)){stopped='blocked';return null;}
        work.checks++;
        const v=field(...q,u);
        if(!vector(v))throw new Error('Streamline velocities must be finite XYZ values');
        const speed=V.len(v);
        if(speed<=EPS){stopped='stalled';return null;}
        return normalize?V.mul(v,1/speed):v;
      }
      function rk(a,u,h){
        const k0=velocity(a,u);
        if(!k0)return null;
        const k1=velocity(V.mad(a,k0,h/2),u+h/2);
        if(!k1)return null;
        const k2=velocity(V.mad(a,k1,h/2),u+h/2);
        if(!k2)return null;
        const k3=velocity(V.mad(a,k2,h),u+h);
        if(!k3)return null;
        return V.mad(a,V.add(V.add(k0,k3),V.mul(V.add(k1,k2),2)),h/6);
      }
      for(let i=0;i<maxSteps;){
        stopped=null;
        const h=signedStep, magnitude=Math.abs(h), full=rk(p,t,h);
        let q=full, error=0;
        if(full&&tolerance){
          const first=rk(p,t,h/2);
          q=first&&rk(first,t+h/2,h/2);
          if(q)error=V.dist(q,full);
        }
        if(q&&(box||mask||obstacle)){
          if(![0.25,0.5,0.75,1].every(f=>valid(V.mad(p,V.sub(q,p),f),t+h*f))){
            q=null;
            stopped='blocked';
          }
        }
        if((!q||error>tolerance)&&magnitude>minStep&&stopped!=='budget'&&stopped!=='stalled'){
          signedStep=sign*Math.max(minStep,magnitude/2);
          work.retries++;
          continue;
        }
        if(!q){status=stopped??'stalled';break;}
        const delta=V.sub(q,p), length=V.len(delta);
        if(length<=EPS){status='stalled';break;}
        const f=Math.min(1,(maxLength-run)/length);
        p=V.mad(p,delta,f);
        t+=h*f;
        run+=length*f;
        points.push(p);
        times.push(t);
        work.accepted++;
        i++;
        if(run>=maxLength-EPS){status='length';break;}
        if(closeDistance&&i>8&&run>closeDistance*6&&V.dist(start,p)<=closeDistance){
          status='closed';
          break;
        }
        if(tolerance&&error<tolerance*0.1)signedStep=sign*Math.min(step,magnitude*2);
      }
      return {points,times,length:run,status};
    }
    let result;
    if(direction==='both'){
      const before=trace(-1),after=trace(1);
      result={points:[...before.points.slice().reverse(),...after.points.slice(1)],
        times:[...before.times.slice().reverse(),...after.times.slice(1)],length:before.length+after.length,
        status:before.status==='budget'||after.status==='budget'?'budget':'both',
        ends:[before.status,after.status]};
    }else result=trace(direction==='backward'?-1:1);
    return P.data.freeze({...result,work});
  }

  function obstacleWake(obstacle,{
    origin=[0,0,0],flow=[1,0,0],up=[0,1,0],radius=0.6,length=5, width=0.82,height=1.25,
    circulation=1.1,eddies=6,period=3.4,shelter=0.18
  }={}){
    if(typeof obstacle!=='function'||![origin,flow,up].every(v=>vector(v))||
      V.len(flow)<EPS||V.len(V.cross(flow,up))<EPS||
      ![radius,length,width,height,period,shelter].every(v=>number(v,1e-5,1e4))||
      !number(circulation,-1e3,1e3)||!integer(eddies,1,30))
      throw new Error('Obstacle wakes need a signed obstacle and a nondegenerate flow frame');
    const center=origin.slice(), base=flow.slice(), ahead=V.norm(flow),side=V.norm(V.cross(up,ahead)),
      vertical=V.cross(ahead,side), wl=Math.max(width,length/(eddies*2.2)), inverseX=1/(wl*wl),inverseZ=1/(width*width),
      gradientStep=Math.max(0.0001,Math.min(radius,shelter)*0.13);
    function sd(p,t){
      const d=obstacle(...p,t);
      if(!Number.isFinite(d))throw new Error('Wake obstacle distances must be finite');
      return d;
    }
    function velocity(x,y,z,t=0){
      if(!vector([x,y,z])||!Number.isFinite(t))throw new Error('Wake samples need finite coordinates and time');
      const p=[x,y,z], distance=sd(p,t);
      if(distance<=0)return [0,0,0];
      const u=V.sub(p,center), ax=V.dot(u,ahead), az=V.dot(u,side), y0=V.dot(u,vertical),
        envelope=Math.exp(-0.5*(y0/height)**2), velocity=base.slice();
      for(let i=0;i<eddies;i++){
        const shift=(t%period)/period+i/eddies,phase=shift-Math.floor(shift), amp=Math.sin(Math.PI*phase)**2,
          sign=i%2?-1:1, dx=ax-radius-phase*length, dz=az-sign*radius*(0.72+0.4*phase),
          phi=circulation*sign*amp*envelope*Math.exp(-0.5*(dx*dx*inverseX+dz*dz*inverseZ));
        for(let k=0;k<3;k++)velocity[k]+=phi*(dx*inverseX*side[k]-dz*inverseZ*ahead[k]);
      }
      if(distance>=shelter)return velocity;
      const g=velocity.map((_,i)=>{
        const a=p.slice(),b=p.slice();
        a[i]-=gradientStep;
        b[i]+=gradientStep;
        return sd(b,t)-sd(a,t);
      }), n=V.norm(g), inward=Math.min(0,V.dot(velocity,n)), weight=1-clamp(distance/shelter,0,1);
      return V.mad(velocity,n,-inward*weight);
    }
    function vorticity(x,y,z,t=0){
      const p=[x,y,z],derivative=p.map((_,axis)=>{
        const a=p.slice(),b=p.slice();
        a[axis]-=gradientStep;
        b[axis]+=gradientStep;
        return V.mul(V.sub(velocity(...b,t),velocity(...a,t)),0.5/gradientStep);
      });
      const [x0,y0,z0]=derivative;
      return [y0[2]-z0[1],z0[0]-x0[2],x0[1]-y0[0]];
    }
    return Object.freeze({velocity,vorticity,period});
  }

  P.motion={streamline,obstacleWake};
})(KIT);
