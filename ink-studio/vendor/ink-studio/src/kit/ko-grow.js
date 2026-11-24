/* ko-grow: growers. Rules that make a thing, so that one description gives as many different individuals as are asked for.
   None of it draws by itself: each gives back places, paths or frames, or adds ordinary solids, and the diorama decides what stands there.
   Everything is worked out from a seed, and none of it touches the builder's own dice, so adding a grower does not move anything else.

   K.grow.scatter(S, o)     places on what has been sculpted so far, chosen by what the ground is like there
        o: { disc: [cx, cz, r] | box: [x0, x1, z0, z1], top: where to look down from (12), n: how many to try for (60), gap: least distance
             between two (0.5), slope: [least, most] of how level (ny: 0.8, 1), height: [y0, y1], shade: [lo, hi] (0 in shadow, 1 in the
             sun), where(x, z) -> 0..1 how likely, size: [lo, hi], seed }
        -> [{ p: [x, y, z], n: [nx, ny, nz], s: size, yaw, sun: 0..1 }]
   K.grow.branch(o)         a branching thing that leans to the light and turns aside from what is in its way
        o: { at, dir ([0, 1, 0]), len (2.2), r (0.16), depth (3), forks (2), spread (0.65 radians), shrink (0.68), segs (5), light: way
             the light comes from (it bends that way by `lean`, 0.3), droop (0.08: how much the thin ends sag), wobble (0.25),
             sdf + margin: a field to keep clear of, seed }
        -> { limbs: [{ pts, r0, r1, depth }], tips: [{ p, dir, r }] }           K.grow.limbs(S, grown, mat, o) adds the limbs as tubes
   K.grow.arrange(kind, n, o)   where the parts of a flower, a cap or a cone sit, in the thing's own space (y up, middle at 0)
        'spiral'   n parts on the golden angle, out to o.r, the surface domed by o.dome (0 flat, 1 a half ball)
        'whorl'    o.rings rings of o.per parts, each ring o.rise higher, o.twist (in turns) round from the last, at radius o.r
        'rosette'  rings of petals, the inner ones smaller and more upright: o.rings, o.per, o.r, o.open (0 shut .. 1 flat)
        -> [{ p, dir (the way the part points), up, s (its size, 1 the largest), t (0 at the middle or bottom, 1 at the rim or top) }]
        K.grow.put(frame, at, yaw, scale) carries one of these out into the scene
   K.grow.rock(S, c, r, mat, o)   a rock that has broken and weathered: a lump cut by flat faces, laid in beds, its edges worn
        o: { facets (7), chip (0.3: how deep the cuts go), beds: { n: how many to the rock's height, depth, tilt: [x, z], groove (0.6: how deep the trough between two beds is) },
             worn (0.12: how round the edges are), squash: [x, y, z], seed, res, settle (dropped onto what is there), flat (a
             flat underside, 0.55 of r when settled), bury (sunk into what it rests on, 0.2 of its height) }
   K.grow.species(def)      def: { name, seed, vary: { name: [lo, hi] ... }, limits: { name: [min, max] }, make(S, at, v, k) }.
        -> { grow(S, at, k), sow(S, places, { instances }) }. Every individual gets its own draw of the numbers in vary (from where it
        stands, so it is the same one each time). A named species shows its ranges as dials (K.grow.seen; K.grow.over holds what they
        are turned to, as { 'name.key': [lo, hi], 'name.share': 0..1 }). sow with instances: n bakes n individuals once and places
        copies of them (S.template / S.place), each turned, sized and leaned to the ground; with sway they sway from the foot;
        with solid: false they are drawn but not put into the field (small things: much cheaper, no shadow of their own).

   Growth that runs in steps, applying a rule over and over:
   K.grow.settle(S, sd, at, o)   where a shape comes to rest if it is dropped from `at` onto what has been sculpted: it falls till it
        touches, and leans to the ground under it (o.lean, 0..1). sd(x, y, z) its distance in its own space; o.pts: points on it (or
        o.r for a ball's worth). -> { at, up }. K.grow.rock(.., { settle: true }) does this for a rock.
   K.grow.creep(S, o)       a creeper crawling over the surface: o: { from, dir (the way it wants to go), steps, step, hug, wander,
        branch (chance a step forks), on (a solid, or a distance function, to hold to: a creeper on one rock), stop(p), seed }. -> { paths: [[p...]], nodes: [{ p, n, dir, t }] }
        K.grow.vine(S, grown, stem, leaf, o) puts a stem along each path and a leaf at the nodes. o.grow: seconds a step, and it grows
        as you watch, in the order it was grown (every path keeps .start, every node .k, the step it was made on)
   K.grow.spread(S, o)      a patch that spreads over the surface from where it starts, a step at a time, only where ok(A) lets it
        (lichen, moss, frost, rust): o: { from: [p...], steps, gap, ok(x, y, z, n), seed }. -> { pts, has(x, y, z, r) (a mask for S.cover),
        when(x, y, z) (the step it got there: a cover's material born: (x, y, z) => grown.when(x, y, z) * seconds, and it spreads as you watch) }
   K.grow.scatterIn(S, sd, o)  points inside a shape (o.n, o.gap, o.box): bubbles in ice, seeds in a pod, stars in a jar
   K.grow.ray(S, from, dir, far)  where a line first meets what has been sculpted: { p, n, d } or null */
