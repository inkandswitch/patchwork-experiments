/* Convex vertical prisms bounded by two planar heights on a shared footprint. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-8;
  const point=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(Number.isFinite);

  function heightPrismPlanes({lower,upper}={}){
    if(!Array.isArray(lower)||!Array.isArray(upper)||lower.length<3||lower.length>256||
       lower.length!==upper.length||![lower,upper].every(ring=>Array.from(ring).every(point))||
       lower.some(([x,y,z],i)=>Math.abs(x-upper[i][0])>EPS||Math.abs(z-upper[i][2])>EPS||y>upper[i][1]+EPS)||
       !upper.some((p,i)=>p[1]-lower[i][1]>EPS))
      throw Error('Height prisms need ordered planar caps on one footprint');
    const origin=upper[0];
    let a=0,b=0,area=0;
    for(let i=1;i<upper.length-1;i++){
      const q=upper[i],r=upper[i+1],cross=(q[0]-origin[0])*(r[2]-origin[2])-(q[2]-origin[2])*(r[0]-origin[0]);
      if(Math.abs(cross)>Math.abs(area)){a=i;b=i+1;area=cross;}
    }
    if(Math.abs(area)<=EPS||!Number.isFinite(area))throw Error('Height prism footprint needs nonzero area');
    function cap(ring,sign,kind){
      const n=V.norm(V.cross(V.sub(ring[a],ring[0]),V.sub(ring[b],ring[0]))),normal=V.mul(n,sign*Math.sign(n[1]));
      const offset=V.dot(normal,ring[0]);
      if(!Number.isFinite(offset)||ring.some(p=>Math.abs(V.dot(normal,p)-offset)>EPS))
        throw Error('Height prism caps must be planar');
      return {normal,offset,kind};
    }
    const side=upper.map((p,i)=>{
      const q=upper[(i+1)%upper.length],x=q[0]-p[0],z=q[2]-p[2],length=Math.hypot(x,z);
      if(!Number.isFinite(length)||length<=EPS)throw Error('Height prism footprint edges must be distinct');
      const normal=[z/length*Math.sign(area),0,-x/length*Math.sign(area)],offset=V.dot(normal,p);
      if(!Number.isFinite(offset)||upper.some(point=>V.dot(normal,point)>offset+EPS))
        throw Error('Height prism footprint must be convex');
      return {normal,offset,kind:'side',edge:i};
    });
    return [...side,cap(lower,-1,'lower'),cap(upper,1,'upper')];
  }
  P.geometry.heightPrismPlanes=heightPrismPlanes;
})(KIT);
