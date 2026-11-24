/* kpy-props: props and clutter, put where a scene's things would gather them. A library is a set of small things, each a rule that
   makes one where it is told, with a weight; a finder says where things go (over an area, along the sides of a path, at the foot of a
   wall, round a rock); assign puts a library's things at the places a finder gives, one chosen by weight at each. A library takes its
   materials by role (stone, wood, leaf ...), so one library dresses dioramas with different palettes, and a diorama can be given
   another library, or the same one weighted differently, without touching where things go.

   K.props.library(name, props)   props: { key: { make(S, q, M, v), weight (1), needs: ['wood', ...] (the roles it uses: it is left out
        where one of them is not given), size: [lo, hi] (1, 1), vary: { name: [lo, hi] } } }. make is given the place q (q.p where it
        stands, q.yaw, q.s its size; q.at(x, y, z) takes a point in the prop's own space, y up, a unit a screen pixel, to the world),
        the materials M and its own draw of the numbers in vary (v.rnd() for more).
        -> { name, keys, props, weights, with(weights) (a copy weighted otherwise: { key: w }, 0 leaves one out), only(...keys) }
   K.props.assign(S, lib, places, M, o)   one thing at each place, chosen by weight (the same each time: from where it is);
        o: { weights, seed } -> [{ key, q }] what went where (a place nothing could go is skipped)
   K.props.place(S, lib, key, q, M)       one particular thing at one place
   Finders, each -> places [{ p: [x, y, z], n, s, yaw }] on the ground as it has been sculpted so far, looking down from o.top (12):
   K.props.area(S, o)       over a disc [cx, cz, r] or a box [x0, x1, z0, z1], as K.grow.scatter (o.n, o.gap, o.slope, o.where(x, z) ...);
                            o.clumps: { n, r, k } gathers them in n clumps of up to k round middles, r across (things lie in groups)
   K.props.along(S, path, o)  either side of a path ([[x, z], ...]): o.side ('both' | 'left' | 'right'), o.off (from the middle: 0.3),
                            o.spread (how far past that: 0.12), o.every (spacing along: 0.3), o.skip (share left out: 0.3),
                            o.face ('path': toward the path (the default) | 'away' | 'along')
   K.props.wallBase(S, o)   at the foot of a wall, facing away from it: o.box [cx, cz, hx, hz] (o.yaw turns it) or o.walls
                            [[x0, z0, x1, z1], ...]; o.reach (how far out: 0.18), o.every (0.28), o.skip (0.35), o.corners (how many
                            more gather in a corner: 2), o.sides (only these sides of a box: 0 +x, 1 +z, 2 -x, 3 -z)
   K.props.around(S, o)     round the foot of a thing: o.at [x, z] (or a list), o.r (its radius), o.reach (0.15), o.n (6 round
                            each), o.arc [a0, a1] (only part of the way round, radians), facing out
   K.props.clutter(S, lib, M, rules)  find and put in one call: rules [{ where: 'area' | 'along' | 'wall' | 'around', path (for
                            along), weights, chance (an area's where(x, z)), ...the finder's o }] -> [{ key, q }]
   K.props.starter          a first library, every size in screen pixels: pebble, stones, mushroom, mushrooms, tuft, flowers, twig,
                            litter (fallen leaves), log, stump, bucket, crate, sack, pot. Roles: stone, moss, wood, bark, leaf, bloom,
                            cap, stem, litter, iron, cloth, clay */
