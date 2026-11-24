/* kw-erode: breaking, wearing away, and rock laid down in layers.
   K.fracture(S, src, o)       a solid cut into voronoi cells using distance fields: src is a held solid (made with
                       { hold: true }). o.n (cells, 14), at (where it was struck: the cells are smaller there), seed, gap (between cells, 0).
                       -> { cells: [{ seed, sd(x, y, z) (where it was), bc, br, pts (points on its surface, from bc) }], src }
   K.fracture.put(S, cell, pose, mat, o)   one cell as a solid, moved: pose { at (where its middle goes), R (a turn, rows: where its x, y
                       and z go) }. mat is the outside; o.inner the faces the break made (a ramp or a material)
   K.fracture.fall(S, fr, mat, o)   every cell dropped from where it was, thrown out from o.at by o.throw (0.6), turned a little at random
                       (o.tumble, 0.5), and left to settle on the ground and on the pieces under it, lowest first. o.keep(cell) -> true: that
                       one stays where it was (the stump of a broken column). -> [{ cell, solid, at, up }]
   K.erode(h, o)       a height field worn by water and by slumping (hydraulic droplets, then thermal slides).
                       h(x, z) the land; o.box [x0, x1, z0, z1], cell (0.1), drops (12000), life (40 steps), erode (0.3), deposit (0.3),
                       capacity (4), inertia (0.08), evaporate (0.02), radius (2 cells), talus (the steepest a slope of loose stuff stands,
                       0.9), slides (16 passes), seed.  -> { h(x, z) (the worn land), flow(x, z) 0..1 (where water ran: gullies), dep(x, z)
                       (laid down, above 0: fans and scree; cut away, below), grid }
   K.form.strata(S, mat, o)   rock laid down in beds, the soft ones worn back further than the hard: ledges, benches and overhangs come of
                       themselves. o.plan(x, z) -> signed distance of its outline in plan (or o.r and o.at for a round one), y0 (its foot),
                       top, beds: [[y, hard 0..1], ...] (each from that height up to the next), clip(x, y, z) (a distance it is also
                       kept inside: an envelope), inset (how far a soft bed is worn back, 0.4),
                       batter (how much wider it is a unit lower, 0.08), rough (0.12), cap (how far the top bed overhangs, 0), notch
                       { y, h, depth } (a groove worn in at one height: the waterline of a sea stack), below (nothing under this height is
                       sampled: what the ground hides), cell (the distance is kept on a grid this fine, 0.09; 0 for exact), res.
                       -> the solid, with .bed(y) -> { i, hard } (for a material's mod: each bed its own shade)
   K.form.hoodoo(S, at, mat, o)    a thin pillar of soft rock under a hard cap: o.h (3), r (0.45), cap (how much wider the cap, 0.35),
                       beds (n, 5), seed
   K.form.arch(S, at, mat, o)      a fin of layered rock with a hole worn through a soft bed: o.len (5), w (0.9), h (3.2), yaw, span (2.4),
                       rise (1.6: the hole's height), seed
   K.tab2(fn, box, cell)       a function of (x, z) worked out once on a grid and looked up from then on (box [x0, x1, z0, z1])
   K.form.mud(o)       cracked mud: plates whose edges curl up, split by cracks. o.scale (0.7), crack (0.05), curl (0.05), depth (0.08), seed.
                       -> { h(x, z) (to add to the ground), crack(x, z) 0..1 }
   K.form.pebbles(S, mat, o)   pebbles along a stream bed, sorted by size: big where the water runs fastest (the middle of the channel),
                       finer toward its banks and downstream. o.path (the channel), width (1.2), n (220), size [lo, hi], sink (0.3), seed.
   K.form.boulders(S, mat, o)  a field of boulders: a few rocks grown once and copied, each dropped and settled on what is there (big ones
                       first, so the small ones lie against them). o.box, n (60), size [lo, hi], kinds (4), facets, chip, worn (as
                       K.grow.rock), settle (true), solid (true), seed */
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
  const sm = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // a turn: up tilted toward `up`, then turned `yaw` about it. Rows: where x, y and z go
  const turn = (up, yaw) => {
    const Y = norm(up),
      ref = Math.abs(Y[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let X = norm(cross(ref, Y));
    let Z = cross(X, Y);
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    const X2 = [X[0] * c + Z[0] * s, X[1] * c + Z[1] * s, X[2] * c + Z[2] * s];
    Z = cross(X2, Y);
    X = X2;
    if (Math.abs(Y[1]) >= 0.95 && Y[1] > 0) return [X, Y, Z];
    return [X, Y, Z];
  };

  // ---------------------------------------------------------------- fracture
  const FR = (K.fracture = (S, src, o) => {
    o = o || {};
    const R = dice(o.seed || 17),
      n = o.n || 14,
      sd0 = typeof src === 'function' ? src : (x, y, z) => S.psd(src, x, y, z),
      bc = src.bc || o.bc,
      br = src.br || o.br,
      gap = o.gap || 0,
      seeds = [];
    // seeds inside the solid, closer together near where it was struck
    for (let t = 0; seeds.length < n && t < n * 400; t++) {
      const p = [bc[0] + (R() * 2 - 1) * br, bc[1] + (R() * 2 - 1) * br, bc[2] + (R() * 2 - 1) * br];
      if (sd0(p[0], p[1], p[2]) > 0) continue;
      if (o.at) {
        const d = Math.hypot(p[0] - o.at[0], p[1] - o.at[1], p[2] - o.at[2]) / br;
        if (R() > Math.exp(-d * 1.6) * 0.9 + 0.1) continue;
      }
      seeds.push(p);
    }
    const cells = seeds.map((s, i) => {
      // its neighbours: the nearest dozen seeds are enough to bound a cell
      const nb = seeds
        .map((q, j) => [j, Math.hypot(q[0] - s[0], q[1] - s[1], q[2] - s[2])])
        .filter(a => a[0] !== i)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 14)
        .map(([j]) => {
          const q = seeds[j],
            nn = norm([q[0] - s[0], q[1] - s[1], q[2] - s[2]]),
            m = [(q[0] + s[0]) / 2, (q[1] + s[1]) / 2, (q[2] + s[2]) / 2];
          return [nn[0], nn[1], nn[2], dot(nn, m) - gap / 2];
        });
      const sd = (x, y, z) => {
        let d = sd0(x, y, z);
        for (const P of nb) {
          const q = P[0] * x + P[1] * y + P[2] * z - P[3];
          if (q > d) d = q;
        }
        return d;
      };
      return { seed: s, sd, planes: nb };
    });
    // each cell's middle and size, and points on its surface: from a grid over the solid, every point given to its nearest seed
    const step = br / 14;
    const owned = cells.map(() => []);
    for (let x = bc[0] - br; x <= bc[0] + br; x += step)
      for (let y = bc[1] - br; y <= bc[1] + br; y += step)
        for (let z = bc[2] - br; z <= bc[2] + br; z += step) {
          if (sd0(x, y, z) > 0) continue;
          let bi = 0,
            bd = 1e9;
          for (let i = 0; i < seeds.length; i++) {
            const d = (x - seeds[i][0]) ** 2 + (y - seeds[i][1]) ** 2 + (z - seeds[i][2]) ** 2;
            if (d < bd) ((bd = d), (bi = i));
          }
          owned[bi].push([x, y, z]);
        }
    cells.forEach((c, i) => {
      const L = owned[i].length ? owned[i] : [c.seed];
      const m = [0, 1, 2].map(k => L.reduce((a, p) => a + p[k], 0) / L.length);
      let r = 0;
      for (const p of L) r = Math.max(r, Math.hypot(p[0] - m[0], p[1] - m[1], p[2] - m[2]));
      c.bc = m;
      c.br = r + step * 1.2;
      c.vol = L.length * step ** 3;
      // surface points, from the middle: the grid's points pulled onto the cell's own surface
      c.pts = [];
      for (const p of L.length > 400 ? L.filter((_, k) => k % Math.ceil(L.length / 400) === 0) : L) {
        let q = p.slice();
        for (let it = 0; it < 12; it++) {
          const d = c.sd(q[0], q[1], q[2]);
          if (Math.abs(d) < 1e-3) break;
          const e = 0.004,
            g = norm([c.sd(q[0] + e, q[1], q[2]) - d, c.sd(q[0], q[1] + e, q[2]) - d, c.sd(q[0], q[1], q[2] + e) - d]);
          q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
        }
        c.pts.push([q[0] - m[0], q[1] - m[1], q[2] - m[2]]);
      }
    });
    return { cells: cells.filter(c => c.vol > 0), src: sd0 };
  });

  FR.put = (S, cell, pose, mat, o) => {
    o = o || {};
    const at = pose.at || cell.bc,
      Rw = pose.R || [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ],
      c = cell.bc,
      // from the world back into where the cell was made
      back = (x, y, z) => {
        const dx = x - at[0],
          dy = y - at[1],
          dz = z - at[2];
        return [
          c[0] + Rw[0][0] * dx + Rw[0][1] * dy + Rw[0][2] * dz,
          c[1] + Rw[1][0] * dx + Rw[1][1] * dy + Rw[1][2] * dz,
          c[2] + Rw[2][0] * dx + Rw[2][1] * dy + Rw[2][2] * dz
        ];
      },
      out = (p0, p1, p2) => [
        at[0] + Rw[0][0] * p0 + Rw[1][0] * p1 + Rw[2][0] * p2,
        at[1] + Rw[0][1] * p0 + Rw[1][1] * p1 + Rw[2][1] * p2,
        at[2] + Rw[0][2] * p0 + Rw[1][2] * p1 + Rw[2][2] * p2
      ],
      src = o.src,
      outer = Array.isArray(mat) ? { r: mat } : mat,
      inner = o.inner ? (Array.isArray(o.inner) ? { r: o.inner } : o.inner) : outer,
      // the faces the break made take the inside's colours (what was inside the solid there)
      m =
        src && inner !== outer
          ? Object.assign({}, outer, {
              rf: (x, y, z) => {
                const q = back(x, y, z);
                return src(q[0], q[1], q[2]) > -0.04
                  ? (outer.rf ? outer.rf(q[0], q[1], q[2]) : null) || outer.r
                  : inner.r;
              }
            })
          : outer;
    const p = {
      bc: at,
      br: cell.br,
      sd: (x, y, z) => {
        const q = back(x, y, z);
        return cell.sd(q[0], q[1], q[2]);
      },
      sample(f) {
        const res = this.res;
        for (let a = -cell.br; a <= cell.br; a += res * 0.8)
          for (let b = -cell.br; b <= cell.br; b += res * 0.8)
            for (let d = -cell.br; d <= cell.br; d += res * 0.8) {
              const v = cell.sd(c[0] + a, c[1] + b, c[2] + d);
              if (Math.abs(v) < res * 0.6) {
                const w = out(a, b, d);
                f(w[0], w[1], w[2]);
              }
            }
      }
    };
    return S.add(p, m, Object.assign({ reach: 0.03 }, o));
  };

  FR.fall = (S, fr, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 23),
      at = o.at || [0, 0, 0],
      thr = o.throw === undefined ? 0.6 : o.throw,
      tum = o.tumble === undefined ? 0.5 : o.tumble,
      out = [],
      order = fr.cells.slice().sort((a, b) => a.bc[1] - b.bc[1]);
    for (const cell of order) {
      if (o.keep && o.keep(cell)) {
        out.push({
          cell,
          solid: FR.put(S, cell, {}, mat, { inner: o.inner, src: fr.src, res: o.res, tag: o.tag }),
          at: cell.bc,
          up: [0, 1, 0]
        });
        continue;
      }
      const away = norm([cell.bc[0] - at[0] + (R() - 0.5) * 0.6, 0, cell.bc[2] - at[2] + (R() - 0.5) * 0.6]),
        h = Math.max(0, cell.bc[1] - (o.floor || 0)),
        start = [
          cell.bc[0] + away[0] * thr * (0.4 + h * 0.5) * (0.5 + R()),
          cell.bc[1] + 0.2,
          cell.bc[2] + away[2] * thr * (0.4 + h * 0.5) * (0.5 + R())
        ],
        tilt = norm([(R() - 0.5) * tum * 2, 1, (R() - 0.5) * tum * 2]),
        rot = turn(tilt, R() * Math.PI * 2),
        // the cell's own distance, about its middle and turned as it will lie
        sdT = (x, y, z) => {
          const q = [
            cell.bc[0] + rot[0][0] * x + rot[0][1] * y + rot[0][2] * z,
            cell.bc[1] + rot[1][0] * x + rot[1][1] * y + rot[1][2] * z,
            cell.bc[2] + rot[2][0] * x + rot[2][1] * y + rot[2][2] * z
          ];
          return cell.sd(q[0], q[1], q[2]);
        },
        ptsT = cell.pts.map(p => [
          rot[0][0] * p[0] + rot[1][0] * p[1] + rot[2][0] * p[2],
          rot[0][1] * p[0] + rot[1][1] * p[1] + rot[2][1] * p[2],
          rot[0][2] * p[0] + rot[1][2] * p[1] + rot[2][2] * p[2]
        ]);
      const st = K.grow.settle(S, sdT, start, { pts: ptsT.filter(p => p[1] < cell.br * 0.4), lean: 0 });
      const solid = FR.put(S, cell, { at: st.at, R: rot }, mat, {
        inner: o.inner,
        src: fr.src,
        res: o.res,
        tag: o.tag
      });
      out.push({ cell, solid, at: st.at, up: tilt });
    }
    return out;
  };

  // ---------------------------------------------------------------- erosion
  K.erode = (h0, o) => {
    o = o || {};
    const box = o.box,
      cell = o.cell || 0.1,
      nx = Math.ceil((box[1] - box[0]) / cell) + 1,
      nz = Math.ceil((box[3] - box[2]) / cell) + 1,
      H = new Float32Array(nx * nz),
      W = new Float32Array(nx * nz),
      D = new Float32Array(nx * nz),
      R = dice(o.seed || 29);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) H[j * nx + i] = h0(box[0] + i * cell, box[2] + j * cell);
    const H0 = Float32Array.from(H);
    // height and slope at a point between grid points
    const hg = (x, z, out) => {
      const i = Math.max(0, Math.min(nx - 2, Math.floor(x))),
        j = Math.max(0, Math.min(nz - 2, Math.floor(z))),
        u = x - i,
        v = z - j,
        a = H[j * nx + i],
        b = H[j * nx + i + 1],
        c = H[(j + 1) * nx + i],
        d = H[(j + 1) * nx + i + 1];
      out[0] = (b - a) * (1 - v) + (d - c) * v;
      out[1] = (c - a) * (1 - u) + (d - b) * u;
      return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
    };
    const rad = o.radius || 2,
      brush = [];
    let wsum = 0;
    for (let b = -rad; b <= rad; b++)
      for (let a = -rad; a <= rad; a++) {
        const w = Math.max(0, rad - Math.hypot(a, b));
        if (w > 0) {
          brush.push([a, b, w]);
          wsum += w;
        }
      }
    for (const q of brush) q[2] /= wsum;
    const inert = o.inertia === undefined ? 0.08 : o.inertia,
      capK = o.capacity || 4,
      erK = o.erode === undefined ? 0.3 : o.erode,
      depK = o.deposit === undefined ? 0.3 : o.deposit,
      evap = o.evaporate === undefined ? 0.02 : o.evaporate,
      grav = o.gravity || 4,
      life = o.life || 40,
      g = [0, 0];
    for (let n = 0; n < (o.drops || 12000); n++) {
      let x = R() * (nx - 1.001),
        z = R() * (nz - 1.001),
        dx = 0,
        dz = 0,
        sp = 1,
        water = 1,
        sed = 0;
      for (let k = 0; k < life; k++) {
        const ci = Math.floor(x),
          cj = Math.floor(z),
          u = x - ci,
          v = z - cj,
          hOld = hg(x, z, g);
        dx = dx * inert - g[0] * (1 - inert);
        dz = dz * inert - g[1] * (1 - inert);
        const l = Math.hypot(dx, dz);
        if (l < 1e-6) break;
        dx /= l;
        dz /= l;
        x += dx;
        z += dz;
        if (x < 0 || z < 0 || x >= nx - 1 || z >= nz - 1) break;
        W[cj * nx + ci] += water;
        const hNew = hg(x, z, g),
          dh = hNew - hOld,
          cap = Math.max(-dh * sp * water * capK, 0.01 * cell);
        if (sed > cap || dh > 0) {
          // laid down: in the four corners of the cell it has just left
          const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depK;
          sed -= amt;
          const idx = cj * nx + ci;
          H[idx] += amt * (1 - u) * (1 - v);
          H[idx + 1] += amt * u * (1 - v);
          H[idx + nx] += amt * (1 - u) * v;
          H[idx + nx + 1] += amt * u * v;
        } else {
          const amt = Math.min((cap - sed) * erK, -dh);
          for (const [a, b, w] of brush) {
            const ii = ci + a,
              jj = cj + b;
            if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
            const idx = jj * nx + ii,
              take = Math.min(H[idx] - (H0[idx] - 3), amt * w);
            H[idx] -= take;
            sed += take;
          }
        }
        sp = Math.sqrt(Math.max(0, sp * sp + dh * -grav));
        water *= 1 - evap;
      }
    }
    // slumping: wherever a slope is steeper than loose stuff can stand, some slides down to the lowest neighbour
    const talus = (o.talus === undefined ? 0.9 : o.talus) * cell;
    for (let pass = 0; pass < (o.slides === undefined ? 16 : o.slides); pass++)
      for (let j = 1; j < nz - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          const idx = j * nx + i;
          let lo = idx,
            dmax = 0;
          for (const k of [idx - 1, idx + 1, idx - nx, idx + nx]) {
            const d = H[idx] - H[k];
            if (d > dmax) ((dmax = d), (lo = k));
          }
          if (dmax > talus) {
            const mv = (dmax - talus) * 0.25;
            H[idx] -= mv;
            H[lo] += mv;
          }
        }
    let wm = 0;
    for (let i = 0; i < W.length; i++) {
      D[i] = H[i] - H0[i];
      wm = Math.max(wm, W[i]);
    }
    const look = (A, x, z, outside) => {
      const fx = (x - box[0]) / cell,
        fz = (z - box[2]) / cell;
      if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return outside(x, z);
      const i = Math.min(nx - 2, Math.floor(fx)),
        j = Math.min(nz - 2, Math.floor(fz)),
        u = fx - i,
        v = fz - j;
      return (
        A[j * nx + i] * (1 - u) * (1 - v) +
        A[j * nx + i + 1] * u * (1 - v) +
        A[(j + 1) * nx + i] * (1 - u) * v +
        A[(j + 1) * nx + i + 1] * u * v
      );
    };
    // (the edge of the worn box is blended into the land outside it over a few cells, so there is no step there)
    const edge = (x, z) => sm(0, cell * 6, Math.min(x - box[0], box[1] - x, z - box[2], box[3] - z));
    const Wl = Float32Array.from(W, w => Math.sqrt(w / (wm || 1)));
    return {
      h: (x, z) => {
        const e = edge(x, z);
        return e <= 0 ? h0(x, z) : e >= 1 ? look(H, x, z, h0) : h0(x, z) + (look(H, x, z, h0) - h0(x, z)) * e;
      },
      flow: (x, z) => look(Wl, x, z, () => 0) * edge(x, z),
      dep: (x, z) => look(D, x, z, () => 0) * edge(x, z),
      grid: { H, W: Wl, D, nx, nz, cell, box }
    };
  };

  /* K.tab2(fn, box, cell): a function of (x, z) worked out once on a grid and looked up between its points from then on (a height
     with cracks in it, asked for by every look at the ground, costs as much as one lookup). Outside the box fn itself is asked */
  K.tab2 = (fn, box, cell) => {
    const nx = Math.ceil((box[1] - box[0]) / cell) + 1,
      nz = Math.ceil((box[3] - box[2]) / cell) + 1,
      T = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) T[j * nx + i] = fn(box[0] + i * cell, box[2] + j * cell);
    return (x, z) => {
      const fx = (x - box[0]) / cell,
        fz = (z - box[2]) / cell;
      if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return fn(x, z);
      const i = Math.floor(fx),
        j = Math.floor(fz),
        u = fx - i,
        v = fz - j,
        q = j * nx + i;
      return T[q] * (1 - u) * (1 - v) + T[q + 1] * u * (1 - v) + T[q + nx] * (1 - u) * v + T[q + nx + 1] * u * v;
    };
  };

  // ---------------------------------------------------------------- layered rock
  const F = K.form || (K.form = {});
  F.strata = (S, mat, o) => {
    o = o || {};
    const beds = (o.beds || [[-1e9, 0.5]]).slice().sort((a, b) => a[0] - b[0]),
      inset = o.inset === undefined ? 0.4 : o.inset,
      batter = o.batter === undefined ? 0.08 : o.batter,
      rough = o.rough === undefined ? 0.12 : o.rough,
      y0 = o.y0 === undefined ? -1 : o.y0,
      top = o.top === undefined ? 3 : o.top,
      cap = o.cap || 0,
      nt = K.tex.noise(o.grain || 1.4, 3),
      plan = o.plan || ((x, z) => Math.hypot(x - o.at[0], z - o.at[2]) - o.r),
      blend = o.blend || 0.1;
    const bed = y => {
      let i = 0;
      while (i + 1 < beds.length && y >= beds[i + 1][0]) i++;
      return { i, hard: beds[i][1] };
    };
    // how far back the wall stands at height y: soft beds further, the change between two beds eased over `blend`
    const back = y => {
      let i = 0;
      while (i + 1 < beds.length && y >= beds[i + 1][0]) i++;
      let hard = beds[i][1];
      if (i + 1 < beds.length) hard += (beds[i + 1][1] - hard) * sm(beds[i + 1][0] - blend, beds[i + 1][0], y);
      if (i > 0) hard += (beds[i - 1][1] - hard) * (1 - sm(beds[i][0], beds[i][0] + blend, y));
      let r = inset * (1 - hard) - batter * (top - y);
      if (y > top - (o.capH || 0.35)) r -= cap;
      if (o.notch) r += o.notch.depth * Math.exp(-(((y - o.notch.y) / (o.notch.h || 0.3)) ** 2));
      return r;
    };
    const k = 1 / Math.sqrt(1 + (inset / blend) ** 2 * 0.25 + batter * batter);
    const clip = o.clip || null,
      sd0 = clip
        ? (x, y, z) =>
            Math.max((plan(x, z) + back(y) + rough * (nt(x, y, z) - 0.5)) * k, y - top, y0 - y, clip(x, y, z))
        : (x, y, z) => Math.max((plan(x, z) + back(y) + rough * (nt(x, y, z) - 0.5)) * k, y - top, y0 - y);
    // its extent: the plan is felt for on a grid
    const step = o.step || 0.25;
    let lo = [1e9, 1e9],
      hi = [-1e9, -1e9];
    const ext = o.extent || 8,
      cx = o.at ? o.at[0] : 0,
      cz = o.at ? o.at[2] : 0;
    for (let x = cx - ext; x <= cx + ext; x += step)
      for (let z = cz - ext; z <= cz + ext; z += step)
        if (plan(x, z) < inset + batter * (top - y0) + 0.5) {
          lo = [Math.min(lo[0], x), Math.min(lo[1], z)];
          hi = [Math.max(hi[0], x), Math.max(hi[1], z)];
        }
    /* the distance is dear (an outline, the beds, a grain of noise), and it is asked for millions of times: it is worked out once on a grid
       (o.cell, 0.07; 0 to keep it exact) and looked up from there, inside the box round the rock */
    const cellG = o.cell === undefined ? 0.09 : o.cell,
      glo = [lo[0] - 1.2, y0 - 0.3, lo[1] - 1.2],
      ghi = [hi[0] + 1.2, top + 0.3, hi[1] + 1.2],
      grid = cellG ? K.sdfgrid(sd0, glo, ghi, cellG) : null,
      sd = grid
        ? (x, y, z) =>
            x > glo[0] && x < ghi[0] && y > glo[1] && y < ghi[1] && z > glo[2] && z < ghi[2]
              ? grid.at(x, y, z)
              : sd0(x, y, z)
        : sd0;
    const bc = [(lo[0] + hi[0]) / 2, (y0 + top) / 2, (lo[1] + hi[1]) / 2],
      p = {
        bc,
        br: Math.hypot((hi[0] - lo[0]) / 2 + 1, (top - y0) / 2 + 0.5, (hi[1] - lo[1]) / 2 + 1),
        bed,
        sd,
        sample(f) {
          const res = this.res;
          // (only what stands above o.below: the part under the ground is never seen)
          const ylo = Math.max(y0, o.below === undefined ? y0 : o.below);
          for (let y = ylo; y <= top + res; y += res * 0.9) {
            const yy = Math.min(y, top),
              b = back(yy);
            for (let x = lo[0] - 1; x <= hi[0] + 1; x += res * 0.9)
              for (let z = lo[1] - 1; z <= hi[1] + 1; z += res * 0.9) {
                const d = plan(x, z) + b;
                if (y >= top ? d < 0 : Math.abs(d) < res * 0.5) f(x, yy, z);
                // (where o.clip cuts it, its own surface: the points inside the outline near the clip)
                else if (clip && d < 0 && Math.abs(clip(x, yy, z)) < res * 0.6) f(x, yy, z);
              }
          }
        }
      };
    return S.add(p, mat, { res: o.res, tag: o.tag, reach: rough + 0.05, born: o.born, g: o.g, k: o.k });
  };

  F.hoodoo = (S, at, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 31),
      h = o.h || 3,
      r = o.r || 0.45,
      n = o.beds || 5,
      beds = [];
    for (let i = 0; i < n; i++) beds.push([at[1] + (h * i) / n, i === n - 1 ? 1 : 0.1 + 0.5 * R()]);
    const wob = [R() * 6, R() * 6];
    return F.strata(S, mat, {
      at,
      plan: (x, z) => {
        const a = Math.atan2(z - at[2], x - at[0]);
        return (
          Math.hypot(x - at[0], z - at[2]) - r * (1 + 0.15 * Math.sin(a * 3 + wob[0]) + 0.1 * Math.sin(a * 5 + wob[1]))
        );
      },
      y0: at[1] - 0.6,
      top: at[1] + h,
      beds,
      inset: r * 0.55,
      batter: o.batter === undefined ? 0.12 : o.batter,
      cap: r * (o.cap === undefined ? 0.35 : o.cap),
      capH: h / n,
      rough: o.rough === undefined ? 0.08 : o.rough,
      extent: r * 3 + 1,
      step: 0.1,
      res: o.res,
      born: o.born
    });
  };

  F.arch = (S, at, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 37),
      len = o.len || 5,
      w = o.w || 0.9,
      h = o.h || 3.2,
      yaw = o.yaw || 0,
      span = o.span || 2.4,
      rise = o.rise || 1.6,
      c = Math.cos(yaw),
      s = Math.sin(yaw),
      beds = [];
    for (let i = 0; i < 7; i++) beds.push([at[1] + (h * i) / 7, i >= 5 ? 0.95 : 0.25 + 0.5 * R()]);
    const fin = F.strata(S, mat, {
      at,
      plan: (x, z) => {
        const u = (x - at[0]) * c + (z - at[2]) * s,
          v = -(x - at[0]) * s + (z - at[2]) * c,
          qu = Math.abs(u) - len / 2 + w,
          qv = Math.abs(v) - w / 2;
        return Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) + Math.min(Math.max(qu, qv), 0) - w * 0.4;
      },
      y0: at[1] - 0.6,
      top: at[1] + h,
      beds,
      inset: w * 0.3,
      batter: o.batter === undefined ? 0.16 : o.batter,
      rough: 0.1,
      extent: len,
      step: 0.15,
      res: o.res,
      born: o.born,
      below: at[1] - 0.2,
      // the fin is worn down toward its ends: an envelope round its length and height
      clip: (x, y, z) => {
        const u = (x - at[0]) * c + (z - at[2]) * s;
        return (
          (Math.hypot(u / (len / 2 + 0.2), Math.max(0, y - at[1] - h * 0.35) / (h * 0.68)) - 1) *
          Math.min(len / 2, h * 0.65) *
          0.7
        );
      }
    });
    // the hole: an arch worn through, round at the top, through the softer beds
    const hole = S.add(
      {
        bc: [at[0], at[1] + rise * 0.5, at[2]],
        br: span,
        sd: (x, y, z) => {
          const u = (x - at[0]) * c + (z - at[2]) * s,
            v = -(x - at[0]) * s + (z - at[2]) * c,
            yy = y - at[1],
            e = Math.hypot(u / (span / 2), Math.max(0, yy) / rise) - 1;
          // (it stops at the ground the fin stands in: nothing under the arch is dug out)
          return Math.max(
            e * Math.min(span / 2, rise) * 0.8,
            (o.sill === undefined ? 0.25 : o.sill) - yy,
            Math.abs(v) - w * 2
          );
        },
        sample(f) {
          const res = this.res;
          for (let a = 0; a <= Math.PI; a += res / (span * 0.6))
            for (let v = -w; v <= w; v += res * 0.8) {
              const u = (Math.cos(a) * span) / 2,
                yy = Math.sin(a) * rise;
              f(at[0] + u * c - v * s, at[1] + yy, at[2] + u * s + v * c);
            }
        }
      },
      o.inner || mat,
      { neg: true, res: o.res, reach: 0.15 }
    );
    return { fin, hole };
  };

  // ---------------------------------------------------------------- the ground's own patterns
  // cells in the plane: how near (x, z) is to the line between its two nearest cells (in the cells' own units)
  const edge2 = (sc, seed) => {
    const hh = (i, j, k) => {
      const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.19) * 43758.5453;
      return v - Math.floor(v);
    };
    return (x, z) => {
      x *= sc;
      z *= sc;
      const X = Math.floor(x),
        Z = Math.floor(z);
      let f1 = 9,
        f2 = 9,
        a1 = 0,
        b1 = 0,
        a2 = 0,
        b2 = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const px = X + i + hh(X + i, Z + j, 1),
            pz = Z + j + hh(X + i, Z + j, 2),
            d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < f1) {
            f2 = f1;
            a2 = a1;
            b2 = b1;
            f1 = d;
            a1 = px;
            b1 = pz;
          } else if (d < f2) {
            f2 = d;
            a2 = px;
            b2 = pz;
          }
        }
      // distance to the bisector of the two nearest
      const mx = (a1 + a2) / 2,
        mz = (b1 + b2) / 2,
        nx = a2 - a1,
        nz = b2 - b1,
        nl = Math.hypot(nx, nz) || 1;
      return Math.abs(((x - mx) * nx + (z - mz) * nz) / nl);
    };
  };
  F.mud = o => {
    o = o || {};
    const vo2 = edge2(1 / (o.scale || 0.7), o.seed || 3),
      sc = o.scale || 0.7,
      vo = (x, y, z) => vo2(x, z) * sc,
      w = o.crack || 0.05,
      curl = o.curl === undefined ? 0.05 : o.curl,
      depth = o.depth === undefined ? 0.08 : o.depth;
    return {
      h: (x, z) => {
        const e = vo(x, 0, z);
        return e < w ? -depth * (1 - e / w) : curl * Math.exp(-(e - w) / 0.08) - curl * 0.3;
      },
      crack: (x, z) => 1 - sm(0, w * 1.4, vo(x, 0, z))
    };
  };

  F.pebbles = (S, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 41),
      path = K.curve.resample(o.path, 60),
      width = o.width || 1.2,
      size = o.size || [0.05, 0.22],
      out = [],
      tpls = [0, 1, 2, 3].map(k =>
        S.template(S2 => S2.ball([0, 0, 0], [1, 0.45 + 0.12 * k, 0.75 - 0.06 * k], mat, { res: 0.18 }), { res: 0.18 })
      );
    for (let i = 0; i < (o.n || 220); i++) {
      const t = R(),
        f = t * (path.length - 1),
        j = Math.min(path.length - 2, Math.floor(f)),
        a = path[j],
        b = path[j + 1],
        u = f - j,
        p = [a[0] + (b[0] - a[0]) * u, 0, a[2] + (b[2] - a[2]) * u],
        T = norm([b[0] - a[0], 0, b[2] - a[2]]),
        side = (R() * 2 - 1) * width * 0.5,
        // sorted: the biggest where the current is strongest, the middle of the channel, upstream; the finest at the edges, downstream
        across = Math.abs(side) / (width * 0.5),
        k = (1 - across * across) * (1 - 0.5 * t) * (0.7 + 0.3 * R()),
        s = size[0] + (size[1] - size[0]) * k,
        x = p[0] - T[2] * side,
        z = p[2] + T[0] * side;
      if (out.some(q => Math.hypot(q[0] - x, q[2] - z) < (q[3] + s) * 0.9)) continue;
      const hit = K.grow.ray(S, [x, o.top || 6, z], [0, -1, 0], 20);
      if (!hit) continue;
      out.push([x, hit.p[1], z, s]);
      // lying the way the water runs, long side along it
      S.place(tpls[i % 4], [x, hit.p[1] + s * 0.45 * (1 - (o.sink === undefined ? 0.3 : o.sink)), z], {
        scale: s,
        yaw: Math.atan2(T[2], T[0]) + (R() - 0.5) * 0.8,
        up: hit.n,
        lean: 0.8,
        solid: false
      });
    }
    return out;
  };

  F.boulders = (S, mat, o) => {
    o = o || {};
    const R = dice(o.seed || 43),
      box = o.box,
      size = o.size || [0.3, 1.1],
      kinds = o.kinds || 4,
      tpls = [],
      out = [];
    for (let k = 0; k < kinds; k++)
      tpls.push(
        S.template(
          S2 =>
            K.grow.rock(S2, [0, 0, 0], 1, mat, {
              seed: (o.seed || 43) * 17 + k * 5,
              facets: o.facets || 8,
              chip: o.chip === undefined ? 0.42 : o.chip,
              squash: [1, 0.6 + 0.15 * k, 0.85],
              worn: o.worn === undefined ? 0.07 : o.worn,
              res: 0.12
            }),
          { res: 0.12 }
        )
      );
    const want = [];
    for (let i = 0; i < (o.n || 60); i++) want.push(size[0] + (size[1] - size[0]) * Math.pow(R(), 2.2));
    want.sort((a, b) => b - a);
    for (let i = 0; i < want.length; i++) {
      const s = want[i],
        x = box[0] + (box[1] - box[0]) * R(),
        z = box[2] + (box[3] - box[2]) * R();
      if (o.where && !o.where(x, z)) continue;
      if (out.some(q => Math.hypot(q[0] - x, q[2] - z) < (q[3] + s) * 0.6)) continue;
      const tp = tpls[i % kinds],
        yaw = R() * Math.PI * 2;
      let at, up;
      if (o.settle !== false && s > (o.settleOver || size[0] * 1.6)) {
        const cy = Math.cos(yaw),
          sy = Math.sin(yaw),
          sdT = (a, b, d) => tp.sdf((a * cy - d * sy) / s, b / s, (a * sy + d * cy) / s) * s,
          pts = tp.samples
            .filter((q, j) => j % 6 === 0 && q[1] < tp.foot + 0.4)
            .map(q => [(q[0] * cy + q[2] * sy) * s, q[1] * s, (-q[0] * sy + q[2] * cy) * s]);
        const st = K.grow.settle(S, sdT, [x, o.top || 8, z], { pts, lean: 0.6 });
        at = [st.at[0], st.at[1] - s * 0.12, st.at[2]];
        up = st.up;
      } else {
        const hit = K.grow.ray(S, [x, o.top || 8, z], [0, -1, 0], 30);
        if (!hit) continue;
        at = [x, hit.p[1] - tp.foot * s - s * 0.25, z];
        up = hit.n;
      }
      out.push([at[0], at[1], at[2], s]);
      // (the big ones join the field, so the small ones settle against them and they cast shadows; the small ones only drawn)
      const big = o.solid !== false && s > (o.settleOver || size[0] * 1.6);
      S.place(tp, at, { scale: s, yaw, up, lean: 0.7, solid: big });
      if (big) S.ready();
    }
    return out;
  };
})(KIT);
