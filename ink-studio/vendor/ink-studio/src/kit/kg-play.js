/* kg-play: what the game itself runs on, lifted here unchanged so that the game and the lab draw from one library.
     K.play.fx(B, n)        the game's loose splats: rings, sparks, drops, flakes ... n splats are set aside in the builder for them
     K.play.debris(B, n)    the pieces of whatever has just been broken: they fly, land, lie and fade
     K.play.eco()           what the ground remembers, a texel to each unit of it: burnt, burning, frozen, and how high it is
   These are the game's own; the lab's K.particles, K.debris and K.voxels do the same jobs for a stage. Making each pair one is still to do. */
(function (K) {
  K.play = {};
  // A pool of bright short-lived splats for everything that happens in a moment: sparks, flashes, rings, splashes.
  K.play.fx = function makeFx(B, N) {
    const { P } = B,
      PK = P.map(c => (c[0] | 0) + (c[1] | 0) * 256 + (c[2] | 0) * 65536),
      ps = [],
      TAU = Math.PI * 2;
    for (let i = 0; i < N; i++) {
      B.iso(0, -50, 0, 0.05, P[14], 3, { em: true, nd: true });
      ps.push({ life: 0 });
    }
    let D = null,
      at = 0,
      next = 0;
    const get = () => {
      for (let k = 0; k < N; k++) {
        const p = ps[(next + k) % N];
        if (p.life <= 0) {
          next = (next + k + 1) % N;
          return p;
        }
      }
      const p = ps[next];
      next = (next + 1) % N;
      return p;
    };
    const rnd = (a, b) => a + (b - a) * Math.random();
    const api = {
      total: N,
      bind(world, start) {
        D = world.data;
        at = start;
      },
      // streaks thrown outward; (dx, dz) leans them one way
      sparks(x, y, z, ci, n, speed, dx, dz) {
        for (let i = 0; i < n; i++) {
          const p = get();
          p.keep = false;
          const a = rnd(0, TAU),
            v = rnd(0.5, 1) * speed,
            k = dx === undefined ? 0 : 0.7;
          p.type = 1;
          p.life = p.max = rnd(0.14, 0.3);
          p.p = [x, y, z];
          p.v = [
            (Math.cos(a) * (1 - k) + (dx || 0) * k) * v,
            rnd(-0.2, 0.9) * v * 0.6,
            (Math.sin(a) * (1 - k) + (dz || 0) * k) * v
          ];
          p.g = 9;
          p.s = rnd(0.035, 0.06);
          p.l = rnd(0.12, 0.26);
          p.col = PK[ci];
        }
      },
      // a round burst of light that is biggest at once and gone in a blink
      flash(x, y, z, ci, size, life) {
        const p = get();
        p.type = 0;
        p.life = p.max = life || 0.12;
        p.p = [x, y, z];
        p.v = [0, 0, 0];
        p.g = 0;
        p.s = size;
        p.grow = -1;
        p.col = PK[ci];
      },
      // droplets or grit: thrown up, falling back
      drops(x, y, z, ci, n, speed, up) {
        for (let i = 0; i < n; i++) {
          const p = get(),
            a = rnd(0, TAU),
            v = rnd(0.3, 1) * speed;
          p.type = 0;
          p.life = p.max = rnd(0.3, 0.55);
          p.p = [x + Math.cos(a) * 0.1, y, z + Math.sin(a) * 0.1];
          p.v = [Math.cos(a) * v, rnd(0.6, 1) * (up || 3), Math.sin(a) * v];
          p.g = 12;
          p.s = rnd(0.035, 0.06);
          p.grow = -0.5;
          p.col = PK[ci];
        }
      },
      rain(x, y, z, ci) {
        const p = get();
        p.type = 1;
        p.life = p.max = 0.48;
        p.p = [x, y, z];
        p.v = [-2, -16, 1];
        p.g = 0;
        p.s = 0.022;
        p.l = 0.34;
        p.keep = true;
        p.col = PK[ci];
      },
      flake(x, y, z) {
        const p = get();
        p.type = 0;
        p.life = p.max = 3.2;
        p.p = [x, y, z];
        p.v = [rnd(-0.5, 0.5), -2.2, rnd(-0.5, 0.5)];
        p.g = 0;
        p.s = rnd(0.03, 0.05);
        p.grow = 0;
        p.col = PK[14];
      },
      mote(x, y, z, vx, vy, vz, ci, life) {
        const p = get();
        p.type = 1;
        p.life = p.max = life;
        p.p = [x, y, z];
        p.v = [vx, vy, vz];
        p.g = 0;
        p.s = 0.03;
        p.l = 0.09;
        p.keep = false;
        p.col = PK[ci];
      },
      clear() {
        for (const p of ps) p.life = 0;
      },
      // lightning from a to b: a crooked line of short bright strokes, a white core in a coloured sheath, gone almost at once
      // lightning from a to b: a hard zigzag (each kink thrown to the other side of the line from the last), a coloured sheath round a white core, and short forks off the kinks
      arc(a, b, ci, life, w, forks, core) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          dz = b[2] - a[2],
          d = Math.hypot(dx, dy, dz) || 1e-3,
          n = Math.max(3, Math.ceil(d / 0.55));
        w = w || 0.06;
        life = life || 0.14;
        let ux = -dz,
          uz = dx;
        const ul = Math.hypot(ux, uz);
        if (ul < 1e-3) {
          ux = 1;
          uz = 0;
        } else {
          ux /= ul;
          uz /= ul;
        }
        const vx = (dy * uz) / d,
          vy = (dz * ux - dx * uz) / d,
          vz = (-dy * ux) / d;
        const seg = (p0, p1, cw) => {
          const sx = p1[0] - p0[0],
            sy = p1[1] - p0[1],
            sz = p1[2] - p0[2],
            sl = Math.hypot(sx, sy, sz) || 1e-3;
          for (const q of [
            [ci, cw],
            [core === undefined ? 14 : core, cw * 0.45]
          ]) {
            const p = get();
            p.type = 1;
            p.keep = true;
            p.life = p.max = life;
            p.p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
            p.v = [(sx / sl) * 0.02, (sy / sl) * 0.02, (sz / sl) * 0.02];
            p.g = 0;
            p.s = q[1];
            p.l = sl / 2 + 0.05;
            p.col = PK[q[0]];
          }
        };
        let p0 = [a[0], a[1], a[2]],
          sgn = rnd(0, 1) < 0.5 ? -1 : 1;
        for (let i = 1; i <= n; i++) {
          const t = i / n,
            env = i < n && forks !== -1 ? Math.min(d * 0.16, 0.2 + 0.5 * Math.sin(t * Math.PI)) : 0,
            o1 = sgn * rnd(0.4, 1) * 0.5 * env,
            o2 = rnd(-0.5, 0.5) * 0.45 * env,
            q = [a[0] + dx * t + ux * o1 + vx * o2, a[1] + dy * t + vy * o2, a[2] + dz * t + uz * o1 + vz * o2];
          seg(p0, q, w);
          if (forks !== 0 && forks !== -1 && i < n && rnd(0, 1) < 0.3) {
            const l = rnd(0.45, 0.95),
              e = [
                q[0] + ((dx / d) * 0.5 + ux * sgn * 0.85 + vx * rnd(-0.4, 0.4)) * l,
                q[1] + ((dy / d) * 0.5 + vy * rnd(-0.4, 0.6)) * l,
                q[2] + ((dz / d) * 0.5 + uz * sgn * 0.85 + vz * rnd(-0.4, 0.4)) * l
              ];
            seg(q, e, w * 0.55);
          }
          p0 = q;
          sgn = -sgn;
        }
      },
      // a ring spreading flat from a point: ripples on water, the shock of a hit or a landing
      ring(x, y, z, ci, r0, r1, life, n, w) {
        const ph = rnd(0, TAU);
        for (let i = 0; i < n; i++) {
          const p = get();
          p.type = 2;
          p.life = p.max = life;
          p.p = [x, y, z];
          p.a = ph + (i / n) * TAU;
          p.r0 = r0;
          p.r1 = r1;
          p.n = n;
          p.s = w || 0.035;
          p.col = PK[ci];
        }
      },
      update(dt) {
        for (let i = 0; i < N; i++) {
          const p = ps[i],
            o = (at + i) * 16;
          if (p.life <= 0) {
            D[o + 1] = -50;
            D[o + 3] = 0;
            continue;
          }
          p.life -= dt;
          const u = Math.min(1, 1 - p.life / p.max);
          D[o + 3] = 3;
          D[o + 7] = p.col;
          if (p.type === 2) {
            const e = 1 - (1 - u) * (1 - u),
              r = p.r0 + (p.r1 - p.r0) * e,
              c = Math.cos(p.a),
              s = Math.sin(p.a),
              w = p.s * (1 - u * 0.85),
              l = Math.max(w, ((r * TAU) / p.n) * 0.36),
              q = l * l - w * w;
            D[o] = p.p[0] + c * r;
            D[o + 1] = p.p[1];
            D[o + 2] = p.p[2] + s * r;
            D[o + 4] = w * w + q * s * s;
            D[o + 5] = 0;
            D[o + 6] = -q * s * c;
            D[o + 8] = w * w * 0.3;
            D[o + 9] = 0;
            D[o + 10] = w * w + q * c * c;
            continue;
          }
          p.v[1] -= p.g * dt;
          p.p[0] += p.v[0] * dt;
          p.p[1] += p.v[1] * dt;
          p.p[2] += p.v[2] * dt;
          D[o] = p.p[0];
          D[o + 1] = p.p[1];
          D[o + 2] = p.p[2];
          if (p.type === 0) {
            const s = p.s * (p.grow < -0.9 ? (1 - u) * (1 - u) : 1 - u * 0.8),
              v = s * s;
            D[o + 4] = v;
            D[o + 5] = 0;
            D[o + 6] = 0;
            D[o + 8] = v;
            D[o + 9] = 0;
            D[o + 10] = v;
          } else {
            const vl = Math.hypot(p.v[0], p.v[1], p.v[2]) || 1,
              ax = p.v[0] / vl,
              ay = p.v[1] / vl,
              az = p.v[2] / vl,
              w = p.keep ? p.s : p.s * (1 - u),
              l = p.keep ? p.l : Math.max(w, p.l * (1 - u * 0.5)),
              q = l * l - w * w;
            D[o + 4] = w * w + q * ax * ax;
            D[o + 5] = q * ax * ay;
            D[o + 6] = q * ax * az;
            D[o + 8] = w * w + q * ay * ay;
            D[o + 9] = q * ay * az;
            D[o + 10] = w * w + q * az * az;
          }
        }
      }
    };
    return api;
  };
  // =====================================================================
  // Things that break. What is carved out of the standing world is handed here as loose splats. A tree or a pillar goes over
  // whole, turning about its foot, and comes apart where it lands; smaller things burst where they stand. Every piece then
  // falls, bounces and shrinks away by itself (the thing itself breaks into its own splats).
  // =====================================================================
  K.play.debris = function makeDebris(B, N) {
    for (let i = 0; i < N; i++) B.iso(0, -50, 0, 0.08, B.P[14], 3, {});
    let D = null,
      at = 0,
      next = 0,
      active = 0;
    const P = new Float32Array(N * 8),
      SZ = new Float32Array(N),
      FL = new Float32Array(N),
      ST = new Uint8Array(N),
      groups = [];
    const take = () => {
      for (let k = 0; k < N; k++) {
        const i = (next + k) % N;
        if (ST[i] === 0) {
          next = i + 1;
          return i;
        }
      }
      return -1;
    };
    const room = () => {
      let n = 0;
      for (let i = 0; i < N; i++) if (ST[i] === 0) n++;
      return n;
    };
    const copy = (s, i, col, grow) => {
      const o = (at + i) * 16;
      D.set(s, o);
      D[o + 11] = (Math.floor(s[11] / 16) & 3) * 16;
      D[o + 12] = D[o + 13] = D[o + 14] = D[o + 15] = 0;
      if (col !== undefined) D[o + 7] = col;
      SZ[i] = Math.max(0.05, Math.min(0.17, Math.sqrt((s[4] + s[8] + s[10]) / 3) * 1.15 * grow));
      return o;
    };
    const iso = (o, v) => {
      D[o + 4] = v;
      D[o + 5] = 0;
      D[o + 6] = 0;
      D[o + 8] = v;
      D[o + 9] = 0;
      D[o + 10] = v;
    };
    const loose = (i, x, y, z, vx, vy, vz, life, floor) => {
      const o = i * 8;
      P[o] = x;
      P[o + 1] = y;
      P[o + 2] = z;
      P[o + 3] = vx;
      P[o + 4] = vy;
      P[o + 5] = vz;
      P[o + 6] = P[o + 7] = life;
      FL[i] = floor;
      if (ST[i] === 0) active++;
      ST[i] = 1;
    };
    const api = {
      total: N,
      events: [],
      bind(world, start) {
        D = world.data;
        at = start;
        for (let i = 0; i < N; i++) D[(at + i) * 16 + 1] = -50;
      },
      clear() {
        for (let i = 0; i < N; i++) {
          ST[i] = 0;
          D[(at + i) * 16 + 1] = -50;
        }
        groups.length = 0;
        active = 0;
      },
      // burst where it stands
      burst(list, c, power, floor, cols) {
        const cap = Math.min(700, room()),
          stride = Math.max(1, Math.ceil(list.length / Math.max(1, cap))),
          grow = Math.cbrt(stride);
        for (let k = 0; k < list.length; k += stride) {
          const s = list[k],
            i = take();
          if (i < 0) break;
          const o = copy(s, i, cols ? cols[k % cols.length] : undefined, grow);
          iso(o, SZ[i] * SZ[i]);
          const dx = s[0] - c[0],
            dy = s[1] - c[1],
            dz = s[2] - c[2],
            l = Math.hypot(dx, dy, dz) || 1,
            sp = power * (0.3 + 0.7 * Math.random());
          loose(
            i,
            s[0],
            s[1],
            s[2],
            (dx / l) * sp + (Math.random() - 0.5) * 1.5,
            Math.abs(dy / l) * sp * 0.5 + 1.5 + Math.random() * power * 0.7,
            (dz / l) * sp + (Math.random() - 0.5) * 1.5,
            0.9 + Math.random() * 1.3,
            floor
          );
        }
      },
      // with nothing under it any more it comes straight down, still in its own shape, and goes to pieces as it meets the ground
      drop(list, floor, cols) {
        const cap = Math.min(1900, room()),
          stride = Math.max(1, Math.ceil(list.length / Math.max(1, cap))),
          grow = Math.cbrt(stride);
        for (let k = 0; k < list.length; k += stride) {
          const s = list[k],
            i = take();
          if (i < 0) break;
          const o = copy(s, i, cols ? cols[k % cols.length] : undefined, grow);
          if (grow > 1) {
            const q = grow * grow;
            D[o + 4] *= q;
            D[o + 5] *= q;
            D[o + 6] *= q;
            D[o + 8] *= q;
            D[o + 9] *= q;
            D[o + 10] *= q;
          }
          loose(
            i,
            s[0],
            s[1],
            s[2],
            (Math.random() - 0.5) * 0.5,
            -Math.random() * 0.6,
            (Math.random() - 0.5) * 0.5,
            3.5,
            floor
          );
          ST[i] = 3;
        }
      },
      // go over whole, about the foot, the way it was pushed; then come apart
      fall(list, pivot, ang, floor, cols, len) {
        const cap = Math.min(1700, room()),
          stride = Math.max(1, Math.ceil(list.length / Math.max(1, cap))),
          grow = Math.cbrt(stride),
          g = {
            idx: [],
            rel: [],
            cov: [],
            t: 0,
            T: 1.2,
            pivot,
            dx: Math.cos(ang),
            dz: Math.sin(ang),
            floor,
            len: len || 4
          };
        for (let k = 0; k < list.length; k += stride) {
          const s = list[k],
            i = take();
          if (i < 0) break;
          copy(s, i, cols ? cols[k % cols.length] : undefined, grow);
          if (ST[i] === 0) active++;
          ST[i] = 2;
          const q = grow * grow;
          g.idx.push(i);
          g.rel.push(s[0] - pivot[0], s[1] - pivot[1], s[2] - pivot[2]);
          g.cov.push(s[4] * q, s[5] * q, s[6] * q, s[8] * q, s[9] * q, s[10] * q);
        }
        if (g.idx.length) groups.push(g);
      },
      update(dt) {
        api.events.length = 0;
        if (!active) return;
        for (let gi = groups.length - 1; gi >= 0; gi--) {
          const g = groups[gi];
          g.t += dt;
          const u = Math.min(1, g.t / g.T),
            th = 1.5 * u * u * (0.4 + 0.6 * u),
            om = (1.5 * (0.8 * u + 1.8 * u * u)) / g.T,
            c = Math.cos(th),
            s = Math.sin(th),
            kx = g.dz,
            kz = -g.dx;
          const m00 = c + (1 - c) * kx * kx,
            m01 = -s * kz,
            m02 = (1 - c) * kx * kz,
            m10 = s * kz,
            m11 = c,
            m12 = -s * kx,
            m20 = m02,
            m21 = s * kx,
            m22 = c + (1 - c) * kz * kz,
            done = u >= 1;
          for (let n = 0; n < g.idx.length; n++) {
            const i = g.idx[n],
              o = (at + i) * 16,
              rx = g.rel[n * 3],
              ry = g.rel[n * 3 + 1],
              rz = g.rel[n * 3 + 2],
              x = m00 * rx + m01 * ry + m02 * rz,
              y = m10 * rx + m11 * ry + m12 * rz,
              z = m20 * rx + m21 * ry + m22 * rz,
              wy = Math.max(g.pivot[1] + y, g.floor + 0.04);
            if (done) {
              iso(o, SZ[i] * SZ[i]);
              const vx = -kz * y * om,
                vy = (kz * x - kx * z) * om,
                vz = kx * y * om; // where its turning was carrying it
              ST[i] = 1;
              loose(
                i,
                g.pivot[0] + x,
                wy,
                g.pivot[2] + z,
                vx * 0.45 + (Math.random() - 0.5) * 3.2,
                Math.abs(vy) * 0.22 + 0.6 + Math.random() * 3.2,
                vz * 0.45 + (Math.random() - 0.5) * 3.2,
                0.9 + Math.random() * 1.5,
                g.floor
              );
              continue;
            }
            const c00 = g.cov[n * 6],
              c01 = g.cov[n * 6 + 1],
              c02 = g.cov[n * 6 + 2],
              c11 = g.cov[n * 6 + 3],
              c12 = g.cov[n * 6 + 4],
              c22 = g.cov[n * 6 + 5];
            const a0 = m00 * c00 + m01 * c01 + m02 * c02,
              a1 = m00 * c01 + m01 * c11 + m02 * c12,
              a2 = m00 * c02 + m01 * c12 + m02 * c22,
              b0 = m10 * c00 + m11 * c01 + m12 * c02,
              b1 = m10 * c01 + m11 * c11 + m12 * c12,
              b2 = m10 * c02 + m11 * c12 + m12 * c22,
              d0 = m20 * c00 + m21 * c01 + m22 * c02,
              d1 = m20 * c01 + m21 * c11 + m22 * c12,
              d2 = m20 * c02 + m21 * c12 + m22 * c22;
            D[o] = g.pivot[0] + x;
            D[o + 1] = wy;
            D[o + 2] = g.pivot[2] + z;
            D[o + 4] = a0 * m00 + a1 * m01 + a2 * m02;
            D[o + 5] = a0 * m10 + a1 * m11 + a2 * m12;
            D[o + 6] = a0 * m20 + a1 * m21 + a2 * m22;
            D[o + 8] = b0 * m10 + b1 * m11 + b2 * m12;
            D[o + 9] = b0 * m20 + b1 * m21 + b2 * m22;
            D[o + 10] = d0 * m20 + d1 * m21 + d2 * m22;
          }
          if (done) {
            api.events.push(['crash', g.pivot[0], g.pivot[2], g.dx, g.dz, g.len]);
            groups.splice(gi, 1);
          }
        }
        for (let i = 0; i < N; i++) {
          if (ST[i] !== 3) continue;
          const p = i * 8,
            o = (at + i) * 16;
          P[p + 4] -= 17 * dt;
          P[p] += P[p + 3] * dt;
          P[p + 1] += P[p + 4] * dt;
          P[p + 2] += P[p + 5] * dt;
          D[o] = P[p];
          D[o + 1] = P[p + 1];
          D[o + 2] = P[p + 2];
          if (P[p + 1] < FL[i] + 0.12) {
            const v = -P[p + 4];
            iso(o, SZ[i] * SZ[i]);
            ST[i] = 1;
            P[p + 1] = FL[i] + SZ[i];
            P[p + 3] = (Math.random() - 0.5) * (2 + v * 0.5);
            P[p + 5] = (Math.random() - 0.5) * (2 + v * 0.5);
            P[p + 4] = v * (0.15 + Math.random() * 0.3) + 0.5;
            P[p + 6] = P[p + 7] = 0.8 + Math.random() * 1.2;
          }
        }
        for (let i = 0; i < N; i++) {
          if (ST[i] !== 1) continue;
          const p = i * 8,
            o = (at + i) * 16,
            sz = SZ[i];
          P[p + 4] -= 17 * dt;
          P[p] += P[p + 3] * dt;
          P[p + 1] += P[p + 4] * dt;
          P[p + 2] += P[p + 5] * dt;
          if (P[p + 1] < FL[i] + sz) {
            P[p + 1] = FL[i] + sz;
            if (P[p + 4] < -1.2) {
              P[p + 4] *= -0.32;
              P[p + 3] *= 0.6;
              P[p + 5] *= 0.6;
            } else {
              P[p + 4] = 0;
              P[p + 3] *= 0.8;
              P[p + 5] *= 0.8;
            }
          }
          P[p + 6] -= dt;
          if (P[p + 6] <= 0) {
            ST[i] = 0;
            active--;
            D[o + 1] = -50;
            continue;
          }
          const k = P[p + 6] / P[p + 7],
            f = k < 0.35 ? k / 0.35 : 1;
          D[o] = P[p];
          D[o + 1] = P[p + 1];
          D[o + 2] = P[p + 2];
          iso(o, sz * sz * f * f);
        }
      }
    };
    return api;
  };
  // =====================================================================
  // What the ground remembers: a grid of one-unit cells over the whole realm. Each knows how
  // burnt it is, whether it is burning now, and whether its water is ice. Fire needs fuel (grass, bushes, trees), spreads to
  // the cells beside it, is slowed by rain and stopped by water, stone and frost, and burns out leaving char that grows back.
  // Water freezes over when winter comes and thaws after; frost magic freezes a patch for a while, and fire melts ice near it.
  // The renderer reads the same grid as a small texture, so scenery changes where it stands without being rebuilt.
  // =====================================================================
  K.play.eco = function makeEco(options = {}) {
    const N = options.width ?? 160,
      NZ = options.height ?? 288,
      origin = options.origin ?? [-80, -208],
      cellSize = options.cellSize ?? 1,
      random = options.random ?? Math.random;
    if (!Number.isSafeInteger(N) || N < 1 || !Number.isSafeInteger(NZ) || NZ < 1 || N * NZ > 100000 ||
      !Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite) || !(cellSize > 0) || !Number.isFinite(cellSize) || typeof random !== 'function')
      throw new RangeError('Invalid ecology fire grid');
    const NN = N * NZ,
      tex = new Uint8Array(NN * 4),
      burn = new Float32Array(NN),
      heat = new Float32Array(NN),
      frost = new Float32Array(NN),
      fuel = new Float32Array(NN).fill(-1),
      gh = new Float32Array(NN),
      gen = new Uint8Array(NN);
    const burning = new Set(),
      warm = new Set(),
      scar = new Set(),
      timed = new Set(),
      NB = [
        [1, 0, 1],
        [-1, 0, 1],
        [0, 1, 1],
        [0, -1, 1],
        [1, 1, 0.55],
        [1, -1, 0.55],
        [-1, 1, 0.55],
        [-1, -1, 0.55]
      ];
    let realm = null,
      iceG = 0,
      iceW = -1,
      acc = 0;
    const at = (x, z) => {
      const ix = Math.floor((x - origin[0]) / cellSize),
        iz = Math.floor((z - origin[1]) / cellSize);
      return ix < 0 || iz < 0 || ix >= N || iz >= NZ ? -1 : iz * N + ix;
    };
    const fuelOf = i => {
      if (fuel[i] < 0) {
        const x = origin[0] + (i % N + 0.5) * cellSize,
          z = origin[1] + (Math.floor(i / N) + 0.5) * cellSize;
        fuel[i] = realm && realm.fuel ? realm.fuel(x, z) : 0;
      }
      return fuel[i];
    };
    const center = i => [origin[0] + (i % N + .5) * cellSize, origin[1] + (Math.floor(i / N) + .5) * cellSize];
    const available = i => realm?.available ? Math.max(0, realm.available(...center(i))) : fuelOf(i);
    const moisture = i => realm?.moisture ? Math.max(0, Math.min(1, realm.moisture(...center(i)))) : 0;
    const ice = i => (frost[i] > 0 ? 1 : frost[i] < 0 ? 0 : iceG);
    const write = i => {
      const o = i * 4;
      tex[o] = Math.round(255 * Math.min(1, burn[i]));
      tex[o + 1] = Math.round(255 * Math.min(1, heat[i]));
      tex[o + 2] = Math.round(255 * ice(i));
      tex[o + 3] = Math.max(0, Math.min(255, Math.round((gh[i] + 8) * 10)));
      api.dirty = true;
    };
    const light = (i, g0) => {
      if (burning.size >= 150 || burning.has(i)) return false;
      gen[i] = fuelOf(i) > 0.9 ? Math.max(0, (g0 || 0) - 6) : g0 || 0;
      burning.add(i);
      warm.delete(i);
      heat[i] = 1;
      scar.add(i);
      write(i);
      return true;
    };
    const disc = (x, z, r, f) => {
      const R = Math.ceil(r / cellSize);
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) {
          if (Math.hypot(dx, dz) * cellSize > r + 0.3 * cellSize) continue;
          const i = at(x + dx * cellSize, z + dz * cellSize);
          if (i >= 0) f(i);
        }
    };
    const api = {
      tex,
      N,
      NZ,
      dirty: true,
      events: [],
      get count() {
        return burning.size;
      },
      get ice() {
        return iceG;
      },
      reset(r) {
        realm = r; acc = 0; iceG = 0; api.events.length = 0;
        burn.fill(0);
        heat.fill(0);
        frost.fill(0);
        fuel.fill(-1);
        burning.clear();
        warm.clear();
        scar.clear();
        timed.clear();
        tex.fill(0);
        iceW = -1;
        api.dirty = true;
        const bed = r && (r.bed || r.raw);
        for (let i = 0; i < NN; i++) {
          gh[i] = bed ? bed(origin[0] + (i % N + 0.5) * cellSize, origin[1] + (Math.floor(i / N) + 0.5) * cellSize) : 0;
          tex[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((gh[i] + 8) * 10)));
        }
      },
      ignite(x, z, r, rain) {
        let n = 0;
        disc(x, z, r, i => {
          if (frost[i] > 0 || iceG > 0) {
            frost[i] = -8;
            timed.add(i);
            write(i);
          }
          if (fuelOf(i) > 0.05 && available(i) > 0.0001 && moisture(i) < .95 && burn[i] < 0.85 && random() > Math.max(rain || 0, moisture(i)) * 0.8 && light(i)) n++;
        });
        return n;
      },
      freeze(x, z, r, dur) {
        disc(x, z, r, i => {
          fuelOf(i);
          frost[i] = dur;
          timed.add(i);
          if (burning.delete(i)) {
            heat[i] = 0.2;
            warm.add(i);
          }
          write(i);
        });
      },
      sampleCell(i) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= NN) throw new RangeError('Invalid fire cell');
        return { burn: burn[i], heat: heat[i], burning: burning.has(i), ice: ice(i), fuel: fuelOf(i) };
      },
      setCell(i, values) {
        if (!Number.isSafeInteger(i) || i < 0 || i >= NN || !values ||
          Object.keys(values).some(k => !['heat', 'burn', 'fuel'].includes(k) || !Number.isFinite(values[k]) || values[k] < 0 || values[k] > 1))
          throw new RangeError('Invalid fire cell edit');
        if (values.fuel !== undefined) fuel[i] = values.fuel;
        if (values.burn !== undefined) { burn[i] = values.burn; if (burn[i] > 0) scar.add(i); else scar.delete(i); }
        if (values.heat !== undefined) {
          heat[i] = values.heat;
          if (heat[i] >= 1 && available(i) > .0001 && fuelOf(i) > .05) light(i);
          else if (heat[i] < .25 && burning.delete(i)) warm.add(i);
          else if (heat[i] > 0 && !burning.has(i)) warm.add(i);
        }
        write(i);
      },
      capture() {
        return { width: N, height: NZ, origin: origin.slice(), cellSize, iceG, iceW, acc,
          burn: burn.slice(), heat: heat.slice(), frost: frost.slice(), fuel: fuel.slice(), gh: gh.slice(), gen: gen.slice(),
          burning: [...burning], warm: [...warm], scar: [...scar], timed: [...timed] };
      },
      restore(s) {
        const arrays = { burn, heat, frost, fuel, gh, gen }, sets = { burning, warm, scar, timed };
        if (!s || s.width !== N || s.height !== NZ || s.cellSize !== cellSize || !Array.isArray(s.origin) || s.origin.length !== 2 || !s.origin.every((v, i) => v === origin[i]) ||
          ![s.iceG, s.iceW, s.acc].every(Number.isFinite) || s.iceG < 0 || s.iceG > 1 || s.iceW < -1 || s.iceW > 1 || s.acc < 0 ||
          !Array.from(s.burn ?? []).every(v => v >= 0 && v <= 1) || !Array.from(s.heat ?? []).every(v => v >= 0 && v <= 1e6) ||
          !Array.from(s.gen ?? []).every(v => Number.isInteger(v) && v >= 0 && v <= 255) ||
          Object.keys(arrays).some(k => s[k]?.length !== NN || !Array.from(s[k]).every(Number.isFinite)) ||
          Object.keys(sets).some(k => !Array.isArray(s[k]) || s[k].length > NN || !s[k].every(i => Number.isSafeInteger(i) && i >= 0 && i < NN)))
          throw new RangeError('Invalid fire snapshot');
        for (const [key, array] of Object.entries(arrays)) array.set(s[key]);
        for (const [key, set] of Object.entries(sets)) { set.clear(); for (const i of s[key]) set.add(i); }
        iceG = s.iceG; iceW = s.iceW; acc = s.acc;
        api.events.length = 0;
        for (let i = 0; i < NN; i++) write(i);
      },
      heatAt(x, z) {
        const i = at(x, z);
        return i >= 0 && burning.has(i) ? 1 : 0;
      },
      burntAt(x, z) {
        const i = at(x, z);
        return i < 0 ? 0 : burn[i];
      },
      frozenAt(x, z) {
        const i = at(x, z);
        return i >= 0 && ice(i) > 0.6;
      },
      // the cells burning near a point, nearest first: where to draw flames
      near(x, z, R, max) {
        const out = [];
        for (const i of burning) {
          const cx = origin[0] + (i % N + 0.5) * cellSize,
            cz = origin[1] + (Math.floor(i / N) + 0.5) * cellSize,
            d = Math.hypot(cx - x, cz - z);
          if (d < R) out.push({ i, x: cx, z: cz, y: gh[i], tree: fuel[i] > 0.9, d });
        }
        out.sort((a, b) => a.d - b.d);
        if (out.length > max) out.length = max;
        return out;
      },
      update(dt, env) {
        api.events.length = 0;
        iceG = Math.max(0, Math.min(1, iceG + dt * (env.winter > 0.5 ? 1 / 12 : -1 / 8)));
        if (Math.abs(iceG - iceW) > 0.03 || ((iceG === 0 || iceG === 1) && iceW !== iceG)) {
          iceW = iceG;
          const b = Math.round(255 * iceG);
          for (let i = 0; i < NN; i++) if (frost[i] === 0) tex[i * 4 + 2] = b;
          api.dirty = true;
        }
        acc += dt;
        if (acc < 0.2) return;
        const h = acc,
          wet = 1 - 0.85 * (env.rain || 0),
          wx = env.wx || 0,
          wz = env.wz || 0;
        acc = 0;
        for (const i of [...burning]) {
          const tree = fuelOf(i) > 0.9;
          burn[i] += h * (tree ? 0.1 : 0.34) * (0.6 + 0.4 * wet);
          heat[i] = 1;
          if (burn[i] >= 1 || available(i) <= 0.0001 || moisture(i) > .95 || (env.rain > 0.7 && random() < h * 0.4)) {
            const out = burn[i] >= 1;
            burn[i] = Math.min(1, burn[i]);
            burning.delete(i);
            heat[i] = 0.3;
            warm.add(i);
            if (out && tree) api.events.push(['burnt', origin[0] + (i % N + 0.5) * cellSize, origin[1] + (Math.floor(i / N) + 0.5) * cellSize]);
            write(i);
            continue;
          }
          const ix = i % N,
            iz = (i - ix) / N;
          for (const [dx, dz, w] of NB) {
            const jx = ix + dx,
              jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= N || jz >= NZ) continue;
            const j = jz * N + jx;
            if ((iceG > 0 || frost[j] > 0) && frost[j] >= 0 && !(frost[j] > 0 && fuelOf(j) > 0.05)) {
              frost[j] = -6;
              timed.add(j);
              write(j);
            } // ice beside a fire melts (frosted grass has to thaw first)
            if (burning.has(j) || burn[j] > 0.6 || fuelOf(j) < 0.05 || available(j) <= 0.0001 || moisture(j) > .95 || frost[j] > 0) continue;
            heat[j] +=
              h *
              w *
              0.7 *
              wet * (1 - moisture(j)) *
              (0.3 + 1.4 * random()) *
              Math.max(0, 1 + 0.6 * (dx * wx + dz * wz)) *
              Math.max(0, 1 - gen[i] / 14) *
              (fuelOf(j) > 0.7 ? 1.6 : 1);
            if (heat[j] >= 1) light(j, gen[i] + 1);
            else warm.add(j);
          } // a fire tires as it travels: each cell it takes is a little further from where it began, and past a point it takes no more (a tree gives it new heart)
          write(i);
        }
        for (const i of [...warm]) {
          if (burning.has(i)) {
            warm.delete(i);
            continue;
          }
          heat[i] *= Math.exp(-h * 0.45);
          if (heat[i] < 0.03) {
            heat[i] = 0;
            warm.delete(i);
            write(i);
          }
        }
        if (!(env.winter > 0.5))
          for (const i of [...scar]) {
            if (burning.has(i)) continue;
            const was = Math.floor(burn[i] * 16);
            burn[i] -= h * 0.005;
            if (burn[i] <= 0) {
              burn[i] = 0;
              scar.delete(i);
            }
            if (Math.floor(burn[i] * 16) !== was) write(i);
          } // char grows over again, slowly
        for (const i of [...timed]) {
          frost[i] = frost[i] > 0 ? Math.max(0, frost[i] - h) : Math.min(0, frost[i] + h);
          if (frost[i] === 0) {
            timed.delete(i);
            write(i);
          }
        }
      }
    };
    return api;
  };
})(KIT);
