/* Exact convex footprints in a carrier chart. Logical keys survive clipping
   into several pieces, so appearance and local edits can follow the cell. */
(function (K) {
  const P = K.procedural || K.authoring;
  const EPS = 1e-8;
  const point = p =>
    Array.isArray(p) && p.length === 2 && Array.from(p).every(v => Number.isFinite(v) && Math.abs(v) <= 1e6);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = p => p.slice(2).reduce((sum, q, i) => sum + cross(p[0], p[i + 1], q), 0) / 2;

  function bounds(points) {
    const min = [Infinity, Infinity];
    const max = [-Infinity, -Infinity];
    for (const p of points) {
      min[0] = Math.min(min[0], p[0]);
      min[1] = Math.min(min[1], p[1]);
      max[0] = Math.max(max[0], p[0]);
      max[1] = Math.max(max[1], p[1]);
    }
    return { min, max };
  }

  function convex(raw) {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 128 || !Array.from(raw).every(point))
      throw new Error('Surface cells need 3 to 128 finite chart points per polygon');
    const signedArea = area(raw);
    if (Math.abs(signedArea) <= EPS * EPS) throw new Error('Surface cells need a nonzero polygon area');
    const points = raw.map(p => p.slice());
    if (signedArea < 0) points.reverse();
    const unique = new Set();
    const planes = points.map((a, i) => {
      const key = JSON.stringify(a);
      if (unique.has(key)) throw new Error('Surface cell polygons need distinct vertices');
      unique.add(key);
      const b = points[(i + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length <= EPS) throw new Error('Surface cell polygons need nonzero edges');
      const dx = (b[0] - a[0]) / length;
      const dy = (b[1] - a[1]) / length;
      const side = ([x, y]) => dx * (y - a[1]) - dy * (x - a[0]);
      if (points.some(p => side(p) < -EPS)) throw new Error('Surface cell clip polygons must be convex');
      return side;
    });
    return { points, planes, bounds: bounds(points) };
  }

  function split(polygon, side) {
    const inside = [];
    const outside = [];
    const values = polygon.map(side);
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const a = polygon[i];
      const d = values[i];
      const next = values[j];
      if (d >= -EPS) inside.push(a);
      if (d <= EPS) outside.push(a);
      if ((d < -EPS && next > EPS) || (d > EPS && next < -EPS)) {
        const b = polygon[j];
        const t = d / (d - next);
        const crossing = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        inside.push(crossing);
        outside.push(crossing);
      }
    }
    return {
      inside: inside.length >= 3 && area(inside) > EPS * EPS ? inside : [],
      outside: outside.length >= 3 && area(outside) > EPS * EPS && values.some(d => d < -EPS) ? outside : []
    };
  }

  function clip(cells, { boundary, holes = [], budget = 8192, work = 250000 } = {}) {
    if (
      !Array.isArray(cells) ||
      !Array.isArray(holes) ||
      holes.length > 4096 ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 65536 ||
      cells.length > budget ||
      !Number.isSafeInteger(work) ||
      work < 1 ||
      work > 4000000
    ) throw new Error('Surface cell clipping needs bounded cells, holes and work budgets');
    const domain = boundary === undefined ? null : convex(boundary);
    const cutouts = Array.from(holes, convex);
    const results = [];
    const keys = new Map();
    let fragmentCount = 0;
    let used = 0;

    function cut(polygon, side) {
      used += polygon.length;
      if (used > work) throw new Error('Surface cell clipping exceeds its work budget');
      return split(polygon, side);
    }
    function subtract(polygon, hole) {
      const b = bounds(polygon);
      if (b.min.some((v, i) => v >= hole.bounds.max[i] || b.max[i] <= hole.bounds.min[i])) return [polygon];
      let inside = polygon;
      const pieces = [];
      for (const plane of hole.planes) {
        const part = cut(inside, plane);
        if (!part.inside.length) return [polygon];
        inside = part.inside;
        if (part.outside.length) pieces.push(part.outside);
      }
      return pieces;
    }

    for (const cell of cells) {
      const key = cell?.key ?? cell?.id;
      if (typeof key !== 'string' || !key) throw new Error('Surface cells need nonempty string keys');
      let polygon;
      if (cell.polygon) polygon = convex(cell.polygon).points;
      else {
        const { min, max } = cell.inset || {};
        if (!point(min) || !point(max) || min[0] >= max[0] || min[1] >= max[1])
          throw new Error('Surface cells need a convex footprint or ordered inset bounds');
        polygon = [min.slice(), [max[0], min[1]], max.slice(), [min[0], max[1]]];
      }
      if (domain) for (const plane of domain.planes) {
        polygon = cut(polygon, plane).inside;
        if (!polygon.length) break;
      }
      if (!polygon.length) continue;
      let fragments = [polygon];
      const footprint = bounds(polygon);
      for (const hole of cutouts) {
        if (footprint.min[0] >= hole.bounds.max[0] || footprint.max[0] <= hole.bounds.min[0] ||
            footprint.min[1] >= hole.bounds.max[1] || footprint.max[1] <= hole.bounds.min[1]) continue;
        const next = [];
        for (const fragment of fragments) {
          next.push(...subtract(fragment, hole));
          if (next.length + fragmentCount > budget) throw new Error('Surface cell clipping exceeds its fragment budget');
        }
        fragments = next;
        if (!fragments.length) break;
      }
      fragmentCount += fragments.length;
      if (fragmentCount > budget) throw new Error('Surface cell clipping exceeds its fragment budget');
      if (!fragments.length) continue;
      if (!keys.has(key)) {
        const item = { key, fragments: [] };
        keys.set(key, item);
        results.push(item);
      }
      keys.get(key).fragments.push(...fragments);
    }
    return P.data.freeze({ cells: results, fragmentCount });
  }

  function index(plan) {
    if (!Array.isArray(plan?.cells) || plan.cells.length > 65536)
      throw new Error('A surface cell index needs a bounded clipped plan');
    const byKey = new Map();
    let fragmentCount = 0;
    for (const cell of plan.cells) {
      if (typeof cell?.key !== 'string' || !cell.key || byKey.has(cell.key) ||
          !Array.isArray(cell.fragments) || !cell.fragments.length)
        throw new Error('Indexed surface cells need unique keys and clipped fragments');
      fragmentCount += cell.fragments.length;
      if (fragmentCount > 65536) throw new Error('Surface cell index exceeds its fragment budget');
      byKey.set(cell.key, cell);
    }
    function contains(key, at) {
      if (!point(at)) throw new Error('Cell lookup needs a finite chart point');
      return byKey.get(key)?.fragments.some(polygon => polygon.every((a,i) => {
        const b = polygon[(i + 1) % polygon.length];
        return cross(a,b,at) >= -EPS * Math.hypot(b[0]-a[0],b[1]-a[1]);
      })) ?? false;
    }
    function excluding(keys) {
      if ((!Array.isArray(keys) && !(keys instanceof Set)) || (keys.length ?? keys.size) > 65536)
        throw new Error('Surface cell exclusions need a bounded list of keys');
      const omitted = new Set(keys);
      for (const key of omitted) if (typeof key !== 'string' || !key)
        throw new Error('Surface cell exclusions need nonempty keys');
      const cells = plan.cells.filter(cell => !omitted.has(cell.key));
      return Object.freeze({ cells: Object.freeze(cells),
        fragmentCount: cells.reduce((n,cell) => n + cell.fragments.length, 0) });
    }
    return Object.freeze({ get: key => byKey.get(key), contains, excluding });
  }

  P.surfaceCells = { clip, index };
})(KIT);
