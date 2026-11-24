/* ke-volume: light that goes through things, and things that are not surfaces.
   Materials (hand them to any solid):
     K.look.wax(ramp, o)     solid, but light comes through where it is thin (an ear, a leaf, a candle). o: depth, k, glow (the ramp it glows,
                             dark to bright), gloss ({ c, at, c2, at2 }: a wet highlight; set S.view to where the camera looks from)
     K.look.jelly(ramp, o)   the same, for a body that is all soft: o: depth, k, glow, gloss, core ({ p, r, k }: a light inside it, seen
                             through the skin from where S.view says the eye is), a (how solid: 3 by default; under 1 is truly see-through,
                             which dithers, so keep that for thin things)
     K.look.glass(ramp, o)   clear and tinted; it bends what is seen through it, most at its rim. Make the solid a ghost ({ ghost: true })
                             so that it shades and hides nothing. o: a (0.1)
     K.look.fur(ramp, o)     a coat: hairs that curve, lie along `comb`, gather into locks, and catch light at the tips and round the edge.
                             o: len, comb [x, y, z], lay, droop, clump, n, w, rim (ramp for backlit tips), still
     K.caustic(B, p, r, cols, o)   the pool of coloured light a see-through thing throws on the ground
   Volumes:
     K.smoke(st, pool, o)    a plume that shades itself: bright on the side the light comes from, dark underneath and inside.
                             o: at ([x, y, z] or t => [x, y, z]), rate (puffs a second), life, size [start, end], ramp (lit ... shadowed),
                             a (how thick each puff is), sun, flow, shadow (how fast it darkens), rise.   .burst(p, n)
     K.mist(B, o)            (before B.finish) a low haze that drifts: o: y, depth, rad, n, cols, a, size [lo, hi], drift, where(x, z)
     K.shafts(B, o)          (before B.finish) beams of light in the air: o: from [x, y, z], dir, len, r, n, col, a
     K.glint(B, p, ax, len, col)   the bright stroke on glass or water
   For the whole picture (given to B.finish):
     ao: { k, range }        nearer things shade what is close behind them, every frame, so what moves keeps its contact shadow
     fog: { c, start, max }  things fade toward palette colour c with distance
     refract: n              how far glass bends the picture, in art pixels (6) */
