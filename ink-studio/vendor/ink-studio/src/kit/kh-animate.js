/* kh-animate: animation tools for poses of named parts.
   A pose is plain data: pose[part][channel]. Channels that start with `scale`, and `stretch`, multiply and rest at 1; every other one adds and
   rests at 0 (pos, rot in degrees, bend, waist, taper, twist, inflate, fold, open, and any name of your own). Nothing here touches a splat:
   K.puppet (ki-deform) turns a pose into bones, and K.acts (kj-acts) is the library of ready clips.

   Time and values
     K.anim.ease(t, name, bezier)      linear smooth step in-quad out-quad in-out-quad in-cubic out-cubic in-out-cubic in-sine out-sine in-out-sine
                                       in-expo out-expo in-circ out-circ out-back out-elastic out-bounce bezier (and the short names in out back
                                       elastic bounce)
     K.anim.keys(keys, t, fallback)    keys [{ t, v, ease, bezier }] (v a number or a list); the ease named on a key shapes the way out of it
     K.anim.param(value, t, fallback)  a number, or keys
     K.anim.path(points, o)            a curve through points (o.closed, o.curve 0..1, o.steps): .length, .at(distance) -> { p, tan }
     K.anim.spring(x, v, target, dt, frequency, ratio) -> [x, v]   exact, so it is the same at any frame rate
     K.anim.dynamic(m, t)              a timed or decaying wobble on x, y, rotation, scaleX, scaleY, skewX, skewY
     K.anim.wave(age, dur, speed, damp)   the decaying wave by itself (what follows a landing, a take-off, a blow)
     K.anim.expr(e) / K.anim.run(e, vars)   a small numeric graph as data: ['add', ['var', 'time'], 2] ...
   Clips
     K.anim.clip(def)                  { id, dur, loop, fps, tracks, cues, events, tools: { layers, follow }, parents }
                                       tracks: { 'part.channel': keys } or [{ part, ch, keys | program }]
                                       .sample(t, pose)  .time(t) (the clip's own clock, after freezes and slow motion)  .ghosts(t, o)
                                       .eventsBetween(from, to) reads the named source-time markers
     K.anim.influence(item, t, dur)    how much a layer or constraint counts now: start, end, blend, weight (a number or keys), enabled
     K.anim.layers(pose, layers, t, dur, phase)   add pose layers: values, or a source clip masked to some parts; driver; solo
                                                phase: 'corrective' can also be set without a pose driver
     K.anim.FOLLOW                     subtle, natural, loose: follow-through presets { lagFrames, strength }
     K.anim.blend(a, b, w) / K.anim.add(pose, more, w)
     K.anim.copy(pose, c, w)           copy or limit a channel from one part to another (see K.puppet for look, reach, pin, distance, path)
   Machines and controls
     K.anim.machine(def)               states that play clips, in layers; inputs (boolean, number, trigger); transitions with conditions, exit
                                       time, cross-fade, named events; from 'any', to 'exit'. .set(id, v) .fire(id) .advance(dt) -> frame
     K.anim.joystick(def)              a handle in -1..1 each way chooses a pose from two source clips: .pose([x, y], out)
     K.anim.solo(group, clip, t)       which one of a group shows now (drawing swaps)
     K.anim.face(def)                  expression (open, tilt), blinks on a schedule or on demand, gaze that wanders or follows a pointer
     K.anim.faceControl(eye, face, events, part, t)   timeline holds over the face, by priority, with a release
   Presentation
     K.anim.cue(id, type, t)           sound sprite-flash freeze slow shake flash zoom pan fade letterbox impact
     K.anim.preset(name, t)            heavy-impact contact-impact lightning discovery slow
     K.anim.present(clip, t)           -> { time, animTime, x, y, rotation, scale, overlays, letterbox }
     K.anim.show(anim, state, pal, o)  hand that to a world's anim: camera kick, zoom, bars, and a flash through the palette
     K.anim.camera(def)                shake that takes impulses and dies away, sampled on its own clock
   Fields and bodies
     K.anim.force(fields, p, t) / K.anim.response(fields, p, t, receiver)   gusts and pulses in space, and a late soft answer to them
     K.anim.steer(m, state, at, forward, target, dt)   walk toward a target and turn to face it, with a dead band
     K.anim.track(o, state, dir, dt)   turn to look, within yaw and pitch limits and a cone, never snapping
     K.anim.support(contacts, o, state, dt)   hold a body over its planted feet: height and tilt */
