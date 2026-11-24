/* Convert a bounded signed chart field to matching polygonal cuts and queries. */
(function(K) {
  const P=K.procedural||K.authoring, EPS=1e-8;

  function simplify(ring,tolerance) {
    const points=ring.slice(0,-1), pivot=Math.floor(points.length/2);
    const kept=new Set([0,pivot,points.length]), pending=[[0,pivot],[pivot,points.length]];
    while(pending.length) {
      const [lo,hi]=pending.pop(),a=ring[lo],b=ring[hi],dx=b[0]-a[0],dy=b[1]-a[1];
      const length=dx*dx+dy*dy;
      let index=-1,gap=tolerance*tolerance;
      for(let i=lo+1;i<hi;i++) {
        const x=ring[i][0]-a[0],y=ring[i][1]-a[1];
        const t=length?Math.max(0,Math.min(1,(x*dx+y*dy)/length)):0;
        const distance=(x-t*dx)**2+(y-t*dy)**2;
        if(distance>gap){index=i;gap=distance;}
      }
      if(index>=0){kept.add(index);pending.push([lo,index],[index,hi]);}
    }
    const reduced=points.filter((_,i)=>kept.has(i));
    return reduced.length>=3?reduced:points;
  }

  function fieldMask(sample,{bounds,cell=.08,maxCells=12000}={}) {
    if(typeof sample!=='function'||!Array.isArray(bounds?.min)||!Array.isArray(bounds?.max)||
       bounds.min.length!==2||bounds.max.length!==2||
       !bounds.min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(bounds.max[i])&&v<bounds.max[i])||
       !Number.isFinite(cell)||cell<1e-6)
      throw Error('A surface mask needs a signed field, finite bounds and sample spacing');
    const min=bounds.min.map(v=>v-cell),max=bounds.max.map(v=>v+cell);
    const paths=P.contours.march((u,v)=>{
      const limit=Math.max(bounds.min[0]-u,bounds.min[1]-v,u-bounds.max[0],v-bounds.max[1]);
      if(limit>0)return limit;
      const value=sample(u,v);
      return value===Infinity?cell:Math.max(limit,value);
    },{bounds:{min,max},cell,maxCells});
    const rings=paths.filter(path=>path.closed&&path.points.length>=4)
      .map(path=>simplify(path.points,cell*.035));
    if(!rings.length)return null;
    const contours=rings.map(points=>P.geometry.profileDistance(points));
    const area=ring=>ring.reduce((sum,a,i)=>{
      const b=ring[(i+1)%ring.length];
      return sum+a[0]*b[1]-a[1]*b[0];
    },0);
    let holes=null;
    if(rings.length===1&&rings[0].length<=128){
      const ring=rings[0],sign=Math.sign(area(ring));
      if(sign&&ring.every((a,i)=>{
        const b=ring[(i+1)%ring.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        return length>EPS&&ring.every(([x,y])=>sign*(dx*(y-a[1])-dy*(x-a[0]))>=-EPS*length*.5);
      }))holes=[ring];
    }
    if(!holes){
      const mesh=P.geometry.triangulatePolygon(rings);
      holes=mesh.triangles.map(triangle=>triangle.map(i=>mesh.points[i]));
    }
    const points=rings.flat(),extent={
      min:[0,1].map(axis=>Math.min(...points.map(p=>p[axis]))),
      max:[0,1].map(axis=>Math.max(...points.map(p=>p[axis])))
    };
    function distance(u,v) {
      let value=Infinity,inside=false;
      for(const contour of contours){
        const d=contour(u,v);
        value=Math.min(value,Math.abs(d));
        if(d<0)inside=!inside;
      }
      return inside?-value:value;
    }
    return P.data.freeze({bounds:extent,rings,holes,distance});
  }
  P.surfaceCells.fieldMask=fieldMask;
})(KIT);
