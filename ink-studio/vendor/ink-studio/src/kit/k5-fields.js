/* k5-fields: change splats by where they are.
   A field is a few simple shapes with soft edges. Inside them it can recolour, fade and push. Three systems use one:
     K.fx.tint(st, field, mode)   a painter. mode 'multiply' | 'set' | 'add'; opacity 0 with multiply makes a hole
     K.fx.push(st, field)         moves splats by the field's displacement, and puts them back when it has gone by
     K.fx.reveal(st, o)           the diorama forms out of nothing in blocks, low ones first (the game's own arrival), or goes the same way
   Shapes: K.shape.sphere(c, r) box(c, half, rd) capsule(a, b, r) plane(n, d) cone(apex, axis, half-angle) all()
   Each shape object may be moved between frames (change .c, .r ...) : call field.touch() so the systems look again. */
(function (K) {
  const V = K.V;
  K.shape = {
    all: () => ({ sd: () => -1e3, c: [0, 0, 0], reach: 1e9 }),
    sphere: (c, r) => {
      const s = {
        c,
        r,
        sd: (x, y, z) => Math.hypot(x - s.c[0], y - s.c[1], z - s.c[2]) - s.r,
        get reach() {
          return s.r;
        }
      };
      return s;
    },
    box: (c, h, rd) => {
      const s = {
        c,
        h,
        rd: rd || 0,
        sd: (x, y, z) => {
          const qx = Math.abs(x - s.c[0]) - s.h[0] + s.rd,
            qy = Math.abs(y - s.c[1]) - s.h[1] + s.rd,
            qz = Math.abs(z - s.c[2]) - s.h[2] + s.rd;
          return (
            Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - s.rd
          );
        },
        get reach() {
          return Math.hypot(s.h[0], s.h[1], s.h[2]);
        }
      };
      return s;
    },
    capsule: (a, b, r) => {
      const s = {
        a,
        b,
        r,
        get c() {
          return V.lerp(s.a, s.b, 0.5);
        },
        sd: (x, y, z) => {
          const p = [x - s.a[0], y - s.a[1], z - s.a[2]],
            d = V.sub(s.b, s.a),
            t = K.clamp(V.dot(p, d) / (V.dot(d, d) || 1), 0, 1);
          return Math.hypot(p[0] - d[0] * t, p[1] - d[1] * t, p[2] - d[2] * t) - s.r;
        },
        get reach() {
          return V.dist(s.a, s.b) / 2 + s.r;
        }
      };
      return s;
    },
    plane: (n, d) => {
      const s = {
        n: V.norm(n),
        d,
        c: [0, 0, 0],
        reach: 1e9,
        sd: (x, y, z) => x * s.n[0] + y * s.n[1] + z * s.n[2] - s.d
      };
      return s;
    },
    cone: (apex, axis, ang) => {
      const s = {
        c: apex,
        axis: V.norm(axis),
        ang,
        reach: 1e9,
        sd: (x, y, z) => {
          const p = [x - s.c[0], y - s.c[1], z - s.c[2]],
            h = V.dot(p, s.axis),
            r = Math.sqrt(Math.max(0, V.dot(p, p) - h * h));
          return r * Math.cos(s.ang) - h * Math.sin(s.ang);
        }
      };
      return s;
    }
  };
  // K.field({ soft: 0.3, shapes: [{ shape, color: [r, g, b], opacity: 1, displace: [x, y, z], invert }] })   .eval(x, y, z) -> weight 0..1 and fills field.out
  K.field = def => {
    const items = def.shapes.map(s => (s.shape ? s : { shape: s })),
      soft = def.soft || 0,
      out = { w: 0, r: 1, g: 1, b: 1, a: 1, dx: 0, dy: 0, dz: 0 },
      f = {
        def,
        items,
        out,
        version: 1,
        touch() {
          f.version++;
        },
        eval(x, y, z) {
          let keep = 1,
            sw = 0,
            r = 0,
            g = 0,
            b = 0,
            a = 0,
            dx = 0,
            dy = 0,
            dz = 0;
          for (const it of items) {
            let d = it.shape.sd(x, y, z);
            if (it.invert) d = -d;
            const w = soft > 0 ? K.clamp(0.5 - d / (2 * soft), 0, 1) : d < 0 ? 1 : 0;
            if (w <= 0) continue;
            const c = it.color || [1, 1, 1],
              dp = it.displace;
            keep *= 1 - w;
            sw += w;
            r += c[0] * w;
            g += c[1] * w;
            b += c[2] * w;
            a += (it.opacity === undefined ? 1 : it.opacity) * w;
            if (dp) {
              dx += dp[0] * w;
              dy += dp[1] * w;
              dz += dp[2] * w;
            }
          }
          let W = 1 - keep;
          if (def.invert) W = 1 - W;
          out.w = W;
          if (sw > 0) {
            out.r = r / sw;
            out.g = g / sw;
            out.b = b / sw;
            out.a = a / sw;
            out.dx = dx;
            out.dy = dy;
            out.dz = dz;
          } else {
            out.r = out.g = out.b = out.a = 1;
            out.dx = out.dy = out.dz = 0;
            if (def.invert && items[0]) {
              const c = items[0].color || [1, 1, 1];
              out.r = c[0];
              out.g = c[1];
              out.b = c[2];
              out.a = items[0].opacity === undefined ? 1 : items[0].opacity;
            }
          }
          return W;
        },
        // is this point possibly inside any shape (a quick no for most splats)
        near(x, y, z) {
          if (def.invert) return true;
          for (const it of items) {
            const s = it.shape,
              c = s.c,
              m = s.reach + soft + 0.01;
            if (m > 1e8 || it.invert) return true;
            const ax = x - c[0],
              ay = y - c[1],
              az = z - c[2];
            if (ax * ax + ay * ay + az * az < m * m) return true;
          }
          return false;
        }
      };
    return f;
  };
  K.fx = K.fx || {};
  // the whole picture regraded without touching a splat: every palette colour is shown as another (the game's hour and weather).
  /* const g = K.fx.grade(st); g.set((r, g, b, index) => [r * 0.6, g * 0.65, b * 0.9], amount)    amount 0 = as baked */
  K.fx.grade = st => {
    const pal = st.W.pal,
      arr = new Float32Array(144),
      base = pal.map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);
    return {
      setRemap(definition, amount = 1) {
        const remap = PixelLook.prepareRemap(definition, pal, st.W.paletteRoles);
        st.grade = remap && amount !== 0 ? remap.grade(null, amount) : null;
      },
      set(fn, amount) {
        if (!amount) {
          st.grade = null;
          return;
        }
        pal.forEach((h, i) => {
          const c = base[i],
            o = fn(c[0], c[1], c[2], i) || c;
          arr[i * 3] = c[0] + (o[0] - c[0]) * amount;
          arr[i * 3 + 1] = c[1] + (o[1] - c[1]) * amount;
          arr[i * 3 + 2] = c[2] + (o[2] - c[2]) * amount;
        });
        st.grade = arr;
      }
    };
  };
  // o.live: look again every frame (for a field crossing things that move); otherwise only when field.touch() has been called. o.where(i): leave some splats alone
  K.fx.tint = (st, field, mode, o) => {
    o = o || {};
    mode = mode || 'multiply';
    const N = st.N,
      wt = new Float32Array(N),
      cr = new Float32Array(N * 4),
      D = st.D;
    let seen = -1;
    const sys = {
      field,
      update() {
        if (!o.live && seen === field.version) return;
        seen = field.version;
        for (let i = 0, q = 0; i < N; i++, q += 16) {
          let w = 0;
          if ((!o.where || o.where(i)) && field.near(D[q], D[q + 1], D[q + 2]))
            w = field.eval(D[q], D[q + 1], D[q + 2]);
          if (w > 0) {
            const e = field.out;
            if (
              Math.abs(wt[i] - w) > 0.004 ||
              cr[i * 4] !== e.r ||
              cr[i * 4 + 1] !== e.g ||
              cr[i * 4 + 2] !== e.b ||
              cr[i * 4 + 3] !== e.a
            ) {
              wt[i] = w;
              cr[i * 4] = e.r;
              cr[i * 4 + 1] = e.g;
              cr[i * 4 + 2] = e.b;
              cr[i * 4 + 3] = e.a;
              st.repaint(i);
            }
          } else if (wt[i] > 0) {
            wt[i] = 0;
            st.repaint(i);
          }
        }
      },
      paint(i, c) {
        const w = wt[i];
        if (w <= 0) return;
        const k = i * 4;
        if (mode === 'set') {
          c[0] += (cr[k] - c[0]) * w;
          c[1] += (cr[k + 1] - c[1]) * w;
          c[2] += (cr[k + 2] - c[2]) * w;
        } else if (mode === 'add') {
          c[0] += cr[k] * w;
          c[1] += cr[k + 1] * w;
          c[2] += cr[k + 2] * w;
        } else {
          c[0] *= 1 + (cr[k] - 1) * w;
          c[1] *= 1 + (cr[k + 1] - 1) * w;
          c[2] *= 1 + (cr[k + 2] - 1) * w;
        }
        if (mode !== 'set' || cr[k + 3] < 1) {
          const a = 1 + (cr[k + 3] - 1) * w;
          if (a < 0.5) c[3] = 0;
        }
      }
    };
    return sys;
  };
  K.fx.push = (st, field) => {
    const D = st.D,
      N = st.N;
    let moved = [],
      saved = [];
    const sys = {
      field,
      pre() {
        for (let k = 0; k < moved.length; k++) {
          const q = moved[k] * 16;
          D[q] = saved[k * 3];
          D[q + 1] = saved[k * 3 + 1];
          D[q + 2] = saved[k * 3 + 2];
          st.rows[moved[k] >> 9] = 1;
        }
        moved = [];
        saved = [];
      },
      update() {
        for (let i = 0, q = 0; i < N; i++, q += 16) {
          if (D[q + 3] <= 0 || !field.near(D[q], D[q + 1], D[q + 2])) continue;
          const w = field.eval(D[q], D[q + 1], D[q + 2]);
          if (w <= 0) continue;
          const e = field.out;
          if (!e.dx && !e.dy && !e.dz) continue;
          moved.push(i);
          saved.push(D[q], D[q + 1], D[q + 2]);
          D[q] += e.dx;
          D[q + 1] += e.dy;
          D[q + 2] += e.dz;
          st.rows[i >> 9] = 1;
        }
      }
    };
    return sys;
  };
  // o: dur (seconds for the whole thing), block (size of the lumps), from 'low' | 'centre' | 'far' | a function (x, y, z) -> 0..1 order, delay.
  //   sys.play(t) forms it starting at time t; sys.unmake(t) takes it apart again. Until play is called everything is shown (o.hidden: start with nothing)
  K.fx.reveal = (st, o) => {
    o = o || {};
    const N = st.N,
      B0 = st.base,
      blk = o.block || 0.5,
      dur = o.dur || 2.2,
      when = new Float32Array(N),
      hid = new Uint8Array(N),
      order = new Int32Array(N);
    let lo = 1e9,
      hi = -1e9,
      rmax = 0;
    for (let i = 0; i < N; i++) {
      const y = B0[i * 16 + 1];
      if (y < -50) continue;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      rmax = Math.max(rmax, Math.hypot(B0[i * 16], B0[i * 16 + 2]));
    }
    for (let i = 0; i < N; i++) {
      const x = B0[i * 16],
        y = B0[i * 16 + 1],
        z = B0[i * 16 + 2],
        bx = Math.floor(x / blk),
        by = Math.floor(y / blk),
        bz = Math.floor(z / blk),
        h = K.hash(bx, by, bz),
        cy = (by + 0.5) * blk;
      const base =
        typeof o.from === 'function'
          ? o.from(x, y, z)
          : o.from === 'centre'
            ? Math.hypot((bx + 0.5) * blk, (bz + 0.5) * blk) / (rmax || 1)
            : o.from === 'far'
              ? 1 - Math.hypot((bx + 0.5) * blk, (bz + 0.5) * blk) / (rmax || 1)
              : (cy - lo) / (hi - lo || 1);
      when[i] = K.clamp(base * 0.8 + h * 0.2, 0, 1);
      order[i] = i;
    }
    order.sort((a, b) => when[a] - when[b]);
    let t0 = null,
      dir = 1,
      ptr = 0;
    const sys = {
      done: true,
      play(t) {
        t0 = t;
        dir = 1;
        ptr = 0;
        sys.done = false;
        for (let i = 0; i < N; i++)
          if (!hid[i]) {
            hid[i] = 1;
            st.repaint(i);
          }
      },
      unmake(t) {
        t0 = t;
        dir = -1;
        ptr = N - 1;
        sys.done = false;
      },
      update(dt, t) {
        if (t0 === null) {
          if (o.hidden || o.auto) sys.play(t + (o.delay || 0));
          else return;
        }
        const u = (t - t0) / dur;
        if (dir > 0) {
          while (ptr < N && when[order[ptr]] <= u) {
            const i = order[ptr++];
            if (hid[i]) {
              hid[i] = 0;
              st.repaint(i);
            }
          }
          if (ptr >= N) sys.done = true;
        } else {
          while (ptr >= 0 && when[order[ptr]] >= 1 - u) {
            const i = order[ptr--];
            if (!hid[i]) {
              hid[i] = 1;
              st.repaint(i);
            }
          }
          if (ptr < 0) sys.done = true;
        }
      },
      paint(i, c) {
        if (hid[i]) c[3] = 0;
      }
    };
    return sys;
  };
})(KIT);