(function (K) {
  const TAU = 6.283185307179586,
    GA = 2.399963229728653;
  const dice = seed => {
    let a = seed >>> 0 || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const grad = (sdf, x, y, z) => {
    const e = 0.02;
    return norm([
      sdf(x + e, y, z) - sdf(x - e, y, z),
      sdf(x, y + e, z) - sdf(x, y - e, z),
      sdf(x, y, z + e) - sdf(x, y, z - e)
    ]);
  };
  K.grow = {
    dice,
    scatter(S, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 7),
        out = [],
        want = o.n || 60,
        gap = o.gap === undefined ? 0.5 : o.gap,
        top = o.top === undefined ? 12 : o.top,
        slope = o.slope || [0.8, 1],
        size = o.size || [1, 1],
        sun = S.sun;
      for (let tries = 0; tries < want * 12 && out.length < want; tries++) {
        let x, z;
        if (o.box) {
          x = o.box[0] + R() * (o.box[1] - o.box[0]);
          z = o.box[2] + R() * (o.box[3] - o.box[2]);
        } else {
          const d = o.disc || [0, 0, 6],
            rr = Math.sqrt(R()) * d[2],
            a = R() * TAU;
          x = d[0] + Math.cos(a) * rr;
          z = d[1] + Math.sin(a) * rr;
        }
        const keep = R(),
          sz = R(),
          yw = R();
        if (o.where && keep > o.where(x, z)) continue;
        const y = S.heightAt(x, z, top, o.depth || 30);
        if (y > 1e8 || y < -1e8) continue;
        if (o.height && (y < o.height[0] || y > o.height[1])) continue;
        const n = grad(S.sdf, x, y, z);
        if (n[1] < slope[0] || n[1] > slope[1]) continue;
        // how open the place is to the sun
        let lit = 1,
          t = 0.1;
        for (let k = 0; k < 24 && t < 10; k++) {
          const h = S.sdf(x + n[0] * 0.06 + sun[0] * t, y + n[1] * 0.06 + sun[1] * t, z + n[2] * 0.06 + sun[2] * t);
          if (h < 0.01) {
            lit = 0;
            break;
          }
          if (h < 0.9) lit = Math.min(lit, (6 * h) / t); // (far from everything the field only says 'far', which is no shade)
          t += Math.max(0.08, h);
        }
        if (o.shade && (lit < o.shade[0] || lit > o.shade[1])) continue;
        let ok = true;
        for (const q of out)
          if (Math.hypot(q.p[0] - x, q.p[2] - z) < gap * (0.5 + 0.5 * (q.s + 1) * 0.5)) {
            ok = false;
            break;
          }
        if (!ok) continue;
        out.push({ p: [x, y, z], n, s: size[0] + sz * (size[1] - size[0]), yaw: yw * TAU, sun: lit });
      }
      return out;
    },
    branch(o) {
      o = o || {};
      const R = dice(o.seed || 11),
        limbs = [],
        tips = [],
        segs = o.segs || 5,
        forks = o.forks || 2,
        spread = o.spread === undefined ? 0.65 : o.spread,
        shrink = o.shrink === undefined ? 0.68 : o.shrink,
        lean = o.lean === undefined ? 0.3 : o.lean,
        droop = o.droop === undefined ? 0.08 : o.droop,
        wob = o.wobble === undefined ? 0.25 : o.wobble,
        light = norm(o.light || [0, 1, 0]),
        maxD = o.depth === undefined ? 3 : o.depth,
        margin = o.margin || 0.35;
      const go = (p, d, len, r, depth) => {
        const pts = [p.slice()],
          step = len / segs,
          thin = depth / Math.max(1, maxD);
        let q = p.slice(),
          dir = norm(d);
        for (let i = 0; i < segs; i++) {
          let ax = dir[0] + light[0] * lean * 0.35 + (R() - 0.5) * wob * 0.5,
            ay = dir[1] + light[1] * lean * 0.35 + (R() - 0.5) * wob * 0.5 - droop * thin * 0.6,
            az = dir[2] + light[2] * lean * 0.35 + (R() - 0.5) * wob * 0.5;
          if (o.sdf) {
            // something in the way ahead: turn along it
            const h = o.sdf(q[0] + dir[0] * step, q[1] + dir[1] * step, q[2] + dir[2] * step);
            if (h < margin) {
              const g = grad(o.sdf, q[0] + dir[0] * step, q[1] + dir[1] * step, q[2] + dir[2] * step),
                k = (1 - Math.max(0, h) / margin) * 1.4;
              ax += g[0] * k;
              ay += g[1] * k;
              az += g[2] * k;
            }
          }
          dir = norm([ax, ay, az]);
          q = [q[0] + dir[0] * step, q[1] + dir[1] * step, q[2] + dir[2] * step];
          pts.push(q.slice());
        }
        const r1 = r * (depth === maxD ? 0.35 : shrink);
        limbs.push({ pts, r0: r, r1, depth });
        if (depth >= maxD) {
          tips.push({ p: q, dir, r: r1 });
          return;
        }
        // the forks stand round the limb they come from, each turned out from it
        const side = norm(cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
          fwd = cross(dir, side),
          a0 = R() * TAU,
          nf = forks + (R() < (o.extra || 0.25) ? 1 : 0);
        for (let f = 0; f < nf; f++) {
          const a = a0 + (f / nf) * TAU + (R() - 0.5) * 0.6,
            sp = spread * (0.75 + 0.5 * R()),
            c = Math.cos(sp),
            s = Math.sin(sp),
            nd = [
              dir[0] * c + (side[0] * Math.cos(a) + fwd[0] * Math.sin(a)) * s,
              dir[1] * c + (side[1] * Math.cos(a) + fwd[1] * Math.sin(a)) * s,
              dir[2] * c + (side[2] * Math.cos(a) + fwd[2] * Math.sin(a)) * s
            ];
          go(q, nd, len * shrink * (0.85 + 0.3 * R()), r1, depth + 1);
        }
      };
      go(o.at || [0, 0, 0], o.dir || [0, 1, 0], o.len || 2.2, o.r || 0.16, 0);
      return { limbs, tips };
    },
    limbs(S, grown, mat, o) {
      o = o || {};
      const G = Object.assign(S.grp(o.melt === undefined ? 0.08 : o.melt), o);
      for (const L of grown.limbs) S.tube(L.pts, L.r0, L.r1, mat, G);
    },
    arrange(kind, n, o) {
      o = o || {};
      const out = [],
        r = o.r === undefined ? 1 : o.r;
      if (kind === 'spiral') {
        const dome = o.dome || 0;
        for (let i = 0; i < n; i++) {
          const t = Math.sqrt((i + 0.5) / n),
            a = i * GA,
            ph = t * dome * (Math.PI / 2),
            rad = dome > 0 ? (r * Math.sin(ph)) / Math.sin(dome * (Math.PI / 2)) : r * t,
            y = dome > 0 ? (r * (Math.cos(ph) - Math.cos(dome * (Math.PI / 2)))) / Math.sin(dome * (Math.PI / 2)) : 0,
            dir = norm([
              Math.cos(a) * Math.sin(ph + (o.tilt || 0)),
              Math.cos(ph + (o.tilt || 0)),
              Math.sin(a) * Math.sin(ph + (o.tilt || 0))
            ]);
          out.push({ p: [Math.cos(a) * rad, y, Math.sin(a) * rad], dir, up: [0, 1, 0], s: 1 - 0.35 * t, t });
        }
      } else if (kind === 'whorl') {
        const rings = o.rings || 3,
          per = o.per || Math.max(1, Math.round(n / rings)),
          rise = o.rise === undefined ? 0.3 : o.rise,
          twist = o.twist === undefined ? 0.5 / per : o.twist;
        for (let k = 0; k < rings; k++)
          for (let j = 0; j < per; j++) {
            const a = ((j + k * twist * per) / per) * TAU,
              t = rings === 1 ? 0 : k / (rings - 1),
              rk = r * (1 - (o.taper || 0) * t),
              up = o.lift === undefined ? 0.25 : o.lift;
            out.push({
              p: [Math.cos(a) * rk * 0.1, k * rise, Math.sin(a) * rk * 0.1],
              dir: norm([Math.cos(a), up + t * (o.close || 0), Math.sin(a)]),
              up: [0, 1, 0],
              s: (1 - (o.taper || 0) * t) * rk,
              t
            });
          }
      } else if (kind === 'rosette') {
        const rings = o.rings || 3,
          per = o.per || 6,
          open = o.open === undefined ? 0.7 : o.open;
        for (let k = 0; k < rings; k++)
          for (let j = 0; j < per; j++) {
            const t = rings === 1 ? 1 : k / (rings - 1), // 0 the innermost ring
              a = ((j + (k % 2) * 0.5) / per) * TAU,
              el = (1 - open * (0.35 + 0.65 * t)) * (Math.PI / 2), // how upright: the inner ones stand, the outer ones lie open
              s = 0.45 + 0.55 * t;
            out.push({
              p: [Math.cos(a) * r * 0.12 * t, 0.04 * (1 - t), Math.sin(a) * r * 0.12 * t],
              dir: norm([Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)]),
              up: [0, 1, 0],
              s: s * r,
              t
            });
          }
      } else throw new Error('K.grow.arrange: no arrangement called ' + kind + ' (spiral, whorl, rosette)');
      return out;
    },
    put(fr, at, yaw, scale) {
      const c = Math.cos(yaw || 0),
        s = Math.sin(yaw || 0),
        k = scale === undefined ? 1 : scale,
        tr = v => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
      const p = tr(fr.p);
      return {
        p: [at[0] + p[0] * k, at[1] + p[1] * k, at[2] + p[2] * k],
        dir: tr(fr.dir),
        up: fr.up,
        s: fr.s * k,
        t: fr.t
      };
    },
    rock(S, c, r, mat, o) {
      o = o || {};
      const R = dice(o.seed || 5),
        sq = o.squash || [1, 1, 1],
        chip = o.chip === undefined ? 0.3 : o.chip,
        worn = (o.worn === undefined ? 0.12 : o.worn) * r,
        nf = o.facets === undefined ? 7 : o.facets,
        // a flat face underneath, as a stone lies (o.flat: how far down it is cut, as part of r; 0 for none)
        flat = o.flat === undefined ? (o.settle ? 0.55 : 0) : o.flat,
        planes = [];
      for (let i = 0; i < nf; i++) {
        const y = R() * 1.5 - 0.5, // faces are cut on the top and sides more than underneath
          a = R() * TAU,
          q = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y)));
        planes.push([q * Math.cos(a), Math.min(1, y), q * Math.sin(a), r * (1 - chip * (0.25 + 0.75 * R()))]);
      }
      const beds = o.beds,
        bn = beds ? norm([beds.tilt ? beds.tilt[0] : 0.12, 1, beds.tilt ? beds.tilt[1] : 0.05]) : null,
        bth = beds ? (2 * r * sq[1]) / (beds.n || 5) : 1,
        bd = beds ? (beds.depth === undefined ? 0.06 * r : beds.depth) : 0,
        inset = [];
      for (let i = 0; i < 40; i++) inset.push(R());
      const smax = (a, b, k) => {
        if (k <= 0) return Math.max(a, b);
        const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (a - b)) / k));
        return b + (a - b) * h + k * h * (1 - h);
      };
      const sd = (x, y, z) => {
        const px = x / sq[0],
          py = y / sq[1],
          pz = z / sq[2];
        let d = Math.hypot(px, py, pz) - r;
        for (let i = 0; i < nf; i++) {
          const pl = planes[i];
          d = smax(d, px * pl[0] + py * pl[1] + pz * pl[2] - pl[3], worn);
        }
        if (flat) d = smax(d, -py - flat * r, worn);
        d *= Math.min(sq[0], sq[1], sq[2]);
        if (beds) {
          // laid in beds: each bed stands in or out a little from the next, and there is a groove where two meet
          const u = (x * bn[0] + y * bn[1] + z * bn[2]) / bth + 20,
            k = Math.floor(u),
            f = u - k,
            edge = Math.min(f, 1 - f),
            a0 = inset[((k % 40) + 40) % 40],
            a1 = inset[(((k + 1) % 40) + 40) % 40],
            t = Math.max(0, Math.min(1, (f - 0.8) / 0.2)),
            // (the step from one bed to the next is a slope, not a jump: a jump in the field is a face nothing lands on)
            iv = a0 + (a1 - a0) * t * t * (3 - 2 * t),
            // the groove between two beds: a rounded trough, not a V. At the bottom of a V the surface turns over all at once, and the
            // dabs either side of it lean apart and leave a slit; a trough turns smoothly, flat at its bottom and at its rims
            gq = edge < 0.2 ? 1 - (edge / 0.2) * (edge / 0.2) : 0,
            gv = gq * gq;
          d += bd * (0.7 * iv + (beds.groove === undefined ? 0.6 : beds.groove) * gv);
        }
        return d;
      };
      const big = Math.max(sq[0], sq[1], sq[2]);
      if (o.settle) {
        // dropped from where it was put, onto what is there, and leaned to it
        const rest = K.grow.settle(S, sd, c, {
          r: r * big,
          lean: o.lean === undefined ? 0.6 : o.lean,
          sink: o.sink === undefined ? r * 0.06 : o.sink
        });
        c = rest.at;
        // and sunk into what it rests on (o.bury: as part of its height), as stones are: nothing shows under them
        c[1] -= (o.bury === undefined ? 0.2 : o.bury) * r * sq[1];
        const u = rest.up,
          t1 = norm([u[1], -u[0], 0]),
          t2 = cross(u, t1);
        if (Math.abs(u[1]) < 0.9999) o = Object.assign({}, o, { ax: [t1, u, t2] });
      }
      return S.solid(
        c,
        r * big,
        sd,
        (res, f) => {
          /* points on the ball round it, which are taken in onto its faces; and, when it has beds, on two balls inside it too, taken
             out onto whatever face is nearest from within: the risers of the steps, which nothing from outside reaches */
          const shells = beds
            ? [
                [1, 1.5],
                [1 - chip * 0.45, 0.5],
                [1 - chip * 0.8, 0.4]
              ]
            : [[1, 1.5]];
          for (const [k, dens] of shells) {
            const n = Math.ceil((dens * 4 * Math.PI * r * r * k * k * big * big) / (res * res)),
              tw = k * 1.7;
            for (let i = 0; i < n; i++) {
              const y = 1 - (2 * (i + 0.5)) / n,
                q = Math.sqrt(Math.max(0, 1 - y * y)),
                a = i * GA + tw;
              f(q * Math.cos(a) * r * k * sq[0], y * r * k * sq[1], q * Math.sin(a) * r * k * sq[2]);
            }
          }
        },
        mat,
        Object.assign({ reach: r * big * chip + bd * 2 + worn }, o)
      );
    },
    seen: [],
    over: {},
    species(def) {
      const name = def.name,
        rng = k => (name && K.grow.over[name + '.' + k]) || def.vary[k];
      if (name && !K.grow.seen.some(q => q.name === name))
        K.grow.seen.push({ name, vary: Object.assign({}, def.vary), limits: def.limits || {}, share: 1 });
      const draw = at => {
        const R = dice(
            (def.seed || 1) * 7919 +
              Math.round(at[0] * 97) * 31 +
              Math.round(at[2] * 89) * 17 +
              Math.round((at[1] || 0) * 13)
          ),
          v = { rnd: R };
        for (const k in def.vary || {}) {
          const r = rng(k);
          v[k] = r[0] + R() * (r[1] - r[0]);
        }
        return v;
      };
      const share = () => (name && K.grow.over[name + '.share'] !== undefined ? K.grow.over[name + '.share'] : 1);
      const keep = q => dice(Math.round(q.p[0] * 131) * 7 + Math.round(q.p[2] * 137) * 13 + 5)() < share();
      return {
        draw,
        grow: (S, at, k, extra) => def.make(S, at, draw(at), k === undefined ? 1 : k, extra),
        sow(S, places, o) {
          o = o || {};
          places = places.filter(keep);
          if (!o.instances) {
            for (const q of places) def.make(S, q.p, draw(q.p), q.s, q);
            return places.length;
          }
          // a few individuals, each baked once, and copies of them
          const tpls = [];
          for (let k = 0; k < o.instances; k++) {
            const at = [k * 3.7 + 0.5, 0, k * 1.3 + 0.25];
            tpls.push(S.template(S2 => def.make(S2, [0, 0, 0], draw(at), 1, null), { res: o.res }));
          }
          for (const q of places) {
            const R = dice(Math.round(q.p[0] * 977) + Math.round(q.p[2] * 557) * 3 + 11);
            S.place(tpls[Math.floor(R() * tpls.length)], q.p, {
              yaw: q.yaw,
              scale: q.s,
              up: q.n,
              lean: o.lean === undefined ? 0.5 : o.lean,
              sway: o.sway,
              solid: o.solid
            });
          }
          return places.length;
        }
      };
    },
    settle(S, sd, at, o) {
      o = o || {};
      S.ready();
      // points on the shape's own surface, to feel for the ground with
      let pts = o.pts;
      if (!pts) {
        pts = [];
        const r = o.r || 1;
        for (let i = 0; i < 260; i++) {
          const y = 1 - (2 * (i + 0.5)) / 260,
            q = Math.sqrt(1 - y * y),
            a = i * GA;
          let p = [q * Math.cos(a) * r * 1.6, y * r * 1.6, q * Math.sin(a) * r * 1.6];
          for (let it = 0; it < 40; it++) {
            const d = sd(p[0], p[1], p[2]);
            if (Math.abs(d) < 1e-3) break;
            const g = grad(sd, p[0], p[1], p[2]);
            p = [p[0] - g[0] * d * 0.9, p[1] - g[1] * d * 0.9, p[2] - g[2] * d * 0.9];
          }
          if (p[1] < r * 0.2) pts.push(p); // only what is low down can touch
        }
      }
      const c = at.slice(),
        gap = () => {
          let g = 9;
          for (const p of pts) g = Math.min(g, S.sdf(c[0] + p[0], c[1] + p[1], c[2] + p[2]));
          return g;
        };
      // where it touches, and which way the thing it touches faces there
      const contact = () => {
        let g = 9,
          bp = null;
        for (const p of pts) {
          const d = S.sdf(c[0] + p[0], c[1] + p[1], c[2] + p[2]);
          if (d < g) ((g = d), (bp = p));
        }
        return bp ? grad(S.sdf, c[0] + bp[0], c[1] + bp[1] - 0.02, c[2] + bp[2]) : [0, 1, 0];
      };
      let slides = 0;
      for (let it = 0; it < 600; it++) {
        const g = gap();
        if (g < 0.01) {
          // touching. If what it touches faces up it rests there; if it is only the side of something (a stone beside it), it
          // slides off that way and goes on falling, as a stone does, instead of hanging there in the air
          const n = contact();
          if (n[1] > 0.7 || slides > 160) break;
          const h = Math.hypot(n[0], n[2]) || 1;
          c[0] += (n[0] / h) * 0.04;
          c[2] += (n[2] / h) * 0.04;
          c[1] += 0.004;
          slides++;
          continue;
        }
        c[1] -= Math.max(0.005, g * 0.9);
        if (c[1] < at[1] - (o.fall || 40)) break;
      }
      c[1] -= o.sink === undefined ? 0.03 : o.sink;
      // which way the ground under it faces, for leaning it
      let up = [0, 1, 0];
      if (o.lean) {
        const fr = o.r || 1,
          ns = [0, 0, 0];
        for (const [dx, dz] of [
          [0, 0],
          [fr * 0.6, 0],
          [-fr * 0.6, 0],
          [0, fr * 0.6],
          [0, -fr * 0.6]
        ]) {
          const y = S.heightAt(c[0] + dx, c[2] + dz, c[1] + 0.2, fr * 3);
          if (y > 1e8 || y < -1e8) continue;
          const g = grad(S.sdf, c[0] + dx, y, c[2] + dz);
          ns[0] += g[0];
          ns[1] += g[1];
          ns[2] += g[2];
        }
        up = norm([ns[0] * o.lean, 1 + (norm(ns)[1] - 1) * o.lean, ns[2] * o.lean]);
      }
      return { at: c, up };
    },
    creep(S, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 19),
        paths = [],
        nodes = [],
        hug = o.hug === undefined ? 0.04 : o.hug,
        step = o.step || 0.1,
        want = norm(o.dir || [0, 1, 0]),
        wander = o.wander === undefined ? 0.45 : o.wander,
        // the surface it holds to: o.on (one solid, or any distance function) or everything sculpted
        sdf = o.on ? (o.on.sd ? (x, y, z) => o.on.sd(x, y, z) : o.on) : S.sdf;
      const onto = p => {
        for (let k = 0; k < 6; k++) {
          const d = sdf(p[0], p[1], p[2]) - hug;
          if (Math.abs(d) < 0.003) break;
          const g = grad(sdf, p[0], p[1], p[2]);
          p = [p[0] - g[0] * d, p[1] - g[1] * d, p[2] - g[2] * d];
        }
        return p;
      };
      const walk = (p, head, steps, depth, s0) => {
        const path = [p.slice()];
        path.start = s0; // the step it set out on (a branch starts where it forks)
        for (let i = 0; i < steps; i++) {
          const n = grad(sdf, p[0], p[1], p[2]),
            // the way it wants to go and the way it was going, laid flat on the surface, and a wander
            mix = [
              head[0] * 0.7 + want[0] * 0.3 + (R() - 0.5) * wander,
              head[1] * 0.7 + want[1] * 0.3 + (R() - 0.5) * wander,
              head[2] * 0.7 + want[2] * 0.3 + (R() - 0.5) * wander
            ],
            dn = mix[0] * n[0] + mix[1] * n[1] + mix[2] * n[2];
          head = norm([mix[0] - n[0] * dn, mix[1] - n[1] * dn, mix[2] - n[2] * dn]);
          const q = onto([p[0] + head[0] * step, p[1] + head[1] * step, p[2] + head[2] * step]);
          if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > step * 2.5) break; // it fell off into nothing
          if (o.on && S.sdf(q[0], q[1], q[2]) < hug * 0.5 - 0.02) break; // it has gone into something else (the ground at the rock's foot)
          if (stop(q)) break;
          p = q;
          path.push(p.slice());
          if (i % (o.every || 3) === 1)
            nodes.push({ p: p.slice(), n, dir: head.slice(), t: i / steps, depth, k: s0 + i });
          if (depth < (o.depth || 2) && R() < (o.branch === undefined ? 0.06 : o.branch)) {
            const c = [
                head[1] * n[2] - head[2] * n[1],
                head[2] * n[0] - head[0] * n[2],
                head[0] * n[1] - head[1] * n[0]
              ],
              sg = R() < 0.5 ? -1 : 1;
            walk(
              p.slice(),
              norm([head[0] + c[0] * sg * 1.2, head[1] + c[1] * sg * 1.2, head[2] + c[2] * sg * 1.2]),
              Math.floor((steps - i) * 0.6),
              depth + 1,
              s0 + i
            );
          }
        }
        if (path.length > 2) paths.push(path);
      };
      const start = onto(o.from || [0, 0, 0]),
        stop = o.stop || (() => false);
      walk(start, want, o.steps || 60, 0, 0);
      return { paths, nodes };
    },
    /* leaves, cheaply: a few leaf shapes baked once (S.template) and copies placed with a whole orientation, not as solids in the
       field. -> put(at, dir (the way it points), up (the way its face faces), length). o: { kinds (3), wide (0.27), fold (0.3),
       res (for the template, whose leaf is 1 long), sway }. Each kind is a little different (width, curl). */
    leaves(S, mat, o) {
      o = o || {};
      const kinds = [];
      for (let k = 0; k < (o.kinds || 3); k++) {
        const wide = (o.wide || 0.27) * (0.85 + 0.15 * k),
          curl = 0.08 * (k - 1);
        kinds.push(
          S.template(
            S2 =>
              K.sweep(
                S2,
                [
                  [0, 0, 0],
                  [0, curl, 0.5],
                  [0, -0.1 + curl, 1]
                ],
                { w: K.sweep.leaf(wide), h: 0.03, fold: o.fold === undefined ? 0.3 : o.fold },
                mat,
                { up: [0, 1, 0] }
              ),
            { res: o.res || 0.09 }
          )
        );
      }
      let n = 0;
      return (at, dir, up, len, born) => {
        const z = norm(dir),
          x = norm(cross(up, z)),
          y = cross(z, x);
        S.place(kinds[n++ % kinds.length], at, {
          R: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]],
          scale: len,
          solid: false,
          sway: born === undefined ? o.sway : undefined, // (a leaf that grows cannot sway as a whole: both use the same number)
          born
        });
      };
    },
    vine(S, grown, stem, leaf, o) {
      o = o || {};
      const r = o.r || 0.025,
        G = Object.assign(S.grp(o.melt === undefined ? 0.02 : o.melt), { res: o.res || 0.03 });
      /* (a stem with fewer points: a tube's distance looks at every one of them). o.grow: seconds a step, and the vine grows as it was
         grown: each stem from where it forked, out to its tip, a leaf opening a moment after the stem has passed it */
      const gw = o.grow || 0;
      for (const p of grown.paths)
        S.tube(
          K.curve.resample(p, Math.max(2, Math.ceil(p.length / 4))),
          r,
          r * 0.5,
          stem,
          gw ? Object.assign({ born: (x, y, z, al) => ((p.start || 0) + al * (p.length - 1)) * gw }, G) : G
        );
      const R = dice(o.seed || 23),
        size = o.size || 0.16;
      let put = null;
      for (const nd of grown.nodes) {
        if (R() > (o.leaves === undefined ? 0.8 : o.leaves)) continue;
        const side = [
            nd.dir[1] * nd.n[2] - nd.dir[2] * nd.n[1],
            nd.dir[2] * nd.n[0] - nd.dir[0] * nd.n[2],
            nd.dir[0] * nd.n[1] - nd.dir[1] * nd.n[0]
          ],
          sg = R() < 0.5 ? -1 : 1,
          k = size * (0.7 + 0.6 * R()) * (1 - 0.4 * nd.t),
          d = norm([
            side[0] * sg + nd.n[0] * 0.6 + nd.dir[0] * 0.3,
            side[1] * sg + nd.n[1] * 0.6 + nd.dir[1] * 0.3,
            side[2] * sg + nd.n[2] * 0.6 + nd.dir[2] * 0.3
          ]),
          a = nd.p,
          b = [a[0] + d[0] * k * 0.5, a[1] + d[1] * k * 0.5 + 0.01, a[2] + d[2] * k * 0.5],
          c = [a[0] + d[0] * k, a[1] + d[1] * k - k * 0.15, a[2] + d[2] * k];
        if (o.cheap === false)
          K.sweep(S, [a, b, c], { w: K.sweep.leaf(k * 0.28), h: 0.008, fold: 0.3 }, leaf, {
            up: nd.n,
            res: o.leafRes || 0.025
          });
        else
          (put || (put = K.grow.leaves(S, leaf, { res: (o.leafRes || 0.025) / size })))(
            a,
            [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
            nd.n,
            k,
            gw ? ((nd.k || 0) + 3) * gw : undefined
          );
      }
    },
    spread(S, o) {
      o = o || {};
      S.ready();
      const R = dice(o.seed || 29),
        gap = o.gap || 0.12,
        sdf = S.sdf,
        cell = gap,
        map = new Map(),
        key = (x, y, z) => Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell),
        pts = [],
        near = (x, y, z, r) => {
          const cx = Math.floor(x / cell),
            cy = Math.floor(y / cell),
            cz = Math.floor(z / cell),
            k = Math.ceil(r / cell);
          for (let a = -k; a <= k; a++)
            for (let b = -k; b <= k; b++)
              for (let c = -k; c <= k; c++) {
                const L = map.get(cx + a + ',' + (cy + b) + ',' + (cz + c));
                if (L) for (const q of L) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < r * r) return true;
              }
          return false;
        },
        put = p => {
          p.step = stepNow;
          pts.push(p);
          const k = key(p[0], p[1], p[2]);
          (map.get(k) || map.set(k, []).get(k)).push(p);
        },
        onto = p => {
          for (let k = 0; k < 5; k++) {
            const d = sdf(p[0], p[1], p[2]);
            if (Math.abs(d) < 0.003) break;
            const g = grad(sdf, p[0], p[1], p[2]);
            p = [p[0] - g[0] * d, p[1] - g[1] * d, p[2] - g[2] * d];
          }
          return p;
        };
      let front = [],
        stepNow = 0;
      for (const s0 of o.from || []) {
        const p = onto(s0.p || s0);
        put(p);
        front.push(p);
      }
      for (let st = 0; st < (o.steps || 12) && front.length; st++) {
        stepNow = st + 1;
        const next = [];
        for (const p of front) {
          const n = grad(sdf, p[0], p[1], p[2]);
          for (let k = 0; k < (o.tries || 4); k++) {
            const a = R() * Math.PI * 2,
              t1 = norm(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0]),
              t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]],
              dd = gap * (1 + R() * 0.6),
              q = onto([
                p[0] + (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * dd,
                p[1] + (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * dd,
                p[2] + (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * dd
              ]);
            if (near(q[0], q[1], q[2], gap * 0.8)) continue;
            if (o.ok && !o.ok(q[0], q[1], q[2], grad(sdf, q[0], q[1], q[2]))) continue;
            if (R() > (o.chance === undefined ? 0.8 : o.chance)) continue;
            put(q);
            next.push(q);
          }
        }
        front = next;
      }
      /* when(x, y, z): the step at which the patch reached the nearest of its points (what a cover's born wants, times seconds a step) */
      const when = (x, y, z) => {
        const cx = Math.floor(x / cell),
          cy = Math.floor(y / cell),
          cz = Math.floor(z / cell);
        let best = 1e9,
          st = o.steps || 12;
        for (let a = -2; a <= 2; a++)
          for (let b = -2; b <= 2; b++)
            for (let c = -2; c <= 2; c++) {
              const L = map.get(cx + a + ',' + (cy + b) + ',' + (cz + c));
              if (L)
                for (const q of L) {
                  const d = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
                  if (d < best) ((best = d), (st = q.step));
                }
            }
        return st;
      };
      return { pts, has: (x, y, z, r) => near(x, y, z, r || gap), when };
    },
    scatterIn(S, sd, o) {
      o = o || {};
      const R = dice(o.seed || 31),
        b = o.box,
        out = [],
        gap = o.gap || 0.1;
      for (let tries = 0; tries < (o.n || 30) * 30 && out.length < (o.n || 30); tries++) {
        const p = [b[0] + R() * (b[1] - b[0]), b[2] + R() * (b[3] - b[2]), b[4] + R() * (b[5] - b[4])];
        if (sd(p[0], p[1], p[2]) > -(o.margin || 0)) continue;
        if (out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < gap)) continue;
        out.push(p);
      }
      return out;
    },
    ray(S, from, dir, far) {
      const d = norm(dir);
      let t = 0;
      for (let i = 0; i < 300 && t < (far || 30); i++) {
        const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t],
          h = S.sdf(p[0], p[1], p[2]);
        if (h < 0.003) return { p, n: grad(S.sdf, p[0], p[1], p[2]), d: t };
        t += Math.max(0.01, h * 0.9);
      }
      return null;
    }
  };
})(KIT);
