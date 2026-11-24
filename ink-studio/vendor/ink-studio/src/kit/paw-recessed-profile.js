/* A closed extrusion with a blind recess, sharing its sampled ring edges. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-9, TAU = Math.PI * 2;
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

  function segmentsTouch(a,b,c,d) {
    const side=(x,y,p)=>cross([y[0]-x[0],y[1]-x[1]],[p[0]-x[0],p[1]-x[1]])/
      Math.hypot(y[0]-x[0],y[1]-x[1]);
    const u=side(a,b,c),v=side(a,b,d),s=side(c,d,a),t=side(c,d,b);
    const on=(p,x,y,n)=>Math.abs(n)<=EPS&&p.every((value,i)=>
      value>=Math.min(x[i],y[i])-EPS&&value<=Math.max(x[i],y[i])+EPS);
    return ((u>EPS&&v< -EPS||v>EPS&&u< -EPS)&&(s>EPS&&t< -EPS||t>EPS&&s< -EPS))||
      on(c,a,b,u)||on(d,a,b,v)||on(a,c,d,s)||on(b,c,d,t);
  }

  function simple(raw) {
    if (!Array.isArray(raw)||raw.length<3||raw.length>1024||!Array.from(raw).every(point))
      throw Error('A triangulated recessed profile needs 3 to 1024 finite points per ring');
    const vertices=raw.map(p=>p.slice()), edges=vertices.map((p,i)=>[p,vertices[(i+1)%vertices.length]]);
    if(edges.some(([a,b])=>Math.hypot(a[0]-b[0],a[1]-b[1])<=EPS))
      throw Error('Recessed profile edges must be distinct');
    for(let i=0;i<edges.length;i++)for(let j=i+2;j<edges.length;j++){
      if(i===0&&j===edges.length-1)continue;
      if(segmentsTouch(...edges[i],...edges[j]))throw Error('Recessed profile cannot cross or touch itself');
    }
    const area=edges.reduce((n,[a,b])=>n+cross(a,b),0);
    if(!Number.isFinite(area)||Math.abs(area)<=EPS)throw Error('Recessed profile has no area');
    return area<0?vertices.reverse():vertices;
  }

  function profileEdges(vertices) {
    return vertices.map((a,i)=>{
      const b=vertices[(i+1)%vertices.length],dx=b[0]-a[0],dy=b[1]-a[1];
      return {a,b,delta:[dx,dy],length:Math.hypot(dx,dy),cuts:[0,1]};
    });
  }

  function splitMeetingEdges(a,b) {
    const delta=[b.a[0]-a.a[0],b.a[1]-a.a[1]],
      direction=cross(a.delta,b.delta),ar=EPS/a.length,br=EPS/b.length;
    const unit=t=>Math.max(0,Math.min(1,t));
    if(Math.abs(direction)>EPS*Math.max(a.length,b.length)){
      const t=cross(delta,b.delta)/direction,u=cross(delta,a.delta)/direction;
      if(t>=-ar&&t<=1+ar&&u>=-br&&u<=1+br){a.cuts.push(unit(t));b.cuts.push(unit(u));}
      return;
    }
    if(Math.abs(cross(delta,a.delta))>EPS*a.length)return;
    function project(endpoints,edge){
      const [dx,dy]=edge.delta;
      for(const [x,y] of endpoints){
        const t=((x-edge.a[0])*dx+(y-edge.a[1])*dy)/(edge.length**2);
        if(t>0&&t<1)edge.cuts.push(t);
      }
    }
    project([b.a,b.b],a);
    project([a.a,a.b],b);
  }

  function fitExteriorOutline({outline,required=null}) {
    const authored=simple(outline);
    if(required===null)return P.data.freeze(authored);
    const band=simple(required);
    if(authored.length>128||band.length>128)throw RangeError('Fitted outlines need at most 128 points per input');
    const a=profileEdges(authored),b=profileEdges(band),points=[],links=new Map();
    for(const left of a)for(const right of b)splitMeetingEdges(left,right);

    function station(p){
      const index=points.findIndex(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<=EPS);
      if(index>=0)return index;
      if(points.length>=1024)throw RangeError('Fitted outline exceeds its point budget');
      return points.push(p)-1;
    }
    function exposed(edges,other){
      const distance=P.geometry.profileDistance(other);
      for(const edge of edges){
        const at=t=>t===0?edge.a:t===1?edge.b:[
          edge.a[0]+t*edge.delta[0],edge.a[1]+t*edge.delta[1]];
        const cuts=edge.cuts.sort((p,q)=>p-q);
        for(let i=1;i<cuts.length;i++){
          const start=cuts[i-1],end=cuts[i];
          if((end-start)*edge.length<=EPS||distance(...at((start+end)/2))< -EPS)continue;
          const u=station(at(start)),v=station(at(end));
          if(u===v)continue;
          const key=Math.min(u,v)+'/'+Math.max(u,v),prior=links.get(key);
          // Coincident opposing faces are internal. Keep one copy of a
          // coincident face whose interiors are on the same side.
          if(prior?.[0]===v)links.delete(key);
          else links.set(key,[u,v]);
        }
      }
    }
    exposed(a,band);
    exposed(b,authored);

    const next=new Map(),incoming=new Set(),exteriors=[];
    for(const [u,v] of links.values()){
      if(next.has(u)||incoming.has(v))throw Error('Fitted exterior outlines cannot pinch or touch at a point');
      next.set(u,v);incoming.add(v);
    }
    while(next.size){
      const start=next.keys().next().value,ring=[];
      let vertex=start;
      do{
        if(!next.has(vertex))throw Error('Fitted exterior outline could not be closed');
        ring.push(points[vertex]);
        const following=next.get(vertex);
        next.delete(vertex);
        vertex=following;
      }while(vertex!==start);
      const area=ring.reduce((n,p,i)=>n+cross(p,ring[(i+1)%ring.length]),0);
      if(area>EPS)exteriors.push(ring);
    }
    if(exteriors.length!==1){
      const error=Error('The required region and outline must form one connected exterior');
      error.code='DISCONNECTED_PROFILE';
      throw error;
    }
    return P.data.freeze(simple(exteriors[0]));
  }

  function cappedRings(outer,inner,back,front,floor) {
    let frontCap,backCap,insideCap;
    const triangulate=P.geometry.triangulatePolygon;
    function cap(triangle,mesh,z,surface,reverse=false) {
      for(const indices of mesh.triangles){
        const [a,b,c]=indices.map(i=>[...mesh.points[i],z]);
        triangle(a,reverse?c:b,reverse?b:c,surface);
      }
    }
    return function faces(triangle,quad) {
      frontCap||=triangulate([outer,inner]);
      backCap||=triangulate([outer]);
      insideCap||=triangulate([inner]);
      cap(triangle,frontCap,front,'front');
      cap(triangle,backCap,back,'back',true);
      cap(triangle,insideCap,floor,'recess-back');
      for(const [i,a] of outer.entries()){
        const b=outer[(i+1)%outer.length];
        quad([...a,front],[...a,back],[...b,back],[...b,front],'outer-wall');
      }
      for(const [i,a] of inner.entries()){
        const b=inner[(i+1)%inner.length];
        quad([...a,front],[...b,front],[...b,floor],[...a,floor],'reveal');
      }
    };
  }

  function gridSamples(outer, inner, back, front, floor, spacing, emit) {
    let count = 0;
    function reserve(size) {
      count += size;
      if (count > 1000000) throw new RangeError('Profile sampling exceeds its work budget');
    }
    function cap(rings, z) {
      const ys = rings[0].map(p => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
      const rows = Math.max(1, Math.ceil((hi - lo) / spacing));
      if (rows > 1000000) throw new RangeError('Profile sampling exceeds its work budget');
      for (let row = 0; row < rows; row++) {
        const y = lo + (hi - lo) * (row + .5) / rows, crossings = [];
        for (const ring of rings) for (const [i, a] of ring.entries()) {
          const b = ring[(i + 1) % ring.length];
          if ((a[1] > y) !== (b[1] > y))
            crossings.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let i = 0; i < crossings.length; i += 2) {
          const x = crossings[i], span = crossings[i + 1] - x;
          if (span <= 0) continue;
          const columns = Math.max(1, Math.ceil(span / spacing));
          reserve(columns);
          for (let j = 0; j < columns; j++) emit([x + span * (j + .5) / columns, y, z]);
        }
      }
    }
    function wall(ring, low) {
      const depth = front - low, rows = Math.max(1, Math.ceil(depth / spacing));
      for (const [i, a] of ring.entries()) {
        const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1];
        const columns = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
        reserve(columns * (rows + 1));
        for (let j = 0; j < columns; j++) for (let row = 0; row <= rows; row++)
          emit([a[0] + dx * j / columns, a[1] + dy * j / columns, low + depth * row / rows]);
      }
    }
    cap([outer, inner], front);
    cap([outer], back);
    cap([inner], floor);
    wall(outer, back);
    wall(inner, floor);
  }

  function ring(raw, center) {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 256 || !Array.from(raw).every(point))
      throw new Error('Recessed profiles need 3 to 256 finite points per ring');
    const vertices = raw.map(([x, y]) => [x - center[0], y - center[1]]);
    const turn = vertices.map((p, i) => cross(p, vertices[(i + 1) % vertices.length]));
    if (turn.some(t => !Number.isFinite(t) || Math.abs(t) <= EPS || Math.sign(t) !== Math.sign(turn[0])))
      throw new Error('Profile center must see every edge from inside');
    if (turn[0] < 0) vertices.reverse();
    let sweep = 0;
    for (const [i, a] of vertices.entries()) {
      const b = vertices[(i + 1) % vertices.length];
      sweep += Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]);
    }
    if (Math.abs(sweep - TAU) > 1e-6) throw new Error('Recessed profile edges must make one turn around the center');
    return vertices;
  }

  function onRay(ring, direction) {
    for (const [i, a] of ring.entries()) {
      const b = ring[(i + 1) % ring.length], edge = [b[0] - a[0], b[1] - a[1]];
      const denominator = cross(direction, edge);
      if (denominator <= 0) continue;
      const t = cross(a, direction) / denominator;
      if (t < -EPS || t > 1 + EPS) continue;
      if (t <= EPS) return a;
      if (t >= 1 - EPS) return b;
      return [a[0] + edge[0] * t, a[1] + edge[1] * t];
    }
    throw new Error('Profile ray must meet its boundary');
  }

  function recessedProfile({ outline, recess, center = [0, 0], span, inset }) {
    if (center!==null&&!point(center) || !point(span) || !Number.isFinite(inset) || inset <= EPS || span[1] - span[0] - inset <= EPS)
      throw new Error('A recessed profile needs a finite center, an ordered span and backing thickness');
    const general=center===null,pivot=general?[0,0]:center.slice(),
      outer=general?simple(outline):ring(outline,pivot),inner=general?simple(recess):ring(recess,pivot),
      back=span[0],front=span[1],floor=front-inset,
      exterior=P.geometry.profileDistance(outer),cavity=P.geometry.profileDistance(inner);
    if(general){
      if(inner.some(p=>exterior(...p)>=-EPS))throw Error('Recess must lie strictly inside the exterior profile');
      for(const [i,a] of outer.entries())for(const [j,c] of inner.entries()){
        if(segmentsTouch(a,outer[(i+1)%outer.length],c,inner[(j+1)%inner.length]))
          throw Error('Recess and exterior profile cannot touch');
      }
    }
    const directions = general?[]:[...outer, ...inner].map(p => {
      const theta = Math.atan2(p[1], p[0]);
      return theta < 0 ? theta + TAU : theta;
    }).sort((a, b) => a - b);
    const stations = directions.filter((theta, i) => i === 0 || theta - directions[i - 1] > EPS);
    if (stations[0] + TAU - stations.at(-1) <= EPS) stations.pop();
    const bands = stations.map(theta => {
      const direction = [Math.cos(theta), Math.sin(theta)], outside = onRay(outer, direction), inside = onRay(inner, direction);
      if (Math.hypot(...outside) <= Math.hypot(...inside) + EPS)
        throw new Error('Recess must lie strictly inside the exterior profile');
      return [outside, inside].map(([x, y]) => [x + pivot[0], y + pivot[1]]);
    });
    const bounds = {
      min: [Math.min(...outline.map(p => p[0])), Math.min(...outline.map(p => p[1])), back],
      max: [Math.max(...outline.map(p => p[0])), Math.max(...outline.map(p => p[1])), front]
    };
    function distance([x, y, z]) {
      const u = x - pivot[0], v = y - pivot[1];
      return Math.max(exterior(u, v), back - z, z - front, Math.min(-cavity(u, v), z - floor));
    }

    function surfaceAt([x, y, z]) {
      const side=exterior(x-pivot[0],y-pivot[1]),hole=cavity(x-pivot[0],y-pivot[1]),
        outside=Math.max(0,side),frontGap=z-front,backGap=back-z,recessGap=floor-z;
      // Compare distances to the bounded faces. At shared edges, caps
      // win ties so a side finish never extends onto a planar face.
      return [
        ['front',frontGap**2+Math.max(outside,-hole)**2],
        ['back',backGap**2+outside**2],
        ['recess-back',recessGap**2+Math.max(0,hole)**2],
        ['outer-wall',side**2+Math.max(0,frontGap,backGap)**2],
        ['reveal',hole**2+Math.max(0,frontGap,recessGap)**2]
      ].reduce((best,face)=>face[1]<best[1]?face:best)[0];
    }

    function radialFaces(triangle, quad) {
      for (const [i, [a, b]] of bands.entries()) {
        const [c, d] = bands[(i + 1) % bands.length];
        const oa = [...a, front], oc = [...c, front], ib = [...b, front], id = [...d, front];
        const ba = [...a, back], bc = [...c, back], fb = [...b, floor], fd = [...d, floor];
        quad(oa, oc, id, ib, 'front');
        quad(oa, ba, bc, oc, 'outer-wall');
        quad(ib, id, fd, fb, 'reveal');
        triangle([...pivot, back], bc, ba, 'back');
        triangle([...pivot, floor], fb, fd, 'recess-back');
      }
    }
    const faces=general?cappedRings(outer,inner,back,front,floor):radialFaces;
    function mesh(meta, surfaces) {
      const builder = P.geometry.builder();
      const overrides=surfaces&&Object.fromEntries(Object.entries(surfaces).map(([key,value])=>[key,{...meta,...value}]));
      faces((a,b,c,key)=>builder.triangle(a,b,c,overrides?.[key]??meta),
        (a,b,c,d,key)=>builder.quad(a,b,c,d,overrides?.[key]??meta));
      return builder.finish();
    }
    function sample(spacing, emit) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof emit !== 'function')
        throw new Error('Profile sampling needs positive spacing and a callback');
      if (general) return gridSamples(outer, inner, back, front, floor, spacing, emit);
      let count = 0;
      function triangle(a, b, c) {
        const n = Math.max(1, Math.ceil(Math.max(K.V.dist(a, b), K.V.dist(b, c), K.V.dist(c, a)) / spacing));
        count += (n + 1) * (n + 2) / 2;
        if (count > 1000000) throw new RangeError('Profile sampling exceeds its work budget');
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          emit(a.map((v, k) => v + (b[k] - v) * i / n + (c[k] - v) * j / n));
        }
      }
      faces(triangle, (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); });
    }
    return Object.freeze({ bounds: P.data.freeze(bounds), distance, surfaceAt, mesh, sample });
  }

  P.geometry.recessedProfile = recessedProfile;
  P.geometry.fitExteriorOutline = fitExteriorOutline;
})(KIT);
