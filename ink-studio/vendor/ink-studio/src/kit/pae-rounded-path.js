/* Round a 3D polyline with tangent circular arcs bounded by its adjacent legs. */
(function (K) {
  const P=K.procedural||K.authoring,V=K.V,EPS=1e-8;
  const vector=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  const defaultError=.01;
  function roundedPath(path,{radius,chordError=defaultError,maxDeviation,budget=4096}={}) {
    if(!Array.isArray(path)||path.length<2||path.length>4096||!Array.from(path).every(vector)||
       !Number.isFinite(radius)||radius<0||!Number.isFinite(chordError)||chordError<=0||
       maxDeviation!==undefined&&(!Number.isFinite(maxDeviation)||maxDeviation<0)||
       !Number.isSafeInteger(budget)||budget<path.length||budget>65536)
      throw Error('Rounded paths need finite points, nonnegative radius and a bounded sample budget');
    const legs=path.slice(1).map((point,i)=>{
      const delta=V.sub(point,path[i]),length=V.len(delta);
      if(!Number.isFinite(length)||length<EPS)
        throw Error('Rounded path stations must be distinct');
      return {length,tangent:V.mul(delta,1/length)};
    });
    const points=[path[0].slice()],bends=[];
    for(let i=1;i<path.length-1;i++){
      const point=path[i],prev=legs[i-1],next=legs[i],
        cross=V.cross(prev.tangent,next.tangent),sine=V.len(cross),
        cosine=K.clamp(V.dot(prev.tangent,next.tangent),-1,1);
      if(!radius||sine<EPS||1+cosine<EPS){points.push(point.slice());continue;}
      const turn=Math.atan2(sine,cosine),ratio=sine/(1+cosine),
        deviation=1/Math.sqrt((1+cosine)/2)-1,
        permitted=maxDeviation===undefined||!deviation?radius:Math.min(radius,maxDeviation/deviation),
        cut=Math.min(permitted*ratio,prev.length*.45,next.length*.45),
        actual=cut/ratio;
      if(cut<EPS||actual<EPS){points.push(point.slice());continue;}
      const normal=V.cross(V.mul(cross,1/sine),prev.tangent),
        first=V.mad(point,prev.tangent,-cut),last=V.mad(point,next.tangent,cut),
        center=V.mad(first,normal,actual);
      // R * (1 - cos(theta/2)) bounds the deviation of one chord from the arc.
      const step=4*Math.asin(Math.sqrt(Math.min(.5,chordError/actual/2))),
        slices=Math.max(2,Math.ceil(turn/step));
      if(points.length+slices+path.length-i>budget)
        throw Error('Rounded path exceeds its sample budget');
      const start=points.length;
      points.push(first);
      for(let j=1;j<slices;j++){
        const theta=turn*j/slices;
        points.push(V.mad(V.mad(center,normal,-actual*Math.cos(theta)),prev.tangent,actual*Math.sin(theta)));
      }
      points.push(last);
      bends.push({index:i,start,end:points.length-1,radius:actual,center,cut});
    }
    points.push(path.at(-1).slice());
    return {points,bends};
  }
  P.roundedPath=roundedPath;
})(KIT);