(function (K) {
  const V = K.V,
    pick = (o, k, d) => (o && o[k] !== undefined ? o[k] : d);
  const sssOf = (o, depth, k) => ({
    depth: pick(o, 'depth', depth),
    k: pick(o, 'k', k),
    ramp: pick(o, 'glow', null),
    at: pick(o, 'at', 0.22),
    core: pick(o, 'core', null)
  });
  K.look = {
    wax: (ramp, o) => ({ r: ramp, sss: sssOf(o, 0.6, 0.6), gloss: pick(o, 'gloss', undefined) }),
    jelly: (ramp, o) => ({
      r: ramp,
      a: pick(o, 'a', 3),
      sss: sssOf(o, 1.2, 0.5),
      gloss: pick(o, 'gloss', undefined)
    }),
    glass: (ramp, o) => ({ r: ramp, a: pick(o, 'a', 0.1), glass: true }),
    fur: (ramp, o) => ({
      r: ramp,
      fur: {
        len: pick(o, 'len', 0.3),
        comb: pick(o, 'comb', null),
        lay: pick(o, 'lay', 0.5),
        droop: pick(o, 'droop', 0.35),
        clump: pick(o, 'clump', 0.6),
        n: pick(o, 'n', 2),
        w: pick(o, 'w', 0),
        rim: pick(o, 'rim', null),
        still: pick(o, 'still', false)
      }
    })
  };
  /* the pool of coloured light a see-through thing throws on the ground, on the side away from the sun: p where it lands, r how wide,
     cols bright to dim, o.a how strong, o.n how many */
  K.caustic = (B, p, r, cols, o) => {
    const n = pick(o, 'n', 26),
      a = pick(o, 'a', 0.5);
    for (let k = 0; k < n; k++) {
      const u = Math.sqrt((k + 0.5) / n),
        ang = k * 2.39996,
        rr = r * u,
        c = cols[Math.min(cols.length - 1, Math.floor(u * cols.length))];
      B.disc(
        p[0] + Math.cos(ang) * rr,
        p[1] + 0.012 * k,
        p[2] + Math.sin(ang) * rr * pick(o, 'zs', 1),
        [0, 1, 0],
        r * 0.32,
        0.02,
        B.P[c],
        a * (1 - 0.6 * u),
        {
          em: true,
          nd: true
        }
      );
    }
  };

  K.smoke = (st, pool, o) => {
    o = o || {};
    const pal = st.W.pal,
      pk = i => {
        const h = pal[i];
        return ((h >> 16) & 255) + (h & 0xff00) + ((h & 255) << 16);
      },
      ramp = (o.ramp || [1]).map(pk),
      sun = V.norm(o.sun || [-0.4, 0.8, 0.45]),
      cell = o.cell || 0.55,
      life = o.life || 4,
      size = o.size || [0.22, 0.85],
      a0 = o.a === undefined ? 0.34 : o.a,
      shadow = o.shadow === undefined ? 1.6 : o.shadow,
      rise = o.rise === undefined ? 0.9 : o.rise;
    const puffs = [],
      grid = new Map(),
      fv = [0, 0, 0],
      key = (x, y, z) =>
        (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663) ^ (Math.floor(z / cell) * 83492791);
    let acc = 0,
      born = 0;
    const sys = {
      puffs,
      rate: o.rate === undefined ? 9 : o.rate,
      at: o.at || [0, 0, 0],
      flow: o.flow || null,
      puff(p, v) {
        if (puffs.length >= pool.n) return;
        born++;
        puffs.push({
          i: pool.take(),
          p: p.slice(),
          v: v || [(K.hash(born, 1) - 0.5) * 0.5, rise * (0.8 + 0.4 * K.hash(born, 2)), (K.hash(born, 3) - 0.5) * 0.5],
          age: 0,
          life: life * (0.7 + 0.6 * K.hash(born, 4)),
          k: 0.85 + 0.3 * K.hash(born, 5)
        });
      },
      burst(p, n) {
        for (let k = 0; k < n; k++) {
          born++;
          sys.puff(
            [
              p[0] + (K.hash(born, 6) - 0.5) * 0.5,
              p[1] + (K.hash(born, 7) - 0.5) * 0.3,
              p[2] + (K.hash(born, 8) - 0.5) * 0.5
            ],
            [(K.hash(born, 9) - 0.5) * 2.2, 0.6 + K.hash(born, 10), (K.hash(born, 11) - 0.5) * 2.2]
          );
        }
      },
      update(dt, t) {
        acc += sys.rate * dt;
        while (acc >= 1) {
          acc -= 1;
          const a = typeof sys.at === 'function' ? sys.at(t) : sys.at;
          born++;
          sys.puff([a[0] + (K.hash(born, 12) - 0.5) * 0.24, a[1], a[2] + (K.hash(born, 13) - 0.5) * 0.24]);
        }
        grid.clear();
        for (let n = puffs.length - 1; n >= 0; n--) {
          const q = puffs[n];
          q.age += dt;
          if (q.age >= q.life) {
            pool.hide(st, q.i);
            puffs.splice(n, 1);
            continue;
          }
          const p = q.p;
          fv[0] = fv[1] = fv[2] = 0;
          if (sys.flow) sys.flow(p[0], p[1], p[2], t, fv);
          p[0] += (q.v[0] + fv[0]) * dt;
          p[1] += (q.v[1] + fv[1]) * dt;
          p[2] += (q.v[2] + fv[2]) * dt;
          const drag = Math.max(0, 1 - 0.7 * dt);
          q.v[0] *= drag;
          q.v[2] *= drag;
          q.v[1] += (rise * 0.45 - q.v[1]) * Math.min(1, 0.6 * dt);
          const u = q.age / q.life;
          q.s = (size[0] + (size[1] - size[0]) * Math.sqrt(u)) * q.k;
          q.a = a0 * Math.min(1, q.age / 0.25) * (1 - u * u);
          const kk = key(p[0], p[1], p[2]);
          grid.set(kk, (grid.get(kk) || 0) + q.a * q.s * q.s * 4);
        }
        // each puff looks toward the light and adds up how much smoke is in the way: that, not its own age, decides how dark it is
        for (const q of puffs) {
          const p = q.p;
          let od = 0.35 * (grid.get(key(p[0], p[1], p[2])) || 0);
          for (let j = 1; j <= 4; j++)
            od += grid.get(key(p[0] + sun[0] * cell * j, p[1] + sun[1] * cell * j, p[2] + sun[2] * cell * j)) || 0;
          const dark = 1 - Math.exp(-shadow * od);
          pool.put(
            st,
            q.i,
            p[0],
            p[1],
            p[2],
            q.s,
            ramp[Math.min(ramp.length - 1, Math.floor(dark * ramp.length))],
            q.a
          );
        }
      }
    };
    return sys;
  };

  K.mist = (B, o) => {
    o = o || {};
    const n = o.n || 180,
      rad = o.rad || 8,
      y0 = o.y === undefined ? 0.12 : o.y,
      depth = o.depth || 0.5,
      cols = o.cols || [1],
      a = o.a === undefined ? 0.14 : o.a,
      size = o.size || [0.7, 1.5],
      drift = o.drift === undefined ? 0.3 : o.drift,
      first = B.count();
    for (let k = 0; k < n; k++) {
      const ang = B.R() * B.TAU,
        r = rad * Math.sqrt(B.R()),
        x = (o.at ? o.at[0] : 0) + Math.cos(ang) * r,
        z = (o.at ? o.at[2] : 0) + Math.sin(ang) * r * (o.zs || 1);
      if (o.where && !o.where(x, z)) continue;
      const s = B.rr(size[0], size[1]);
      B.axial(x, y0 + B.R() * depth, z, [0, 1, 0], s * 0.3, s, B.P[cols[(B.R() * cols.length) | 0]], a * B.rr(0.6, 1), {
        k: 11,
        ph: B.R() * B.TAU,
        sp: B.rr(0.15, 0.4),
        rg: drift,
        nd: true
      });
    }
    return { first, count: B.count() - first };
  };
  K.shafts = (B, o) => {
    const dir = V.norm(o.dir || [0.5, -0.8, -0.4]),
      len = o.len || 6,
      r = o.r || 0.5,
      n = o.n || 12,
      col = B.P[o.col === undefined ? 1 : o.col],
      a = o.a === undefined ? 0.07 : o.a,
      side = V.norm(V.cross(dir, [0, 0, 1])),
      first = B.count();
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n,
        w = (B.R() - 0.5) * r * 1.6,
        p = V.mad(V.mad(o.from, dir, len * u), side, w);
      B.stick(p[0], p[1], p[2], dir, (len / n) * 1.3, r * (0.35 + 0.5 * B.R()), col, a * (1 - 0.6 * u), {
        k: 7,
        ph: B.R() * B.TAU,
        sp: B.rr(0.3, 0.8),
        em: true,
        nd: true
      });
    }
    return { first, count: B.count() - first };
  };
  K.glint = (B, p, ax, len, col) => {
    const a = V.norm(ax);
    B.stick(p[0], p[1], p[2], a, len, len * 0.16, B.P[col], 3, { em: true, nd: true });
    B.iso(p[0] + a[0] * len * 1.5, p[1] + a[1] * len * 1.5, p[2] + a[2] * len * 1.5, len * 0.14, B.P[col], 3, {
      em: true,
      nd: true
    });
  };
})(KIT);
