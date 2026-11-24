/* Exact retained spans of an edge passing through sloped rectangular strips. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-8;
  const point=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);

  function strip(a,b,{halfWidth,extension=0,above=.20,below=.20}={}){
    if(!point(a)||!point(b)||![halfWidth,extension,above,below].every(Number.isFinite)||
        halfWidth<=0||extension<0||above<0||below<0||above+below<=0)
      throw Error('A clearance strip needs finite endpoints, width and vertical limits');
    const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
    if(!Number.isFinite(length)||length<EPS)throw Error('A clearance strip needs a horizontal span');
    const along=[dx/length,0,dz/length],across=[-along[2],0,along[0]],
      grade=(b[1]-a[1])/length,vertical=[-grade*along[0],1,-grade*along[2]];
    if(!Number.isFinite(grade))throw Error('Clearance strip grade must be finite');
    return Object.freeze({
      origin:Object.freeze(a.slice()),along:Object.freeze(along),across:Object.freeze(across),length,
      slabs:Object.freeze([[along,-extension,length+extension],[across,-halfWidth,halfWidth],
        [Object.freeze(vertical),-below,above]].map(Object.freeze))
    });
  }

  function ranges(a,b,strips){
    if(!point(a)||!point(b)||!Array.isArray(strips))throw Error('Edge clearance needs endpoints and a strip list');
    const delta=V.sub(b,a),cuts=[];
    for(const {origin,slabs} of strips){
      const relative=V.sub(a,origin);
      let start=0,end=1;
      for(const [normal,low,high] of slabs){
        const x=V.dot(relative,normal),dx=V.dot(delta,normal);
        if(Math.abs(dx)<EPS){
          if(x<low||x>high){end=0;break;}
          continue;
        }
        const entry=(low-x)/dx,exit=(high-x)/dx;
        start=Math.max(start,Math.min(entry,exit));
        end=Math.min(end,Math.max(entry,exit));
        if(start>=end)break;
      }
      if(end-start>EPS)cuts.push([start,end]);
    }
    cuts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const removed=[],kept=[];
    for(const cut of cuts){
      const last=removed.at(-1);
      if(last&&cut[0]<=last[1]+EPS)last[1]=Math.max(last[1],cut[1]);
      else removed.push(cut);
    }
    let start=0;
    for(const [low,high] of removed){
      if(low-start>EPS)kept.push([start,low]);
      start=high;
    }
    if(1-start>EPS)kept.push([start,1]);
    return {kept,removed};
  }

  function footprint(outline,{padding=0}={}){
    if(!Number.isFinite(padding)||padding<0)throw Error('Clearance footprint padding must be nonnegative');
    const {cells}=P.surfaceCells.clip([{key:'clearance',polygon:outline}],{budget:1});
    const ring=cells[0]?.fragments[0];
    if(!ring)throw Error('Edge clearance needs a convex footprint');
    const origin=[ring[0][0],0,ring[0][1]];
    const slabs=ring.map(([x,z],i)=>{
      const [u,v]=ring[(i+1)%ring.length],normal=V.norm([v-z,0,x-u]);
      const high=normal[0]*(x-origin[0])+normal[2]*(z-origin[2])+padding;
      return [normal,-Infinity,high];
    });
    return P.data.freeze({origin,slabs});
  }

  function clipFieldPath(points, fields, {padding=0, spacing=.035, tolerance=.001}={}) {
    if(!Array.isArray(points)||points.length<2||points.length>4097||!points.every(point)||
       !Array.isArray(fields)||fields.length>4096||!Number.isFinite(padding)||padding<0||
       !Number.isFinite(spacing)||!Number.isFinite(tolerance)||tolerance<=0||spacing<tolerance)
      throw Error('Field path clearance needs bounded points, fields and sample spacing');
    const obstacles=fields.map(field=>{
      if(typeof field?.distance!=='function')throw Error('Path clearance fields need a distance function');
      return {field,bounds:P.spatial.expand(P.spatial.bounds(field.bounds),padding)};
    });
    if(!obstacles.length)return null;
    const runs=[];
    let active=null,cut=false;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],delta=V.sub(b,a),length=V.len(delta);
      if(length<=EPS)continue;
      const limits=P.spatial.boxOf([a,b]),removed=[];
      for(const {field,bounds} of obstacles){
        if(!P.spatial.overlap(limits,bounds))continue;
        let low=0,high=1;
        for(let axis=0;axis<3;axis++){
          if(Math.abs(delta[axis])<=EPS)continue;
          const entry=(bounds.min[axis]-a[axis])/delta[axis],exit=(bounds.max[axis]-a[axis])/delta[axis];
          low=Math.max(low,Math.min(entry,exit));
          high=Math.min(high,Math.max(entry,exit));
        }
        if(high-low<=EPS)continue;
        const step=Math.min(spacing/length,(high-low)/4);
        const trace=P.traceSignedIntervals(t=>field.distance(V.mad(a,delta,t))-padding,{
          range:[low,high],step,tolerance:Math.min(step,tolerance/length),maxSamples:8193
        });
        removed.push(...(trace.complete?trace.intervals:[[low,high]]));
      }
      removed.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
      let start=0;
      function keep(end){
        if(end-start<=EPS)return;
        const p=V.mad(a,delta,start);
        if(!active||V.dist(active.at(-1),p)>EPS)runs.push(active=[p]);
        active.push(V.mad(a,delta,end));
      }
      for(const [low,high] of removed){
        keep(low);
        if(high>start){start=high;active=null;cut=true;}
      }
      keep(1);
    }
    return cut?P.data.freeze(runs):null;
  }

  P.edgeClearance=Object.freeze({strip,footprint,ranges,clipFieldPath});
})(KIT);
