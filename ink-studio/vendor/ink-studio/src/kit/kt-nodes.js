/* kt-nodes: shape operations on distance fields.
   K.sculpt(S) adds:
     S.strokes(shape, c, depth, mat, o)   lettering, runes, any line drawing pushed through to a depth: shape is { strokes, width }
                          (K.poly2.text / K.poly2.runes make one). o.ax = [U, V, W] (the drawing's x, y, and the way it is pushed),
                          o.rd rounds the edges, o.taper: how wide the far face is against the near (1)
     S.engrave(shape, o)  a drawing cut into a curved surface (carved signs, emblems, runes round a pillar): o.on (the solid, or a distance
                          function, to cut into), o.at (a point on it), o.n (which way the surface faces there: found if left out), o.up
                          (which way is up in the drawing: [0, 1, 0]), o.depth (0.06), o.mat (the colour of the cut: its own, or left out
                          to keep the stone's). shape: { strokes, width } or outline loops (K.poly2). Raised instead of cut: o.raise
     S.displace(p, field, amp, o)   a held solid pushed out where a field is over o.mid (0.5) and in
                          where it is under. Supply a (x, y, z) -> 0..1 callback or a K.procedural.fields expression.
                          o.k (0.8) slows the field down where the pattern is steep.
     S.smooth(p, o)       a held solid (or a list of them, joined) made over on a grid, with signed-distance grid operations:
                          o.fillet: fill every crease and hollow corner with a curve of that radius (where two solids meet, where a
                          rock sits on the ground); o.round: round every edge and corner to that radius; o.mean: passes of blur (soften
                          everything); o.grow: push the surface out (in, if negative) by that much; o.reinitialize: rebuild distance
                          from subcell crossings; o.cell: the grid's spacing. Outside the grid the solid keeps its own distance.
   K.poly2.text(str, size, o)   a single-stroke font (A-Z 0-9 . , - ' ! ? and space): { strokes, width } with capitals `size` tall,
                          centred. o.width (size * 0.16), o.gap (between letters), o.line (between lines, for '\n')
   K.poly2.runes(n, size, seed, o)   n runes in a row: a stave and its branches, each different, the same for the same seed
   K.sdfgrid(sd, lo, hi, cell)   a distance sampled on a grid: .at(x, y, z) (between points, smoothly), .offset(d), .mean(passes),
                          .redistance() (made a true distance again after it has been changed), .fillet(r), .round(r)
   S.merge (in the sculptor): merge by distance, a share of the spacing; see sculpt.js */
