/* ku-motion: more on the cloth-and-hair solver, and other things that move by a rule. Each lays its dabs before B.finish (as cloth and
   hair do) and gives back a stage system: st.add(it).

   K.xpbd.rope(B, o)       a rope or a chain hung between two points (a bridge's handrail, a lantern's chain): o.from, to, n (segments,
                           16), slack (how much longer than the gap, 1.12), pinA (true), pinB (true; false: it hangs free from `from`), or
                           functions t -> where (moving ends), kind 'rope' | 'chain', width (0.025), ramp (dark to light), mass (0.05 a
                           point), comp (0: no stretch), tear (a rope that can snap), sim (share one), and the sim options (sdf, spheres, wind).
                           -> the system, with .ids (its points in the sim), .at(k) (where point k is now)
   K.xpbd.carry(st, ids, sim, pts)   dabs that ride points of a sim (a plank on the bridge's two ropes, a lantern on its chain):
                           pts [a, b, c]: a where they hang from, b which way their y goes, c which way their x goes (or left out: kept
                           level); or { at, x, z }: their x toward point x, lying flat toward point z (a plank). They keep the shape they
                           were baked in and turn with the points.
   K.xpbd.blades(B, o)     kelp, reeds, eelgrass, ribbons of weed: strands that are flat, rise or stand as they are made, and sway in a
                           current. o.roots [{ p, n }], len (1.2), segs (8), width (0.06, or t -> width along it), buoy (1: weightless,
                           above 1 they float up, 0 they hang), stiff (how firmly they keep the shape they grew in: 0 limp kelp, 1e-3 reeds),
                           drag (how much the water carries them, 3), flow (a current: K.flow.* or any (x, y, z, t) -> [vx, vy, vz]), ramp
                           (root to tip), twist (turns along), seed, and the sim options.
   K.xpbd.fromFlow(flow)   a K.flow current (x, y, z, t, out) as a wind for the sim
   K.rope(pts, o)          (the old trailing chain, now on the solver: the same { P, step(dt, anchor, frame) } and options gravity, damp,
                           stiff, floor; it no longer depends on the frame rate)
   K.flock(B, o)           birds, fish, fireflies: each steers by its neighbours (apart, along, together), toward its home, and away from
                           the scene's surfaces. o.kind 'bird' | 'fish' | 'fly', n (24), home: { c, r } (they keep within r of c; o.orbit:
                           they circle it), speed [lo, hi], sdf (what to keep clear of), margin (0.6), size, cols (body, wing or tail, belly),
                           flap (beats a second), glide (birds: how much of the time they hold their wings out), seed.
   K.morph(B, st, a, b, o) one thing turning into another: a and b are the dabs of the two ({ first, count }, both baked, b hidden at
                           the start). Every dab of each is paired with the nearest of the other (by where it lies in its own shape's
                           box), and over o.dur (2) seconds each travels to its pair while those of a fade out and those of b fade in.
                           .go(toB) starts it, or o.loop: [hold a, hold b] seconds, and it goes back and forth for ever. o.swirl: they
                           wheel about the middle on the way (a summons). Authored point and rigid feature tracks use
                           o.correspondence: 'geometry' and o.geometry. */