(function (K) {
  const TAU = 6.283185307179586;
  const dice = seed => {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const at3 = (p, s) =>
    dice(Math.round(p[0] * 977) * 31 + Math.round(p[2] * 557) * 17 + Math.round((p[1] || 0) * 131) + s);
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const grad = (sdf, x, y, z) => {
    const e = 0.02;
    return norm([
      sdf(x + e, y, z) - sdf(x - e, y, z),
      sdf(x, y + e, z) - sdf(x, y - e, z),
      sdf(x, y, z + e) - sdf(x, y, z - e)
    ]);
  };
  // a place on the ground at (x, z), or null where there is none, or it is too steep, or it is inside something
  const ground = (S, x, z, o, yaw, s) => {
    const y = S.heightAt(x, z, o.top === undefined ? 12 : o.top, o.depth || 30);
    if (!(y < 1e8 && y > -1e8)) return null;
    if (o.height && (y < o.height[0] || y > o.height[1])) return null;
    const n = grad(S.sdf, x, y, z);
    if (n[1] < (o.slope ? o.slope[0] : 0.7)) return null;
    return { p: [x, y, z], n, s: s === undefined ? 1 : s, yaw: yaw || 0 };
  };
  const sized = (o, R) => (o.size ? o.size[0] + R() * (o.size[1] - o.size[0]) : 1);
  const spaced = (out, q, gap) => !out.some(r => Math.hypot(r.p[0] - q.p[0], r.p[2] - q.p[2]) < gap);

  K.props = {
    library(name, props) {
      const keys = Object.keys(props),
        weights = {};
      for (const k of keys) weights[k] = props[k].weight === undefined ? 1 : props[k].weight;
      const make = w => ({
        name,
        keys,
        props,
        weights: w,
        with: more => make(Object.assign({}, w, more)),
        only: (...ks) => {
          const w2 = {};
          for (const k of keys) w2[k] = ks.includes(k) ? w[k] || 1 : 0;
          return make(w2);
        }
      });
      return make(weights);
    },
    place(S, lib, key, q, M) {
      const pr = lib.props[key];
      if (!pr) throw new Error(`K.props.place: '${key}' is not in the library '${lib.name}'`);
      if ((pr.needs || []).some(r => !M[r])) return false;
      const px = S.px || 0.08,
        R = at3(q.p, 7 + key.length * 13),
        v = { rnd: R };
      for (const k in pr.vary || {}) v[k] = pr.vary[k][0] + R() * (pr.vary[k][1] - pr.vary[k][0]);
      const s = q.s * (pr.size ? pr.size[0] + R() * (pr.size[1] - pr.size[0]) : 1),
        c = Math.cos(q.yaw || 0),
        sn = Math.sin(q.yaw || 0),
        unit = px * s,
        q2 = Object.assign({}, q, {
          s,
          px,
          unit,
          // a point in the prop's own space (y up, a unit a screen pixel at its size) in the world
          at: (x, y, z) => [q.p[0] + (x * c - z * sn) * unit, q.p[1] + y * unit, q.p[2] + (x * sn + z * c) * unit]
        });
      pr.make(S, q2, M, v);
      return true;
    },
    assign(S, lib, places, M, o) {
      o = o || {};
      const w = Object.assign({}, lib.weights, o.weights || {}),
        keys = lib.keys.filter(k => w[k] > 0 && !(lib.props[k].needs || []).some(r => !M[r])),
        tot = keys.reduce((a, k) => a + w[k], 0),
        done = [];
      if (!tot) return done;
      for (const q of places) {
        let x = at3(q.p, (o.seed || 1) * 7919)() * tot,
          key = keys[keys.length - 1];
        for (const k of keys) {
          if (x < w[k]) {
            key = k;
            break;
          }
          x -= w[k];
        }
        if (K.props.place(S, lib, key, q, M)) done.push({ key, q });
      }
      return done;
    },
    area(S, o) {
      o = o || {};
      S.ready();
      if (!o.clumps) return K.grow.scatter(S, Object.assign({ gap: 0.25, slope: [0.7, 1] }, o));
      // in clumps: middles first, then a few round each
      const R = dice(o.seed || 5),
        mids = K.grow.scatter(
          S,
          Object.assign({ gap: (o.clumps.r || 0.3) * 2, slope: [0.7, 1] }, o, { n: o.clumps.n || 5 })
        ),
        out = [];
      for (const m of mids)
        for (let i = 0, k = o.clumps.k || 4; i < k * 3 && out.length < (o.n || 1e9); i++) {
          const a = R() * TAU,
            r = Math.sqrt(R()) * (o.clumps.r || 0.3),
            q = ground(
              S,
              m.p[0] + Math.cos(a) * r,
              m.p[2] + Math.sin(a) * r,
              o,
              R() * TAU,
              sized(o, R) * (1 - 0.4 * (r / (o.clumps.r || 0.3)))
            );
          if (
            q &&
            spaced(out, q, (o.gap === undefined ? 0.08 : o.gap) * q.s) &&
            out.filter(p => p.mid === m).length < k
          )
            out.push(Object.assign(q, { mid: m }));
        }
      return out;
    },
    along(S, path, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 9),
        off = o.off === undefined ? 0.3 : o.off,
        spread = o.spread === undefined ? 0.12 : o.spread,
        every = o.every || 0.3,
        skip = o.skip === undefined ? 0.3 : o.skip,
        sides = o.side === 'left' ? [1] : o.side === 'right' ? [-1] : [1, -1],
        out = [];
      for (let i = 0; i + 1 < path.length; i++) {
        const [x0, z0] = path[i],
          [x1, z1] = path[i + 1],
          len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 1e-6) continue;
        const tx = (x1 - x0) / len,
          tz = (z1 - z0) / len;
        for (let d = R() * every; d < len; d += every * (0.7 + R() * 0.6))
          for (const sg of sides) {
            if (R() < skip) continue;
            const r = off + R() * spread,
              x = x0 + tx * d - tz * sg * r,
              z = z0 + tz * d + tx * sg * r,
              toward = Math.atan2(tx * sg, tz * sg),
              yaw = o.face === 'along' ? Math.atan2(tz, tx) : o.face === 'away' ? toward + Math.PI : toward,
              q = ground(S, x, z, o, yaw + (R() - 0.5) * 0.6, sized(o, R));
            if (q && spaced(out, q, every * 0.45)) out.push(q);
          }
      }
      return out;
    },
    wallBase(S, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 13),
        reach = o.reach === undefined ? 0.18 : o.reach,
        every = o.every || 0.28,
        skip = o.skip === undefined ? 0.35 : o.skip,
        corners = o.corners === undefined ? 2 : o.corners,
        segs = [];
      if (o.box) {
        const [cx, cz, hx, hz] = o.box,
          c = Math.cos(o.yaw || 0),
          s = Math.sin(o.yaw || 0),
          P = (x, z) => [cx + x * c - z * s, cz + x * s + z * c],
          C = [P(hx, -hz), P(hx, hz), P(-hx, hz), P(-hx, -hz)];
        // (each side from one corner to the next, so its outward side is to the right as it is walked)
        for (let k = 0; k < 4; k++) if (!o.sides || o.sides.includes(k)) segs.push([...C[k], ...C[(k + 1) % 4]]);
      } else for (const w of o.walls || []) segs.push(w);
      const out = [];
      for (const [x0, z0, x1, z1] of segs) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 1e-6) continue;
        const tx = (x1 - x0) / len,
          tz = (z1 - z0) / len,
          nx = tz,
          nz = -tx; // (out from the wall: the right of the way it is walked)
        const tryAt = (d, r) => {
          const x = x0 + tx * d + nx * r,
            z = z0 + tz * d + nz * r,
            q = ground(S, x, z, o, Math.atan2(nx, nz) + (R() - 0.5) * 0.7, sized(o, R));
          if (!q || S.sdf(q.p[0], q.p[1] + 0.05, q.p[2]) < 0.01) return; // (not inside the wall, or under something)
          if (spaced(out, q, every * 0.4)) out.push(q);
        };
        for (let d = R() * every * 0.5; d < len; d += every * (0.7 + R() * 0.6))
          if (R() >= skip) tryAt(d, reach * (0.35 + 0.65 * R()));
        // (a few more where two walls meet: things gather in corners)
        for (let k = 0; k < corners; k++) {
          tryAt(R() * every * 0.8, reach * (0.3 + 0.7 * R()));
          tryAt(len - R() * every * 0.8, reach * (0.3 + 0.7 * R()));
        }
      }
      return out;
    },
    around(S, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 17),
        ats = Array.isArray(o.at[0]) ? o.at : [o.at],
        out = [];
      for (const [cx, cz] of ats) {
        const n = o.n || 6,
          a0 = o.arc ? o.arc[0] : 0,
          a1 = o.arc ? o.arc[1] : TAU;
        for (let i = 0; i < n * 2 && out.filter(q => q.of === cx + ',' + cz).length < n; i++) {
          const a = a0 + ((i + R() * 0.8) / (n * 2)) * (a1 - a0) * 2,
            r = (o.r || 0.2) + (o.reach === undefined ? 0.15 : o.reach) * R() * R(),
            x = cx + Math.cos(a) * r,
            z = cz + Math.sin(a) * r,
            q = ground(S, x, z, o, Math.atan2(Math.cos(a), Math.sin(a)) + (R() - 0.5) * 0.6, sized(o, R));
          if (!q || S.sdf(q.p[0], q.p[1] + 0.04, q.p[2]) < 0.01) continue;
          if (spaced(out, q, (o.gap === undefined ? 0.07 : o.gap) * q.s))
            out.push(Object.assign(q, { of: cx + ',' + cz }));
        }
      }
      return out;
    },
    clutter(S, lib, M, rules) {
      let done = [];
      for (const r of rules) {
        // (`where` names the finder here; an area's own where(x, z), how likely a thing is there, is given as `chance`)
        const fo = Object.assign({}, r, { where: r.chance });
        const places =
          r.where === 'along'
            ? K.props.along(S, r.path, fo)
            : r.where === 'wall'
              ? K.props.wallBase(S, fo)
              : r.where === 'around'
                ? K.props.around(S, fo)
                : K.props.area(S, fo);
        done = done.concat(K.props.assign(S, lib, places, M, { weights: r.weights, seed: r.seed }));
      }
      return done;
    }
  };

  // ---- the starter library. Every size is in screen pixels (q.at's unit), so the things are the same size on screen in any diorama
  const res = (q, k) => q.px * (k || 0.7);
  const mushroom = (S, q, M, h, x, z, lean) => {
    S.tube([q.at(x, 0, z), q.at(x + lean, h, z)], q.unit * 0.8, q.unit * 0.7, M.stem, { res: res(q, 0.6) });
    const c = q.at(x + lean, h, z);
    S.ball(c, [q.unit * h * 0.5, q.unit * h * 0.26, q.unit * h * 0.5], M.cap, { res: res(q, 0.6) });
  };
  K.props.starter = K.props.library('starter', {
    pebble: {
      needs: ['stone'],
      weight: 3,
      size: [0.7, 1.3],
      make: (S, q, M, v) =>
        S.facet({
          at: q.at(0, 0.6, 0),
          size: [2.4 * q.unit, 1.4 * q.unit, 2 * q.unit],
          faces: 6,
          seed: Math.floor(v.rnd() * 999),
          mat: M.stone,
          tilt: 0.15,
          edge: 0,
          res: res(q)
        })
    },
    stones: {
      needs: ['stone'],
      weight: 2,
      make: (S, q, M, v) => {
        for (let i = 0, n = 2 + Math.floor(v.rnd() * 2); i < n; i++) {
          const a = v.rnd() * TAU,
            r = i ? 3 + v.rnd() * 2 : 0,
            k = i ? 0.7 : 1.1;
          S.facet({
            at: q.at(Math.cos(a) * r, 0.8 * k, Math.sin(a) * r),
            size: [3 * k * q.unit, 2 * k * q.unit, 2.6 * k * q.unit],
            faces: 7,
            seed: Math.floor(v.rnd() * 999),
            mat: M.stone,
            top: M.moss,
            tilt: 0.2,
            edge: 1,
            res: res(q)
          });
        }
      }
    },
    mushroom: {
      needs: ['stem', 'cap'],
      weight: 1.5,
      vary: { h: [4, 6], lean: [-0.6, 0.6] },
      make: (S, q, M, v) => mushroom(S, q, M, v.h, 0, 0, v.lean)
    },
    mushrooms: {
      needs: ['stem', 'cap'],
      weight: 1,
      make: (S, q, M, v) => {
        for (let i = 0, n = 2 + Math.floor(v.rnd() * 2); i < n; i++) {
          const a = v.rnd() * TAU,
            r = i ? 2.5 + v.rnd() * 1.5 : 0;
          mushroom(
            S,
            q,
            M,
            i ? 3 + v.rnd() * 1.5 : 5 + v.rnd(),
            Math.cos(a) * r,
            Math.sin(a) * r,
            (v.rnd() - 0.5) * 0.8
          );
        }
      }
    },
    tuft: {
      needs: ['leaf'],
      weight: 3,
      size: [0.8, 1.3],
      make: (S, q, M, v) =>
        S.canopy({
          at: q.at(0, 1.6, 0),
          size: [2.6 * q.unit, 2.2 * q.unit, 2.6 * q.unit],
          lobes: 2,
          mat: M.leaf,
          cluster: 3,
          bump: 1,
          seed: Math.floor(v.rnd() * 999)
        })
    },
    flowers: {
      needs: ['leaf', 'bloom'],
      weight: 2,
      make: (S, q, M, v) => {
        S.canopy({
          at: q.at(0, 1.6, 0),
          size: [3 * q.unit, 2.2 * q.unit, 3 * q.unit],
          lobes: 2,
          mat: M.leaf,
          cluster: 3,
          bump: 1,
          seed: Math.floor(v.rnd() * 999)
        });
        S.canopy({
          at: q.at(0.6, 3.6, 0.4),
          size: [1.8 * q.unit, 1.1 * q.unit, 1.8 * q.unit],
          lobes: 2,
          mat: M.bloom,
          cluster: 2,
          bump: 1,
          seed: Math.floor(v.rnd() * 999)
        });
      }
    },
    twig: {
      needs: ['wood'],
      weight: 1,
      vary: { len: [6, 10] },
      make: (S, q, M, v) => {
        const a = q.at(-v.len / 2, 0.6, 0),
          b = q.at(v.len / 2, 0.6, (v.rnd() - 0.5) * 2);
        S.tube([a, b], q.unit * 0.6, q.unit * 0.5, M.wood, { res: res(q, 0.5) });
        S.tube([q.at(v.len * 0.1, 0.6, 0), q.at(v.len * 0.3, 0.6, 2.5)], q.unit * 0.5, q.unit * 0.45, M.wood, {
          res: res(q, 0.5)
        });
      }
    },
    litter: {
      needs: ['litter'],
      weight: 1.5,
      vary: { w: [5, 8] },
      make: (S, q, M, v) => {
        for (let i = 0; i < 3; i++) {
          const a = v.rnd() * TAU,
            r = i ? v.rnd() * v.w * 0.5 : 0;
          S.ball(
            q.at(Math.cos(a) * r, 0.2, Math.sin(a) * r),
            [v.w * 0.45 * q.unit, 0.7 * q.unit, v.w * 0.35 * q.unit],
            M.litter,
            { res: res(q, 0.6) }
          );
        }
      }
    },
    log: {
      needs: ['bark'],
      weight: 0.6,
      vary: { len: [12, 18], r: [2.2, 3] },
      make: (S, q, M, v) => {
        S.tube(
          [q.at(-v.len / 2, v.r * 0.85, 0), q.at(v.len / 2, v.r * 0.8, 0)],
          v.r * q.unit,
          v.r * 0.92 * q.unit,
          M.bark,
          { res: res(q) }
        );
        if (M.wood)
          S.tube(
            [q.at(v.len / 2, v.r * 0.8, 0), q.at(v.len / 2 + 0.4, v.r * 0.8, 0)],
            v.r * 0.85 * q.unit,
            v.r * 0.85 * q.unit,
            M.wood,
            { res: res(q, 0.6) }
          );
        if (M.moss)
          S.ball(q.at(-v.len * 0.15, v.r * 1.7, 0), [v.len * 0.22 * q.unit, 0.9 * q.unit, v.r * 0.8 * q.unit], M.moss, {
            res: res(q, 0.6)
          });
      }
    },
    stump: {
      needs: ['bark'],
      weight: 0.5,
      vary: { h: [4, 7], r: [3, 4.5] },
      make: (S, q, M, v) => {
        S.lathe(q.at(0, 0, 0), v.h * q.unit, t => v.r * q.unit * (1.15 - 0.15 * t), M.bark, { res: res(q) });
        if (M.wood)
          S.lathe(q.at(0, v.h - 0.4, 0), 0.6 * q.unit, () => v.r * 0.88 * q.unit, M.wood, { res: res(q, 0.6) });
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * TAU + v.rnd();
          S.tube(
            [
              q.at(Math.cos(a) * v.r * 0.7, 1.2, Math.sin(a) * v.r * 0.7),
              q.at(Math.cos(a) * (v.r + 2.5), 0, Math.sin(a) * (v.r + 2.5))
            ],
            q.unit * 1.1,
            q.unit * 0.6,
            M.bark,
            { res: res(q, 0.6) }
          );
        }
      }
    },
    bucket: {
      needs: ['wood', 'iron'],
      weight: 0.4,
      make: (S, q, M) => S.barrel({ at: q.at(0, 0, 0), h: 5 * q.unit, r: 2.6 * q.unit, mat: M.wood, hoop: M.iron })
    },
    crate: {
      needs: ['wood'],
      weight: 0.4,
      vary: { k: [0.8, 1.2] },
      make: (S, q, M, v) =>
        S.crate({
          at: q.at(0, 0, 0),
          size: [4.5 * v.k * q.unit, 4 * v.k * q.unit, 4.5 * v.k * q.unit],
          mat: M.planks || M.wood,
          edge: M.wood
        })
    },
    sack: {
      needs: ['cloth'],
      weight: 0.4,
      make: (S, q, M) => {
        S.ball(q.at(0, 2.4, 0), [3 * q.unit, 2.8 * q.unit, 2.6 * q.unit], M.cloth, { res: res(q, 0.6) });
        S.tube([q.at(0, 4.6, 0), q.at(0.2, 6, 0)], q.unit * 0.9, q.unit * 1.2, M.cloth, { res: res(q, 0.5) });
      }
    },
    pot: {
      needs: ['clay'],
      weight: 0.4,
      make: (S, q, M) =>
        S.lathe(
          q.at(0, 0, 0),
          5 * q.unit,
          t => q.unit * (2 + 1.3 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - (t > 0.85 ? 0.4 : 0)),
          M.clay,
          { res: res(q, 0.6), maxRadius: 3.3 * q.unit }
        )
    }
  });
})(KIT);
