/* SDF contacts, distance-to-curve masks, and downhill traces on a carrier. */
(function (K) {
  const P = K.procedural,
    V = K.V,
    EPS = 1e-9,
    clamp = t => Math.max(0, Math.min(1, t)),
    finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6),
    limit = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max;

  function readRun(run, index) {
    const points = Array.isArray(run) ? run : run?.points,
      id = run?.id ?? String(index);
    if (typeof id !== 'string' || !id || !Array.isArray(points) || points.length < 2 || !points.every(finitePoint))
      throw new Error('Contact curves need an ID and at least two finite 3D points');
    return { id, points };
  }

  function expose(runs, occluder, { step = 0.05, maxSamples = 200000, clearance = 0 } = {}) {
    if (
      !Array.isArray(runs) || typeof occluder !== 'function' ||
      !Number.isFinite(step) || step <= EPS || !Number.isFinite(clearance) || !limit(maxSamples, 2000000)
    ) throw new Error('Contact exposure needs curves, an occluding field, and bounded sampling');
    let tests = 0;
    function visible(p) {
      if (++tests > maxSamples) throw new Error('Contact exposure exceeds its sample budget');
      const d = occluder(...p);
      if (typeof d !== 'number' || Number.isNaN(d)) throw new Error('Contact occluder must return a distance');
      return d >= clearance;
    }
    const exposed = [];
    for (const [index, run] of runs.entries()) {
      const { id, points } = readRun(run, index),
        parts = [];
      const closed = V.dist(points[0], points.at(-1)) <= EPS;
      let prior = points[0],
        wasVisible = visible(prior),
        active = wasVisible ? [prior.slice()] : null;
      for (let i = 1; i < points.length; i++) {
        const start = points[i - 1], end = points[i],
          delta = V.sub(end, start),
          n = Math.max(1, Math.ceil(V.len(delta) / step));
        for (let j = 1; j <= n; j++) {
          const p = j === n ? end : V.mad(start, delta, j / n),
            shown = visible(p);
          if (shown !== wasVisible) {
            let a = prior, b = p;
            for (let k = 0; k < 14; k++) {
              const mid = V.mul(V.add(a, b), 0.5);
              if (visible(mid) === wasVisible) a = mid;
              else b = mid;
            }
            if (shown) active = [b];
            else {
              if (V.dist(active.at(-1), a) > EPS) active.push(a);
              if (active.length > 1) parts.push(active);
              active = null;
            }
          }
          if (shown && j === n && V.dist(active.at(-1), p) > EPS) active.push(p.slice());
          prior = p;
          wasVisible = shown;
        }
      }
      if (active?.length > 1) {
        if (closed && parts.length && V.dist(parts[0][0], points[0]) <= EPS) {
          parts[0] = [...active.slice(0, -1), ...parts[0]];
        } else parts.push(active);
      }
      for (const [i, points] of parts.entries())
        exposed.push({ id: id + ':' + i, points, closed: V.dist(points[0], points.at(-1)) <= EPS });
    }
    return P.data.freeze(exposed);
  }

  function traceSdf(chart, signedDistance, {
    id = 'contact', bounds = { min: [0, 0], max: [1, 1] },
    cell = 0.035, iso = 0, maxCells, occluder, exposure
  } = {}) {
    if ((!chart || typeof chart.sample !== 'function') || typeof signedDistance !== 'function' || typeof id !== 'string' || !id)
      throw new Error('SDF contact tracing needs a carrier chart, a signed distance function and an ID');
    function sample(at) {
      const p = chart.sample(at)?.p ?? null;
      if (p !== null && !finitePoint(p)) throw new Error('Contact chart samples need a finite world point');
      return p;
    }
    const paths = P.contours.march((u, v) => {
      const p = sample([u, v]);
      return p === null ? null : signedDistance(...p);
    }, { bounds, cell, iso, maxCells });
    const runs = [];
    for (const [i, path] of paths.entries()) {
      let points = [];
      let part = 0;
      function emit() {
        if (points.length < 2) return;
        const closed = V.dist(points[0], points.at(-1)) <= EPS;
        const key = part ? id + ':' + i + ':' + part : id + ':' + i;
        runs.push({ id: key, points, closed });
        part++;
      }
      for (const at of path.points) {
        const p = sample(at);
        if (p === null) {
          emit();
          points = [];
        } else if (!points.length || V.dist(points.at(-1), p) > EPS) points.push(p.slice());
      }
      emit();
    }
    return occluder === undefined ? P.data.freeze(runs) : expose(runs, occluder, exposure);
  }

  function boxDistance2(box, point) {
    let d2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      const d = Math.max(box.min[axis] - point[axis], point[axis] - box.max[axis], 0);
      d2 += d * d;
    }
    return d2;
  }

  function searchTree(items) {
    if (!items.length) return null;
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const item of items) {
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], item.bounds.min[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], item.bounds.max[axis]);
      }
    }
    if (items.length <= 8) return { bounds, items };
    const sizes = V.sub(bounds.max, bounds.min),
      axis = sizes.indexOf(Math.max(...sizes)),
      middle = items.length >>> 1;
    items.sort((a, b) => a.bounds.min[axis] + a.bounds.max[axis] - b.bounds.min[axis] - b.bounds.max[axis]);
    return { bounds, left: searchTree(items.slice(0, middle)), right: searchTree(items.slice(middle)) };
  }

  function field(runs, { maxSegments = 60000 } = {}) {
    if (!Array.isArray(runs) || !limit(maxSegments, 200000))
      throw new Error('Contact fields need a bounded list of curves');
    const segments = [], ids = new Set();
    let count = 0;
    for (const [index, run] of runs.entries()) {
      const { id, points } = readRun(run, index);
      if (ids.has(id)) throw new Error('Contact field curve IDs must be unique');
      ids.add(id);
      count += points.length - 1;
      if (count > maxSegments) throw new Error('Contact field exceeds its segment budget');
      const path = [];
      let length = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1].slice(),
          b = points[i],
          delta = V.sub(b, a),
          size = V.len(delta);
        if (size <= EPS) continue;
        path.push({ id, a, delta, size, start: length, index: i - 1, ordinal: segments.length + path.length, bounds: P.spatial.boxOf([a, b]) });
        length += size;
      }
      for (const segment of path) {
        segment.length = length;
        segments.push(segment);
      }
    }
    const tree = searchTree(segments);
    function nearest(point, maxDistance = Infinity) {
      if (!finitePoint(point) || typeof maxDistance !== 'number' || !(maxDistance >= 0))
        throw new Error('Contact field queries need a finite point and nonnegative radius');
      let best = null, bestT = 0, d2 = maxDistance * maxDistance;
      function visit(node, lower) {
        if (!node || lower > d2) return;
        if (node.items) {
          for (const entry of node.items) {
            if (boxDistance2(entry.bounds, point) > d2) continue;
            const t = clamp(V.dot(V.sub(point, entry.a), entry.delta) / (entry.size * entry.size)),
              projected = V.mad(entry.a, entry.delta, t),
              delta = V.sub(point, projected),
              current = V.dot(delta, delta);
            if (current < d2 || (current === d2 && (!best || entry.ordinal < best.ordinal))) {
              best = entry;
              bestT = t;
              d2 = current;
            }
          }
        } else {
          const left = boxDistance2(node.left.bounds, point),
            right = boxDistance2(node.right.bounds, point);
          if (left <= right) {
            visit(node.left, left);
            visit(node.right, right);
          } else {
            visit(node.right, right);
            visit(node.left, left);
          }
        }
      }
      visit(tree, tree ? boxDistance2(tree.bounds, point) : Infinity);
      if (!best) return null;
      const arc = best.start + bestT * best.size;
      return { id: best.id, distance: Math.sqrt(d2), point: V.mad(best.a, best.delta, bestT),
        tangent: V.mul(best.delta, 1 / best.size), segment: best.index, arc, t: arc / best.length };
    }
    function mask({ inner = 0, outer, weight } = {}) {
      if (
        !Number.isFinite(inner) || !Number.isFinite(outer) || inner < 0 || outer <= inner ||
        (weight !== undefined && typeof weight !== 'function')
      ) throw new Error('Contact masks need 0 <= inner < outer and an optional weight function');
      return (x, y, z) => {
        const p = [x, y, z], hit = nearest(p, outer);
        if (!hit) return 0;
        const t = clamp((outer - hit.distance) / (outer - inner)),
          multiplier = weight ? weight(hit, p) : 1;
        if (!Number.isFinite(multiplier)) throw new Error('Contact mask weight must be finite');
        return t * t * (3 - 2 * t) * clamp(multiplier);
      };
    }
    const distance = (x, y, z) => nearest([x, y, z])?.distance ?? Infinity;
    function sdf(radius) {
      if (!Number.isFinite(radius) || radius < 0) throw new Error('Contact SDF needs a nonnegative finite radius');
      return (x, y, z) => distance(x, y, z) - radius;
    }
    return Object.freeze({ bounds: tree ? P.data.freeze(tree.bounds) : null, nearest, mask, distance, sdf });
  }

  function runoff(runs, project, {
    spacing = 0.2, step = 0.06, distance = 1, direction = [0, -1, 0], maxPaths = 4096, maxSamples = 100000
  } = {}) {
    if (
      !Array.isArray(runs) || typeof project !== 'function' || !finitePoint(direction) || V.len(direction) <= EPS ||
      ![spacing, step, distance].every(value => Number.isFinite(value) && value > EPS) ||
      !limit(maxPaths, 100000) || !limit(maxSamples, 2000000)
    ) throw new Error('Runoff needs curves, a carrier projection and bounded path settings');
    const gravity = V.norm(direction),
      out = [];
    let paths = 0, samples = 0;
    function onSurface(p) {
      if (++samples > maxSamples) throw new Error('Runoff exceeds its sample budget');
      const hit = project(p);
      if (hit == null) return null;
      if (!finitePoint(hit.p) || !finitePoint(hit.n) || V.len(hit.n) <= EPS)
        throw new Error('Runoff projection must return a point and normal');
      return { p: hit.p.slice(), n: V.norm(hit.n) };
    }
    for (const [index, run] of runs.entries()) {
      const { id, points } = readRun(run, index),
        route = P.routes.polyline(points),
        n = Math.max(1, Math.ceil(route.length / spacing));
      if (paths + n > maxPaths) throw new Error('Runoff exceeds its path budget');
      paths += n;
      for (let i = 0; i < n; i++) {
        let hit = onSurface(route.sample((i + 0.5) / n).point);
        if (!hit) continue;
        const path = [hit.p];
        for (let travelled = 0; travelled < distance - EPS;) {
          const tangent = V.mad(gravity, hit.n, -V.dot(gravity, hit.n)),
            stride = Math.min(step, distance - travelled);
          if (V.len(tangent) < 1e-7) break;
          const next = onSurface(V.mad(hit.p, V.norm(tangent), stride));
          if (!next || V.dot(V.sub(next.p, hit.p), gravity) <= EPS) break;
          path.push(next.p);
          travelled += stride;
          hit = next;
        }
        if (path.length > 1) out.push({ id: id + ':runoff:' + i, points: path });
      }
    }
    return P.data.freeze(out);
  }

  Object.assign(P.contacts, { expose, traceSdf, field, runoff });
})(KIT);