(function (K) {
  const c01 = x => (x < 0 ? 0 : x > 1 ? 1 : x),
    clamp = K.clamp,
    lerp = (a, b, t) => a + (b - a) * t,
    smooth = x => {
      x = c01(x);
      return x * x * (3 - 2 * x);
    };
  const A = (K.anim = {});
  A.EASES = [
    'linear',
    'smooth',
    'step',
    'in-quad',
    'out-quad',
    'in-out-quad',
    'in-cubic',
    'out-cubic',
    'in-out-cubic',
    'in-sine',
    'out-sine',
    'in-out-sine',
    'in-expo',
    'out-expo',
    'in-circ',
    'out-circ',
    'out-back',
    'out-elastic',
    'out-bounce',
    'bezier'
  ];
  const SHORT = { in: 'in-cubic', out: 'out-cubic', back: 'out-back', elastic: 'out-elastic', bounce: 'out-bounce' };
  const bounce = x => {
    const n = 7.5625,
      d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };
  /* a cubic Bezier timing curve through (0,0) (x1,y1) (x2,y2) (1,1): solve for the parameter by halving, then read off y */
  A.bezier = (t, x1, y1, x2, y2) => {
    const f = (s, a, b) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
    let lo = 0,
      hi = 1;
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (f(m, x1, x2) < t) lo = m;
      else hi = m;
    }
    return f((lo + hi) / 2, y1, y2);
  };
  A.ease = (t, name, bz) => {
    t = c01(t);
    switch (SHORT[name] || name) {
      case 'smooth':
        return t * t * (3 - 2 * t);
      case 'step':
        return t === 1 ? 1 : 0;
      case 'in-quad':
        return t * t;
      case 'out-quad':
        return 1 - (1 - t) * (1 - t);
      case 'in-out-quad':
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      case 'in-cubic':
        return t * t * t;
      case 'out-cubic':
        return 1 - Math.pow(1 - t, 3);
      case 'in-out-cubic':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'in-sine':
        return 1 - Math.cos((t * Math.PI) / 2);
      case 'out-sine':
        return Math.sin((t * Math.PI) / 2);
      case 'in-out-sine':
        return (1 - Math.cos(Math.PI * t)) / 2;
      case 'in-expo':
        return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
      case 'out-expo':
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      case 'in-circ':
        return 1 - Math.sqrt(1 - t * t);
      case 'out-circ':
        return Math.sqrt(1 - (t - 1) * (t - 1));
      case 'out-back':
        return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
      case 'out-elastic':
        return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
      case 'out-bounce':
        return bounce(t);
      case 'bezier': {
        const b = bz || [0.25, 0.1, 0.25, 1];
        return A.bezier(t, b[0], b[1], b[2], b[3]);
      }
      default:
        return t;
    }
  };
  /* keys may be written short, as [t, v] or [t, v, ease] */
  const norm = k => (Array.isArray(k) ? { t: k[0], v: k[1], ease: k[2], bezier: k[3] } : k),
    kt = k => (Array.isArray(k) ? k[0] : k.t !== undefined ? k.t : k.time),
    kv = k => (Array.isArray(k) ? k[1] : k.v !== undefined ? k.v : k.value),
    ke = k => (Array.isArray(k) ? k[2] : k.ease || k.easing) || 'smooth',
    kb = k => (Array.isArray(k) ? k[3] : k.bezier);
  A.keys = (keys, t, fallback) => {
    if (!keys || !keys.length) return fallback;
    const first = keys[0],
      last = keys[keys.length - 1];
    if (t <= kt(first)) return kv(first);
    if (t >= kt(last)) return kv(last);
    let lo = 1,
      hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kt(keys[mid]) > t) hi = mid;
      else lo = mid + 1;
    }
    const a = keys[lo - 1],
      b = keys[lo],
      u = A.ease((t - kt(a)) / (kt(b) - kt(a)), ke(a), kb(a)),
      va = kv(a),
      vb = kv(b);
    return Array.isArray(va) ? va.map((x, i) => x + (vb[i] - x) * u) : va + (vb - va) * u;
  };
  A.param = (value, t, fallback) =>
    Array.isArray(value)
      ? A.keys(value, t, fallback === undefined ? 0 : fallback)
      : typeof value === 'number'
        ? value
        : fallback === undefined
          ? 0
          : fallback;
  A.shortAngle = (a, b) => ((((b - a + 540) % 360) + 360) % 360) - 180;
  /* a curve through points. curve 0 keeps the corners; 1 is a smooth cardinal curve. Distances along it are true lengths */
  A.path = (points, o) => {
    o = o || {};
    const closed = !!o.closed,
      curve = o.curve === undefined ? 1 : o.curve,
      steps = o.steps || 8,
      n = points.length,
      at = i => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]),
      pts = [];
    if (!curve || n < 2) for (const p of points) pts.push(p.slice());
    else {
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const pv = at(i - 1),
          a = at(i),
          b = at(i + 1),
          nx = at(i + 2);
        for (let j = 0; j < steps; j++) {
          const t = j / steps,
            t2 = t * t,
            t3 = t2 * t,
            h00 = 2 * t3 - 3 * t2 + 1,
            h10 = t3 - 2 * t2 + t,
            h01 = -2 * t3 + 3 * t2,
            h11 = t3 - t2;
          pts.push(
            a.map((v, k) => {
              const sp = h00 * v + h10 * (b[k] - pv[k]) * 0.5 + h01 * b[k] + h11 * (nx[k] - a[k]) * 0.5,
                ln = v + (b[k] - v) * t;
              return ln + curve * (sp - ln);
            })
          );
        }
      }
      if (!closed) pts.push(points[n - 1].slice());
    }
    if (closed) pts.push(pts[0].slice());
    const len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(...pts[i].map((v, k) => v - pts[i - 1][k])));
    const total = len[len.length - 1] || 1e-9;
    return {
      points: pts,
      length: total,
      closed,
      at(d) {
        d = closed ? ((d % total) + total) % total : clamp(d, 0, total);
        let lo = 0,
          hi = len.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (len[mid] <= d) lo = mid;
          else hi = mid;
        }
        const f = (d - len[lo]) / Math.max(1e-9, len[hi] - len[lo]),
          a = pts[lo],
          b = pts[hi],
          tan = b.map((v, k) => v - a[k]),
          tl = Math.hypot(...tan) || 1;
        return { p: a.map((v, k) => v + (b[k] - v) * f), tan: tan.map(v => v / tl) };
      }
    };
  };
  /* the exact answer of a damped spring over dt: frequency in radians a second, ratio 1 is critical, under 1 rings */
  A.spring = (value, velocity, target, dt, frequency, ratio) => {
    const f = frequency === undefined ? 26 : frequency,
      z = ratio === undefined ? 0.65 : ratio,
      o = value - target;
    if (f === 0) return [value + velocity * dt, velocity];
    if (z === 1) {
      const k = velocity + f * o,
        e = Math.exp(-f * dt);
      return [target + (o + k * dt) * e, (velocity - f * k * dt) * e];
    }
    if (z > 1) {
      const s = Math.sqrt(z * z - 1),
        a = -f / (z + s),
        b = -f * (z + s),
        c = (velocity - b * o) / (a - b),
        d = o - c,
        ea = Math.exp(a * dt),
        eb = Math.exp(b * dt);
      return [target + c * ea + d * eb, a * c * ea + b * d * eb];
    }
    const d = f * z,
      w = f * Math.sqrt(1 - z * z),
      e = Math.exp(-d * dt),
      s = Math.sin(w * dt),
      c = Math.cos(w * dt);
    return [
      target + e * (o * c + ((velocity + d * o) * s) / w),
      e * (velocity * c - ((d * velocity + f * f * o) * s) / w)
    ];
  };
  /* rows of [time, a, b, ...] eased smoothly: the values at a time */
  A.poseAt = (time, keys) => {
    let a = keys[0],
      b = keys[keys.length - 1];
    for (let i = 1; i < keys.length; i++)
      if (time <= keys[i][0]) {
        a = keys[i - 1];
        b = keys[i];
        break;
      }
    const t = smooth((time - a[0]) / (b[0] - a[0] || 1));
    return a.slice(1).map((v, i) => v + (b[i + 1] - v) * t);
  };
  /* the decaying wave itself: 1 at age 0, swinging `speed` times a second, gone by `dur` (damp: how fast it dies inside that) */
  const TAU = Math.PI * 2;
  A.wave = (age, dur, speed, damp) => {
    const u = age / dur;
    return age < 0 || u >= 1 ? 0 : Math.cos(age * speed * TAU) * Math.exp(-u * damp) * (1 - u);
  };
  /* a wobble from one event: mode 'timed' eases there (and back if pingpong); otherwise a decaying wave. Amounts may be keyed */
  A.dynamic = (m, time) => {
    const r = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
    if (!m || m.enabled === false || time < (m.delay || 0)) return r;
    const age = time - (m.delay || 0),
      dur = Math.max(0.001, m.duration === undefined ? 1 : m.duration),
      u = c01(age / dur);
    let wave;
    if (m.mode === 'timed') wave = A.ease(m.pingpong ? 1 - Math.abs(((age / dur) % 2) - 1) : u, m.easing || 'smooth');
    else wave = A.wave(age, dur, m.speed === undefined ? 5 : m.speed, m.damping === undefined ? 5 : m.damping);
    for (const k in r) {
      const amt = A.param(m[k], time, 0);
      r[k] = k.startsWith('scale') ? Math.max(0.01, 1 + amt * wave) : amt * wave;
    }
    return r;
  };

  /* ---- a small numeric graph, as data. Compiled to closures: no text is ever run */
  const OPS = {
    add: v => v.reduce((a, b) => a + b),
    mul: v => v.reduce((a, b) => a * b),
    sub: v => v[0] - v[1],
    div: v => v[0] / v[1],
    pow: v => Math.pow(v[0], v[1]),
    mod: v => v[0] % v[1],
    min: v => Math.min(...v),
    max: v => Math.max(...v),
    sin: v => Math.sin(v[0]),
    cos: v => Math.cos(v[0]),
    exp: v => Math.exp(v[0]),
    sqrt: v => Math.sqrt(v[0]),
    abs: v => Math.abs(v[0]),
    clamp: v => Math.max(v[1], Math.min(v[2], v[0])),
    smooth: v => smooth(v[0]),
    eq: v => v[0] === v[1],
    gt: v => v[0] > v[1],
    gte: v => v[0] >= v[1],
    lt: v => v[0] < v[1],
    not: v => !v[0],
    and: v => v.every(Boolean),
    or: v => v.some(Boolean)
  };
  A.expr = e => {
    if (!Array.isArray(e)) return () => e;
    const op = e[0],
      args = e.slice(1);
    if (op === 'var') {
      const parts = String(args[0]).split('.');
      return vars => {
        let v = vars;
        for (const p of parts) {
          if (p === '__proto__' || p === 'prototype' || p === 'constructor') throw new Error('reserved variable path');
          v = v === undefined || v === null ? undefined : v[p];
        }
        if (v === undefined) throw new Error('unknown variable ' + args[0]);
        return v;
      };
    }
    const f = args.map(A.expr);
    if (op === 'if') return v => (f[0](v) ? f[1](v) : f[2](v));
    const fn = OPS[op];
    if (!fn) throw new Error('unknown operator ' + op);
    return v => fn(f.map(g => g(v)));
  };
  A.run = (e, vars) => A.expr(e)(vars);

  /* ---- poses */
  const multiplies = ch => ch === 'stretch' || ch.startsWith('scale'),
    restOf = (ch, like) => {
      const r = multiplies(ch) ? 1 : 0;
      return Array.isArray(like) ? like.map(() => r) : r;
    };
  A.multiplies = multiplies;
  A.put = (pose, part, ch, v) => {
    (pose[part] || (pose[part] = {}))[ch] = v;
    return pose;
  };
  A.get = (pose, part, ch, fallback) => {
    const p = pose[part];
    return p && p[ch] !== undefined ? p[ch] : fallback;
  };
  /* add `more` onto `pose`, by the share w: what multiplies moves from 1 toward its value, the rest is added */
  A.add = (pose, more, w) => {
    w = w === undefined ? 1 : w;
    for (const part in more) {
      const src = more[part],
        dst = pose[part] || (pose[part] = {});
      for (const ch in src) {
        const v = src[ch],
          mul = multiplies(ch),
          old = dst[ch] === undefined ? restOf(ch, v) : dst[ch];
        dst[ch] = Array.isArray(v)
          ? v.map((x, i) => (mul ? old[i] * Math.max(0.01, 1 + (x - 1) * w) : old[i] + x * w))
          : mul
            ? old * Math.max(0.01, 1 + (v - 1) * w)
            : old + v * w;
      }
    }
    return pose;
  };
  /* a pose between two: anything one of them lacks is taken at rest */
  A.blend = (a, b, w, out) => {
    out = out || {};
    const parts = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const part of parts) {
      const pa = a[part] || {},
        pb = b[part] || {},
        o = (out[part] = {});
      for (const ch of new Set(Object.keys(pa).concat(Object.keys(pb)))) {
        const like = pa[ch] !== undefined ? pa[ch] : pb[ch],
          va = pa[ch] !== undefined ? pa[ch] : restOf(ch, like),
          vb = pb[ch] !== undefined ? pb[ch] : restOf(ch, like);
        o[ch] = Array.isArray(va)
          ? va.map((x, i) => x + (vb[i] - x) * w)
          : typeof va === 'number'
            ? va + (vb - va) * w
            : w < 0.5
              ? va
              : vb;
      }
    }
    return out;
  };
  A.influence = (item, time, dur) => {
    const start = item.start || 0,
      end = item.end === undefined ? dur : item.end;
    if (item.enabled === false || time < start || time > end) return 0;
    const blend = item.blend || 0;
    return (
      c01(A.param(item.weight, time, 1)) *
      (blend
        ? Math.min(start > 0 ? smooth((time - start) / blend) : 1, end < dur ? smooth((end - time) / blend) : 1)
        : 1)
    );
  };
  /* how far a pose driver has got: a channel of some part ('rot.1', 'pos.0', 'open') read between from and to */
  const AXES = { x: 0, y: 1, z: 2 };
  A.driver = (d, pose) => {
    if (!d) return 1;
    const path = String(d.ch || d.channel).split('.');
    let v = pose[d.part || d.joint];
    for (const k of path)
      v = v === undefined || v === null ? undefined : v[Array.isArray(v) && AXES[k] !== undefined ? AXES[k] : k];
    if (v === undefined) v = restOf(path[0]);
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    if (d.absolute) v = Math.abs(v);
    const u = c01((v - d.from) / (d.to - d.from));
    return d.ease === 'linear' || d.easing === 'linear' ? u : u * u * (3 - 2 * u);
  };
  A.FOLLOW = {
    subtle: { lagFrames: 2, strength: 0.35 },
    natural: { lagFrames: 3, strength: 0.65 },
    loose: { lagFrames: 5, strength: 0.9 }
  };
  /* A layer gives values or samples a source clip at its own speed and offset.
     Drivers and explicit corrective layers run in the corrective pass. */
  A.layers = (pose, layers, time, dur, phase) => {
    if (!layers || !layers.length) return pose;
    const solo = layers.some(l => l.solo && l.enabled !== false),
      before = phase !== 'base' && layers.some(l => l.driver) ? JSON.parse(JSON.stringify(pose)) : null;
    for (const l of layers) {
      const corrective = l.driver || l.phase === 'corrective';
      if ((phase === 'base' && corrective) || (phase === 'corrective' && !corrective)) continue;
      if (solo && !l.solo) continue;
      const w = A.influence(l, time, dur) * A.driver(l.driver, before || pose);
      if (!w) continue;
      if (l.mode === 'override') {
        A.motionLayers.mix(pose, l, time, w, dur);
        continue;
      }
      let values = l.values;
      if (l.source) {
        const c = l.source,
          age = Math.max(0, time - (l.start || 0)) * (l.speed === undefined ? 1 : l.speed) + (l.offset || 0),
          full = c.sample(l.loop === false ? Math.min(c.dur, age) : age % c.dur, {}, { plain: true });
        values = {};
        for (const part of l.parts || Object.keys(full)) if (full[part]) values[part] = full[part];
      }
      A.add(pose, values, w);
    }
    return pose;
  };

  /* Copy or limit a channel, in the parts' own spaces. c: { part, from (the part copied; leave out to only limit), ch: 'pos' | 'rot' |
     'scale', axes [1, 1, 1] (which to copy), multiplier, offset, min, max (per axis, null for none), ownerOffset (add what the part itself was
     keyed to) }. w is how much it counts */
  A.copy = (pose, c, w) => {
    w = w === undefined ? 1 : w;
    if (!w) return pose;
    const ch = c.ch || 'rot',
      r = multiplies(ch) ? 1 : 0,
      own = (pose[c.part] && pose[c.part][ch]) || [r, r, r],
      src = c.from ? (pose[c.from] && pose[c.from][ch]) || [r, r, r] : null,
      want = own.slice();
    for (let i = 0; i < 3; i++) {
      if (src && (!c.axes || c.axes[i])) {
        let v = src[i] * (c.multiplier ? c.multiplier[i] : 1);
        if (c.ownerOffset) v = r ? v * own[i] : v + own[i];
        want[i] = v + (c.offset ? c.offset[i] : 0);
      }
      if (c.min && c.min[i] !== null && c.min[i] !== undefined) want[i] = Math.max(c.min[i], want[i]);
      if (c.max && c.max[i] !== null && c.max[i] !== undefined) want[i] = Math.min(c.max[i], want[i]);
    }
    (pose[c.part] || (pose[c.part] = {}))[ch] = own.map((v, i) => v + (want[i] - v) * w);
    return pose;
  };

  /* ---- presentation cues */
  A.CUES = {
    sound: { duration: 0.5, amount: 1 },
    'sprite-flash': { duration: 0.18, amount: 0.85 },
    freeze: { duration: 0.045, amount: 0 },
    slow: { duration: 0.35, amount: 0.25 },
    shake: { duration: 0.22, amount: 8 },
    flash: { duration: 0.18, amount: 0.65 },
    zoom: { duration: 0.25, amount: 0.12 },
    pan: { duration: 0.4, amount: 40 },
    fade: { duration: 0.5, amount: 1 },
    letterbox: { duration: 1, amount: 0.12 },
    impact: { duration: 0.04, amount: 1 }
  };
  A.cue = (id, type, time, more) => {
    const d = A.CUES[type];
    if (!d) throw new Error('unknown presentation cue ' + type);
    return Object.assign(
      {
        id,
        type,
        time: time || 0,
        duration: d.duration,
        amount: d.amount,
        color: type === 'impact' ? [17, 20, 37] : [255, 227, 173],
        frequency: 28,
        rotation: 1.5,
        damping: 4,
        x: 1,
        y: 1,
        easing: 'out-cubic',
        seed: 1,
        hold: false
      },
      more || {}
    );
  };
  A.preset = (name, time) => {
    time = time === undefined ? 0.5 : time;
    const defs =
      name === 'heavy-impact'
        ? [
            ['freeze', 0.075, 0],
            ['shake', 0.3, 12],
            ['flash', 0.18, 0.75],
            ['zoom', 0.25, 0.1]
          ]
        : name === 'contact-impact'
          ? [
              ['freeze', 0.045, 0],
              ['shake', 0.075, 2],
              ['sprite-flash', 0.18, 0.85]
            ]
          : name === 'lightning'
            ? [
                ['flash', 0.48, 0.45],
                ['shake', 0.25, 3]
              ]
            : name === 'discovery'
              ? [
                  ['flash', 0.22, 0.35],
                  ['zoom', 0.6, 0.08]
                ]
              : [
                  ['slow', 0.5, 0.2],
                  ['zoom', 0.5, 0.08]
                ];
    return defs.map((d, i) =>
      A.cue(name + '-' + i, d[0], time, {
        duration: d[1],
        amount: d[2],
        profile: name === 'contact-impact' ? 'contact' : name === 'lightning' ? 'lightning' : undefined
      })
    );
  };
  const timeCues = clip =>
    ((clip && clip.cues) || []).filter(
      c => c.type && c.enabled !== false && (c.type === 'freeze' || c.type === 'slow')
    );
  /* the clip's own clock at a wall time: it stands still through a freeze and creeps through slow motion */
  A.animTime = (clip, time) => {
    const cues = timeCues(clip);
    if (!cues.length) return time;
    const pts = [0, time];
    for (const c of cues) {
      if (c.time > 0 && c.time < time) pts.push(c.time);
      const end = c.time + c.duration;
      if (end > 0 && end < time) pts.push(end);
    }
    pts.sort((a, b) => a - b);
    let r = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i],
        mid = (a + b) / 2;
      let speed = 1;
      for (const c of cues)
        if (mid >= c.time && mid < c.time + c.duration) speed *= c.type === 'freeze' ? 0 : clamp(c.amount, 0, 4);
      r += (b - a) * speed;
    }
    return Math.max(0, r);
  };
  /* and back: the wall time at which the clip's clock reads sourceTime */
  A.wallTime = (clip, sourceTime) => {
    if (!timeCues(clip).length) return sourceTime;
    let lo = 0,
      hi = (clip.dur || clip.duration || sourceTime) + 10;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (A.animTime(clip, mid) < sourceTime - 1e-8) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const rnd = (seed, a, b) => K.hash(seed * 1.37 + 0.11, a, b) * 2 - 1;
  A.present = (clip, time) => {
    const s = {
      time,
      animTime: A.animTime(clip, time),
      x: 0,
      y: 0,
      rotation: 0,
      scale: 1,
      overlays: [],
      letterbox: 0,
      sprite: 0
    };
    for (const c of (clip && clip.cues) || []) {
      if (!c.type || c.enabled === false || time < c.time) continue;
      const age = time - c.time,
        u = c01(age / c.duration);
      if (age >= c.duration && !c.hold) continue;
      const damp = c.damping === undefined ? 4 : c.damping,
        decay = Math.exp(-u * damp) * (1 - u),
        phase = age * (c.frequency === undefined ? 28 : c.frequency),
        seed = c.seed || 1;
      if (c.type === 'shake') {
        const i = Math.floor(phase),
          mix = smooth(phase % 1);
        s.x += lerp(rnd(seed, i, 1), rnd(seed, i + 1, 1), mix) * c.amount * decay * (c.x === undefined ? 1 : c.x);
        s.y += lerp(rnd(seed, i, 2), rnd(seed, i + 1, 2), mix) * c.amount * decay * (c.y === undefined ? 1 : c.y);
        s.rotation += rnd(seed, i, 3) * (c.rotation === undefined ? 1.5 : c.rotation) * decay;
      }
      if (c.type === 'zoom')
        s.scale *= 1 + c.amount * (c.hold ? A.ease(u, c.easing) : Math.sin(u * Math.PI) * Math.exp(-u * 2));
      if (c.type === 'pan') {
        const amt = A.ease(u, c.easing) * c.amount;
        s.x += amt * (c.x === undefined ? 1 : c.x);
        s.y += amt * (c.y || 0);
      }
      if (c.type === 'flash')
        s.overlays.push({
          color: c.color,
          opacity:
            c.amount *
            (c.profile === 'lightning'
              ? Math.sin(Math.min(1, age / 0.48) * Math.PI) * Math.exp(-age * 3)
              : 1 - smooth(u)),
          blend: 'screen'
        });
      if (c.type === 'sprite-flash') s.sprite = Math.max(s.sprite, c.amount * (1 - smooth(u)));
      if (c.type === 'impact') s.overlays.push({ color: c.color, opacity: c.amount, blend: 'difference' });
      if (c.type === 'fade')
        s.overlays.push({ color: c.color, opacity: c.amount * A.ease(u, c.easing), blend: 'over' });
      if (c.type === 'letterbox')
        s.letterbox = Math.max(s.letterbox, c.amount * (c.hold ? A.ease(u, c.easing) : Math.sin(u * Math.PI)));
    }
    return s;
  };
  /* Hand a presentation state to a world's anim, in the terms the page and the headless renderer already understand: kick (the camera's
     aim moved, in world units: o.unit is how far one cue unit is, 0.02 by default), zoom, bars, and grade (every palette colour mixed toward
     the overlays, except those in o.hold: by default the first, which is the background, so the black behind a diorama stays black). pal is
     the world's palette (W.pal, numbers 0xRRGGBB). Nothing is set when there is nothing to show */
  A.show = (anim, s, pal, o) => {
    o = o || {};
    const unit = o.unit === undefined ? 0.02 : o.unit,
      right = o.right || [1, 0, 0];
    anim.kick = s.x || s.y ? [right[0] * s.x * unit, -s.y * unit, right[2] * s.x * unit] : null;
    anim.zoom = s.scale !== 1 ? s.scale : null;
    anim.bars = s.letterbox > 0 ? s.letterbox : null;
    if (!s.overlays.length || !pal) {
      anim.grade = null;
      return anim;
    }
    const n = pal.length,
      g = anim._grade && anim._grade.length === n * 3 ? anim._grade : (anim._grade = new Float32Array(n * 3));
    const hold = o.hold || [0];
    for (let i = 0; i < n; i++) {
      let r = ((pal[i] >> 16) & 255) / 255,
        gg = ((pal[i] >> 8) & 255) / 255,
        b = (pal[i] & 255) / 255;
      for (const ov of hold.includes(i) ? [] : s.overlays) {
        const c = ov.color,
          a = c01(ov.opacity),
          cr = c[0] / 255,
          cg = c[1] / 255,
          cb = c[2] / 255;
        if (ov.blend === 'screen') {
          r = 1 - (1 - r) * (1 - cr * a);
          gg = 1 - (1 - gg) * (1 - cg * a);
          b = 1 - (1 - b) * (1 - cb * a);
        } else if (ov.blend === 'difference') {
          r = lerp(r, Math.abs(r - cr), a);
          gg = lerp(gg, Math.abs(gg - cg), a);
          b = lerp(b, Math.abs(b - cb), a);
        } else {
          r = lerp(r, cr, a);
          gg = lerp(gg, cg, a);
          b = lerp(b, cb, a);
        }
      }
      g[i * 3] = r;
      g[i * 3 + 1] = gg;
      g[i * 3 + 2] = b;
    }
    anim.grade = g;
    return anim;
  };
  /* camera shake: impulses that die away, the noise read from the shake's own clock (so a frozen frame holds still) */
  K.cameraImpulses = CameraImpulses;
  A.camera = def => {
    const d = Object.assign(
      {
        rate: 50,
        decay: 12,
        channels: [
          { frequency: 12.9898, phase: 0 },
          { frequency: 78.233, phase: 1 },
          { frequency: 0, phase: 0 }
        ]
      },
      def || {}
    );
    const cam = {
      clock: 0,
      amplitude: 0,
      offset: [0, 0, 0],
      impulse(amount, mode) {
        if(amount&&typeof amount==='object'){cam.effects.emit({...amount,time:amount.time??cam.clock});return cam;}
        cam.amplitude =
          mode === 'add' ? cam.amplitude + amount : mode === 'max' ? Math.max(cam.amplitude, amount) : amount;
        return cam;
      },
      advance(dt) {
        cam.clock += dt;
        if(Number.isFinite(cam.clock))cam.effects.seek(Math.max(0,cam.clock));
        cam.amplitude *= Math.exp(-dt * d.decay);
        const tick = Math.floor(cam.clock * d.rate);
        cam.offset = d.channels.map(c => Math.sin(tick * c.frequency + c.phase) * cam.amplitude);
        return cam.offset;
      },
      /* the same from nothing, at a time, given the impulses so far: [[time, amount, mode], ...] (for seeking) */
      seek(impulses, time) {
        cam.amplitude = 0;
        let prev = 0;
        for (const e of impulses.slice().sort((a, b) => a[0] - b[0])) {
          if (e[0] > time) break;
          cam.amplitude *= Math.exp(-(e[0] - prev) * d.decay);
          cam.impulse(e[1], e[2]);
          prev = e[0];
        }
        cam.amplitude *= Math.exp(-Math.max(0, time - prev) * d.decay);
        cam.clock = time;
        if(Number.isFinite(time))cam.effects.seek(Math.max(0,time));
        const tick = Math.floor(time * d.rate);
        cam.offset = d.channels.map(c => Math.sin(tick * c.frequency + c.phase) * cam.amplitude);
        return cam.offset;
      }
    };
    Object.defineProperty(cam,'time',{get:()=>cam.clock});
    cam.effects=CameraImpulses.create(def?.effects??{});
    cam.emit=event=>cam.effects.emit({...event,time:event.time??cam.clock});
    cam.sample=(time=cam.clock,context)=>cam.effects.sample(time,context);
    cam.bind=world=>cam.effects.bind(world);
    return cam;
  };

  /* ---- clips */
  A.clip = def => {
    const tracks = [];
    if (Array.isArray(def.tracks))
      for (const t of def.tracks)
        tracks.push({
          part: t.part || t.node,
          ch: t.ch || t.channel,
          keys: t.keys && t.keys.map(norm),
          program: t.program
        });
    else
      for (const name in def.tracks || {}) {
        const dot = name.indexOf('.');
        tracks.push({ part: name.slice(0, dot), ch: name.slice(dot + 1), keys: def.tracks[name].map(norm) });
      }
    for (const t of tracks)
      if (t.program)
        t.run = {
          variables: (t.program.variables || []).map(v => [v[0], A.expr(v[1])]),
          values: t.program.values.map(A.expr)
        };
    const dur = def.dur || def.duration || 1,
      fps = def.fps || 30,
      tools = def.tools || {},
      c = {
        id: def.id,
        name: def.name || def.id,
        dur,
        duration: dur,
        loop: !!def.loop,
        fps,
        tracks,
        cues: def.cues || [],
        tools,
        parents: def.parents || {},
        events: (def.cues || []).filter(q => Array.isArray(q) || !q.type)
      };
    const wrap = t => (c.loop ? ((t % dur) + dur) % dur : clamp(t, 0, dur));
    if (def.events !== undefined) {
      c.animationEvents = A.animationEvents.prepare(def.events, dur);
      c.events.push(...c.animationEvents);
    }
    c.eventsBetween = (from, to, options) => A.animationEvents.between(c, from, to, options);
    /* only the keys and programs: no layers, follow-through or time cues */
    const plain = (t, pose) => {
      for (const tr of tracks) {
        let v;
        if (tr.run) {
          const input = { time: t, duration: dur, parameters: tr.program.parameters || {} };
          for (const pr of tr.run.variables) input[pr[0]] = pr[1](input);
          const vals = tr.run.values.map(f => f(input));
          v = vals.length === 1 ? vals[0] : vals;
        } else v = A.keys(tr.keys, t, undefined);
        if (v !== undefined) (pose[tr.part] || (pose[tr.part] = {}))[tr.ch] = Array.isArray(v) ? v.slice() : v;
      }
      return pose;
    };
    c.time = t => wrap(A.animTime(c, t));
    c.sample = (time, pose, o) => {
      pose = pose || {};
      if (o?.plain) return plain(o.sourceTime ? clamp(time, 0, dur) : wrap(time), pose);
      const t = o?.sourceTime ? clamp(time, 0, dur) : c.time(time);
      plain(t, pose);
      A.layers(pose, tools.layers, t, dur, 'base');
      /* follow-through: a part turns by how far its source has turned in the last few frames. Read from the keys at two times, never
         carried from frame to frame, so scrubbing and playing backward give the same pose */
      for (const f of tools.follow || []) {
        const w = A.influence(f, t, dur),
          src = f.source || c.parents[f.part];
        if (!w || !src) continue;
        const pre = f.preset ? A.FOLLOW[f.preset] : null,
          lag = (f.lagFrames === undefined ? (pre ? pre.lagFrames : 3) : f.lagFrames) / fps,
          strength = f.strength === undefined ? (pre ? pre.strength : 0.65) : f.strength,
          limit = f.limit === undefined ? 45 : f.limit,
          now = plain(t, {})[src] || {},
          old = plain(c.loop ? wrap(t - lag) : Math.max(0, t - lag), {})[src] || {},
          a = now.rot || [0, 0, 0],
          b = old.rot || [0, 0, 0],
          dst = pose[f.part] || (pose[f.part] = {}),
          r = dst.rot ? dst.rot.slice() : [0, 0, 0];
        for (let i = 0; i < 3; i++) r[i] += clamp(A.shortAngle(a[i], b[i]), -limit, limit) * w * strength;
        dst.rot = r;
      }
      A.layers(pose, tools.layers, t, dur, 'corrective');
      return pose;
    };
    /* named cues ([time, 'name'] pairs) passed between two clip times */
    c.passed = (t0, t1) => {
      const out = [];
      for (const q of c.events) {
        const tq = Array.isArray(q) ? q[0] : q.time,
          name = Array.isArray(q) ? q[1] : q.id;
        if (c.loop && t1 < t0 ? tq > t0 || tq <= t1 : tq > t0 && tq <= t1) out.push(name);
      }
      return out;
    };
    /* the times to draw as ghosts beside time t: the keys either side of it, or a fixed spacing */
    c.ghosts = (t, o) => {
      o = o || {};
      if (o.mode === 'spacing' || !tracks.some(tr => tr.keys)) {
        const sp = o.spacing || 0.15;
        return [Math.max(0, t - sp), Math.min(dur, t + sp)].filter(x => Math.abs(x - t) > 1e-5);
      }
      const ks = [...new Set(tracks.flatMap(tr => (tr.keys || []).map(kt)))].sort((a, b) => a - b),
        before = ks.filter(x => x < t - 1e-5).pop(),
        after = ks.find(x => x > t + 1e-5);
      return [before, after].filter(x => x !== undefined);
    };
    return c;
  };

  /* ---- state machines
     def: { inputs: [{ id, type: 'boolean' | 'number' | 'trigger', value }],
            layers: [{ id, entry, enabled, states: [{ id, clip, speed, playback: 'clip' | 'loop' | 'once' }] (a state without a clip is blank),
                       transitions: [{ id, from (a state or 'any'), to (a state or 'exit'), conditions: [{ input, op, value }], duration,
                                       easing: 'linear' | 'smooth', exitTime (null, or a share of the clip that must have played) }] }] }
     ops: eq ne gt ge lt le for numbers, eq ne for booleans, fired for triggers */
  A.machine = def => {
    const m = def,
      values = new Map(),
      layers = new Map();
    let events = [], clock = 0, contacts = new Set(), effects = [];
    for (const l of m.layers) {
      if (l.enabled === undefined) l.enabled = true;
      for (const s of l.states) {
        if (s.speed === undefined) s.speed = 1;
        if (!s.playback) s.playback = 'clip';
      }
      (l.transitions || (l.transitions = [])).forEach((t, i) => {
        if (!t.id) t.id = l.id + '-t' + i;
        if (t.enabled === undefined) t.enabled = true;
        if (t.duration === undefined) t.duration = 0.15;
        if (!t.easing) t.easing = 'smooth';
        if (t.exitTime === undefined) t.exitTime = null;
        if (!t.conditions) t.conditions = [];
      });
    }
    const timed = m.eventBindings !== undefined || m.layers.some(l =>
      l.states.some(s => s.clip?.animationEvents?.length) || l.transitions.some(t => t.on !== undefined));
    const eventAPI = timed ? A.animationEvents : null;
    const plan = eventAPI?.responses(m.eventBindings);
    const lanes = new Map();
    const inputs = new Map((m.inputs ?? []).map(input => [input.id, input]));
    const ops = { number: ['eq', 'ne', 'gt', 'ge', 'lt', 'le'], boolean: ['eq', 'ne'], trigger: ['fired'] };
    const inputValue = (type, value) => type === 'boolean' ? typeof value === 'boolean' : Number.isFinite(value);
    if (timed && (inputs.size !== (m.inputs?.length ?? 0) || [...inputs.values()].some(input =>
      !eventAPI.nameOK(input.id) || !Object.hasOwn(ops, input.type) ||
      input.type !== 'trigger' && !inputValue(input.type, input.value))))
      throw new TypeError('Animation graph needs unique, typed inputs');
    function validCondition(condition) {
      const input = inputs.get(condition?.input);
      return input && ops[input.type].includes(condition.op) &&
        (input.type === 'trigger' || inputValue(input.type, condition.value));
    }
    if (timed && (m.layers.some(l => !eventAPI.nameOK(l.id)) || new Set(m.layers.map(l => l.id)).size !== m.layers.length))
      throw new TypeError('Animation graph layers need unique IDs');
    if (timed) for (const l of m.layers) {
      const names = new Set(l.states.map(s => s.id));
      if (!names.has(l.entry) || names.has('exit') || names.size !== l.states.length ||
          l.states.some(s => !eventAPI.nameOK(s.id) || !Number.isFinite(s.speed)) ||
          l.transitions.some(t => !(names.has(t.from) || t.from === 'any') ||
            !(names.has(t.to) || t.to === 'exit') || !Number.isFinite(t.duration) || t.duration < 0 ||
            t.exitTime !== null && (!Number.isFinite(t.exitTime) || t.exitTime < 0) ||
            t.on !== undefined && !eventAPI.nameOK(t.on) ||
            !Array.isArray(t.conditions) || Array.from(t.conditions).some(c => !validCondition(c))))
        throw new TypeError('Invalid animation event state or transition in ' + l.id);
      for (const state of l.states) if (state.clip) lanes.set(state, eventAPI.track(state.clip, state));
    }
    const stateOf = (l, id) => l.states.find(s => s.id === id),
      test = (c, pulse = true) => {
        const v = values.get(c.input);
        switch (c.op) {
          case 'fired':
            return pulse && v === true;
          case 'eq':
            return v === c.value;
          case 'ne':
            return v !== c.value;
          case 'gt':
            return v > c.value;
          case 'ge':
            return v >= c.value;
          case 'lt':
            return v < c.value;
          case 'le':
            return v <= c.value;
          default:
            return false;
        }
      };
    const sample = (l, id, elapsed, weight) => {
      const s = stateOf(l, id);
      if (!s || !s.clip) return null;
      const c = s.clip,
        age = elapsed * Math.abs(s.speed),
        loop = s.playback === 'loop' || (s.playback === 'clip' && c.loop),
        t = loop ? age % c.dur : Math.min(c.dur, age);
      return { state: id, clip: c, time: timed ? lanes.get(s).sample(elapsed) : s.speed < 0 ? c.dur - t : t, weight };
    };
    const eligible = (l, r) => {
      if (r.state === 'exit' || r.blend) return null;
      const s = stateOf(l, r.state);
      return l.transitions.find(
        t =>
          t.enabled &&
          (t.from === r.state || (t.from === 'any' && t.to !== r.state)) &&
          t.conditions.every(c => test(c)) &&
          (t.exitTime === null || r.elapsed * Math.abs(s ? s.speed : 1) >= (s && s.clip ? s.clip.dur : 1) * t.exitTime)
      );
    };
    const enter = (l, r, t, at) => {
      const from = r.state;
      if (timed && events.length + 2 > eventAPI.budget) throw new RangeError('Animation graph exceeds its transition budget');
      r.blend = t.duration
        ? { from, elapsed: r.elapsed, time: 0, duration: t.duration, easing: t.easing, id: t.id }
        : null;
      r.state = t.to;
      r.elapsed = 0;
      if (timed) {
        if (r.blend) Object.assign(r.blend, { fromEntered: r.entered, started: at });
        Object.assign(r, { entered: at, index: 0, cycle: 0, pending: null });
      }
      events.push(
        { type: 'transition', layer: l.id, transition: t.id, from, to: t.to, ...(timed && { time: at }) },
        { type: t.to === 'exit' ? 'exit' : 'state', layer: l.id, state: t.to, ...(timed && { time: at }) }
      );
    };
    /* inputs take effect at the start of a step; a clip that runs past its exit time within the step carries the rest into the next state */
    const advanceLayer = (l, r, dt) => {
      let moved = false,
        t = eligible(l, r);
      if (t) {
        enter(l, r, t);
        moved = true;
      }
      const before = r.elapsed;
      r.elapsed += dt;
      if (r.blend) {
        r.blend.elapsed += dt;
        r.blend.time += dt;
        if (r.blend.time >= r.blend.duration) r.blend = null;
      }
      if (!moved && (t = eligible(l, r))) {
        const s = stateOf(l, r.state),
          threshold =
            t.exitTime === null ? r.elapsed : ((s && s.clip ? s.clip.dur : 1) * t.exitTime) / Math.abs(s ? s.speed : 1),
          carry = Math.max(0, Math.min(dt, r.elapsed - Math.max(before, threshold)));
        r.elapsed -= carry;
        enter(l, r, t);
        r.elapsed = carry;
        if (r.blend) {
          r.blend.elapsed += carry;
          r.blend.time = carry;
          if (carry >= r.blend.duration) r.blend = null;
        }
      }
    };
    function advanceTimedLayer(layer, run, end) {
      const { due, budget } = eventAPI;
      let at = clock, usedPulse = false, iterations = 0;
      while (true) {
        if (++iterations > budget) throw new RangeError('Animation graph exceeds its event or transition budget');
        const state = stateOf(layer, run.state), motion = lanes.get(state);
        const nextCue = () => run.entered + (motion?.time(run.index, run.cycle) ?? Infinity);
        run.elapsed = at - run.entered;
        if (run.blend) {
          run.blend.elapsed = at - run.blend.fromEntered;
          run.blend.time = at - run.blend.started;
          if (due(run.blend.started + run.blend.duration, at)) run.blend = null;
        }
        const names = new Set();
        while (due(nextCue(), at)) {
          if (events.length >= budget) throw new RangeError('Animation graph exceeds its event budget');
          const { event } = motion.rows[run.index], { id, name, time: sourceTime, data } = event;
          names.add(name);
          events.push({ type: 'animation', id, name, time: at, sourceTime, cycle: run.cycle,
            layer: layer.id, state: run.state, clip: state.clip.id ?? null, ...(data !== undefined && { data }) });
          if (++run.index === motion.rows.length && motion.loop) { run.index = 0; run.cycle++; }
        }
        const matches = (rule, pulse) => rule.enabled && run.state !== 'exit' &&
          (rule.from === run.state || rule.from === 'any' && rule.to !== run.state) &&
          rule.conditions.every(c => test(c, pulse));
        function gate(rule) {
          if (!rule.exitTime) return run.entered;
          return run.entered + (state?.clip?.dur ?? 1) * rule.exitTime / Math.abs(state?.speed ?? 1);
        }
        const pulse = at === clock && !usedPulse;
        const next = layer.transitions.find(rule => matches(rule, pulse) && due(gate(rule), at) &&
          (rule.on === undefined ? !run.blend : names.has(rule.on) || run.pending === rule));
        if (run.blend) {
          if (next && !run.pending) run.pending = next;
        } else {
          run.pending = null;
          if (next) {
            if (next.conditions.some(c => c.op === 'fired')) usedPulse = true;
            enter(layer, run, next, at);
            continue;
          }
        }
        if (at === end) return;
        let nextTime = Math.min(end, nextCue(), run.blend ? run.blend.started + run.blend.duration : Infinity);
        if (!run.blend)
          for (const rule of layer.transitions) if (rule.on === undefined && matches(rule, false) && !due(gate(rule), at))
            nextTime = Math.min(nextTime, gate(rule));
        at = nextTime;
      }
    }
    function timedAdvance(dt) {
      if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(clock + dt))
        throw new RangeError('Animation graph needs a finite nonnegative step');
      const end = clock + dt, before = new Map([...layers].map(([id, run]) =>
        [id, { ...run, blend: run.blend && { ...run.blend } }]));
      const previousEvents = events;
      events = [];
      try {
        for (const l of m.layers) if (l.enabled) advanceTimedLayer(l, layers.get(l.id), end);
        else {
          const run = layers.get(l.id);
          run.entered += dt;
          if (run.blend) {
            run.blend.started += dt;
            run.blend.fromEntered += dt;
          }
        }
        const nextEvents = [], nextContacts = new Set(contacts),
          nextEffects = effects.filter(x => x.time + x.duration > end);
        for (const row of events.sort((a, b) => a.time - b.time)) {
          nextEvents.push(row);
          if (row.type !== 'animation') continue;
          for (const response of plan.routes.get(row.name) ?? []) {
            const { type, effect, settings, ...detail } = response;
            if (type === 'contact') {
              if (detail.action === 'plant') nextContacts.add(detail.contact);
              else nextContacts.delete(detail.contact);
            }
            const cue = type === 'effect' ? A.cue(row.id, effect, row.time, settings) : null;
            if (cue && cue.time + cue.duration > end) nextEffects.push(cue);
            nextEvents.push({ type, ...detail, ...(cue && { effect, cue }), event: row.name, time: row.time,
              layer: row.layer, state: row.state, eventId: row.id });
            if (nextEvents.length > eventAPI.budget || nextEffects.length > eventAPI.budget)
              throw new RangeError('Animation graph exceeds its active response budget');
          }
        }
        contacts = nextContacts;
        effects = nextEffects;
        events = K.procedural.data.freeze(nextEvents);
        clock = end;
      } catch (error) {
        for (const [id, run] of before) layers.set(id, run);
        events = previousEvents;
        throw error;
      }
    }
    const api = {
      definition: m,
      reset() {
        values.clear();
        for (const i of m.inputs || []) values.set(i.id, i.type === 'trigger' ? false : i.value);
        layers.clear();
        events = [];
        clock = 0;
        contacts = new Set();
        effects = [];
        for (const l of m.layers) {
          layers.set(l.id, { state: l.entry, elapsed: 0, blend: null,
            ...(timed && { entered: 0, index: 0, cycle: 0, pending: null }) });
          if (l.enabled) events.push({ type: 'state', layer: l.id, state: l.entry, ...(timed && { time: 0 }) });
        }
        return api.frame();
      },
      set(id, value) {
        const i = (m.inputs || []).find(q => q.id === id);
        if (!i || i.type === 'trigger') throw new Error('machine: not a settable input ' + id);
        if (timed && !inputValue(i.type, value)) throw new TypeError('Invalid animation graph input ' + id);
        values.set(id, value);
        return api;
      },
      get: id => values.get(id),
      fire(id) {
        if (!(m.inputs || []).some(i => i.id === id && i.type === 'trigger'))
          throw new Error('machine: not a trigger ' + id);
        values.set(id, true);
        return api;
      },
      advance(dt = 0) {
        if (timed) timedAdvance(dt);
        else {
          events = [];
          for (const l of m.layers) if (l.enabled) advanceLayer(l, layers.get(l.id), dt || 0);
        }
        for (const i of m.inputs || []) if (i.type === 'trigger') values.set(i.id, false);
        return api.frame();
      },
      state: layer => layers.get(layer || m.layers[0].id).state,
      bind(options) {
        if (!timed) throw new TypeError('Use named events or event bindings to bind an animation machine');
        return eventAPI.bind(api, plan.contacts, options);
      },
      frame() {
        return {
          inputs: Object.fromEntries(values),
          events: events.slice(),
          ...(timed && { time: clock, contacts: [...contacts], presentation: A.present({ cues: effects }, clock) }),
          layers: m.layers
            .filter(l => l.enabled)
            .map(l => {
              const r = layers.get(l.id),
                b = r.blend,
                u = b ? Math.min(1, b.time / b.duration) : 1,
                w = b && b.easing === 'smooth' ? u * u * (3 - 2 * u) : u;
              return {
                id: l.id,
                state: r.state,
                elapsed: r.elapsed,
                transition: b ? b.id : null,
                samples: [b ? sample(l, b.from, b.elapsed, 1 - w) : null, sample(l, r.state, r.elapsed, w)].filter(
                  Boolean
                )
              };
            })
        };
      },
      /* the pose now: within a layer the cross-fade; a later layer overrides only the channels it animates, and where one side of its
         cross-fade lacks a channel that side is the layer beneath */
      pose(out) {
        out = out || {};
        for (const k in out) delete out[k];
        for (const layer of api.frame().layers) {
          const parts = layer.samples.map(s => ({ w: s.weight, pose: s.clip.sample(s.time, {}, timed ? { sourceTime: true } : undefined) }));
          const names = new Set(parts.flatMap(p => Object.keys(p.pose)));
          for (const part of names) {
            const dst = out[part] || (out[part] = {});
            for (const ch of new Set(parts.flatMap(p => Object.keys(p.pose[part] || {})))) {
              const have = parts.filter(p => p.pose[part] && p.pose[part][ch] !== undefined),
                like = have[0].pose[part][ch],
                base = dst[ch] !== undefined ? dst[ch] : restOf(ch, like),
                sum = have.reduce((n, p) => n + p.w, 0),
                rest = Math.max(0, 1 - sum);
              dst[ch] = timed && ch === 'rot' && Array.isArray(like)
                ? (rest ? base : like).map((angle, i) =>
                  have.reduce((v, p) => v + A.shortAngle(angle, p.pose[part][ch][i]) * p.w, angle))
                : Array.isArray(like)
                ? like.map((_, i) => have.reduce((v, p) => v + p.pose[part][ch][i] * p.w, base[i] * rest))
                : typeof like === 'number'
                  ? have.reduce((v, p) => v + p.pose[part][ch] * p.w, base * rest)
                  : have[have.length - 1].pose[part][ch];
            }
          }
        }
        return out;
      }
    };
    api.reset();
    return api;
  };

  /* ---- a pose joystick: each axis of a handle scrubs a source clip (-1 its start, 0 its middle, 1 its end), and what the two give is added.
     def: { x: clip, y: clip, invertX, invertY }. The handle itself can be keyed: K.anim.keys(handleKeys, t) */
  A.joystick = def => ({
    def,
    pose(handle, out) {
      out = out || {};
      for (const ax of [0, 1]) {
        const c = ax ? def.y : def.x;
        if (!c) continue;
        const h = clamp(handle[ax], -1, 1) * ((ax ? def.invertY : def.invertX) ? -1 : 1);
        A.add(out, c.sample(((h + 1) / 2) * c.dur, {}, { plain: true }), 1);
      }
      return out;
    }
  });
  /* which one of a group shows: group { parts: [...], active }; keys on the clip's solo track swap it at their times (no easing: a swap) */
  A.solo = (group, keys, time) => {
    let sel = group.active === undefined ? group.parts[0] : group.active;
    for (const k of keys || []) {
      const q = norm(k);
      if (kt(q) > time) break;
      sel = kv(q);
    }
    return sel;
  };
  A.soloPose = (group, keys, time, pose) => {
    const sel = A.solo(group, keys, time);
    for (const p of group.parts) (pose[p] || (pose[p] = {})).show = p === sel ? 1 : 0;
    return pose;
  };

  /* ---- faces: an expression, blinking and gaze, apart from whatever the body is doing */
  A.faceDefaults = () => ({
    expression: 'neutral',
    expressions: {
      neutral: { open: 1, tilt: 0 },
      focused: { open: 0.62, tilt: -0.08 },
      surprised: { open: 1.08, tilt: 0 },
      sleepy: { open: 0.3, tilt: 0 },
      worried: { open: 0.77, tilt: 0.11 },
      happy: { open: 0.42, tilt: 0 }
    },
    automatic: true,
    response: 12,
    blink: { duration: 0.25, close: 0.07, holdEnd: 0.12, open: 0.13, cycle: 14, at: [2.8, 6.9, 10.7, 10.96] },
    gaze: { mode: 'curious', response: 9, amplitude: [0.24, 0.08], frequency: [0.72, 0.51] }
  });
  A.blinkPulse = (t, d) =>
    t < 0 || t > d.duration
      ? 0
      : t < d.close
        ? smooth(t / d.close)
        : t < d.holdEnd
          ? 1
          : 1 - smooth((t - d.holdEnd) / d.open);
  A.blink = (time, forcedAt, d) => {
    const cycle = ((time % d.cycle) + d.cycle) % d.cycle;
    let b = A.blinkPulse(time - forcedAt, d);
    for (const s of d.at) b = Math.max(b, A.blinkPulse(cycle - s, d));
    return b;
  };
  A.face = def => {
    const d = Object.assign(A.faceDefaults(), def || {}),
      f = {
        def: d,
        time: 0,
        forcedAt: -Infinity,
        gaze: [0, 0],
        open: d.expressions[d.expression].open,
        tilt: d.expressions[d.expression].tilt,
        set(name) {
          if (!d.expressions[name]) throw new Error('face: no expression ' + name);
          d.expression = name;
          return f;
        },
        blink() {
          f.forcedAt = f.time;
          return f;
        },
        /* pointer: where to look, [-1..1, -1..1], when the gaze mode is 'pointer' */
        step(dt, pointer) {
          f.time += dt;
          const mood = d.expressions[d.expression],
            mix = d.response === 0 ? 1 : 1 - Math.exp(-dt * d.response);
          f.open += (mood.open - f.open) * mix;
          f.tilt += (mood.tilt - f.tilt) * mix;
          const g = d.gaze,
            target =
              g.mode === 'pointer' && pointer
                ? pointer
                : g.mode === 'curious'
                  ? g.amplitude.map((a, i) => Math.sin(f.time * g.frequency[i]) * a)
                  : [0, 0],
            follow = 1 - Math.exp(-dt * g.response);
          for (let i = 0; i < 2; i++) f.gaze[i] += (target[i] - f.gaze[i]) * follow;
          const blink = A.blink(f.time, f.forcedAt, d.automatic ? d.blink : Object.assign({}, d.blink, { at: [] }));
          return { expressionOpen: f.open, open: f.open * (1 - blink), tilt: f.tilt, gaze: f.gaze.slice(), blink };
        }
      };
    return f;
  };
  /* Timeline holds over a face. eye: what the clip keys for the eye { open, tilt, gaze }; face: what K.anim.face gave; events: [{ id, part,
     time, duration, faceControl: { open, tilt, gaze, blink, priority, release } }] where a channel is a value, or 'clip' to hand it back to
     the clip. Intervals are half open and sorted by priority, so seeking and overlaps come out the same every time */
  A.faceControl = (eye, face, events, part, time) => {
    let open = eye.open * (face.expressionOpen === undefined ? face.open : face.expressionOpen),
      tilt = eye.tilt + face.tilt,
      gaze = [eye.gaze[0] + face.gaze[0], eye.gaze[1] + face.gaze[1]],
      blink = face.blink;
    const active = (events || [])
      .filter(e => e.part === part && (e.faceControl || e.lockFace) && time >= e.time && time < e.time + e.duration)
      .sort(
        (a, b) =>
          ((a.faceControl && a.faceControl.priority) || 0) - ((b.faceControl && b.faceControl.priority) || 0) ||
          a.time - b.time ||
          String(a.id).localeCompare(String(b.id))
      );
    for (const e of active) {
      const c = e.faceControl || { open: 'clip', tilt: 'clip', gaze: [0, 0], blink: false },
        left = e.time + e.duration - time,
        w = smooth(c.release ? Math.min(1, left / c.release) : 1),
        mix = (a, b) => a + (b - a) * w;
      if (c.open !== undefined) open = mix(open, c.open === 'clip' ? eye.open : c.open);
      if (c.tilt !== undefined) tilt = mix(tilt, c.tilt === 'clip' ? eye.tilt : c.tilt);
      if (c.gaze !== undefined) gaze = gaze.map((v, i) => mix(v, c.gaze === 'clip' ? eye.gaze[i] : c.gaze[i]));
      if (c.blink !== undefined) blink = mix(blink, c.blink ? face.blink : 0);
    }
    return { open: open * (1 - blink), tilt, gaze };
  };
  /* a mouth that talks: how open (0..1) at a time, from syllables a second and a list of [start, end] spans of speech */
  A.talk = (time, spans, o) => {
    o = o || {};
    const rate = o.rate || 5.5;
    for (const s of spans) {
      if (time < s[0] || time > s[1]) continue;
      const edge = Math.min(smooth((time - s[0]) / 0.06), smooth((s[1] - time) / 0.08)),
        beat = 0.5 + 0.5 * Math.sin((time - s[0]) * rate * Math.PI * 2 - Math.PI / 2),
        vary = 0.65 + 0.35 * Math.sin((time - s[0]) * rate * 2.31 + 1.7);
      return edge * beat * vary;
    }
    return 0;
  };

  /* ---- fields in space: gusts (steady, breathing) and pulses (a ring that travels out and dies). Receivers answer late and softly.
     field: { kind: 'gust' | 'pulse', center, direction, radial, radius, strength, start, duration, velocity, frequency, speed, decay } */
  A.force = (fields, position, time) => {
    const out = position.map(() => 0);
    for (const f of fields || []) {
      if (f.enabled === false) continue;
      const age = time - (f.start || 0);
      if (age < 0 || age > (f.duration === undefined ? 1e9 : f.duration)) continue;
      const d = position.map((v, i) => v - ((f.center[i] || 0) + ((f.velocity && f.velocity[i]) || 0) * age)),
        r = Math.hypot(...d);
      if (r >= f.radius) continue;
      let gain = Math.pow(1 - r / f.radius, 2) * f.strength;
      if (f.kind === 'pulse') {
        const t = age - r / (f.speed || 200);
        if (t < 0) continue;
        gain *= Math.exp(-t * (f.decay === undefined ? 4 : f.decay));
      } else
        gain *=
          0.65 +
          0.35 *
            Math.sin(
              age * (f.frequency === undefined ? 0.8 : f.frequency) * Math.PI * 2 - (r / Math.max(1, f.radius)) * 2
            );
      for (let i = 0; i < out.length; i++)
        out[i] += gain * (f.radial ? (r ? d[i] / r : 0) : (f.direction && f.direction[i]) || 0);
    }
    return out;
  };
  A.response = (fields, position, time, receiver) => {
    receiver = receiver || {};
    const out = position.map(() => 0),
      lag = Math.max(0.01, receiver.lag === undefined ? 0.2 : receiver.lag),
      n = 12;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const age = (i * lag * 4) / (n - 1),
        w = Math.exp(-age / lag);
      sum += w;
      if (time - age < 0) continue;
      const f = A.force(fields, position, time - age);
      for (let k = 0; k < out.length; k++) out[k] += f[k] * w;
    }
    return out.map(x => (x / sum) * (receiver.strength === undefined ? 1 : receiver.strength));
  };

  /* ---- bodies that get about
     steer: walk toward a target on the ground plane and turn to face it. m: turnSpeed, turnResponse, turnTolerance, moveSpeed, moveResponse,
     minDistance, maxDistance (inside that band it stands), moveAngle (it only walks when facing within this). state is yours to keep:
     { offset [x, z], angle, velocity [x, z], angularVelocity }. at [x, z] is where the body's clip has it, forward [x, z] the way it faces at
     rest. Returns the report { position, distance, angle (still to turn), turn (turned so far) } */
  A.steer = (m, state, at, forward, target, dt) => {
    if (state.offset === undefined)
      Object.assign(state, { offset: [0, 0], angle: 0, velocity: [0, 0], angularVelocity: 0 });
    const px = at[0] + state.offset[0],
      pz = at[1] + state.offset[1],
      ca = Math.cos(state.angle),
      sa = Math.sin(state.angle),
      fx = forward[0] * ca + forward[1] * sa,
      fz = -forward[0] * sa + forward[1] * ca,
      tx = target[0] - px,
      tz = target[1] - pz,
      dist = Math.hypot(tx, tz),
      dx = dist > 1e-8 ? tx / dist : fx,
      dz = dist > 1e-8 ? tz / dist : fz,
      angle = Math.atan2(fz * dx - fx * dz, clamp(fx * dx + fz * dz, -1, 1)),
      tr = m.turnResponse === undefined ? 8 : m.turnResponse,
      err = Math.max(0, Math.abs(angle) - (m.turnTolerance === undefined ? 0.1 : m.turnTolerance)),
      want = Math.sign(angle) * Math.min(m.turnSpeed === undefined ? 2 : m.turnSpeed, err * tr);
    state.angularVelocity += (want - state.angularVelocity) * (1 - Math.exp(-tr * dt));
    let turn = state.angularVelocity * dt;
    if (Math.abs(turn) > Math.abs(angle)) {
      turn = angle;
      state.angularVelocity = 0;
    }
    state.angle += turn;
    const min = m.minDistance === undefined ? 2 : m.minDistance,
      max = m.maxDistance === undefined ? 3 : m.maxDistance,
      e = dist > max ? dist - max : dist < min ? dist - min : 0,
      mr = m.moveResponse === undefined ? 6 : m.moveResponse,
      go =
        Math.abs(angle) < (m.moveAngle === undefined ? Math.PI / 2 : m.moveAngle)
          ? Math.sign(e) * Math.min(m.moveSpeed === undefined ? 1 : m.moveSpeed, Math.abs(e) * mr)
          : 0,
      k = 1 - Math.exp(-mr * dt);
    state.velocity[0] += (dx * go - state.velocity[0]) * k;
    state.velocity[1] += (dz * go - state.velocity[1]) * k;
    state.offset[0] += state.velocity[0] * dt;
    state.offset[1] += state.velocity[1] * dt;
    return { position: [at[0] + state.offset[0], at[1] + state.offset[1]], distance: dist, angle, turn: state.angle };
  };
  /* track: turn to look along dir (in the part's own frame: x to its right, y up, z the way it faces at rest), eased, within limits.
     o: yaw [lo, hi], pitch [lo, hi] in radians, response, cone. state { yaw, pitch } is yours to keep. Returns the turn as a matrix */
  A.track = (o, state, dir, dt) => {
    if (state.yaw === undefined) {
      state.yaw = 0;
      state.pitch = 0;
    }
    const yaw = o.yaw || [-Math.PI / 2, Math.PI / 2],
      pitch = o.pitch || [-Math.PI / 4, Math.PI / 4],
      l = Math.hypot(dir[0], dir[1], dir[2]);
    if (l > 1e-6) {
      const k = 1 - Math.exp(-(o.response === undefined ? 8 : o.response) * dt);
      state.yaw += (clamp(Math.atan2(dir[0], dir[2]), yaw[0], yaw[1]) - state.yaw) * k;
      state.pitch += (clamp(Math.atan2(dir[1], Math.hypot(dir[0], dir[2])), pitch[0], pitch[1]) - state.pitch) * k;
    }
    let aim = [
      Math.sin(state.yaw) * Math.cos(state.pitch),
      Math.sin(state.pitch),
      Math.cos(state.yaw) * Math.cos(state.pitch)
    ];
    const ang = Math.acos(clamp(aim[2], -1, 1)),
      cone = o.cone === undefined ? Math.PI : o.cone;
    if (ang > cone && ang > 1e-6) {
      const s = Math.sin(cone) / Math.sin(ang);
      aim = K.V.norm([aim[0] * s, aim[1] * s, Math.cos(cone)]);
    }
    return K.M.aim([0, 0, 1], aim);
  };
  /* support: keep a body at a height over the feet that are planted, tilted to the slope they stand on. contacts: [[along, height], ...]
     (along the body's length; a stepping foot counts where it left from). o: height, at (where along the body is), maxOffset, maxTilt, tilt
     (0..1), response. state { offset, angle } is yours to keep; they ease toward what the feet ask for */
  A.support = (contacts, o, state, dt) => {
    if (!contacts.length) return state;
    let mx = 0,
      my = 0;
    for (const c of contacts) {
      mx += c[0];
      my += c[1];
    }
    mx /= contacts.length;
    my /= contacts.length;
    let vr = 0,
      cv = 0;
    for (const c of contacts) {
      vr += (c[0] - mx) * (c[0] - mx);
      cv += (c[0] - mx) * (c[1] - my);
    }
    const slope = vr > 1e-6 ? cv / vr : 0,
      ground = my + slope * ((o.at || 0) - mx),
      mo = o.maxOffset === undefined ? 100 : o.maxOffset,
      mt = o.maxTilt === undefined ? 0.6 : o.maxTilt,
      offset = clamp(ground + (o.height || 0) - (o.y || 0), -mo, mo),
      angle = clamp(Math.atan(slope), -mt, mt) * (o.tilt === undefined ? 1 : o.tilt),
      k = 1 - Math.exp(-(o.response === undefined ? 10 : o.response) * dt);
    if (state.offset === undefined) {
      state.offset = offset;
      state.angle = angle;
    } else {
      state.offset += (offset - state.offset) * k;
      state.angle += (angle - state.angle) * k;
    }
    return state;
  };
})(KIT);
