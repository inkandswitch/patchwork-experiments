/* ka-build: things built to rule (after Inkwell's Object Studio). Two rules run through all of them:
     fixed parts never stretch (a base, a capital, a collar, a post keep their size whatever the span);
     repeated parts are fitted (the span is cut into a whole number of equal bays as near the wanted size as it will go).
   Every builder returns { recipe, sockets, rules }: what it was asked for, named points on it to attach things to, and the rules it kept.
     K.fit(span, unit, min)                 -> { n, size }
     K.build.pillar(S, base, height, o)     o: r, bay, flutes, mats: { stone }, tag
     K.build.fence(S, a, b, o)              o: h, bay, ground(x, z), pickets, mats: { post, rail }
     K.build.stairs(S, foot, dir, rise, o)  o: width, riser, tread, mats: { stone }
     K.build.arch(S, c, o)                  o: span, height, depth, thick, block, face [x, z], mats: { stone }
     K.build.pipe(S, pts, o)                o: r, wall, collar, mats: { metal }     (hollow: the bore is checked to be clear)
   S must have been through K.sculpt. Materials are roles: pass the ramps your palette has for them. */
(function (K) {
  const V = K.V;
  K.fit = (span, unit, min) => {
    const n = Math.max(min || 1, Math.round(span / unit));
    return { n, size: span / n };
  };
  const H = { hold: true },
    withTag = (o, extra) =>
      Object.assign({}, extra, o?.tag ? { tag: o.tag } : {}, o?.res ? { res: o.res } : {},
        o?.objectId !== undefined ? { objectId: o.objectId } : {}, o?.target ? { target: o.target } : {});
  K.build = {
    pillar(S, base, height, o) {
      o = o || {};
      const r = o.r || 0.6,
        m = (o.mats || {}).stone || { r: [1] },
        bh = r * 0.7,
        ch = r * 0.8,
        shaft = Math.max(0.1, height - bh - ch),
        f = K.fit(shaft, o.bay || r * 1.6),
        x = base[0],
        y = base[1],
        z = base[2],
        t = withTag(o);
      S.lathe([x, y, z], bh, [r * 1.45, r * 1.15], m, t);
      S.lathe([x, y + height - ch, z], ch, [r * 1.05, r * 1.5], m, t);
      // the shaft: one drum per bay, a hair narrower at each joint; flutes are cut the whole height
      const col = S.lathe(
        [x, y + bh, z],
        shaft,
        u => r * (1 - 0.06 * Math.pow(Math.abs(Math.sin(u * Math.PI * f.n)), 12)),
        m,
        H
      );
      if (o.flutes)
        S.join(
          'cut',
          col,
          S.fold(S.lathe([x + r, y + bh + 0.05, z], shaft - 0.1, r * 0.17, m, H), { polar: o.flutes, c: [x, y, z] }, H),
          t
        );
      else S.add(col, m, t);
      return {
        recipe: { kind: 'pillar', base, height, r, bay: f.size, bays: f.n },
        sockets: { top: { p: [x, y + height, z], dir: [0, 1, 0] }, foot: { p: base, dir: [0, -1, 0] } },
        rules: ['base and capital keep their height; the shaft is ' + f.n + ' fitted bays']
      };
    },
    fence(S, a, b, o) {
      o = o || {};
      const h = o.h || 1,
        mats = o.mats || {},
        mp = mats.post || { r: [1] },
        mr = mats.rail || mp,
        gy = o.ground || (() => a[1]),
        d = [b[0] - a[0], b[2] - a[2]],
        len = Math.hypot(d[0], d[1]),
        f = K.fit(len, o.bay || 1.2),
        t = withTag(o),
        posts = [];
      for (let k = 0; k <= f.n; k++) {
        const x = a[0] + (d[0] * k) / f.n,
          z = a[2] + (d[1] * k) / f.n,
          y = gy(x, z);
        posts.push([x, y, z]);
        S.box([x, y + h / 2, z], [0.07, h / 2, 0.07], mp, Object.assign({ rd: 0.02 }, t));
        S.ball([x, y + h + 0.05, z], 0.1, mp, t);
      }
      // rails run from post to post, so on a slope each takes the angle of its own bay; pickets stand on the lower rail's line
      for (let k = 0; k < f.n; k++) {
        const p = posts[k],
          q = posts[k + 1];
        for (const u of [0.35, 0.8])
          S.tube(
            [
              [p[0], p[1] + h * u, p[2]],
              [q[0], q[1] + h * u, q[2]]
            ],
            0.04,
            0.04,
            mr,
            t
          );
        if (o.pickets) {
          const pf = K.fit(f.size, 0.22);
          for (let j = 1; j < pf.n; j++) {
            const s = j / pf.n,
              x = p[0] + (q[0] - p[0]) * s,
              z = p[2] + (q[2] - p[2]) * s,
              y = p[1] + (q[1] - p[1]) * s;
            S.tube(
              [
                [x, y + h * 0.2, z],
                [x, y + h * 0.95, z]
              ],
              0.035,
              0.02,
              mr,
              t
            );
          }
        }
      }
      return {
        recipe: { kind: 'fence', a, b, h, bay: f.size, bays: f.n },
        sockets: { start: { p: posts[0], dir: [0, 1, 0] }, end: { p: posts[f.n], dir: [0, 1, 0] } },
        rules: [
          'posts are evenly spaced: ' + f.n + ' bays of ' + f.size.toFixed(2),
          'each post stands on the ground under it; rails follow the slope'
        ]
      };
    },
    stairs(S, foot, dir, rise, o) {
      o = o || {};
      const w = o.width || 1.6,
        m = (o.mats || {}).stone || { r: [1] },
        f = K.fit(rise, o.riser || 0.24),
        tread = o.tread || 0.34,
        dn = V.norm([dir[0], 0, dir[1] === undefined ? dir[2] : dir[1]]),
        side = [-dn[2], 0, dn[0]],
        t = withTag(o),
        ax = [dn, [0, 1, 0], side];
      // each step is a block from the floor up to its own height, so the flight is solid underneath
      for (let k = 0; k < f.n; k++) {
        const hh = (k + 1) * f.size,
          c = [foot[0] + dn[0] * (k + 0.5) * tread, foot[1] + hh / 2, foot[2] + dn[2] * (k + 0.5) * tread];
        S.box(c, [tread / 2 + 0.03, hh / 2, w / 2], m, Object.assign({ ax, rd: 0.025 }, t));
      }
      const top = [foot[0] + dn[0] * f.n * tread, foot[1] + rise, foot[2] + dn[2] * f.n * tread];
      return {
        recipe: { kind: 'stairs', foot, rise, risers: f.n, riser: f.size, tread },
        sockets: { foot: { p: foot, dir: V.mul(dn, -1) }, top: { p: top, dir: dn } },
        rules: [f.n + ' risers of ' + f.size.toFixed(3) + ' exactly make up the rise']
      };
    },
    arch(S, c, o) {
      o = o || {};
      const span = o.span || 3,
        height = o.height || 4,
        depth = o.depth || 0.8,
        th = o.thick || 0.5,
        m = (o.mats || {}).stone || { r: [1] },
        fx = o.face ? V.norm([o.face[0], 0, o.face[1]]) : [0, 0, 1],
        sx = [fx[2], 0, -fx[0]],
        R = span / 2 + th / 2,
        spring = Math.max(0.2, height - span / 2 - th),
        t = withTag(o),
        f = K.fit(Math.PI * R, o.block || 0.55);
      for (const sg of [-1, 1])
        S.box(
          [c[0] + sx[0] * sg * R, c[1] + spring / 2, c[2] + sx[2] * sg * R],
          [th / 2, spring / 2, depth / 2],
          m,
          Object.assign({ ax: [sx, [0, 1, 0], fx], rd: 0.03 }, t)
        );
      // the ring: separate blocks, each turned to face the middle, with a thin gap between so they read as stones
      for (let k = 0; k < f.n; k++) {
        const a = ((k + 0.5) / f.n) * Math.PI,
          ca = Math.cos(a),
          sa = Math.sin(a),
          p = [c[0] + sx[0] * ca * R, c[1] + spring + sa * R, c[2] + sx[2] * ca * R],
          rad = [sx[0] * ca, sa, sx[2] * ca],
          tan = [-sx[0] * sa, ca, -sx[2] * sa];
        S.box(
          p,
          [th / 2, f.size / 2 - 0.02, depth / 2 + (k === f.n >> 1 ? 0.06 : 0)],
          m,
          Object.assign({ ax: [rad, tan, fx], rd: 0.03 }, t)
        );
      }
      return {
        recipe: { kind: 'arch', c, span, height, blocks: f.n },
        sockets: {
          key: { p: [c[0], c[1] + spring + R + th / 2, c[2]], dir: [0, 1, 0] },
          through: { p: [c[0], c[1] + spring * 0.5, c[2]], dir: fx }
        },
        rules: [
          'the ring is ' + f.n + ' fitted stones of their own thickness',
          'the piers rise to the springing line for the height asked'
        ]
      };
    },
    pipe(S, pts, o) {
      o = o || {};
      const r = o.r || 0.5,
        wall = o.wall || 0.09,
        m = (o.mats || {}).metal || { r: [1] },
        t = withTag(o),
        n = pts.length,
        e0 = V.norm(V.sub(pts[0], pts[1])),
        e1 = V.norm(V.sub(pts[n - 1], pts[n - 2]));
      // the bore is a second, thinner pipe taken out of the first; it runs on a little past each end so the ends are open
      const outer = S.tube(pts, r, r, m, H),
        bore = S.tube(
          [V.mad(pts[0], e0, r)].concat(pts.slice(1, n - 1), [V.mad(pts[n - 1], e1, r)]),
          r - wall,
          r - wall,
          m,
          H
        );
      S.join('cut', outer, bore, Object.assign({ inner: o.inner }, t));
      for (const [p, d] of [
        [pts[0], e0],
        [pts[n - 1], e1]
      ]) {
        const bs = basis(d),
          q = V.mad(p, d, -0.12);
        S.join(
          'cut',
          S.lathe(q, o.collar || 0.2, r + wall * 1.4, m, { hold: true, ax: [bs.rt, bs.f, bs.up] }),
          S.lathe(V.mad(q, d, -0.1), (o.collar || 0.2) + 0.2, r - wall, m, { hold: true, ax: [bs.rt, bs.f, bs.up] }),
          t
        );
      }
      return {
        recipe: { kind: 'pipe', pts, r, wall },
        sockets: { a: { p: pts[0], dir: e0 }, b: { p: pts[n - 1], dir: e1 } },
        rules: [
          'cross-section and wall stay constant along the run',
          'collars are a fixed size; the bore is open end to end'
        ],
        // is the middle of the pipe empty all the way along? (call after the solids exist; uses the sculpt's field)
        clear: () => {
          for (let k = 0; k < n - 1; k++)
            for (let s = 0; s <= 8; s++) {
              const p = V.lerp(pts[k], pts[k + 1], s / 8);
              if (S.sdf(p[0], p[1], p[2]) < 0.02) return false;
            }
          return true;
        }
      };
    }
  };
  // artwork from a grid of characters, one per pixel, for faces that want hard pixels and not curves. map: character -> palette index; anything else is clear
  K.art.pixels = (rows, map) => {
    const h = rows.length,
      w = rows[0].length,
      grid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const q = map[rows[y][x]];
        grid[y * w + x] = q === undefined ? 0 : q + 1;
      }
    return {
      res: w,
      grid,
      animated: false,
      stamp: 0,
      raster: () => grid,
      at: (u, v) =>
        u < 0 || u >= 1 || v < 0 || v >= 1 ? -1 : grid[Math.floor((1 - v) * h) * w + Math.floor(u * w)] - 1
    };
  };
})(KIT);
