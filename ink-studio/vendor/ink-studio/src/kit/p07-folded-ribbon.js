/* Piecewise ruled charts for sweeping geometry around a planar closed contour. */
(function (K) {
  const P = K.procedural || K.authoring, {V,M}=K, EPS=1e-7;
  const vector = q => Array.isArray(q) && q.length===3 && q.every(Number.isFinite);
  const mod = (v,n) => ((v%n)+n)%n;
  function join(a,b) {
    const scale = 1+V.dot(a,b);
    if(scale<=EPS)throw Object.assign(new RangeError('Ribbon faces meet at a degenerate angle'),{code:'DEGENERATE_RIBBON'});
    return V.mul(V.add(a,b),1/scale);
  }

  function clip(vertices,x,side) {
    const out=[];
    for(let i=0;i<vertices.length;i++) {
      const a=vertices[i],b=vertices[(i+1)%vertices.length],
        d=(a.p[0]-x)*side,e=(b.p[0]-x)*side;
      if(d>=0)out.push(a);
      if(d*e<0) {
        const t=d/(d-e);
        const mix=(u,v)=>u.map((n,j)=>n+(v[j]-n)*t);
        out.push({p:[x,...mix(a.p,b.p).slice(1)],n:mix(a.n,b.n),uv:mix(a.uv,b.uv)});
      }
    }
    return out;
  }

  function mapMesh(mesh,bands) {
    const b=P.geometry.builder();
    for(const group of mesh.groups)for(let i=group.start;i<group.start+group.count;i+=3) {
      const triangle=[i,i+1,i+2].map(j=>({
        p:Array.from(mesh.positions.subarray(j*3,j*3+3)),
        n:Array.from(mesh.normals.subarray(j*3,j*3+3)),
        uv:Array.from(mesh.uv.subarray(j*2,j*2+2))
      }));
      const xs=triangle.map(v=>v.p[0]),lo=Math.min(...xs),hi=Math.max(...xs);
      for(const band of bands) {
        if(hi<band.min||lo>band.max||hi===lo&&lo===band.max&&band!==bands.at(-1))continue;
        const poly=clip(clip(triangle,band.min,1),band.max,-1).map(v=>({
          p:band.map(v.p),n:band.normal(v.p,v.n),uv:v.uv
        }));
        for(let j=1;j<poly.length-1;j++) {
          const face=band.mirrored?[poly[0],poly[j+1],poly[j]]:[poly[0],poly[j],poly[j+1]];
          b.triangle(...face.map(v=>v.p),group,face.map(v=>v.uv),face.map(v=>v.n));
        }
      }
    }
    return b.finish();
  }

  function compile(faces,{origin=0,offset=0}={}) {
    if(!Array.isArray(faces)||faces.length<3||faces.length>512||
      !faces.every(f=>[f?.a,f?.b,f?.up,f?.normal].every(vector))||
      !Number.isFinite(origin)||!Number.isFinite(offset))throw Error('Ribbon needs a finite loop of face frames');
    const normals=faces.map(f=>V.norm(f.normal));
    let length=0,winding;
    const frames=faces.map((f,i)=>{
      const prev=(i+faces.length-1)%faces.length,next=(i+1)%faces.length;
      const a=f.a.slice(),edge=V.sub(f.b,a),span=V.len(edge),up=V.norm(f.up),n=normals[i],start=length;
      const facing=V.dot(V.cross(edge,up),n),sign=Math.sign(facing);
      if(span<=EPS||V.dist(f.b,faces[next].a)>EPS*Math.max(1,span)||
        Math.abs(V.dot(edge,n))>EPS*span||Math.abs(V.dot(up,n))>EPS||
        Math.abs(facing)<=EPS*span||(winding&&winding!==sign))
        throw Object.assign(new RangeError('Ribbon faces must form a regular oriented loop'),{code:'DEGENERATE_RIBBON'});
      winding=sign;
      const x=V.mul(edge,1/span),inv=M.inv(M.cols(x,up,n));
      const first=join(normals[prev],n),last=join(n,normals[next]),turn=V.sub(last,first);
      const entry=M.app(inv,first),change=M.app(inv,turn),slope=change[0]/span;
      length+=span;
      function map(q) {
        return V.mad(V.mad(V.mad(a,x,q[0]),up,q[1]),
          V.mad(first,turn,q[0]/span),q[2]+offset);
      }
      function project(point) {
        const q=M.app(inv,V.sub(point,a)),width=1+slope*q[2];
        if(width<=EPS)return null;
        const s=(q[0]-q[2]*entry[0])/width;
        return [s,q[1]-q[2]*(entry[1]+s/span*change[1]),q[2]-offset];
      }
      function basis(q) {
        const run=V.mad(x,turn,(q[2]+offset)/span),out=V.mad(first,turn,q[0]/span);
        return {run,up,out};
      }
      return {key:f.key,start,span,slope,map,project,basis,mirrored:sign<0};
    });

    // Leave some width at the narrowest inset instead of crossing lanes
    // on the inside of a sharp corner.
    const inset=offset+Math.min(...frames.filter(f=>f.slope>0).map(f=>.72/f.slope));
    const center=mod(origin,length);
    function region(min,max) {
      if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min||max-min>=length)
        throw Error('Ribbon region must be shorter than its perimeter');
      const bands=[];
      const first=Math.floor((min+center)/length),last=Math.floor((max+center)/length);
      for(let cycle=first;cycle<=last;cycle++)for(const frame of frames) {
        const start=frame.start+cycle*length-center,low=Math.max(min,start),high=Math.min(max,start+frame.span);
        if(high-low<=EPS)continue;
        const local=p=>[p[0]-start,p[1],p[2]];
        const mappedNormal=(q,n)=>{
          const {run,up,out}=frame.basis(local(q));
          return V.norm(M.app(M.tr(M.inv(M.cols(run,up,out))),n));
        };
        bands.push({key:frame.key,min:low,max:high,mirrored:frame.mirrored,
          map:q=>frame.map(local(q)),normal:mappedNormal,
          project(point){
            const q=frame.project(point);
            return q&&[q[0]+start,q[1],q[2]];
          },
          basis:q=>frame.basis(local(q))
        });
      }
      function bandAt(x) {
        return bands.find(b=>x<b.max-EPS)||bands.at(-1);
      }
      function project(point) {
        let best=null;
        for(const band of bands) {
          const q=band.project(point);
          if(!q)continue;
          const outside=Math.max(0,band.min-q[0],q[0]-band.max),
            valid=outside<=EPS,distance=Math.hypot(outside,q[2]+offset);
          if(!best||valid&&!best.valid||valid===best.valid&&distance<best.distance)
            best={q,band,valid,distance};
        }
        return best;
      }
      function bounds(box) {
        const points=[];
        for(const band of bands) {
          const a=Math.max(band.min,box.min[0]),b=Math.min(band.max,box.max[0]);
          if(a>b)continue;
          for(const x of [a,b])for(const y of [box.min[1],box.max[1]])for(const z of [box.min[2],box.max[2]])
            points.push(band.map([x,y,z]));
        }
        return P.spatial.boxOf(points);
      }
      return {bands,bandAt,map:q=>bandAt(q[0]).map(q),project,bounds,mesh:value=>mapMesh(value,bands)};
    }
    return {length,inset,region};
  }
  P.foldedRibbon=Object.freeze({compile});
})(KIT);
