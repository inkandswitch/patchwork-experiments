/* Partition the exterior of a convex keepout into convex half-space slices. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-8;

  function subtractConvexFaces(faces,planes,{capTag,budget=256}={}){
    if(!Array.isArray(planes)||planes.length>1024||
       !Number.isSafeInteger(budget)||budget<1||budget>1024)
      throw Error('Convex subtraction needs bounded half spaces and a piece budget');
    const keepout=Array.from(planes,plane=>{
      const normal=plane?.normal;
      if(!Array.isArray(normal)||normal.length!==3||!Array.from(normal).every(Number.isFinite)||
         !Number.isFinite(plane.offset))
        throw Error('Convex subtraction needs finite half spaces');
      const length=V.len(normal);
      if(length<EPS||!Number.isFinite(length))throw Error('Convex subtraction needs nonzero finite normals');
      return {normal:V.mul(normal,1/length),offset:plane.offset/length,tag:plane.tag};
    });
    let remainder=P.geometry.clipConvexFaces(faces,[]);
    if(!keepout.length)return [faces];
    const result=[];
    // The next slice starts inside all preceding faces of the keepout.
    // This makes the outputs disjoint in volume.
    for(const plane of keepout){
      let low=Infinity,high=-Infinity;
      for(const {points} of remainder)for(const point of points){
        const d=V.dot(plane.normal,point)-plane.offset;
        low=Math.min(low,d);
        high=Math.max(high,d);
      }
      if(low>=-EPS)return [faces];
      if(high<=EPS)continue;
      const outside=P.geometry.clipConvexFaces(remainder,
        [{normal:V.mul(plane.normal,-1),offset:-plane.offset,tag:plane.tag}],{capTag});
      if(outside.length)result.push(outside);
      remainder=P.geometry.clipConvexFaces(remainder,[plane],{capTag});
      if(!remainder.length)return [faces];
    }
    if(result.length>budget)throw new RangeError('Convex subtraction exceeds its piece budget');
    return result;
  }

  P.geometry.subtractConvexFaces=subtractConvexFaces;
})(KIT);
