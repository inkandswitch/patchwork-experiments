/* Parametric curve families with the existing point-array and route-path contracts. */
(function (K) {
  const C = K.curve,
    V = K.V,
    M = K.M,
    freeze = K.procedural.data.freeze,
    clone = K.procedural.data.clone,
    TAU = 2 * Math.PI;
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Curve: ' + message);
  };
  const record = v =>
    v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const fields = (v, names) => record(v) && Object.keys(v).every(k => names.includes(k));
  const array = v => Array.isArray(v) || (ArrayBuffer.isView(v) && typeof v.length === 'number');
  const xyz = v => array(v) && v.length === 3 && Array.from(v).every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
  const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const json = value =>
    array(value)
      ? Array.from(value, json)
      : record(value)
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, json(v)]))
        : value;
  const common = ['type', 'origin', 'axis', 'right', 'scale', 'segments', 'adaptive'];
  const compiled = new WeakSet();
  function frame(options) {
    const { origin = [0, 0, 0], axis = [0, 1, 0], right, scale = 1 } = options;
    check(xyz(origin) && xyz(axis) && V.len(axis) > 1e-9 && range(scale, 1e-6, 1e6), 'invalid origin, axis or scale');
    const N = V.norm(axis),
      source = right ?? (Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
    check(xyz(source), 'invalid in-plane right axis');
    const U = V.sub(source, V.mul(N, V.dot(source, N)));
    check(V.len(U) > 1e-9, 'right axis must not be parallel to the curve axis');
    const X = V.norm(U),
      Y = V.cross(N, X);
    return p => origin.map((v, k) => v + scale * (X[k] * p[0] + Y[k] * p[1] + N[k] * p[2]));
  }
  const gcd = (a, b) => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  };
  const nodes = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664];
  const weights = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];
  function clothoidModel(def) {
    check(
      fields(def, [...common, 'length', 'heading', 'startCurvature', 'endCurvature', 'sections']),
      'invalid clothoid settings'
    );
    const { heading = 0, startCurvature = 0 } = def;
    check(range(heading, -TAU * 100, TAU * 100) && range(startCurvature, -1e6, 1e6), 'invalid heading or curvature');
    if (def.sections !== undefined)
      check(def.length === undefined && def.endCurvature === undefined, 'sections replace length and endCurvature');
    const input = def.sections ?? [{ length: def.length ?? 5, curvature: def.endCurvature ?? 0.6 }];
    check(Array.isArray(input) && input.length >= 1 && input.length <= 128, 'clothoid needs 1–128 sections');
    let length = 0,
      angle = heading,
      curvature = startCurvature,
      turnBudget = 0,
      position = [0, 0];
    function integrate(section, s) {
      const parts = Math.max(
          1,
          Math.ceil((s * Math.max(Math.abs(section.k), Math.abs(section.k + section.rate * s))) / 0.35)
        ),
        out = [0, 0];
      for (let j = 0; j < parts; j++) {
        const mid = ((j + 0.5) * s) / parts,
          half = s / (parts * 2);
        for (let k = 0; k < 5; k++) {
          const t = mid + nodes[k] * half,
            theta = section.angle + section.k * t + 0.5 * section.rate * t * t;
          out[0] += weights[k] * half * Math.cos(theta);
          out[1] += weights[k] * half * Math.sin(theta);
        }
      }
      return out;
    }
    const sections = input.map(row => {
      check(
        fields(row, ['length', 'curvature']) && range(row.length, 1e-6, 1e6) && range(row.curvature, -1e6, 1e6),
        'invalid clothoid section'
      );
      turnBudget += row.length * Math.max(Math.abs(curvature), Math.abs(row.curvature));
      check(turnBudget <= TAU * 256, 'clothoid turn budget exceeded');
      const section = {
        start: length,
        length: row.length,
        k: curvature,
        rate: (row.curvature - curvature) / row.length,
        angle,
        position: position.slice()
      };
      const delta = integrate(section, row.length);
      position = position.map((v, i) => v + delta[i]);
      angle += ((curvature + row.curvature) * row.length) / 2;
      curvature = row.curvature;
      length += row.length;
      return section;
    });
    return {
      closed: false,
      breaks: [0, ...sections.map(s => (s.start + s.length) / length)],
      minSegments: 8,
      defaultSegments: Math.max(96, Math.ceil(turnBudget * 16)),
      point(t) {
        const s = t * length;
        let section = sections.at(-1);
        for (const p of sections)
          if (s <= p.start + p.length) {
            section = p;
            break;
          }
        const delta = integrate(section, clamp(s - section.start, 0, section.length));
        return [section.position[0] + delta[0], section.position[1] + delta[1], 0];
      },
      properties: {
        arcLength: length,
        headingStart: heading,
        headingEnd: angle,
        startCurvature,
        endCurvature: curvature
      }
    };
  }
  const phaseOK = angle => range(angle, -TAU * 100, TAU * 100);
  const turnsOK = turns => range(turns, -32, 32) && turns !== 0;
  const segmentsFor = turns => ({
    minSegments: Math.max(8, Math.ceil(Math.abs(turns) * 8)),
    defaultSegments: Math.max(8, Math.ceil(Math.abs(turns) * 64))
  });
  function spiralModel(def) {
    check(fields(def, [...common, 'startRadius', 'endRadius', 'turns', 'phase', 'height']), 'invalid spiral settings');
    const { startRadius: a = 0, endRadius: b = 2, turns = 2.5, phase = 0, height = 0 } = def;
    check(range(a, 0, 1e6) && range(b, 0, 1e6) && a !== b &&
      turnsOK(turns) && phaseOK(phase) && range(height, -1e6, 1e6), 'invalid spiral dimensions');
    const radiusAt = def.type === 'fermatSpiral'
      ? t => Math.hypot(a * Math.sqrt(1 - t), b * Math.sqrt(t))
      : t => a * (1 - t) + b * t;
    return {
      closed: false, ...segmentsFor(turns),
      point(t) {
        const r = radiusAt(t), theta = phase + TAU * turns * t;
        return [r * Math.cos(theta), r * Math.sin(theta), height * t];
      }
    };
  }

  function cuspBreaks(initial, turns) {
    const start = initial / TAU, end = start + turns;
    const breaks = [0];
    for (let n = Math.ceil(Math.min(start, end)); n <= Math.floor(Math.max(start, end)); n++) {
      const t = (n - start) / turns;
      if (t > 1e-12 && t < 1 - 1e-12) breaks.push(t);
    }
    return breaks.sort((a, b) => a - b).concat(1);
  }

  function cycloidModel(def) {
    check(fields(def, [...common, 'radius', 'penRadius', 'turns', 'phase']), 'invalid cycloid settings');
    const { radius = .55, penRadius = radius, turns = 3, phase = 0 } = def;
    check(range(radius, 1e-6, 1e6) && range(penRadius, 0, 1e6) && turnsOK(turns) && phaseOK(phase),
      'invalid cycloid radius, pen radius, turns or phase');
    return {
      closed: false, ...segmentsFor(turns),
      cusps: penRadius === radius ? cuspBreaks(phase, turns) : undefined,
      point(t) {
        const advance = TAU * turns * t, angle = phase + advance;
        return [radius * advance - penRadius * Math.sin(angle), radius - penRadius * Math.cos(angle), 0];
      }
    };
  }

  function trochoidModel(def) {
    check(fields(def, [...common, 'fixedRadius', 'fixedTeeth', 'rollingTeeth', 'pen', 'phase', 'penPhase']),
      'invalid spirograph settings');
    const { fixedRadius = 1.8, fixedTeeth = 7, rollingTeeth = 3, pen = .8, phase = 0, penPhase = 0 } = def;
    const inside = def.type === 'hypotrochoid';
    const teeth = n => Number.isSafeInteger(n) && range(n, 1, 32);
    check(teeth(fixedTeeth) && teeth(rollingTeeth) && (!inside || rollingTeeth < fixedTeeth),
      'gears need 1–32 teeth and an inside gear must fit the fixed circle');
    check(range(fixedRadius, 1e-6, 1e6) && range(pen, 0, 4) && phaseOK(phase) && phaseOK(penPhase),
      'invalid spirograph radius, pen offset or phase');
    const divisor = gcd(fixedTeeth, rollingTeeth), p = fixedTeeth / divisor, q = rollingTeeth / divisor;
    const side = inside ? -1 : 1, r = fixedRadius * q / p, center = fixedRadius + side * r;
    const baseTurns = pen === 0 ? 1 : q, penTurns = q + side * p, offset = -side * pen * r;
    return {
      closed: true, ...segmentsFor(pen === 0 ? 1 : Math.max(q, Math.abs(penTurns))),
      cusps: pen === 1 ? cuspBreaks(penPhase, side * p) : undefined,
      point(t) {
        const a = phase + TAU * baseTurns * t, b = phase + penPhase + TAU * penTurns * t;
        return [center * Math.cos(a) + offset * Math.cos(b), center * Math.sin(a) + offset * Math.sin(b), 0];
      }
    };
  }

  function model(def) {
    if (def.type === 'clothoid') return clothoidModel(def);
    if (def.type === 'archimedeanSpiral' || def.type === 'fermatSpiral') return spiralModel(def);
    if (def.type === 'cycloid') return cycloidModel(def);
    if (def.type === 'epitrochoid' || def.type === 'hypotrochoid') return trochoidModel(def);
    if (def.type === 'torusKnot') {
      check(fields(def, [...common, 'p', 'q', 'majorRadius', 'minorRadius', 'phase']), 'invalid torus-knot settings');
      const { p = 2, q = 3, majorRadius: R = 1.6, minorRadius: r = 0.55, phase = 0 } = def;
      check(
        Number.isSafeInteger(p) &&
          Number.isSafeInteger(q) &&
          Math.abs(p) >= 1 &&
          Math.abs(q) >= 1 &&
          Math.abs(p) <= 32 &&
          Math.abs(q) <= 32 &&
          gcd(p, q) === 1,
        'torus knot p/q must be nonzero coprime integers up to 32'
      );
      check(
        range(R, 1e-6, 1e6) && range(r, 1e-6, R) && r < R && range(phase, -TAU * 100, TAU * 100),
        'invalid torus radii or phase'
      );
      const f = Math.max(Math.abs(p), Math.abs(q));
      return {
        closed: true,
        minSegments: Math.max(12, f * 8),
        defaultSegments: f * 64,
        point(t) {
          const a = t * TAU + phase,
            rad = R + r * Math.cos(q * a);
          return [rad * Math.cos(p * a), rad * Math.sin(p * a), r * Math.sin(q * a)];
        }
      };
    }
    if (def.type === 'lissajous') {
      check(fields(def, [...common, 'amplitude', 'frequency', 'phase']), 'invalid Lissajous settings');
      const { amplitude = [1.6, 1.2, 0.7], frequency = [3, 2, 1], phase = [Math.PI / 2, 0, 0] } = def;
      check(
        xyz(amplitude) &&
          Array.from(amplitude).every(v => v >= 0) &&
          Array.from(amplitude).some(v => v > 0) &&
          xyz(frequency) &&
          Array.from(frequency).every(v => Number.isSafeInteger(v) && v >= 1 && v <= 32) &&
          xyz(phase) &&
          Array.from(phase).every(v => Math.abs(v) <= TAU * 100),
        'invalid Lissajous amplitudes, frequencies or phases'
      );
      const active = Array.from(frequency).filter((_, i) => amplitude[i] > 0),
        divisor = active.reduce(gcd),
        f = Math.max(...active) / divisor;
      return {
        closed: true,
        minSegments: Math.max(12, f * 8),
        defaultSegments: f * 64,
        point(t) {
          return Array.from(amplitude, (v, i) => v * Math.sin((frequency[i] * TAU * t) / divisor + phase[i]));
        }
      };
    }
    if (def.type === 'logSpiral') {
      check(
        fields(def, [...common, 'startRadius', 'endRadius', 'turns', 'phase', 'height']),
        'invalid logarithmic spiral settings'
      );
      const { startRadius: a = 0.12, endRadius: b = 2, turns = 2.5, phase = 0, height = 0 } = def;
      check(
        range(a, 1e-6, 1e6) &&
          range(b, 1e-6, 1e6) &&
          range(turns, -32, 32) &&
          turns !== 0 &&
          range(phase, -TAU * 100, TAU * 100) &&
          range(height, -1e6, 1e6),
        'invalid logarithmic spiral dimensions'
      );
      return {
        closed: false,
        minSegments: Math.max(8, Math.ceil(Math.abs(turns) * 8)),
        defaultSegments: Math.max(8, Math.ceil(Math.abs(turns) * 64)),
        point(t) {
          const r = Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t),
            theta = phase + TAU * turns * t;
          return [r * Math.cos(theta), r * Math.sin(theta), height * t];
        }
      };
    }
    if (def.type === 'superellipse') {
      check(fields(def, [...common, 'radii', 'exponent', 'phase']), 'invalid superellipse settings');
      const { radii = [1.8, 1.2], exponent = 4, phase = 0 } = def;
      check(
        array(radii) &&
          radii.length === 2 &&
          Array.from(radii).every(v => range(v, 1e-6, 1e6)) &&
          range(exponent, 0.25, 16) &&
          range(phase, -TAU * 100, TAU * 100),
        'invalid superellipse dimensions'
      );
      const signed = v => (Math.abs(v) < 1e-14 ? 0 : Math.sign(v) * Math.abs(v) ** (2 / exponent));
      return {
        closed: true,
        minSegments: 16,
        defaultSegments: 192,
        point(t) {
          const a = TAU * t + phase;
          return [radii[0] * signed(Math.cos(a)), radii[1] * signed(Math.sin(a)), 0];
        }
      };
    }
    if (def.type === 'flower') {
      check(fields(def, [...common, 'petals', 'radius', 'depth', 'height', 'phase']), 'invalid flower settings');
      const { petals = 7, radius = 1.5, depth = 0.38, height = 0.22, phase = 0 } = def;
      check(
        Number.isSafeInteger(petals) &&
          petals >= 1 &&
          petals <= 32 &&
          range(radius, 1e-6, 1e6) &&
          range(depth, 0, 0.95) &&
          range(height, -1e6, 1e6) &&
          range(phase, -TAU * 100, TAU * 100),
        'invalid flower dimensions'
      );
      return {
        closed: true,
        minSegments: Math.max(16, petals * 8),
        defaultSegments: petals * 32,
        point(t) {
          const a = t * TAU,
            r = radius * (1 + depth * Math.cos(petals * a + phase));
          return [r * Math.cos(a), r * Math.sin(a), height * Math.sin(petals * a + phase)];
        }
      };
    }
    throw new TypeError('Curve: unknown family ' + def.type);
  }
  const isPath = input =>
    compiled.has(input) ||
    (input &&
      Object.isFrozen(input) &&
      Object.isFrozen(input.points) &&
      Array.isArray(input.points) &&
      input.points.length >= 2 &&
      input.points.length <= 4097 &&
      typeof input.closed === 'boolean' &&
      Number.isFinite(input.length) &&
      input.length > 0 &&
      typeof input.at === 'function' &&
      typeof input.frame === 'function');
  function path(input, options = {}) {
    if (isPath(input))
      return Object.keys(options).length ? path(input.points, { closed: input.closed, ...options }) : input;
    check(fields(options, ['closed', 'up']), 'invalid path options');
    check(
      Array.isArray(input) && input.length >= 2 && input.length <= 4097 && Array.from(input).every(xyz),
      'path needs 2–4097 finite XYZ points'
    );
    const points = [];
    for (const p of input) if (!points.length || V.dist(p, points.at(-1)) > 1e-12) points.push(Array.from(p));
    let closed = options.closed ?? (points.length > 3 && V.dist(points[0], points.at(-1)) < 1e-8);
    check(typeof closed === 'boolean', 'closed must be boolean');
    if (closed) {
      if (V.dist(points[0], points.at(-1)) < 1e-8) points.pop();
      check(points.length >= 3, 'closed paths need three distinct samples');
      points.push(points[0].slice());
    }
    check(points.length <= 4097, 'closed path exceeds 4096 segments');
    check(points.length >= 2, 'curve sampling collapsed; increase segments or change parameters');
    const up = options.up === undefined ? [0, 1, 0] : Array.from(options.up ?? []);
    check(xyz(up) && V.len(up) > 1e-9, 'invalid frame up vector');
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + V.dist(points[i], points[i - 1]));
    const length = lengths.at(-1);
    check(Number.isFinite(length) && length > 1e-12, 'path must have positive finite length');
    let frames, rotations;
    const locate = distance => {
      check(Number.isFinite(distance), 'distance must be finite');
      const d = closed ? ((distance % length) + length) % length : clamp(distance, 0, length);
      let lo = 0,
        hi = lengths.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (lengths[mid] <= d) lo = mid;
        else hi = mid;
      }
      return { lo, hi, t: (d - lengths[lo]) / (lengths[hi] - lengths[lo]), d };
    };
    const at = distance => {
      const { lo, hi, t } = locate(distance);
      return { p: V.lerp(points[lo], points[hi], t), tan: V.norm(V.sub(points[hi], points[lo])) };
    };
    const frameAt = distance => {
      frames ??= C.frames(points, up);
      const { lo, hi, t, d } = locate(distance),
        p = V.lerp(points[lo], points[hi], t);
      rotations ??= frames.map(f => K.Q.fromMatrix(M.cols(f.T, f.N, f.B)));
      const rotation = K.Q.slerp(rotations[lo], rotations[hi], t),
        matrix = K.Q.toMatrix(rotation),
        T = [matrix[0], matrix[3], matrix[6]],
        N = [matrix[1], matrix[4], matrix[7]],
        B = [matrix[2], matrix[5], matrix[8]];
      return { p, T, N, B, rotation, t: d / length, matrix };
    };
    const api = freeze({
      points,
      closed,
      length,
      at,
      frame: frameAt,
      closest(point) {
        return C.closest(api, point);
      },
      curvature(distance, options) {
        return C.curvature(api, distance, options);
      },
      sample(u) {
        check(Number.isFinite(u), 'sample coordinate must be finite');
        return at(clamp(u) * length).p;
      },
      snapshot: () => ({ points: points.map(p => p.slice()), closed, up: up.slice() })
    });
    compiled.add(api);
    return api;
  }
  function uniformParameters(segments, cusps) {
    if (!cusps || cusps.length === 2) return Array.from({ length: segments + 1 }, (_, i) => i / segments);
    const parameters = [0];
    let used = 0;
    for (let i = 1; i < cusps.length; i++) {
      const a = cusps[i - 1], b = cusps[i];
      // Keep every cusp and reserve at least one segment for each remaining span.
      const end = Math.min(segments - (cusps.length - 1 - i), Math.max(used + 1, Math.round(b * segments)));
      const size = end - used;
      for (let j = 1; j < size; j++) parameters.push(a + (b - a) * j / size);
      parameters.push(b);
      used = end;
    }
    return parameters;
  }
  function create(definition) {
    if (isPath(definition)) return definition;
    check(record(definition), 'expected a curve family definition');
    const def = clone(json(definition));
    if (RecursiveCurves.families.includes(def.type)) return RecursiveCurves.compile(def, frame).level();
    const m = model(def),
      transform = frame(def),
      segments = def.segments ?? Math.min(4096, m.defaultSegments);
    check(
      Number.isSafeInteger(segments) && segments >= m.minSegments && segments <= 4096,
      'segments must be ' + m.minSegments + '–4096 for this family'
    );
    const evaluate = u => transform(m.point(m.closed && u === 1 ? 0 : u));
    if (def.adaptive !== undefined)
      check(
        fields(def.adaptive, ['tolerance', 'angle', 'minSegments', 'maxSegments', 'maxDepth', 'maxSegmentLength']),
        'invalid adaptive family settings'
      );
    if (def.adaptive?.minSegments !== undefined)
      check(def.adaptive.minSegments >= m.minSegments, 'adaptive minimum is below family frequency floor');
    const breaks = m.cusps ?? m.breaks ?? [0, 1];
    const sampled =
      def.adaptive === undefined
        ? null
        : C.adaptive(
            { evaluate, closed: m.closed, breaks },
            { ...def.adaptive, minSegments: def.adaptive.minSegments ?? m.minSegments }
          );
    const sourceParameters = sampled?.parameters ?? uniformParameters(segments, m.cusps);
    const points = sampled ? sampled.points.map(p => p.slice()) : sourceParameters.map(evaluate);
    if (m.closed) points[points.length - 1] = points[0].slice();
    check(points.every(xyz), 'curve coordinates exceed the finite world range');
    const rail = path(points, { closed: m.closed }),
      parameters = [];
    let previous;
    for (let i = 0; i < points.length; i++)
      if (!previous || V.dist(points[i], previous) > 1e-12) {
        parameters.push(sourceParameters[i]);
        previous = points[i];
      }
    check(parameters.length === rail.points.length, 'sampling parameters must match retained points');
    if (m.closed) parameters[parameters.length - 1] = 1;
    const api = freeze({
      ...rail,
      type: def.type,
      parameters,
      breaks,
      sampling: sampled?.sampling ?? { mode: 'uniform', segments: rail.points.length - 1, limited: false },
      closest(point) {
        return C.closest(api, point);
      },
      curvature(distance, options) {
        return C.curvature(api, distance, options);
      },
      properties: m.properties
        ? {
            ...m.properties,
            arcLength: m.properties.arcLength * (def.scale ?? 1),
            startCurvature: m.properties.startCurvature / (def.scale ?? 1),
            endCurvature: m.properties.endCurvature / (def.scale ?? 1)
          }
        : {},
      evaluate(u) {
        check(Number.isFinite(u), 'parameter must be finite');
        return transform(m.point(m.closed && clamp(u) === 1 ? 0 : clamp(u)));
      },
      snapshot: () => clone(def)
    });
    compiled.add(api);
    return api;
  }
  function drawOnPath(input, drawing, options = {}) {
    const rail = compiled.has(input) ? input : path(input),
      { offset, align = 'center', fit = false, lift = 0, wrap = rail.closed, maxStep = 0.05 } = options;
    check(
      fields(options, ['offset', 'align', 'fit', 'lift', 'wrap', 'maxStep']) &&
        ['start', 'center', 'end'].includes(align) &&
        typeof fit === 'boolean' &&
        typeof wrap === 'boolean' &&
        (!wrap || rail.closed) &&
        Number.isFinite(lift) &&
        range(maxStep, 1e-5, 1e3),
      'invalid curve drawing settings'
    );
    check(
      drawing &&
        Array.isArray(drawing.strokes) &&
        drawing.strokes.length <= 8192 &&
        (drawing.width === undefined || range(drawing.width, 1e-5, 1e3)),
      'drawing needs bounded strokes'
    );
    const all = drawing.strokes.flat();
    check(
      all.length <= 32768 &&
        all.every(
          p => array(p) && p.length === 2 && Array.from(p).every(v => Number.isFinite(v) && Math.abs(v) <= 1e9)
        ),
      'drawing needs finite XY points'
    );
    if (!all.length) return { strokes: [], width: drawing.width ?? 0.01, extent: 0 };
    const low = Math.min(...all.map(p => p[0])),
      high = Math.max(...all.map(p => p[0])),
      extent = high - low,
      scale = fit && extent > rail.length ? rail.length / extent : 1;
    const anchor = offset ?? (align === 'start' ? 0 : align === 'end' ? rail.length : rail.length / 2);
    check(Number.isFinite(anchor), 'invalid drawing offset');
    const start = anchor - (align === 'center' ? (extent * scale) / 2 : align === 'end' ? extent * scale : 0);
    check(
      wrap || (start >= -1e-9 && start + extent * scale <= rail.length + 1e-9),
      'drawing exceeds open path; reduce size or change offset'
    );
    let budget = 0;
    const strokes = drawing.strokes.map(line => {
      const dense = [];
      for (let i = 0; i < line.length; i++) {
        const p = line[i],
          a = line[Math.max(0, i - 1)],
          count = i ? Math.max(1, Math.ceil((Math.hypot(p[0] - a[0], p[1] - a[1]) * scale) / maxStep)) : 1;
        budget += count;
        check(budget <= 65536, 'curve drawing point budget exceeded');
        for (let j = 1; j <= count; j++) {
          const u = i ? j / count : 1;
          dense.push([a[0] + (p[0] - a[0]) * u, a[1] + (p[1] - a[1]) * u]);
        }
      }
      return dense.map(([x, y]) => {
        const f = rail.frame(start + (x - low) * scale);
        return V.mad(f.p, f.N, y * scale + lift);
      });
    });
    return { strokes, width: (drawing.width ?? 0.01) * scale, extent: extent * scale };
  }
  function text(input, label, options = {}) {
    check(typeof label === 'string' && [...label].length <= 512, 'text needs at most 512 characters');
    check(
      fields(options, ['size', 'gap', 'width', 'offset', 'align', 'fit', 'lift', 'wrap', 'maxStep']),
      'invalid curve text settings'
    );
    const { size = 0.22, gap, width, ...layout } = options;
    check(
      range(size, 1e-4, 1e3) &&
        (gap === undefined || range(gap, 0, 1e3)) &&
        (width === undefined || range(width, 1e-5, 1e3)),
      'invalid text size or spacing'
    );
    return drawOnPath(
      input,
      K.poly2.text(label, size, { ...(gap !== undefined && { gap }), ...(width !== undefined && { width }) }),
      layout
    );
  }
  const recursive = definition => {
    check(record(definition), 'expected a recursive curve definition');
    return RecursiveCurves.compile(clone(json(definition)), frame);
  };
  Object.assign(C, { path, create, drawOnPath, text, recursive });
  for (const type of ['clothoid', 'torusKnot', 'lissajous', 'logSpiral', 'superellipse', 'flower',
    'archimedeanSpiral', 'fermatSpiral', 'cycloid', 'epitrochoid', 'hypotrochoid', 'koch', 'dragon', 'hilbert', 'peano'])
    C[type] = (options = {}) => {
      check(record(options), 'family options must be an object');
      return create({ ...options, type }).points;
    };
})(KIT);
