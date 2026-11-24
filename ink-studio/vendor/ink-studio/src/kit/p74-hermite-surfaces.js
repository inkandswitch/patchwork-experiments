/* Hermite edges and cell-constrained quadratic fits for dual surfaces. */
(function (K) {
  const G = K.procedural.geometry, V = K.V,
    EPS = 1e-12,
    corners = Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]),
    edges = corners.flatMap((p, i) => p.flatMap((v, axis) => v ? [] : [{ from: i, to: i | (1 << axis), axis }])),
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

  function solve(a,b,states,lo,hi) {
    const coords = [0,0,0], free = [];
    for (let i = 0; i < 3; i++) {
      if (!states[i]) free.push(i);
      else coords[i] = states[i] < 0 ? lo[i] : hi[i];
    }
    const n = free.length, rows = free.map(i => {
      const target = states.reduce((value, state, j) => state ? value - a[i][j] * coords[j] : value,b[i]);
      return [...free.map(j=>a[i][j]),target];
    });
    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let j = i + 1; j < n; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
      if (Math.abs(rows[pivot][i]) < EPS) return null;
      [rows[i],rows[pivot]] = [rows[pivot],rows[i]];
      for (let j = i+1; j < n; j++) {
        const q = rows[j][i] / rows[i][i];
        for (let k = i; k <= n; k++) rows[j][k] -= q * rows[i][k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      const q = free[i];
      let sum = rows[i][n];
      for (let j = i+1; j < n; j++) sum -= rows[i][j] * coords[free[j]];
      coords[q] = sum / rows[i][i];
      if (coords[q] < lo[q] || coords[q] > hi[q]) return null;
    }
    return coords;
  }

  function fit(hits, bounds, method) {
    const center = [0,0,0], average = [0,0,0];
    for (const { p, n } of hits) for (let i = 0; i < 3; i++) {
      center[i] += p[i] / hits.length;
      average[i] += n[i];
    }
    const normal = V.len(average) > EPS ? V.norm(average) : hits[0].n.slice(),
      lo = bounds.min.map((v,i)=>v-center[i]), hi = bounds.max.map((v,i)=>v-center[i]),
      residual = d => hits.reduce((sum,hit)=>sum + V.dot(hit.n,V.sub(V.add(center,d),hit.p)) ** 2,0);
    if (method === 'surfaceNets') return { point:center, normal, error:Math.sqrt(residual([0,0,0])/hits.length) };
    const damping = 1e-6 * hits.length, matrix = [[damping,0,0],[0,damping,0],[0,0,damping]], rhs = [0,0,0];
    for (const { p,n } of hits) {
      const d = V.dot(n,V.sub(p,center));
      for (let a = 0; a < 3; a++) {
        rhs[a] += n[a] * d;
        for (let b = 0; b < 3; b++) matrix[a][b] += n[a] * n[b];
      }
    }
    let best = solve(matrix,rhs,[0,0,0],lo,hi);
    if (!best) {
      let score = Infinity;
      for (const x of [-1,0,1]) for (const y of [-1,0,1]) for (const z of [-1,0,1]) {
        if (!x && !y && !z) continue;
        const guess = solve(matrix,rhs,[x,y,z],lo,hi);
        if (!guess) continue;
        const value = residual(guess) + damping * V.dot(guess,guess);
        if (value < score) { best = guess; score = value; }
      }
    }
    best ??= [0,0,0];
    return { point:V.add(center,best), normal, error:Math.sqrt(residual(best)/hits.length) };
  }

  function crossing(evalAt,a,b,da,db,{
    bounds, epsilon, normal, refine = 2, axis
  }) {
    const wanted = da < 0, direction = V.sub(b,a);
    let lo = 0, hi = 1, t = da / (da - db), from = da, to = db, p = V.mad(a,direction,t);
    for (let i = 0; i < refine && t > lo && t < hi; i++) {
      const value = evalAt(...p);
      if (Math.abs(value) <= EPS) break;
      if ((value < 0) === wanted) { lo = t; from = value; }
      else { hi = t; to = value; }
      t = lo + (hi-lo) * from/(from-to);
      p = V.mad(a,direction,t);
    }
    let n;
    if (normal) {
      n = normal(...p);
      if (!vector(n)) throw new Error('Surface normal callback must return a finite vector');
    } else n = p.map((value,i)=>{
      const q = p.slice(), r = p.slice();
      q[i] = Math.max(bounds.min[i],value-epsilon);
      r[i] = Math.min(bounds.max[i],value+epsilon);
      return (evalAt(...r)-evalAt(...q))/(r[i]-q[i]);
    });
    return { p, n: V.len(n)>EPS ? V.norm(n) : [0,1,2].map(i=>i===axis ? (wanted ? 1 : -1) : 0) };
  }

  function trianglesFor(face,points,normals) {
    if (face.length === 3) return [face.slice()];
    const [a,b,c,d] = face,
      ac = [[a,b,c],[a,c,d]], bd = [[a,b,d],[b,c,d]];
    if (normals) {
      const winding = ([i,j,k]) => V.dot(
        V.cross(V.sub(points[j],points[i]),V.sub(points[k],points[i])),
        V.add(normals[i],V.add(normals[j],normals[k]))
      ), aMin = Math.min(...ac.map(winding)), bMin = Math.min(...bd.map(winding));
      if (Math.min(aMin,bMin)<-EPS && Math.abs(aMin-bMin)>EPS) return aMin>bMin ? ac : bd;
    }
    return V.dist(points[a],points[c]) <= V.dist(points[b],points[d]) ? ac : bd;
  }
  function meshFor(points,normals,triangles,metadata) {
    const builder = G.builder();
    for (const face of triangles) builder.triangle(...face.map(i=>points[i]),metadata,undefined,face.map(i=>normals[i]));
    return builder.finish();
  }

  // Shared by regular extraction and adaptive transition cells.
  G.hermite = Object.freeze({ corners, edges, crossing, fit, trianglesFor, meshFor });
})(KIT);
