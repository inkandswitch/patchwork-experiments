/* k6-voxels: an invisible grid over the diorama that remembers what has happened to each part of it.
   The splats are what the place looks like; the grid is what has been done to it: how hot, how burnt, how frozen, how wet, how overgrown.
   Effects write into the grid, rules spread it from cell to cell, and a painter shows it on whatever splats sit in each cell.
     const vx = K.voxels(st, { cell: 0.4, sdf: S.sdf })
     vx.brush('heat', [x, y, z], r, 1)                write into a ball (clamped 0..1)
     vx.get('burnt', x, y, z)                         read
     st.add(vx.fire({ spread: 1, look: { flame: [21, 10], soot: [8] } }))     fire that eats fuel, climbs, burns out and leaves soot
     st.add(vx.frost({ look: { pale: [13, 17] } }))                          frost that creeps and melts near heat
     st.add(vx.grow({ look: { moss: [3, 4] } }))                             growth that spreads over upward faces
     vx.unsupported()                                 the cells no longer joined to the ground (for collapse)
   Channels are made when first used (one byte a cell). The 2D ecology grid in the game is this idea, flat. */
(function (K) {
  K.voxels = (st, o) => {
    o = o || {};
    const cell = o.cell || 0.4,
      g = K.grid(st, cell),
      dim = g.dim,
      lo = g.lo,
      nc = dim[0] * dim[1] * dim[2],
      ch = {},
      N = st.N,
      D0 = st.base,
      cellOf = new Int32Array(N).fill(-1),
      occ = new Uint8Array(nc),
      veg = new Uint8Array(N);
    for (let c = 0; c < nc; c++)
      for (let i = g.head[c]; i >= 0; i = g.next[i]) {
        cellOf[i] = c;
        if (D0[i * 16 + 3] >= 1) occ[c] = 1;
        const pk = D0[i * 16 + 7],
          r = pk % 256,
          gg = Math.floor(pk / 256) % 256,
          b = Math.floor(pk / 65536);
        if (gg - Math.max(r, b) > 15) veg[i] = 1;
      }
    const NB = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1]
      ],
      idx = (x, y, z) => (x * dim[1] + y) * dim[2] + z,
      xyz = c => {
        const z = c % dim[2],
          y = ((c - z) / dim[2]) % dim[1],
          x = (c - z - y * dim[2]) / (dim[2] * dim[1]);
        return [x, y, z];
      };
    const vx = {
      cell,
      dim,
      lo,
      nc,
      occ,
      cellOf,
      veg,
      grid: g,
      ch,
      layer: name => ch[name] || (ch[name] = new Uint8Array(nc)),
      idx,
      xyz,
      centre: c => {
        const q = xyz(c);
        return [lo[0] + (q[0] + 0.5) * cell, lo[1] + (q[1] + 0.5) * cell, lo[2] + (q[2] + 0.5) * cell];
      },
      at: (x, y, z) => g.cellOf(x, y, z),
      get: (name, x, y, z) => {
        const c = g.cellOf(x, y, z);
        return c < 0 || !ch[name] ? 0 : ch[name][c] / 255;
      },
      // every splat in a cell is done again by the painters
      dirty(c) {
        for (let i = g.head[c]; i >= 0; i = g.next[i]) st.repaint(i);
      },
      // add amount (which may be negative) to a channel inside a ball; only cells with something in them unless any = true. Returns the cells changed
      brush(name, p, r, amount, any) {
        const L = vx.layer(name),
          out = [],
          i0 = [0, 1, 2].map(k => Math.max(0, Math.floor((p[k] - r - lo[k]) / cell))),
          i1 = [0, 1, 2].map(k => Math.min(dim[k] - 1, Math.floor((p[k] + r - lo[k]) / cell)));
        for (let x = i0[0]; x <= i1[0]; x++)
          for (let y = i0[1]; y <= i1[1]; y++)
            for (let z = i0[2]; z <= i1[2]; z++) {
              const c = idx(x, y, z);
              if (!any && !occ[c]) continue;
              const d = Math.hypot(
                lo[0] + (x + 0.5) * cell - p[0],
                lo[1] + (y + 0.5) * cell - p[1],
                lo[2] + (z + 0.5) * cell - p[2]
              );
              if (d > r) continue;
              const v = K.clamp(Math.round(L[c] + amount * 255 * (1 - (0.5 * d) / r)), 0, 255);
              if (v !== L[c]) {
                L[c] = v;
                out.push(c);
                vx.dirty(c);
              }
            }
        return out;
      },
      neighbours(c, fn) {
        const q = xyz(c);
        for (const d of NB) {
          const x = q[0] + d[0],
            y = q[1] + d[1],
            z = q[2] + d[2];
          if (x < 0 || y < 0 || z < 0 || x >= dim[0] || y >= dim[1] || z >= dim[2]) continue;
          fn(idx(x, y, z), d);
        }
      },
      // cells with something in them that cannot be reached from the lowest layers through other full cells (empty(c) says a cell has been emptied since)
      unsupported(empty, floorY) {
        const seen = new Uint8Array(nc),
          stack = [],
          full = c => occ[c] && !(empty && empty(c)),
          ymax = Math.max(0, Math.floor(((floorY === undefined ? lo[1] + cell : floorY) - lo[1]) / cell));
        for (let x = 0; x < dim[0]; x++)
          for (let z = 0; z < dim[2]; z++)
            for (let y = 0; y <= ymax; y++) {
              const c = idx(x, y, z);
              if (full(c) && !seen[c]) {
                seen[c] = 1;
                stack.push(c);
              }
            }
        while (stack.length) {
          const q = xyz(stack.pop());
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) {
                const x = q[0] + dx,
                  y = q[1] + dy,
                  z = q[2] + dz;
                if (x < 0 || y < 0 || z < 0 || x >= dim[0] || y >= dim[1] || z >= dim[2]) continue;
                const c = idx(x, y, z);
                if (!seen[c] && full(c)) {
                  seen[c] = 1;
                  stack.push(c);
                }
              }
        }
        const out = [];
        for (let c = 0; c < nc; c++) if (full(c) && !seen[c]) out.push(c);
        return out;
      }
    };
    const colour = (c, h) => {
        c[0] = ((h >> 16) & 255) / 255;
        c[1] = ((h >> 8) & 255) / 255;
        c[2] = (h & 255) / 255;
      },
      pal = st.W.pal;
    // ---- fire. fuel is what there is to burn (set from what is in each cell: growing things burn best), heat is burning now, burnt is what is left
    vx.fire = f => {
      f = f || {};
      const fuel = vx.layer('fuel'),
        heat = vx.layer('heat'),
        burnt = vx.layer('burnt'),
        wet = vx.layer('wet'),
        look = f.look || {},
        flame = look.flame || [],
        soot = look.soot || [],
        active = new Set(),
        healing = new Set(),
        tick = f.tick || 0.09;
      let acc = 0,
        seed = 1;
      const fuelOf = f.fuel || (i => (f.base === undefined ? 0.25 : f.base) + 0.75 * veg[i]),
        fuel0 = new Uint8Array(nc);
      for (let c = 0; c < nc; c++) {
        if (!occ[c]) continue;
        let n = 0,
          v = 0;
        for (let i = g.head[c]; i >= 0; i = g.next[i]) {
          n++;
          v += fuelOf(i);
        }
        fuel0[c] = fuel[c] = Math.round(255 * K.clamp(v / n, 0, 1));
      }
      const ash = look.ash || [],
        cool = vx.layer('cool'),
        shoot = look.shoot || [];
      const rnd = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        },
        sys = {
          active,
          healing,
          onBurn: f.onBurn || null,
          light(p, r) {
            for (const c of vx.brush('heat', p, r, 1)) if (fuel[c] > 0) active.add(c);
          },
          update(dt) {
            acc += dt;
            while (acc >= tick) {
              acc -= tick;
              for (const c of Array.from(active)) {
                const h = heat[c],
                  fu = fuel[c];
                if (fu > 0) {
                  fuel[c] = Math.max(0, fu - Math.round((255 * tick) / (f.burn || 2.5)));
                  heat[c] = Math.min(255, h + 60);
                  burnt[c] = Math.max(burnt[c], 255 - fuel[c]);
                } else {
                  heat[c] = Math.max(0, h - Math.round((255 * tick) / 0.6));
                  burnt[c] = 255;
                  if (heat[c] === 0) {
                    active.delete(c);
                    cool[c] = 0;
                    healing.add(c);
                  }
                }
                if (heat[c] > 120)
                  vx.neighbours(c, (nb, d) => {
                    if (!occ[nb] || fuel[nb] === 0 || heat[nb] > 0) return;
                    const p =
                      (f.spread === undefined ? 1 : f.spread) *
                      tick *
                      (d[1] > 0 ? 3.2 : d[1] < 0 ? 0.5 : 1.3) *
                      (0.3 + fuel[nb] / 255) *
                      (1 - wet[nb] / 255);
                    if (rnd() < p) {
                      heat[nb] = 40;
                      active.add(nb);
                    }
                  });
                vx.dirty(c);
                if (sys.onBurn && heat[c] > 150 && rnd() < 0.25) sys.onBurn(vx.centre(c), heat[c] / 255);
              }
              // what has burnt comes back, slowly, once it has been cold a while (f.heal seconds; 0 = never): the burn fades and there is fuel again
              if (f.heal)
                for (const c of Array.from(healing)) {
                  if (heat[c] > 0) {
                    healing.delete(c);
                    continue;
                  }
                  if (cool[c] < 255) {
                    cool[c] = Math.min(255, cool[c] + Math.max(1, Math.round((255 * tick) / f.heal)));
                    continue;
                  }
                  if (rnd() < 0.2) {
                    burnt[c] = Math.max(0, burnt[c] - 9);
                    fuel[c] = Math.round(fuel0[c] * (1 - burnt[c] / 255));
                    vx.dirty(c);
                    if (burnt[c] === 0) healing.delete(c);
                  }
                }
            }
          },
          paint(i, c) {
            const k = cellOf[i];
            if (k < 0) return;
            const h = heat[k];
            if (h > 40 && flame.length) {
              const e = K.hash(i, Math.floor(st.time * 11));
              if (e < h / 300) {
                colour(c, pal[flame[Math.floor(K.hash(i * 3.1, st.time * 7) * flame.length) % flame.length]]);
                return;
              }
            }
            const b = burnt[k];
            if (b > 20) {
              const u = b / 255,
                fu = fuelOf(i),
                e = K.hash(i, 9);
              if (veg[i] && u > 0.55 + 0.4 * K.hash(i, 5)) {
                c[3] = 0;
                return;
              }
              if (shoot.length && cool[k] === 255 && u < 0.75 && fu > 0.3 && K.hash(i, 21) < 0.5 * (1 - u)) {
                colour(c, pal[shoot[Math.floor(K.hash(i, 4) * shoot.length) % shoot.length]]);
                return;
              }
              if (ash.length && e > 0.9 && fu > 0.2)
                colour(c, pal[ash[Math.floor(K.hash(i, 6) * ash.length) % ash.length]]);
              else if (soot.length && e < u * (0.25 + 0.75 * fu))
                colour(c, pal[soot[Math.floor(K.hash(i, 2) * soot.length) % soot.length]]);
              else {
                const m = 1 - 0.45 * u;
                c[0] *= m;
                c[1] *= m;
                c[2] *= m;
              }
            }
          }
        };
      return sys;
    };
    // ---- frost creeps from where it is put, over anything, and goes where it is warm
    vx.frost = f => {
      f = f || {};
      const fr = vx.layer('frost'),
        far = vx.layer('frostFar'),
        reach = f.reach || 10,
        heat = vx.layer('heat'),
        pale = (f.look || {}).pale || [],
        active = new Set(),
        tick = f.tick || 0.15;
      let acc = 0,
        seed = 7;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const sys = {
        active,
        chill(p, r) {
          for (const c of vx.brush('frost', p, r, 1)) active.add(c);
        },
        update(dt) {
          acc += dt;
          while (acc >= tick) {
            acc -= tick;
            for (const c of Array.from(active)) {
              if (heat[c] > 30) {
                fr[c] = Math.max(0, fr[c] - 40);
                vx.dirty(c);
                if (!fr[c]) active.delete(c);
                continue;
              }
              if (fr[c] < 255) {
                fr[c] = Math.min(255, fr[c] + 25);
                vx.dirty(c);
              }
              if (fr[c] > 150)
                vx.neighbours(c, nb => {
                  if (
                    occ[nb] &&
                    fr[nb] === 0 &&
                    heat[nb] < 30 &&
                    far[c] < reach &&
                    rnd() < (f.spread === undefined ? 0.5 : f.spread) * tick
                  ) {
                    fr[nb] = 20;
                    far[nb] = far[c] + 1;
                    active.add(nb);
                    vx.dirty(nb);
                  }
                });
            }
          }
        },
        paint(i, c) {
          const k = cellOf[i];
          if (k < 0) return;
          const u = fr[k] / 255;
          if (u <= 0) return;
          const lm = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
          if (pale.length && K.hash(i, 3) < u * (0.35 + 0.65 * lm + (D0[i * 16 + 1] % 1) * 0.1))
            colour(c, pal[pale[Math.min(pale.length - 1, Math.floor(lm * 1.6 * pale.length))]]);
          else {
            c[0] += (0.6 - c[0]) * 0.25 * u;
            c[1] += (0.75 - c[1]) * 0.25 * u;
            c[2] += (0.9 - c[2]) * 0.3 * u;
          }
        }
      };
      return sys;
    };
    // ---- growth: moss or rot that spreads slowly through cells that touch it, and shows on some of the splats there
    vx.grow = f => {
      f = f || {};
      const gr = vx.layer('grow'),
        burnt = vx.layer('burnt'),
        cols = (f.look || {}).moss || [],
        active = new Set(),
        tick = f.tick || 0.25;
      let acc = 0,
        seed = 3;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const sys = {
        active,
        seed(p, r) {
          for (const c of vx.brush('grow', p, r, 1)) active.add(c);
        },
        update(dt) {
          acc += dt;
          while (acc >= tick) {
            acc -= tick;
            for (const c of Array.from(active)) {
              if (gr[c] < 255) {
                gr[c] = Math.min(255, gr[c] + 12);
                vx.dirty(c);
              } else if (rnd() < 0.3) active.delete(c);
              if (gr[c] > 110)
                vx.neighbours(c, nb => {
                  if (
                    occ[nb] &&
                    gr[nb] === 0 &&
                    burnt[nb] < 100 &&
                    rnd() < (f.spread === undefined ? 0.35 : f.spread) * tick
                  ) {
                    gr[nb] = 10;
                    active.add(nb);
                  }
                });
            }
          }
        },
        paint(i, c) {
          const k = cellOf[i];
          if (k < 0 || !cols.length) return;
          const u = gr[k] / 255;
          if (u > 0 && K.hash(i, 13) < u * (f.cover === undefined ? 0.7 : f.cover))
            colour(c, pal[cols[Math.floor(K.hash(i, 17) * cols.length) % cols.length]]);
        }
      };
      return sys;
    };
    return vx;
  };
})(KIT);