(function (K) {
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pack = (B, c) => B.P[c][0] + B.P[c][1] * 256 + B.P[c][2] * 65536;
  // a disc (facing nv) or a stick (along ax) written into the stage, and its colour
  const put = (st, i, x, y, z, nv, r, thin, col, ax, len) => {
    const D = st.D,
      o = i * 16;
    D[o] = x;
    D[o + 1] = y;
    D[o + 2] = z;
    if (ax) {
      const p = r * r,
        d = len * len - p;
      D[o + 4] = p + d * ax[0] * ax[0];
      D[o + 5] = d * ax[0] * ax[1];
      D[o + 6] = d * ax[0] * ax[2];
      D[o + 8] = p + d * ax[1] * ax[1];
      D[o + 9] = d * ax[1] * ax[2];
      D[o + 10] = p + d * ax[2] * ax[2];
    } else {
      const p = r * r,
        d = thin * thin - p;
      D[o + 4] = p + d * nv[0] * nv[0];
      D[o + 5] = d * nv[0] * nv[1];
      D[o + 6] = d * nv[0] * nv[2];
      D[o + 8] = p + d * nv[1] * nv[1];
      D[o + 9] = d * nv[1] * nv[2];
      D[o + 10] = p + d * nv[2] * nv[2];
    }
    if (col !== undefined) {
      D[o + 7] = col;
      st.base[o + 7] = col;
    }
    st.rows[i >> 9] = 1;
  };
  const hide = (st, i) => {
    st.D[i * 16 + 1] = -99;
    st.rows[i >> 9] = 1;
  };
  const dice = seed => {
    let s = (Math.floor(Math.abs(seed) * 7919) % 2147483646) + 1;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  };

  K.xpbd.fromFlow = flow => {
    const out = [0, 0, 0];
    return (x, y, z, t) => {
      out[0] = out[1] = out[2] = 0;
      flow(x, y, z, t, out);
      return [out[0], out[1], out[2]];
    };
  };

  K.xpbd.ropeLinks = (count,compliance,tear,bend,guardBends=false) => {
    const links=[], spans=[];
    for(let a=0;a<count-1;a++){
      spans.push(links.length);
      links.push({a,b:a+1,compliance,ratio:tear,kind:'stretch'});
      if(bend&&a+2<count)links.push({a,b:a+2,compliance:bend,ratio:0,kind:'bend'});
    }
    if(guardBends)for(const link of links)if(link.kind==='bend')link.guards=spans.slice(link.a,link.b);
    return links;
  };

  K.xpbd.rope = (B, o) => {
    o = o || {};
    const sim = o.sim || K.xpbd.sim(o),
      n = o.n || 16,
      a = o.from,
      b = o.to || [a[0], a[1] - (o.length || 1), a[2]],
      gap = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
      slack = o.slack === undefined ? 1.12 : o.slack,
      L = gap * slack,
      seg = L / n,
      sun = norm(o.sun || [-0.5, 0.7, 0.5]),
      ramp = (o.ramp || [1, 2, 3]).map(c => pack(B, c)),
      w = o.width || 0.025,
      chain = o.kind === 'chain',
      ids = [];
    if (!sim.wind && o.wind) sim.wind = o.wind;
    // laid out as a hanging curve between its ends (a parabola that has the rope's length near enough), so it starts nearly at rest
    const dip = Math.sqrt(Math.max(0, L * L - gap * gap)) * 0.5;
    for (let k = 0; k <= n; k++) {
      const t = k / n,
        p = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t - (o.pinB === false ? 0 : dip * 4 * t * (1 - t)),
          a[2] + (b[2] - a[2]) * t
        ];
      if (o.pinB === false) {
        p[0] = a[0];
        p[1] = a[1] - seg * k;
        p[2] = a[2];
      }
      ids.push(sim.point(p, 1 / (o.mass || 0.05), w));
    }
    for(const {a,b,compliance,ratio} of K.xpbd.ropeLinks(n+1,o.comp||0,o.tear||0,o.bend))
      sim.link(ids[a],ids[b],compliance,ratio);
    const X0 = sim.X;
    const pinTo = (i, f) => {
      const p0 = [X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2]];
      sim.pin(i, typeof f === 'function' ? f : () => p0);
    };
    if (o.pinA !== false) pinTo(ids[0], o.pinA);
    if (o.pinB !== false) pinTo(ids[n], o.pinB);
    // its dabs: a rope is sticks along each segment, in a twist of light and dark; a chain is a ring of dabs to each link,
    // every other link turned a quarter
    const per = chain ? 10 : Math.max(2, Math.ceil(seg / (w * 1.6))),
      first = B.count();
    for (let k = 0; k < n; k++)
      for (let m = 0; m < per; m++) B.iso(0, -99, 0, 0.03, B.P[(o.ramp || [1])[0]], 3, { nd: true });
    const sys = {
      sim,
      ids,
      first,
      count: n * per,
      shared: !!o.sim,
      at: k => {
        const X = sim.X,
          i = ids[k];
        return [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
      },
      update(dt, t, st) {
        if (!sys.shared) sim.step(dt, t);
        const X = sim.X;
        for (let k = 0; k < n; k++) {
          const i = ids[k] * 3,
            j = ids[k + 1] * 3,
            d = [X[j] - X[i], X[j + 1] - X[i + 1], X[j + 2] - X[i + 2]],
            dl = Math.hypot(d[0], d[1], d[2]) || 1e-6,
            dir = [d[0] / dl, d[1] / dl, d[2] / dl],
            // lit by how square it lies to the light (a cylinder is brightest seen across the light)
            lit = Math.sqrt(Math.max(0, 1 - dot(dir, sun) ** 2));
          if (sim.torn && dl > seg * (o.tear || 99)) {
            for (let m = 0; m < per; m++) hide(st, first + k * per + m);
            continue;
          }
          if (chain) {
            const side0 = norm(cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
              s2 = cross(dir, side0),
              side = k % 2 ? s2 : side0,
              nv = cross(dir, side),
              cx = (X[i] + X[j]) / 2,
              cy = (X[i + 1] + X[j + 1]) / 2,
              cz = (X[i + 2] + X[j + 2]) / 2;
            for (let m = 0; m < per; m++) {
              const an = (m / per) * Math.PI * 2,
                ca = Math.cos(an),
                sa = Math.sin(an),
                p = [
                  cx + dir[0] * ca * dl * 0.62 + side[0] * sa * dl * 0.32,
                  cy + dir[1] * ca * dl * 0.62 + side[1] * sa * dl * 0.32,
                  cz + dir[2] * ca * dl * 0.62 + side[2] * sa * dl * 0.32
                ],
                tg = norm([
                  -dir[0] * sa * 0.62 + side[0] * ca * 0.32,
                  -dir[1] * sa * 0.62 + side[1] * ca * 0.32,
                  -dir[2] * sa * 0.62 + side[2] * ca * 0.32
                ]),
                l2 = Math.max(
                  0,
                  Math.min(0.999, 0.25 + 0.6 * lit * (0.6 + 0.4 * Math.abs(dot(nv, sun))) + (sa > 0 ? 0.12 : 0))
                );
              put(
                st,
                first + k * per + m,
                p[0],
                p[1],
                p[2],
                null,
                w * 0.55,
                0,
                ramp[Math.floor(l2 * ramp.length)],
                tg,
                dl * 0.22
              );
            }
          } else
            for (let m = 0; m < per; m++) {
              const f = (m + 0.5) / per,
                stripe = ((k * per + m) % 3 === 0 ? -0.18 : 0) + 0.1 * Math.sin((k * per + m) * 1.7),
                l2 = Math.max(0, Math.min(0.999, 0.2 + 0.7 * lit + stripe));
              put(
                st,
                first + k * per + m,
                X[i] + d[0] * f,
                X[i + 1] + d[1] * f,
                X[i + 2] + d[2] * f,
                null,
                w,
                0,
                ramp[Math.floor(l2 * ramp.length)],
                dir,
                (dl / per) * 0.75
              );
            }
        }
      }
    };
    return sys;
  };

  K.xpbd.carry = (st, ids, sim, pts) => {
    const X = sim.X,
      P = i => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]],
      // { at, x, z }: hung from point `at`, its x toward point x, lying in the plane toward point z (a plank between two ropes)
      plank = () => {
        const a = P(pts.at),
          xp = P(pts.x),
          zp = P(pts.z),
          x = norm([xp[0] - a[0], xp[1] - a[1], xp[2] - a[2]]),
          y = norm(cross(x, [zp[0] - a[0], zp[1] - a[1], zp[2] - a[2]]));
        return { a, x, y, z: cross(x, y) };
      },
      frame = () => {
        if (!Array.isArray(pts)) return plank();
        const a = P(pts[0]),
          b = P(pts[1]),
          y = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        let x;
        if (pts[2] !== undefined) {
          const c = P(pts[2]);
          x = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        } else x = Math.abs(y[1]) < 0.9 ? cross(y, [0, 1, 0]) : [1, 0, 0];
        const xd = dot(x, y);
        x = norm([x[0] - y[0] * xd, x[1] - y[1] * xd, x[2] - y[2] * xd]);
        return { a, x, y, z: cross(x, y) };
      },
      f0 = frame(),
      D = st.D,
      rest = ids.map(i => {
        const o = i * 16,
          q = [D[o] - f0.a[0], D[o + 1] - f0.a[1], D[o + 2] - f0.a[2]],
          // the shape's spread, in the frame (C' = R^T C R, with R's columns x, y, z)
          C = [
            [D[o + 4], D[o + 5], D[o + 6]],
            [D[o + 5], D[o + 8], D[o + 9]],
            [D[o + 6], D[o + 9], D[o + 10]]
          ],
          F = [f0.x, f0.y, f0.z],
          Cl = F.map(u => F.map(v => dot(u, [dot(C[0], v), dot(C[1], v), dot(C[2], v)])));
        return [dot(q, f0.x), dot(q, f0.y), dot(q, f0.z), Cl];
      });
    return {
      update(dt, t, s2) {
        const f = frame(),
          F = [f.x, f.y, f.z];
        ids.forEach((i, k) => {
          const [lx, ly, lz, Cl] = rest[k],
            o = i * 16;
          D[o] = f.a[0] + f.x[0] * lx + f.y[0] * ly + f.z[0] * lz;
          D[o + 1] = f.a[1] + f.x[1] * lx + f.y[1] * ly + f.z[1] * lz;
          D[o + 2] = f.a[2] + f.x[2] * lx + f.y[2] * ly + f.z[2] * lz;
          // C = R Cl R^T
          const M = [0, 1, 2].map(r =>
            [0, 1, 2].map(c => F[0][r] * Cl[0][c] + F[1][r] * Cl[1][c] + F[2][r] * Cl[2][c])
          );
          const C = [0, 1, 2].map(r => [0, 1, 2].map(c => M[r][0] * F[0][c] + M[r][1] * F[1][c] + M[r][2] * F[2][c]));
          D[o + 4] = C[0][0];
          D[o + 5] = C[0][1];
          D[o + 6] = C[0][2];
          D[o + 8] = C[1][1];
          D[o + 9] = C[1][2];
          D[o + 10] = C[2][2];
          (s2 || st).rows[i >> 9] = 1;
        });
      }
    };
  };

  K.xpbd.blades = (B, o) => {
    o = o || {};
    const R = dice(o.seed || 47),
      roots = o.roots || [],
      segs = o.segs || 8,
      len = o.len || 1.2,
      buoy = o.buoy === undefined ? 1 : o.buoy,
      sim = o.sim || K.xpbd.sim(Object.assign({ gravity: [0, -9.8 * (1 - buoy), 0], damp: 1.2 }, o)),
      wid =
        typeof o.width === 'function'
          ? o.width
          : t => (o.width || 0.06) * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))),
      sun = norm(o.sun || [-0.5, 0.7, 0.5]),
      ramp = (o.ramp || [1, 2, 3]).map(c => pack(B, c)),
      strands = [];
    if (o.flow) sim.wind = o.flow.length === 5 ? K.xpbd.fromFlow(o.flow) : o.flow;
    for (const r of roots) {
      const n0 = norm(r.n || [0, 1, 0]),
        L = len * (r.len || 1) * (0.7 + 0.6 * R()),
        sl = L / segs,
        ids = [],
        side0 = norm(cross(n0, Math.abs(n0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
        lean = [(R() - 0.5) * 0.3, 0, (R() - 0.5) * 0.3];
      let p = r.p.slice(),
        d = n0.slice();
      for (let k = 0; k <= segs; k++) {
        if (k) {
          d = norm([d[0] + lean[0] / segs, d[1], d[2] + lean[2] / segs]);
          p = [p[0] + d[0] * sl, p[1] + d[1] * sl, p[2] + d[2] * sl];
        }
        const i = sim.point(p, k ? 1 / (o.mass || 0.01) : 0, wid(k / segs) * 0.5);
        ids.push(i);
        if (k) {
          sim.link(ids[k - 1], i, o.comp || 0);
          if (o.drag !== 0) sim.drag(i, o.drag === undefined ? 3 : o.drag);
          // keeping the shape it grew in, more firmly near the root
          if (o.stiff) {
            const q = p.slice(),
              kk = o.stiff / (1 - (k / segs) * 0.85);
            sim.tie(i, () => q, kk);
          }
        }
      }
      for (let k = 0; k + 2 <= segs; k++) sim.link(ids[k], ids[k + 2], o.bend === undefined ? 5e-3 : o.bend);
      strands.push({ ids, side0, ph: R() * 6.28, tw: (o.twist || 0.5) * (0.5 + R()) });
    }
    const per = o.per || 3,
      first = B.count();
    for (const s of strands)
      for (let k = 0; k < segs * per; k++) B.iso(0, -99, 0, 0.03, B.P[(o.ramp || [1])[0]], 3, { nd: true });
    const sys = {
      sim,
      first,
      shared: !!o.sim,
      update(dt, t, st) {
        if (!sys.shared) sim.step(dt, t);
        const X = sim.X;
        let q = first;
        for (const s of strands)
          for (let k = 0; k < segs; k++) {
            const i = s.ids[k] * 3,
              j = s.ids[k + 1] * 3,
              d = [X[j] - X[i], X[j + 1] - X[i + 1], X[j + 2] - X[i + 2]],
              dl = Math.hypot(d[0], d[1], d[2]) || 1e-6,
              dir = [d[0] / dl, d[1] / dl, d[2] / dl],
              // the blade's flat side, turned along its length (a slow twist), and kept square to its run
              an = s.ph + (k / segs) * s.tw * 6.28,
              s1 = s.side0,
              s2 = cross(dir, s1),
              side = norm([
                s1[0] * Math.cos(an) + s2[0] * Math.sin(an),
                s1[1] * Math.cos(an) + s2[1] * Math.sin(an),
                s1[2] * Math.cos(an) + s2[2] * Math.sin(an)
              ]),
              sd = dot(side, dir),
              sq = norm([side[0] - dir[0] * sd, side[1] - dir[1] * sd, side[2] - dir[2] * sd]),
              nv = cross(dir, sq),
              lit = Math.abs(dot(nv, sun)),
              t0 = k / segs;
            for (let m = 0; m < per; m++) {
              const f = (m + 0.5) / per,
                l2 = Math.max(0, Math.min(0.999, 0.15 + 0.45 * lit + 0.35 * (t0 + f / segs))),
                wv = wid(t0 + f / segs);
              put(
                st,
                q++,
                X[i] + d[0] * f,
                X[i + 1] + d[1] * f,
                X[i + 2] + d[2] * f,
                nv,
                wv,
                0.008,
                ramp[Math.floor(l2 * ramp.length)]
              );
              // (a flat disc as wide as the blade, drawn out along it: the covariance is set again as a stick across the blade)
              const o2 = (q - 1) * 16,
                D = st.D,
                a2 = (dl / per) * 0.7,
                b2 = wv,
                c2 = 0.008,
                M = [dir, sq, nv],
                sc = [a2 * a2, b2 * b2, c2 * c2];
              D[o2 + 4] = M[0][0] * M[0][0] * sc[0] + M[1][0] * M[1][0] * sc[1] + M[2][0] * M[2][0] * sc[2];
              D[o2 + 5] = M[0][0] * M[0][1] * sc[0] + M[1][0] * M[1][1] * sc[1] + M[2][0] * M[2][1] * sc[2];
              D[o2 + 6] = M[0][0] * M[0][2] * sc[0] + M[1][0] * M[1][2] * sc[1] + M[2][0] * M[2][2] * sc[2];
              D[o2 + 8] = M[0][1] * M[0][1] * sc[0] + M[1][1] * M[1][1] * sc[1] + M[2][1] * M[2][1] * sc[2];
              D[o2 + 9] = M[0][1] * M[0][2] * sc[0] + M[1][1] * M[1][2] * sc[1] + M[2][1] * M[2][2] * sc[2];
              D[o2 + 10] = M[0][2] * M[0][2] * sc[0] + M[1][2] * M[1][2] * sc[1] + M[2][2] * M[2][2] * sc[2];
            }
          }
      }
    };
    return sys;
  };

  // ---- the old trailing chain, on the solver
  K.rope = (pts, o) => {
    o = o || {};
    const sim = K.xpbd.sim({
        gravity: [0, -(o.gravity === undefined ? 9 : o.gravity), 0],
        // (it lost 1 - damp of its speed a frame, at sixty frames a second)
        damp: -60 * Math.log(o.damp === undefined ? 0.92 : o.damp),
        substeps: 2,
        sdf: o.floor ? (x, y, z) => y - o.floor(x, z) - (o.thick || 0) : null,
        thick: 0
      }),
      n = pts.length,
      rest = pts.map(p => p.slice()),
      ids = pts.map((p, i) => sim.point(p, i ? 1 : 0, 0.001)),
      P = pts.map(p => p.slice());
    let anc = pts[0].slice(),
      fr = null;
    sim.pin(ids[0], () => anc);
    for (let i = 1; i < n; i++) sim.link(ids[i - 1], ids[i], 0);
    if (o.stiff)
      for (let i = 1; i < n; i++)
        sim.tie(
          ids[i],
          () => {
            const v = [rest[i][0] - rest[0][0], rest[i][1] - rest[0][1], rest[i][2] - rest[0][2]],
              w = fr ? [dot(fr[0], v), dot(fr[1], v), dot(fr[2], v)] : v;
            return [anc[0] + w[0], anc[1] + w[1], anc[2] + w[2]];
          },
          // (the old pull of `stiff` of the way a frame at sixty a second, as a softness: two steps a frame, each pulling f of the way)
          (1 / 14400) * (1 / (1 - Math.sqrt(1 - Math.min(0.99, o.stiff))) - 1)
        );
    let t = 0;
    return {
      P,
      sim,
      step(dt, anchor, frame) {
        dt = Math.min(dt, 0.033);
        anc = anchor.slice();
        fr = frame || null;
        t += dt;
        sim.step(dt, t);
        const X = sim.X;
        for (let i = 0; i < n; i++) {
          P[i][0] = X[ids[i] * 3];
          P[i][1] = X[ids[i] * 3 + 1];
          P[i][2] = X[ids[i] * 3 + 2];
        }
        return P;
      }
    };
  };

  // ---- flocks
  K.flock = (B, o) => {
    o = o || {};
    const R = dice(o.seed || 53),
      kind = o.kind || 'bird',
      n = o.n || 24,
      home = o.home || { c: [0, 3, 0], r: 4 },
      sp = o.speed || (kind === 'fly' ? [0.3, 0.8] : kind === 'fish' ? [0.8, 1.6] : [2.2, 3.4]),
      size = o.size || (kind === 'fly' ? 0.03 : kind === 'fish' ? 0.12 : 0.14),
      margin = o.margin === undefined ? 0.6 : o.margin,
      cols = (o.cols || [1, 2, 3]).map(c => pack(B, c)),
      per = kind === 'bird' ? 7 : kind === 'fish' ? 5 : 2,
      A = [];
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28,
        r = Math.sqrt(R()) * home.r * 0.7,
        p = [
          home.c[0] + Math.cos(a) * r,
          home.c[1] + (R() - 0.5) * (home.h || home.r * 0.3),
          home.c[2] + Math.sin(a) * r
        ],
        v = norm([-Math.sin(a), (R() - 0.5) * 0.1, Math.cos(a)]);
      const s0 = sp[0] + (sp[1] - sp[0]) * R();
      A.push({
        p,
        v: [v[0] * s0, v[1] * s0, v[2] * s0],
        ph: R() * 6.28,
        fl: 0.8 + 0.4 * R(),
        s: size * (0.8 + 0.4 * R())
      });
    }
    const first = B.count();
    for (let i = 0; i < n * per; i++)
      B.iso(0, -99, 0, 0.03, B.P[(o.cols || [1])[0]], 3, kind === 'fly' ? { em: true, nd: true } : { nd: true });
    const grad = (x, y, z) => {
      const e = 0.05,
        d = o.sdf(x, y, z);
      return [(o.sdf(x + e, y, z) - d) / e, (o.sdf(x, y + e, z) - d) / e, (o.sdf(x, y, z + e) - d) / e];
    };
    const sys = {
      agents: A,
      first,
      update(dt, t, st) {
        dt = Math.min(dt, 1 / 20);
        const near = kind === 'fly' ? 0.4 : size * 7,
          view = near * 3;
        for (const a of A) {
          let sx = 0,
            sy = 0,
            sz = 0,
            ax = 0,
            ay = 0,
            az = 0,
            cx = 0,
            cy = 0,
            cz = 0,
            m = 0;
          for (const b of A) {
            if (b === a) continue;
            const dx = b.p[0] - a.p[0],
              dy = b.p[1] - a.p[1],
              dz = b.p[2] - a.p[2],
              d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > view * view) continue;
            m++;
            ax += b.v[0];
            ay += b.v[1];
            az += b.v[2];
            cx += dx;
            cy += dy;
            cz += dz;
            if (d2 < near * near) {
              const k = 1 / (d2 + 1e-3);
              sx -= dx * k;
              sy -= dy * k;
              sz -= dz * k;
            }
          }
          const acc = [0, 0, 0];
          if (m) {
            const kA = kind === 'fly' ? 0.05 : 0.9,
              kC = kind === 'fly' ? 0.05 : 0.6;
            acc[0] += (ax / m - a.v[0]) * kA + (cx / m) * kC + sx * near * 0.6;
            acc[1] += (ay / m - a.v[1]) * kA + (cy / m) * kC + sy * near * 0.6;
            acc[2] += (az / m - a.v[2]) * kA + (cz / m) * kC + sz * near * 0.6;
          }
          // home: back toward it when out past its edge; and round it, if they orbit
          const hx = home.c[0] - a.p[0],
            hy = home.c[1] - a.p[1],
            hz = home.c[2] - a.p[2],
            hd = Math.hypot(hx, hz) || 1;
          const out = Math.max(0, hd - home.r) / home.r;
          acc[0] += (hx / hd) * (out * 6 + 0.2);
          acc[2] += (hz / hd) * (out * 6 + 0.2);
          acc[1] += hy * (kind === 'fly' ? 0.4 : 1.2);
          if (o.orbit) {
            acc[0] += (-hz / hd) * o.orbit;
            acc[2] += (hx / hd) * o.orbit;
          }
          // fireflies wander
          if (kind === 'fly') {
            acc[0] += Math.sin(t * 1.3 + a.ph * 3) * 0.6;
            acc[1] += Math.sin(t * 0.9 + a.ph * 5) * 0.4;
            acc[2] += Math.cos(t * 1.1 + a.ph * 2) * 0.6;
          }
          // the scene: look a little ahead, and turn away from anything there
          if (o.sdf) {
            const ah = 0.4,
              qx = a.p[0] + a.v[0] * ah,
              qy = a.p[1] + a.v[1] * ah,
              qz = a.p[2] + a.v[2] * ah,
              d = o.sdf(qx, qy, qz);
            if (d < margin) {
              const g = norm(grad(qx, qy, qz)),
                k = ((margin - d) / margin) * 12;
              acc[0] += g[0] * k;
              acc[1] += g[1] * k;
              acc[2] += g[2] * k;
            }
          }
          if (o.water !== undefined && a.p[1] > o.water - size) acc[1] -= (a.p[1] - o.water + size) * 20;
          a.v[0] += acc[0] * dt;
          a.v[1] += acc[1] * dt;
          a.v[2] += acc[2] * dt;
          const s = Math.hypot(a.v[0], a.v[1], a.v[2]) || 1e-6,
            sc = Math.max(sp[0], Math.min(sp[1], s)) / s;
          a.v[0] *= sc;
          a.v[1] *= sc;
          a.v[2] *= sc;
          a.p[0] += a.v[0] * dt;
          a.p[1] += a.v[1] * dt;
          a.p[2] += a.v[2] * dt;
          if (o.sdf) {
            // never inside
            const d = o.sdf(a.p[0], a.p[1], a.p[2]);
            if (d < size) {
              const g = norm(grad(a.p[0], a.p[1], a.p[2]));
              a.p[0] += g[0] * (size - d);
              a.p[1] += g[1] * (size - d);
              a.p[2] += g[2] * (size - d);
            }
          }
        }
        // drawn
        A.forEach((a, k) => {
          const q = first + k * per,
            f = norm(a.v),
            side = norm(cross(f, [0, 1, 0])),
            up = cross(side, f),
            s = a.s,
            P0 = a.p;
          if (kind === 'fly') {
            put(
              st,
              q,
              P0[0],
              P0[1],
              P0[2],
              null,
              s,
              0,
              cols[Math.floor((0.5 + 0.5 * Math.sin(t * 1.7 + a.ph)) * 0.99 * cols.length)],
              f,
              s
            );
            put(st, q + 1, P0[0], P0[1], P0[2], null, s * 2.2, 0, cols[0], f, s * 2.2);
            st.D[(q + 1) * 16 + 3] = 0.35;
            return;
          }
          // the body along the way it goes
          for (let m = 0; m < 3; m++) {
            const u = (m - 1) * s * 0.7;
            put(
              st,
              q + m,
              P0[0] + f[0] * u,
              P0[1] + f[1] * u,
              P0[2] + f[2] * u,
              null,
              s * (m === 1 ? 0.42 : 0.3),
              0,
              cols[m === 2 ? 0 : Math.min(cols.length - 1, 2)],
              f,
              s * 0.5
            );
          }
          if (kind === 'bird') {
            // wings: beating, or held out in a glide
            const glide = o.glide === undefined ? 0.5 : o.glide,
              beat = Math.sin(t * (o.flap || 5) * a.fl * 6.28 * 0.25 + a.ph),
              gl = Math.sin(t * 0.3 + a.ph) * 0.5 + 0.5 < glide ? 0.15 : beat,
              ang = gl * 0.9;
            for (const sg of [-1, 1])
              for (let m = 0; m < 2; m++) {
                const r = s * (0.7 + m * 0.9),
                  wd = norm([
                    side[0] * sg * Math.cos(ang) + up[0] * Math.sin(ang),
                    side[1] * sg * Math.cos(ang) + up[1] * Math.sin(ang),
                    side[2] * sg * Math.cos(ang) + up[2] * Math.sin(ang)
                  ]);
                put(
                  st,
                  q + 3 + (sg < 0 ? 0 : 2) + m,
                  P0[0] + wd[0] * r,
                  P0[1] + wd[1] * r,
                  P0[2] + wd[2] * r,
                  null,
                  s * 0.28,
                  0,
                  cols[1],
                  wd,
                  s * 0.55
                );
              }
          } else {
            // a tail that wags, and a fin
            const wag = Math.sin(t * 7 * a.fl + a.ph) * 0.6,
              td = norm([-f[0] + side[0] * wag, -f[1] + side[1] * wag, -f[2] + side[2] * wag]);
            put(
              st,
              q + 3,
              P0[0] + td[0] * s * 1.1,
              P0[1] + td[1] * s * 1.1,
              P0[2] + td[2] * s * 1.1,
              null,
              s * 0.3,
              0,
              cols[1],
              td,
              s * 0.45
            );
            put(
              st,
              q + 4,
              P0[0] + up[0] * s * 0.3,
              P0[1] + up[1] * s * 0.3,
              P0[2] + up[2] * s * 0.3,
              null,
              s * 0.15,
              0,
              cols[1],
              f,
              s * 0.35
            );
          }
        });
      }
    };
    return sys;
  };

  // ---- morphing
  function morphTimeline(st, o, draw, initiallyAtTarget) {
    const dur = o.dur || 2, wrap = o.correspondence === 'geometry';
    const geometryLoop = wrap && o.loop ? o.loop.slice() : null;
    let from = 0, t0 = -1e9, toB = initiallyAtTarget, cur = 0;
    return {
      go(b2) {
        toB = b2 === undefined ? !toB : b2;
        from = cur;
        t0 = st.time;
      },
      update(_dt, t) {
        const loop = geometryLoop ?? o.loop;
        if (loop) {
          const per = loop[0] + loop[1] + dur * 2, remainder = t % per;
          const u = wrap && remainder < 0 ? remainder + per : remainder;
          cur = u < loop[0] ? 0
            : u < loop[0] + dur ? (u - loop[0]) / dur
              : u < loop[0] + dur + loop[1] ? 1
                : 1 - (u - loop[0] - dur - loop[1]) / dur;
        } else {
          const k = Math.min(1, (t - t0) / dur);
          cur = from + ((toB ? 1 : 0) - from) * k;
        }
        draw(Math.max(0, Math.min(1, cur)));
      }
    };
  }

  K.morph = (B, st, a0, b0, o) => {
    o = o || {};
    // (each side: { first, count }, or a list of dab ids)
    const asList = r =>
        Array.isArray(r) || ArrayBuffer.isView(r)
          ? Array.from(r)
          : Array.from({ length: r.count }, (_, k) => r.first + k),
      LA = asList(a0),
      LB = asList(b0),
      a = { ids: LA, count: LA.length },
      b = { ids: LB, count: LB.length };
    if (!a.count || !b.count || [...LA, ...LB].some(i => !Number.isSafeInteger(i) || i < 0 || i * 16 >= st.base.length))
      throw new Error('Morphs need nonempty sets of valid splat indices');
    if (o.correspondence !== undefined && !['nearest', 'transport', 'geometry'].includes(o.correspondence))
      throw new Error('Unknown morph correspondence mode');
    if (o.correspondence === 'geometry') {
      if (o.swirl || (o.dur !== undefined && (!Number.isFinite(o.dur) || o.dur <= 0)) ||
          (o.loop && !(Array.isArray(o.loop) && o.loop.length === 2 && o.loop.every(t => Number.isFinite(t) && t >= 0))) ||
          !Number.isFinite(2 * (o.dur ?? 2) + (o.loop ? o.loop[0] + o.loop[1] : 0)))
        throw new RangeError('Geometry morphs need valid timing and authored paths');
      const { geometry, draw, post } = SplatGeometryMorph(st, LA, LB, o.geometry);
      return { geometry, post, ...morphTimeline(st, o, draw, false) };
    }
    const D = st.D,
      base = st.base,
      box = r => {
        const lo = [1e9, 1e9, 1e9],
          hi = [-1e9, -1e9, -1e9];
        for (const i of r.ids)
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], base[i * 16 + k]);
            hi[k] = Math.max(hi[k], base[i * 16 + k]);
          }
        return { lo, hi };
      },
      ba = box(a),
      bb = box(b),
      rel = (i, bx) => [0, 1, 2].map(k => (base[i * 16 + k] - bx.lo[k]) / Math.max(1e-3, bx.hi[k] - bx.lo[k])),
      // pairs: each dab with the nearest of the other's, by where it lies in its own box (a grid makes this quick)
      pairOf = (src, bs, dst, bd) => {
        const cell = 0.08,
          G = new Map(),
          key = (x, y, z) => Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell);
        for (const i of dst.ids) {
          const q = rel(i, bd),
            k = key(q[0], q[1], q[2]);
          (G.get(k) || G.set(k, []).get(k)).push([i, q]);
        }
        const out = new Int32Array(src.count);
        for (let n = 0; n < src.count; n++) {
          const i = src.ids[n],
            q = rel(i, bs);
          let best = dst.ids[0],
            bd2 = 1e9;
          for (let r = 0; r < 4 && bd2 === 1e9; r++)
            for (let x = -r; x <= r; x++)
              for (let y = -r; y <= r; y++)
                for (let z = -r; z <= r; z++) {
                  const L = G.get(
                    Math.floor(q[0] / cell) +
                      x +
                      ',' +
                      (Math.floor(q[1] / cell) + y) +
                      ',' +
                      (Math.floor(q[2] / cell) + z)
                  );
                  if (L)
                    for (const [j, p] of L) {
                      const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
                      if (d < bd2) ((bd2 = d), (best = j));
                    }
                }
          out[n] = best;
        }
        return out;
      },
      transportSamples = r => r.ids.map(i => {
        const offset = i * 16, c = base[offset + 7];
        return { id: String(i), position: [base[offset], base[offset + 1], base[offset + 2]],
          color: [c & 255, (c >> 8) & 255, (c >> 16) & 255].map(v => v / 255) };
      }),
      transport = o.correspondence === 'transport'
        ? K.procedural.motion.transportSplats(transportSamples(a), transportSamples(b), { normalize: 'bounds', ...o.transport })
        : null,
      ab = transport ? transport.forward : pairOf(a, ba, b, bb),
      bA = transport ? transport.reverse : pairOf(b, bb, a, ba),
      mid = [0, 1, 2].map(k => (ba.lo[k] + ba.hi[k] + bb.lo[k] + bb.hi[k]) / 4),
      ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const alphaA = Float32Array.from(a.ids, i => base[i * 16 + 3]),
      alphaB = Float32Array.from(b.ids, i => base[i * 16 + 3]);
    // b starts hidden
    for (const i of b.ids) if(!st.physicsOwned?.[i])D[i * 16 + 3] = 0;
    const place = (i, j, s, alpha) => {
      // dab i (made where it is) travels toward where dab j was made, s of the way
      if(st.physicsOwned?.[i])return;
      const o2 = i * 16,
        sw = o.swirl ? o.swirl * Math.sin(Math.PI * s) : 0;
      const tx = transport ? j[0] : base[j * 16],
        ty = transport ? j[1] : base[j * 16 + 1],
        tz = transport ? j[2] : base[j * 16 + 2];
      let x = base[o2] + (tx - base[o2]) * s,
        y = base[o2 + 1] + (ty - base[o2 + 1]) * s,
        z = base[o2 + 2] + (tz - base[o2 + 2]) * s;
      if (sw) {
        const dx = x - mid[0],
          dz = z - mid[2],
          c = Math.cos(sw),
          sn = Math.sin(sw);
        x = mid[0] + dx * c - dz * sn;
        z = mid[2] + dx * sn + dz * c;
        y += Math.sin(Math.PI * s) * 0.15;
      }
      D[o2] = x;
      D[o2 + 1] = y;
      D[o2 + 2] = z;
      D[o2 + 3] = alpha;
      st.rows[i >> 9] = 1;
    };
    return {
      transport,
      ...morphTimeline(st, o, progress => {
        const s = ease(progress);
        // Those of a go out toward b, fading as they arrive. Those of b come in from a.
        for (let k = 0; k < a.count; k++)
          place(a.ids[k], ab[k], s, alphaA[k] * Math.max(0, 1 - s * 1.6 + 0.3 * (1 - s)));
        for (let k = 0; k < b.count; k++)
          place(b.ids[k], bA[k], 1 - s, alphaB[k] * Math.max(0, Math.min(1, (s - 0.25) * 1.6)));
      }, true)
    };
  };
})(KIT);
