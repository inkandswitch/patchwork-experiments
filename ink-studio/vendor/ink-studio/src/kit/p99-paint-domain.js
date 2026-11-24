/* Bound resolved paint while retaining the caller's original stroke field. */
(function(K){
  const P=K.procedural||K.authoring;

  function clipPaintDomain(field,domain,{mode='intersect'}={}){
    if(!field||typeof field.distanceAt!=='function'||!domain||typeof domain.distanceAt!=='function'||
      !['intersect','gate'].includes(mode))throw Error('Paint domains need two signed fields and a clipping mode');
    const edge=domain.distanceAt.bind(domain),hard=mode==='gate',
      inside=typeof domain.inside==='function'?domain.inside.bind(domain):(x,z)=>edge(x,z)<=0;
    const pointEdge=q=>edge(q[0],q[1]);
    const restrict=(distance,border)=>hard?(border>0?Infinity:distance):Math.max(distance,border);
    function distanceAt(x,z,ceiling=Infinity){
      const distance=field.distanceAt(x,z,ceiling);
      if(distance>=ceiling)return ceiling;
      if(hard)return inside(x,z)?distance:ceiling;
      return Math.min(ceiling,Math.max(distance,edge(x,z)));
    }
    let {bounds}=field;
    if(bounds&&domain.bounds){
      const min=bounds.min.slice(),max=bounds.max.slice();
      for(const axis of [0,2]){
        min[axis]=Math.max(min[axis],domain.bounds.min[axis]);
        max[axis]=Math.min(max[axis],domain.bounds.max[axis]);
      }
      bounds=min.some((v,i)=>v>max[i])?null:{min,max};
    }
    const view={...field,bounds,domain,raw:field,distanceAt,
      distance:q=>distanceAt(q[0],q[1]),
      contains:q=>distanceAt(q[0],q[1],0)<0};
    if(typeof field.owner==='function')view.owner=q=>{
      const owner=field.owner(q);
      return owner!=null&&inside(q[0],q[1])?owner:null;
    };
    if(typeof field.weight==='function')view.weight=q=>inside(q[0],q[1])?field.weight(q):0;
    if(typeof field.sample==='function')view.sample=q=>{
      const d=pointEdge(q);
      if(d>0)return {distance:restrict(field.distanceAt(q[0],q[1]),d),owner:null,weight:0};
      const sample=field.sample(q);
      return {...sample,distance:restrict(sample.distance,d)};
    };
    if(typeof field.visibleDistance==='function')
      view.visibleDistance=(id,q)=>restrict(field.visibleDistance(id,q),pointEdge(q));
    view.inside=inside;
    return Object.freeze(view);
  }

  P.clipPaintDomain=clipPaintDomain;
})(KIT);
