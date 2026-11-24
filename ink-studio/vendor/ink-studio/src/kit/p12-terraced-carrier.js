/* A masked, configurable height-field operation. Height bands create connected
   treads and narrow risers; slope and mask shoulders blend back into the input.
   The contour mesh samples those risers explicitly, rather than skipping them
   with a uniform XZ lattice. Paths are one consumer of this general operation. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    compiled = new WeakSet(),
    EPS = 1e-9;
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
    smooth = x => {
      x = clamp(x);
      return x * x * (3 - 2 * x);
    };
  function parameters(raw = {}) {
    if (raw === true) raw = {};
    if (raw === false) raw = { enabled: false };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Terracing needs configuration or false');
    if (compiled.has(raw)) return raw;
    const p = Object.assign(
      {
        enabled: true,
        rise: 0.18,
        transition: 0.025,
        minGrade: 0.45,
        fullGrade: 0.75,
        shoulder: 0.08,
        phase: 0,
        material: 'default'
      },
      A.data.clone(raw)
    );
    if (
      typeof p.enabled !== 'boolean' ||
      !['rise', 'transition', 'minGrade', 'fullGrade', 'shoulder', 'phase'].every(k => Number.isFinite(p[k])) ||
      p.rise < 0.05 ||
      p.rise > 1 ||
      p.transition < 0.005 ||
      p.transition > p.rise * 0.5 ||
      p.minGrade < 0 ||
      p.fullGrade <= p.minGrade ||
      p.fullGrade > 20 ||
      p.shoulder < 0 ||
      p.shoulder > 4 ||
      Math.abs(p.phase) > 1000 ||
      typeof p.material !== 'string' ||
      !p.material
    )
      throw new Error('Invalid terrace rise, transition, grade, shoulder or material');
    A.data.freeze(p);
    compiled.add(p);
    return p;
  }
  function surface(base, configuration) {
    if (
      !base ||
      typeof base.height !== 'function' ||
      typeof base.normal !== 'function' ||
      typeof base.inside !== 'function' ||
      !base.bounds ||
      typeof configuration !== 'function'
    )
      throw new Error('Terracing needs a height surface and a mask/configuration resolver');
    const configs = new WeakMap(),
      defaults = parameters();
    let lastX, lastZ, last;
    function sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Terrace queries need finite XZ coordinates');
      if (last && x === lastX && z === lastZ) return last;
      const raw = base.height(x, z),
        domain = configuration(x, z);
      if (!Number.isFinite(raw)) throw new Error('Terrace source heights must be finite');
      let result = {
        height: raw,
        raw,
        weight: 0,
        grade: 0,
        derivative: 1,
        owner: domain?.owner || null,
        parameters: null
      };
      if (domain) {
        const spec = domain.parameters === undefined ? defaults : domain.parameters;
        let p = typeof spec === 'object' && (compiled.has(spec) ? spec : configs.get(spec));
        if (!p) {
          p = parameters(spec);
          if (spec && typeof spec === 'object') configs.set(spec, p);
        }
        if (!Number.isFinite(domain.distance)) throw new Error('Terrace masks need a finite signed distance');
        result.parameters = p;
        if (p.enabled && domain.distance <= 0 && (base.slopeBound === undefined || base.slopeBound >= p.minGrade)) {
          const n = base.normal(x, z),
            grade = Math.hypot(n[0], n[2]) / Math.max(EPS, Math.abs(n[1])),
            weight =
              smooth((grade - p.minGrade) / (p.fullGrade - p.minGrade)) *
              smooth(-domain.distance / Math.max(0.005, p.shoulder)),
            band = Math.floor((raw - p.phase) / p.rise + 1e-10),
            low = p.phase + band * p.rise,
            upper = low + p.rise,
            t = clamp((raw - upper + p.transition) / p.transition),
            stepped = low + p.rise * t;
          result = {
            height: raw - weight * Math.max(0, raw - stepped),
            raw,
            weight,
            grade,
            derivative: t > 0 && t < 1 ? p.rise / p.transition : 0,
            normal: n,
            owner: domain.owner || null,
            parameters: p
          };
        }
      }
      lastX = x;
      lastZ = z;
      last = result;
      return result;
    }
    const height = (x, z) => sample(x, z).height;
    function normal(x, z) {
      const s = sample(x, z);
      if (s.weight < EPS) return (s.normal || base.normal(x, z)).slice();
      if (s.weight > 1 - EPS) {
        const n = s.normal,
          d = s.derivative;
        return V.norm([n[0] * d, n[1], n[2] * d]);
      }
      const e = 0.001;
      return V.norm([height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)]);
    }
    // Positive scaling keeps the same surface and its normal at the zero set.
    // Source gradient bounds scale narrow risers for the bake's field estimate.
    function distanceScale(x, z) {
      const s = sample(x, z),
        grade = base.slopeBound ?? 20;
      if (!s.weight) return 1 / Math.sqrt(1 + grade * grade);
      const p = s.parameters,
        bound = grade * (1 + p.rise / p.transition) + p.rise / Math.max(0.005, p.shoulder) + 8;
      return 1 / Math.sqrt(1 + bound * bound);
    }
    function mesh(bounds, options = {}) {
      const o = Object.assign({ resolution: 0.12, maxCells: 60000, maxTriangles: 300000, meta: {} }, options);
      if (
        !bounds ||
        ![bounds.min, bounds.max].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
        bounds.min.some((v, i) => v > bounds.max[i]) ||
        !Number.isFinite(o.resolution) ||
        o.resolution <= 0 ||
        !Number.isSafeInteger(o.maxCells) ||
        o.maxCells < 1 ||
        o.maxCells > 200000 ||
        !Number.isSafeInteger(o.maxTriangles) ||
        o.maxTriangles < 1 ||
        o.maxTriangles > 1000000
      )
        throw new Error('Terrace meshes need finite bounds, positive spacing and bounded budgets');
      const b = {
          min: [Math.max(bounds.min[0], base.bounds.min[0]), 0, Math.max(bounds.min[2], base.bounds.min[2])],
          max: [Math.min(bounds.max[0], base.bounds.max[0]), 0, Math.min(bounds.max[2], base.bounds.max[2])]
        },
        out = A.geometry.builder();
      let cells = 0,
        triangles = 0,
        risers = 0;
      if (b.min[0] >= b.max[0] || b.min[2] >= b.max[2])
        return Object.assign(out.finish(), { sampling: { cells, triangles, risers } });
      const nx = Math.ceil((b.max[0] - b.min[0]) / o.resolution),
        nz = Math.ceil((b.max[2] - b.min[2]) / o.resolution);
      if (nx * nz > o.maxCells) throw new Error('Terrace mesh exceeds its cell budget');
      const points = new Map(),
        at = (i, j) => {
          const key = i + '/' + j;
          if (!points.has(key)) {
            const x = b.min[0] + ((b.max[0] - b.min[0]) * i) / nx,
              z = b.min[2] + ((b.max[2] - b.min[2]) * j) / nz;
            points.set(key, { x, z, h: base.height(x, z) });
          }
          return points.get(key);
        };
      const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t });
      function clip(poly, level, above) {
        const out = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i],
            b = poly[(i + 1) % poly.length],
            da = (a.h - level) * (above ? 1 : -1),
            db = (b.h - level) * (above ? 1 : -1);
          if (da >= -EPS) out.push(a);
          if (da < 0 !== db < 0) out.push(mix(a, b, da / (da - db)));
        }
        return out;
      }
      function put(poly, kind) {
        if (poly.length < 3) return;
        const ps = poly.map(p => [p.x, height(p.x, p.z), p.z]);
        for (let i = 1; i < ps.length - 1; i++) {
          const a = ps[0],
            b = ps[i],
            c = ps[i + 1];
          if (V.len(V.cross(V.sub(b, a), V.sub(c, a))) < 1e-12) continue;
          if (++triangles > o.maxTriangles) throw new Error('Terrace mesh exceeds its triangle budget');
          if (kind === 'riser') risers++;
          out.triangle(a, c, b, Object.assign({}, o.meta, { surface: kind }));
        }
      }
      function triangle(poly) {
        const samples = poly.map(p => sample(p.x, p.z)),
          center = { x: poly.reduce((n, p) => n + p.x, 0) / 3, z: poly.reduce((n, p) => n + p.z, 0) / 3 },
          c = sample(center.x, center.z),
          active = [...samples, c].filter(s => s.weight > EPS);
        if (!active.length) {
          put(poly, 'surface');
          return;
        }
        const lo = Math.min(...poly.map(p => p.h)),
          hi = Math.max(...poly.map(p => p.h));
        if (hi - lo < EPS) {
          put(poly, 'surface');
          return;
        }
        const configurations = new Map(
            active.map(s => [
              JSON.stringify([s.parameters.rise, s.parameters.phase, s.parameters.transition]),
              s.parameters
            ])
          ),
          knots = [lo, hi];
        for (const p of configurations.values()) {
          const first = Math.floor((lo - p.phase) / p.rise) - 1,
            last = Math.floor((hi - p.phase) / p.rise) + 1;
          if (last - first > 1024) throw new Error('Terrace triangle exceeds its height-band budget');
          for (let band = first; band <= last; band++)
            for (const h of [p.phase + band * p.rise, p.phase + (band + 1) * p.rise - p.transition])
              if (h > lo + EPS && h < hi - EPS) knots.push(h);
        }
        knots.sort((a, b) => a - b);
        const levels = knots.filter((h, i) => !i || h - knots[i - 1] > EPS);
        for (let i = 1; i < levels.length; i++) {
          const strip = clip(clip(poly, levels[i - 1], true), levels[i], false);
          if (strip.length < 3) continue;
          const x = strip.reduce((n, p) => n + p.x, 0) / strip.length,
            z = strip.reduce((n, p) => n + p.z, 0) / strip.length,
            s = sample(x, z);
          put(strip, s.weight > EPS ? (s.derivative ? 'riser' : 'tread') : 'surface');
        }
      }
      const detail = new Map(),
        make = (x, z) => {
          const key = x.toFixed(10) + '/' + z.toFixed(10);
          if (!detail.has(key)) detail.set(key, { x, z, h: base.height(x, z) });
          return detail.get(key);
        };
      function cell(a, b, c, d, depth) {
        if (++cells > o.maxCells) throw new Error('Terrace mesh exceeds its adaptive cell budget');
        const center = make((a.x + c.x) / 2, (a.z + c.z) / 2),
          samples = [a, b, c, d, center].map(p => sample(p.x, p.z)),
          enabled = samples.filter(s => s.parameters?.enabled),
          heights = [a.h, b.h, c.h, d.h],
          span = Math.max(...heights) - Math.min(...heights),
          error = Math.abs(center.h - heights.reduce((a, b) => a + b, 0) / 4);
        if (
          depth < 10 &&
          (span > (enabled.length ? Math.min(...enabled.map(s => s.parameters.rise)) : 0.18) * 4 ||
            error > (enabled.length ? Math.min(...enabled.map(s => s.parameters.transition)) : 0.025) * 0.2)
        ) {
          const ab = make(center.x, a.z),
            bc = make(b.x, center.z),
            cd = make(center.x, c.z),
            da = make(a.x, center.z);
          cell(a, ab, center, da, depth + 1);
          cell(ab, b, bc, center, depth + 1);
          cell(center, bc, c, cd, depth + 1);
          cell(da, center, cd, d, depth + 1);
          return;
        }
        triangle([a, b, c]);
        triangle([a, c, d]);
      }
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) cell(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), 0);
      return Object.assign(out.finish(), { sampling: A.data.freeze({ cells, triangles, risers }) });
    }
    function sampleSurface(bounds, resolution, emit, keep, options = {}) {
      if (!Number.isFinite(resolution) || resolution <= 0 || typeof emit !== 'function')
        throw new Error('Terrace sampling needs positive spacing and an emitter');
      const result = mesh(bounds, Object.assign({ resolution: Math.min(0.16, resolution) }, options));
      let count = 0;
      for (const group of result.groups)
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const ps = [0, 1, 2].map(j => Array.from(result.positions.slice((i + j) * 3, (i + j + 1) * 3))),
            order = [
              [0, 1, 2],
              [1, 2, 0],
              [2, 0, 1]
            ].sort((a, b) => V.dist(ps[b[0]], ps[b[1]]) - V.dist(ps[a[0]], ps[a[1]]))[0],
            p = order.map(j => ps[j]),
            edge = V.sub(p[1], p[0]),
            rise = V.sub(p[2], p[0]),
            length = V.len(edge),
            axis = V.norm(edge),
            altitude = V.len(V.sub(rise, V.mul(axis, V.dot(rise, axis)))),
            rows = Math.max(1, Math.ceil(altitude / resolution));
          for (let row = 0; row <= rows; row++) {
            const t = row / rows,
              n = Math.max(1, Math.ceil(((1 - t) * length) / resolution));
            for (let col = 0; col <= (row === rows ? 0 : n); col++) {
              const q = V.add(p[0], V.add(V.mul(edge, ((1 - t) * col) / n), V.mul(rise, t))),
                x = q[0],
                z = q[2];
              if (!base.inside(x, z) || (keep && !keep(x, z))) continue;
              if (++count > 250000) throw new Error('Terrace sampling exceeds its point budget');
              emit(x, height(x, z), z, normal(x, z), group.surface);
            }
          }
        }
      return count;
    }
    return {
      base,
      height,
      normal,
      sample(x, z) {
        const s = Object.assign({}, sample(x, z));
        if (s.normal) s.normal = Object.freeze(s.normal.slice());
        return Object.freeze(s);
      },
      weight: (x, z) => sample(x, z).weight,
      distanceScale,
      mesh,
      sampleSurface,
      inside: base.inside,
      bounds: { min: [base.bounds.min[0], base.bounds.min[1] - 1, base.bounds.min[2]], max: base.bounds.max.slice() }
    };
  }
  A.terraces = { parameters, surface };
})(KIT);
