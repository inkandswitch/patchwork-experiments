/* Fit a stair run between an exposed landing and a local carrier surface. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K;
  const finite3=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);

  function dock(outline,landing,axis,width){
    if(!Array.isArray(outline)||outline.length<3||outline.length>256||!Number.isFinite(width)||width<=0||
       !Array.from(outline).every(p=>Array.isArray(p)&&p.length===2&&Array.from(p).every(Number.isFinite)))
      throw Error('Stair docking needs a convex XZ outline and positive width');
    const area=outline.reduce((sum,p,i)=>{
      const q=outline[(i+1)%outline.length];return sum+p[0]*q[1]-p[1]*q[0];
    },0);
    if(Math.abs(area)<1e-8)throw Error('Stair docking needs nonzero area');
    const sign=Math.sign(area),side=[-axis[2],0,axis[0]];
    let low=-Infinity,high=Infinity;
    for(const [i,p] of outline.entries()){
      const q=outline[(i+1)%outline.length],dx=q[0]-p[0],dz=q[1]-p[1],size=Math.hypot(dx,dz);
      if(size<1e-8)throw Error('Stair docking needs distinct outline edges');
      const nx=-sign*dz/size,nz=sign*dx/size;
      if(outline.some(at=>(at[0]-p[0])*nx+(at[1]-p[1])*nz<-1e-7))
        throw Error('Stair docking requires a convex outline');
      const at=(landing[0]-p[0])*nx+(landing[2]-p[1])*nz,
        pad=.004+Math.abs(side[0]*nx+side[2]*nz)*width/2,along=axis[0]*nx+axis[2]*nz;
      if(Math.abs(along)<1e-8){if(at<pad)return null;continue;}
      const edge=(pad-at)/along;
      if(along<0)high=Math.min(high,edge);else low=Math.max(low,edge);
    }
    if(!Number.isFinite(high)||low>high)return null;
    return V.mad(landing,axis,high);
  }

  function fitStairApproach({landing,direction,height,accept=()=>true,inside=()=>false,outline,width,
    rise=.18,tread=.24,minRise=.09,maxRise=1.05,minRun=.25,maxRun=3.2,step=.06,budget=256}={}){
    const extent=finite3(direction)?Math.hypot(direction[0],direction[2]):0;
    if(!finite3(landing)||extent<1e-7||typeof height!=='function'||typeof accept!=='function'||
       typeof inside!=='function'||![rise,tread,minRise,maxRise,minRun,maxRun,step].every(Number.isFinite)||
       rise<=0||tread<=0||minRise<=0||maxRise<minRise||minRun<=0||maxRun<minRun||step<=0||
       !Number.isSafeInteger(budget)||budget<1||budget>2048)
      throw Error('A stair approach needs a landing, horizontal direction, finite constraints and a bounded carrier');
    const count=Math.ceil(maxRun/step);
    if(count>budget)throw Error('Stair approach exceeds its probe budget');
    const axis=[direction[0]/extent,0,direction[2]/extent],probes=[];
    const start=outline===undefined?landing:dock(outline,landing,axis,width);
    if(!start||V.dist(landing,start)>maxRun||!accept(start))return null;
    for(let i=1;i<=count;i++){
      const run=maxRun*i/count,p=V.mad(start,axis,run);
      if(!accept(p))break;
      // A landing can be slightly inset. Only an initial carrier overlap is allowed.
      if(inside(p)){
        if(probes.length)break;
        continue;
      }
      const y=height(p[0],p[2]);
      if(!Number.isFinite(y))throw Error('Stair approach height must be finite');
      probes.push({run,y});
      const climb=start[1]-y,risers=Math.ceil(climb/rise);
      if(climb<minRise||climb>maxRise||run<Math.max(minRun,risers*tread))continue;
      const unit=run/risers,stepRise=climb/risers;
      if(probes.some(q=>{
        const index=Math.max(1,risers-Math.floor(q.run/unit));
        return q.y>y+index*stepRise+.035;
      }))continue;
      return Object.freeze({landing:Object.freeze(start.slice()),toe:Object.freeze([p[0],y,p[2]]),
        axis:Object.freeze(axis),run,climb,risers,tread:unit,rise:stepRise});
    }
    return null;
  }
  (P.routes||(P.routes={})).fitStairApproach=fitStairApproach;
})(KIT);
