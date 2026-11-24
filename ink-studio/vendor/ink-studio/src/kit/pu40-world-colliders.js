/* Convex cores, rounded segments and compound collision queries. */
(function(K) {
  const W=K.world, P=K.procedural, {V,M}=K, {check,record,vector}=W.data;
  const {clamp}=W.fields, {freeze}=P.data;
  const eps=1e-8, axisX=[1,0,0], down=[0,-1,0];
  const shapes=new WeakMap(), boxes=new WeakMap(), bends=new WeakMap(), poses=new WeakMap();
  const shapeKeys=new WeakMap(), flatShapes=new Map(), flatPoses=new Map(), facetedPairs=new Map();
  const xyz=point=>vector(point)&&point.every(n=>Math.abs(n)<=1e4);
  const positive=n=>Number.isFinite(n)&&n>=.005&&n<=1e4;
  const keys=(row,allowed)=>record(row)&&Object.keys(row).every(key=>allowed.includes(key));
  const between=(v,a,b)=>v>=a-eps&&v<=b+eps;
  const length2=v=>V.dot(v,v);
  function remember(map,key,value) {
    if(map.size===32)map.delete(map.keys().next().value);
    map.set(key,value);
    return value;
  }
  const closest=(p,a,b)=>{
    const step=V.sub(b,a), length=length2(step);
    return length?V.mad(a,step,clamp(V.dot(V.sub(p,a),step)/length,0,1)):a;
  };

  function poly(vertices,faces,directions) {
    const edges=new Map();
    for(const face of faces)for(let i=0;i<face.length;i++){
      const a=face[i], b=face[(i+1)%face.length], key=Math.min(a,b)+'/'+Math.max(a,b);
      const row=edges.get(key)??{a,b,count:0};
      row.count++;
      edges.set(key,row);
    }
    check([...edges.values()].every(row=>row.count===2)&&new Set(faces.flat()).size===vertices.length,
      'Convex collider faces must form one closed shell');
    const pairs=[...edges.values()].map(({a,b})=>[a,b]), adjacent=vertices.map(()=>[]);
    for(const [a,b] of pairs){adjacent[a].push(b);adjacent[b].push(a);}
    const connected=new Set([0]);
    for(const i of connected)for(const j of adjacent[i])connected.add(j);
    check(connected.size===vertices.length,'Convex collider faces must share a connected shell');
    return {kind:'poly',vertices,faces,directions,edges:pairs};
  }
  function box(half,at=[0,0,0],turn=0) {
    const R=M.rot([0,1,0],turn), [x,y,z]=half;
    const vertices=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],
      [-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(p=>V.add(at,M.app(R,p)));
    const normals=[[0,0,-1],[0,0,1],[0,-1,0],[1,0,0],[0,1,0],[-1,0,0]].map(p=>M.app(R,p));
    return poly(vertices,P.pieces.boxFaces,normals);
  }
  function flatCapsule(a,b,radius) {
    const key=[...a,...b,radius].join(','), cached=flatShapes.get(key);
    if(cached)return cached;
    const axis=V.norm(V.sub(b,a)), right=V.perp(axis), front=V.cross(axis,right);
    const sides=16, arcs=4, vertices=[], faces=[];
    const directions=Array.from({length:sides},(_,i)=>{
      const angle=2*Math.PI*i/sides;
      return V.add(V.mul(right,Math.cos(angle)),V.mul(front,Math.sin(angle)));
    });
    function ring(center,r) {for(const direction of directions)vertices.push(V.mad(center,direction,r));}
    ring(a,radius);
    for(let i=0;i<arcs;i++){
      const angle=Math.PI*.5*i/arcs;
      ring(V.mad(b,axis,radius*Math.sin(angle)),radius*Math.cos(angle));
    }
    const tip=vertices.push(V.mad(b,axis,radius))-1;
    faces.push(directions.map((_,i)=>sides-1-i));
    for(let row=0;row<arcs;row++)for(let i=0;i<sides;i++){
      const j=(i+1)%sides, base=row*sides;
      faces.push([base+i,base+j,base+sides+j,base+sides+i]);
    }
    for(let i=0;i<sides;i++)faces.push([arcs*sides+i,arcs*sides+(i+1)%sides,tip]);
    const normals=faces.map(([i,j,k])=>V.norm(V.cross(V.sub(vertices[j],vertices[i]),V.sub(vertices[k],vertices[i]))));
    return remember(flatShapes,key,freeze({...poly(vertices,faces,normals),facetedKey:key}));
  }
  function component(raw) {
    check(record(raw),'Expected a collider part');
    if(raw.kind==='capsule'){
      check(keys(raw,['kind','a','b','radius','flatBottom'])&&xyz(raw.a)&&xyz(raw.b)&&positive(raw.radius)&&
        (raw.flatBottom===undefined||typeof raw.flatBottom==='boolean'),'Invalid capsule collider');
      if(raw.flatBottom){
        check(V.dist(raw.a,raw.b)>=eps,'A flat-bottom capsule needs distinct endpoints');
        return flatCapsule(raw.a,raw.b,raw.radius);
      }
      return {kind:'capsule',vertices:[raw.a,raw.b],radius:raw.radius};
    }
    if(raw.kind==='box'){
      check(keys(raw,['kind','at','half','turn'])&&vector(raw.half)&&raw.half.every(positive)&&
        xyz(raw.at??[0,0,0])&&Number.isFinite(raw.turn??0),'Invalid box collider');
      return box(raw.half,raw.at,raw.turn);
    }
    check(raw.kind==='convex'&&keys(raw,['kind','vertices','faces'])&&Array.isArray(raw.vertices)&&
      raw.vertices.length>=4&&raw.vertices.length<=24&&raw.vertices.every(xyz)&&Array.isArray(raw.faces)&&
      new Set(raw.vertices.map(p=>p.join('/'))).size===raw.vertices.length&&
      raw.faces.length>=4&&raw.faces.length<=32&&raw.faces.every(face=>Array.isArray(face)&&
        face.length>=3&&face.length<=24&&new Set(face).size===face.length),'Invalid bounded convex collider');
    P.pieces.convex(raw.vertices,raw.faces);
    const center=V.mul(raw.vertices.reduce(V.add),1/raw.vertices.length), normals=[];
    const faces=raw.faces.map(indices=>{
      const [a,b,c]=indices.map(i=>raw.vertices[i]), n=V.norm(V.cross(V.sub(b,a),V.sub(c,b)));
      const reverse=V.dot(n,V.sub(a,center))<0, face=reverse?indices.slice().reverse():indices;
      const normal=reverse?V.mul(n,-1):n;
      check(face.every((index,i)=>{
        const p=raw.vertices[index], q=raw.vertices[face[(i+1)%face.length]], edge=V.sub(q,p);
        return V.len(edge)>eps&&face.every(j=>V.dot(V.cross(edge,V.sub(raw.vertices[j],p)),normal)>=-eps);
      }),'A convex collider face needs an ordered convex boundary');
      normals.push(normal);
      return face;
    });
    return poly(raw.vertices,faces,normals);
  }
  function local(shape) {
    check(record(shape),'Expected a collider');
    let compiled=shapes.get(shape);
    if(compiled)return compiled;
    const raw=shape.kind==='compound'?shape.parts:[shape];
    check(Array.isArray(raw)&&raw.length>=1&&raw.length<=12&&
      (shape.kind!=='compound'||keys(shape,['kind','parts'])),'Invalid bounded collider compound');
    compiled=raw.map(component);
    const half=[0,1,2].map(i=>Math.max(...compiled.flatMap(part=>part.vertices.map(p=>Math.abs(p[i])+(part.radius??0)))));
    const output=freeze({parts:compiled,half});
    shapes.set(shape,output);
    return output;
  }
  function edgeVectors(points,edges) {
    const vectors=[];
    for(const [i,j] of edges){
      const d=V.sub(points[j],points[i]);
      if(length2(d)<=eps*eps)continue;
      const v=V.norm(d);
      if(!vectors.some(u=>Math.abs(V.dot(u,v))>1-1e-12))vectors.push(v);
    }
    return vectors;
  }
  function flatPose(part,rotation) {
    const key=part.facetedKey+'/'+rotation.join(','), cached=flatPoses.get(key);
    if(cached)return cached;
    const points=part.vertices.map(p=>M.app(rotation,p));
    return remember(flatPoses,key,{points,vectors:edgeVectors(points,part.edges)});
  }
  function bentParts(body){
    const {bend,half}=body, {axis,offsets}=bend, cached=bends.get(bend);
    if(cached?.half===half)return cached.parts;
    const boxShape=box(half), sections=offsets.length-1;
    const parts=offsets.slice(0,-1).map((_,i)=>{
      const vertices=boxShape.vertices.map(p=>{
        const index=i+Number(p[axis]>0), q=p.slice();
        q[axis]=(2*index/sections-1)*half[axis];
        return V.add(q,offsets[index]);
      });
      const normals=boxShape.faces.map(([a,b,c],i)=>{
        const n=V.norm(V.cross(V.sub(vertices[b],vertices[a]),V.sub(vertices[c],vertices[a])));
        return V.dot(n,boxShape.directions[i])<0?V.mul(n,-1):n;
      });
      return poly(vertices,boxShape.faces,normals);
    });
    bends.set(bend,{half,parts});
    return parts;
  }
  function geometry(body) {
    if(poses.has(body))return poses.get(body);
    let parts;
    if(body.bend)parts=bentParts(body);
    else if(body.collider)parts=local(body.collider).parts;
    else {
      if(!boxes.has(body.half))boxes.set(body.half,box(body.half));
      parts=[boxes.get(body.half)];
    }
    const result=parts.map((part,partId)=>{
      const flat=part.facetedKey===undefined?null:flatPose(part,body.rotation);
      const points=flat?flat.points.map(p=>V.add(body.position,p)):
        part.vertices.map(p=>V.add(body.position,M.app(body.rotation,p)));
      const radius=part.radius??0;
      const min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))-radius);
      const max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))+radius);
      const dirs=part.directions?.map(n=>M.app(body.rotation,n))??[];
      const faces=part.faces?.map((face,i)=>({ids:face,n:dirs[i]}))??[];
      const edges=part.edges??[[0,1]], vectors=flat?.vectors??edgeVectors(points,edges);
      return {kind:part.kind,part:partId,points,radius,faces,edges,vectors,min,max,
        flat,source:part,position:body.position,rotation:body.rotation};
    });
    const bounds={min:[0,1,2].map(i=>Math.min(...result.map(p=>p.min[i]))),
      max:[0,1,2].map(i=>Math.max(...result.map(p=>p.max[i])))};
    const built={parts:result,...bounds};
    poses.set(body,built);
    return built;
  }
  function closestFace(point,part,face) {
    const {ids,n}=face, points=part.points;
    const projected=V.mad(point,n,-V.dot(n,V.sub(point,points[ids[0]])));
    let nearest=projected, best=Infinity, inside=true;
    for(let i=0;i<ids.length;i++){
      const a=points[ids[i]], b=points[ids[(i+1)%ids.length]];
      if(V.dot(V.cross(V.sub(b,a),V.sub(projected,a)),n)<-eps)inside=false;
      const q=closest(projected,a,b), gap=length2(V.sub(q,projected));
      if(gap<best){best=gap;nearest=q;}
    }
    return inside?projected:nearest;
  }
  function partDistance(part,point,fast=false) {
    if(part.kind==='capsule')return V.dist(point,closest(point,...part.points))-part.radius;
    const plane=Math.max(...part.faces.map(face=>V.dot(face.n,V.sub(point,part.points[face.ids[0]]))));
    if(plane<=0||fast)return plane;
    return Math.min(...part.faces.map(face=>V.dist(point,closestFace(point,part,face))));
  }
  function distance(body,point,fast=false) {
    if(body.bend){
      const local=W.durability.unbendPoint(body,M.app(M.tr(body.rotation),V.sub(point,body.position)));
      const q=local.map((n,i)=>Math.abs(n)-body.half[i]), inside=Math.max(...q);
      if(inside<=0)return inside;
      if(fast)return Math.hypot(...q.map(n=>Math.max(n,0)));
    }
    return Math.min(...geometry(body).parts.map(part=>partDistance(part,point,fast)));
  }
  function rayPoly(part,from,delta,limit) {
    let low=0, high=limit, normal;
    for(const {ids,n} of part.faces){
      const den=V.dot(n,delta), off=V.dot(n,V.sub(part.points[ids[0]],from));
      if(Math.abs(den)<eps){if(off<0)return null;continue;}
      const t=off/den;
      if(den<0&&t>=low){low=t;normal=n;}
      if(den>0)high=Math.min(high,t);
      if(low>high)return null;
    }
    return {t:low,normal};
  }
  function rayCapsule(part,from,dir,limit) {
    const [a,b]=part.points, d=V.sub(b,a), length=V.len(d), axis=length?V.mul(d,1/length):axisX;
    let best;
    function intersection(start,tangent,accept) {
      const A=length2(tangent), B=V.dot(start,tangent), C=length2(start)-part.radius**2, discriminant=B*B-A*C;
      if(A<=eps**2||discriminant<0)return;
      const t=(-B-Math.sqrt(discriminant))/A;
      if(!between(t,0,limit)||!accept(t)||best&&t>=best.t)return;
      const point=V.mad(from,dir,Math.max(0,t)), normal=V.norm(V.sub(point,closest(point,a,b)));
      if(V.dot(normal,dir)<-eps)best={t:Math.max(0,t),normal};
    }
    const aa=V.sub(from,a), axial=V.dot(aa,axis), along=V.dot(dir,axis);
    if(length>eps)intersection(V.mad(aa,axis,-axial),V.mad(dir,axis,-along),t=>between(axial+along*t,0,length));
    intersection(aa,dir,t=>length<=eps||axial+along*t<=eps);
    if(length>eps)intersection(V.sub(from,b),dir,t=>axial+along*t>=length-eps);
    return best;
  }
  function ray(body,origin,axis,span) {
    const {parts}=geometry(body);
    return parts.flatMap(part=>{
      const hit=part.kind==='poly'?rayPoly(part,origin,axis,span):rayCapsule(part,origin,axis,span);
      if(!hit?.normal||V.dot(hit.normal,axis)>=-eps)return [];
      const point=V.mad(origin,axis,hit.t);
      if(parts.some(other=>other!==part&&partDistance(other,point,true)<-eps))return [];
      return [{point,distance:hit.t,normal:hit.normal,id:body.id,material:body.material,part:part.part}];
    }).sort((a,b)=>a.distance-b.distance||a.part-b.part);
  }
  function columns(body,x,z,low,high) {
    return ray(body,[x,high,z],down,high-low).map(({point,distance,...hit})=>({y:point[1],...hit}));
  }
  function closestSegments(p,q,r,s) {
    const a=V.sub(q,p), b=V.sub(s,r), v=V.sub(p,r), aa=length2(a), bb=length2(b),
      ab=V.dot(a,b), av=V.dot(a,v), bv=V.dot(b,v), det=length2(V.cross(a,b));
    let u=det>1e-14*aa*bb?clamp((ab*bv-bb*av)/det,0,1):0, t=bb?clamp((ab*u+bv)/bb,0,1):0;
    u=aa?clamp((ab*t-av)/aa,0,1):0;
    return [V.mad(p,a,u),V.mad(r,b,t)];
  }
  function projection(part,axis,offset) {
    const dots=part.points.map(p=>V.dot(p,axis)), shift=offset?V.dot(offset,axis):0;
    return [Math.min(...dots)-part.radius+shift,Math.max(...dots)+part.radius+shift];
  }
  function visitAxes(a,b,test) {
    for(const f of a.faces)test(f.n);
    for(const f of b.faces)test(f.n);
    for(const u of a.vectors)for(const v of b.vectors){
      const cross=V.cross(u,v), length=V.len(cross);
      if(length>eps)test(V.mul(cross,1/length));
    }
  }
  function poseKey({source,rotation}) {
    if(!shapeKeys.has(source))shapeKeys.set(source,source.facetedKey!==undefined?`flat:${source.facetedKey}`:
      JSON.stringify([source.vertices,source.faces]));
    return shapeKeys.get(source)+'/'+rotation.join(',');
  }
  function axesAtOrigin(part) {
    const {source,rotation,edges,flat}=part;
    const points=flat?.points??source.vertices.map(p=>M.app(rotation,p));
    return {...part,points,vectors:flat?.vectors??edgeVectors(points,edges)};
  }
  function facetedContact(a,b,offset) {
    // Faceted domes have many candidate axes. The projection intervals depend on orientation only.
    const key=poseKey(a)+'|'+poseKey(b);
    let axes=facetedPairs.get(key);
    if(!axes){
      const left=axesAtOrigin(a), right=axesAtOrigin(b), seen=new Set();
      axes=[];
      visitAxes(left,right,axis=>{
        const rounded=axis.map(n=>Math.round(n*1e12));
        const sign=rounded.find(n=>n!==0)<0?-1:1, fingerprint=rounded.map(n=>n*sign).join(',');
        if(seen.has(fingerprint))return;
        seen.add(fingerprint);
        const [lo,hi]=projection(left,axis), [min,max]=projection(right,axis);
        axes.push({axis,forward:min-hi,backward:lo-max});
      });
      remember(facetedPairs,key,axes);
    }
    const delta=V.sub(V.sub(b.position,a.position),offset??[0,0,0]);
    let gap=-Infinity, normal;
    for(const {axis,forward,backward} of axes){
      const shift=V.dot(delta,axis);
      if(forward+shift>gap){gap=forward+shift;normal=axis;}
      if(backward-shift>gap){gap=backward-shift;normal=V.mul(axis,-1);}
    }
    return {gap,normal};
  }
  function sat(a,b,offset) {
    if(a.kind==='poly'&&b.kind==='poly'&&(a.source.facetedKey!==undefined||b.source.facetedKey!==undefined))
      return facetedContact(a,b,offset);
    let gap=-Infinity, normal;
    function test(axis) {
      const [lo,hi]=projection(a,axis,offset), [min,max]=projection(b,axis);
      if(min-hi>gap){gap=min-hi;normal=axis;}
      if(lo-max>gap){gap=lo-max;normal=V.mul(axis,-1);}
    }
    visitAxes(a,b,test);
    return {gap,normal};
  }
  function separation(a,b,offset) {
    if(a.kind==='poly'&&b.kind==='poly')return sat(a,b,offset);
    if(a.kind==='poly'){
      const inverse=separation(b,a,offset&&V.mul(offset,-1));
      return {gap:inverse.gap,normal:V.mul(inverse.normal,-1)};
    }
    const [p,q]=offset?a.points.map(v=>V.add(v,offset)):a.points;
    let pair, nearest=Infinity;
    function take(from,to) {
      const gap=length2(V.sub(from,to));
      if(gap<nearest){nearest=gap;pair=[from,to];}
    }
    if(b.kind==='capsule')take(...closestSegments(p,q,...b.points));
    else{
      if(rayPoly(b,p,V.sub(q,p),1))return sat(a,b,offset);
      for(const f of b.faces){take(p,closestFace(p,b,f));take(q,closestFace(q,b,f));}
      for(const [i,j] of b.edges)take(...closestSegments(p,q,b.points[i],b.points[j]));
    }
    const gap=Math.sqrt(nearest), radial=a.radius+b.radius;
    if(gap>eps)return {gap:gap-radial,normal:V.mul(V.sub(pair[1],pair[0]),1/gap)};
    const u=a.vectors[0], v=b.vectors[0], cross=u&&v&&V.cross(u,v);
    return {gap:-radial,normal:cross&&V.len(cross)>eps?V.norm(cross):u||v?V.perp(u??v):axisX};
  }
  const intersects=(a,b,offset=[0,0,0])=>a.min.every((n,i)=>n+Math.min(0,offset[i])<=b.max[i]+eps&&
    a.max[i]+Math.max(0,offset[i])>=b.min[i]-eps);
  function contact(a,b) {
    let best=null;
    for(const left of geometry(a).parts)for(const right of geometry(b).parts){
      if(!intersects(left,right))continue;
      const hit=separation(left,right);
      if(hit.gap<=eps&&(!best||hit.gap<best.gap))best={...hit,parts:[left.part,right.part]};
    }
    return best;
  }
  const separatedHeight=(a,b,dy)=>a.min[1]+Math.min(0,dy)>=b.max[1]-eps||
    a.max[1]+Math.max(0,dy)<=b.min[1]+eps;
  function sweep(a,b,delta,{allowSurfaceSlide=false}={}) {
    let best=null;
    for(const left of geometry(a).parts)for(const right of geometry(b).parts){
      if(allowSurfaceSlide&&separatedHeight(left,right,delta[1]))continue;
      if(!intersects(left,right,delta))continue;
      let time=0;
      for(let i=0;i<48;i++){
        const hit=separation(left,right,time?V.mul(delta,time):null), approach=V.dot(delta,hit.normal);
        if(approach<=eps)break;
        if(hit.gap<=eps||i===47){
          if(!best||time<best.time)best={...hit,time,parts:[left.part,right.part],...(i===47&&hit.gap>eps&&{limited:true})};
          break;
        }
        time+=hit.gap/approach;
        if(time>1||best&&time>=best.time)break;
      }
    }
    return best;
  }
  function sweepYaw(a,b,delta,turn) {
    return sweepTurn(a,b,delta,[0,1,0],turn,true);
  }
  function sweepRotation(a,b,delta,rotation) {
    const {axis,angle}=M.axisAngle(M.mul(rotation,M.tr(a.rotation)));
    if(!angle)return sweep(a,b,delta,{allowSurfaceSlide:true});
    return sweepTurn(a,b,delta,axis,angle,Math.hypot(axis[0],axis[2])<1e-8);
  }
  function sweepTurn(a,b,delta,axis,turn,upright) {
    const start=geometry(a), other=geometry(b), end=V.add(a.position,delta);
    const pairs=[], axes=upright?[0,2]:[0,1,2];
    let reach=0;
    for(const left of start.parts){
      const radius=left.radius+Math.max(...left.points.map(point=>upright?
        Math.hypot(point[0]-a.position[0],point[2]-a.position[2]):V.dist(point,a.position)));
      for(const right of other.parts){
        if(upright&&separatedHeight(left,right,delta[1])||
          axes.some(i=>Math.min(a.position[i],end[i])-radius>right.max[i]||
            Math.max(a.position[i],end[i])+radius<right.min[i]))continue;
        pairs.push([left.part,right]);
        reach=Math.max(reach,radius);
      }
    }
    if(!pairs.length)return null;
    // Each separating gap bounds the safe travel. Translation plus the outermost
    // point's angular travel bounds the displacement between samples.
    const travel=V.len(delta)+reach*Math.abs(turn);
    let time=0;
    for(let i=0;i<64;i++){
      const posed=time===0?start:geometry({...a,position:V.mad(a.position,delta,time),
        rotation:M.mul(M.rot(axis,turn*time),a.rotation)});
      let best;
      for(const [index,right] of pairs){
        const hit=separation(posed.parts[index],right);
        if(!best||hit.gap<best.gap)best={...hit,parts:[index,right.part]};
      }
      if(best.gap<=eps||i===63)return {...best,time,...(i===63&&best.gap>eps&&{limited:true})};
      if(!travel||time+best.gap/travel>=1)return null;
      time+=best.gap/travel;
    }
  }
  function capsuleColumn(a,b,radius,origin,low) {
    const hit=rayCapsule({points:[a,b],radius},origin,down,origin[1]-low);
    return hit&&{point:V.mad(origin,down,hit.t),normal:hit.normal};
  }
  W.colliders=Object.freeze({local,geometry,distance,columns,ray,contact,sweep,sweepYaw,sweepRotation,capsuleColumn});
})(KIT);
