/* k9-matter: splats as stuff.
     K.solids(sdf, lo, hi, cell)   which parts of a structure are still held up (flood from the ground through what is solid)
     K.rubble(st, o)        pieces with weight: rigid bodies that land on what stands and on each other, tip, roll, break and come to rest
     K.debris(st, o)        loose lumps: groups of splats that fly, spin, land, bounce, break up and fade.  .spawn(ids, { v, w, life, shatter })
     K.breaker(st, o)       a blow knocks a ball out of whatever is there: the splats in it become lumps, the hole gets real inner faces
                            (from the sculpt's own distance field), and anything left hanging in the air comes down and smashes.
                            o: sdf, vox, debris, pool, inner (palette indices for fresh faces), ground, particles, chips (palette indices)
                            o.flesh(x, y, z, light 0..1) -> palette index: what the inside looks like there (rings, layers, veins) instead of inner
                            .strike(p, r, dir, power)
     K.jelly(st, ids, o)    a soft body: the splats ride a coarse lattice whose lumps pull back toward their shape and overshoot (shape matching).
                            .poke(p, dir, strength)   .pin(fn)   o: cell, stiff 0..1, damp, squash 0..1 (how far from rigid it may go), ground
     K.sand(st, pool, o)    grains that fall, land, pile, and slide when the pile gets too steep.   .pour(p, n, cols) */
