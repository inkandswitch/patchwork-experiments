/* Finite complex charts and bounded fixed-clock dynamics. No renderer or package dependencies. */
const MathFields = (() => {
  const TAU = Math.PI * 2,
    MAX = 1e9,
    planes = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [1, 2, 0] };
  const own = (o, k) => Object.hasOwn(o, k),
    plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function record(v, keys, name) {
    if (!plain(v) || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError('Math fields: invalid ' + name);
  }
  function number(v, a = -MAX, b = MAX, name = 'number') {
    if (!Number.isFinite(v) || v < a || v > b) throw new RangeError('Math fields: invalid ' + name);
    return v;
  }
  function integer(v, a, b, name) {
    number(v, a, b, name);
    if (!Number.isSafeInteger(v)) throw new RangeError('Math fields: ' + name + ' must be an integer');
    return v;
  }
  function vector(v, n, name = 'vector') {
    if (!(Array.isArray(v) || ArrayBuffer.isView(v)) || v.length !== n)
      throw new TypeError('Math fields: expected ' + n + 'D ' + name);
    return Array.from(v, x => number(x));
  }
  function freeze(v) {
    if (v && typeof v === 'object') {
      for (const q of Object.values(v)) freeze(q);
      Object.freeze(v);
    }
    return v;
  }
  const branch = (angle, cut) => cut + ((((angle - cut) % TAU) + TAU) % TAU);
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const divide = (a, b) => {
    const r = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / r, (a[1] * b[0] - a[0] * b[1]) / r];
  };
  const opFields = {
    affine: ['scale', 'offset', 'rotate', 'velocity', 'spin'],
    mobius: ['a', 'b', 'c', 'd'],
    power: ['exponent'],
    reciprocal: [],
    exp: [],
    log: [],
    sin: [],
    conjugate: [],
    polar: ['logRadius'],
    cartesian: ['logRadius'],
    spiral: ['twist']
  };
  function operation(raw) {
    if (!own(opFields, raw?.type)) throw new TypeError('Math fields: unknown chart operation');
    record(raw, ['type', ...opFields[raw.type]], 'chart operation');
    const o = { ...raw };
    if (o.type === 'affine') {
      o.scale = vector(o.scale ?? [1, 1], 2);
      o.offset = vector(o.offset ?? [0, 0], 2);
      o.velocity = vector(o.velocity ?? [0, 0], 2);
      o.rotate = number(o.rotate ?? 0);
      o.spin = number(o.spin ?? 0, -1e4, 1e4);
    }
    if (o.type === 'mobius') {
      for (const [key, value] of Object.entries({ a: [1, 0], b: [0, 0], c: [0, 0], d: [1, 0] }))
        o[key] = vector(o[key] ?? value, 2);
      const norm = Math.max(...['a', 'b', 'c', 'd'].map(key => Math.hypot(...o[key])));
      if (!norm) throw new RangeError('Math fields: degenerate Mobius transform');
      for (const key of ['a', 'b', 'c', 'd']) o[key] = o[key].map(n => n / norm);
      const a = mul(o.a, o.d),
        b = mul(o.b, o.c);
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-12)
        throw new RangeError('Math fields: degenerate Mobius transform');
    }
    if (o.type === 'power') o.exponent = number(o.exponent ?? 2, -16, 16, 'power exponent');
    if (o.type === 'polar' || o.type === 'cartesian') {
      o.logRadius ??= false;
      if (typeof o.logRadius !== 'boolean') throw new TypeError('Math fields: logRadius must be boolean');
    }
    if (o.type === 'spiral') o.twist = number(o.twist ?? 1, -64, 64, 'spiral twist');
    return o;
  }
  function mapping(spec = {}) {
    record(
      spec,
      ['plane', 'origin', 'scale', 'outputScale', 'steps', 'epsilon', 'limit', 'maxOperations', 'singularity', 'cut'],
      'coordinate mapping'
    );
    const {
      plane = 'xy',
      epsilon = 1e-6,
      limit = 1e4,
      maxOperations = 128,
      singularity = 'identity',
      cut = -Math.PI
    } = spec;
    if (!own(planes, plane) || !['identity', 'zero'].includes(singularity))
      throw new TypeError('Math fields: invalid plane or singularity policy');
    number(epsilon, 1e-12, 1, 'epsilon');
    number(limit, 1, 1e7, 'chart limit');
    integer(maxOperations, 1, 4096, 'operation budget');
    number(cut, -TAU, TAU, 'branch cut');
    const origin = vector(spec.origin ?? [0, 0, 0], 3),
      scale = vector(spec.scale ?? [1, 1], 2),
      outputScale = vector(spec.outputScale ?? scale, 2);
    if ([...scale, ...outputScale].some(n => Math.abs(n) < 1e-8 || Math.abs(n) > 1e4))
      throw new RangeError('Math fields: chart scales need magnitudes in [1e-8, 1e4]');
    if (!Array.isArray(spec.steps ?? []) || (spec.steps ?? []).length > 32)
      throw new RangeError('Math fields: at most 32 chart operations');
    const steps = (spec.steps ?? []).map(operation),
      cost = steps.reduce(
        (sum, o) =>
          sum + ({ mobius: 8, power: 6, exp: 4, log: 4, sin: 6, polar: 4, cartesian: 4, spiral: 8 }[o.type] ?? 2),
        1
      );
    if (cost > maxOperations) throw new RangeError('Math fields: coordinate mapping exceeds operation budget');
    const axes = planes[plane],
      definition = freeze({
        plane,
        origin,
        scale,
        outputScale,
        steps,
        epsilon,
        limit,
        maxOperations,
        singularity,
        cut
      });
    function run(x, y, z, time, out, jet) {
      [x, y, z, time].forEach(n => number(n));
      const p = [x, y, z],
        a = axes[0],
        b = axes[1];
      let u = (p[a] - origin[a]) / scale[0],
        v = (p[b] - origin[b]) / scale[1],
        j00 = 1,
        j01 = 0,
        j10 = 0,
        j11 = 1,
        tu = 0,
        tv = 0,
        singular = false,
        limited = false,
        seam = false;
      const firstU = u,
        firstV = v;
      for (const o of steps) {
        if (!Number.isFinite(u) || !Number.isFinite(v) || Math.max(Math.abs(u), Math.abs(v)) > limit) {
          limited = true;
          break;
        }
        let U = u,
          V = v,
          A = 1,
          B = 0,
          C = 0,
          D = 1,
          TU = 0,
          TV = 0;
        const r = Math.hypot(u, v),
          r2 = u * u + v * v,
          theta = branch(Math.atan2(v, u), cut);
        if (
          (['log', 'polar'].includes(o.type) || (o.type === 'power' && !Number.isInteger(o.exponent))) &&
          r > epsilon &&
          Math.min(theta - cut, cut + TAU - theta) < epsilon
        )
          seam = true;
        switch (o.type) {
          case 'affine': {
            const angle = o.rotate + o.spin * time,
              c = Math.cos(angle),
              s = Math.sin(angle),
              xx = u * o.scale[0],
              yy = v * o.scale[1];
            U = c * xx - s * yy + o.offset[0] + o.velocity[0] * time;
            V = s * xx + c * yy + o.offset[1] + o.velocity[1] * time;
            A = c * o.scale[0];
            B = -s * o.scale[1];
            C = s * o.scale[0];
            D = c * o.scale[1];
            TU = -o.spin * (s * xx + c * yy) + o.velocity[0];
            TV = o.spin * (c * xx - s * yy) + o.velocity[1];
            break;
          }
          case 'mobius': {
            const den = mul(o.c, [u, v]).map((n, i) => n + o.d[i]);
            if (Math.hypot(...den) < epsilon) {
              singular = true;
              break;
            }
            const num = mul(o.a, [u, v]).map((n, i) => n + o.b[i]),
              q = divide(num, den),
              ad = mul(o.a, o.d),
              bc = mul(o.b, o.c),
              derivative = divide(
                ad.map((n, i) => n - bc[i]),
                mul(den, den)
              );
            [U, V] = q;
            A = D = derivative[0];
            C = derivative[1];
            B = -C;
            break;
          }
          case 'reciprocal': {
            if (r < epsilon) {
              singular = true;
              break;
            }
            U = u / r2;
            V = -v / r2;
            A = D = (v * v - u * u) / (r2 * r2);
            C = (2 * u * v) / (r2 * r2);
            B = -C;
            break;
          }
          case 'power': {
            const n = o.exponent;
            if (r < epsilon) {
              if (n === 0) {
                U = 1;
                V = 0;
                A = B = C = D = 0;
              } else if (n === 1) {
              } else if (n > 1) {
                U = V = A = B = C = D = 0;
              } else singular = true;
              break;
            }
            const length = r ** n,
              phase = n * theta,
              d = n * r ** (n - 1);
            U = length * Math.cos(phase);
            V = length * Math.sin(phase);
            A = D = d * Math.cos((n - 1) * theta);
            C = d * Math.sin((n - 1) * theta);
            B = -C;
            break;
          }
          case 'exp': {
            const e = Math.exp(Math.min(700, u));
            U = e * Math.cos(v);
            V = e * Math.sin(v);
            A = D = U;
            C = V;
            B = -C;
            break;
          }
          case 'log': {
            if (r < epsilon) {
              singular = true;
              break;
            }
            U = Math.log(r);
            V = theta;
            A = D = u / r2;
            C = -v / r2;
            B = -C;
            break;
          }
          case 'sin': {
            const sh = Math.sinh(clamp(v, -700, 700)),
              ch = Math.cosh(clamp(v, -700, 700));
            U = Math.sin(u) * ch;
            V = Math.cos(u) * sh;
            A = D = Math.cos(u) * ch;
            C = -Math.sin(u) * sh;
            B = -C;
            break;
          }
          case 'conjugate':
            V = -v;
            D = -1;
            break;
          case 'polar': {
            if (r < epsilon) {
              singular = true;
              break;
            }
            U = o.logRadius ? Math.log(r) : r;
            V = theta;
            A = u / (o.logRadius ? r2 : r);
            B = v / (o.logRadius ? r2 : r);
            C = -v / r2;
            D = u / r2;
            break;
          }
          case 'cartesian': {
            const rr = o.logRadius ? Math.exp(Math.min(u, 700)) : u,
              c = Math.cos(v),
              s = Math.sin(v);
            U = rr * c;
            V = rr * s;
            A = o.logRadius ? U : c;
            B = -V;
            C = o.logRadius ? V : s;
            D = U;
            break;
          }
          case 'spiral': {
            if (r < epsilon) {
              if (o.twist) singular = true;
              break;
            }
            const k = o.twist,
              angle = k * Math.log(r),
              c = Math.cos(angle),
              s = Math.sin(angle);
            U = c * u - s * v;
            V = s * u + c * v;
            A = c - (k * V * u) / r2;
            B = -s - (k * V * v) / r2;
            C = s + (k * U * u) / r2;
            D = c + (k * U * v) / r2;
            break;
          }
        }
        if (singular) break;
        if (jet) {
          const aa = A * j00 + B * j10,
            bb = A * j01 + B * j11,
            cc = C * j00 + D * j10,
            dd = C * j01 + D * j11,
            tt = A * tu + B * tv + TU;
          tv = C * tu + D * tv + TV;
          tu = tt;
          j00 = aa;
          j01 = bb;
          j10 = cc;
          j11 = dd;
        }
        u = U;
        v = V;
      }
      if (!Number.isFinite(u) || !Number.isFinite(v) || Math.max(Math.abs(u), Math.abs(v)) > limit) limited = true;
      if (singular) {
        u = singularity === 'identity' ? firstU : 0;
        v = singularity === 'identity' ? firstV : 0;
      }
      if (limited || singular) {
        u = clamp(Number.isNaN(u) ? 0 : u, -limit, limit);
        v = clamp(Number.isNaN(v) ? 0 : v, -limit, limit);
        j00 = j01 = j10 = j11 = tu = tv = 0;
      }
      const q = out.point ?? (out.point = [0, 0, 0]);
      q[0] = x;
      q[1] = y;
      q[2] = z;
      q[a] = origin[a] + u * outputScale[0];
      q[b] = origin[b] + v * outputScale[1];
      for (let i = 0; i < 3; i++)
        if (!Number.isFinite(q[i]) || Math.abs(q[i]) > MAX) {
          q[i] = clamp(Number.isNaN(q[i]) ? 0 : q[i], -MAX, MAX);
          limited = true;
        }
      out.valid = !singular && !limited;
      out.singular = singular;
      out.limited = limited;
      out.seam = seam;
      if (jet) {
        const J = out.jacobian ?? (out.jacobian = Array(9)),
          dt = out.dt ?? (out.dt = [0, 0, 0]);
        J.fill(0);
        dt.fill(0);
        J[axes[2] * 3 + axes[2]] = 1;
        J[a * 3 + a] = (j00 * outputScale[0]) / scale[0];
        J[a * 3 + b] = (j01 * outputScale[0]) / scale[1];
        J[b * 3 + a] = (j10 * outputScale[1]) / scale[0];
        J[b * 3 + b] = (j11 * outputScale[1]) / scale[1];
        dt[a] = tu * outputScale[0];
        dt[b] = tv * outputScale[1];
        if ([...J, ...dt].some(n => !Number.isFinite(n) || Math.abs(n) > MAX)) {
          out.valid = false;
          out.limited = true;
          J.fill(0);
          dt.fill(0);
        }
      }
      return out;
    }
    function map(x, y, z, time = 0, out) {
      return run(x, y, z, time, { point: out ?? [0, 0, 0] }, false).point;
    }
    map.sample = (x, y, z, time = 0) => run(x, y, z, time, {}, true);
    map.sampleInto = (out, x, y, z, time = 0) => {
      if (!out || typeof out !== 'object') throw new TypeError('Math fields: expected reusable sample storage');
      for (const [key, size] of [
        ['point', 3],
        ['jacobian', 9],
        ['dt', 3]
      ])
        if (
          out[key] !== undefined &&
          (!(Array.isArray(out[key]) || ArrayBuffer.isView(out[key])) || out[key].length !== size)
        )
          throw new TypeError('Math fields: invalid ' + key + ' output storage');
      return run(x, y, z, time, out, true);
    };
    map.spec = definition;
    map.cost = cost;
    map.deform = options => deformation(map, options);
    map.flow = options => flow(map, options);
    map.mask = options => mask(map, options);
    return Object.freeze(map);
  }

  function deformation(map, { amount = 1, maxDisplacement = 1, time = 0 } = {}) {
    if (typeof map !== 'function' || typeof map.sampleInto !== 'function')
      throw new TypeError('Math fields: expected a coordinate map');
    number(amount, -100, 100);
    number(maxDisplacement, 0, 1e5);
    number(time);
    const scratch = { point: [0, 0, 0] };
    const apply = p => {
      vector(p, 3);
      map.sampleInto(scratch, ...p, apply.time);
      if (!scratch.valid) return Array.from(p);
      const d = scratch.point.map((n, i) => (n - p[i]) * amount),
        length = Math.hypot(...d),
        k = length > maxDisplacement ? maxDisplacement / length : 1;
      return Array.from(p, (n, i) => n + d[i] * k);
    };
    apply.jacobian = p => {
      vector(p, 3);
      map.sampleInto(scratch, ...p, apply.time);
      const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      if (!scratch.valid) return identity;
      const d = scratch.point.map((n, i) => (n - p[i]) * amount),
        r2 = d.reduce((n, v) => n + v * v, 0),
        r = Math.sqrt(r2),
        J = scratch.jacobian.map((v, i) => amount * (v - identity[i]));
      if (r <= maxDisplacement) return J.map((v, i) => v + identity[i]);
      const s = maxDisplacement / r;
      return J.map(
        (v, i) =>
          identity[i] +
          s * (v - (d[Math.floor(i / 3)] * (d[0] * J[i % 3] + d[1] * J[3 + (i % 3)] + d[2] * J[6 + (i % 3)])) / r2)
      );
    };
    apply.time = time;
    return apply;
  }
  function flow(map, { gain = 1, maxSpeed = 1 } = {}) {
    if (typeof map !== 'function' || typeof map.sampleInto !== 'function')
      throw new TypeError('Math fields: expected a coordinate map');
    number(gain, -1e4, 1e4);
    number(maxSpeed, 0, 1e5);
    const scratch = { point: [0, 0, 0] };
    return (x, y, z, time = 0, out = [0, 0, 0]) => {
      map.sampleInto(scratch, x, y, z, time);
      const p = [x, y, z];
      for (let i = 0; i < 3; i++) out[i] = scratch.valid ? (scratch.point[i] - p[i]) * gain : 0;
      const length = Math.hypot(...out),
        k = length > maxSpeed ? maxSpeed / length : 1;
      for (let i = 0; i < 3; i++) out[i] *= k;
      return out;
    };
  }
  function mask(map, options = {}) {
    record(options, ['pattern', 'frequency', 'phase', 'rate', 'threshold', 'feather', 'invert'], 'math mask');
    const {
      pattern = 'bands',
      frequency = 1,
      phase = 0,
      rate = 0,
      threshold = 0.5,
      feather = 0.08,
      invert = false
    } = options;
    if (!['bands', 'checker', 'rings', 'angular'].includes(pattern) || typeof invert !== 'boolean')
      throw new TypeError('Math fields: invalid mask pattern');
    number(frequency, 1e-6, 1e4);
    number(phase);
    number(rate, -1e4, 1e4);
    number(threshold, 0, 1);
    number(feather, 0, 1);
    const axes = planes[map.spec.plane],
      scratch = { point: [0, 0, 0] };
    function sample(x, y, z, time = 0, jet = false) {
      map.sampleInto(scratch, x, y, z, time);
      if (!scratch.valid) return jet ? { value: 0, gradient: [0, 0, 0], dt: 0, valid: false } : 0;
      const a = axes[0],
        b = axes[1],
        u = (scratch.point[a] - map.spec.origin[a]) / map.spec.outputScale[0],
        v = (scratch.point[b] - map.spec.origin[b]) / map.spec.outputScale[1];
      let value,
        du = 0,
        dv = 0,
        dt = 0;
      const ph = phase + rate * time;
      if (pattern === 'checker') {
        const a = Math.PI * (u * frequency + ph),
          b = Math.PI * (v * frequency + ph),
          sa = Math.sin(a),
          sb = Math.sin(b),
          ca = Math.cos(a),
          cb = Math.cos(b);
        value = 0.5 + 0.5 * sa * sb;
        du = 0.5 * Math.PI * frequency * ca * sb;
        dv = 0.5 * Math.PI * frequency * sa * cb;
        dt = 0.5 * Math.PI * rate * (ca * sb + sa * cb);
      } else {
        const r = Math.hypot(u, v);
        let q = u,
          qu = 1,
          qv = 0;
        if (pattern === 'rings') {
          q = r;
          qu = r ? u / r : 0;
          qv = r ? v / r : 0;
        }
        if (pattern === 'angular') {
          q = Math.atan2(v, u) / TAU;
          qu = r ? -v / (TAU * r * r) : 0;
          qv = r ? u / (TAU * r * r) : 0;
        }
        const angle = TAU * (q * frequency + ph);
        value = 0.5 + 0.5 * Math.sin(angle);
        const derivative = 0.5 * TAU * Math.cos(angle);
        du = derivative * frequency * qu;
        dv = derivative * frequency * qv;
        dt = derivative * rate;
      }
      const width = feather,
        unit = width ? clamp((value - threshold) / width + 0.5, 0, 1) : +(value >= threshold),
        coverage = width ? unit * unit * (3 - 2 * unit) : unit;
      const slope = width ? ((6 * unit * (1 - unit)) / width) * (invert ? -1 : 1) : 0;
      const result = invert ? 1 - coverage : coverage;
      if (!jet) return result;
      const J = scratch.jacobian,
        T = scratch.dt,
        mu = du / map.spec.outputScale[0],
        mv = dv / map.spec.outputScale[1];
      return {
        value: result,
        gradient: [0, 1, 2].map(i => slope * (mu * J[a * 3 + i] + mv * J[b * 3 + i])),
        dt: slope * (dt + mu * T[a] + mv * T[b]),
        valid: true,
        seam: scratch.seam || (pattern === 'angular' && u < 0 && Math.abs(v) <= 1e-6 * Math.hypot(u, v))
      };
    }
    const result = (x, y, z, t = 0) => sample(x, y, z, t);
    result.sample = (x, y, z, t = 0) => sample(x, y, z, t, true);
    result.cost = map.cost + 8;
    result.spec = freeze({ mapping: map.spec, pattern, frequency, phase, rate, threshold, feather, invert });
    return Object.freeze(result);
  }

  const systems = freeze({
    lorenz: {
      dt: 0.01,
      start: [1, 1, 1],
      parameters: { sigma: 10, rho: 28, beta: 8 / 3 },
      field:
        ({ sigma, rho, beta }) =>
        (x, y, z) => [sigma * (y - x), x * (rho - z) - y, x * y - beta * z]
    },
    rossler: {
      dt: 0.04,
      start: [1, 0, 0],
      parameters: { a: 0.2, b: 0.2, c: 5.7 },
      field:
        ({ a, b, c }) =>
        (x, y, z) => [-y - z, x + a * y, b + z * (x - c)]
    },
    thomas: {
      dt: 0.04,
      start: [0.1, 0, 0],
      parameters: { b: 0.208186 },
      field:
        ({ b }) =>
        (x, y, z) => [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z]
    },
    aizawa: {
      dt: 0.005,
      start: [0.1, 0, 0],
      parameters: { a: 0.95, b: 0.7, c: 0.6, d: 3.5, e: 0.25, f: 0.1 },
      field:
        ({ a, b, c, d, e, f }) =>
        (x, y, z) => [
          (z - b) * x - d * y,
          d * x + (z - b) * y,
          c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x
        ]
    },
    clifford: {
      start: [0.1, 0.1],
      parameters: { a: -1.4, b: 1.6, c: 1, d: 0.7 },
      field:
        ({ a, b, c, d }) =>
        (x, y) => [Math.sin(a * y) + c * Math.cos(a * x), Math.sin(b * x) + d * Math.cos(b * y), 0]
    },
    deJong: {
      start: [0.1, 0.1],
      parameters: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
      field:
        ({ a, b, c, d }) =>
        (x, y) => [Math.sin(a * y) - Math.cos(b * x), Math.sin(c * x) - Math.cos(d * y), 0]
    }
  });
  function dynamics({ family = 'lorenz', parameters = {} } = {}) {
    if (!own(systems, family)) throw new RangeError('Math fields: unknown attractor family');
    const recipe = systems[family];
    record(parameters, Object.keys(recipe.parameters), 'attractor coefficients');
    for (const n of Object.values(parameters)) number(n, -1e3, 1e3, 'attractor coefficient');
    const values = freeze({ ...recipe.parameters, ...parameters });
    return Object.freeze({
      family,
      kind: recipe.dt ? 'flow' : 'map',
      dimension: recipe.dt ? 3 : 2,
      dt: recipe.dt ?? 1,
      start: recipe.start.slice(),
      parameters: values,
      field: recipe.field(values)
    });
  }
  function rk4(field, p, step, time = 0) {
    const k0 = field(...p, time),
      k1 = field(...p.map((v, i) => v + (k0[i] * step) / 2), time + step / 2),
      k2 = field(...p.map((v, i) => v + (k1[i] * step) / 2), time + step / 2),
      k3 = field(...p.map((v, i) => v + k2[i] * step), time + step);
    return p.map((v, i) => v + ((k0[i] + 2 * k1[i] + 2 * k2[i] + k3[i]) * step) / 6);
  }
  function attractorFlow({
    family = 'lorenz',
    parameters = {},
    origin = [0, 0, 0],
    scale = [1, 1, 1],
    gain = 1,
    maxSpeed = 100
  } = {}) {
    const system = dynamics({ family, parameters });
    origin = vector(origin, 3);
    scale = vector(scale, 3);
    number(gain, -1e3, 1e3);
    number(maxSpeed, 0, 1e6);
    if (scale.some(n => Math.abs(n) < 1e-8 || Math.abs(n) > 1e4))
      throw new RangeError('Math fields: invalid attractor scale');
    const sample = (x, y, z, time = 0, out = [0, 0, 0]) => {
      [x, y, z, time].forEach(n => number(n));
      const p = [x, y, z].map((n, i) => (n - origin[i]) / scale[i]),
        v = system.field(...p);
      for (let i = 0; i < 3; i++) out[i] = (v[i] - (system.kind === 'map' ? p[i] : 0)) * scale[i] * gain;
      const length = Math.hypot(...out),
        k = length > maxSpeed ? maxSpeed / length : 1;
      for (let i = 0; i < 3; i++) out[i] *= k;
      return out;
    };
    sample.system = system;
    return Object.freeze(sample);
  }
  function integrator(options = {}) {
    record(
      options,
      [
        'family',
        'parameters',
        'field',
        'start',
        'dt',
        'escape',
        'bounds',
        'boundary',
        'maxSteps',
        'maxEvaluations',
        'maxPending'
      ],
      'integrator'
    );
    if (options.field !== undefined && (options.family !== undefined || options.parameters !== undefined))
      throw new TypeError('Math fields: choose a named system or a custom field');
    const custom = options.field !== undefined,
      customField = options.field,
      system = custom ? { kind: 'flow', dt: 0.01, start: [0, 0, 0] } : dynamics(options);
    if (custom && typeof options.field !== 'function')
      throw new TypeError('Math fields: expected a custom flow callback');
    const step = number(options.dt ?? system.dt, 1e-6, system.kind === 'flow' ? 0.25 : 1, 'fixed step');
    if (system.kind === 'map' && step !== 1)
      throw new RangeError('Math fields: discrete maps advance in unit iterations');
    const maxSteps = integer(options.maxSteps ?? 256, 1, 65536, 'step budget'),
      maxEvaluations = integer(
        options.maxEvaluations ?? maxSteps * (system.kind === 'flow' ? 4 : 1),
        system.kind === 'flow' ? 4 : 1,
        262144,
        'evaluation budget'
      ),
      escape = number(options.escape ?? 1e5, 1e-6, 1e7, 'escape bound');
    const maxPending = number(options.maxPending ?? 60, step, 3600, 'pending time budget');
    const boundary = options.boundary ?? 'stop';
    if (!['stop', 'reset', 'clamp', 'wrap'].includes(boundary))
      throw new TypeError('Math fields: invalid boundary policy');
    let bounds;
    if (options.bounds !== undefined) {
      record(options.bounds, ['min', 'max'], 'integration bounds');
      bounds = { min: vector(options.bounds.min, 3), max: vector(options.bounds.max, 3) };
      if (bounds.min.some((n, i) => n >= bounds.max[i] || Math.max(Math.abs(n), Math.abs(bounds.max[i])) > escape))
        throw new RangeError('Math fields: invalid integration box');
    }
    const check = p =>
      p.every(
        (n, i) => Number.isFinite(n) && Math.abs(n) <= escape && (!bounds || (n >= bounds.min[i] && n <= bounds.max[i]))
      );
    const startPoint = value =>
      vector(system.kind === 'map' && value?.length === 2 ? [...value, 0] : value, 3, 'integration start');
    const initial = startPoint(options.start ?? system.start);
    if (!check(initial)) throw new RangeError('Math fields: start outside integration domain');
    let p = initial.slice(),
      previous = p.slice(),
      tick = 0,
      pending = 0,
      status = 'ready',
      resets = 0,
      evaluations = 0,
      steps = 0;
    function snapshot() {
      return {
        point: p.slice(),
        previous: previous.slice(),
        tick,
        time: tick * step,
        pending,
        status,
        resets,
        steps,
        evaluations,
        dt: step
      };
    }
    function reset(start = initial) {
      const q = startPoint(start);
      if (!check(q)) throw new RangeError('Math fields: reset outside integration domain');
      p = q;
      previous = q.slice();
      tick = pending = resets = evaluations = steps = 0;
      status = 'ready';
      return snapshot();
    }
    function advance(seconds) {
      number(seconds, 0, 60, 'elapsed time');
      if (status === 'escaped') return snapshot();
      if (pending + seconds > maxPending + step * 1e-9)
        throw new RangeError('Math fields: pending time budget exceeded');
      pending += seconds;
      evaluations = steps = 0;
      status = 'running';
      function evaluate(x, y, z, t) {
        evaluations++;
        if (![x, y, z].every(n => Number.isFinite(n) && Math.abs(n) <= escape)) return [NaN, NaN, NaN];
        const v = (custom ? customField : system.field)(x, y, z, t);
        return v &&
          (Array.isArray(v) || ArrayBuffer.isView(v)) &&
          v.length === 3 &&
          Array.from(v).every(Number.isFinite)
          ? v
          : [NaN, NaN, NaN];
      }
      while (pending + step * 1e-9 >= step) {
        const checks = system.kind === 'flow' ? 4 : 1;
        if (steps >= maxSteps || evaluations + checks > maxEvaluations) {
          status = 'budget';
          break;
        }
        let q = system.kind === 'flow' ? rk4(evaluate, p, step, tick * step) : evaluate(...p, tick * step);
        if (!check(q)) {
          if (boundary === 'stop') {
            status = 'escaped';
            pending = 0;
            break;
          }
          if (boundary === 'reset' || q.some(n => !Number.isFinite(n))) {
            q = initial.slice();
            resets++;
          } else
            q = q.map((n, i) => {
              const lo = bounds?.min[i] ?? -escape,
                hi = bounds?.max[i] ?? escape;
              return boundary === 'clamp' ? clamp(n, lo, hi) : lo + ((((n - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));
            });
        }
        previous = p;
        p = q;
        tick++;
        steps++;
        pending = Math.max(0, pending - step);
      }
      return snapshot();
    }
    return Object.freeze({
      advance,
      reset,
      snapshot,
      system: custom ? null : system,
      budget: Object.freeze({ maxSteps, maxEvaluations, maxPending }),
      get state() {
        return snapshot();
      }
    });
  }
  return Object.freeze({ mapping, deformation, flow, mask, dynamics, attractorFlow, integrator, systems, rk4 });
})();
if (typeof module !== 'undefined') module.exports = MathFields;
