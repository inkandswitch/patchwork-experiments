/* kd-mpm: one solver for stuff that wobbles, squashes, piles, pours and tears (the material point method), and the splats
   that fill a body so that it has an inside to show.
     K.inside(B, sd, o)       before B.finish(): fill the solid whose distance is sd with splats. o: lo, hi (the box to look in), cell (spacing),
                              cols(depth, x, y, z) -> palette index (or ramp: skin to core over `band`), skin (how far under the surface to start),
                              hidden (start unseen; .show(st, i) / .showNear(st, p, r) bring them out), a (how solid each is: under 1 they
                              add up, so a see-through body is densest where it is thickest), glow.  -> { first, count, ids, depth }
     const mp = st.add(K.mpm(st, o))    o: lo, hi (the room it lives in), cell (0.25), gravity (9.8), floor (y, or (x, z) => y), sdf (what stands
                              still and is solid), grip 0..1 (how much a surface holds what touches it: each kind has its own unless this is given), damp
     mp.add(ids, m)           these splats become matter. m.kind:
                                'jelly'  springs back                      stiff, squash (how easily it changes volume), thick (how soon a wobble dies)
                                'clay'   springs back a little, then stays  stiff, yield (how hard before it gives)
                                'sand'   no pull at all, friction between grains    fric
                                'water'  keeps its volume, no shape
                              also m.v (starting velocity), m.dense (weight), m.grip, m.shape (false: splats keep their shape; default by kind)
                              m.tap: 'shove' (a tap pushes it) or 'scoop' (a tap takes a bite of size m.scoop out of it; o.onScoop(p, body, n) hears of it)
     mp.kick(p, r, v)         shove whatever is within r of p        mp.collider({ sd, v })   a solid that moves and pushes (v: its velocity)
     mp.scoop(p, r, body)     take matter out for good               mp.bodyAt(p)             which body is at p
     mp.stats(body)           { n, speed, lo, hi, c }                 mp.awake                 false once everything has come to rest
   The step is fixed (it divides each frame as finely as the stiffest stuff needs), so it runs the same at any frame rate. */
