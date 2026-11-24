/* Reserve upright, oriented volumes while laying out nearby candidates. */
(function (K) {
  const P = K.procedural || K.authoring;
  const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const EPS = 1e-9;

  function createFootprintReservations({ clearance = 0, cellSize = 2 } = {}) {
    if (!Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(cellSize) || cellSize <= 0)
      throw new Error('Footprint reservations need nonnegative clearance and a positive cell size');
    const cells = new Map(), large = [], occupied = [];

    function frame({ point, tangent, size } = {}) {
      if (![point, tangent, size].every(vector) || size.some(v => v <= 0))
        throw new Error('A reservation needs a finite point and positive dimensions');
      const length = Math.hypot(tangent[0], tangent[2]);
      if (length < 1e-8 || !Number.isFinite(length)) throw new Error('A reservation needs a horizontal tangent');
      const u = [tangent[0] / length, tangent[2] / length], v = [-u[1], u[0]];
      const half = [(size[0] + clearance) / 2, (size[2] + clearance) / 2];
      const extent = u.map((_, i) => half[0] * Math.abs(u[i]) + half[1] * Math.abs(v[i]));
      const center = [point[0], point[2]];
      return { center, axes: [u, v], half, low: point[1], high: point[1] + size[1],
        min: center.map((x, i) => x - extent[i]), max: center.map((x, i) => x + extent[i]) };
    }

    function keys(item) {
      const lo = item.min.map(v => Math.floor(v / cellSize)), hi = item.max.map(v => Math.floor(v / cellSize));
      if (![...lo, ...hi].every(Number.isSafeInteger) || (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) > 128)
        return null;
      const result = [];
      for (let x = lo[0]; x <= hi[0]; x++) for (let z = lo[1]; z <= hi[1]; z++) result.push(x + '/' + z);
      return result;
    }

    const verticalOverlap = (a, b) => a.high > b.low && b.high > a.low;
    const axes = (a, b) => [...a.axes, ...b.axes];
    const radius = (item, axis) => Math.abs(dot(item.axes[0], axis)) * item.half[0] +
      Math.abs(dot(item.axes[1], axis)) * item.half[1];

    function intersects(a, b) {
      if (!verticalOverlap(a, b) || a.min.some((v, i) => v >= b.max[i] || b.min[i] >= a.max[i]))
        return false;
      const delta = a.center.map((v, i) => v - b.center[i]);
      return axes(a, b).every(axis => Math.abs(dot(delta, axis)) < radius(a, axis) + radius(b, axis));
    }

    function nearby(entries) {
      if (entries === null) return occupied;
      const found = new Set(large);
      for (const key of entries) for (const other of cells.get(key) || []) found.add(other);
      return found;
    }

    function fits(item, entries) {
      for (const other of nearby(entries)) if (intersects(item, other)) return false;
      return true;
    }

    function forbidden(a, b, direction) {
      if (!verticalOverlap(a, b)) return null;
      const delta = a.center.map((value, i) => value - b.center[i]);
      let low = -Infinity, high = Infinity;
      for (const axis of axes(a, b)) {
        const start = dot(delta, axis), rate = dot(direction, axis), limit = radius(a, axis) + radius(b, axis);
        if (!rate) {
          if (Math.abs(start) >= limit) return null;
          continue;
        }
        const first = (-limit - start) / rate, last = (limit - start) / rate;
        low = Math.max(low, Math.min(first, last));
        high = Math.min(high, Math.max(first, last));
        if (high <= low) return null;
      }
      return [low, high];
    }

    function freeIntervals(spec, tangent, range) {
      const length = vector(tangent) ? Math.hypot(tangent[0], tangent[2]) : 0;
      if (!Number.isFinite(length) || length < 1e-8 || !Array.isArray(range) || range.length !== 2 ||
          !range.every(Number.isFinite) || range[1] < range[0])
        throw new Error('Footprint intervals need a horizontal direction and finite ordered range');
      const item = frame(spec), direction = [tangent[0] / length, tangent[2] / length], [from, to] = range;
      const span = direction.map(component => [component * from, component * to]);
      const swept = { min: item.min.map((v, i) => v + Math.min(...span[i])),
        max: item.max.map((v, i) => v + Math.max(...span[i])) };
      const blocked = [];
      for (const other of nearby(keys(swept))) {
        const interval = forbidden(item, other, direction);
        if (interval && interval[0] < to && interval[1] > from) blocked.push(interval);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      const open = [];
      let cursor = from;
      for (const [lo, hi] of blocked) {
        if (lo >= cursor) open.push([cursor, lo]);
        cursor = Math.max(hi, cursor);
        if (cursor > to) break;
      }
      if (cursor <= to) open.push([cursor, to]);
      return open;
    }

    // A fixed-orientation translation collides inside the intersection of
    // the separating-axis strips. Clip each supporting line to its face.
    function translationEdges(item, other, reach, margin) {
      const delta = other.center.map((v, i) => v - item.center[i]), normals = [];
      for (const axis of axes(item, other))
        if (!normals.some(n => Math.abs(cross(n, axis)) <= EPS)) normals.push(axis);
      const planes = normals.flatMap(axis => {
        const sum = radius(item, axis) + radius(other, axis) + margin, center = dot(delta, axis);
        return [[axis, center + sum], [axis.map(v => -v), sum - center]];
      });
      const edges = [];
      for (const [normal, offset] of planes) {
        if (Math.abs(offset) > reach) continue;
        const point = normal.map(v => v * offset), tangent = [-normal[1], normal[0]];
        let low = -Infinity, high = Infinity;
        for (const [axis, limit] of planes) {
          const slope = dot(axis, tangent), available = limit - dot(axis, point);
          if (Math.abs(slope) <= EPS) {
            if (available < -EPS) { low = Infinity; break; }
          } else if (slope > 0) high = Math.min(high, available / slope);
          else low = Math.max(low, available / slope);
        }
        const nearest = Math.min(high, Math.max(low, 0));
        if (high >= low && Math.hypot(offset, nearest) <= reach + EPS)
          edges.push({ point, normal, tangent, offset, low, high, nearest });
      }
      return edges;
    }

    function nearestTranslation(spec, {
      reach, margin = 1e-6, maxObstacles = 32, maxTests = 64, test = () => true
    } = {}) {
      if (![reach, margin].every(v => Number.isFinite(v) && v >= 0) || typeof test !== 'function' ||
          !Number.isSafeInteger(maxObstacles) || maxObstacles < 1 || maxObstacles > 96 ||
          !Number.isSafeInteger(maxTests) || maxTests < 1 || maxTests > 2048)
        throw Error('Footprint translation needs a finite reach, margin and bounded search options');
      const item = frame(spec), origin = item.center;
      let tests = 0;
      function probe(x, z, distance) {
        tests++;
        const moved = { ...item, center: [origin[0] + x, origin[1] + z],
          min: [item.min[0] + x, item.min[1] + z], max: [item.max[0] + x, item.max[1] + z] };
        if (!fits(moved, keys(moved))) return null;
        const offset = [x, 0, z], value = test(offset.slice(), distance);
        return value === false || value == null ? null : { status: 'ok', offset, distance, value, tests };
      }
      const initial = probe(0, 0, 0);
      if (initial) return initial;
      if (!reach) return { status: 'unreachable', tests };
      const swept = { min: item.min.map(v => v - reach - margin), max: item.max.map(v => v + reach + margin) };
      const groups = [];
      for (const other of nearby(keys(swept))) {
        if (!verticalOverlap(item, other) ||
            swept.min.some((v, i) => v > other.max[i] || other.min[i] > swept.max[i])) continue;
        if (groups.length >= maxObstacles) return { status: 'budget', tests };
        groups.push(translationEdges(item, other, reach, margin));
      }
      const points = [];
      function add(x, z) {
        const distance = Math.hypot(x, z);
        if (distance > EPS && distance <= reach + EPS) points.push({ x, z, distance });
      }
      for (const [i, group] of groups.entries()) for (const edge of group) {
        for (const t of [edge.nearest, edge.low, edge.high])
          add(edge.point[0] + t * edge.tangent[0], edge.point[1] + t * edge.tangent[1]);
        for (let j = i + 1; j < groups.length; j++) for (const other of groups[j]) {
          const slope = dot(other.normal, edge.tangent);
          if (Math.abs(slope) <= EPS) continue;
          const t = (other.offset - dot(other.normal, edge.point)) / slope;
          if (t < edge.low - EPS || t > edge.high + EPS) continue;
          const x = edge.point[0] + t * edge.tangent[0], z = edge.point[1] + t * edge.tangent[1];
          const u = x * other.tangent[0] + z * other.tangent[1];
          if (u >= other.low - EPS && u <= other.high + EPS) add(x, z);
        }
      }
      points.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
      const seen = new Set();
      for (const { x, z, distance } of points) {
        const key = Math.round(x / EPS) + '/' + Math.round(z / EPS);
        if (seen.has(key)) continue;
        seen.add(key);
        if (tests >= maxTests) return { status: 'budget', tests };
        const result = probe(x, z, distance);
        if (result) return result;
      }
      return { status: 'unreachable', tests };
    }

    function add(item, entries) {
      occupied.push(item);
      if (entries === null) large.push(item);
      else for (const key of entries) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }

    return Object.freeze({
      freeIntervals, nearestTranslation,
      fits(spec) { const item = frame(spec); return fits(item, keys(item)); },
      reserve(spec) {
        const item = frame(spec), entries = keys(item);
        if (!fits(item, entries)) return false;
        add(item, entries);
        return true;
      },
      occupy(spec) { const item = frame(spec); add(item, keys(item)); }
    });
  }

  function placeFootprintRequests(requests, { obstacles = [], clearance = 0, cellSize = 2 } = {}) {
    if (!Array.isArray(requests) || !Array.isArray(obstacles))
      throw new Error('Footprint placement needs requests and obstacles');
    const order = Array.from(requests, request => {
      const priority = request?.priority ?? 0;
      if (typeof request?.fit !== 'function' || !Number.isFinite(priority))
        throw new Error('A footprint request needs a fitter and a finite priority');
      return { request, priority };
    }).sort((a, b) => b.priority - a.priority);
    const ledger = createFootprintReservations({ clearance, cellSize });
    for (const item of obstacles) ledger.occupy(item);
    const tests = Object.freeze({
      fits: ledger.fits, freeIntervals: ledger.freeIntervals, nearestTranslation: ledger.nearestTranslation
    });
    const placements = [];
    for (const { request } of order) {
      const result = request.fit(tests);
      if (result && ledger.reserve(result.footprint))
        placements.push({ request, footprint: result.footprint, value: result.value });
    }
    return placements;
  }

  function footprintCorridor(points, {width, headroom, below = .05, step = .6, maxVolumes = 2048} = {}) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 4096 ||
        !Array.from(points).every(vector) || ![width,headroom,step].every(v=>Number.isFinite(v)&&v>0) ||
        !Number.isFinite(below) || below < 0 || !Number.isSafeInteger(maxVolumes) ||
        maxVolumes < 1 || maxVolumes > 16384)
      throw new Error('A footprint corridor needs finite waypoints, a width, headroom and a bounded step');
    const volumes = [];
    function add(a,b,tangent,length) {
      if (volumes.length >= maxVolumes) throw new Error('Footprint corridor exceeds its volume budget');
      const low = Math.min(a[1],b[1])-below, high = Math.max(a[1],b[1])+headroom;
      volumes.push({point:[(a[0]+b[0])/2,low,(a[2]+b[2])/2],
        tangent:tangent.slice(),size:[length,high-low,width]});
    }
    let previous;
    for (let i=1; i<points.length; i++) {
      const a=points[i-1], b=points[i], delta=K.V.sub(b,a), run=Math.hypot(delta[0],delta[2]);
      if (run<1e-8) {
        if (Math.abs(delta[1])>1e-8) add(a,b,previous||[1,0,0],width);
        continue;
      }
      const tangent=[delta[0]/run,0,delta[2]/run], sections=Math.ceil(run/step);
      if (volumes.length+sections>maxVolumes)throw new Error('Footprint corridor exceeds its volume budget');
      // A turn keeps its full cross-section at the shared waypoint.
      if(previous&&K.V.dot(previous,tangent)<.999)add(a,a,previous,width);
      previous=tangent;
      for(let j=0;j<sections;j++){
        const low=K.V.mad(a,delta,j/sections),high=K.V.mad(a,delta,(j+1)/sections);
        add(low,high,tangent,run/sections);
      }
    }
    return volumes;
  }

  P.footprintCorridor = footprintCorridor;
  P.createFootprintReservations = createFootprintReservations;
  P.placeFootprintRequests = placeFootprintRequests;
})(KIT);
