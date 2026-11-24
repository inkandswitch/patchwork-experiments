/* Fit a level landing footprint without occupying its descending approaches. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-8;
  const vector=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  const heading=v=>{
    const run=vector(v)?Math.hypot(v[0],v[2]):0;
    if(!Number.isFinite(run)||run<EPS)throw Error('Landing directions need a finite horizontal component');
    return [v[0]/run,0,v[2]/run];
  };

  function landingFootprint({center,tangent,width,depth=width,approaches=[]}={}){
    if(!vector(center)||![width,depth].every(v=>Number.isFinite(v)&&v>0)||
       !Array.isArray(approaches)||approaches.length>16)
      throw Error('Landing footprints need a finite center, positive dimensions and bounded approaches');
    const along=heading(tangent),side=[-along[2],0,along[0]];
    const faces=[{points:[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>
      V.mad(V.mad(center,along,u*depth/2),side,v*width/2))}];
    const planes=Array.from(approaches,({point,direction}={})=>{
      if(!vector(point))throw Error('Landing approaches need finite points');
      const normal=heading(direction);
      return {normal,offset:V.dot(normal,point)};
    });
    return P.geometry.clipPlanarFaces(faces,planes)[0]?.points.map(([x,,z])=>[x,z])||[];
  }

  (P.routes||(P.routes={})).landingFootprint=landingFootprint;
})(KIT);
