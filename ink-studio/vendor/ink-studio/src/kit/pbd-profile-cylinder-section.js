/* Contact of a swept profile with an affine elliptical cylinder chart. */
(function(K) {
  const P=K.procedural||K.authoring,{V,M}=K,TAU=Math.PI*2,EPS=1e-10;
  const vector=(value,size)=>Array.isArray(value)&&value.length===size&&Array.from(value).every(Number.isFinite);
  const angle=value=>((value%TAU)+TAU)%TAU;
  const evaluate=([offset,cosine,sine],u)=>offset+cosine*Math.cos(u)+sine*Math.sin(u);
  const difference=(a,b)=>a.map((value,i)=>value-b[i]);

  function roots([offset,cosine,sine]){
    const magnitude=Math.hypot(cosine,sine);
    if(!magnitude||Math.abs(offset)>magnitude)return [];
    const phase=Math.atan2(sine,cosine),delta=Math.acos(-offset/magnitude);
    return [angle(phase-delta),angle(phase+delta)];
  }

  function extremum(fn,a,b,maximum){
    const choose=maximum?Math.max:Math.min,
      phase=angle(Math.atan2(fn[2],fn[1])+(maximum?0:Math.PI));
    const edge=choose(evaluate(fn,a),evaluate(fn,b));
    return phase>=a&&phase<=b?choose(edge,evaluate(fn,phase)):edge;
  }

  function interval({lower,upper,station},u){
    if(station.some(fn=>evaluate(fn,u)>EPS))return null;
    let low=lower[0],high=upper[0],a=evaluate(low,u),b=evaluate(high,u);
    for(const fn of lower){
      const value=evaluate(fn,u);
      if(value>a){a=value;low=fn;}
    }
    for(const fn of upper){
      const value=evaluate(fn,u);
      if(value<b){b=value;high=fn;}
    }
    return b-a>EPS?{low,high,min:a,max:b}:null;
  }

  function profileCylinderSection({outline,span,frame,cylinder}={}){
    if(!Array.isArray(outline)||outline.length<3||outline.length>256||
       !Array.from(outline).every(point=>vector(point,2))||
       !vector(span,2)||span[0]>=span[1]||!vector(frame?.t,3)||!vector(frame?.R,9)||
       !['origin','cosine','sine','axis'].every(key=>vector(cylinder?.[key],3)))
      throw new Error('Cylinder sections need a finite profile, depth span, frame and cylinder axes');
    const {origin,cosine,sine,axis}=cylinder,
      axes=[cosine,sine,axis].map(v=>V.norm(v));
    if(Math.abs(M.det(M.cols(...axes)))<EPS)
      throw new Error('Cylinder section axes must span three dimensions');
    P.transforms.distanceScale(frame);
    const inverse=M.inv(frame.R),center=M.app(inverse,V.sub(origin,frame.t)),
      axesLocal=[cosine,sine,axis].map(v=>M.app(inverse,v)), [cosineLocal,sineLocal,axisLocal]=axesLocal;
    if(![center,...axesLocal].every(v=>vector(v,3)))
      throw new Error('Cylinder sections exceed their coordinate range');

    function triangle(indices){
      const planes=indices.map((index,i)=>{
        const [ax,ay]=outline[index],[bx,by]=outline[indices[(i+1)%3]];
        const normal=V.norm([by-ay,ax-bx,0]);
        return {normal,offset:V.dot([ax,ay,0],normal)};
      });
      planes.push({normal:[0,0,-1],offset:-span[0]},{normal:[0,0,1],offset:span[1]});
      const lower=[[0,0,0]],upper=[[1,0,0]],station=[];
      // Substituting the cylinder into a prism plane yields
      // offset + cosine*cos(u) + sine*sin(u) + slope*v <= 0.
      for(const {normal,offset} of planes){
        const terms=[V.dot(normal,center)-offset,V.dot(normal,cosineLocal),V.dot(normal,sineLocal)],
          slope=V.dot(normal,axisLocal),bound=Math.abs(slope)<EPS?terms:terms.map(value=>-value/slope);
        if(!vector(bound,3)||!Number.isFinite(slope))throw new Error('Cylinder sections exceed their coordinate range');
        if(Math.abs(slope)<EPS)station.push(bound);
        else (slope<0?lower:upper).push(bound);
      }
      const breaks=[0,TAU,...station.flatMap(roots)],bounds=lower.concat(upper);
      // The order of the vertical bounds is constant between pairwise ties.
      for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++)
        breaks.push(...roots(difference(bounds[i],bounds[j])));
      return {lower,upper,station,breaks:breaks.sort((a,b)=>a-b)};
    }

    const triangles=P.geometry.triangulate2D(outline).map(triangle),segments=[];
    for(const piece of triangles)for(let i=1;i<piece.breaks.length;i++){
      const a=piece.breaks[i-1],b=piece.breaks[i];
      if(b-a<EPS)continue;
      const active=interval(piece,(a+b)*.5);
      if(active)segments.push({min:[a/TAU,Math.max(0,extremum(active.low,a,b,false))],
        max:[b/TAU,Math.min(1,extremum(active.high,a,b,true))]});
    }

    const ordered=segments.sort((a,b)=>a.min[0]-b.min[0]),bands=[];
    for(const entry of ordered){
      const last=bands.at(-1);
      if(last&&entry.min[0]<=last.max[0]+EPS){
        last.min[1]=Math.min(last.min[1],entry.min[1]);
        last.max[0]=Math.max(last.max[0],entry.max[0]);
        last.max[1]=Math.max(last.max[1],entry.max[1]);
      }else bands.push(entry);
    }
    if(bands.length>1&&bands[0].min[0]<=EPS&&bands.at(-1).max[0]>=1-EPS){
      const first=bands.shift(),last=bands.at(-1);
      last.min[1]=Math.min(last.min[1],first.min[1]);
      last.max=[first.max[0]+1,Math.max(last.max[1],first.max[1])];
    }

    function at(u){
      if(!Number.isFinite(u))throw new Error('Cylinder sections need a finite chart station');
      const theta=angle((u%1)*TAU),runs=triangles.map(piece=>interval(piece,theta)).filter(Boolean)
        .sort((a,b)=>a.min-b.min),result=[];
      for(const run of runs){
        const last=result.at(-1);
        if(last&&run.min<=last[1]+EPS)last[1]=Math.max(last[1],run.max);
        else result.push([run.min,run.max]);
      }
      return result;
    }
    return Object.freeze({at,bands:P.data.freeze(bands)});
  }

  P.geometry.profileCylinderSection=profileCylinderSection;
})(KIT);
