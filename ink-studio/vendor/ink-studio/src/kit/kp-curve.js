/* kp-curve: curves, and shapes swept along them.
   A curve is a list of points [x, y, z]. These make and change them:
     K.curve.line(a, b, n)                 K.curve.arc(c, r, a0, a1, n, axis)      K.curve.circle(c, r, n, axis)
     K.curve.helix(c, r, h, turns, n)      K.curve.spiral(c, r0, r1, turns, n)     K.curve.star(c, r0, r1, points)
     K.curve.bezier(p0, p1, p2, p3, n)     K.curve.spline(pts, per)               (smooth through the points)
     K.curve.resample(pts, n)              K.curve.trim(pts, t0, t1)              K.curve.length(pts)
     K.curve.at(pts, t)                    K.curve.noise(pts, amp, freq, seed)    (wobbled across itself, ends kept)
     K.curve.frames(pts, up)               a frame at every point: { p, T (along), N (the way `up` points, turned as little as
                                           it can be from one point to the next), B, t (0 at the start, 1 at the end) }
   K.sweep(S, pts, profile, mat, o)        a cross-section carried along the curve: a solid like any other
     profile: { w: half-width (a number or t => number), h: half-thickness (the same), shape: 'flat' (rounded ends: a blade, a
                leaf, a ribbon), 'rect' (a plank: square corners rounded by round), 'round' (a tube with an oval section),
                fold: radians (the two halves turned up from the middle, a V: a leaf's midrib), cup: how much the section is bent
                across (a curled leaf, a gutter), twist: turns along the length, round: corner radius for 'rect' }
     o.up: which way the flat side faces at the start ([0, 1, 0]); and the usual res, tag, g/k, ghost, neg
     It knows how far along it a point is (the attribute `along`), so m.root works on it as on a tube.
     K.sweep.leaf(len, wide)  a leaf's outline: w(t) that is round at the base and comes to a point */
