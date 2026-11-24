/* Closed convex construction pieces shared by route decks, supports and details.
   Picking uses clipped half spaces; surface samples and SDFs share the same shell. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    M = K.M,
    EPS = 1e-7,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite),
    faces = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ];
  const convexParts=new WeakSet();
  function convex(vertices, polygons, meta = {}) {
    if (
      !Array.isArray(vertices) ||
      vertices.length < 4 ||
      vertices.length > 256 ||
      !vertices.every(vector) ||
      !Array.isArray(polygons) ||
      polygons.length < 4
    )
      throw new Error('Construction pieces need finite convex vertices and faces');
    vertices = vertices.map(point => point.slice());
    const center = V.mul(
        vertices.reduce((p, q) => V.add(p, q), [0, 0, 0]),
        1 / vertices.length
      ),
      planes = [],
      shell = [],
      info = Object.assign({ owner: '', key: 'body', material: 'default' }, meta);
    for (const indices of polygons) {
      if (
        !Array.isArray(indices) ||
        indices.length < 3 ||
        indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)
      )
        throw new Error('Invalid construction face');
      let points = indices.map(i => vertices[i]),
        cross = V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0]));
      if (V.len(cross) < EPS) throw new Error('Degenerate construction face');
      let n = V.norm(cross);
      if (V.dot(n, V.sub(points[0], center)) < 0) {
        points = points.slice().reverse();
        n = V.mul(n, -1);
      }
      const offset = V.dot(n, points[0]);
      if (
        vertices.some(p => V.dot(n, p) > offset + EPS * 10) ||
        points.some(p => Math.abs(V.dot(n, p) - offset) > EPS * 10)
      )
        throw new Error('Construction faces must enclose a convex volume');
      if (!planes.some(p => V.dist(p.normal, n) < EPS && Math.abs(p.offset - offset) < EPS))
        planes.push({ normal: n, offset });
      shell.push({points, normal:n});
    }
    if (planes.length < 4 || planes.some(p => V.dot(p.normal, center) >= p.offset - EPS))
      throw new Error('Construction pieces need nonzero enclosed volume');
    const bounds = A.spatial.boxOf(shell.flatMap(face => face.points));
    let mesh;
    function meshOf() {
      if (mesh) return mesh;
      const builder = A.geometry.builder(),
        meta = { owner: info.owner, surface: info.key, material: info.material };
      for (const {points, normal} of shell) {
        const origin = points[0], x = V.norm(V.sub(points[1], origin)), y = V.cross(normal, x),
          uv = points.map(point => {
            const q = V.sub(point, origin);
            return [V.dot(q, x), V.dot(q, y)];
          });
        for (let j = 1; j < points.length - 1; j++)
          builder.triangle(origin, points[j], points[j + 1], meta, [uv[0], uv[j], uv[j + 1]]);
      }
      return mesh = builder.finish();
    }
    const distance = p => {
      let d = -Infinity;
      const x = p[0],
        y = p[1],
        z = p[2];
      for (const q of planes) d = Math.max(d, q.normal[0] * x + q.normal[1] * y + q.normal[2] * z - q.offset);
      return d;
    };
    const contains = ([x, y, z], tolerance = 0.002) => {
      for (const {normal, offset} of planes)
        if (!(normal[0] * x + normal[1] * y + normal[2] * z - offset < -tolerance)) return false;
      return true;
    };
    function intersections(origin, dir, max = 10000) {
      let low = 0,
        high = max,
        entry = null,
        exit = null;
      for (const p of planes) {
        const den = V.dot(p.normal, dir),
          d = p.offset - V.dot(p.normal, origin);
        if (Math.abs(den) < EPS) {
          if (d < 0) return [];
          continue;
        }
        const t = d / den;
        if (den < 0) {
          if (t > low) {
            low = t;
            entry = p.normal;
          }
        } else if (t < high) {
          high = t;
          exit = p.normal;
        }
        if (low > high) return [];
      }
      return [
        [low, entry],
        [high, exit]
      ]
        .filter(([t, n]) => n && t >= 0 && t <= max)
        .map(([distance, n]) => ({
          distance,
          n,
          p: V.mad(origin, dir, distance),
          part: info.key,
          material: info.material
        }));
    }
    function sample(spacing, emit) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof emit !== 'function')
        throw new Error('Construction sampling needs positive spacing and a callback');
      const mesh = meshOf();
      for (let i = 0; i < mesh.positions.length; i += 9) {
        const points = [0, 1, 2].map(j => Array.from(mesh.positions.slice(i + j * 3, i + j * 3 + 3))),
          order = [
            [0, 1, 2],
            [1, 2, 0],
            [2, 0, 1]
          ].sort((a, b) => V.dist(points[b[0]], points[b[1]]) - V.dist(points[a[0]], points[a[1]]))[0],
          p = order.map(j => points[j]),
          edge = V.sub(p[1], p[0]),
          rise = V.sub(p[2], p[0]),
          length = V.len(edge),
          axis = V.norm(edge),
          height = V.len(V.sub(rise, V.mul(axis, V.dot(rise, axis)))),
          rows = Math.max(1, Math.ceil(height / spacing));
        for (let row = 0; row <= rows; row++) {
          const t = row / rows,
            columns = Math.max(1, Math.ceil(((1 - t) * length) / spacing));
          for (let col = 0; col <= (row === rows ? 0 : columns); col++)
            emit(V.add(p[0], V.add(V.mul(edge, ((1 - t) * col) / columns), V.mul(rise, t))));
        }
      }
    }
    const part = Object.assign({}, info, { bounds, planes, distance, contains, intersections, sample });
    Object.defineProperty(part, 'mesh', { enumerable: true, get: meshOf });
    convexParts.add(part);
    return Object.freeze(part);
  }
  function box(center, half, frame, meta) {
    if (
      !vector(center) ||
      !vector(half) ||
      half.some(v => v <= 0) ||
      !Array.isArray(frame) ||
      frame.length !== 9 ||
      !frame.every(Number.isFinite) ||
      Math.abs(M.det(frame)) < EPS
    )
      throw new Error('Boxes need positive dimensions and a nonsingular frame');
    const vertices = [];
    for (const z of [-1, 1])
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ])
        vertices.push(V.add(center, M.app(frame, [x * half[0], y * half[1], z * half[2]])));
    return convex(vertices, faces, meta);
  }
  function beam(a, b, width, depth, meta) {
    if (
      !vector(a) ||
      !vector(b) ||
      V.dist(a, b) < EPS ||
      !Number.isFinite(width) ||
      !Number.isFinite(depth) ||
      width <= 0 ||
      depth <= 0
    )
      throw new Error('Beams need distinct finite ends and positive dimensions');
    const X = V.norm(V.sub(b, a)),
      Y = V.norm(V.cross(Math.abs(X[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], X)),
      Z = V.cross(X, Y);
    return box(V.mul(V.add(a, b), 0.5), [V.dist(a, b) / 2, width / 2, depth / 2], M.cols(X, Y, Z), meta);
  }
  function uprightSpan(a, b, {width, height, up = [0, 1, 0], extension = 0} = {}, meta) {
    if(!vector(a)||!vector(b)||!vector(up)||V.len(up)<EPS||
       ![width,height].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(extension)||extension<0)
      throw Error('An upright span needs finite endpoints, positive dimensions and nonnegative extension');
    const vertical=V.norm(up),along=V.sub(b,a),
      plan=V.mad(along,vertical,-V.dot(along,vertical)),run=V.len(plan);
    if(run<EPS)throw Error('An upright span needs a nonzero run across its up axis');
    const transverse=V.norm(V.cross(vertical,plan)),frame=M.cols(transverse,vertical,V.mul(along,1/run));
    const center=V.mad(V.mul(V.add(a,b),.5),vertical,height/2);
    return box(center,[width/2,height/2,run/2+extension],frame,meta);
  }
  function union(pieces) {
    if (!Array.isArray(pieces) || !pieces.length) throw new Error('A construction union needs pieces');
    const bounds = A.spatial.boxOf(pieces.flatMap(p => [p.bounds.min, p.bounds.max]));
    const order = new Map(pieces.map((part,i) => [part.key,i]));
    if (order.size !== pieces.length)
      throw new Error('Construction unions need unique piece keys');
    const cell = Math.max(0.25, Math.min(2, V.dist(bounds.min, bounds.max) / 12)),
      grid = new Map(),
      large = [];
    let assignments = 0;
    const key = (x, y, z) => x + '/' + y + '/' + z;
    for (const part of pieces) {
      const lo = part.bounds.min.map(v => Math.floor((v - EPS) / cell)),
        hi = part.bounds.max.map(v => Math.floor((v + EPS) / cell)),
        count = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (count > 4096 || assignments + count > 100000) {
        large.push(part);
        continue;
      }
      assignments += count;
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = key(x, y, z);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(part);
          }
    }
    function hidden(exclude, point, tolerance = 0.002) {
      const [x, y, z] = point;
      const candidates = grid.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)));
      if (candidates) for (const p of candidates)
        if (p.key !== exclude && A.spatial.contains(p.bounds, point) &&
            (p.contains ? p.contains(point, tolerance) : p.distance(point) < -tolerance)) return true;
      for (const p of large)
        if (p.key !== exclude && A.spatial.contains(p.bounds, point) &&
            (p.contains ? p.contains(point, tolerance) : p.distance(point) < -tolerance)) return true;
      return false;
    }
    function nearby(min, max) {
      const lo=min.map(v=>Math.floor((v-EPS)/cell)),hi=max.map(v=>Math.floor((v+EPS)/cell)),
        cells=(hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1);
      if(cells>=pieces.length)return pieces;
      const candidates=new Set(large);
      for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
        const bucket=grid.get(key(x,y,z));
        if(bucket)for(const part of bucket)candidates.add(part);
      }
      return candidates;
    }
    function clearanceWithin(point,reach){
      if(!vector(point)||!Number.isFinite(reach)||reach<0)
        throw new Error('Clearance needs a finite point and nonnegative reach');
      const min=point.map(v=>v-reach),max=point.map(v=>v+reach);
      let result=Infinity;
      for(const part of nearby(min,max)){
        const b=part.bounds;
        const gap=Math.hypot(
          Math.max(0,b.min[0]-point[0],point[0]-b.max[0]),
          Math.max(0,b.min[1]-point[1],point[1]-b.max[1]),
          Math.max(0,b.min[2]-point[2],point[2]-b.max[2]));
        if(gap>reach)continue;
        const d=part.distance(point);
        result=Math.min(result,gap?Math.max(d,gap):d);
      }
      return result;
    }
    function faceOcclusion(exclude,points,tolerance=.002){
      if(!Array.isArray(points)||points.length<3||!points.every(vector)||!Number.isFinite(tolerance)||tolerance<0)
        throw new Error('Face occlusion needs finite corners and nonnegative depth');
      const region=A.spatial.boxOf(points),candidates=[];
      for(const part of nearby(region.min,region.max)){
        if(part.key===exclude||!A.spatial.overlap(part.bounds,region))continue;
        // Every point on the face stays outside this plane if all its
        // corners do. Account for the tolerance used by the point query.
        if(convexParts.has(part)&&part.planes.some(({normal,offset})=>
          points.every(point=>V.dot(normal,point)>=offset-tolerance+EPS)))continue;
        candidates.push(part);
      }
      if(!candidates.length)return null;
      return point=>{
        for(const part of candidates)if(A.spatial.contains(part.bounds,point)&&
          (part.contains?part.contains(point,tolerance):part.distance(point)<-tolerance))return true;
        return false;
      };
    }
    function raycast(origin,direction,max=10000){
      if(!vector(origin)||!vector(direction)||V.len(direction)<EPS||!Number.isFinite(max)||max<=0)
        throw new Error('Construction rays need finite vectors and positive reach');
      const dir=V.norm(direction),end=V.mad(origin,dir,max),hits=[];
      const region=A.spatial.boxOf([origin,end]);
      for(const part of nearby(region.min,region.max)){
        if(A.spatial.rayBox(part.bounds,origin,dir,max)!==null)hits.push(...part.intersections(origin,dir,max));
      }
      hits.sort((a,b)=>a.distance-b.distance||order.get(a.part)-order.get(b.part));
      return hits.find(hit=>!hidden(hit.part,hit.p,EPS*10))||null;
    }
    // Project a bounded strip of convex material onto the segment's 0..1
    // domain. Clipping in two coordinates detects gaps between sample points.
    function projectedIntervals(a,b,direction,{outward,inward}={}){
      if(!vector(a)||!vector(b)||!vector(direction)||V.len(direction)<EPS||
         ![outward,inward].every(value=>Number.isFinite(value)&&value>=0))
        throw new Error('Projected intervals need finite endpoints, a direction and nonnegative reaches');
      const n=V.norm(direction),along=V.sub(b,a),low=V.mul(n,-inward),high=V.mul(n,outward),
        corners=[V.add(a,low),V.add(a,high),V.add(b,low),V.add(b,high)],
        region=A.spatial.boxOf(corners),intervals=[];
      for(const part of nearby(region.min,region.max)){
        if(!A.spatial.overlap(part.bounds,region))continue;
        let polygon=[[0,-inward],[1,-inward],[1,outward],[0,outward]];
        for(const {normal,offset} of part.planes){
          const u=V.dot(normal,along),v=V.dot(normal,n),c=V.dot(normal,a)-offset;
          const next=[];
          for(let i=0;i<polygon.length;i++){
            const from=polygon[i],to=polygon[(i+1)%polygon.length],
              x=from[0]*u+from[1]*v+c,y=to[0]*u+to[1]*v+c;
            if(x<=EPS)next.push(from);
            if((x<=EPS)!==(y<=EPS)){
              const f=(x-EPS)/(x-y);
              next.push([from[0]+(to[0]-from[0])*f,from[1]+(to[1]-from[1])*f]);
            }
          }
          polygon=next;
          if(!polygon.length)break;
        }
        if(!polygon.length)continue;
        const domain=polygon.map(p=>p[0]);
        intervals.push([Math.min(...domain),Math.max(...domain)]);
      }
      intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const merged=[];
      for(const [start,end] of intervals){
        const last=merged.at(-1);
        if(last&&start<=last[1]+EPS)last[1]=Math.max(last[1],end);
        else merged.push([start,end]);
      }
      return merged;
    }
    return {
      bounds,
      hidden,
      faceOcclusion,
      clearanceWithin,
      contains(point, tolerance = 0.002) {
        if (!vector(point) || !Number.isFinite(tolerance) || tolerance < 0)
          throw new Error('Containment needs a finite point and nonnegative depth');
        return hidden(null, point, tolerance);
      },
      distance(point) {
        let d = Infinity;
        for (const part of pieces) {
          if (d < 0 && !A.spatial.contains(part.bounds, point)) continue;
          d = Math.min(d, part.distance(point));
        }
        return d;
      },
      raycast,
      projectedIntervals,
      mesh() {
        const out = A.geometry.builder();
        for (const p of pieces) out.append(p.mesh);
        return out.finish();
      }
    };
  }
  function tube(a, b, radius, meta = {}, sides = 8) {
    if (
      !vector(a) ||
      !vector(b) ||
      V.dist(a, b) < EPS ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isInteger(sides) ||
      sides < 3 ||
      sides > 32
    )
      throw new Error('Tubes need distinct finite ends, a positive radius and 3..32 sides');
    const axis = V.norm(V.sub(b, a)),
      x = V.norm(V.cross(Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], axis)),
      y = V.cross(axis, x),
      vertices = [],
      polygons = [];
    for (const p of [a, b])
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides;
        vertices.push(V.add(p, V.add(V.mul(x, radius * Math.cos(angle)), V.mul(y, radius * Math.sin(angle)))));
      }
    polygons.push(
      Array.from({ length: sides }, (_, i) => i),
      Array.from({ length: sides }, (_, i) => i + sides)
    );
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      polygons.push([i, j, j + sides, i + sides]);
    }
    return convex(vertices, polygons, meta);
  }
  A.pieces = { convex, box, beam, uprightSpan, tube, union, boxFaces: faces };
})(KIT);
