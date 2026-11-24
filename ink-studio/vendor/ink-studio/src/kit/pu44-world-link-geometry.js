/* An installed flexible line through ordered guides. Length is measured along its centerline. */
(function(K){
  const W=K.world, {V}=K, epsilon=1e-8;
  const fractions=Array.from({length:9},(_,i)=>i/8);
  const spanLengths=points=>points.slice(1).map((b,i)=>V.dist(points[i],b));
  function sagSpan(a,b,chord,length,down){
    if(chord<=epsilon||length-chord<=epsilon)return [a,b];
    const axis=V.mul(V.sub(b,a),1/chord), d=V.norm(V.mad(down,axis,-V.dot(down,axis)),V.perp(axis));
    let low=0, high=length*.5;
    for(let i=0;i<24;i++){
      const h=(low+high)*.5;
      let arc=0;
      for(let j=1;j<fractions.length;j++){
        const s=fractions[j-1], t=fractions[j];
        arc+=Math.hypot(chord*(t-s),4*h*(t*(1-t)-s*(1-s)));
      }
      if(arc<length)low=h;else high=h;
    }
    const h=(low+high)*.5;
    return fractions.map(t=>V.mad(V.lerp(a,b,t),d,4*h*t*(1-t)));
  }
  function trim(points,low,high){
    const lengths=spanLengths(points), length=lengths.reduce((sum,n)=>sum+n,0);
    if(length<=epsilon||high-low<=epsilon)return [];
    let run=0;
    const result=[];
    for(let i=0;i<lengths.length;i++){
      const size=lengths[i], a=Math.max(run,low*length), b=Math.min(run+size,high*length);
      if(b-a>epsilon){
        if(!result.length)result.push(V.lerp(points[i],points[i+1],(a-run)/size));
        result.push(V.lerp(points[i],points[i+1],(b-run)/size));
      }
      run+=size;
    }
    return result;
  }
  function measure(points){
    const spans=spanLengths(points);
    return {spans,distance:spans.reduce((sum,n)=>sum+n,0)};
  }
  function sampleSpan({points,spans,distance,length},down,index,fraction){
    const chord=spans[index], scale=distance>epsilon?Math.max(1,length/distance):1;
    const path=sagSpan(points[index],points[index+1],chord,chord*scale,down);
    return trim(path,0,fraction).at(-1)??path[0];
  }
  function paths(points,spans,distance,length,down,broken,radius){
    const scale=distance>epsilon?Math.max(1,length/distance):1;
    return spans.flatMap((chord,i)=>{
      if(chord<=epsilon)return [];
      const path=sagSpan(points[i],points[i+1],chord,chord*scale,down);
      if(broken?.segment!==i)return [path];
      const gap=Math.min(.45,Math.max(radius*4,.15)/(chord*scale));
      return [trim(path,0,broken.fraction-gap),trim(path,broken.fraction+gap,1)].filter(p=>p.length>1);
    });
  }
  W.linkGeometry=Object.freeze({measure,paths,sampleSpan});
})(KIT);
