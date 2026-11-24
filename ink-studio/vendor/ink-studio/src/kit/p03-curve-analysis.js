/* Cached polyline queries, differential estimates and bounded adaptive interpolation. */
(function (K) {
  const C = K.curve,
    V = K.V,
    { freeze } = K.procedural.data,
    cache = new WeakMap();
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Curve analysis: ' + message);
  };
  const record = o => o && typeof o === 'object' && !Array.isArray(o),
    fields = (o, names) => record(o) && Object.keys(o).every(k => names.includes(k));
  const xyz = p =>
    p &&
    p.length === 3 &&
    (Array.isArray(p) || ArrayBuffer.isView(p)) &&
    Array.from(p).every(v => Number.isFinite(v) && Math.abs(v) <= 1e9);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const unit = v => {
    const length = V.len(v);
    return length > 0 ? V.mul(v, 1 / length) : [0, 0, 0];
  };
  const source = input =>
    input && typeof input.at === 'function' && Array.isArray(input.points) ? input : C.path(input);
  function metadata(input) {
    const path = source(input);
    if (cache.has(path)) return cache.get(path);
    const lengths = [0],
      segments = [];
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i],
        delta = V.sub(b, a),
        length = V.len(delta);
      lengths.push(lengths.at(-1) + length);
      segments.push({
        a,
        b,
        delta,
        length,
        i: i - 1,
        lo: a.map((v, k) => Math.min(v, b[k])),
        hi: a.map((v, k) => Math.max(v, b[k]))
      });
    }
    function tree(rows) {
      const lo = [0, 1, 2].map(k => Math.min(...rows.map(r => r.lo[k]))),
        hi = [0, 1, 2].map(k => Math.max(...rows.map(r => r.hi[k])));
      if (rows.length <= 8) return { lo, hi, rows };
      const spans = hi.map((v, k) => v - lo[k]),
        axis = spans.indexOf(Math.max(...spans)),
        sorted = rows.slice().sort((a, b) => a.lo[axis] + a.hi[axis] - (b.lo[axis] + b.hi[axis]) || a.i - b.i),
        middle = sorted.length >> 1;
      return { lo, hi, left: tree(sorted.slice(0, middle)), right: tree(sorted.slice(middle)) };
    }
    const data = { path, lengths, segments, tree: tree(segments) };
    cache.set(path, data);
    return data;
  }
  const boxDistance = (p, node) => p.reduce((sum, v, k) => sum + Math.max(node.lo[k] - v, 0, v - node.hi[k]) ** 2, 0);
  function closest(input, point) {
    check(xyz(point), 'closest query needs a finite XYZ point');
    const m = metadata(input);
    let best = Infinity,
      found;
    function visit(node) {
      if (boxDistance(point, node) > best) return;
      if (node.rows) {
        for (const s of node.rows) {
          const fraction = clamp(V.dot(V.sub(point, s.a), s.delta) / (s.length * s.length)),
            p = V.mad(s.a, s.delta, fraction),
            square = V.dot(V.sub(point, p), V.sub(point, p)),
            along = m.lengths[s.i] + fraction * s.length;
          if (square < best || (square === best && along < found.along)) {
            best = square;
            found = { p, along, t: along / m.path.length, tan: V.mul(s.delta, 1 / s.length), segment: s.i, fraction };
          }
        }
      } else {
        const a = boxDistance(point, node.left),
          b = boxDistance(point, node.right);
        if (a <= b) {
          visit(node.left);
          visit(node.right);
        } else {
          visit(node.right);
          visit(node.left);
        }
      }
    }
    visit(m.tree);
    const parameters = m.path.parameters;
    if (parameters)
      found.parameter =
        parameters[found.segment] + (parameters[found.segment + 1] - parameters[found.segment]) * found.fraction;
    return { ...found, distance: Math.sqrt(best) };
  }
  function locate(m, distance) {
    check(Number.isFinite(distance), 'distance must be finite');
    const along = m.path.closed
      ? ((distance % m.path.length) + m.path.length) % m.path.length
      : clamp(distance, 0, m.path.length);
    let lo = 0,
      hi = m.lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (m.lengths[mid] <= along) lo = mid;
      else hi = mid;
    }
    return { lo, hi, along, fraction: (along - m.lengths[lo]) / (m.lengths[hi] - m.lengths[lo]) };
  }
  function curvature(input, distance, options = {}) {
    check(
      fields(options, ['step']) &&
        (options.step === undefined || (Number.isFinite(options.step) && options.step >= 1e-6 && options.step <= 0.02)),
      'invalid derivative step'
    );
    const m = metadata(input),
      p = m.path,
      where = locate(m, distance);
    let value,
      normal,
      tan,
      position,
      defined = true,
      parameter,
      method;
    if (p.evaluate && p.parameters) {
      method = 'parametric';
      parameter = p.parameters[where.lo] + (p.parameters[where.hi] - p.parameters[where.lo]) * where.fraction;
      const h = options.step ?? 0.001,
        center = parameter,
        forward = !p.closed && center < 2 * h,
        backward = !p.closed && center > 1 - 2 * h,
        indices = forward ? [0, 1, 2, 3, 4] : backward ? [0, -1, -2, -3, -4] : [-2, -1, 0, 1, 2],
        first = forward ? [-25, 48, -36, 16, -3] : backward ? [25, -48, 36, -16, 3] : [1, -8, 0, 8, -1],
        second = forward || backward ? [35, -104, 114, -56, 11] : [-1, 16, -30, 16, -1],
        evaluate = u => p.evaluate(p.closed ? ((u % 1) + 1) % 1 : clamp(u));
      position = evaluate(center);
      const samples = indices.map(i => V.sub(evaluate(center + i * h), position)),
        d1 = [0, 1, 2].map(k => samples.reduce((sum, v, i) => sum + v[k] * first[i], 0) / (12 * h)),
        d2 = [0, 1, 2].map(k => samples.reduce((sum, v, i) => sum + v[k] * second[i], 0) / (12 * h * h)),
        speed = V.len(d1);
      defined = speed > (1e-8 * Math.max(...samples.map(v => V.len(v)))) / h && Number.isFinite(speed);
      tan = defined ? V.mul(d1, 1 / speed) : p.at(where.along).tan;
      value = defined ? V.len(V.cross(d1, d2)) / speed ** 3 : null;
      const acceleration = V.sub(d2, V.mul(tan, V.dot(d2, tan)));
      normal = value > 1e-10 ? unit(acceleration) : null;
    } else {
      method = 'circumcircle';
      const n = p.points.length - (p.closed ? 1 : 0);
      if (!m.curvatures)
        m.curvatures = Array.from({ length: n }, (_, i) => {
          if (n < 3) return { value: 0, normal: null, defined: true };
          const j = p.closed ? i : Math.max(1, Math.min(n - 2, i)),
            a = p.points[(j + n - 1) % n],
            b = p.points[j],
            c = p.points[(j + 1) % n],
            ab = V.sub(b, a),
            bc = V.sub(c, b),
            ac = V.sub(c, a),
            den = V.len(ab) * V.len(bc) * V.len(ac);
          if (V.len(ac) <= 1e-10 * (V.len(ab) + V.len(bc))) return { value: null, normal: null, defined: false };
          const value = (2 * V.len(V.cross(ab, bc))) / den,
            T = unit(ac),
            delta = V.sub(unit(bc), unit(ab));
          return {
            value,
            normal: value > 1e-10 ? unit(V.sub(delta, V.mul(T, V.dot(delta, T)))) : null,
            defined: true
          };
        });
      const a = m.curvatures[where.lo % n],
        b = m.curvatures[where.hi % n];
      defined = a.defined && b.defined;
      value = defined ? a.value + (b.value - a.value) * where.fraction : null;
      normal =
        defined && value > 1e-10 ? unit(V.lerp(a.normal ?? [0, 0, 0], b.normal ?? [0, 0, 0], where.fraction)) : null;
      const at = p.at(where.along);
      position = at.p;
      tan = at.tan;
    }
    if (!Number.isFinite(value) && value !== null) {
      defined = false;
      value = null;
      normal = null;
    }
    if (normal && V.len(normal) === 0) normal = null;
    return {
      p: position,
      tan,
      normal,
      value,
      radius: value === null ? null : value > 0 ? 1 / value : Infinity,
      defined,
      method,
      along: where.along,
      ...(parameter !== undefined && { parameter })
    };
  }
  function adaptive(input, options = {}) {
    check(
      fields(options, [
        'tolerance',
        'angle',
        'minSegments',
        'maxSegments',
        'maxDepth',
        'maxSegmentLength',
        'closed',
        'up',
        'breaks'
      ]),
      'unknown adaptive setting'
    );
    const {
      tolerance = 0.005,
      angle = 0.15,
      minSegments = 8,
      maxSegments = 4096,
      maxDepth = 18,
      maxSegmentLength = Infinity,
      closed = !!input.closed,
      up = [0, 1, 0]
    } = options;
    check(
      Number.isFinite(tolerance) &&
        tolerance > 0 &&
        tolerance <= 1e6 &&
        Number.isFinite(angle) &&
        angle > 0 &&
        angle <= Math.PI &&
        Number.isSafeInteger(minSegments) &&
        minSegments >= 1 &&
        Number.isSafeInteger(maxSegments) &&
        maxSegments >= minSegments &&
        maxSegments <= 4096 &&
        Number.isSafeInteger(maxDepth) &&
        maxDepth >= 0 &&
        maxDepth <= 24 &&
        (maxSegmentLength === Infinity || (Number.isFinite(maxSegmentLength) && maxSegmentLength > 0)) &&
        typeof closed === 'boolean',
      'invalid adaptive budget or tolerance'
    );
    const evaluate = typeof input === 'function' ? input : input?.evaluate?.bind(input);
    check(typeof evaluate === 'function', 'adaptive sampling requires a parametric evaluator');
    const breaks = options.breaks ?? input.breaks ?? [0, 1];
    check(
      Array.isArray(breaks) &&
        breaks.length <= 4097 &&
        Array.from(breaks).every(v => Number.isFinite(v) && v >= 0 && v <= 1),
      'invalid mandatory parameters'
    );
    const seeds = [...new Set([...Array.from({ length: minSegments + 1 }, (_, i) => i / minSegments), ...breaks])].sort(
      (a, b) => a - b
    );
    check(seeds.length - 1 <= maxSegments, 'mandatory samples exceed adaptive budget');
    const samples = new Map();
    let evaluations = 0,
      leaves = seeds.length - 1,
      limited = false,
      maxError = 0,
      maxAngle = 0;
    function point(u) {
      if (samples.has(u)) return samples.get(u);
      const v = evaluate(u);
      check(xyz(v), 'evaluator must return bounded finite XYZ points');
      const p = Array.from(v);
      samples.set(u, p);
      evaluations++;
      return p;
    }
    const output = [{ u: 0, p: point(0) }];
    function refine(a, b, depth) {
      const p = point(a),
        q = point(b),
        positions = [p, point(a + (b - a) * 0.25), point((a + b) / 2), point(a + (b - a) * 0.75), q],
        chord = V.sub(q, p),
        square = V.dot(chord, chord);
      let error = 0,
        turn = 0;
      for (const v of positions.slice(1, -1)) {
        const f = square ? clamp(V.dot(V.sub(v, p), chord) / square) : 0;
        error = Math.max(error, V.dist(v, V.mad(p, chord, f)));
      }
      for (let i = 1; i < positions.length - 1; i++) {
        const x = V.sub(positions[i], positions[i - 1]),
          y = V.sub(positions[i + 1], positions[i]);
        if (V.len(x) > 1e-12 && V.len(y) > 1e-12)
          turn = Math.max(turn, Math.acos(clamp(V.dot(unit(x), unit(y)), -1, 1)));
      }
      const split = error > tolerance || turn > angle || V.len(chord) > maxSegmentLength;
      if (split && depth < maxDepth && leaves < maxSegments) {
        leaves++;
        const middle = (a + b) / 2;
        refine(a, middle, depth + 1);
        refine(middle, b, depth + 1);
      } else {
        if (split) limited = true;
        maxError = Math.max(maxError, error);
        maxAngle = Math.max(maxAngle, turn);
        output.push({ u: b, p: q });
      }
    }
    for (let i = 1; i < seeds.length; i++) refine(seeds[i - 1], seeds[i], 0);
    if (closed) {
      check(V.dist(output[0].p, output.at(-1).p) <= Math.max(1e-8, tolerance), 'closed evaluator endpoints must meet');
      output.at(-1).p = output[0].p.slice();
    }
    const kept = output.filter((v, i) => !i || V.dist(v.p, output[i - 1].p) > 1e-12);
    check(kept.length >= 2, 'adaptive curve collapsed');
    const path = C.path(
        kept.map(v => v.p),
        { closed, up }
      ),
      parameters = kept.map(v => v.u);
    check(path.points.length === parameters.length, 'closed curve needs distinct interior samples');
    const api = freeze({
      ...path,
      closest(point) {
        return closest(api, point);
      },
      curvature(distance, settings) {
        return curvature(api, distance, settings);
      },
      parameters,
      evaluate(u) {
        check(Number.isFinite(u), 'parameter must be finite');
        return Array.from(evaluate(clamp(u)));
      },
      breaks: seeds,
      sampling: {
        mode: 'adaptive',
        segments: path.points.length - 1,
        evaluations,
        tolerance,
        angle,
        maxError,
        maxAngle,
        limited
      }
    });
    return api;
  }
  function interpolate(input, options = {}) {
    check(
      fields(options, ['closed', 'up', 'alpha', 'tension', 'segmentsPerSpan', 'adaptive']),
      'unknown interpolation setting'
    );
    const path = C.path(input, {
        ...(options.closed !== undefined && { closed: options.closed }),
        ...(options.up !== undefined && { up: options.up })
      }),
      points = path.points.slice(0, path.closed ? -1 : undefined),
      n = points.length,
      { alpha = 0.5, tension = 0, segmentsPerSpan = 12 } = options,
      spans = path.closed ? n : n - 1;
    check(
      Number.isFinite(alpha) &&
        alpha >= 0 &&
        alpha <= 1 &&
        Number.isFinite(tension) &&
        tension >= 0 &&
        tension <= 1 &&
        Number.isSafeInteger(segmentsPerSpan) &&
        segmentsPerSpan >= 1 &&
        segmentsPerSpan <= 4096 &&
        (options.adaptive !== undefined || segmentsPerSpan * spans <= 4096),
      'invalid interpolation parameters or segment budget'
    );
    const lengths = Array.from({ length: spans }, (_, i) => V.dist(points[i], points[(i + 1) % n]) ** alpha),
      knots = [0];
    for (const d of lengths) knots.push(knots.at(-1) + d);
    const total = knots.at(-1),
      breaks = knots.map(v => v / total),
      derivatives = points.map((p, i) => {
        if (!path.closed && i === 0) return V.mul(V.sub(points[1], p), (1 - tension) / lengths[0]);
        if (!path.closed && i === n - 1) return V.mul(V.sub(p, points[i - 1]), (1 - tension) / lengths[i - 1]);
        const prev = points[(i + n - 1) % n],
          next = points[(i + 1) % n],
          a = lengths[(i + spans - 1) % spans],
          b = lengths[i % spans];
        return V.mul(V.add(V.mul(V.sub(p, prev), b / a), V.mul(V.sub(next, p), a / b)), (1 - tension) / (a + b));
      });
    function evaluate(u) {
      check(Number.isFinite(u), 'parameter must be finite');
      u = clamp(u);
      if (path.closed && u === 1) return points[0].slice();
      let lo = 0,
        hi = spans;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (breaks[mid] <= u) lo = mid;
        else hi = mid;
      }
      const t = clamp((u - breaks[lo]) / (breaks[hi] - breaks[lo])),
        t2 = t * t,
        t3 = t2 * t,
        a = points[lo],
        b = points[(lo + 1) % n],
        da = V.mul(derivatives[lo], lengths[lo]),
        db = V.mul(derivatives[(lo + 1) % n], lengths[lo]);
      return a.map(
        (v, k) => (2 * t3 - 3 * t2 + 1) * v + (t3 - 2 * t2 + t) * da[k] + (-2 * t3 + 3 * t2) * b[k] + (t3 - t2) * db[k]
      );
    }
    let result;
    if (options.adaptive !== undefined) {
      check(
        fields(options.adaptive, ['tolerance', 'angle', 'minSegments', 'maxSegments', 'maxDepth', 'maxSegmentLength']),
        'invalid interpolation adaptive settings'
      );
      result = adaptive({ evaluate, closed: path.closed, breaks }, { ...options.adaptive, up: path.snapshot().up });
    } else {
      const parameters = [];
      for (let i = 0; i < spans; i++)
        for (let j = 0; j < segmentsPerSpan; j++)
          parameters.push(breaks[i] + ((breaks[i + 1] - breaks[i]) * j) / segmentsPerSpan);
      parameters.push(1);
      const retained = [];
      for (const u of parameters) {
        const p = evaluate(u);
        if (!retained.length || V.dist(p, retained.at(-1).p) > 1e-12) retained.push({ u, p });
      }
      const sampled = C.path(
        retained.map(v => v.p),
        { closed: path.closed, up: path.snapshot().up }
      );
      check(sampled.points.length === retained.length, 'interpolation samples collapsed at closed seam');
      result = {
        ...sampled,
        parameters: retained.map(v => v.u),
        evaluate,
        breaks,
        sampling: { mode: 'uniform-span', segments: retained.length - 1, limited: false }
      };
    }
    const saved = {
      ...options,
      closed: path.closed,
      up: path.snapshot().up,
      ...(options.adaptive && { adaptive: { ...options.adaptive } })
    };
    const api = freeze({
      ...result,
      closest(point) {
        return closest(api, point);
      },
      curvature(distance, settings) {
        return curvature(api, distance, settings);
      },
      type: 'interpolated',
      snapshot: () => ({
        points: points.map(p => p.slice()),
        options: {
          ...saved,
          up: saved.up.slice(),
          ...(saved.adaptive && { adaptive: { ...saved.adaptive } })
        }
      })
    });
    return api;
  }
  Object.assign(C, { closest, curvature, adaptive, interpolate });
})(KIT);
