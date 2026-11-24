/* Contact constraints between convex planar profiles. */
(function(K){
  const P=K.procedural||K.authoring,EPS=1e-8,plans=new WeakSet(),motions=new WeakSet();
  const point=value=>Array.isArray(value)&&value.length===2&&Array.from(value).every(Number.isFinite);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
  const subtract=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const shift=(p,v,t)=>[p[0]+v[0]*t,p[1]+v[1]*t];
  function edgeBetween(from,to){
    const [dx,dy]=subtract(to,from),length=Math.hypot(dx,dy);
    if(length<=EPS)return null;
    const tangent=[dx/length,dy/length],normal=[tangent[1],-tangent[0]];
    return {from,length,tangent,normal};
  }

  function compile(outline){
    const vertices=P.geometry.intersectConvexPlans(outline,outline);
    if(vertices.length<3)throw new Error('Snap profiles need a convex area');
    const edges=vertices.map((from,i)=>edgeBetween(from,vertices[(i+1)%vertices.length]));
    if(edges.some(edge=>!edge))throw new Error('Snap profiles need distinct consecutive points');
    const bounds={
      min:[0,1].map(axis=>Math.min(...vertices.map(p=>p[axis]))),
      max:[0,1].map(axis=>Math.max(...vertices.map(p=>p[axis])))
    };
    const plan=P.data.freeze({vertices,edges,bounds});
    plans.add(plan);
    return plan;
  }

  function contact(edge,other,x,y,limit){
    const [tx,ty]=edge.tangent,[nx,ny]=edge.normal;
    const u=x-edge.from[0],v=y-edge.from[1];
    let gap=Infinity,lo=Infinity,hi=-Infinity;
    for(const [px,py] of other.vertices){
      const dx=px+u,dy=py+v,d=dx*nx+dy*ny,s=dx*tx+dy*ty;
      if(d<gap-EPS){gap=d;lo=hi=s;}
      else if(d<=gap+EPS){gap=Math.min(d,gap);lo=Math.min(lo,s);hi=Math.max(hi,s);}
    }
    const along=hi<0?-hi:lo>edge.length?edge.length-lo:0;
    const distance=Math.hypot(gap,along);
    if(distance>limit||!Number.isFinite(distance))return null;
    return {distance,correction:[along*tx-gap*nx,along*ty-gap*ny],
      start:Math.max(0,lo+along),end:Math.min(edge.length,hi+along)};
  }

  function better(candidate,best){
    return !best||candidate.distance<best.distance-EPS||Math.abs(candidate.distance-best.distance)<=EPS&&
      (candidate.span>best.span+EPS||Math.abs(candidate.span-best.span)<=EPS&&candidate.id<best.id);
  }

  function align(moving,position,targets,{capture=.22,release=capture*1.5,latch}={}){
    if(!plans.has(moving)||!point(position)||!Array.isArray(targets)||targets.length>4096||
      !Number.isFinite(capture)||capture<0||!Number.isFinite(release)||release<capture)
      throw new Error('Plan snapping needs compiled shapes, a finite translation and ordered tolerances');
    const ids=new Set();
    let best=null,retained=null;
    for(const target of targets){
      const {id,plan}=target||{};
      if(typeof id!=='string'||!id||ids.has(id)||!plans.has(plan))
        throw new Error('Snap targets need unique IDs and compiled plans');
      ids.add(id);
      const limit=latch?.id===id?release:capture;
      if(position.some((v,i)=>moving.bounds.min[i]+v>plan.bounds.max[i]+limit||
        moving.bounds.max[i]+v<plan.bounds.min[i]-limit))continue;
      function consider(reference,other,side,sign,x,y){
        for(const [index,edge] of reference.edges.entries()){
          const keep=latch?.id===id&&latch.side===side&&latch.edge===index;
          const hit=contact(edge,other,x,y,keep?release:capture);
          if(!hit)continue;
          const offset=hit.correction.map(v=>v*sign),next=position.map((v,i)=>v+offset[i]);
          const base=side==='target'?edge.from:edge.from.map((v,i)=>v+next[i]);
          const guide=[hit.start,hit.end].map(s=>base.map((v,i)=>v+s*edge.tangent[i]));
          const candidate={id,position:next,offset,guide,distance:hit.distance,
            span:Math.max(0,hit.end-hit.start),latch:{id,side,edge:index}};
          if(keep)retained=candidate;
          if(better(candidate,best))best=candidate;
        }
      }
      consider(plan,moving,'target',1,...position);
      consider(moving,plan,'moving',-1,-position[0],-position[1]);
    }
    return retained||best;
  }

  function compileMotion(plan,velocity){
    if(!plans.has(plan)||typeof velocity!=='function')throw new Error('Plan motion needs a compiled plan and vertex velocity');
    const speeds=plan.vertices.map((p,i)=>{
      const v=velocity(p,i);
      if(!point(v))throw new Error('Plan motion needs a finite velocity at each vertex');
      return v.slice();
    });
    function bounds(min,max){
      if(!Number.isFinite(min)||!Number.isFinite(max)||min>max)throw new Error('Plan motion needs finite ordered bounds');
      const lows=[Infinity,Infinity],highs=[-Infinity,-Infinity];
      for(const [i,p] of plan.vertices.entries())for(let axis=0;axis<2;axis++){
        const a=p[axis]+speeds[i][axis]*min,b=p[axis]+speeds[i][axis]*max;
        lows[axis]=Math.min(lows[axis],a,b);highs[axis]=Math.max(highs[axis],a,b);
      }
      return {min:lows,max:highs};
    }
    const motion=P.data.freeze({plan,speeds,bounds});
    motions.add(motion);
    return motion;
  }

  function roots(a,b,c){
    if(Math.abs(a)<=EPS)return Math.abs(b)<=EPS?[]:[-c/b];
    const det=b*b-4*a*c;
    if(det<0)return [];
    const q=-.5*(b+(b<0?-1:1)*Math.sqrt(det));
    return q===0?[0]:[q/a,c/q];
  }

  function alignMotion(motion,value,targets,{capture=.22,release=capture*1.5,latch,min=-Infinity,max=Infinity}={}){
    if(!motions.has(motion)||!Number.isFinite(value)||!Array.isArray(targets)||targets.length>4096||
      !Number.isFinite(capture)||capture<0||!Number.isFinite(release)||release<capture||
      typeof min!=='number'||typeof max!=='number'||!(value>=min&&value<=max))
      throw new Error('Motion snapping needs a compiled motion, a bounded parameter and ordered tolerances');
    const {plan,speeds}=motion,at=plan.vertices.map((p,i)=>shift(p,speeds[i],value));
    const low=Math.max(min,value-release),high=Math.min(max,value+release),
      sweep=motion.bounds(low,high),ids=new Set();
    let best=null,retained=null;
    for(const target of targets){
      const {id,plan:stationary}=target||{};
      if(typeof id!=='string'||!id||ids.has(id)||!plans.has(stationary))
        throw new Error('Snap targets need unique IDs and compiled plans');
      ids.add(id);
      if(sweep.min.some((v,i)=>v>stationary.bounds.max[i]+EPS||sweep.max[i]<stationary.bounds.min[i]-EPS))continue;
      const holds=(side,edge)=>latch?.id===id&&latch.side===side&&latch.edge===edge;
      function consider(offset,side,index,getContact){
        const keep=holds(side,index),distance=Math.abs(offset);
        if(distance>(keep?release:capture)||offset<low-value||offset>high-value||!Number.isFinite(offset))return;
        const {edge,other}=getContact(offset);
        if(!edge)return;
        const hit=contact(edge,other,0,0,EPS*8);
        if(!hit)return;
        const guide=[hit.start,hit.end].map(s=>shift(edge.from,edge.tangent,s));
        const candidate={id,value:value+offset,offset,guide,distance,span:Math.max(0,hit.end-hit.start),
          latch:{id,side,edge:index}};
        if(keep&&better(candidate,retained))retained=candidate;
        if(better(candidate,best))best=candidate;
      }
      // A fixed separating plane yields one interval of feasible parameter offsets.
      for(const [index,edge] of stationary.edges.entries()){
        let enter=-Infinity,exit=Infinity;
        for(const [i,p] of at.entries()){
          const gap=dot(subtract(p,edge.from),edge.normal),speed=dot(speeds[i],edge.normal);
          if(speed>EPS)enter=Math.max(enter,-gap/speed);
          else if(speed<-EPS)exit=Math.min(exit,-gap/speed);
          else if(gap<-EPS){enter=Infinity;break;}
        }
        if(enter>exit+EPS)continue;
        const measure=offset=>({edge,other:{vertices:at.map((p,i)=>shift(p,speeds[i],offset))}});
        consider(enter,'target',index,measure);consider(exit,'target',index,measure);
      }
      // A moving edge can rotate as it scales. Its station against a fixed
      // vertex is quadratic in the parameter offset.
      for(const [i,start] of at.entries()){
        const j=(i+1)%at.length,end=at[j],fromSpeed=speeds[i],toSpeed=speeds[j],
          edge=subtract(end,start),speed=subtract(toSpeed,fromSpeed),
          back=fromSpeed.map(x=>-x),a=cross(speed,back);
        const points=[shift(start,fromSpeed,low-value),shift(start,fromSpeed,high-value),
          shift(end,toSpeed,low-value),shift(end,toSpeed,high-value)];
        const measure=offset=>({edge:edgeBetween(shift(start,fromSpeed,offset),shift(end,toSpeed,offset)),other:stationary});
        const box=[0,1].map(axis=>{
          const values=points.map(p=>p[axis]);
          return [Math.min(...values)-EPS,Math.max(...values)+EPS];
        });
        for(const vertex of stationary.vertices){
          if(box.some(([lo,hi],axis)=>vertex[axis]<lo||vertex[axis]>hi))continue;
          const relative=subtract(vertex,start),b=cross(speed,relative)+cross(edge,back),c=cross(edge,relative);
          for(const offset of roots(a,b,c))consider(offset,'moving',i,measure);
        }
      }
    }
    return retained||best;
  }

  P.planSnapping=Object.freeze({compile,align,compileMotion,alignMotion});
})(KIT);