(function (K) {
  const hash = K.hash;
  const GLOW = { em: true },
    SOFT = { nd: true },
    SOFTGLOW = { em: true, nd: true };
  K.inside = (B, sd, o) => {
    o = o || {};
    const cell = o.cell || 0.14,
      lo = o.lo,
      hi = o.hi,
      skin = o.skin === undefined ? cell * 0.55 : o.skin,
      band = o.band || cell * 4,
      ramp = o.ramp || [1],
      first = B.count(),
      ids = [],
      depth = [],
      size = (o.size || 0.62) * cell,
      alpha = o.hidden ? 0 : o.a === undefined ? 3 : o.a;
    let n = 0;
    for (let z = lo[2]; z <= hi[2]; z += cell)
      for (let y = lo[1]; y <= hi[1]; y += cell)
        for (let x = lo[0]; x <= hi[0]; x += cell) {
          n++;
          const px = x + (hash(n, 1) - 0.5) * cell * 0.7,
            py = y + (hash(n, 2) - 0.5) * cell * 0.7,
            pz = z + (hash(n, 3) - 0.5) * cell * 0.7,
            d = -sd(px, py, pz);
          if (d < skin) continue;
          const ci = o.cols
            ? o.cols(d, px, py, pz)
            : ramp[Math.min(ramp.length - 1, Math.floor(Math.min(1, d / band) * ramp.length))];
          ids.push(B.count());
          depth.push(d);
          B.iso(
            px,
            py,
            pz,
            size,
            B.P[ci],
            alpha,
            o.glow ? (alpha < 1 ? SOFTGLOW : GLOW) : alpha < 1 ? SOFT : undefined
          );
        }
    const out = {
      first,
      count: ids.length,
      ids: Int32Array.from(ids),
      depth: Float32Array.from(depth),
      cell,
      show(st, i) {
        const q = i * 16;
        if (st.base[q + 3] > 0) return;
        st.base[q + 3] = 3;
        st.D[q + 3] = 3;
        st.touch(i);
        st.repaint(i);
      },
      showAll(st) {
        for (const i of out.ids) out.show(st, i);
      },
      /* bring out whatever of the inside lies within r of p (a cut, a bite, a crack) */
      showNear(st, p, r) {
        let shown = 0;
        for (const i of out.ids) {
          const q = i * 16;
          if (st.base[q + 3] > 0) continue;
          if (Math.hypot(st.D[q] - p[0], st.D[q + 1] - p[1], st.D[q + 2] - p[2]) < r) {
            out.show(st, i);
            shown++;
          }
        }
        return shown;
      }
    };
    return out;
  };

  const KIND = { jelly: 0, clay: 1, sand: 2, water: 3 };
  K.mpm = (st, o) => {
    o = o || {};
    const D = st.D,
      B0 = st.base,
      h = o.cell || 0.25,
      ih = 1 / h,
      lo = (o.lo || [-6, 0, -6]).slice(),
      hi = o.hi || [6, 6, 6],
      _f = typeof o.floor === 'number' ? (lo[1] = Math.min(lo[1], o.floor - 2 * h)) : 0,
      nx = Math.ceil((hi[0] - lo[0]) * ih) + 1,
      ny = Math.ceil((hi[1] - lo[1]) * ih) + 1,
      nz = Math.ceil((hi[2] - lo[2]) * ih) + 1,
      NN = nx * ny * nz;
    const gm = new Float32Array(NN),
      gg = new Float32Array(NN),
      gv = new Float32Array(NN * 3),
      g = o.gravity === undefined ? 9.8 : o.gravity,
      damp = o.damp === undefined ? 0.4 : o.damp,
      floorF = typeof o.floor === 'function' ? o.floor : null,
      floorY = typeof o.floor === 'number' ? o.floor : lo[1] + 2 * h;
    let cap = 0,
      n = 0,
      X,
      Vv,
      C,
      Fv,
      be,
      kind,
      idx,
      body,
      vol,
      mass,
      shape;
    const bodies = [],
      colliders = [];
    const grow = need => {
      if (need <= cap) return;
      const nc = Math.max(need, cap * 2, 1024),
        g2 = (old, k, T) => {
          const a = new T(nc * k);
          if (old) a.set(old);
          return a;
        };
      X = g2(X, 3, Float32Array);
      Vv = g2(Vv, 3, Float32Array);
      C = g2(C, 9, Float32Array);
      Fv = g2(Fv, 9, Float32Array);
      be = g2(be, 6, Float32Array);
      kind = g2(kind, 1, Uint8Array);
      idx = g2(idx, 1, Int32Array);
      body = g2(body, 1, Uint16Array);
      vol = g2(vol, 1, Float32Array);
      mass = g2(mass, 1, Float32Array);
      shape = g2(shape, 1, Uint8Array);
      cap = nc;
    };
    // what stands still: which grid nodes are inside it, and which way is out
    let solid = null,
      snrm = null;
    const sdf = o.sdf || null,
      nodeMask = () => {
        solid = new Uint8Array(NN);
        snrm = new Float32Array(NN * 3);
        if (!sdf) return;
        const e = h * 0.5;
        for (let k = 0; k < nz; k++)
          for (let j = 0; j < ny; j++)
            for (let i = 0; i < nx; i++) {
              const x = lo[0] + i * h,
                y = lo[1] + j * h,
                z = lo[2] + k * h;
              if (sdf(x, y, z) >= 0) continue;
              const q = i + nx * (j + ny * k);
              solid[q] = 1;
              const gx = sdf(x + e, y, z) - sdf(x - e, y, z),
                gy = sdf(x, y + e, z) - sdf(x, y - e, z),
                gz = sdf(x, y, z + e) - sdf(x, y, z - e),
                l = Math.hypot(gx, gy, gz) || 1;
              snrm[q * 3] = gx / l;
              snrm[q * 3 + 1] = gy / l;
              snrm[q * 3 + 2] = gz / l;
            }
      };
    const sys = {
      awake: true,
      bodies,
      colliders,
      cell: h,
      get count() {
        return n;
      },
      steps: 0,
      add(ids, m) {
        m = m || {};
        const k = KIND[m.kind === undefined ? 'jelly' : m.kind];
        if (k === undefined)
          throw new Error('mpm: no kind of matter called "' + m.kind + '" (jelly, clay, sand, water)');
        grow(n + ids.length);
        const stiff = m.stiff === undefined ? 1 : m.stiff,
          B = {
            kind: k,
            name: m.kind || 'jelly',
            first: n,
            count: ids.length,
            mu: (k === 0 ? 70 : k === 1 ? 160 : k === 2 ? 110 : 0) * stiff,
            la:
              (k === 0
                ? 140 * (m.squash === undefined ? 1 : 1 / Math.max(0.2, m.squash))
                : k === 1
                  ? 220
                  : k === 2
                    ? 240
                    : 260) * stiff,
            yield: m.yield === undefined ? 9 : m.yield,
            fric: m.fric === undefined ? 1.6 : m.fric,
            visc: m.thick === undefined ? [50, 2, 0, 0.4][k] : m.thick,
            grip: m.grip === undefined ? (o.grip === undefined ? [0.3, 0.6, 0.9, 0.05][k] : o.grip) : m.grip,
            dense: m.dense || 1
          };
        B.speed = Math.sqrt((B.la + 2 * B.mu) / B.dense);
        B.tap = m.tap || 'shove';
        B.scoop = m.scoop || 0.5;
        const v0 = m.v || [0, 0, 0],
          pv = m.vol || (h * h * h) / 8,
          shp = m.shape === undefined ? k < 2 : !!m.shape;
        bodies.push(B);
        for (const i of ids) {
          const q = i * 16,
            p = n * 3,
            c = n * 9;
          X[p] = D[q];
          X[p + 1] = D[q + 1];
          X[p + 2] = D[q + 2];
          Vv[p] = v0[0];
          Vv[p + 1] = v0[1];
          Vv[p + 2] = v0[2];
          C.fill(0, c, c + 9);
          Fv.fill(0, c, c + 9);
          Fv[c] = Fv[c + 4] = Fv[c + 8] = 1;
          const b = n * 6;
          be[b] = 1;
          be[b + 1] = 0;
          be[b + 2] = 0;
          be[b + 3] = 1;
          be[b + 4] = 0;
          be[b + 5] = 1;
          kind[n] = k;
          idx[n] = i;
          body[n] = bodies.length - 1;
          vol[n] = pv;
          mass[n] = pv * B.dense;
          shape[n] = shp ? 1 : 0;
          if (st.rig && st.rig.free) st.rig.free[i] = 1;
          n++;
        }
        sys.awake = true;
        still = 0;
        return B;
      },
      kick(p, r, v) {
        let hit = 0;
        for (let q = 0; q < n; q++) {
          if (kind[q] === 255) continue;
          const d = Math.hypot(X[q * 3] - p[0], X[q * 3 + 1] - p[1], X[q * 3 + 2] - p[2]);
          if (d > r) continue;
          const w = 1 - d / r;
          Vv[q * 3] += v[0] * w;
          Vv[q * 3 + 1] += v[1] * w;
          Vv[q * 3 + 2] += v[2] * w;
          hit++;
        }
        if (hit) {
          sys.awake = true;
          still = 0;
        }
        return hit;
      },
      collider(c) {
        colliders.push(c);
        sys.awake = true;
        return c;
      },
      /* take out whatever is within r of p (of one body, if given): a bite, a dug hole. What was inside is then on show */
      scoop(p, r, B) {
        let cnt = 0;
        for (let q = 0; q < n; q++) {
          if (kind[q] === 255 || (B && bodies[body[q]] !== B)) continue;
          if (Math.hypot(X[q * 3] - p[0], X[q * 3 + 1] - p[1], X[q * 3 + 2] - p[2]) > r) continue;
          kind[q] = 255;
          const i = idx[q] * 16;
          D[i + 3] = 0;
          B0[i + 3] = 0;
          st.rows[idx[q] >> 9] = 1;
          cnt++;
        }
        if (cnt) {
          sys.awake = true;
          still = 0;
        }
        return cnt;
      },
      bodyAt(p, r) {
        let best = null,
          bd = r === undefined ? 0.7 : r;
        for (let q = 0; q < n; q++) {
          if (kind[q] === 255) continue;
          const d = Math.hypot(X[q * 3] - p[0], X[q * 3 + 1] - p[1], X[q * 3 + 2] - p[2]);
          if (d < bd) {
            bd = d;
            best = bodies[body[q]];
          }
        }
        return best;
      },
      poke(hit, eye, dir) {
        if (!hit || !dir) return;
        const B = sys.bodyAt(hit.p);
        if (!B) return;
        if (B.tap === 'scoop') {
          const cnt = sys.scoop(hit.p, B.scoop, B);
          if (cnt && o.onScoop) o.onScoop(hit.p, B, cnt);
        } else sys.kick(hit.p, o.pokeR || 1.1, [dir[0] * 5, dir[1] * 5 + 1.5, dir[2] * 5]);
      },
      stats(B) {
        const a = B ? B.first : 0,
          b2 = B ? B.first + B.count : n,
          slo = [1e9, 1e9, 1e9],
          shi = [-1e9, -1e9, -1e9],
          c = [0, 0, 0];
        let sp = 0,
          bad = 0,
          live = 0;
        for (let q = a; q < b2; q++) if (kind[q] !== 255) live++;
        for (let q = a; q < b2; q++) {
          if (kind[q] === 255) continue;
          for (let k = 0; k < 3; k++) {
            const v = X[q * 3 + k];
            if (!Number.isFinite(v)) bad++;
            if (v < slo[k]) slo[k] = v;
            if (v > shi[k]) shi[k] = v;
            c[k] += v / live;
          }
          sp = Math.max(sp, Math.hypot(Vv[q * 3], Vv[q * 3 + 1], Vv[q * 3 + 2]));
        }
        return { n: live, speed: sp, lo: slo, hi: shi, c, bad };
      },
      update(dt) {
        if (!n) return;
        if (!solid) nodeMask();
        if (!sys.awake && !colliders.some(c => c.v && (c.v[0] || c.v[1] || c.v[2]))) return;
        let cmax = 1;
        for (const B of bodies) cmax = Math.max(cmax, B.speed);
        acc += Math.min(dt, 0.05);
        const hStep = Math.min(1 / 120, (0.32 * h) / cmax);
        let guard = 0;
        while (acc >= hStep && guard++ < 40) {
          step(hStep);
          acc -= hStep;
        }
        if (guard >= 40) acc = 0;
        write();
      }
    };
    let acc = 0,
      still = 0;
    const wx = [0, 0, 0],
      wy = [0, 0, 0],
      wz = [0, 0, 0],
      xlo = lo[0] + 2 * h,
      xhi = lo[0] + (nx - 3) * h,
      ylo = lo[1] + 2 * h,
      yhi = lo[1] + (ny - 3) * h,
      zlo = lo[2] + 2 * h,
      zhi = lo[2] + (nz - 3) * h;
    function step(dt) {
      sys.steps++;
      gm.fill(0);
      gg.fill(0);
      gv.fill(0);
      const D4 = 4 * ih * ih;
      // ---- matter to grid: each point hands its momentum, and the push of its own stress, to the 27 nodes round it
      for (let p = 0; p < n; p++) {
        if (kind[p] === 255) continue;
        const p3 = p * 3,
          c = p * 9,
          b = p * 6,
          B = bodies[body[p]],
          gx = (X[p3] - lo[0]) * ih,
          gy = (X[p3 + 1] - lo[1]) * ih,
          gz = (X[p3 + 2] - lo[2]) * ih,
          bx = Math.floor(gx - 0.5),
          by = Math.floor(gy - 0.5),
          bz = Math.floor(gz - 0.5),
          fx = gx - bx,
          fy = gy - by,
          fz = gz - bz;
        wx[0] = 0.5 * (1.5 - fx) * (1.5 - fx);
        wx[1] = 0.75 - (fx - 1) * (fx - 1);
        wx[2] = 0.5 * (fx - 0.5) * (fx - 0.5);
        wy[0] = 0.5 * (1.5 - fy) * (1.5 - fy);
        wy[1] = 0.75 - (fy - 1) * (fy - 1);
        wy[2] = 0.5 * (fy - 0.5) * (fy - 0.5);
        wz[0] = 0.5 * (1.5 - fz) * (1.5 - fz);
        wz[1] = 0.75 - (fz - 1) * (fz - 1);
        wz[2] = 0.5 * (fz - 0.5) * (fz - 0.5);
        const b0 = be[b],
          b1 = be[b + 1],
          b2 = be[b + 2],
          b3 = be[b + 3],
          b4 = be[b + 4],
          b5 = be[b + 5],
          det = b0 * (b3 * b5 - b4 * b4) - b1 * (b1 * b5 - b4 * b2) + b2 * (b1 * b4 - b3 * b2),
          J = Math.sqrt(Math.max(det, 1e-6)),
          lj = B.la * Math.log(J),
          mu = B.mu;
        /* Kirchhoff stress of a springy solid, from how far its strain is from none (six numbers: it is symmetric) */
        let t0 = mu * (b0 - 1) + lj,
          t1 = mu * b1,
          t2 = mu * b2,
          t3 = mu * (b3 - 1) + lj,
          t4 = mu * b4,
          t5 = mu * (b5 - 1) + lj;
        if (B.kind === 3) {
          const pr = J < 1 ? lj : 0;
          t0 = t3 = t5 = pr;
          t1 = t2 = t4 = 0;
        }
        const k = -dt * vol[p] * D4,
          m = mass[p],
          mg = m * B.grip,
          a0 = k * t0 + m * C[c],
          a1 = k * t1 + m * C[c + 1],
          a2 = k * t2 + m * C[c + 2],
          a3 = k * t1 + m * C[c + 3],
          a4 = k * t3 + m * C[c + 4],
          a5 = k * t4 + m * C[c + 5],
          a6 = k * t2 + m * C[c + 6],
          a7 = k * t4 + m * C[c + 7],
          a8 = k * t5 + m * C[c + 8],
          mvx = m * Vv[p3],
          mvy = m * Vv[p3 + 1],
          mvz = m * Vv[p3 + 2];
        for (let kk = 0; kk < 3; kk++) {
          const dz = (kk - fz) * h;
          for (let jj = 0; jj < 3; jj++) {
            const dy = (jj - fy) * h,
              wyz = wy[jj] * wz[kk],
              row = bx + nx * (by + jj + ny * (bz + kk));
            for (let ii = 0; ii < 3; ii++) {
              const dx = (ii - fx) * h,
                w = wx[ii] * wyz,
                q = row + ii,
                q3 = q * 3;
              gm[q] += w * m;
              gg[q] += w * mg;
              gv[q3] += w * (mvx + a0 * dx + a1 * dy + a2 * dz);
              gv[q3 + 1] += w * (mvy + a3 * dx + a4 * dy + a5 * dz);
              gv[q3 + 2] += w * (mvz + a6 * dx + a7 * dy + a8 * dz);
            }
          }
        }
      }
      // ---- the grid: weight, drag, and whatever is in the way
      const drag = Math.max(0, 1 - damp * dt);
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++) {
          const y = lo[1] + j * h;
          for (let i = 0; i < nx; i++) {
            const q = i + nx * (j + ny * k),
              m = gm[q];
            if (m <= 1e-12) continue;
            const q3 = q * 3,
              hold = 1 - gg[q] / m;
            let vx = (gv[q3] / m) * drag,
              vy = (gv[q3 + 1] / m - g * dt) * drag,
              vz = (gv[q3 + 2] / m) * drag;
            const fl = floorF ? floorF(lo[0] + i * h, lo[2] + k * h) : floorY;
            if (y <= fl + 1e-6 && vy < 0) {
              vy = 0;
              vx *= hold;
              vz *= hold;
            }
            if (solid[q]) {
              const nxn = snrm[q3],
                nyn = snrm[q3 + 1],
                nzn = snrm[q3 + 2],
                vn = vx * nxn + vy * nyn + vz * nzn;
              if (vn < 0) {
                vx = (vx - vn * nxn) * hold;
                vy = (vy - vn * nyn) * hold;
                vz = (vz - vn * nzn) * hold;
              }
            }
            for (let ci = 0; ci < colliders.length; ci++) {
              const cl = colliders[ci],
                x = lo[0] + i * h,
                z = lo[2] + k * h,
                d = cl.sd(x, y, z);
              if (d >= 0) continue;
              const e = h * 0.5;
              let nxn = cl.sd(x + e, y, z) - cl.sd(x - e, y, z),
                nyn = cl.sd(x, y + e, z) - cl.sd(x, y - e, z),
                nzn = cl.sd(x, y, z + e) - cl.sd(x, y, z - e);
              const l = Math.hypot(nxn, nyn, nzn) || 1;
              nxn /= l;
              nyn /= l;
              nzn /= l;
              const cv = cl.v || [0, 0, 0],
                rx = vx - cv[0],
                ry = vy - cv[1],
                rz = vz - cv[2],
                vn = rx * nxn + ry * nyn + rz * nzn;
              if (vn < 0) {
                vx = (rx - vn * nxn) * hold + cv[0];
                vy = (ry - vn * nyn) * hold + cv[1];
                vz = (rz - vn * nzn) * hold + cv[2];
              }
            }
            if ((i < 2 && vx < 0) || (i > nx - 3 && vx > 0)) vx = 0;
            if (j > ny - 3 && vy > 0) vy = 0;
            if (j < 2 && vy < 0) vy = 0;
            if ((k < 2 && vz < 0) || (k > nz - 3 && vz > 0)) vz = 0;
            gv[q3] = vx;
            gv[q3 + 1] = vy;
            gv[q3 + 2] = vz;
          }
        }
      // ---- grid to matter: each point takes its new velocity and how that velocity changes round it, moves, and strains
      let vmax = 0;
      for (let p = 0; p < n; p++) {
        if (kind[p] === 255) continue;
        const p3 = p * 3,
          c = p * 9,
          b = p * 6,
          B = bodies[body[p]],
          gx = (X[p3] - lo[0]) * ih,
          gy = (X[p3 + 1] - lo[1]) * ih,
          gz = (X[p3 + 2] - lo[2]) * ih,
          bx = Math.floor(gx - 0.5),
          by = Math.floor(gy - 0.5),
          bz = Math.floor(gz - 0.5),
          fx = gx - bx,
          fy = gy - by,
          fz = gz - bz;
        wx[0] = 0.5 * (1.5 - fx) * (1.5 - fx);
        wx[1] = 0.75 - (fx - 1) * (fx - 1);
        wx[2] = 0.5 * (fx - 0.5) * (fx - 0.5);
        wy[0] = 0.5 * (1.5 - fy) * (1.5 - fy);
        wy[1] = 0.75 - (fy - 1) * (fy - 1);
        wy[2] = 0.5 * (fy - 0.5) * (fy - 0.5);
        wz[0] = 0.5 * (1.5 - fz) * (1.5 - fz);
        wz[1] = 0.75 - (fz - 1) * (fz - 1);
        wz[2] = 0.5 * (fz - 0.5) * (fz - 0.5);
        let vx = 0,
          vy = 0,
          vz = 0,
          c0 = 0,
          c1 = 0,
          c2 = 0,
          c3 = 0,
          c4 = 0,
          c5 = 0,
          c6 = 0,
          c7 = 0,
          c8 = 0;
        for (let kk = 0; kk < 3; kk++) {
          const dz = (kk - fz) * h;
          for (let jj = 0; jj < 3; jj++) {
            const dy = (jj - fy) * h,
              wyz = wy[jj] * wz[kk],
              row = bx + nx * (by + jj + ny * (bz + kk));
            for (let ii = 0; ii < 3; ii++) {
              const dx = (ii - fx) * h,
                w = wx[ii] * wyz,
                q3 = (row + ii) * 3,
                ux = gv[q3] * w,
                uy = gv[q3 + 1] * w,
                uz = gv[q3 + 2] * w;
              vx += ux;
              vy += uy;
              vz += uz;
              c0 += ux * dx;
              c1 += ux * dy;
              c2 += ux * dz;
              c3 += uy * dx;
              c4 += uy * dy;
              c5 += uy * dz;
              c6 += uz * dx;
              c7 += uz * dy;
              c8 += uz * dz;
            }
          }
        }
        c0 *= D4;
        c1 *= D4;
        c2 *= D4;
        c3 *= D4;
        c4 *= D4;
        c5 *= D4;
        c6 *= D4;
        c7 *= D4;
        c8 *= D4;
        /* stuff that is thick inside loses the part of its motion that is a change of shape (never the part that is a turn) */
        if (B.visc > 0) {
          const k = Math.max(0.3, 1 - B.visc * dt),
            a = (c1 + c3) / 2,
            w1 = (c1 - c3) / 2,
            bq = (c2 + c6) / 2,
            w2 = (c2 - c6) / 2,
            cq = (c5 + c7) / 2,
            w3 = (c5 - c7) / 2;
          c0 *= k;
          c4 *= k;
          c8 *= k;
          c1 = a * k + w1;
          c3 = a * k - w1;
          c2 = bq * k + w2;
          c6 = bq * k - w2;
          c5 = cq * k + w3;
          c7 = cq * k - w3;
        }
        Vv[p3] = vx;
        Vv[p3 + 1] = vy;
        Vv[p3 + 2] = vz;
        C[c] = c0;
        C[c + 1] = c1;
        C[c + 2] = c2;
        C[c + 3] = c3;
        C[c + 4] = c4;
        C[c + 5] = c5;
        C[c + 6] = c6;
        C[c + 7] = c7;
        C[c + 8] = c8;
        const sp = vx * vx + vy * vy + vz * vz;
        if (sp > vmax) vmax = sp;
        let x = X[p3] + vx * dt,
          y = X[p3 + 1] + vy * dt,
          z = X[p3 + 2] + vz * dt;
        X[p3] = x < xlo ? xlo : x > xhi ? xhi : x;
        X[p3 + 1] = y < ylo ? ylo : y > yhi ? yhi : y;
        X[p3 + 2] = z < zlo ? zlo : z > zhi ? zhi : z;
        /* strain carried along: be <- (I + dt C) be (I + dt C)^T */
        const m0 = 1 + dt * c0,
          m1 = dt * c1,
          m2 = dt * c2,
          m3 = dt * c3,
          m4 = 1 + dt * c4,
          m5 = dt * c5,
          m6 = dt * c6,
          m7 = dt * c7,
          m8 = 1 + dt * c8,
          e0 = be[b],
          e1 = be[b + 1],
          e2 = be[b + 2],
          e3 = be[b + 3],
          e4 = be[b + 4],
          e5 = be[b + 5];
        const r0 = m0 * e0 + m1 * e1 + m2 * e2,
          r1 = m0 * e1 + m1 * e3 + m2 * e4,
          r2 = m0 * e2 + m1 * e4 + m2 * e5,
          r3 = m3 * e0 + m4 * e1 + m5 * e2,
          r4 = m3 * e1 + m4 * e3 + m5 * e4,
          r5 = m3 * e2 + m4 * e4 + m5 * e5,
          r6 = m6 * e0 + m7 * e1 + m8 * e2,
          r7 = m6 * e1 + m7 * e3 + m8 * e4,
          r8 = m6 * e2 + m7 * e4 + m8 * e5;
        let n0 = r0 * m0 + r1 * m1 + r2 * m2,
          n1 = r0 * m3 + r1 * m4 + r2 * m5,
          n2 = r0 * m6 + r1 * m7 + r2 * m8,
          n3 = r3 * m3 + r4 * m4 + r5 * m5,
          n4 = r3 * m6 + r4 * m7 + r5 * m8,
          n5 = r6 * m6 + r7 * m7 + r8 * m8;
        if (B.kind > 0) {
          const det = n0 * (n3 * n5 - n4 * n4) - n1 * (n1 * n5 - n4 * n2) + n2 * (n1 * n4 - n3 * n2),
            J = Math.sqrt(Math.max(det, 1e-6)),
            j23 = Math.cbrt(J * J);
          if (B.kind === 3) {
            const Jc = J > 1 ? 1 : J < 0.55 ? 0.55 : J,
              s = Math.cbrt(Jc * Jc);
            n0 = n3 = n5 = s;
            n1 = n2 = n4 = 0;
          } else if (B.kind === 2 && J >= 1) {
            n0 = n3 = n5 = 1;
            n1 = n2 = n4 = 0;
          } else {
            /* what is left when the change of volume is taken out is the change of shape: past a limit it gives, and stays given */
            const tr = (n0 + n3 + n5) / (3 * j23),
              d0 = n0 / j23 - tr,
              d3 = n3 / j23 - tr,
              d5 = n5 / j23 - tr,
              d1 = n1 / j23,
              d2 = n2 / j23,
              d4 = n4 / j23,
              s = B.mu * Math.sqrt(d0 * d0 + d3 * d3 + d5 * d5 + 2 * (d1 * d1 + d2 * d2 + d4 * d4)),
              lim = B.kind === 1 ? B.yield : Math.max(0, -B.la * Math.log(J)) * B.fric;
            if (s > lim) {
              const f = lim / s;
              n0 = (d0 * f + tr) * j23;
              n3 = (d3 * f + tr) * j23;
              n5 = (d5 * f + tr) * j23;
              n1 = d1 * f * j23;
              n2 = d2 * f * j23;
              n4 = d4 * f * j23;
            }
          }
        } else {
          const det = n0 * (n3 * n5 - n4 * n4) - n1 * (n1 * n5 - n4 * n2) + n2 * (n1 * n4 - n3 * n2);
          if (!(det > 0.02) || n0 + n3 + n5 > 40) {
            n0 = n3 = n5 = 1;
            n1 = n2 = n4 = 0;
          }
        }
        be[b] = n0;
        be[b + 1] = n1;
        be[b + 2] = n2;
        be[b + 3] = n3;
        be[b + 4] = n4;
        be[b + 5] = n5;
        if (shape[p]) {
          const f0 = Fv[c],
            f1 = Fv[c + 1],
            f2 = Fv[c + 2],
            f3 = Fv[c + 3],
            f4 = Fv[c + 4],
            f5 = Fv[c + 5],
            f6 = Fv[c + 6],
            f7 = Fv[c + 7],
            f8 = Fv[c + 8];
          let g0 = m0 * f0 + m1 * f3 + m2 * f6,
            g1 = m0 * f1 + m1 * f4 + m2 * f7,
            g2 = m0 * f2 + m1 * f5 + m2 * f8,
            g3 = m3 * f0 + m4 * f3 + m5 * f6,
            g4 = m3 * f1 + m4 * f4 + m5 * f7,
            g5 = m3 * f2 + m4 * f5 + m5 * f8,
            g6 = m6 * f0 + m7 * f3 + m8 * f6,
            g7 = m6 * f1 + m7 * f4 + m8 * f7,
            g8 = m6 * f2 + m7 * f5 + m8 * f8;
          const sum = g0 * g0 + g1 * g1 + g2 * g2 + g3 * g3 + g4 * g4 + g5 * g5 + g6 * g6 + g7 * g7 + g8 * g8;
          if (sum > 9) {
            const f = Math.sqrt(9 / sum);
            g0 *= f;
            g1 *= f;
            g2 *= f;
            g3 *= f;
            g4 *= f;
            g5 *= f;
            g6 *= f;
            g7 *= f;
            g8 *= f;
          }
          Fv[c] = g0;
          Fv[c + 1] = g1;
          Fv[c + 2] = g2;
          Fv[c + 3] = g3;
          Fv[c + 4] = g4;
          Fv[c + 5] = g5;
          Fv[c + 6] = g6;
          Fv[c + 7] = g7;
          Fv[c + 8] = g8;
        }
      }
      if (vmax < 0.005) {
        if (++still > 90) {
          sys.awake = false;
          Vv.fill(0);
          C.fill(0);
        }
      } else still = 0;
    }
    // the splats follow: each sits where its point is, and (for stuff that keeps a shape) is stretched and turned as the stuff round it has been
    function write() {
      for (let p = 0; p < n; p++) {
        if (kind[p] === 255) continue;
        const q = idx[p] * 16,
          p3 = p * 3;
        D[q] = X[p3];
        D[q + 1] = X[p3 + 1];
        D[q + 2] = X[p3 + 2];
        st.rows[idx[p] >> 9] = 1;
        if (!shape[p]) continue;
        const c = p * 9,
          f0 = Fv[c],
          f1 = Fv[c + 1],
          f2 = Fv[c + 2],
          f3 = Fv[c + 3],
          f4 = Fv[c + 4],
          f5 = Fv[c + 5],
          f6 = Fv[c + 6],
          f7 = Fv[c + 7],
          f8 = Fv[c + 8],
          s0 = B0[q + 4],
          s1 = B0[q + 5],
          s2 = B0[q + 6],
          s3 = B0[q + 8],
          s4 = B0[q + 9],
          s5 = B0[q + 10];
        const r0 = f0 * s0 + f1 * s1 + f2 * s2,
          r1 = f0 * s1 + f1 * s3 + f2 * s4,
          r2 = f0 * s2 + f1 * s4 + f2 * s5,
          r3 = f3 * s0 + f4 * s1 + f5 * s2,
          r4 = f3 * s1 + f4 * s3 + f5 * s4,
          r5 = f3 * s2 + f4 * s4 + f5 * s5,
          r6 = f6 * s0 + f7 * s1 + f8 * s2,
          r7 = f6 * s1 + f7 * s3 + f8 * s4,
          r8 = f6 * s2 + f7 * s4 + f8 * s5;
        D[q + 4] = r0 * f0 + r1 * f1 + r2 * f2;
        D[q + 5] = r0 * f3 + r1 * f4 + r2 * f5;
        D[q + 6] = r0 * f6 + r1 * f7 + r2 * f8;
        D[q + 8] = r3 * f3 + r4 * f4 + r5 * f5;
        D[q + 9] = r3 * f6 + r4 * f7 + r5 * f8;
        D[q + 10] = r6 * f6 + r7 * f7 + r8 * f8;
      }
    }
    return sys;
  };
})(KIT);
