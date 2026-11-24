/* Arc-length routes, convex perimeter routing, and fitted construction intervals. */
(function (K) {
  const P = K.procedural,
    V = K.V;
  const EPS = 1e-8;
  const vector = (p, dimension = 3) => Array.isArray(p) && p.length === dimension && p.every(Number.isFinite);
  const clamp = t => Math.max(0, Math.min(1, t));

  function frame(tangent, up) {
    let side = V.cross(up, tangent);
    if (V.len(side) < EPS) {
      side = V.cross(Math.abs(tangent[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1], tangent);
    }
    side = V.norm(side);
    return { tangent: tangent.slice(), side, normal: V.cross(tangent, side) };
  }

  function polyline(input, { up = [0, 1, 0] } = {}) {
    if (
      !Array.isArray(input) ||
      input.length < 2 ||
      input.length > 4097 ||
      !input.every(point => vector(point)) ||
      !vector(up) ||
      !(V.len(up) > EPS) ||
      !Number.isFinite(V.len(up))
    ) {
      throw new Error('A route needs 2 to 4097 finite points and a nonzero up direction');
    }
    const points = P.data.freeze(input.map(point => point.slice()));
    const direction = V.norm(up);
    let length = 0;
    const segments = points.slice(1).map((end, index) => {
      const start = points[index],
        delta = V.sub(end, start),
        span = V.len(delta);
      if (!Number.isFinite(span) || span < EPS || !Number.isFinite(length + span)) {
        throw new Error('Route segments need distinct points and finite length');
      }
      const segment = { start, delta, span, offset: length, tangent: V.mul(delta, 1 / span) };
      length += span;
      return segment;
    });
    function at(segment, fraction, t, index) {
      return {
        point: V.mad(segment.start, segment.delta, fraction),
        ...frame(segment.tangent, direction),
        t,
        segment: index
      };
    }
    function sample(value) {
      if (!Number.isFinite(value)) throw new Error('Route sampling needs a finite arc coordinate');
      const t = clamp(value),
        distance = t * length;
      let low = 0,
        high = segments.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (segments[mid].offset + segments[mid].span < distance) low = mid + 1;
        else high = mid;
      }
      const segment = segments[low];
      const result = at(segment, clamp((distance - segment.offset) / segment.span), t, low);
      if (t === 1) result.point = points.at(-1).slice();
      return result;
    }
    function closest(point) {
      if (!vector(point)) throw new Error('Route projection needs a finite point');
      let best = null;
      for (const [i, segment] of segments.entries()) {
        const fraction = clamp(V.dot(V.sub(point, segment.start), segment.tangent) / segment.span);
        const candidate = V.mad(segment.start, segment.delta, fraction);
        const distance = V.dist(point, candidate);
        if (!best || distance < best.distance) {
          best = { ...at(segment, fraction, (segment.offset + fraction * segment.span) / length, i), distance };
        }
      }
      return best;
    }
    return Object.freeze({
      points,
      length,
      sample,
      closest,
      bounds: P.data.freeze(P.spatial.boxOf(points)),
      breaks: Object.freeze(segments.slice(1).map(segment => segment.offset / length))
    });
  }

  function aroundConvex(outline, start, end, { offset = 0, direction = 'shortest' } = {}) {
    if (
      !Array.isArray(outline) ||
      outline.length < 3 ||
      outline.length > 256 ||
      !outline.every(p => vector(p, 2) && p.every(v => Math.abs(v) <= 1e6)) ||
      !vector(start) ||
      !vector(end) ||
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset > 1e4 ||
      !['shortest', 'longest', 'forward', 'backward'].includes(direction)
    ) {
      throw new Error('Perimeter routes need a convex XZ outline, two endpoints and a valid offset and direction');
    }
    const area = outline.reduce((sum, p, i) => {
      const next = outline[(i + 1) % outline.length];
      return sum + p[0] * next[1] - p[1] * next[0];
    }, 0);
    if (Math.abs(area) < EPS) throw new Error('Route perimeter has no area');
    const normals = outline.map((p, i) => {
      const next = outline[(i + 1) % outline.length];
      const x = next[0] - p[0],
        z = next[1] - p[1],
        length = Math.hypot(x, z);
      if (length < EPS) throw new Error('Route perimeter has a repeated vertex');
      const normal = [(Math.sign(area) * z) / length, (Math.sign(area) * -x) / length];
      if (outline.some(q => (q[0] - p[0]) * normal[0] + (q[1] - p[1]) * normal[1] > EPS)) {
        throw new Error('Route perimeter must be convex');
      }
      return normal;
    });
    const polygon = outline.map((p, i) => {
      const before = normals[(i + normals.length - 1) % normals.length],
        after = normals[i];
      const denominator = 1 + before[0] * after[0] + before[1] * after[1];
      if (offset && denominator < 0.0008) throw new Error('Route perimeter offset is too acute');
      return [
        p[0] + (offset * (before[0] + after[0])) / denominator,
        0,
        p[1] + (offset * (before[1] + after[1])) / denominator
      ];
    });
    const loop = polyline([...polygon, polygon[0]]);
    const a = loop.closest([start[0], 0, start[2]]),
      b = loop.closest([end[0], 0, end[2]]);
    const wrap = t => ((t % 1) + 1) % 1;
    const forward = wrap(b.t - a.t),
      backward = 1 - forward;
    const positive =
      direction === 'forward' ||
      (direction === 'shortest' && forward <= backward) ||
      (direction === 'longest' && forward > backward);
    const travel = positive ? forward : backward;
    if (travel <= EPS) {
      if (Math.abs(end[1] - start[1]) <= EPS) throw new Error('Projected route endpoints coincide');
      return polyline([
        [a.point[0], start[1], a.point[2]],
        [a.point[0], end[1], a.point[2]]
      ]);
    }
    const corners = [0, ...loop.breaks]
      .map(t => (positive ? wrap(t - a.t) : wrap(a.t - t)))
      .filter(t => t > EPS && t < travel - EPS)
      .sort((u, v) => u - v);
    const points = [0, ...corners, travel].map((t, i) => {
      const p = i === 0 ? a.point : t === travel ? b.point : loop.sample(wrap(a.t + (positive ? t : -t))).point;
      return [p[0], start[1] + ((end[1] - start[1]) * t) / travel, p[2]];
    });
    return polyline(points);
  }

  function layout(
    route,
    {
      pitch,
      gap = 0,
      distribution = 'ceil',
      from = 0,
      to = 1,
      preserveCorners = true,
      key = 'route',
      budget = 4096
    } = {}
  ) {
    if (
      !route ||
      !Number.isFinite(route.length) ||
      route.length <= 0 ||
      typeof route.sample !== 'function' ||
      !Number.isFinite(pitch) ||
      pitch <= 0 ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to > 1 ||
      to <= from ||
      !['round', 'floor', 'ceil'].includes(distribution) ||
      typeof key !== 'string' ||
      !key ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 4096
    ) {
      throw new Error('Route layout needs a valid route, pitch, distribution and interval budget');
    }
    const sourceBreaks = preserveCorners ? route.breaks || [] : [];
    if (
      !Array.isArray(sourceBreaks) ||
      sourceBreaks.length >= 4096 ||
      sourceBreaks.some((t, i) => !Number.isFinite(t) || t <= (sourceBreaks[i - 1] ?? 0) || t >= 1)
    ) {
      throw new Error('Route breaks must be ordered internal arc coordinates');
    }
    const stops = [0, ...sourceBreaks, 1],
      intervals = [];
    function station(t) {
      const at = route.sample(t);
      if (!at || !vector(at.point)) throw new Error('Route sampling needs a finite point');
      return P.data.clone(at);
    }
    for (let segment = 0; segment < stops.length - 1; segment++) {
      const a = Math.max(from, stops[segment]),
        b = Math.min(to, stops[segment + 1]);
      if (b <= a) continue;
      const length = (b - a) * route.length,
        count = Math.max(1, Math[distribution](length / pitch));
      if (count + intervals.length > budget) throw new Error('Route layout exceeds its interval budget');
      const size = length / count,
        step = (b - a) / count,
        inset = gap / (2 * route.length);
      if (gap >= size) throw new Error('Route gap must leave a positive piece length');
      for (let i = 0; i < count; i++) {
        const start = a + i * step,
          end = i === count - 1 ? b : a + (i + 1) * step;
        const middle = (start + end) / 2;
        intervals.push({
          key: JSON.stringify([key, segment, i]),
          segment,
          index: i,
          start,
          end,
          size,
          length: size - gap,
          first: station(start + inset).point,
          last: station(end - inset).point,
          frame: station(middle)
        });
      }
    }
    return P.data.freeze(intervals);
  }

  P.routes = { polyline, aroundConvex, layout };
})(KIT);
