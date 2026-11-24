/* kr-tex: patterns, as numbers over space.
   Each gives a function (x, y, z) -> number, to use in a material's mod (a shift up or down its ramp), tex (a colour), a cover's
   where, or an attribute (S.attr). All are worked out from where a point is, so they hold still when a thing is baked again.
     K.tex.voronoi(scale, o)   cells: o.out 'f1' (distance to the nearest cell centre), 'edge' (how near the line between two cells:
                               cracks, cobbles, scales, crazed glaze), 'id' (a number for the cell, 0..1: each cell its own shade),
                               o.jitter (1), o.seed
     K.tex.wave(scale, o)      bands: o.dir ([0, 1, 0]), o.warp (how much noise bends them), o.sharp: 0 soft .. 1 a hard line
     K.tex.brick(w, h, o)      courses of bricks or planks: o.mortar (0.08 of a brick), o.offset (0.5), o.dir 'x'|'z';
                               -> 0 in the mortar, 0.5..1 a brick (each its own)
     K.tex.checker(scale)      K.tex.gradient(a, b) (0 at point a, 1 at point b)      K.tex.white(seed) (a new number at every point)
     K.tex.noise(scale, oct)   smooth noise 0..1 (fbm), the same as the builder's
     K.tex.range(f, a, b, c, d)   f mapped from [a, b] to [c, d], held at the ends            K.tex.curve(f, pts)   f through a curve
     K.tex.step(f, edges)      f cut into as many levels as edges + 1 (0, 1, 2 ...)                                                 */
(function (K) {
  const fr = v => v - Math.floor(v),
    h3 = (x, y, z, s) => fr(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453);
  // smooth value noise, so this file needs nothing else
  const vn = (x, y, z) => {
    const X = Math.floor(x),
      Y = Math.floor(y),
      Z = Math.floor(z),
      u = x - X,
      v = y - Y,
      w = z - Z,
      a = u * u * (3 - 2 * u),
      b = v * v * (3 - 2 * v),
      c = w * w * (3 - 2 * w),
      L = (p, q, t) => p + (q - p) * t,
      g = (i, j, k) => h3(X + i, Y + j, Z + k, 0);
    return L(
      L(L(g(0, 0, 0), g(1, 0, 0), a), L(g(0, 1, 0), g(1, 1, 0), a), b),
      L(L(g(0, 0, 1), g(1, 0, 1), a), L(g(0, 1, 1), g(1, 1, 1), a), b),
      c
    );
  };
  const fbm = (x, y, z, oct) => {
    let s = 0,
      a = 0.5,
      t = 0;
    for (let i = 0; i < (oct || 3); i++) {
      s += vn(x, y, z) * a;
      t += a;
      x *= 2.03;
      y *= 2.03;
      z *= 2.03;
      a *= 0.5;
    }
    return s / t;
  };
  K.tex = {
    noise: (scale, oct) => (x, y, z) => fbm(x * scale, y * scale, z * scale, oct),
    voronoi(scale, o) {
      o = o || {};
      const jit = o.jitter === undefined ? 1 : o.jitter,
        sd = o.seed || 0,
        out = o.out || 'f1';
      return (x, y, z) => {
        x *= scale;
        y *= scale;
        z *= scale;
        const X = Math.floor(x),
          Y = Math.floor(y),
          Z = Math.floor(z);
        let f1 = 9,
          f2 = 9,
          id = 0,
          c1 = null,
          k1 = -1;
        const cs = [];
        for (let i = -1; i <= 1; i++)
          for (let j = -1; j <= 1; j++)
            for (let k = -1; k <= 1; k++) {
              const cx = X + i,
                cy = Y + j,
                cz = Z + k,
                px = cx + 0.5 + (h3(cx, cy, cz, sd + 1) - 0.5) * jit,
                py = cy + 0.5 + (h3(cx, cy, cz, sd + 2) - 0.5) * jit,
                pz = cz + 0.5 + (h3(cx, cy, cz, sd + 3) - 0.5) * jit,
                d = Math.hypot(px - x, py - y, pz - z);
              cs.push([px, py, pz]);
              if (d < f1) {
                f2 = f1;
                f1 = d;
                id = h3(cx, cy, cz, sd + 4);
                c1 = cs[cs.length - 1];
                k1 = cs.length - 1;
              } else if (d < f2) f2 = d;
            }
        if (out === 'id') return id;
        if (out === 'f2') return f2;
        if (out === 'edge') {
          // the true distance to the line between this cell and its neighbours (not f2 - f1, which is bent)
          let e = 9;
          for (let q = 0; q < cs.length; q++) {
            if (q === k1) continue;
            const c = cs[q];
            const mx = (c[0] + c1[0]) / 2,
              my = (c[1] + c1[1]) / 2,
              mz = (c[2] + c1[2]) / 2,
              nx = c[0] - c1[0],
              ny = c[1] - c1[1],
              nz = c[2] - c1[2],
              l = Math.hypot(nx, ny, nz) || 1;
            e = Math.min(e, Math.abs(((x - mx) * nx + (y - my) * ny + (z - mz) * nz) / l));
          }
          return e;
        }
        return f1;
      };
    },
    wave(scale, o) {
      o = o || {};
      const d = o.dir || [0, 1, 0],
        warp = o.warp || 0,
        sharp = o.sharp || 0;
      return (x, y, z) => {
        const v =
            (x * d[0] + y * d[1] + z * d[2]) * scale +
            (warp ? (fbm(x * 0.9, y * 0.9, z * 0.9, 2) - 0.5) * warp * 6 : 0),
          s = 0.5 + 0.5 * Math.sin(v * Math.PI * 2);
        return sharp ? Math.pow(s, 1 + sharp * 12) : s;
      };
    },
    brick(w, h, o) {
      o = o || {};
      const mortar = o.mortar === undefined ? 0.08 : o.mortar,
        off = o.offset === undefined ? 0.5 : o.offset,
        alongZ = o.dir === 'z';
      return (x, y, z) => {
        const a = alongZ ? z : x,
          row = Math.floor(y / h),
          u = a / w + (row % 2 ? off : 0),
          col = Math.floor(u),
          fu = u - col,
          fv = y / h - row,
          m = Math.min(fu, 1 - fu) * w < mortar * Math.min(w, h) || Math.min(fv, 1 - fv) * h < mortar * Math.min(w, h);
        return m ? 0 : 0.5 + 0.5 * h3(col, row, 0, 7);
      };
    },
    checker: scale => (x, y, z) => (Math.floor(x * scale) + Math.floor(y * scale) + Math.floor(z * scale)) & 1,
    gradient: (a, b) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      return (x, y, z) => Math.max(0, Math.min(1, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / l2));
    },
    white: seed => (x, y, z) => h3(Math.round(x * 97), Math.round(y * 97), Math.round(z * 97), seed || 0),
    range: (f, a, b, c, d) => (x, y, z, A) => {
      const t = Math.max(0, Math.min(1, (f(x, y, z, A) - a) / (b - a || 1e-9)));
      return c + (d - c) * t;
    },
    curve: (f, pts) => (x, y, z, A) => {
      const v = f(x, y, z, A);
      if (v <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++)
        if (v <= pts[i][0]) {
          const t = (v - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1e-9);
          return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        }
      return pts[pts.length - 1][1];
    },
    step: (f, edges) => (x, y, z, A) => {
      const v = f(x, y, z, A);
      let k = 0;
      for (const e of edges) if (v >= e) k++;
      return k;
    }
  };
})(KIT);