(function (K) {
  const V = K.V,
    M = K.M;
  K.debris = (st, o) => {
    o = o || {};
    const D = st.D,
      B0 = st.base,
      chunks = [],
      gone = new Uint8Array(st.N),
      gy = o.ground || (() => 0),
      g = o.gravity === undefined ? 18 : o.gravity;
    const sys = {
      chunks,
      gone,
      spawn(ids, e) {
        e = e || {};
        if (!ids.length) return null;
        const c = [0, 0, 0];
        for (const i of ids) {
          c[0] += D[i * 16];
          c[1] += D[i * 16 + 1];
          c[2] += D[i * 16 + 2];
          if (st.rig) st.rig.free[i] = 1;
        }
        c[0] /= ids.length;
        c[1] /= ids.length;
        c[2] /= ids.length;
        // each lump keeps its splats as they stood when it broke off (place and shape), measured from its middle
        const loc = new Float32Array(ids.length * 9);
        ids.forEach((i, k) => {
          const q = i * 16;
          loc[k * 9] = D[q] - c[0];
          loc[k * 9 + 1] = D[q + 1] - c[1];
          loc[k * 9 + 2] = D[q + 2] - c[2];
          loc[k * 9 + 3] = D[q + 4];
          loc[k * 9 + 4] = D[q + 5];
          loc[k * 9 + 5] = D[q + 6];
          loc[k * 9 + 6] = D[q + 8];
          loc[k * 9 + 7] = D[q + 9];
          loc[k * 9 + 8] = D[q + 10];
        });
        let rad = 0;
        for (let k = 0; k < ids.length; k++)
          rad = Math.max(rad, Math.hypot(loc[k * 9], loc[k * 9 + 1], loc[k * 9 + 2]));
        const ch = {
          ids,
          loc,
          c,
          R: M.id(),
          v: (e.v || [0, 0, 0]).slice(),
          w: e.w || [0, 0, 0],
          life: e.life === undefined ? 2.2 : e.life,
          max: e.life === undefined ? 2.2 : e.life,
          shatter: !!e.shatter,
          rad,
          rest: 0,
          keep: !!e.keep
        };
        chunks.push(ch);
        return ch;
      },
      update(dt) {
        dt = Math.min(dt, 0.033);
        for (let n = chunks.length - 1; n >= 0; n--) {
          const ch = chunks[n];
          ch.v[1] -= g * dt;
          ch.c[0] += ch.v[0] * dt;
          ch.c[1] += ch.v[1] * dt;
          ch.c[2] += ch.v[2] * dt;
          const wl = V.len(ch.w);
          if (wl > 1e-3) ch.R = M.mul(M.rot(V.mul(ch.w, 1 / wl), wl * dt), ch.R);
          const fy = gy(ch.c[0], ch.c[2]) + Math.min(ch.rad * 0.5, 0.25);
          if (ch.c[1] < fy) {
            ch.c[1] = fy;
            const hard = -ch.v[1];
            if (ch.shatter && hard > 2 && ch.ids.length > 12) {
              chunks.splice(n, 1);
              for (const part of K.lumps(ch.ids, st.D, Math.max(0.3, ch.rad * 0.45)))
                sys.spawn(part, {
                  v: [
                    ch.v[0] * 0.3 + (K.rnd() - 0.5) * 3,
                    hard * (0.2 + K.rnd() * 0.25),
                    ch.v[2] * 0.3 + (K.rnd() - 0.5) * 3
                  ],
                  w: [(K.rnd() - 0.5) * 8, (K.rnd() - 0.5) * 8, (K.rnd() - 0.5) * 8],
                  life: 1.6 + K.rnd()
                });
              if (o.onLand) o.onLand(ch.c, hard, ch);
              continue;
            }
            if (hard > 1.2 && o.onLand) o.onLand(ch.c, hard, ch);
            ch.v[1] = hard > 1 ? hard * 0.32 : 0;
            ch.v[0] *= 0.55;
            ch.v[2] *= 0.55;
            ch.w = V.mul(ch.w, 0.5);
            if (hard <= 1) ch.rest += dt;
          }
          if (!ch.keep) ch.life -= dt;
          const k = ch.life < 0.4 ? Math.max(0, ch.life / 0.4) : 1,
            R = ch.R,
            a = R[0],
            b = R[1],
            c = R[2],
            d = R[3],
            e = R[4],
            f = R[5],
            gg = R[6],
            h = R[7],
            ii = R[8],
            L = ch.loc;
          for (let m = 0; m < ch.ids.length; m++) {
            const i = ch.ids[m],
              q = i * 16,
              r = m * 9,
              x = L[r],
              y = L[r + 1],
              z = L[r + 2],
              c00 = L[r + 3] * k * k,
              c01 = L[r + 4] * k * k,
              c02 = L[r + 5] * k * k,
              c11 = L[r + 6] * k * k,
              c12 = L[r + 7] * k * k,
              c22 = L[r + 8] * k * k;
            D[q] = a * x + b * y + c * z + ch.c[0];
            D[q + 1] = d * x + e * y + f * z + ch.c[1];
            D[q + 2] = gg * x + h * y + ii * z + ch.c[2];
            const m00 = a * c00 + b * c01 + c * c02,
              m01 = a * c01 + b * c11 + c * c12,
              m02 = a * c02 + b * c12 + c * c22,
              m10 = d * c00 + e * c01 + f * c02,
              m11 = d * c01 + e * c11 + f * c12,
              m12 = d * c02 + e * c12 + f * c22,
              m20 = gg * c00 + h * c01 + ii * c02,
              m21 = gg * c01 + h * c11 + ii * c12,
              m22 = gg * c02 + h * c12 + ii * c22;
            D[q + 4] = m00 * a + m01 * b + m02 * c;
            D[q + 5] = m00 * d + m01 * e + m02 * f;
            D[q + 6] = m00 * gg + m01 * h + m02 * ii;
            D[q + 8] = m10 * d + m11 * e + m12 * f;
            D[q + 9] = m10 * gg + m11 * h + m12 * ii;
            D[q + 10] = m20 * gg + m21 * h + m22 * ii;
            st.rows[i >> 9] = 1;
          }
          if (ch.life <= 0) {
            for (const i of ch.ids) {
              gone[i] = 1;
              D[i * 16 + 3] = 0;
              D[i * 16 + 1] = -99;
              st.rows[i >> 9] = 1;
            }
            chunks.splice(n, 1);
          }
        }
      },
      paint(i, c) {
        if (gone[i]) c[3] = 0;
      }
    };
    return sys;
  };
  // split a set of splats into lumps about `size` across (by which cell of a coarse grid each sits in, as it stands now)
  K.lumps = (ids, D, size) => {
    const m = new Map();
    for (const i of ids) {
      const k =
        Math.floor(D[i * 16] / size) + ',' + Math.floor(D[i * 16 + 1] / size) + ',' + Math.floor(D[i * 16 + 2] / size);
      let a = m.get(k);
      if (!a) m.set(k, (a = []));
      a.push(i);
    }
    return Array.from(m.values());
  };
  K.breaker = (st, o) => {
    const D = st.D,
      N = st.N,
      carves = [],
      taken = new Uint8Array(N),
      pool = o.pool,
      deb = o.debris,
      vox = o.vox,
      rub = o.rubble || null,
      gy = o.ground || (() => 0),
      inner = o.inner || [1],
      pal = st.W.pal,
      emptied = vox ? new Uint8Array(vox.nc) : null,
      fresh = [];
    const sg = o.solids || null,
      anchor = sg ? new Int32Array(N).fill(-1) : null;
    if (sg) {
      const f = o.sdf,
        e = 0.02;
      for (let i = 0, q = 0; i < N; i++, q += 16) {
        if (st.base[q + 3] < 1 || (o.where && !o.where(i))) continue;
        const x = D[q],
          y = D[q + 1],
          z = D[q + 2],
          d = f(x, y, z),
          nx = f(x + e, y, z) - d,
          ny = f(x, y + e, z) - d,
          nz = f(x, y, z + e) - d,
          l = Math.hypot(nx, ny, nz) || 1,
          k = (sg.cell * 0.75) / l;
        anchor[i] = sg.at(x - nx * k, y - ny * k, z - nz * k);
      }
    }
    const packed = q => {
        const h = pal[q];
        return ((h >> 16) & 255) + (h & 0xff00) + ((h & 255) << 16);
      },
      sun = V.norm(o.sun || [-0.4, 0.75, 0.5]);
    const carved = (x, y, z) => {
      for (const c of carves) if (Math.hypot(x - c[0], y - c[1], z - c[2]) < c[3]) return true;
      return false;
    };
    const sys = {
      carves,
      strikes: 0,
      // the solid as it now is: the sculpt's field with every hole knocked so far taken out
      sdf: (x, y, z) => {
        let d = o.sdf ? o.sdf(x, y, z) : 1;
        for (const c of carves) {
          const e = c[3] - Math.hypot(x - c[0], y - c[1], z - c[2]);
          if (e > d) d = e;
        }
        return d;
      },
      // the same, but anything that has fallen away is air: this is what rubble lands on
      standing: (x, y, z) => {
        const d = sys.sdf(x, y, z);
        if (d < 0 && sg) {
          const c = sg.at(x, y, z);
          if (c >= 0 && sg.gone[c]) return sg.cell * 0.5;
        }
        return d;
      },
      strike(p, r, dir, power) {
        dir = dir || [0, 0, 0];
        power = power === undefined ? 5 : power;
        const hit = [];
        for (let i = 0, q = 0; i < N; i++, q += 16) {
          if (taken[i] || D[q + 3] <= 0 || (o.where && !o.where(i))) continue;
          const dx = D[q] - p[0],
            dy = D[q + 1] - p[1],
            dz = D[q + 2] - p[2];
          if (dx * dx + dy * dy + dz * dz < r * r) {
            hit.push(i);
            taken[i] = 1;
          }
        }
        // fresh faces from earlier holes that this one swallows go too
        for (let k = fresh.length - 1; k >= 0; k--) {
          const i = fresh[k],
            q = i * 16;
          if (Math.hypot(D[q] - p[0], D[q + 1] - p[1], D[q + 2] - p[2]) < r) {
            pool.hide(st, i);
            fresh.splice(k, 1);
          }
        }
        if (!hit.length) return 0;
        sys.strikes++;
        for (const part of K.lumps(hit, D, Math.max(0.22, r * (rub ? 0.62 : 0.42)))) {
          const c = [0, 0, 0];
          for (const i of part) {
            c[0] += D[i * 16];
            c[1] += D[i * 16 + 1];
            c[2] += D[i * 16 + 2];
          }
          const out = V.norm([c[0] / part.length - p[0], c[1] / part.length - p[1] + 0.3, c[2] / part.length - p[2]]);
          const vel = [
              dir[0] * power + out[0] * power * 0.6 + (K.rnd() - 0.5) * 2,
              dir[1] * power + out[1] * power * 0.6 + 2 + K.rnd() * 2,
              dir[2] * power + out[2] * power * 0.6 + (K.rnd() - 0.5) * 2
            ],
            spin = [(K.rnd() - 0.5) * 12, (K.rnd() - 0.5) * 12, (K.rnd() - 0.5) * 12];
          if (rub && part.length >= (o.lump || 20))
            rub.spawn(part, {
              v: [vel[0] * 0.7, vel[1] * 0.7, vel[2] * 0.7],
              w: [spin[0] * 0.5, spin[1] * 0.5, spin[2] * 0.5],
              gen: 1
            });
          else deb.spawn(part, { v: vel, w: spin, life: 1.4 + K.rnd() * 1.2 });
        }
        // the inside of the hole: points on the ball that lie within the solid, facing back toward the middle
        if (o.sdf && pool) {
          const res = o.res || 0.1,
            n = Math.ceil((12.6 * r * r) / (res * res));
          for (let k = 0; k < n; k++) {
            const yy = 1 - (2 * (k + 0.5)) / n,
              rad = Math.sqrt(Math.max(0, 1 - yy * yy)),
              a = k * 2.399963,
              d = [rad * Math.cos(a), yy, rad * Math.sin(a)],
              x = p[0] + d[0] * r,
              y = p[1] + d[1] * r,
              z = p[2] + d[2] * r;
            if (o.sdf(x, y, z) > -0.03 || carved(x, y, z)) continue;
            const nrm = [-d[0], -d[1], -d[2]],
              lit = 0.25 + 0.5 * Math.max(0, V.dot(nrm, sun)) + 0.2 * K.hash(k, sys.strikes),
              i = pool.take();
            pool.put(
              st,
              i,
              x,
              y,
              z,
              res * 0.5,
              packed(
                o.flesh ? o.flesh(x, y, z, lit) : inner[K.clamp(Math.floor(lit * inner.length), 0, inner.length - 1)]
              ),
              3,
              nrm,
              res * 0.3
            );
            fresh.push(i);
          }
        }
        carves.push([p[0], p[1], p[2], r]);
        if (o.particles && o.chips) {
          o.particles.chips(p, Math.min(24, 6 + hit.length / 30), o.chips, dir, power * 0.7);
          o.particles.dust(p, 8, o.dust || o.chips, 1.2);
        }
        // What was that holding up? With a solid grid (o.solids) the answer comes from the sculpt itself: flood up from the ground through what is
        // still solid, and every island of solid left over falls as a piece of its own, taking the splats on it. Its cells become air.
        if (sg) {
          sg.forget(p, r + sg.cell * 2);
          sg.flood(o.layers || 2);
          const seen = new Uint8Array(sg.nc),
            isle = new Int32Array(sg.nc).fill(-1),
            groups = [];
          for (let i = 0; i < N; i++) {
            if (taken[i] || anchor[i] < 0 || D[i * 16 + 3] <= 0) continue;
            let c = anchor[i];
            if (!sg.solid(c)) {
              let alt = -1,
                held = false;
              sg.neighbours(c, n => {
                if (sg.solid(n)) {
                  if (sg.reached[n]) held = true;
                  else alt = n;
                }
              });
              if (held || alt < 0) continue;
              c = alt;
            }
            if (sg.reached[c]) continue;
            if (isle[c] < 0) {
              const cells = sg.island(c, seen);
              for (const q of cells) isle[q] = groups.length;
              groups.push({ cells, ids: [] });
            }
            groups[isle[c]].ids.push(i);
          }
          for (const gr of groups) {
            sg.drop(gr.cells);
            for (const i of gr.ids) taken[i] = 1;
            const set = new Set(gr.cells);
            for (let k = fresh.length - 1; k >= 0; k--) {
              const i = fresh[k],
                c = sg.at(D[i * 16], D[i * 16 + 1], D[i * 16 + 2]);
              let on = set.has(c);
              if (!on && c >= 0)
                sg.neighbours(c, n => {
                  if (set.has(n)) on = true;
                });
              if (on) {
                gr.ids.push(i);
                fresh.splice(k, 1);
              }
            }
            if (gr.ids.length < 25) deb.spawn(gr.ids, { v: [0, 0, 0], life: 1.2 });
            else if (rub)
              rub.spawn(gr.ids, {
                v: [dir[0] * 0.6, 0, dir[2] * 0.6],
                w: [dir[2] * 0.5 + (K.rnd() - 0.5) * 0.4, 0, -dir[0] * 0.5 + (K.rnd() - 0.5) * 0.4]
              });
            else deb.spawn(gr.ids, { v: [0, 0, 0], life: 3, shatter: true });
          }
          if (rub) rub.wake(p, r + 2.5);
          sys.fell = (sys.fell || 0) + groups.length;
        } else if (vox) {
          for (let c = 0; c < vox.nc; c++) {
            if (emptied[c] || !vox.occ[c]) continue;
            let any = false;
            for (let i = vox.grid.head[c]; i >= 0; i = vox.grid.next[i])
              if (!taken[i] && st.base[i * 16 + 3] >= 1) {
                any = true;
                break;
              }
            if (!any) emptied[c] = 1;
          }
          const loose = vox.unsupported(c => emptied[c] === 1, o.floorY);
          if (loose.length) {
            const gone = new Set(loose);
            for (let k = fresh.length - 1; k >= 0; k--) {
              const i = fresh[k];
              if (gone.has(vox.at(D[i * 16], D[i * 16 + 1], D[i * 16 + 2]))) {
                pool.hide(st, i);
                fresh.splice(k, 1);
              }
            }
            const ids = [];
            for (const c of loose) {
              emptied[c] = 1;
              for (let i = vox.grid.head[c]; i >= 0; i = vox.grid.next[i])
                if (!taken[i] && D[i * 16 + 3] > 0) {
                  taken[i] = 1;
                  ids.push(i);
                }
            }
            if (ids.length)
              deb.spawn(ids, {
                v: [dir[0] * 0.8, 0, dir[2] * 0.8],
                w: [dir[2] * 0.6, 0, -dir[0] * 0.6],
                life: 3,
                shatter: true
              });
          }
        }
        return hit.length;
      }
    };
    return sys;
  };
  // ---- what is holding what up. A grid of small cells over the structure; a cell is solid if the sculpt's field says so there (and it has not since
  // fallen away). Flooding from the cells at the bottom finds everything that still stands on the ground; the rest is hanging in the air.
  // A cell counts as solid if its middle is inside or within a little under half a cell of the surface, so a thin post or rail is not lost between cells.
  /*   const sg = K.solids(sdf, lo, hi, cell)     sdf: the field as it now is (holes included) */
  /*   sg.forget(p, r)      a blow landed here: look at these cells again        sg.flood()      mark what is held up */
  /*   sg.at(x, y, z)       cell index (-1 outside)      sg.reached[c]      sg.solid(c)      sg.drop(cells)   these have fallen: they are air now */
  K.solids = (sdf, lo, hi, cell, o) => {
    const fat = cell * ((o && o.fat) === undefined ? 0.45 : o.fat),
      dim = [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k]) / cell))),
      nc = dim[0] * dim[1] * dim[2],
      state = new Int8Array(nc),
      gone = new Uint8Array(nc),
      reached = new Uint8Array(nc),
      sx = dim[1] * dim[2],
      sy = dim[2];
    const sg = {
      lo,
      dim,
      cell,
      nc,
      reached,
      gone,
      at: (x, y, z) => {
        const ix = Math.floor((x - lo[0]) / cell),
          iy = Math.floor((y - lo[1]) / cell),
          iz = Math.floor((z - lo[2]) / cell);
        return ix < 0 || iy < 0 || iz < 0 || ix >= dim[0] || iy >= dim[1] || iz >= dim[2] ? -1 : ix * sx + iy * sy + iz;
      },
      centre: c => {
        const iz = c % dim[2],
          iy = ((c - iz) / dim[2]) % dim[1],
          ix = (c - iz - iy * dim[2]) / sx;
        return [lo[0] + (ix + 0.5) * cell, lo[1] + (iy + 0.5) * cell, lo[2] + (iz + 0.5) * cell];
      },
      solid(c) {
        if (c < 0 || gone[c]) return false;
        if (!state[c]) {
          const p = sg.centre(c);
          state[c] = sdf(p[0], p[1], p[2]) < fat ? 1 : 2;
        }
        return state[c] === 1;
      },
      forget(p, r) {
        const a = [0, 1, 2].map(k => Math.max(0, Math.floor((p[k] - r - lo[k]) / cell))),
          b = [0, 1, 2].map(k => Math.min(dim[k] - 1, Math.floor((p[k] + r - lo[k]) / cell)));
        for (let x = a[0]; x <= b[0]; x++)
          for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) state[x * sx + y * sy + z] = 0;
      },
      neighbours(c, fn) {
        const iz = c % dim[2],
          iy = ((c - iz) / dim[2]) % dim[1],
          ix = (c - iz - iy * dim[2]) / sx;
        if (ix > 0) fn(c - sx);
        if (ix < dim[0] - 1) fn(c + sx);
        if (iy > 0) fn(c - sy);
        if (iy < dim[1] - 1) fn(c + sy);
        if (iz > 0) fn(c - 1);
        if (iz < dim[2] - 1) fn(c + 1);
      },
      flood(layers) {
        reached.fill(0);
        const stack = [],
          top = Math.min(dim[1], layers || 2);
        for (let x = 0; x < dim[0]; x++)
          for (let z = 0; z < dim[2]; z++)
            for (let y = 0; y < top; y++) {
              const c = x * sx + y * sy + z;
              if (sg.solid(c)) {
                reached[c] = 1;
                stack.push(c);
              }
            }
        while (stack.length)
          sg.neighbours(stack.pop(), n => {
            if (!reached[n] && sg.solid(n)) {
              reached[n] = 1;
              stack.push(n);
            }
          });
      },
      // everything solid joined to cell c that is not held up, as a list of cells (they are marked so they are not found twice)
      island(c, seen) {
        const out = [],
          stack = [c];
        seen[c] = 1;
        while (stack.length) {
          const q = stack.pop();
          out.push(q);
          sg.neighbours(q, n => {
            if (!seen[n] && !reached[n] && sg.solid(n)) {
              seen[n] = 1;
              stack.push(n);
            }
          });
        }
        return out;
      },
      drop(cells) {
        for (const c of cells) gone[c] = 1;
      }
    };
    return sg;
  };
  // ---- rubble: pieces with weight. Each is a rigid body made of the splats it took with it: it falls, lands on whatever is under it (the standing
  // structure, the ground, other pieces), tips over an edge, rolls off, knocks into the rest, breaks if it lands hard enough, and comes to rest.
  /*   const rb = st.add(K.rubble(st, { solid: (x, y, z) => distance to what still stands (negative inside), chips: a K.debris for the small stuff, onHit(p, speed, body) })) */
  /*   rb.spawn(ids, { v, w })      rb.wake(p, r)   stir anything asleep near a point */
  K.rubble = (st, o) => {
    o = o || {};
    const D = st.D,
      bodies = [],
      solid = o.solid || ((x, y, z) => y),
      g = o.gravity === undefined ? 20 : o.gravity,
      H = 1 / 120,
      e = 0.02;
    let acc = 0;
    const nrm = [0, 0, 0];
    const grad = (x, y, z, d) => {
      nrm[0] = solid(x + e, y, z) - d;
      nrm[1] = solid(x, y + e, z) - d;
      nrm[2] = solid(x, y, z + e) - d;
      const l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
      nrm[0] /= l;
      nrm[1] /= l;
      nrm[2] /= l;
    };
    const rest = b => {
      b.asleep = true;
      b.v = [0, 0, 0];
      b.w = [0, 0, 0];
      b.dirty = true;
      b.mark = null;
    };
    const hit = (b, rx, ry, rz, nx, ny, nz, other, bounce) => {
      const vx = b.v[0] + b.w[1] * rz - b.w[2] * ry,
        vy = b.v[1] + b.w[2] * rx - b.w[0] * rz,
        vz = b.v[2] + b.w[0] * ry - b.w[1] * rx;
      let ox = 0,
        oy = 0,
        oz = 0;
      if (other) {
        ox = other.v[0];
        oy = other.v[1];
        oz = other.v[2];
      }
      const vn = (vx - ox) * nx + (vy - oy) * ny + (vz - oz) * nz;
      if (vn >= 0) return 0;
      const cx = ry * nz - rz * ny,
        cy = rz * nx - rx * nz,
        cz = rx * ny - ry * nx,
        den = b.im + b.ii * (cx * cx + cy * cy + cz * cz) + (other && !other.asleep ? other.im : 0),
        j = (-(1 + (vn < -2 ? bounce : 0)) * vn) / den;
      b.v[0] += nx * j * b.im;
      b.v[1] += ny * j * b.im;
      b.v[2] += nz * j * b.im;
      b.w[0] += cx * j * b.ii;
      b.w[1] += cy * j * b.ii;
      b.w[2] += cz * j * b.ii;
      if (other && !other.asleep) {
        other.v[0] -= nx * j * other.im;
        other.v[1] -= ny * j * other.im;
        other.v[2] -= nz * j * other.im;
      }
      // friction: take some of the sliding out, never more than there is
      const tx = vx - ox - nx * vn,
        ty = vy - oy - ny * vn,
        tz = vz - oz - nz * vn,
        tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-4) {
        const ux = tx / tl,
          uy = ty / tl,
          uz = tz / tl,
          fx = ry * uz - rz * uy,
          fy = rz * ux - rx * uz,
          fz = rx * uy - ry * ux,
          jt = Math.min(0.6 * j, tl / (b.im + b.ii * (fx * fx + fy * fy + fz * fz)));
        b.v[0] -= ux * jt * b.im;
        b.v[1] -= uy * jt * b.im;
        b.v[2] -= uz * jt * b.im;
        b.w[0] -= fx * jt * b.ii;
        b.w[1] -= fy * jt * b.ii;
        b.w[2] -= fz * jt * b.ii;
      }
      return -vn;
    };
    const sys = {
      bodies,
      spawn(ids, q) {
        q = q || {};
        if (!ids.length) return null;
        const c = [0, 0, 0];
        for (const i of ids) {
          c[0] += D[i * 16];
          c[1] += D[i * 16 + 1];
          c[2] += D[i * 16 + 2];
          if (st.rig) st.rig.free[i] = 1;
        }
        c[0] /= ids.length;
        c[1] /= ids.length;
        c[2] /= ids.length;
        const loc = new Float32Array(ids.length * 9);
        let rad = 0;
        ids.forEach((i, k) => {
          const p = i * 16;
          loc[k * 9] = D[p] - c[0];
          loc[k * 9 + 1] = D[p + 1] - c[1];
          loc[k * 9 + 2] = D[p + 2] - c[2];
          loc[k * 9 + 3] = D[p + 4];
          loc[k * 9 + 4] = D[p + 5];
          loc[k * 9 + 5] = D[p + 6];
          loc[k * 9 + 6] = D[p + 8];
          loc[k * 9 + 7] = D[p + 9];
          loc[k * 9 + 8] = D[p + 10];
          rad = Math.max(rad, Math.hypot(loc[k * 9], loc[k * 9 + 1], loc[k * 9 + 2]));
        });
        // a handful of its own points, well spread, stand for its shape when it touches things
        const want = Math.min(ids.length, o.points || 18),
          pts = [],
          dist = new Float32Array(ids.length).fill(1e9);
        let pick = 0;
        for (let k = 0; k < want; k++) {
          pts.push([loc[pick * 9], loc[pick * 9 + 1], loc[pick * 9 + 2]]);
          let far = -1,
            fi = 0;
          for (let m = 0; m < ids.length; m++) {
            const dd = Math.hypot(
              loc[m * 9] - loc[pick * 9],
              loc[m * 9 + 1] - loc[pick * 9 + 1],
              loc[m * 9 + 2] - loc[pick * 9 + 2]
            );
            if (dd < dist[m]) dist[m] = dd;
            if (dist[m] > far) {
              far = dist[m];
              fi = m;
            }
          }
          pick = fi;
        }
        const mass = Math.max(1, ids.length * 0.02),
          body = {
            ids,
            loc,
            pts,
            c,
            R: M.id(),
            v: (q.v || [0, 0, 0]).slice(),
            w: (q.w || [0, 0, 0]).slice(),
            rad: Math.max(rad, 0.1),
            pr: K.clamp(rad * 0.28, 0.07, 0.3),
            im: 1 / mass,
            ii: 1 / (0.4 * mass * Math.max(rad, 0.15) * Math.max(rad, 0.15)),
            asleep: false,
            still: 0,
            gen: q.gen || 0,
            age: 0
          };
        bodies.push(body);
        return body;
      },
      wake(p, r) {
        for (const b of bodies)
          if (b.asleep && V.dist(b.c, p) < r + b.rad) {
            b.asleep = false;
            b.still = 0;
          }
      },
      update(dt) {
        acc = Math.min(acc + dt, 0.05);
        while (acc >= H) {
          acc -= H;
          sys.step(H);
        }
        sys.write();
      },
      step(h) {
        for (let n = bodies.length - 1; n >= 0; n--) {
          const b = bodies[n];
          if (b.asleep) continue;
          b.age += h;
          b.v[1] -= g * h;
          b.c[0] += b.v[0] * h;
          b.c[1] += b.v[1] * h;
          b.c[2] += b.v[2] * h;
          const wl = Math.hypot(b.w[0], b.w[1], b.w[2]);
          if (wl > 1e-4) b.R = M.mul(M.rot([b.w[0] / wl, b.w[1] / wl, b.w[2] / wl], wl * h), b.R);
          // against what still stands, and the ground
          let deep = 0,
            dx = 0,
            dy = 0,
            dz = 0,
            hard = 0,
            touching = 0;
          const R = b.R;
          for (const q of b.pts) {
            const rx = R[0] * q[0] + R[1] * q[1] + R[2] * q[2],
              ry = R[3] * q[0] + R[4] * q[1] + R[5] * q[2],
              rz = R[6] * q[0] + R[7] * q[1] + R[8] * q[2],
              x = b.c[0] + rx,
              y = b.c[1] + ry,
              z = b.c[2] + rz,
              d = solid(x, y, z);
            if (d >= 0.01) continue;
            touching++;
            grad(x, y, z, d);
            const s = hit(b, rx, ry, rz, nrm[0], nrm[1], nrm[2], null, 0.25);
            if (s > hard) hard = s;
            if (-d > deep) {
              deep = -d;
              dx = nrm[0];
              dy = nrm[1];
              dz = nrm[2];
            }
          }
          if (deep > 0) {
            const k = Math.min(deep, 0.3) * 0.7;
            b.c[0] += dx * k;
            b.c[1] += dy * k;
            b.c[2] += dz * k;
          }
          // against the other pieces: its points against theirs, as small balls
          for (const other of bodies) {
            if (other === b || V.dist(b.c, other.c) > b.rad + other.rad + 0.1) continue;
            const R2 = other.R;
            for (const q of b.pts) {
              const rx = R[0] * q[0] + R[1] * q[1] + R[2] * q[2],
                ry = R[3] * q[0] + R[4] * q[1] + R[5] * q[2],
                rz = R[6] * q[0] + R[7] * q[1] + R[8] * q[2],
                x = b.c[0] + rx,
                y = b.c[1] + ry,
                z = b.c[2] + rz;
              if (Math.hypot(x - other.c[0], y - other.c[1], z - other.c[2]) > other.rad + b.pr) continue;
              for (const u of other.pts) {
                const ox = other.c[0] + R2[0] * u[0] + R2[1] * u[1] + R2[2] * u[2],
                  oy = other.c[1] + R2[3] * u[0] + R2[4] * u[1] + R2[5] * u[2],
                  oz = other.c[2] + R2[6] * u[0] + R2[7] * u[1] + R2[8] * u[2],
                  ex = x - ox,
                  ey = y - oy,
                  ez = z - oz,
                  dd = Math.hypot(ex, ey, ez),
                  lim = (b.pr + other.pr) * 0.7;
                if (dd >= lim || dd < 1e-5) continue;
                const nx = ex / dd,
                  ny = ey / dd,
                  nz = ez / dd,
                  s = hit(b, rx, ry, rz, nx, ny, nz, other, 0.1),
                  push = (lim - dd) * 0.4;
                b.c[0] += nx * push;
                b.c[1] += ny * push;
                b.c[2] += nz * push;
                touching++;
                if (s > 1.2 && other.asleep) {
                  other.asleep = false;
                  other.still = 0;
                }
              }
            }
          }
          const lin = 1 - 0.15 * h,
            ang = 1 - (touching ? 3.5 : 0.3) * h;
          b.v[0] *= lin;
          b.v[1] *= lin;
          b.v[2] *= lin;
          b.w[0] *= ang;
          b.w[1] *= ang;
          b.w[2] *= ang;
          if (hard > 1.5 && o.onHit) o.onHit(b.c, hard, b);
          // a big piece that lands hard breaks into lumps, which carry on from where it was; the smallest bits are handed to the chips
          if (hard > (o.breakAt || 4.5) && b.ids.length > 140 && b.gen < 2) {
            bodies.splice(n, 1);
            for (const part of K.lumps(b.ids, D, Math.max(0.35, b.rad * 0.55))) {
              const kick = [
                b.v[0] * 0.5 + (K.rnd() - 0.5) * 2.5,
                Math.abs(b.v[1]) * 0.25 + K.rnd() * 1.5,
                b.v[2] * 0.5 + (K.rnd() - 0.5) * 2.5
              ];
              if (part.length < 30 && o.chips)
                o.chips.spawn(part, {
                  v: kick,
                  w: [(K.rnd() - 0.5) * 9, (K.rnd() - 0.5) * 9, (K.rnd() - 0.5) * 9],
                  life: 1.5 + K.rnd()
                });
              else
                sys.spawn(part, {
                  v: kick,
                  w: [(K.rnd() - 0.5) * 5, (K.rnd() - 0.5) * 5, (K.rnd() - 0.5) * 5],
                  gen: b.gen + 1
                });
            }
            continue;
          }
          const sp = Math.hypot(b.v[0], b.v[1], b.v[2]) + Math.hypot(b.w[0], b.w[1], b.w[2]) * b.rad;
          if (touching && sp < 0.35) {
            b.still += h;
            if (b.still > 0.5) rest(b);
          } else b.still = 0;
          /* A piece can rock on two corners for ever, or tremble while it creeps: its speed at any instant is never small, yet it is going
             nowhere. So also look at how far it has really got in half a second while touching something all the while: a turn and a shift
             that small means it has come to rest, whatever its speed says */
          if (!b.asleep) {
            if (!touching) b.mark = null;
            else if (!b.mark) b.mark = { c: b.c.slice(), R: b.R.slice(), t: 0 };
            else if ((b.mark.t += h) >= 0.5) {
              const m = b.mark,
                tr =
                  m.R[0] * b.R[0] +
                  m.R[1] * b.R[1] +
                  m.R[2] * b.R[2] +
                  m.R[3] * b.R[3] +
                  m.R[4] * b.R[4] +
                  m.R[5] * b.R[5] +
                  m.R[6] * b.R[6] +
                  m.R[7] * b.R[7] +
                  m.R[8] * b.R[8],
                turned = Math.acos(K.clamp((tr - 1) / 2, -1, 1)),
                moved = V.dist(m.c, b.c) + turned * b.rad;
              if (moved < 0.06) rest(b);
              else b.mark = { c: b.c.slice(), R: b.R.slice(), t: 0 };
            }
          }
          if (b.c[1] < -30) bodies.splice(n, 1);
        }
      },
      write() {
        for (const b of bodies) {
          if (b.asleep && !b.dirty) continue;
          b.dirty = false;
          const R = b.R,
            a = R[0],
            bb = R[1],
            c = R[2],
            d = R[3],
            ee = R[4],
            f = R[5],
            gg = R[6],
            h = R[7],
            ii = R[8],
            L = b.loc;
          for (let m = 0; m < b.ids.length; m++) {
            const i = b.ids[m],
              q = i * 16,
              r = m * 9,
              x = L[r],
              y = L[r + 1],
              z = L[r + 2],
              c00 = L[r + 3],
              c01 = L[r + 4],
              c02 = L[r + 5],
              c11 = L[r + 6],
              c12 = L[r + 7],
              c22 = L[r + 8];
            D[q] = a * x + bb * y + c * z + b.c[0];
            D[q + 1] = d * x + ee * y + f * z + b.c[1];
            D[q + 2] = gg * x + h * y + ii * z + b.c[2];
            const m00 = a * c00 + bb * c01 + c * c02,
              m01 = a * c01 + bb * c11 + c * c12,
              m02 = a * c02 + bb * c12 + c * c22,
              m10 = d * c00 + ee * c01 + f * c02,
              m11 = d * c01 + ee * c11 + f * c12,
              m12 = d * c02 + ee * c12 + f * c22,
              m20 = gg * c00 + h * c01 + ii * c02,
              m21 = gg * c01 + h * c11 + ii * c12,
              m22 = gg * c02 + h * c12 + ii * c22;
            D[q + 4] = m00 * a + m01 * bb + m02 * c;
            D[q + 5] = m00 * d + m01 * ee + m02 * f;
            D[q + 6] = m00 * gg + m01 * h + m02 * ii;
            D[q + 8] = m10 * d + m11 * ee + m12 * f;
            D[q + 9] = m10 * gg + m11 * h + m12 * ii;
            D[q + 10] = m20 * gg + m21 * h + m22 * ii;
            st.rows[i >> 9] = 1;
          }
        }
      }
    };
    return sys;
  };
  // ---- jelly
  K.jelly = (st, ids, o) => {
    o = o || {};
    const D = st.D,
      B0 = st.base,
      cell = o.cell || 0.6,
      stiff = o.stiff === undefined ? 0.35 : o.stiff,
      damp = o.damp === undefined ? 2.2 : o.damp,
      beta = o.squash === undefined ? 0.6 : o.squash,
      gy = o.ground || null,
      nodeOf = new Map(),
      nodes = [];
    for (const i of ids) {
      const q = i * 16,
        kx = Math.floor(B0[q] / cell),
        ky = Math.floor(B0[q + 1] / cell),
        kz = Math.floor(B0[q + 2] / cell),
        key = kx + ',' + ky + ',' + kz;
      let n = nodeOf.get(key);
      if (!n) {
        n = { k: [kx, ky, kz], ids: [], q: [0, 0, 0], m: 0 };
        nodeOf.set(key, n);
        nodes.push(n);
      }
      n.ids.push(i);
      n.q[0] += B0[q];
      n.q[1] += B0[q + 1];
      n.q[2] += B0[q + 2];
      n.m++;
      if (st.rig) st.rig.free[i] = 1;
    }
    for (const n of nodes) {
      n.q = V.mul(n.q, 1 / n.m);
      n.x = n.q.slice();
      n.v = [0, 0, 0];
      n.A = M.id();
      n.goal = [0, 0, 0];
      n.gw = 0;
      n.pin = null;
    }
    // every lump, with its neighbours, is a cluster that tries to keep its shape
    const clusters = nodes.map(n => {
      const mem = [];
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (let c = -1; c <= 1; c++) {
            const m = nodeOf.get(n.k[0] + a + ',' + (n.k[1] + b) + ',' + (n.k[2] + c));
            if (m) mem.push(m);
          }
      let ms = 0;
      const c0 = [0, 0, 0];
      for (const m of mem) {
        ms += m.m;
        c0[0] += m.q[0] * m.m;
        c0[1] += m.q[1] * m.m;
        c0[2] += m.q[2] * m.m;
      }
      const cq = V.mul(c0, 1 / ms),
        Aqq = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const m of mem) {
        const r = V.sub(m.q, cq);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Aqq[a * 3 + b] += m.m * r[a] * r[b];
      }
      const tr = Aqq[0] + Aqq[4] + Aqq[8],
        solid = mem.length > 4 && M.det(Aqq) > 2e-4 * tr * tr * tr;
      for (const a of [0, 4, 8]) Aqq[a] += 1e-4 + 1e-3 * tr;
      return { node: n, mem, ms, cq, inv: M.inv(Aqq), solid, R: M.id() };
    });
    // one more cluster of everything, so the whole body holds together as well as each part of it
    let acc = 0;
    const vmax = o.vmax || 9;
    const sys = {
      nodes,
      poke(p, dir, strength, radius) {
        radius = radius || 1.6;
        for (const n of nodes) {
          const d = V.dist(n.x, p);
          if (d < radius) {
            const k = strength * (1 - d / radius);
            n.v[0] += dir[0] * k;
            n.v[1] += dir[1] * k;
            n.v[2] += dir[2] * k;
          }
        }
      },
      pin(fn) {
        for (const n of nodes) n.pin = fn(n.q) ? n.q.slice() : null;
      },
      move(fn) {
        for (const n of nodes) if (n.pin) n.pin = fn(n.q);
      },
      update(dt) {
        const h = 1 / 120;
        acc = Math.min(acc + dt, 0.1);
        let steps = 0;
        while (acc >= h) {
          acc -= h;
          steps++;
        }
        for (let s = 0; s < steps; s++) {
          for (const n of nodes) {
            n.goal[0] = n.goal[1] = n.goal[2] = 0;
            n.gw = 0;
          }
          for (const c of clusters) {
            let cx = 0,
              cy = 0,
              cz = 0;
            for (const m of c.mem) {
              cx += m.x[0] * m.m;
              cy += m.x[1] * m.m;
              cz += m.x[2] * m.m;
            }
            cx /= c.ms;
            cy /= c.ms;
            cz /= c.ms;
            const Apq = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (const m of c.mem) {
              const p = [m.x[0] - cx, m.x[1] - cy, m.x[2] - cz],
                r = V.sub(m.q, c.cq);
              for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Apq[a * 3 + b] += m.m * p[a] * r[b];
            }
            const R = (c.R = c.mem.length > 1 ? M.turnOf(Apq, c.R, 4) : c.R);
            let T = R;
            if (c.solid && beta > 0) {
              const A = M.mul(Apq, c.inv),
                dv = M.det(A);
              if (dv > 0.3 && dv < 3.5) {
                const k3 = Math.cbrt(dv);
                T = R.map((v, k) => v * (1 - beta) + K.clamp(A[k] / k3, v - 0.7, v + 0.7) * beta);
              }
            }
            c.node.A = T;
            for (const m of c.mem) {
              const g = M.app(T, V.sub(m.q, c.cq));
              m.goal[0] += g[0] + cx;
              m.goal[1] += g[1] + cy;
              m.goal[2] += g[2] + cz;
              m.gw++;
            }
          }
          for (const n of nodes) {
            if (n.pin) {
              n.v = V.mul(V.sub(n.pin, n.x), 1 / h);
              n.x = n.pin.slice();
              continue;
            }
            const gx = n.goal[0] / n.gw,
              gyy = n.goal[1] / n.gw,
              gz = n.goal[2] / n.gw;
            n.v[0] += (stiff * (gx - n.x[0])) / h;
            n.v[1] += (stiff * (gyy - n.x[1])) / h - (o.gravity || 0) * h;
            n.v[2] += (stiff * (gz - n.x[2])) / h;
            const dk = Math.max(0, 1 - damp * h);
            n.v[0] *= dk;
            n.v[1] *= dk;
            n.v[2] *= dk;
            const sp = Math.hypot(n.v[0], n.v[1], n.v[2]);
            if (sp > vmax) {
              n.v[0] *= vmax / sp;
              n.v[1] *= vmax / sp;
              n.v[2] *= vmax / sp;
            }
            n.x[0] += n.v[0] * h;
            n.x[1] += n.v[1] * h;
            n.x[2] += n.v[2] * h;
            if (gy) {
              const f = gy(n.x[0], n.x[2]) + (o.thick || 0.1);
              if (n.x[1] < f) {
                n.x[1] = f;
                if (n.v[1] < 0) n.v[1] *= -0.3;
                n.v[0] *= 0.8;
                n.v[2] *= 0.8;
              }
            }
          }
        }
        // each lump carries its splats: turned and squashed as its cluster is
        for (const n of nodes) {
          const A = n.A,
            a = A[0],
            b = A[1],
            c = A[2],
            d = A[3],
            e = A[4],
            f = A[5],
            g = A[6],
            hh = A[7],
            ii = A[8];
          for (const i of n.ids) {
            const q = i * 16,
              x = B0[q] - n.q[0],
              y = B0[q + 1] - n.q[1],
              z = B0[q + 2] - n.q[2],
              c00 = B0[q + 4],
              c01 = B0[q + 5],
              c02 = B0[q + 6],
              c11 = B0[q + 8],
              c12 = B0[q + 9],
              c22 = B0[q + 10];
            D[q] = a * x + b * y + c * z + n.x[0];
            D[q + 1] = d * x + e * y + f * z + n.x[1];
            D[q + 2] = g * x + hh * y + ii * z + n.x[2];
            const m00 = a * c00 + b * c01 + c * c02,
              m01 = a * c01 + b * c11 + c * c12,
              m02 = a * c02 + b * c12 + c * c22,
              m10 = d * c00 + e * c01 + f * c02,
              m11 = d * c01 + e * c11 + f * c12,
              m12 = d * c02 + e * c12 + f * c22,
              m20 = g * c00 + hh * c01 + ii * c02,
              m21 = g * c01 + hh * c11 + ii * c12,
              m22 = g * c02 + hh * c12 + ii * c22;
            D[q + 4] = m00 * a + m01 * b + m02 * c;
            D[q + 5] = m00 * d + m01 * e + m02 * f;
            D[q + 6] = m00 * g + m01 * hh + m02 * ii;
            D[q + 8] = m10 * d + m11 * e + m12 * f;
            D[q + 9] = m10 * g + m11 * hh + m12 * ii;
            D[q + 10] = m20 * g + m21 * hh + m22 * ii;
            st.rows[i >> 9] = 1;
          }
        }
      }
    };
    return sys;
  };
  // ---- sand: columns of grains on a square grid. A grain falls, joins the column under it, and columns that stand too far above a neighbour shed their top grain to it
  K.sand = (st, pool, o) => {
    o = o || {};
    const cell = o.cell || 0.16,
      gy = o.ground || (() => 0),
      cols = new Map(),
      falling = [],
      slope = o.slope || 1.6,
      palP = st.W.pal.map(h => ((h >> 16) & 255) + (h & 0xff00) + ((h & 255) << 16)),
      col = (ix, iz) => {
        const k = ix + ',' + iz;
        let c = cols.get(k);
        if (!c) {
          c = { ix, iz, g: [], base: gy((ix + 0.5) * cell, (iz + 0.5) * cell) };
          cols.set(k, c);
        }
        return c;
      },
      top = c => c.base + c.g.length * cell * 0.8;
    const place = (c, gr) => {
      c.g.push(gr);
      pool.put(
        st,
        gr.i,
        (c.ix + 0.5) * cell + gr.jx,
        top(c) - cell * 0.4,
        (c.iz + 0.5) * cell + gr.jz,
        cell * 0.62,
        gr.col,
        3
      );
    };
    const sys = {
      cols,
      count: 0,
      heightAt: (x, z) => top(col(Math.floor(x / cell), Math.floor(z / cell))),
      pour(p, n, palette, spread) {
        for (let k = 0; k < n; k++)
          falling.push({
            i: pool.take(),
            p: [
              p[0] + (K.rnd() - 0.5) * (spread || 0.3),
              p[1] + K.rnd() * 0.3,
              p[2] + (K.rnd() - 0.5) * (spread || 0.3)
            ],
            v: [(K.rnd() - 0.5) * 0.6, -1, (K.rnd() - 0.5) * 0.6],
            col: palP[palette[Math.floor(K.rnd() * palette.length)]],
            jx: (K.rnd() - 0.5) * cell * 0.5,
            jz: (K.rnd() - 0.5) * cell * 0.5
          });
        sys.count += n;
      },
      update(dt) {
        dt = Math.min(dt, 0.033);
        for (let k = falling.length - 1; k >= 0; k--) {
          const gr = falling[k];
          gr.v[1] -= 16 * dt;
          gr.p[0] += gr.v[0] * dt;
          gr.p[1] += gr.v[1] * dt;
          gr.p[2] += gr.v[2] * dt;
          const c = col(Math.floor(gr.p[0] / cell), Math.floor(gr.p[2] / cell));
          if (gr.p[1] <= top(c)) {
            falling.splice(k, 1);
            place(c, gr);
            sys.dirty = true;
          } else pool.put(st, gr.i, gr.p[0], gr.p[1], gr.p[2], cell * 0.55, gr.col, 3);
        }
        // let the pile settle: a few passes, each moving the top grain of any column that stands more than `slope` grains above a neighbour
        if (sys.dirty) {
          let moved = 0;
          for (let pass = 0; pass < 3; pass++)
            for (const c of Array.from(cols.values())) {
              if (!c.g.length) continue;
              let best = null,
                bd = slope * cell * 0.8;
              for (const d of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1]
              ]) {
                const nb = col(c.ix + d[0], c.iz + d[1]),
                  diff = top(c) - top(nb);
                if (diff > bd) {
                  bd = diff;
                  best = nb;
                }
              }
              if (best) {
                place(best, c.g.pop());
                moved++;
              }
            }
          if (!moved && !falling.length) sys.dirty = false;
        }
      }
    };
    return sys;
  };
})(KIT);