(function (K) {
  // ---- a single-stroke font. Each letter is a list of strokes on a grid 4 wide and 6 tall (y up), each stroke its points as digit pairs
  const FONT = {
    A: ['0004264440', '0343'],
    B: ['00063645443303', '3342413000'],
    C: ['4536160501103041'],
    D: ['00062644422000'],
    E: ['40000646', '0333'],
    F: ['000646', '0333'],
    G: ['45361605011030414323'],
    H: ['0006', '4046', '0343'],
    I: ['1030', '2026', '1636'],
    J: ['4641301001'],
    K: ['0006', '4602', '1340'],
    L: ['060040'],
    M: ['0006234640'],
    N: ['00064046'],
    O: ['100105163645413010'],
    P: ['00063645443303'],
    Q: ['100105163645413010', '2240'],
    R: ['00063645443303', '2340'],
    S: ['453616050413334241301001'],
    T: ['0646', '2620'],
    U: ['060110304146'],
    V: ['062046'],
    W: ['0610233046'],
    X: ['0640', '0046'],
    Y: ['062346', '2320'],
    Z: ['06460040'],
    0: ['100105163645413010', '0145'],
    1: ['152620', '1030'],
    2: ['05163645440040'],
    3: ['05163645443313', '334241301001'],
    4: ['30360242'],
    5: ['460604344341301001'],
    6: ['453616050110304142331302'],
    7: ['064620'],
    8: ['13040516364544331302011030414233'],
    9: ['443313040516364541301001'],
    '.': ['2020'],
    ',': ['2111'],
    '-': ['1333'],
    "'": ['2425'],
    '!': ['2622', '2020'],
    '?': ['05163645443323', '2020']
  };
  const parse = s => {
    const pts = [];
    for (let i = 0; i + 1 < s.length; i += 2) pts.push([+s[i], +s[i + 1]]);
    return pts;
  };
  const strokeBox = strokes => {
    const lo = [1e9, 1e9],
      hi = [-1e9, -1e9];
    for (const L of strokes)
      for (const p of L) {
        lo[0] = Math.min(lo[0], p[0]);
        lo[1] = Math.min(lo[1], p[1]);
        hi[0] = Math.max(hi[0], p[0]);
        hi[1] = Math.max(hi[1], p[1]);
      }
    return { lo, hi };
  };
  const centre = (strokes, k) => {
    const b = strokeBox(strokes),
      cx = (b.lo[0] + b.hi[0]) / 2,
      cy = (b.lo[1] + b.hi[1]) / 2;
    return strokes.map(L => L.map(p => [(p[0] - cx) * k, (p[1] - cy) * k]));
  };
  K.poly2.text = (str, size, o) => {
    o = o || {};
    const k = size / 6,
      gap = o.gap === undefined ? 1.6 : o.gap / k,
      line = o.line === undefined ? 9 : o.line / k,
      out = [];
    String(str)
      .toUpperCase()
      .split('\n')
      .forEach((ln, li) => {
        let x = 0;
        for (const ch of ln) {
          for (const s of FONT[ch] || []) out.push(parse(s).map(p => [p[0] + x, p[1] - li * line]));
          x += ch === ' ' ? 3 : 4 + gap;
        }
      });
    return { strokes: centre(out, k), width: o.width || size * 0.16 };
  };
  K.poly2.runes = (n, size, seed, o) => {
    o = o || {};
    let s = (seed || 1) * 7919 + 13;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646,
      out = [];
    for (let i = 0; i < n; i++) {
      const x = i * 4.2;
      out.push([
        [x, 0],
        [x, 6]
      ]); // the stave
      const m = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < m; j++) {
        const y0 = 1 + Math.floor(rnd() * 5),
          side = rnd() < 0.5 ? -1 : 1,
          dy = rnd() < 0.5 ? -1.5 : 1.5,
          kind = rnd();
        if (kind < 0.45)
          out.push([
            [x, y0],
            [x + side * 2, y0 + dy]
          ]);
        else if (kind < 0.75)
          out.push([
            [x - 1.6, y0 + dy],
            [x, y0],
            [x + 1.6, y0 + dy]
          ]);
        else
          out.push([
            [x, y0 + 1],
            [x + side * 1.6, y0],
            [x, y0 - 1]
          ]);
      }
    }
    return { strokes: centre(out, size / 6), width: o.width || size * 0.14 };
  };

  // distance in the plane to a stroke drawing (lines of a width), and to outline loops
  const segs = shape => {
    const out = [];
    for (const L of shape.strokes)
      if (L.length === 1) out.push([L[0][0], L[0][1], L[0][0], L[0][1]]);
      else for (let i = 0; i + 1 < L.length; i++) out.push([L[i][0], L[i][1], L[i + 1][0], L[i + 1][1]]);
    return out;
  };
  const strokeD = (S2, hw, x, y) => {
    let d = 1e9;
    for (const s of S2) {
      const ex = s[2] - s[0],
        ey = s[3] - s[1],
        wx = x - s[0],
        wy = y - s[1],
        l2 = ex * ex + ey * ey,
        t = l2 > 0 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / l2)) : 0,
        dx = wx - ex * t,
        dy = wy - ey * t,
        q = dx * dx + dy * dy;
      if (q < d) d = q;
    }
    return Math.sqrt(d) - hw;
  };
  const loopD = (loops, x, y) => {
    let d = 1e18,
      inside = false;
    for (const L of loops)
      for (let a = 0, n = L.length; a < n; a++) {
        const p = L[a],
          q = L[(a + 1) % n],
          ex = q[0] - p[0],
          ey = q[1] - p[1],
          wx = x - p[0],
          wy = y - p[1],
          t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1))),
          dx = wx - ex * t,
          dy = wy - ey * t,
          dd = dx * dx + dy * dy;
        if (dd < d) d = dd;
        if (p[1] <= y !== q[1] <= y && x < p[0] + ((y - p[1]) / (q[1] - p[1])) * ex) inside = !inside;
      }
    return (inside ? -1 : 1) * Math.sqrt(d);
  };
  // a 2D shape of either kind: its distance function and its box
  const flat = shape => {
    if (Array.isArray(shape)) {
      const b = strokeBox(shape);
      return { d: (x, y) => loopD(shape, x, y), lo: b.lo, hi: b.hi };
    }
    const S2 = segs(shape),
      hw = shape.width / 2,
      b = strokeBox(shape.strokes);
    return { d: (x, y) => strokeD(S2, hw, x, y), lo: [b.lo[0] - hw, b.lo[1] - hw], hi: [b.hi[0] + hw, b.hi[1] + hw] };
  };

  // ---- a distance on a grid
  K.sdfgrid = (sd, lo, hi, cell) => {
    const nx = Math.max(2, Math.ceil((hi[0] - lo[0]) / cell) + 1),
      ny = Math.max(2, Math.ceil((hi[1] - lo[1]) / cell) + 1),
      nz = Math.max(2, Math.ceil((hi[2] - lo[2]) / cell) + 1),
      v = new Float32Array(nx * ny * nz),
      h = cell;
    for (let k = 0, i = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let a = 0; a < nx; a++, i++) v[i] = sd(lo[0] + a * h, lo[1] + j * h, lo[2] + k * h);
    const g = { lo, hi, h, nx, ny, nz, v };
    const I = (a, j, k) => a + nx * (j + ny * k);
    g.at = (x, y, z) => {
      let fx = (x - lo[0]) / h,
        fy = (y - lo[1]) / h,
        fz = (z - lo[2]) / h;
      fx = Math.max(0, Math.min(nx - 1.001, fx));
      fy = Math.max(0, Math.min(ny - 1.001, fy));
      fz = Math.max(0, Math.min(nz - 1.001, fz));
      const a = fx | 0,
        j = fy | 0,
        k = fz | 0,
        u = fx - a,
        w = fy - j,
        t = fz - k,
        i = I(a, j, k),
        sx = 1,
        sy = nx,
        sz = nx * ny;
      const c00 = v[i] + (v[i + sx] - v[i]) * u,
        c10 = v[i + sy] + (v[i + sy + sx] - v[i + sy]) * u,
        c01 = v[i + sz] + (v[i + sz + sx] - v[i + sz]) * u,
        c11 = v[i + sz + sy] + (v[i + sz + sy + sx] - v[i + sz + sy]) * u;
      return (c00 + (c10 - c00) * w) * (1 - t) + (c01 + (c11 - c01) * w) * t;
    };
    g.offset = d => {
      for (let i = 0; i < v.length; i++) v[i] -= d;
      return g;
    };
    // blur by a box of three, each way in turn, `passes` times
    g.mean = passes => {
      const tmp = new Float32Array(v.length);
      for (let p = 0; p < (passes || 1); p++)
        for (const [st, n] of [
          [1, nx],
          [nx, ny],
          [nx * ny, nz]
        ]) {
          tmp.set(v);
          for (let i = 0; i < v.length; i++) {
            const c = Math.floor(i / st) % n;
            if (c > 0 && c < n - 1) v[i] = (tmp[i - st] + tmp[i] + tmp[i + st]) / 3;
          }
        }
      return g;
    };
    /* made a true distance again (fast sweeping): the values beside the surface are kept, and every other is worked out from them as
       the shortest way to the surface, sweeping the grid in all eight directions */
    g.redistance = ({ subcell = false, passes = 1 } = {}) => {
      if (typeof subcell !== 'boolean' || !Number.isSafeInteger(passes) || passes < 1 || passes > 8)
        throw new Error('SDF reinitialization needs one to eight sweep passes');
      const N = v.length,
        u = new Float32Array(N),
        fixed = new Uint8Array(N),
        BIG = 1e9;
      let seeds = 0;
      function crossing(i, position, count, stride) {
        const d = v[i], absolute = Math.abs(d);
        let nearest = Infinity;
        if (position > 0 && (v[i - stride] < 0) !== (d < 0))
          nearest = h * absolute / (absolute + Math.abs(v[i - stride]));
        if (position < count - 1 && (v[i + stride] < 0) !== (d < 0))
          nearest = Math.min(nearest, h * absolute / (absolute + Math.abs(v[i + stride])));
        return nearest;
      }
      for (let k = 0, i = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let a = 0; a < nx; a++, i++) {
            const s = v[i] < 0;
            if (subcell) {
              if (!Number.isFinite(v[i])) throw new Error('SDF samples must be finite for reinitialization');
              if (v[i] === 0) {
                fixed[i] = 1;
                seeds++;
                continue;
              }
              const x = crossing(i,a,nx,1), y = crossing(i,j,ny,nx), z = crossing(i,k,nz,nx*ny),
                precision = (1 / x) ** 2 + (1 / y) ** 2 + (1 / z) ** 2;
              if (precision) {
                fixed[i] = 1;
                seeds++;
                u[i] = 1 / Math.sqrt(precision);
              } else u[i] = BIG;
              continue;
            }
            let edge = false;
            if (a > 0 && v[i - 1] < 0 !== s) edge = true;
            else if (a < nx - 1 && v[i + 1] < 0 !== s) edge = true;
            else if (j > 0 && v[i - nx] < 0 !== s) edge = true;
            else if (j < ny - 1 && v[i + nx] < 0 !== s) edge = true;
            else if (k > 0 && v[i - nx * ny] < 0 !== s) edge = true;
            else if (k < nz - 1 && v[i + nx * ny] < 0 !== s) edge = true;
            if (edge) {
              fixed[i] = 1;
              u[i] = Math.min(Math.abs(v[i]), h);
            } else u[i] = BIG;
          }
      if (subcell && !seeds) return g;
      const h2 = h * h;
      for (let sw = 0; sw < 8 * passes; sw++) {
        const dx = sw & 1 ? -1 : 1,
          dy = sw & 2 ? -1 : 1,
          dz = sw & 4 ? -1 : 1;
        for (let k = dz > 0 ? 0 : nz - 1; k >= 0 && k < nz; k += dz)
          for (let j = dy > 0 ? 0 : ny - 1; j >= 0 && j < ny; j += dy)
            for (let a = dx > 0 ? 0 : nx - 1; a >= 0 && a < nx; a += dx) {
              const i = I(a, j, k);
              if (fixed[i]) continue;
              let A = Math.min(a > 0 ? u[i - 1] : BIG, a < nx - 1 ? u[i + 1] : BIG),
                Bq = Math.min(j > 0 ? u[i - nx] : BIG, j < ny - 1 ? u[i + nx] : BIG),
                C = Math.min(k > 0 ? u[i - nx * ny] : BIG, k < nz - 1 ? u[i + nx * ny] : BIG);
              if (A > Bq) [A, Bq] = [Bq, A];
              if (Bq > C) [Bq, C] = [C, Bq];
              if (A > Bq) [A, Bq] = [Bq, A];
              if (A >= BIG) continue;
              let x = A + h;
              if (x > Bq) {
                x = (A + Bq + Math.sqrt(Math.max(0, 2 * h2 - (A - Bq) * (A - Bq)))) / 2;
                if (x > C) {
                  const s = A + Bq + C;
                  x = (s + Math.sqrt(Math.max(0, s * s - 3 * (A * A + Bq * Bq + C * C - h2)))) / 3;
                }
              }
              if (x < u[i]) u[i] = x;
            }
      }
      for (let i = 0; i < N; i++) v[i] = v[i] < 0 ? -u[i] : u[i];
      return g;
    };
    g.reinitialize = ({ passes = 2 } = {}) => g.redistance({ subcell: true, passes });
    g.fillet = r => g.offset(r).redistance().offset(-r);
    g.round = r => g.offset(-r).redistance().offset(r);
    return g;
  };

  const sculpt0 = K.sculpt;
  K.sculpt = S0 => {
    const S = sculpt0(S0) || S0;
    const frameOf = ax =>
      ax
        ? [ax[0], ax[1], ax[2]]
        : [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    S.strokes = (shape, c, depth, mat, o) => {
      o = o || {};
      const [U, Vv, W] = frameOf(o.ax),
        F = flat(shape),
        h = depth / 2,
        rd = o.rd || 0,
        tp = o.taper === undefined ? 1 : o.taper,
        r = Math.max(Math.abs(F.lo[0]), Math.abs(F.hi[0]), Math.abs(F.lo[1]), Math.abs(F.hi[1])) * 1.42;
      const at = (a, b, d) => [
        c[0] + U[0] * a + Vv[0] * b + W[0] * d,
        c[1] + U[1] * a + Vv[1] * b + W[1] * d,
        c[2] + U[2] * a + Vv[2] * b + W[2] * d
      ];
      const p = {
        bc: c,
        br: Math.hypot(r, h) + 0.02,
        sd: (x, y, z) => {
          const q = [x - c[0], y - c[1], z - c[2]],
            w = dot(q, W),
            s = tp === 1 ? 1 : 1 + ((tp - 1) * (Math.max(-h, Math.min(h, w)) + h)) / (2 * h),
            d2 = F.d(dot(q, U) / s, dot(q, Vv) / s) * s + rd,
            dz = Math.abs(w) - h + rd;
          return Math.min(Math.max(d2, dz), 0) + Math.hypot(Math.max(d2, 0), Math.max(dz, 0)) - rd;
        },
        sample(f) {
          const res = this.res,
            nz = Math.max(1, Math.ceil(depth / res));
          for (let a = F.lo[0]; a <= F.hi[0]; a += res * 0.7)
            for (let b = F.lo[1]; b <= F.hi[1]; b += res * 0.7) {
              const d = F.d(a, b);
              if (d > res * 0.5) continue;
              for (const sg of [-1, 1]) {
                const s = tp === 1 || sg < 0 ? 1 : tp,
                  q = at(a * s, b * s, sg * h);
                f(q[0], q[1], q[2]);
              }
              if (d > -res * 0.6)
                for (let k = 0; k < nz; k++) {
                  const dz = -h + ((k + 0.5) / nz) * depth,
                    s = 1 + ((tp - 1) * (dz + h)) / depth,
                    q = at(a * s, b * s, dz);
                  f(q[0], q[1], q[2]);
                }
            }
        }
      };
      return S.add(p, mat, Object.assign({ reach: rd + 0.02 }, o));
    };

    S.engrave = (shape, o) => {
      o = o || {};
      const tsd = typeof o.on === 'function' ? o.on : (x, y, z) => S.psd(o.on, x, y, z),
        at = o.at,
        e = 0.01;
      let n = o.n;
      if (!n) {
        const d0 = tsd(at[0], at[1], at[2]);
        n = [tsd(at[0] + e, at[1], at[2]) - d0, tsd(at[0], at[1] + e, at[2]) - d0, tsd(at[0], at[1], at[2] + e) - d0];
      }
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / nl, n[1] / nl, n[2] / nl];
      const up0 = o.up || [0, 1, 0],
        ud = dot(up0, n);
      let Vv = [up0[0] - n[0] * ud, up0[1] - n[1] * ud, up0[2] - n[2] * ud];
      const vl = Math.hypot(Vv[0], Vv[1], Vv[2]) || 1;
      Vv = [Vv[0] / vl, Vv[1] / vl, Vv[2] / vl];
      const U = [Vv[1] * n[2] - Vv[2] * n[1], Vv[2] * n[0] - Vv[0] * n[2], Vv[0] * n[1] - Vv[1] * n[0]],
        F = flat(shape),
        depth = o.depth || 0.06,
        r = Math.max(Math.abs(F.lo[0]), Math.abs(F.hi[0]), Math.abs(F.lo[1]), Math.abs(F.hi[1])) * 1.42;
      const uv = (x, y, z) => {
        const q = [x - at[0], y - at[1], z - at[2]];
        return F.d(dot(q, U), dot(q, Vv));
      };
      const p = {
        bc: at,
        br: r + depth * 2 + 0.05,
        // cut: inside the drawing and less than `depth` under the surface. Raised: inside the drawing and less than `depth` above it
        sd: o.raise
          ? (x, y, z) => Math.max(uv(x, y, z), tsd(x, y, z) - depth, -tsd(x, y, z) - depth)
          : (x, y, z) => Math.max(uv(x, y, z), -(tsd(x, y, z) + depth)),
        sample(f) {
          const res = this.res;
          for (let a = F.lo[0]; a <= F.hi[0]; a += res * 0.7)
            for (let b = F.lo[1]; b <= F.hi[1]; b += res * 0.7) {
              const d = F.d(a, b);
              if (d > res * 0.5) continue;
              let q = [at[0] + U[0] * a + Vv[0] * b, at[1] + U[1] * a + Vv[1] * b, at[2] + U[2] * a + Vv[2] * b];
              for (let it = 0; it < 3; it++) {
                const s = tsd(q[0], q[1], q[2]);
                q = [q[0] - n[0] * s, q[1] - n[1] * s, q[2] - n[2] * s];
              }
              const sg = o.raise ? 1 : -1,
                m = d > -res ? Math.max(1, Math.ceil(depth / res)) : 1;
              for (let k = 1; k <= m; k++) {
                const t = (k / m) * depth * sg;
                f(q[0] + n[0] * t, q[1] + n[1] * t, q[2] + n[2] * t);
              }
            }
        }
      };
      return S.add(p, o.mat || {}, Object.assign({ reach: 0.02 }, o, o.raise ? {} : { neg: true }));
    };

    S.displace = (p0, field, amp, o) => {
      o = o || {};
      const mid = o.mid === undefined ? 0.5 : o.mid,
        k = o.k || 0.8,
        evaluate = typeof field === 'function'
          ? field
          : K.procedural.fields.compile({ type: 'clamp', source: field }, { seed: o.seed ?? 0 });
      const p = {
        bc: p0.bc,
        br: p0.br + amp,
        sd: (x, y, z) => (S.psd(p0, x, y, z) - 2 * amp * (evaluate(x, y, z) - mid)) * k,
        sample(f) {
          const keep = p0.res;
          p0.res = this.res;
          try {
            p0.sample(f);
          } finally {
            p0.res = keep;
          }
        }
      };
      if (p0.along) p.along = p0.along;
      return S.add(p, o.mat || p0.mat, Object.assign({ reach: amp * 1.2 }, o));
    };

    S.smooth = (p0, o) => {
      o = o || {};
      const list = Array.isArray(p0) ? p0 : [p0],
        sd0 = (x, y, z) => {
          let d = 1e9;
          for (const p of list) d = Math.min(d, S.psd(p, x, y, z));
          return d;
        };
      let lo = [1e9, 1e9, 1e9],
        hi = [-1e9, -1e9, -1e9];
      for (const p of list)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p.bc[k] - p.br);
          hi[k] = Math.max(hi[k], p.bc[k] + p.br);
        }
      const pad = (o.fillet || 0) + (o.round || 0) + Math.abs(o.grow || 0) + 0.15,
        cell = o.cell || Math.max(0.03, (o.res || list[0].res || S.res) * 0.9);
      lo = lo.map(v => v - pad);
      hi = hi.map(v => v + pad);
      const g = K.sdfgrid(sd0, lo, hi, cell);
      if (o.fillet) g.fillet(o.fillet);
      if (o.round) g.round(o.round);
      if (o.mean) g.mean(o.mean).redistance();
      if (o.reinitialize) g.reinitialize(typeof o.reinitialize === 'object' ? o.reinitialize : {});
      if (o.grow) g.offset(o.grow);
      const inBox = (x, y, z) =>
        x > lo[0] + cell &&
        x < hi[0] - cell &&
        y > lo[1] + cell &&
        y < hi[1] - cell &&
        z > lo[2] + cell &&
        z < hi[2] - cell;
      const bc = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2),
        p = {
          bc,
          br: Math.hypot(hi[0] - bc[0], hi[1] - bc[1], hi[2] - bc[2]),
          sd: (x, y, z) => (inBox(x, y, z) ? g.at(x, y, z) : sd0(x, y, z) - (o.grow || 0)),
          grid: g,
          // where the made-over surface crosses a cell, a point there (and a few more if the cells are coarser than the dabs)
          sample(f) {
            const res = this.res,
              per = Math.max(1, Math.round(cell / res)),
              { nx, ny, nz, v } = g;
            for (let k = 0, i = 0; k < nz; k++)
              for (let j = 0; j < ny; j++)
                for (let a = 0; a < nx; a++, i++)
                  if (Math.abs(v[i]) < cell * 0.87)
                    for (let q = 0; q < per * per; q++)
                      f(
                        lo[0] + (a + (per > 1 ? (q % per) / per - 0.5 : 0)) * cell,
                        lo[1] + j * cell,
                        lo[2] + (k + (per > 1 ? Math.floor(q / per) / per - 0.5 : 0)) * cell
                      );
          }
        };
      return S.add(p, o.mat || list[0].mat, Object.assign({ reach: cell }, o));
    };
    return S;
  };
})(KIT);
