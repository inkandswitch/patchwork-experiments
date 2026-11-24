/* kx-life: plants and the parts animals are made of. Each adds ordinary solids (or placed copies), so it lights, shadows, grows (o.born)
   and rigs (o.tag) like anything else.

   Plants
   K.form.colonize(o)          a tree whose crown is filled the way real ones are (space colonisation, after Runions): points are
                       scattered through the crown's shape and the branches grow toward them, each point taken when a branch reaches
                       it; thickness by the pipe model (a limb is as thick as the limbs it carries). o.at, up, trunk (height before
                       it branches, 1.4), crown: { c, r: [rx, ry, rz] } or where(x, y, z), n (points, 360), step (0.16), influence (1.1),
                       kill (0.3), r (a twig's radius, 0.018), seed.  -> { limbs: [{ pts, r0, r1 }], tips: [{ p, dir, r }] } (K.grow.limbs)
   K.form.ribbed(S, pts, rf, mat, o)   a tube with ribs down its length (cactus, gourd, column): rf(t) its radius, o.ribs (12), depth
                       (0.18 of the radius), twist (turns along it)
   K.form.cactus(S, at, mat, o)   a column cactus: a ribbed trunk and arms that turn up, spines along the ribs. o.h (2.4), r (0.3), arms
                       (2), ribs (12), spines (palette colour, or 0), seed
   K.form.rosette(S, at, mat, o)  a succulent: thick pointed leaves in a spiral, the inner ones smaller and more upright. o.n (24), r
                       (0.35), open (0.7), thick (0.35 of a leaf's width), seed
   K.form.shelf(S, on, mat, o)    bracket fungi on a trunk: o.n (6), y [lo, hi], r [lo, hi], bands (ramps, outermost first), seed
   K.form.coral(S, at, mat, o)    o.kind 'branch' (a thicket of blunt fingers) or 'brain' (a dome with winding ridges), r, h, seed
   Creatures
   K.form.shell(S, at, mat, o)    a shell wound on a logarithmic spiral: o.turns (3.2), r (the mouth's radius, 0.4), grow (how much
                       bigger a turn, 2.2), spire (how far each turn steps down its axis: 0 a nautilus, 0.8 a whelk), knobs (per turn),
                       ribs (growth lines), yaw, tilt, lip (true: a lip round the mouth, o.lipMat), inside (the dark within the mouth, a
                       material, or false). Its skin is laid ring by ring along the curve, so tight bends have no
                       gaps. -> the solid, with .mouth (where the opening is) and .curve
   K.form.horn(S, at, dir, mat, o) a horn: o.len (1.2), r (0.12 at the base), curl (turns: a ram's 0.9, a goat's 0.25), twist (out of its
                       plane), rings (ridges along it), side (1 or -1: which way it curls)
   K.form.antler(S, at, dir, mat, o)   a beam that sweeps back and up with tines off its front: o.len (1.4), r (0.06), tines (4), spread
                       (how far they lean forward), side, seed
   K.form.ribs(S, spine, mat, o)  a spine of vertebrae and a pair of ribs at each, curved round the body: spine (a curve, head to tail,
                       or null with o.frame(t) -> { p, T, N, B }: a body that is rigged), o.n (14), from / to (how far along, 0.1, 0.6)
                       or at (the stations, a list), w(t) and h(t) (the body's half width and depth there), r (a rib's thickness), r0(t)
                       and r1(t) (its thickness at the spine and at its end), span (how far round, radians, 2.4), segs (10), arc(frame, t,
                       side, u) -> a point (a rib of your own shape), vertebrae (true), vertebra(S, frame, t) -> where the ribs start (a
                       vertebra of your own), keep(pts, t, side) (only those it passes are made: the ribs near an opening), ribMat(t, side),
                       opts(t, side) (solid options: ghost, tag), tag
   K.form.plumage(B, S, o)        feathers laid as dabs wherever the bake finds a feathered surface: S.capture = it
   K.form.tentacle(S, pts, mat, o)   a tapering arm with suckers in two rows down its underside: o.r [base, tip], up (which way is the
                       top of it at the base), sucker (their material), rows (2), every (how close)
   K.form.shingle(S, on, kind, mat, o)   copies laid over a body overlapping like roof tiles: feathers ('feather') or scales ('scale'),
                       each pointing down a direction field and lifted at its free end. on: the solid they cover; o.flow(p) -> the way
                       they point (or a vector), size (or p -> size), gap (a share of size, 0.55), lift (0.25), where(p), seed */
