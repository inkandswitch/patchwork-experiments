/* Section vertices of a planar profile swept through an affine frame. */
(function(K) {
  const P=K.procedural||K.authoring,{V}=K;
  const vector=(value,size)=>Array.isArray(value)&&value.length===size&&Array.from(value).every(Number.isFinite);

  function profilePlaneSection({outline,span,frame,plane,tolerance=1e-7}={}) {
    if(!Array.isArray(outline)||outline.length<3||outline.length>4096||
       !Array.from(outline).every(point=>vector(point,2))||
       !vector(span,2)||span[0]>=span[1]||!vector(frame?.t,3)||!vector(frame?.R,9)||
       !vector(plane?.point,3)||!vector(plane?.normal,3)||
       !Number.isFinite(tolerance)||tolerance<0||tolerance>.1)
      throw new Error('Profile sections need a finite outline, depth span, frame and plane');
    const magnitude=V.len(plane.normal);
    if(!Number.isFinite(magnitude)||magnitude<1e-12)throw new Error('Profile section plane needs a nonzero normal');
    const normal=V.mul(plane.normal,1/magnitude),points=[];
    const rings=span.map(depth=>outline.map(([x,y])=>{
      const point=P.transforms.point(frame,[x,y,depth]),side=V.dot(V.sub(point,plane.point),normal);
      if(!vector(point,3)||!Number.isFinite(side))throw new Error('Profile sections exceed their coordinate range');
      return {point,side};
    }));
    for(const ring of rings)for(const {point,side} of ring)
      if(Math.abs(side)<=tolerance)points.push(V.mad(point,normal,-side));

    function cross(a,b) {
      if(a.side < -tolerance && b.side > tolerance || b.side < -tolerance && a.side > tolerance){
        const t=1/(1+Math.abs(b.side/a.side));
        points.push(a.point.map((value,i)=>value*(1-t)+b.point[i]*t));
      }
    }
    for(let i=0;i<outline.length;i++){
      const next=(i+1)%outline.length;
      cross(rings[0][i],rings[0][next]);
      cross(rings[1][i],rings[1][next]);
      cross(rings[0][i],rings[1][i]);
    }
    return points;
  }

  P.geometry.profilePlaneSection=profilePlaneSection;
})(KIT);
