/* Match tapered offset rails to a 3D spine using a fixed up direction. */
(function (K) {
  const P=K.procedural||K.authoring, V=K.V, EPS=1e-8;
  const vector=value=>Array.isArray(value)&&value.length===3&&Array.from(value).every(Number.isFinite);

  function offsetRails({path, halfWidth, up=[0,1,0], closed=false, miterLimit=2.5, shareSpan=false}={}) {
    if(!Array.isArray(path)||path.length<(closed?3:2)||path.length>4096||
       !Array.from(path).every(vector)||!vector(up)||!Number.isFinite(V.len(up))||V.len(up)<EPS||
       typeof closed!=='boolean'||typeof shareSpan!=='boolean'||
       !Number.isFinite(miterLimit)||miterLimit<1||miterLimit>16)
      throw new Error('Offset rails need a finite spine, up direction and bounded miter limit');
    const widths=typeof halfWidth==='number'?Array(path.length).fill(halfWidth):halfWidth;
    if(!Array.isArray(widths)||widths.length!==path.length||
       !Array.from(widths).every(width=>Number.isFinite(width)&&width>EPS))
      throw new Error('Each offset station needs a positive half-width');
    const axis=V.norm(up), runs=[];
    for(let i=0;i<path.length-(closed?0:1);i++){
      const delta=V.sub(path[(i+1)%path.length],path[i]);
      const projected=V.mad(delta,axis,-V.dot(delta,axis)), length=V.len(projected);
      if(!Number.isFinite(length)||length<EPS)throw new Error('Offset rail stations must differ in the up plane');
      const tangent=V.mul(projected,1/length);
      runs.push({tangent,side:V.cross(axis,tangent),length});
    }
    const left=[],right=[],contracted=[],reversals=[];
    const stations=path.map((_,i)=>{
      const prior=i?runs[i-1]:closed?runs.at(-1):null, next=runs[i]||null;
      const width=widths[i], a=prior?.side||next.side,b=next?.side||a, denominator=1+V.dot(a,b);
      const miter=denominator>EPS?V.mul(V.add(a,b),1/denominator):a;
      let effective=width*Math.min(1,miterLimit/V.len(miter));
      if(!shareSpan)for(const run of [prior,next]){
        if(!run)continue;
        const shift=Math.abs(V.dot(run.tangent,miter));
        if(shift>EPS)effective=Math.min(effective,run.length*.45/shift);
      }
      return {miter,effective,denominator};
    });
    if(shareSpan)for(const [i,run] of runs.entries()){
      const a=stations[i],b=stations[(i+1)%stations.length],
        first=V.dot(run.tangent,a.miter)*a.effective,last=V.dot(run.tangent,b.miter)*b.effective,
        inward=Math.max(Math.max(0,first)+Math.max(0,-last),Math.max(0,-first)+Math.max(0,last));
      // The two ends can use different amounts of the same span. Keep both
      // rails forward without contracting a lone corner to half the run.
      if(inward<=run.length*.96)continue;
      const fraction=run.length*.96/inward;
      a.effective*=fraction;
      b.effective*=fraction;
    }
    for(const [i,{miter,effective,denominator}] of stations.entries()){
      const l=V.mad(path[i],miter,effective),r=V.mad(path[i],miter,-effective);
      if(!vector(l)||!vector(r))throw new Error('Offset rails exceed their finite coordinate range');
      left.push(l);
      right.push(r);
      contracted.push(effective/widths[i]<1-EPS||denominator<=EPS);
      if(denominator<=EPS)reversals.push(i);
    }
    return {left,right,contracted,reversals};
  }

  P.offsetRails=offsetRails;
})(KIT);
