// Generate charts on planar projections and pack them without crossing UV islands.
const edgeKey = (a, b) => a < b ? a + '/' + b : b + '/' + a;
const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function overlaps(a, b, epsilon) {
  // With counterclockwise winding, a separating edge puts the other triangle outside.
  return [a, b].every((source, i) => {
    const target = i ? a : b;
    return source.every((p, j) => target.some(q => area2(p, source[(j + 1) % 3], q) > epsilon));
  });
}

function chartsFor(points, faces, normals, groups) {
  const size = [0, 1, 2].map(axis => {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
    return hi - lo;
  });
  const bucket = Math.max(...size) / 64 || 1, epsilon = bucket ** 2 * 1e-9;
  const projections = normals.map(normal => {
    const max = Math.max(...normal.map(Math.abs));
    // A fixed tie band gives diagonally aligned planar surfaces a consistent axis.
    const axis = normal.findIndex(component => Math.abs(component) >= max * 0.975);
    return axis * 2 + Number(normal[axis] < 0);
  });
  const coords = faces.map((face, i) => {
    const projection = projections[i], axis = projection >> 1, sign = projection % 2 ? -1 : 1;
    return face.map(index => [points[index][(axis + 1) % 3] * sign, points[index][(axis + 2) % 3]]);
  });
  const adjacent = faces.map(() => []), edges = new Map();
  for (const [i, face] of faces.entries()) for (let j = 0; j < 3; j++) {
    const key = edgeKey(face[j], face[(j + 1) % 3]), prev = edges.get(key);
    if (prev === undefined) edges.set(key, i);
    else if (projections[i] === projections[prev] && (!groups || groups[i] === groups[prev])) {
      adjacent[prev].push(i);
      adjacent[i].push(prev);
    }
  }

  const assigned = new Uint8Array(faces.length), checked = new Int32Array(faces.length).fill(-1);
  const charts = [];
  for (let first = 0; first < faces.length; first++) {
    if (assigned[first]) continue;
    const id = charts.length, queue = [first], accepted = [], grid = new Map();
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (let i = 0; i < queue.length; i++) {
      const f = queue[i];
      if (assigned[f] || checked[f] === id) continue;
      checked[f] = id;
      const uv = coords[f];
      const lo = [Math.min(...uv.map(p => p[0])), Math.min(...uv.map(p => p[1]))];
      const hi = [Math.max(...uv.map(p => p[0])), Math.max(...uv.map(p => p[1]))];
      const bins = [];
      for (let y = Math.floor(lo[1] / bucket); y <= Math.floor(hi[1] / bucket); y++)
        for (let x = Math.floor(lo[0] / bucket); x <= Math.floor(hi[0] / bucket); x++) bins.push(x + '/' + y);
      const candidates = new Set();
      for (const key of bins) for (const other of grid.get(key) || []) candidates.add(other);
      if ([...candidates].some(other => overlaps(uv, coords[other], epsilon))) continue;
      assigned[f] = 1;
      accepted.push(f);
      for (let a = 0; a < 2; a++) { min[a] = Math.min(min[a], lo[a]); max[a] = Math.max(max[a], hi[a]); }
      for (const key of bins) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(f);
      }
      queue.push(...adjacent[f]);
    }
    charts.push({ id, faces: accepted, min, span: max.map((v, axis) => v - min[axis]) });
  }
  return { charts, coords };
}

function pack(charts, density, size, pad) {
  const skyline = new Uint16Array(size), spans = new Int32Array(size), layout = [];
  const boxes = charts.map(c => ({ ...c, dims: c.span.map(w => Math.max(1, Math.ceil(w * density)) + 2 * pad) }));
  boxes.sort((a, b) => Math.max(...b.dims) - Math.max(...a.dims) || b.dims[0] * b.dims[1] - a.dims[0] * a.dims[1] || a.id - b.id);
  for (const { id, dims } of boxes) {
    let best;
    for (const rotated of dims[0] === dims[1] ? [false] : [false, true]) {
      const [w, h] = rotated ? [dims[1], dims[0]] : dims;
      if (w > size || h > size) continue;
      let from = 0, to = 0;
      for (let right = 0; right < size; right++) {
        while (to > from && skyline[spans[to - 1]] <= skyline[right]) to--;
        spans[to++] = right;
        const x = right - w + 1;
        if (spans[from] < x) from++;
        if (x < 0) continue;
        const y = skyline[spans[from]], top = y + h;
        if (top <= size && (!best || top < best.top || (top === best.top && y < best.y)))
          best = { x, y, w, top, rotated };
      }
    }
    if (!best) return null;
    skyline.fill(best.top, best.x, best.x + best.w);
    layout[id] = best;
  }
  return layout;
}

function unwrap(points, faces, normals, { size, margin, groups }) {
  const { charts, coords } = chartsFor(points, faces, normals, groups);
  const pad = Math.max(2, Math.ceil(size * margin / 2));
  const maxSpan = charts.reduce((m, c) => Math.max(m, ...c.span), 0);
  let lo = 0, hi = size / maxSpan, layout = pack(charts, 0, size, pad);
  if (!layout) throw new Error('UV atlas has too many islands at this size. Simplify the mesh or choose a larger texture.');
  for (let i = 0; i < 16; i++) {
    const density = (lo + hi) / 2, placements = pack(charts, density, size, pad);
    if (placements) { lo = density; layout = placements; }
    else hi = density;
  }
  const uvs = new Array(faces.length), islands = new Int32Array(faces.length);
  let used = 0;
  for (const chart of charts) {
    const at = layout[chart.id];
    for (const f of chart.faces) {
      islands[f] = chart.id;
      uvs[f] = coords[f].map(p => {
        const a = (p[0] - chart.min[0]) * lo, b = (p[1] - chart.min[1]) * lo;
        const [x, y] = at.rotated ? [chart.span[1] * lo - b, a] : [a, b];
        return [(at.x + pad + x) / size, (at.y + pad + y) / size];
      });
      used += area2(...uvs[f]) * 0.5;
    }
  }
  return { uvs, islands, utilization: used, charts: charts.length, padding: pad };
}

module.exports = { unwrap, area2 };
