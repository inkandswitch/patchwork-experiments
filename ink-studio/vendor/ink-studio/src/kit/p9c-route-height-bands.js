/* Fit a grade-limited route through sampled vertical clearance bands. */
(function (K) {
  const P=K.procedural||K.authoring, EPS=1e-9;
  const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));

  function fitHeightBands(samples,{maxGrade,maxPoints=256}={}) {
    if(!Array.isArray(samples)||samples.length<2||samples.length>4096||
       !Number.isFinite(maxGrade)||maxGrade<0||
       !Number.isSafeInteger(maxPoints)||maxPoints<2||maxPoints>4096)
      throw Error('Route height bands need bounded stations, grade and point budget');
    const input=Array.from(samples,(sample,i)=>{
      const {at,min,max,preferred,keep=false}=sample||{};
      if(![at,min,max].every(Number.isFinite)||preferred!==undefined&&!Number.isFinite(preferred)||
         typeof keep!=='boolean'||i>0&&at<=samples[i-1].at)
        throw Error('Route height bands need increasing finite stations and valid targets');
      return {at,min,max,preferred:preferred??min,keep};
    });
    if(input.some(s=>s.min>s.max))return null;
    const reachable=input.map(s=>[s.min,s.max]),last=input.length-1;
    const delta=(a,b)=>maxGrade*(input[b].at-input[a].at);
    for(let i=last-1;i>=0;i--){
      const [nextMin,nextMax]=reachable[i+1],run=delta(i,i+1),band=reachable[i];
      band[0]=Math.max(band[0],nextMin-run);
      band[1]=Math.min(band[1],nextMax+run);
      if(band[0]>band[1]+EPS)return null;
    }
    const heights=[clamp(input[0].preferred,...reachable[0])];
    for(let i=1;i<=last;i++){
      const [lo,hi]=reachable[i],from=heights[i-1],run=delta(i-1,i);
      heights.push(clamp(input[i].preferred,Math.max(lo,from-run),Math.min(hi,from+run)));
    }

    const indices=[0];
    while(indices.at(-1)<last){
      const start=indices.at(-1),base=heights[start];
      let end=start+1,low=-maxGrade,high=maxGrade;
      for(let i=start+1;i<=last;i++){
        const run=input[i].at-input[start].at,grade=(heights[i]-base)/run;
        if(grade>=low-EPS&&grade<=high+EPS)end=i;
        if(input[i].keep)break;
        low=Math.max(low,(input[i].min-base)/run);
        high=Math.min(high,(input[i].max-base)/run);
        if(low>high+EPS)break;
      }
      if(indices.length===maxPoints)return null;
      indices.push(end);
    }
    return P.data.freeze({indices,elevations:indices.map(i=>heights[i])});
  }

  (P.routes||(P.routes={})).fitHeightBands=fitHeightBands;
})(KIT);
