/* Surface Nets and dual contouring on an explicit signed lattice. */
(function (K) {
  const P = K.procedural, G = P.geometry, H = G.hermite,
    integer = (n,a,b) => Number.isSafeInteger(n) && n >= a && n <= b;

  function dualGrid(field, rawBounds, {
    method = 'dualContour', cell = 0.12, iso = 0, normal, refine = 2,
    maxCells = 250000, maxSamples = 3800000, latticeBounds, topology = true, captureField = false
  } = {}) {
    if (latticeBounds !== undefined && ![latticeBounds?.min, latticeBounds?.max].every(p =>
      Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isSafeInteger)))
      throw new Error('An aligned lattice needs integer XYZ bounds');
    const bounds = latticeBounds ? P.spatial.bounds({
      min: latticeBounds.min.map(v => v * cell), max: latticeBounds.max.map(v => v * cell)
    }) : P.spatial.bounds(rawBounds),
      size = bounds.max.map((v,i)=>v-bounds.min[i]);
    if (typeof field !== 'function' || !['dualContour','surfaceNets'].includes(method) ||
      !size.every(v=>Number.isFinite(v)&&v>1e-7&&v<2e6) ||
      !Number.isFinite(cell) || cell<1e-6 || !Number.isFinite(iso) ||
      (normal!==undefined&&typeof normal!=='function') || !integer(refine,0,8) ||
      !integer(maxCells,1,1000000) || !integer(maxSamples,1,14000000) ||
      typeof topology !== 'boolean' || typeof captureField !== 'boolean')
      throw new Error('Dual extraction needs a bounded signed field and resolution');
    const counts = latticeBounds ? latticeBounds.max.map((v, i) => v - latticeBounds.min[i]) :
        size.map(v=>Math.max(1,Math.ceil(v/cell))), lattice = counts.map(v=>v+1),
      gridSize = lattice.reduce((a,b)=>a*b,1), voxels = counts.reduce((a,b)=>a*b,1),
      spacing = latticeBounds ? [cell, cell, cell] : size.map((v,i)=>v/counts[i]), quantum = Math.min(...spacing);
    if (!Number.isSafeInteger(voxels) || voxels > maxCells || gridSize > maxSamples)
      throw new Error('Dual extraction exceeds its lattice budget');
    const grid = new Float64Array(gridSize), vox = topology ? new Int32Array(voxels).fill(-1) : null,
      world = coord => coord.map((v,i)=>latticeBounds ? (latticeBounds.min[i] + v) * cell :
        v===lattice[i]-1 ? bounds.max[i] : bounds.min[i]+v*spacing[i]),
      index = ([x,y,z])=>x+lattice[0]*(y+lattice[1]*z),
      atCell = ([x,y,z])=>x+counts[0]*(y+counts[1]*z),
      points = [], normals = [], errors = [], active = [], hitCache = new Map(),
      work = { cells:voxels, samples:0, active:0 };
    function evalAt(x,y,z) {
      if (work.samples >= maxSamples) throw new Error('Dual extraction exceeds its signed field sample budget');
      work.samples++;
      const d = field(x,y,z)-iso;
      if (!Number.isFinite(d)) throw new Error('Dual extraction field must be finite');
      return d;
    }
    for(let z=0,i=0;z<lattice[2];z++) for(let y=0;y<lattice[1];y++) for(let x=0;x<lattice[0];x++,i++) {
      const d = evalAt(...world([x,y,z]));
      grid[i] = Math.abs(d) <= 1e-12 * quantum ? 0 : d;
    }
    for(let z=0,slot=0;z<counts[2];z++) for(let y=0;y<counts[1];y++) for(let x=0;x<counts[0];x++,slot++) {
      const coords = H.corners.map(([a,b,c])=>[x+a,y+b,z+c]), samples = coords.map(p=>grid[index(p)]);
      if (samples.every(v=>v<0) || samples.every(v=>v>=0)) continue;
      const hits = [];
      for (const { from,to,axis } of H.edges) {
        const da = samples[from], db = samples[to];
        if ((da<0)===(db<0)) continue;
        const a=coords[from], b=coords[to], key=axis*gridSize+index(a);
        if (!hitCache.has(key)) hitCache.set(key, { a,axis,inside:da<0,
          hit:H.crossing(evalAt,world(a),world(b),da,db,{bounds,epsilon:quantum*0.027,normal,refine,axis}) });
        hits.push(hitCache.get(key).hit);
      }
      const box = { min:world(coords[0]),max:world(coords[7]) }, fit = H.fit(hits,box,method);
      if (vox) vox[slot] = points.length;
      points.push(fit.point);
      normals.push(fit.normal);
      errors.push(fit.error);
      active.push({ key:[x,y,z].join('/'), bounds:box });
    }
    const quads=[], triangles=[];
    if (topology) for (const { a,axis,inside } of hitCache.values()) {
      const u=(axis+1)%3, v=(axis+2)%3,
        around=[[-1,-1],[0,-1],[0,0],[-1,0]].map(([i,j])=>{
          const q=a.slice();
          q[u]+=i;
          q[v]+=j;
          return q;
        });
      if (around.some(p=>p.some((n,i)=>n<0||n>=counts[i]))) continue;
      const face=around.map(p=>vox[atCell(p)]);
      if (face.some(i=>i<0)) continue;
      if (!inside) face.reverse();
      quads.push(face);
      triangles.push(...H.trianglesFor(face,points));
    }
    work.active=points.length;
    return P.data.freeze({ method, bounds, counts, spacing, points, normals, errors, active, quads, triangles, work,
      ...(captureField ? { fieldSamples: () => grid.slice() } : {}),
      mesh: metadata=>H.meshFor(points,normals,triangles,metadata) });
  }
  G.dualGrid = dualGrid;
  G.surfaceNets = (field,bounds,options)=>dualGrid(field,bounds,{...options,method:'surfaceNets'});
  G.dualContour = (field,bounds,options)=>dualGrid(field,bounds,{...options,method:'dualContour'});
})(KIT);