(function (K) {
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const dice = seed => {
    let s = (Math.floor(Math.abs(seed) * 7919) % 2147483646) + 1;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  };
  // rows: where a copy's x, y and z go, for S.place, from the way its z should point and the way its y should lean
  const turnZ = (z, y0) => {
    const Z = norm(z),
      yd = dot(y0, Z);
    let Y = norm([y0[0] - Z[0] * yd, y0[1] - Z[1] * yd, y0[2] - Z[2] * yd]);
    if (!isFinite(Y[0]) || Math.hypot(...Y) < 0.5)
      Y = Math.abs(Z[1]) < 0.9 ? norm(cross(Z, cross([0, 1, 0], Z))) : [1, 0, 0];
    const X = cross(Y, Z);
    return [X[0], X[1], X[2], Y[0], Y[1], Y[2], Z[0], Z[1], Z[2]];
  };
  const F = K.form || (K.form = {});

  // ---------------------------------------------------------------- plants
  function pipeRadii(nodes, tip, exponent) {
    const radii = new Float32Array(nodes.length);
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!nodes[i].kids) radii[i] = tip;
      const parent = nodes[i].parent;
      if (parent >= 0) radii[parent] = Math.pow(Math.pow(radii[parent], exponent) + Math.pow(radii[i], exponent), 1 / exponent);
    }
    return radii;
  }
  F.pipeRadii = pipeRadii;

  F.colonize = o => {
    o = o || {};
    const R = dice(o.seed || 71),
      at = o.at || [0, 0, 0],
      up = norm(o.up || [0, 1, 0]),
      step = o.step || 0.16,
      inf = o.influence || 1.1,
      kill = o.kill || 0.3,
      trunk = o.trunk === undefined ? 1.4 : o.trunk,
      cr = o.crown || { c: [at[0], at[1] + trunk + 1.2, at[2]], r: [1.6, 1.2, 1.6] },
      inside =
        o.where ||
        ((x, y, z) =>
          ((x - cr.c[0]) / cr.r[0]) ** 2 + ((y - cr.c[1]) / cr.r[1]) ** 2 + ((z - cr.c[2]) / cr.r[2]) ** 2 < 1),
      supplied = o.attractors !== undefined,
      growthMask = o.growthMask,
      maxChecks = o.maxChecks;
    if (supplied && (!Array.isArray(o.attractors) || o.attractors.length > 20000 ||
      !o.attractors.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))))
      throw new Error('Colonization attractors must be a bounded list of finite points');
    if (growthMask !== undefined && typeof growthMask !== 'function')
      throw new Error('Colonization mask must be a function');
    const A = supplied ? o.attractors.map(p => p.slice()) : [];
    let checks = 0;
    for (let t = 0; !supplied && A.length < (o.n || 360) && t < 20000; t++) {
      const p = [
        cr.c[0] + (R() * 2 - 1) * cr.r[0],
        cr.c[1] + (R() * 2 - 1) * cr.r[1],
        cr.c[2] + (R() * 2 - 1) * cr.r[2]
      ];
      if (inside(p[0], p[1], p[2])) A.push(p);
    }
    const nodes = [{ p: at.slice(), parent: -1, kids: 0 }];
    // the trunk, straight up to where the crown begins
    for (let h = step; h <= trunk; h += step) {
      const q = nodes[nodes.length - 1].p,
        w = (supplied ? o.wobble ?? 0 : o.wobble || 0.04) * (R() - 0.5),
        p = [q[0] + up[0] * step + w, q[1] + up[1] * step, q[2] + up[2] * step + w];
      if ((o.maxNodes !== undefined && nodes.length >= o.maxNodes) ||
        (growthMask && !growthMask(...p))) break;
      nodes.push({
        p,
        parent: nodes.length - 1,
        kids: 0
      });
      nodes[nodes.length - 2].kids++;
    }
    const alive = new Uint8Array(A.length).fill(1);
    for (let it = 0; it < (o.iterations || 80); it++) {
      const pull = new Map();
      let any = false;
      for (let a = 0; a < A.length; a++) {
        if (!alive[a]) continue;
        let bi = -1,
          bd = inf * inf;
        for (let i = 0; i < nodes.length; i++) {
          if (maxChecks !== undefined && ++checks > maxChecks) throw new Error('Colonization exceeds its neighbor budget');
          const q = nodes[i].p,
            d = (q[0] - A[a][0]) ** 2 + (q[1] - A[a][1]) ** 2 + (q[2] - A[a][2]) ** 2;
          if (d < kill * kill) {
            alive[a] = 0;
            bi = -1;
            break;
          }
          if (d < bd) ((bd = d), (bi = i));
        }
        if (bi < 0) continue;
        const q = nodes[bi].p,
          d = norm([A[a][0] - q[0], A[a][1] - q[1], A[a][2] - q[2]]),
          s = pull.get(bi) || [0, 0, 0];
        pull.set(bi, [s[0] + d[0], s[1] + d[1], s[2] + d[2]]);
      }
      for (const [i, s] of pull) {
        const d = norm([
            s[0] + up[0] * (o.tropism || 0.15),
            s[1] + up[1] * (o.tropism || 0.15),
            s[2] + up[2] * (o.tropism || 0.15)
          ]),
          q = nodes[i].p,
          p = [q[0] + d[0] * step, q[1] + d[1] * step, q[2] + d[2] * step];
        if (o.maxNodes !== undefined && nodes.length >= o.maxNodes) break;
        if (growthMask && (!growthMask(...p) || !growthMask(...p.map((v, axis) => (v + q[axis]) * 0.5)))) continue;
        if (nodes.some(n => (n.p[0] - p[0]) ** 2 + (n.p[1] - p[1]) ** 2 + (n.p[2] - p[2]) ** 2 < step * step * 0.2))
          continue;
        nodes.push({ p, parent: i, kids: 0 });
        nodes[i].kids++;
        any = true;
      }
      if (!any) break;
    }
    const rad = pipeRadii(nodes, o.r || 0.018, o.pipe || 2.4);
    // limbs: runs of single children between forks
    const kids = nodes.map(() => []);
    nodes.forEach((n, i) => n.parent >= 0 && kids[n.parent].push(i));
    const limbs = [],
      tips = [];
    const walk = (start, i0) => {
      const pts = [nodes[start].p],
        rs = [rad[start]];
      let i = i0;
      for (;;) {
        pts.push(nodes[i].p);
        rs.push(rad[i]);
        if (kids[i].length !== 1) break;
        i = kids[i][0];
      }
      limbs.push({ pts, r0: rs[0], r1: rs[rs.length - 1], depth: 0 });
      if (!kids[i].length) {
        const q = nodes[nodes[i].parent].p;
        tips.push({
          p: nodes[i].p,
          dir: norm([nodes[i].p[0] - q[0], nodes[i].p[1] - q[1], nodes[i].p[2] - q[2]]),
          r: rad[i]
        });
      }
      for (const k of kids[i]) walk(i, k);
    };
    for (const k of kids[0]) walk(0, k);
    return { limbs, tips, nodes };
  };

  F.ribbed = (S, pts, rf, mat, o) => {
    o = o || {};
    const fr = K.curve.frames(pts, o.up || [1, 0, 0]),
      n = fr.length,
      ribs = o.ribs || 12,
      dep = o.depth === undefined ? 0.18 : o.depth,
      tw = (o.twist || 0) * Math.PI * 2,
      L = K.curve.length(pts),
      rmax = Math.max(...pts.map((_, i) => rf(i / (n - 1)))),
      lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9];
    for (const p of pts)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    const bc = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2),
      // the radius in a direction round the axis: the crests sharp, the hollows between them round
      rad = (t, a) => rf(t) * (1 - dep * Math.abs(Math.sin((ribs * (a + tw * t)) / 2)));
    const near = (x, y, z) => {
      let best = 1e9,
        bi = 0,
        bt = 0;
      for (let i = 0; i + 1 < n; i++) {
        const a = fr[i].p,
          b = fr[i + 1].p,
          e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          l2 = dot(e, e) || 1e-9,
          t = Math.max(0, Math.min(1, ((x - a[0]) * e[0] + (y - a[1]) * e[1] + (z - a[2]) * e[2]) / l2)),
          d = (x - a[0] - e[0] * t) ** 2 + (y - a[1] - e[1] * t) ** 2 + (z - a[2] - e[2] * t) ** 2;
        if (d < best) ((best = d), (bi = i), (bt = t));
      }
      return [bi, bt, Math.sqrt(best)];
    };
    const p = {
      bc,
      br: Math.hypot(hi[0] - bc[0], hi[1] - bc[1], hi[2] - bc[2]) + rmax + 0.05,
      along: (x, y, z) => {
        const [i, t] = near(x, y, z);
        return (i + t) / (n - 1);
      },
      sd: (x, y, z) => {
        const [i, t, d] = near(x, y, z),
          F0 = fr[i],
          q = [x - F0.p[0], y - F0.p[1], z - F0.p[2]],
          a = Math.atan2(dot(q, F0.B), dot(q, F0.N)),
          tt = (i + t) / (n - 1);
        return (d - rad(tt, a)) * 0.8;
      },
      sample(f) {
        const res = this.res;
        for (let s = 0; s <= L; s += res * 0.8) {
          const tt = s / L,
            k = tt * (n - 1),
            i = Math.min(n - 2, Math.floor(k)),
            u = k - i,
            A = fr[i],
            Bf = fr[i + 1],
            c = [0, 1, 2].map(j => A.p[j] + (Bf.p[j] - A.p[j]) * u),
            r = rf(tt),
            m = Math.ceil((Math.PI * 2 * r) / (res * 0.8));
          for (let j = 0; j < m; j++) {
            const a = (j / m) * Math.PI * 2,
              rr = rad(tt, a);
            f(
              c[0] + (A.N[0] * Math.cos(a) + A.B[0] * Math.sin(a)) * rr,
              c[1] + (A.N[1] * Math.cos(a) + A.B[1] * Math.sin(a)) * rr,
              c[2] + (A.N[2] * Math.cos(a) + A.B[2] * Math.sin(a)) * rr
            );
          }
        }
        // the ends
        for (const e of [fr[0], fr[n - 1]])
          for (let a = 0; a < 40; a++) {
            const q = Math.sqrt(a / 40) * rf(e === fr[0] ? 0 : 1),
              b = a * 2.399963;
            f(
              e.p[0] + (e.N[0] * Math.cos(b) + e.B[0] * Math.sin(b)) * q,
              e.p[1] + (e.N[1] * Math.cos(b) + e.B[1] * Math.sin(b)) * q,
              e.p[2] + (e.N[2] * Math.cos(b) + e.B[2] * Math.sin(b)) * q
            );
          }
      }
    };
    return S.add(p, mat, Object.assign({ reach: rmax * dep + 0.02 }, o));
  };

  F.cactus = (S, at, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 73),
      h = o.h || 2.4,
      r = o.r || 0.3,
      ribs = o.ribs || 12,
      g = S.grp(r * 0.35),
      parts = [],
      trunk = K.curve.spline(
        [
          [at[0], at[1] - 0.2, at[2]],
          [at[0] + (R() - 0.5) * 0.1, at[1] + h * 0.5, at[2] + (R() - 0.5) * 0.1],
          [at[0] + (R() - 0.5) * 0.15, at[1] + h, at[2] + (R() - 0.5) * 0.15]
        ],
        6
      );
    parts.push(
      F.ribbed(
        S,
        trunk,
        t => r * (t > 0.85 ? Math.sqrt(Math.max(0.05, 1 - ((t - 0.85) / 0.15) ** 2)) : 1),
        mat,
        Object.assign({ ribs, depth: 0.22, res: o.res, born: o.born, tag: o.tag }, g)
      )
    );
    for (let k = 0; k < (o.arms === undefined ? 2 : o.arms); k++) {
      const a = R() * 6.28 + k * 2.6,
        y0 = at[1] + h * (0.35 + 0.25 * R()),
        out = r * (2.2 + R()),
        top = y0 + h * (0.25 + 0.2 * R()),
        dx = Math.cos(a),
        dz = Math.sin(a),
        arm = K.curve.spline(
          [
            [at[0] + dx * r * 0.5, y0, at[2] + dz * r * 0.5],
            [at[0] + dx * out, y0 + 0.05, at[2] + dz * out],
            [at[0] + dx * out * 1.05, top, at[2] + dz * out * 1.05]
          ],
          6
        ),
        ra = r * (0.55 + 0.15 * R());
      parts.push(
        F.ribbed(
          S,
          arm,
          t => ra * (t > 0.82 ? Math.sqrt(Math.max(0.05, 1 - ((t - 0.82) / 0.18) ** 2)) : 1),
          mat,
          Object.assign({ ribs: Math.max(6, ribs - 3), depth: 0.22, res: o.res, born: o.born, tag: o.tag }, g)
        )
      );
    }
    return parts;
  };

  F.rosette = (S, at, mat, o) => {
    o = o || {};
    const n = o.n || 24,
      r = o.r || 0.35,
      thick = o.thick === undefined ? 0.35 : o.thick,
      tpls = [0, 1].map(k =>
        S.template(
          S2 =>
            K.sweep(
              S2,
              [
                [0, 0, 0],
                [0, 0.08 + k * 0.04, 0.5],
                [0, 0.22 + k * 0.06, 1]
              ],
              { w: K.sweep.leaf(0.3), h: t => 0.3 * thick * (1 - t * 0.8), shape: 'round', cup: 0.25, fold: 0.15 },
              mat,
              { res: 0.06 }
            ),
          { res: 0.06 }
        )
      ),
      leaves = K.grow.arrange('rosette', n, {
        rings: o.rings || 4,
        per: Math.ceil(n / (o.rings || 4)),
        r: 1,
        open: o.open === undefined ? 0.7 : o.open
      });
    leaves.forEach((lf, i) => {
      const sz = r * (0.45 + 0.55 * lf.s),
        d = norm(lf.dir),
        p = [at[0] + lf.p[0] * r * 0.15, at[1] + lf.p[1] * r * 0.4, at[2] + lf.p[2] * r * 0.15];
      S.place(tpls[i % 2], p, {
        R: turnZ(d, [0, 1, 0]),
        scale: sz,
        solid: o.solid !== undefined ? o.solid : false,
        born: o.born
      });
    });
    return leaves.length;
  };

  F.shelf = (S, on, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 83),
      sd = typeof on === 'function' ? on : (x, y, z) => S.psd(on, x, y, z),
      c = on.bc || o.c,
      yr = o.y || [c[1] - 0.5, c[1] + 0.8],
      rr = o.r || [0.12, 0.3],
      bands = o.bands || null,
      out = [];
    for (let k = 0; k < (o.n || 6); k++) {
      const a = R() * 6.28,
        y = yr[0] + (yr[1] - yr[0]) * R(),
        dir = [Math.cos(a), 0, Math.sin(a)];
      // in from outside to the trunk's skin
      let q = [c[0] + dir[0] * 3, y, c[2] + dir[2] * 3];
      for (let it = 0; it < 60; it++) {
        const d = sd(q[0], q[1], q[2]);
        if (d < 0.005) break;
        q = [q[0] - dir[0] * d * 0.9, q[1], q[2] - dir[2] * d * 0.9];
      }
      const r = rr[0] + (rr[1] - rr[0]) * R(),
        cen = [q[0] + dir[0] * r * 0.55, q[1], q[2] + dir[2] * r * 0.55],
        m = bands
          ? Object.assign({}, mat, {
              rf: (x, y2, z) =>
                bands[
                  Math.min(bands.length - 1, Math.floor((Math.hypot(x - q[0], z - q[2]) / r) * bands.length * 0.999))
                ]
            })
          : mat;
      // a half-disc, flat beneath and domed a little above, its back in the bark
      out.push(
        S.ball(cen, [r, r * 0.26, r * 0.85], m, {
          res: o.res,
          ax: [dir, [0, 1, 0], cross(dir, [0, 1, 0])],
          g: o.g,
          k: o.k,
          born: o.born
        })
      );
      for (let j = 1; j < 3 && R() < 0.6; j++) {
        const r2 = r * (0.75 - j * 0.15);
        out.push(
          S.ball(
            [cen[0] - dir[0] * r * 0.15, cen[1] - j * r * 0.45, cen[2] - dir[2] * r * 0.15],
            [r2, r2 * 0.26, r2 * 0.85],
            m,
            { res: o.res, ax: [dir, [0, 1, 0], cross(dir, [0, 1, 0])], born: o.born }
          )
        );
      }
    }
    return out;
  };

  F.coral = (S, at, mat, o) => {
    o = o || {};
    if (o.kind === 'brain') {
      const r = o.r || 0.6,
        w = K.tex.noise(1.6 / r, 2),
        ball = S.ball([at[0], at[1] + r * 0.45, at[2]], [r, r * 0.75, r], mat, { hold: true, res: o.res });
      // winding ridges: bands round the dome bent by noise
      return S.displace(
        ball,
        (x, y, z) => 0.5 + 0.5 * Math.sin((x * 1.0 + z * 0.7) * (9 / r) + w(x, y, z) * 9),
        r * 0.06,
        { res: o.res, born: o.born, tag: o.tag }
      );
    }
    const gr = K.grow.branch({
      at,
      dir: [0, 1, 0],
      len: o.h || 0.7,
      r: o.r || 0.07,
      depth: o.depth || 3,
      forks: 3,
      spread: 0.55,
      shrink: 0.78,
      droop: 0,
      wobble: 0.35,
      seed: o.seed || 89
    });
    K.grow.limbs(S, gr, mat, { res: o.res, melt: 0.04, born: o.born, tag: o.tag });
    for (const t of gr.tips) S.ball(t.p, t.r * 1.5, mat, { res: o.res, born: o.born, tag: o.tag });
    return gr;
  };

  // ---------------------------------------------------------------- creatures
  F.shell = (S, at, mat, o) => {
    o = o || {};
    const turns = o.turns || 3.2,
      grow = o.grow || 2.2,
      rm = o.r || 0.4,
      spire = o.spire === undefined ? 0.8 : o.spire,
      yaw = o.yaw || 0,
      tilt = o.tilt || 0,
      b = Math.log(grow) / (Math.PI * 2),
      th1 = turns * Math.PI * 2,
      // the tube's radius against the coil's: a nautilus's whorls touch, a whelk's overlap
      k = o.tube || 0.55,
      pts = [];
    const N = Math.ceil(turns * 20);
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * th1,
        Rr = rm * Math.exp(b * (th - th1)),
        x = Rr * Math.cos(th + yaw),
        z = Rr * Math.sin(th + yaw),
        y = -spire * Rr * 1.1;
      // tilted about x
      pts.push([
        at[0] + x,
        at[1] + y * Math.cos(tilt) - z * Math.sin(tilt),
        at[2] + y * Math.sin(tilt) + z * Math.cos(tilt)
      ]);
    }
    const rOf = t =>
      k * rm * Math.exp(b * (t * th1 - th1)) * (1 + (o.ribs ? 0.05 * Math.sin(t * th1 * (o.ribs / (Math.PI * 2))) : 0));
    const s = S.tube(pts, rOf, 0, mat, { res: o.res, tag: o.tag, born: o.born, g: o.g, k: o.k });
    /* (following the shell's curve) its skin is laid ring by ring along the true curve, close enough that the outside of each tight bend
       has no gaps, and the closed apex gets a cap */
    const fr = K.curve.frames(pts, o.up || [0, 1, 0]),
      cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(
        cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
      );
    const Ltot = cum[cum.length - 1];
    s.sample = function (f) {
      const res = this.res,
        M = Math.ceil(Ltot / (res * 0.5));
      let i = 0;
      for (let j = 0; j < M; j++) {
        const l = ((j + 0.5) / M) * Ltot;
        while (i < pts.length - 2 && cum[i + 1] < l) i++;
        const u = (l - cum[i]) / (cum[i + 1] - cum[i] || 1),
          A = fr[i],
          c = [0, 1, 2].map(k => pts[i][k] + (pts[i + 1][k] - pts[i][k]) * u),
          r = rOf((i + u) / (pts.length - 1)),
          cnt = Math.max(4, Math.ceil((Math.PI * 2 * r) / res));
        for (let k = (j % 2) * 0.5; k < cnt; k++) {
          const a = (k / cnt) * Math.PI * 2,
            ca = Math.cos(a) * r,
            sa = Math.sin(a) * r;
          f(c[0] + A.N[0] * ca + A.B[0] * sa, c[1] + A.N[1] * ca + A.B[1] * sa, c[2] + A.N[2] * ca + A.B[2] * sa);
        }
      }
      const r0 = rOf(0),
        n0 = Math.max(6, Math.ceil((12.6 * r0 * r0) / (res * res)));
      for (let k = 0; k < n0; k++) {
        const y = 1 - (2 * (k + 0.5)) / n0,
          q = Math.sqrt(1 - y * y),
          a = k * 2.399963;
        f(pts[0][0] + Math.cos(a) * q * r0, pts[0][1] + y * r0, pts[0][2] + Math.sin(a) * q * r0);
      }
    };
    // the mouth: a lip round it, and the dark of the inside
    if (o.lip !== false) {
      const N0 = pts.length - 1,
        T = norm([pts[N0][0] - pts[N0 - 1][0], pts[N0][1] - pts[N0 - 1][1], pts[N0][2] - pts[N0 - 1][2]]),
        rm2 = rOf(1),
        ref = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0],
        Uu = norm(cross(ref, T));
      S.torus(pts[N0], rm2 * 0.92, rm2 * 0.14, o.lipMat || mat, {
        ax: [Uu, T, cross(Uu, T)],
        res: o.res,
        tag: o.tag,
        g: s.g,
        k: rm2 * 0.1
      });
      if (o.inside !== false)
        S.ball(
          [pts[N0][0] - T[0] * rm2 * 0.45, pts[N0][1] - T[1] * rm2 * 0.45, pts[N0][2] - T[2] * rm2 * 0.45],
          rm2 * 0.82,
          o.inside || { r: [1, 1, 2] },
          { res: o.res, tag: o.tag, neg: true }
        );
    }
    // a row of knobs along the shoulder of every turn
    if (o.knobs)
      for (let i = 1; i < N; i++) {
        if (i % Math.max(1, Math.round(20 / o.knobs))) continue;
        const t = i / N,
          p = pts[i],
          c0 = [at[0], p[1], at[2]],
          out = norm([p[0] - c0[0], 0, p[2] - c0[2]]),
          r = rOf(t);
        S.ball([p[0] + out[0] * r * 0.5, p[1] + r * 0.75, p[2] + out[2] * r * 0.5], r * 0.32, mat, {
          res: o.res,
          tag: o.tag,
          g: s.g,
          k: r * 0.2
        });
      }
    s.mouth = pts[N];
    s.curve = pts;
    return s;
  };

  F.horn = (S, at, dir, mat, o) => {
    o = o || {};
    const len = o.len || 1.2,
      r = o.r || 0.12,
      curl = o.curl === undefined ? 0.6 : o.curl,
      side = o.side || 1,
      D = norm(dir),
      upv = o.up ? norm(o.up) : Math.abs(D[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0],
      Sd = norm(cross(D, upv)),
      U = cross(Sd, D),
      n = 24,
      pts = [];
    let p = at.slice(),
      d = D.slice();
    const ang = (curl * Math.PI * 2) / n;
    for (let i = 0; i <= n; i++) {
      pts.push(p.slice());
      // turn in the plane of D and down (a ram's curls back and round), twisting out of it
      const c = Math.cos(ang),
        s2 = Math.sin(ang);
      const dn = [-U[0], -U[1], -U[2]];
      d = norm([
        d[0] * c + dn[0] * s2 * (i > 0 ? 1 : 1) + Sd[0] * side * (o.twist || 0.12) * 0.1,
        d[1] * c + dn[1] * s2 + Sd[1] * side * (o.twist || 0.12) * 0.1,
        d[2] * c + dn[2] * s2 + Sd[2] * side * (o.twist || 0.12) * 0.1
      ]);
      // the plane itself turns as it goes round
      const nu = norm(cross(d, Sd));
      U[0] = -nu[0];
      U[1] = -nu[1];
      U[2] = -nu[2];
      p = [p[0] + d[0] * (len / n), p[1] + d[1] * (len / n), p[2] + d[2] * (len / n)];
    }
    const rings = o.rings || 0;
    return S.tube(
      pts,
      t => r * (1 - 0.85 * t) * (1 + (rings ? 0.07 * Math.max(0, Math.sin(t * rings * Math.PI * 2)) : 0)),
      0,
      mat,
      { res: o.res, tag: o.tag, born: o.born, g: o.g, k: o.k }
    );
  };

  F.antler = (S, at, dir, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 97),
      len = o.len || 1.4,
      r = o.r || 0.06,
      side = o.side || 1,
      D = norm(dir),
      back = norm(o.back || [0, 0, -1]),
      grp = S.grp(r * 0.4),
      beam = K.curve.spline(
        [
          at,
          [at[0] + D[0] * len * 0.35, at[1] + D[1] * len * 0.35 + len * 0.1, at[2] + D[2] * len * 0.35],
          [
            at[0] + D[0] * len * 0.55 + back[0] * len * 0.25,
            at[1] + len * 0.6,
            at[2] + D[2] * len * 0.55 + back[2] * len * 0.25
          ],
          [
            at[0] + D[0] * len * 0.5 - back[0] * len * 0.05,
            at[1] + len * 0.95,
            at[2] + D[2] * len * 0.5 - back[2] * len * 0.05
          ]
        ],
        6
      ),
      parts = [S.tube(beam, r, r * 0.35, mat, Object.assign({ res: o.res, tag: o.tag, born: o.born }, grp))];
    // the burr where it leaves the skull
    parts.push(S.torus(at, r * 1.15, r * 0.35, mat, Object.assign({ res: o.res, tag: o.tag, ax: frameOf(D) }, grp)));
    const fw = norm([-back[0], 0, -back[2]]);
    for (let k = 0; k < (o.tines || 4); k++) {
      const t = 0.2 + (k / Math.max(1, (o.tines || 4) - 1)) * 0.65,
        p = K.curve.at(beam, t),
        L = len * (0.42 - 0.18 * t) * (0.8 + 0.4 * R()),
        dd = norm([fw[0] * (o.spread || 0.8) + D[0] * 0.2 * side, 1, fw[2] * (o.spread || 0.8) + D[2] * 0.2 * side]),
        tip = [p[0] + dd[0] * L, p[1] + dd[1] * L, p[2] + dd[2] * L],
        mid = [(p[0] + tip[0]) / 2 + fw[0] * L * 0.1, (p[1] + tip[1]) / 2, (p[2] + tip[2]) / 2 + fw[2] * L * 0.1];
      parts.push(
        S.tube(
          [p, mid, tip],
          r * (0.75 - t * 0.3),
          r * 0.18,
          mat,
          Object.assign({ res: o.res, tag: o.tag, born: o.born }, grp)
        )
      );
    }
    return parts;
  };
  // a frame whose y runs along D (a ring made about its y then circles D)
  const frameOf = D => {
    const ref = Math.abs(D[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0],
      U = norm(cross(ref, D));
    return [U, D, cross(U, D)];
  };

  F.ribs = (S, spine, mat, o) => {
    o = o || {};
    const fr = spine ? K.curve.frames(K.curve.resample(spine, 80), o.up || [0, 1, 0]) : null,
      frameAt =
        o.frame ||
        (t => {
          const f = t * (fr.length - 1),
            i = Math.min(fr.length - 2, Math.floor(f));
          return fr[i];
        }),
      n = o.n || 14,
      from = o.from === undefined ? 0.1 : o.from,
      to = o.to === undefined ? 0.6 : o.to,
      stations = o.at || Array.from({ length: n }, (_, k) => from + ((to - from) * k) / Math.max(1, n - 1)),
      w = typeof o.w === 'function' ? o.w : () => o.w || 0.8,
      h = typeof o.h === 'function' ? o.h : () => o.h || 0.9,
      r = o.r || 0.045,
      span = o.span === undefined ? 2.4 : o.span,
      segs = o.segs || 10,
      r0 = o.r0 || (t => r * (1 - 0.3 * Math.abs(t - 0.3))),
      r1 = o.r1 || (() => r * 0.55),
      out = { vertebrae: [], ribs: [] };
    // (the default rib: from the spine, round the side and down an arc of the body's section, a little swept back)
    const arc =
      o.arc ||
      ((F, t, sg, u) => {
        const W = w(t),
          H = h(t),
          a = u * span,
          cy = -H * (1 - Math.cos(a)) * 0.5 - H * 0.08 * u,
          cx = W * Math.sin(a) * sg,
          back = -0.12 * W * u * u;
        return [
          F.p[0] + F.B[0] * cx + F.N[0] * cy + F.T[0] * back,
          F.p[1] + F.B[1] * cx + F.N[1] * cy + F.T[1] * back,
          F.p[2] + F.B[2] * cx + F.N[2] * cy + F.T[2] * back
        ];
      });
    if (o.vertebrae !== false && !o.vertebra && fr)
      for (let k = 0; k <= Math.round(n * 1.6); k++) {
        const t = k / Math.round(n * 1.6),
          F0 = frameAt(t),
          sz = (o.vr || r * 2.2) * (1 - 0.6 * Math.abs(t - 0.35));
        out.vertebrae.push(
          S.ball(F0.p, [sz, sz * 0.9, sz * 0.7], mat, { res: o.res, tag: o.tag, ax: [F0.B, F0.N, F0.T] })
        );
        S.tube(
          [F0.p, [F0.p[0] + F0.N[0] * sz * 1.8, F0.p[1] + F0.N[1] * sz * 1.8, F0.p[2] + F0.N[2] * sz * 1.8]],
          sz * 0.35,
          sz * 0.15,
          mat,
          { res: o.res, tag: o.tag }
        );
      }
    for (const t of stations) {
      const F0 = frameAt(t),
        // o.vertebra(S, frame, t): makes the vertebra there itself and gives back the point the ribs grow from (or nothing)
        V = o.vertebra ? o.vertebra(S, F0, t) : null;
      for (const sg of [-1, 1]) {
        const pts = V ? [V] : [];
        for (let j = 0; j <= segs; j++) pts.push(arc(F0, t, sg, j / segs));
        // o.keep(pts, t, side): only the ribs it passes are made (those near an opening, say: nothing hidden is sculpted)
        if (o.keep && !o.keep(pts, t, sg)) continue;
        out.ribs.push(
          S.tube(
            pts,
            r0(t),
            r1(t),
            o.ribMat ? o.ribMat(t, sg) : mat,
            Object.assign({ res: o.res, tag: o.tag, born: o.born }, o.opts ? o.opts(t, sg) : {})
          )
        );
      }
    }
    return out;
  };

  /* K.form.plumage(B, S, o): feathers laid as dabs (cheap: no copies). Set S.capture to what this gives back,
     bake, and S.capture = null after: wherever the bake finds the surface of a solid whose material has fe: { l, w, dir } a feather is
     laid there, pointing down dir (a vector or (x, y, z) -> vector; o.down otherwise), lifted off the body, its tone from how the light
     falls, darker where m.bar(x, y, z) says, with a plain disc under it. o.skip(pr, m, x, y, z): lay nothing there (where the flesh has
     gone); o.flat(m, x, y, z, t) -> a palette colour for a plain disc instead (bare skin, a skull showing); o.part(pr, fn): run fn as
     the part pr belongs to (a rig); o.anim: how the feathers stir. */
  F.plumage = (B, S, o) => {
    o = o || {};
    const pick = (ramp, q) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(q * ramp.length)))],
      DOWN = o.down || [0, -1, 0];
    return (pr, m, res, x, y, z, nx, ny, nz, ao) => {
      if (o.skip && o.skip(pr, m, x, y, z)) return;
      if (ao === undefined) ao = 1;
      const L = S.sun,
        lay = () => {
          const t =
              ao * (S.amb + S.sky * (0.5 + 0.5 * ny)) +
              S.sunK * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * (0.35 + 0.65 * ao) +
              (m.mod ? m.mod(x, y, z) : 0) +
              0.1 * (B.R() - 0.5),
            fl = o.flat ? o.flat(m, x, y, z, t) : m.flat ? m.flat(x, y, z, t) : undefined;
          if (fl !== undefined) {
            B.disc(x, y, z, [nx, ny, nz], res * 0.46, res * 0.3, B.P[fl], 3);
            return;
          }
          B.disc(x, y, z, [nx, ny, nz], res * 0.46, res * 0.3, B.P[pick(m.r, t - 0.2)], 3);
          if (!m.fe) return;
          const dn = m.fe.dir ? (typeof m.fe.dir === 'function' ? m.fe.dir(x, y, z) : m.fe.dir) : DOWN,
            k = dn[0] * nx + dn[1] * ny + dn[2] * nz,
            d = [dn[0] - nx * (k - 0.2), dn[1] - ny * (k - 0.2), dn[2] - nz * (k - 0.2)],
            dl = Math.hypot(d[0], d[1], d[2]);
          if (dl < 0.08) return;
          const len = m.fe.l * (0.75 + 0.5 * B.R());
          B.stick(
            x + nx * 0.05 + (d[0] / dl) * len * 0.5,
            y + ny * 0.05 + (d[1] / dl) * len * 0.5,
            z + nz * 0.05 + (d[2] / dl) * len * 0.5,
            [d[0] / dl, d[1] / dl, d[2] / dl],
            len * 0.55,
            m.fe.w,
            B.P[pick(m.r, t - (m.bar && m.bar(x, y, z) ? 0.26 : 0))],
            3,
            o.anim
          );
        };
      if (o.part) o.part(pr, lay);
      else lay();
    };
  };

  F.tentacle = (S, pts, mat, o) => {
    o = o || {};
    const rr = o.r || [0.12, 0.015],
      rOf = t => rr[0] + (rr[1] - rr[0]) * Math.pow(t, 0.8),
      body = S.tube(pts, rOf, 0, mat, { res: o.res, tag: o.tag, born: o.born }),
      sm = o.sucker || mat,
      // (the cups sampled coarsely: a copy's dabs are the template's spacing times its size)
      cr0 = Math.max(0.15, Math.min(0.6, (o.dab || 0.02) / (rr[0] * 0.55))),
      cup = S.template(S2 => S2.lathe([0, 0, 0], 0.5, t => 0.5 - 0.1 * t, sm, { res: cr0 }), { res: cr0 }),
      fr = K.curve.frames(K.curve.resample(pts, 120), o.up || [0, 1, 0]),
      every = o.every || 0.9;
    let s = 0,
      row = 0;
    const L = K.curve.length(pts);
    while (s < L * 0.96) {
      const t = s / L,
        F0 = fr[Math.min(fr.length - 1, Math.round(t * (fr.length - 1)))],
        r = rOf(t),
        off = (o.rows || 2) > 1 ? (row % 2 ? 0.45 : -0.45) : 0,
        dn = [-F0.N[0], -F0.N[1], -F0.N[2]],
        // round the underside, a little to either side
        out = norm([dn[0] + F0.B[0] * off, dn[1] + F0.B[1] * off, dn[2] + F0.B[2] * off]),
        p = [F0.p[0] + out[0] * r * 0.92, F0.p[1] + out[1] * r * 0.92, F0.p[2] + out[2] * r * 0.92];
      S.place(cup, p, { R: turnZ(F0.T, out), scale: r * 0.55, solid: false, born: o.born });
      s += r * every * ((o.rows || 2) > 1 ? 0.6 : 1);
      row++;
    }
    return body;
  };

  F.shingle = (S, on, kind, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 101),
      sd = (x, y, z) => S.psd(on, x, y, z),
      size = typeof o.size === 'function' ? o.size : () => o.size || 0.12,
      gap = o.gap || 0.55,
      lift = o.lift === undefined ? 0.25 : o.lift,
      flow = typeof o.flow === 'function' ? o.flow : () => o.flow || [0, -1, 0],
      /* a copy's dabs are as far apart as the template's, times its size: so the template is sampled coarsely enough that a scale or a
         feather comes out at o.dab apart (0.022), not a cloud of dots far finer than a pixel */
      s0 = size(on.bc || [0, 0, 0]),
      tres = Math.max(0.12, Math.min(0.7, (o.dab || 0.022) / s0)),
      // a feather: a vane on a quill, pointed; a scale: a rounded plate with a keel
      tpl =
        kind === 'scale'
          ? S.template(S2 => S2.ball([0, 0, 0.5], [0.42, 0.1, 0.55], mat, { res: tres }), { res: tres })
          : S.template(
              S2 =>
                K.sweep(
                  S2,
                  [
                    [0, 0, 0],
                    [0, 0.02, 0.5],
                    [0, 0.0, 1]
                  ],
                  { w: K.sweep.leaf(0.22), h: 0.025, fold: 0.25 },
                  mat,
                  { res: tres }
                ),
              { res: tres }
            ),
      pts = [],
      cell = new Map(),
      key = (x, y, z, c) => Math.floor(x / c) + ',' + Math.floor(y / c) + ',' + Math.floor(z / c);
    // points over the body's own surface, no two closer than gap times their size
    const keep = on.res;
    on.res = o.step || 0.06;
    on.sample((x, y, z) => {
      let q = [x, y, z];
      for (let it = 0; it < 6; it++) {
        const d = sd(q[0], q[1], q[2]);
        if (Math.abs(d) < 0.002) break;
        const e = 0.004,
          g = norm([sd(q[0] + e, q[1], q[2]) - d, sd(q[0], q[1] + e, q[2]) - d, sd(q[0], q[1], q[2] + e) - d]);
        q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
      }
      if (o.where && !o.where(q)) return;
      const s = size(q),
        c = s * gap,
        k = key(q[0], q[1], q[2], c);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (let d = -1; d <= 1; d++) {
            const L = cell.get(
              Math.floor(q[0] / c) + a + ',' + (Math.floor(q[1] / c) + b) + ',' + (Math.floor(q[2] / c) + d)
            );
            if (L) for (const p of L) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 < c * c) return;
          }
      (cell.get(k) || cell.set(k, []).get(k)).push(q);
      pts.push(q);
    });
    on.res = keep;
    for (const q of pts) {
      const e = 0.004,
        d = sd(q[0], q[1], q[2]),
        nrm = norm([sd(q[0] + e, q[1], q[2]) - d, sd(q[0], q[1] + e, q[2]) - d, sd(q[0], q[1], q[2] + e) - d]),
        f0 = flow(q),
        fd = dot(f0, nrm),
        along = norm([
          f0[0] - nrm[0] * fd + (R() - 0.5) * 0.15,
          f0[1] - nrm[1] * fd + (R() - 0.5) * 0.15,
          f0[2] - nrm[2] * fd + (R() - 0.5) * 0.15
        ]),
        // pointing down the flow and lifted off the body toward its free end
        z = norm([along[0] + nrm[0] * lift, along[1] + nrm[1] * lift, along[2] + nrm[2] * lift]),
        s = size(q) * (0.85 + 0.3 * R());
      S.place(tpl, [q[0] - nrm[0] * s * 0.05, q[1] - nrm[1] * s * 0.05, q[2] - nrm[2] * s * 0.05], {
        R: turnZ(z, nrm),
        scale: s,
        solid: false,
        born: o.born
      });
    }
    return pts.length;
  };
})(KIT);
