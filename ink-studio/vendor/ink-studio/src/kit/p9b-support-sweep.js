/* Continuous XZ coverage from level support patches. */
(function (K) {
  const P=K.procedural||K.authoring, EPS=1e-8, compiled=new WeakMap();
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(Number.isFinite);

  function planes(polygon) {
    if(!Array.isArray(polygon)||polygon.length<3||polygon.length>256||
      !Array.from(polygon).every(point=>vector(point,2)))
      throw new Error('Support footprints need bounded convex XZ polygons');
    const [origin]=polygon;
    const area=polygon.slice(2).reduce((area,b,i)=>{
      const a=polygon[i+1];
      return area+(a[0]-origin[0])*(b[1]-origin[1])-(a[1]-origin[1])*(b[0]-origin[0]);
    },0);
    if(Math.abs(area)<=EPS*EPS)throw new Error('Support footprints need nonzero area');
    const sign=Math.sign(area);
    return polygon.map(([x,z],i)=>{
      const b=polygon[(i+1)%polygon.length],du=b[0]-x,dv=b[1]-z,len=Math.hypot(du,dv);
      if(len<=EPS)throw new Error('Support footprints need distinct edge vertices');
      const nx=-dv/len*sign,nz=du/len*sign;
      if(polygon.some(point=>(point[0]-x)*nx+(point[1]-z)*nz < -EPS))
        throw new Error('Support footprints must be convex');
      return [x,z,nx,nz];
    });
  }

  function footprint(patch) {
    if(compiled.has(patch))return compiled.get(patch);
    const holes=patch.holes??[];
    if(!Array.isArray(holes)||holes.length>4096)throw new Error('Support patches need bounded cutouts');
    const shape={outer:planes(patch.footprint),holes:holes.map(planes)};
    if(P.data.isImmutable(patch))compiled.set(patch,shape);
    return shape;
  }

  function segment(from,to,patches,{verticalTolerance=.0005}={}) {
    if(!vector(from,3)||!vector(to,3)||!Array.isArray(patches)||patches.length>4096||
       !Number.isFinite(verticalTolerance)||verticalTolerance<0)
      throw new Error('Support sweeps need finite endpoints, tolerances and bounded patches');
    const [x,,z]=from, dx=to[0]-x, dz=to[2]-z;
    const low=Math.min(from[1],to[1])-verticalTolerance,high=Math.max(from[1],to[1])+verticalTolerance;
    let start=false,end=false;
    const ranges=[];
    function interval(edges,margin) {
      let enter=0,leave=1;
      for(const [px,pz,nx,nz] of edges){
        const origin=(x-px)*nx+(z-pz)*nz+margin, slope=dx*nx+dz*nz;
        if(Math.abs(slope)<EPS){
          if(origin<0)return null;
        }else if(slope>0)enter=Math.max(enter,-origin/slope);
        else leave=Math.min(leave,-origin/slope);
        if(enter>leave)return null;
      }
      return [enter,leave];
    }
    for(const patch of patches){
      if(!Number.isFinite(patch?.height))throw new Error('Support patch heights must be finite');
      if(patch.height<low||patch.height>high)continue;
      const shape=footprint(patch), outer=interval(shape.outer,EPS);
      if(!outer)continue;
      let spans=[outer];
      for(const hole of shape.holes){
        const gap=interval(hole,-EPS);
        if(!gap)continue;
        spans=spans.flatMap(([a,b])=>{
          if(gap[1]<a||gap[0]>b)return [[a,b]];
          const remaining=[];
          if(a<gap[0])remaining.push([a,gap[0]]);
          if(b>gap[1])remaining.push([gap[1],b]);
          return remaining;
        });
      }
      for(const span of spans){
        if(span[0]===0&&Math.abs(patch.height-from[1])<=verticalTolerance)start=true;
        if(span[1]===1&&Math.abs(patch.height-to[1])<=verticalTolerance)end=true;
        ranges.push(span);
      }
    }
    ranges.sort((a,b)=>a[0]-b[0]);
    let extent=0;
    for(const [a,b] of ranges){
      if(a>extent+EPS)break;
      extent=Math.max(extent,b);
    }
    return {start,end,covered:start&&end&&extent>=1-EPS};
  }

  P.supportSweep=Object.freeze({segment});
})(KIT);