(function (K) {
  const TAU = Math.PI * 2;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm = v => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    },
    lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const C = (K.curve = {
    line: (a, b, n) => {
      const out = [];
      n = n || 8;
      for (let i = 0; i <= n; i++) out.push(lerp(a, b, i / n));
      return out;
    },
    // in the plane square to `axis` (default: y, so the arc lies flat)
    arc: (c, r, a0, a1, n, axis) => {
      const ax = norm(axis || [0, 1, 0]),
        u = norm(Math.abs(ax[1]) > 0.9 ? cross(ax, [0, 0, 1]) : cross(ax, [0, 1, 0])),
        v = cross(ax, u),
        out = [];
      n = n || 16;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n,
          ca = Math.cos(a) * r,
          sa = Math.sin(a) * r;
        out.push([c[0] + u[0] * ca + v[0] * sa, c[1] + u[1] * ca + v[1] * sa, c[2] + u[2] * ca + v[2] * sa]);
      }
      return out;
    },
    circle: (c, r, n, axis) => C.arc(c, r, 0, TAU, n || 24, axis),
    helix: (c, r, h, turns, n) => {
      const out = [];
      n = n || Math.ceil(turns * 16);
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          a = t * turns * TAU;
        out.push([c[0] + Math.cos(a) * r, c[1] + t * h, c[2] + Math.sin(a) * r]);
      }
      return out;
    },
    spiral: (c, r0, r1, turns, n) => {
      const out = [];
      n = n || Math.ceil(turns * 20);
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          a = t * turns * TAU,
          r = r0 + (r1 - r0) * t;
        out.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
      }
      return out;
    },
    star: (c, r0, r1, points) => {
      const out = [];
      for (let i = 0; i <= points * 2; i++) {
        const a = (i / (points * 2)) * TAU,
          r = i % 2 ? r1 : r0;
        out.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]);
      }
      return out;
    },
    bezier: (p0, p1, p2, p3, n) => {
      const out = [];
      n = n || 16;
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          u = 1 - t,
          a = u * u * u,
          b = 3 * u * u * t,
          c = 3 * u * t * t,
          d = t * t * t;
        out.push([0, 1, 2].map(k => a * p0[k] + b * p1[k] + c * p2[k] + d * p3[k]));
      }
      return out;
    },
    // Catmull-Rom through every point, `per` steps between two of them
    spline: (pts, per) => {
      per = per || 6;
      if (pts.length < 3) return C.resample(pts, per * Math.max(1, pts.length - 1));
      const out = [],
        P = i => pts[Math.max(0, Math.min(pts.length - 1, i))];
      for (let i = 0; i < pts.length - 1; i++)
        for (let j = 0; j < per; j++) {
          const t = j / per,
            a = P(i - 1),
            b = P(i),
            c = P(i + 1),
            d = P(i + 2),
            t2 = t * t,
            t3 = t2 * t;
          out.push(
            [0, 1, 2].map(
              k =>
                0.5 *
                (2 * b[k] +
                  (-a[k] + c[k]) * t +
                  (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
                  (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)
            )
          );
        }
      out.push(pts[pts.length - 1].slice());
      return out;
    },
    length: pts => {
      let l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(...sub(pts[i], pts[i - 1]));
      return l;
    },
    at: (pts, t) => {
      const L = C.length(pts),
        want = Math.max(0, Math.min(1, t)) * L;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(...sub(pts[i], pts[i - 1]));
        if (acc + l >= want || i === pts.length - 1)
          return lerp(pts[i - 1], pts[i], l > 0 ? Math.min(1, (want - acc) / l) : 0);
        acc += l;
      }
      return pts[0].slice();
    },
    resample: (pts, n) => {
      const out = [];
      for (let i = 0; i <= n; i++) out.push(C.at(pts, i / n));
      return out;
    },
    trim: (pts, t0, t1) => {
      const n = Math.max(2, Math.ceil(pts.length * Math.abs(t1 - t0))),
        out = [];
      for (let i = 0; i <= n; i++) out.push(C.at(pts, t0 + ((t1 - t0) * i) / n));
      return out;
    },
    noise: (pts, amp, freq, seed) => {
      const fr = C.frames(pts),
        s = (seed || 1) * 1.731,
        L = C.length(pts);
      return fr.map((f, i) => {
        const end = Math.sin(Math.PI * f.t),
          u = Math.sin(f.t * L * (freq || 2) + s) * Math.sin(f.t * L * (freq || 2) * 0.61 + s * 2.3),
          v = Math.sin(f.t * L * (freq || 2) * 0.83 + s * 3.7) * Math.sin(f.t * L * (freq || 2) * 1.37 + s);
        return [0, 1, 2].map(k => pts[i][k] + (f.N[k] * u + f.B[k] * v) * amp * end);
      });
    },
    frames: (pts, up) => {
      const n = pts.length,
        out = [],
        T = [];
      let L = 0;
      const cum = [0];
      for (let i = 1; i < n; i++) cum.push((L += Math.hypot(...sub(pts[i], pts[i - 1]))));
      const closed = n > 3 && Math.hypot(...sub(pts[0], pts[n-1])) < 1e-8;
      for (let i = 0; i < n; i++) {
        const tangent = closed && (i === 0 || i === n-1) ? sub(pts[1], pts[n-2]) :
          sub(pts[Math.min(n-1,i+1)], pts[Math.max(0,i-1)]);
        if (Math.hypot(...tangent) < 1e-12) {
          const forward = sub(pts[Math.min(n-1,i+1)],pts[i]);
          T.push(norm(Math.hypot(...forward)>1e-12 ? forward : sub(pts[i],pts[Math.max(0,i-1)])));
        } else T.push(norm(tangent));
      }
      let N = up || [0, 1, 0];
      // the first normal: `up`, made square to the way the curve starts
      N = sub(
        N,
        T[0].map(v => v * dot(N, T[0]))
      );
      if (Math.hypot(...N) < 1e-4) N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      N = norm(
        sub(
          N,
          T[0].map(v => v * dot(N, T[0]))
        )
      );
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          // carried on by the least turn that takes the last way along to this one (parallel transport)
          const a = T[i - 1],
            b = T[i],
            ax = cross(a, b),
            s = Math.hypot(...ax),
            c = dot(a, b);
          if (s > 1e-6) {
            const k = norm(ax),
              ang = Math.atan2(s, c),
              cs = Math.cos(ang),
              sn = Math.sin(ang),
              kd = dot(k, N),
              kx = cross(k, N);
            N = norm([0, 1, 2].map(j => N[j] * cs + kx[j] * sn + k[j] * kd * (1 - cs)));
          }
          N = norm(
            sub(
              N,
              b.map(v => v * dot(N, b))
            )
          );
        }
        out.push({ p: pts[i], T: T[i], N, B: cross(T[i], N), t: L > 0 ? cum[i] / L : 0 });
      }
      if (closed && L > 0) {
        const first=out[0],last=out[n-1],angle=Math.atan2(dot(first.T,cross(last.N,first.N)),dot(last.N,first.N));
        for (const f of out) {
          const a=angle*f.t,c=Math.cos(a),s=Math.sin(a),b=cross(f.T,f.N);
          f.N=norm(f.N.map((v,k)=>v*c+b[k]*s));f.B=cross(f.T,f.N);
        }
        out[n-1].T=first.T.slice();out[n-1].N=first.N.slice();out[n-1].B=first.B.slice();
      }
      return out;
    },
    /* copies placed at intervals along a curve: every o.gap along it (or o.n evenly), a place and a
       turn for S.place: the copy's x goes along the curve, its y the way `o.up` points (carried round the bends as the frames are) and its
       z across. o.roll: radians each copy is turned about the curve more than the last (a chain: PI / 2), o.tilt [lo, hi] a lean
       either way at random, o.from / o.to: how far along to start and stop (0, 1), o.seed.  -> [{ p, R, t, T, N, B }] */
    place: (pts, o) => {
      o = o || {};
      const fr = C.frames(C.resample(pts, Math.max(8, pts.length * 4)), o.up),
        L = C.length(pts),
        a = (o.from || 0) * L,
        b = (o.to === undefined ? 1 : o.to) * L,
        n = o.n || Math.max(1, Math.floor((b - a) / (o.gap || 0.5)) + 1),
        out = [];
      let s = (o.seed || 1) * 9301 + 49297;
      const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = 0; i < n; i++) {
        const t = (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1)) / (L || 1),
          f = t * (fr.length - 1),
          j = Math.min(fr.length - 2, Math.floor(f)),
          u = f - j,
          A = fr[j],
          Bf = fr[j + 1],
          p = A.p.map((v, k) => v + (Bf.p[k] - v) * u),
          T = norm(A.T.map((v, k) => v + (Bf.T[k] - v) * u)),
          N0 = A.N.map((v, k) => v + (Bf.N[k] - v) * u),
          rl = (o.roll || 0) * i + (o.tilt ? o.tilt[0] + (o.tilt[1] - o.tilt[0]) * rnd() : 0),
          N1 = norm(
            sub(
              N0,
              T.map(v => v * dot(N0, T))
            )
          ),
          B1 = cross(T, N1),
          cs = Math.cos(rl),
          sn = Math.sin(rl),
          N = N1.map((v, k) => v * cs + B1[k] * sn),
          Bv = cross(T, N);
        out.push({ p, T, N, B: Bv, t, R: [T[0], T[1], T[2], N[0], N[1], N[2], Bv[0], Bv[1], Bv[2]] });
      }
      return out;
    }
  });
  const fnOf = v => (typeof v === 'function' ? v : () => v);
  // the distance from (u, v) to a rounded box of half-sizes (w, h) and corner radius r
  const rbox = (u, v, w, h, r) => {
    r = Math.min(r, w, h);
    const qx = Math.abs(u) - w + r,
      qy = Math.abs(v) - h + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  K.sweep = (S, pts, pf, mat, o) => {
    o = o || {};
    pf = pf || {};
    // width and thickness along the length, tabulated (they are asked for at every point the field is wanted)
    const W0 = fnOf(pf.w === undefined ? 0.1 : pf.w),
      H0 = fnOf(pf.h === undefined ? 0.02 : pf.h),
      WT = new Float32Array(65),
      HT = new Float32Array(65);
    for (let i = 0; i <= 64; i++) ((WT[i] = W0(i / 64)), (HT[i] = H0(i / 64)));
    const tab = (T, t) => {
        const q = Math.max(0, Math.min(64, t * 64)),
          k = Math.min(63, Math.floor(q));
        return T[k] + (T[k + 1] - T[k]) * (q - k);
      },
      W = t => tab(WT, t),
      H = t => tab(HT, t),
      shape = pf.shape || 'flat',
      fold = pf.fold || 0,
      cup = pf.cup || 0,
      twist = pf.twist || 0,
      rnd = pf.round === undefined ? 0.3 : pf.round,
      tf = Math.tan(fold),
      safe = fold || cup ? 0.75 : 0.95,
      F = C.frames(pts, o.up),
      n = F.length,
      closed = n > 3 && Math.hypot(...sub(pts[0], pts[n-1])) < 1e-8,
      cum = [0];
    let L = 0;
    for (let i = 1; i < n; i++) cum.push((L += Math.hypot(...sub(pts[i], pts[i - 1]))));
    // the frame at a place along the curve, the twist laid in
    const frameAt = (i, f) => {
      const a = F[i],
        b = F[Math.min(n - 1, i + 1)],
        Nn = norm(lerp(a.N, b.N, f)),
        Tt = norm(lerp(a.T, b.T, f)),
        t = (cum[i] + (cum[Math.min(n - 1, i + 1)] - cum[i]) * f) / (L || 1),
        tw = twist * TAU * t,
        Bb = cross(Tt, Nn),
        cs = Math.cos(tw),
        sn = Math.sin(tw);
      return {
        T: Tt,
        N: [0, 1, 2].map(k => Nn[k] * cs + Bb[k] * sn),
        B: [0, 1, 2].map(k => Bb[k] * cs - Nn[k] * sn),
        t
      };
    };
    const section = (u, v, t) => {
      const w = Math.max(1e-4, W(t)),
        h = Math.max(1e-4, H(t)),
        vv = v - cup * u * u - Math.abs(u) * tf;
      if (shape === 'rect') return rbox(u, vv, w, h, rnd * h);
      if (shape === 'round') {
        const k0 = Math.hypot(u / w, vv / h);
        return (k0 - 1) * Math.min(w, h);
      }
      return rbox(u, vv, w, h, h); // flat: rounded along the edges
    };
    let cx = 0,
      cy = 0,
      cz = 0,
      br = 0,
      wmax = 0;
    for (const q of pts) ((cx += q[0] / n), (cy += q[1] / n), (cz += q[2] / n));
    for (const q of pts) br = Math.max(br, Math.hypot(q[0] - cx, q[1] - cy, q[2] - cz));
    for (let i = 0; i <= 20; i++)
      wmax = Math.max(wmax, W(i / 20) + Math.abs(W(i / 20)) * (Math.abs(tf) + Math.abs(cup) * W(i / 20)), H(i / 20));
    // per segment, worked out once: its start, its direction and length, and the frames at its two ends (the twist laid in)
    const SEG = [];
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i],
        b = pts[i + 1],
        f0 = frameAt(i, 0),
        f1 = frameAt(i, 1),
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        dz = b[2] - a[2];
      SEG.push([
        a[0],
        a[1],
        a[2],
        dx,
        dy,
        dz,
        dx * dx + dy * dy + dz * dz || 1e-12,
        ...f0.N,
        ...f0.B,
        ...f1.N,
        ...f1.B,
        cum[i] / (L || 1),
        cum[i + 1] / (L || 1)
      ]);
    }
    let NI = 0,
      NF = 0;
    // where along the curve a point is nearest: which segment (NI) and how far along it (NF)
    const near = (x, y, z) => {
      let best = 1e18;
      for (let i = 0; i < SEG.length; i++) {
        const g = SEG[i];
        let f = ((x - g[0]) * g[3] + (y - g[1]) * g[4] + (z - g[2]) * g[5]) / g[6];
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const ex = x - g[0] - g[3] * f,
          ey = y - g[1] - g[4] * f,
          ez = z - g[2] - g[5] * f,
          d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < best) ((best = d2), (NI = i), (NF = f));
      }
    };
    const p = {
      bc: [cx, cy, cz],
      br: br + wmax + 0.02,
      along(x, y, z) {
        near(x, y, z);
        const g = SEG[NI];
        return g[19] + (g[20] - g[19]) * NF;
      },
      sd(x, y, z) {
        near(x, y, z);
        const g = SEG[NI],
          f = NF,
          // the frame here: the two ends' frames mixed, put square again
          nx0 = g[7] + (g[13] - g[7]) * f,
          ny0 = g[8] + (g[14] - g[8]) * f,
          nz0 = g[9] + (g[15] - g[9]) * f,
          nl = Math.hypot(nx0, ny0, nz0) || 1,
          bx0 = g[10] + (g[16] - g[10]) * f,
          by0 = g[11] + (g[17] - g[11]) * f,
          bz0 = g[12] + (g[18] - g[12]) * f,
          bl = Math.hypot(bx0, by0, bz0) || 1,
          tl = Math.sqrt(g[6]),
          rx = x - g[0] - g[3] * f,
          ry = y - g[1] - g[4] * f,
          rz = z - g[2] - g[5] * f,
          u = (rx * bx0 + ry * by0 + rz * bz0) / bl,
          v = (rx * nx0 + ry * ny0 + rz * nz0) / nl,
          a = (rx * g[3] + ry * g[4] + rz * g[5]) / tl,
          t = g[19] + (g[20] - g[19]) * f,
          d2 = section(u, v, t),
          // past an end: how far beyond it, along the curve
          out = closed ? 0 : (NI === 0 && f === 0 && a < 0 ? -a : 0) + (NI === SEG.length - 1 && f === 1 && a > 0 ? a : 0);
        return out > 0 ? Math.hypot(Math.max(d2, 0), out) * safe : d2 * safe;
      },
      sample(f) {
        const res = this.res,
          steps = Math.max(2, Math.ceil(L / (res * 0.8)));
        for (let s = 0; s <= steps; s++) {
          const tt = s / steps,
            want = tt * L;
          let i = 0;
          while (i < n - 2 && cum[i + 1] < want) i++;
          const ff = cum[i + 1] > cum[i] ? (want - cum[i]) / (cum[i + 1] - cum[i]) : 0,
            fr = frameAt(i, Math.max(0, Math.min(1, ff))),
            c = lerp(pts[i], pts[i + 1], Math.max(0, Math.min(1, ff))),
            w = W(fr.t),
            h = H(fr.t),
            across = Math.max(1, Math.ceil((2 * w) / (res * 0.8)));
          for (let j = 0; j <= across; j++) {
            const u = -w + (2 * w * j) / across,
              lift = cup * u * u + Math.abs(u) * tf;
            for (const side of [-1, 1]) {
              const v = lift + side * h;
              f(c[0] + fr.B[0] * u + fr.N[0] * v, c[1] + fr.B[1] * u + fr.N[1] * v, c[2] + fr.B[2] * u + fr.N[2] * v);
            }
          }
        }
      }
    };
    return S.add(p, mat, Object.assign({ reach: 0.02 }, o));
  };
  // a leaf's outline along its length: full a little below the middle, round at the base, coming to a point
  K.sweep.leaf = (wide, base) => t =>
    wide * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.04)), 0.75) * (1 - 0.35 * t) + (base || 0) * (1 - t);
})(KIT);
