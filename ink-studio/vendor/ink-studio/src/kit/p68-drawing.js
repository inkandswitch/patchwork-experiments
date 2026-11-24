/* Retained control points for pressure-sensitive strokes and filled profiles. */
(function (K) {
  const V = K.V, P = K.procedural, { boxOf } = P.spatial;
  const ZERO = [0, 0, 0], X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const TAU = 2 * Math.PI;
  const vec = (p, n) => Array.isArray(p) && p.length === n && p.every(Number.isFinite);
  const positive = x => Number.isFinite(x) && x > 0;
  const unit = x => Number.isFinite(x) && x >= 0 && x <= 1;
  const kind = s => s?.kind === 'stroke' || s?.kind === 'fill';
  const mix = (a, b, t) => a + (b - a) * t;

  function bounds(points, padding = [0, 0, 0]) {
    const b = boxOf(points);
    return { min: V.sub(b.min, padding), max: V.add(b.max, padding) };
  }
  function corners({ min, max }) {
    const out = [];
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]])
      out.push([x, y, z]);
    return out;
  }

  function frame(raw = {}) {
    const { origin = ZERO, u = X, v = Y } = raw;
    if (!vec(origin, 3) || !vec(u, 3) || !vec(v, 3) || V.len(V.cross(u, v)) < 1e-8)
      throw Error('A drawing frame needs a finite origin and independent u and v axes');
    const x = V.norm(u), z = V.norm(V.cross(u, v)), y = V.cross(z, x);
    return { origin, x, y, z };
  }
  function planar({ origin, x, y, z }, offset = 0, scale = 1) {
    return {
      point([a, b, c]) {
        return V.mad(V.mad(V.mad(origin, x, a), y, b), z, offset + c * scale);
      },
      distance(sd, p) {
        const d = V.sub(p, origin);
        return sd(V.dot(d, x), V.dot(d, y), (V.dot(d, z) - offset) / scale) * Math.min(1, scale);
      },
      stretch: Math.max(1, scale)
    };
  }

  function carrier(raw, offset, scale) {
    const { kind: type } = raw;
    if (type !== 'plane' && type !== 'cylinder') throw Error('A drawing surface needs kind plane or cylinder');
    const surface = P.surface[type]({ id: 'drawing', ...raw });
    if (type === 'plane') {
      const f = frame(raw), a = V.len(raw.u), b = V.dot(raw.v, f.x), c = V.dot(raw.v, f.y);
      return {
        ...planar(f, offset, scale),
        chart: ([u, v]) => [u * a + v * b, v * c, 0]
      };
    }

    const r = raw.radii || [raw.radius, raw.radius], radius = r[0];
    if (radius !== r[1]) throw Error('Drawing on a cylinder needs a circular radius');
    const sweep = raw.sweep ?? TAU, arc = radius * sweep, period = radius * TAU;
    const at = (u, v) => surface.samplePointNormal([u, v]);
    const point = ([x, y, z]) => {
      const { p, n } = at(x / arc, y / raw.height);
      return V.mad(p, n, offset + z * scale);
    };
    return {
      periodic: surface.periodicU,
      chart: ([u, v]) => [u * arc, v * raw.height, 0],
      point,
      range(box) {
        const near = radius + offset + box.min[2] * scale, far = radius + offset + box.max[2] * scale;
        if (near <= 0) throw Error('Drawing depth and offset must stay outside the cylinder axis');
        if (box.max[0] - box.min[0] >= period * 2 || !Number.isFinite(period))
          throw Error('A cylindrical mark must span fewer than two turns');
        const mid = (box.min[0] + box.max[0]) / 2;
        const critical = [box.min[0], box.max[0]];
        const nx = at(0, 0).n, ny = at(TAU / (4 * sweep), 0).n;
        for (let axis = 0; axis < 3; axis++) {
          const base = Math.atan2(ny[axis], nx[axis]) * radius, halfTurn = period / 2;
          const first = base + Math.ceil((box.min[0] - base) / halfTurn) * halfTurn;
          for (let i = 0; i < 4; i++) {
            const x = first + i * halfTurn;
            if (x < box.max[0]) critical.push(x);
          }
        }
        return {
          box: bounds(critical.flatMap(x => corners(box).map(([, y, z]) => point([x, y, z])))),
          stretch: Math.max(1, scale, far / radius),
          distance(sd, p) {
            const [u, v] = surface.project(p), { p: q, n } = at(u, v);
            const h = V.dot(V.sub(p, q), n), radial = Math.max(0, radius + h);
            const x = u * arc + Math.round((mid - u * arc) / period) * period;
            const y = v * raw.height, z = (h - offset) / scale;
            const d = Math.min(sd(x, y, z), sd(x - period, y, z), sd(x + period, y, z));
            // An arc can be longer than the chord used to reach the next surface.
            const angular = 2 * Math.sqrt(radial * near) / (Math.PI * radius);
            return d < 0 ? d * Math.min(1, scale, near / radius) :
              Math.max(d * Math.min(1, scale, angular), near - radial, radial - far);
          }
        };
      }
    };
  }

  function unwrap(points, reference) {
    let previous;
    return points.map(([u, v]) => {
      let x = u;
      if (u >= 0 && u <= 1) {
        if (previous && !(previous[0] >= 0 && previous[0] <= 1 && Math.abs(previous[0] - u) === 1))
          x += Math.round(previous[1] - u);
        else if (!previous && reference !== undefined) x += Math.round(reference - u);
      }
      previous = [u, x];
      return [x, v];
    });
  }

  function strokePath(points, pressure, taper, width, arcPoints) {
    const path = [], samples = [], distances = [], drawingPoints = [];
    let length = 0;
    for (let i = 0; i < points.length; i++) {
      if (path.length && V.dist(path.at(-1), points[i]) <= 1e-5) {
        samples[samples.length - 1] = Math.max(samples.at(-1), pressure[i]);
        continue;
      }
      if (path.length) length += V.dist(drawingPoints.at(-1), arcPoints[i]);
      path.push(points[i]);
      drawingPoints.push(arcPoints[i]);
      samples.push(pressure[i]);
      distances.push(length);
    }
    const gain = distances.map(d => length ? mix(taper[0], taper[1], d / length) : Math.max(...taper));
    const radii = samples.map((p, i) => p * width / 2 * gain[i]);
    // Pressure and taper are independent. Keep the rise between opposing ramps
    // even when their product at both endpoints is zero.
    for (let i = path.length - 1; i >= 1; i--) {
      const bend = Math.abs((samples[i] - samples[i - 1]) * (gain[i] - gain[i - 1]));
      const middle = (samples[i - 1] + samples[i]) * (gain[i - 1] + gain[i]) * width / 8;
      if (V.dist(path[i - 1], path[i]) > 2e-5 && (bend > 0.01 || (middle && !radii[i - 1] && !radii[i]))) {
        path.splice(i, 0, V.mul(V.add(path[i - 1], path[i]), 0.5));
        radii.splice(i, 0, middle);
      }
    }
    let max = 0;
    for (const r of radii) max = Math.max(r, max);
    if (!max) return null;
    // Taper uses each authored sample, including the zero-radius endpoints.
    const metric = [0];
    for (let i = 1; i < path.length; i++) metric.push(metric[i - 1] + V.dist(path[i - 1], path[i]));
    const total = metric.at(-1);
    const radius = t => {
      const d = t * total;
      let lo = 0, hi = metric.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (d < metric[mid]) hi = mid;
        else lo = mid;
      }
      return mix(radii[lo], radii[hi], K.clamp((d - metric[lo]) / (metric[hi] - metric[lo]), 0, 1));
    };
    const byPoint = path.flatMap((p, i) => {
      const pad = [radii[i], radii[i], radii[i]];
      return [V.sub(p, pad), V.add(p, pad)];
    });
    return { path, radius, max, box: bounds(byPoint) };
  }

  function prepare(s) {
    if (!s || !kind(s)) throw Error('A drawing needs kind stroke or fill');
    const stroke = s.kind === 'stroke', width = s.width ?? 0.2;
    const depth = s.depth ?? (stroke ? width : 0.08), offset = s.offset ?? 0;
    if ((stroke && !positive(width)) || !positive(depth) || !Number.isFinite(offset))
      throw Error('Drawings need positive width and depth and a finite offset');
    if (s.turn !== undefined) throw Error('Use a drawing depth axis or fill frame for orientation');
    if (s.surface !== undefined && (!s.surface || typeof s.surface !== 'object' || Array.isArray(s.surface)))
      throw Error('A drawing surface must be an object');
    if ((stroke && s.frame !== undefined) || (!stroke && s.axis !== undefined))
      throw Error('A depth axis applies to strokes and a frame applies to fills');
    if (s.surface && (s.axis !== undefined || s.frame !== undefined))
      throw Error('A surface drawing takes its orientation from the carrier');
    if (!s.surface && s.offset !== undefined) throw Error('Offset requires a drawing surface');
    if (s.frame !== undefined && (!s.frame || typeof s.frame !== 'object' || Array.isArray(s.frame)))
      throw Error('A drawing frame must be an object');
    const scale = stroke ? depth / width : 1;
    if (!positive(scale)) throw Error('Brush depth divided by width must be finite and positive');
    let space;
    if (s.surface) space = carrier(s.surface, offset + (stroke ? 0 : depth / 2), scale);
    else if (stroke) {
      const axis = s.axis ?? Z;
      if (!vec(axis, 3) || V.len(axis) < 1e-8) throw Error('Stroke depth axis needs a nonzero 3D vector');
      const z = V.norm(axis), x = V.norm(V.cross(Math.abs(z[0]) < 0.9 ? X : Y, z)), y = V.cross(z, x);
      space = planar({ origin: ZERO, x, y, z }, 0, scale);
      space.chart = p => [V.dot(p, x), V.dot(p, y), V.dot(p, z) / scale];
    } else {
      space = planar(frame(s.frame));
      space.chart = ([x, y]) => [x, y, 0];
    }
    let tube, profile, localBox;
    if (stroke) {
      const { points } = s, taper = s.taper ?? [1, 1];
      if (!Array.isArray(points) || !points.length || !points.every(p => vec(p, s.surface ? 2 : 3)))
        throw Error('A stroke needs finite points in its drawing space');
      const pressure = s.pressure ?? points.map(() => 1);
      if (!Array.isArray(pressure) || pressure.length !== points.length || !pressure.every(unit) ||
          !vec(taper, 2) || !taper.every(unit))
        throw Error('Pressure needs one value per point and taper needs two values, all from 0 to 1');
      const plot = (space.periodic ? unwrap(points) : points).map(space.chart);
      tube = strokePath(plot, pressure, taper, width, s.surface ? plot : points);
      if (!tube) return null;
      localBox = tube.box;
    } else {
      if (!Array.isArray(s.rings) || !s.rings.length ||
          !s.rings.every(ring => Array.isArray(ring) && ring.every(p => vec(p, 2))))
        throw Error('A fill needs an exterior ring and optional holes with finite 2D points');
      const rings = space.periodic ? s.rings.map(ring => unwrap(ring, s.rings[0][0]?.[0])) : s.rings;
      profile = P.construct.profile(rings.map(ring => ring.map(p => space.chart(p).slice(0, 2))));
      localBox = { min: [...profile.bounds.min, -depth / 2], max: [...profile.bounds.max, depth / 2] };
    }
    const region = space.range ? space.range(localBox) : {
      box: bounds(corners(localBox).map(space.point)), distance: space.distance, stretch: space.stretch
    };
    P.spatial.bounds(region.box);
    return { tube, profile, depth, width, scale, point: space.point, ...region };
  }

  function solid(S, spec, mat, o = {}) {
    const mark = prepare(spec);
    if (!mark) return S.add({ bc: ZERO, br: 0, sd: () => 1e9, sample() {} }, mat, { ...o, hold: true });
    const { profile, tube, depth, width, point, box, distance, stretch } = mark;
    const held = { hold: true };
    const template = profile ? S.extrude(profile.rings, ZERO, depth, mat, held) :
      tube.path.length === 1 ? S.ball(tube.path[0], tube.max, mat, held) :
      S.tube(tube.path, tube.radius, undefined, mat, held);
    const bc = V.mul(V.add(box.min, box.max), 0.5), br = V.dist(box.min, box.max) / 2;
    return S.add({
      bc, br, geometryBounds: box,
      sd: (x, y, z) => distance(template.sd, [x, y, z]),
      sample(f) {
        template.sample.call({ res: this.res / stretch }, (x, y, z) => f(...point([x, y, z])));
      }
    }, mat, { res: tube ? Math.min(S.res, Math.max(width, depth) / 3) : S.res, ...o });
  }

  K.drawing = { kind, prepare, solid };
})(KIT);
