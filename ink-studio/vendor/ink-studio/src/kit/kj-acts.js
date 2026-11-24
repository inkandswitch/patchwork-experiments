/* kj-acts: clips for actions and reactions. Each is data or a small function of time, so a clip gives
   the same pose whenever it is asked: nothing is carried from frame to frame except where a state object is handed in.

   Squash and stretch on a body (as K.anim clips for one part of a puppet: pos, stretch, scale, rot)
     K.acts.KINDS                attack hurt defeat victory dodge windup heart-hurt heart-recover press denied
     K.acts.frames(kind, d)      the keys: [{ at, x, y, sx, sy, r }] (x, y in pixels of a 512 pixel figure, r in degrees, d the side: 1 or -1)
     K.acts.clip(kind, o)        the same as a clip: o.part, dur, unit (world units a pixel), d, along (the way x goes, [1, 0, 0]),
                                 keep (true: sx and sy become a stretch that keeps volume; false: scale as keyed), gain (how much
                                 more or less squash than was drawn: the stretch to that power), more (other tracks to
                                 play with it); K.acts.tracks(kind, o) gives the tracks alone
     K.acts.SEQUENCES, K.acts.poseAt(sequence, progress)   which held pose a fighter is in at a share of its action
     K.acts.hit(age, kind, dir)  what a struck thing does: { flash, x, y, lean }, kind wood | tree | building | stone
     K.acts.spin(o)              a floating idle: a slow tumble and a bob
     K.acts.breathe(t, o)        { stretch, waist }: a chest that fills and empties
   Reactions
     K.acts.REACTIONS            25 reactions: { id, label, expression, motion, duration }; K.acts.COMBAT: which a fight calls for
     K.acts.envelope(age, dur)   how an emote arrives, overshoots, settles and leaves: { scale, opacity, rise }
     K.acts.emotes()             a player: .trigger(id, { enqueue, intensity }), .update(dt) -> the reaction now, with its age
     K.acts.reactions()          the same by priority, for two sides: a hurt is not replaced by a cheer
     K.acts.accent(event)        the little body language that goes with one: { headX, headTilt, bodyY, armLift, armSpread }
   Work and impact
     K.acts.clock(kind)          an action that runs to its contact, holds there a moment (the hit stop), and finishes: .advance(dt) ->
                                 ['effort' | 'contact' | 'finish'], .phase()
     K.acts.swingFollow(p, kind) the tool's head whipping on after the blow: { headX, headY, angle }
     K.acts.smear(p, head, dur)  the smear along a fast swing: { x, y, length }, head(p) being where the tool's head is
     K.acts.harvestLift(p)       a crop pulled, lifted and settled
     K.acts.hitFlash(time, at)   how white a struck thing is: a short hold, then a soft return
     K.acts.treeFollow(age, dir) the canopy rocking after the trunk is struck;  K.acts.fell(age, dir) -> { lean, fade }
     K.acts.kick(age, strength, dur)   a camera kick: [x, y]
   Getting about
     K.acts.gait(cycle, leg)     { stride -1..1, lift 0..1, arm, planted } for a leg (0 or 1) at a point in the walk cycle (radians)
   Scenery
     K.acts.CLOUDS, K.acts.cloud(c, t)   slow separate paths that never wrap
     K.acts.butterflies(patch, age, n)   visitors round a patch: [{ x, y, z, alpha }]
     K.acts.leaf(leaf, t, floor) a leaf let go: { p, spin, scale [x, y], done }; K.acts.newLeaf(origin, dir, seed)
     K.acts.bird(f, t)           a flight from f.from to f.to with an arc: { x, y, z, t, q } */
(function (K) {
  const c01 = x => (x < 0 ? 0 : x > 1 ? 1 : x),
    smooth = x => {
      x = c01(x);
      return x * x * (3 - 2 * x);
    };
  const T = (K.acts = {});

  /* ---- held poses and the dense keys that carry a body between them */
  T.POSES = ['idle', 'anticipate', 'windup', 'attack', 'reach', 'recover', 'hurt', 'recoil', 'victory', 'defeat'];
  T.SEQUENCES = {
    windup: [
      [0, 'idle'],
      [0.16, 'anticipate'],
      [0.42, 'windup'],
      [0.76, 'anticipate'],
      [1, 'idle']
    ],
    attack: [
      [0, 'windup'],
      [0.12, 'attack'],
      [0.27, 'reach'],
      [0.43, 'attack'],
      [0.58, 'recover'],
      [0.82, 'anticipate'],
      [1, 'idle']
    ],
    hurt: [
      [0, 'hurt'],
      [0.25, 'recoil'],
      [0.43, 'hurt'],
      [0.58, 'recoil'],
      [0.79, 'recover'],
      [1, 'idle']
    ],
    defeat: [
      [0, 'hurt'],
      [0.25, 'recoil'],
      [0.5, 'defeat'],
      [1, 'defeat']
    ],
    dodge: [
      [0, 'anticipate'],
      [0.25, 'windup'],
      [0.65, 'recover'],
      [1, 'idle']
    ],
    victory: [
      [0, 'anticipate'],
      [0.2, 'victory'],
      [1, 'victory']
    ]
  };
  T.poseAt = (sequence, progress) => {
    let pose = sequence[0][1];
    for (const s of sequence) {
      if (s[0] > progress) break;
      pose = s[1];
    }
    return pose;
  };
  /* x, y, sx, sy, r, at. y is down the screen, as it was drawn */
  const FR = {
    attack: [
      [-5, 0, 1.06, 0.93, -2, 0],
      [-8, 2, 1.1, 0.86, -3, 0.1],
      [12, -3, 0.94, 1.08, 2, 0.2],
      [28, -2, 1.12, 0.91, 5, 0.3],
      [21, 0, 1.06, 0.97, 3, 0.43],
      [12, 0, 0.95, 1.06, 1, 0.58],
      [5, 1, 1.04, 0.96, -1, 0.73],
      [1, -1, 0.985, 1.02, 0, 0.87],
      [0, 0, 1, 1, 0, 1]
    ],
    hurt: [
      [0, 2, 1.2, 0.75, 0, 0],
      [-12, -5, 0.88, 1.12, -6, 0.12],
      [-23, -8, 0.78, 1.2, -11, 0.24],
      [-18, -2, 0.95, 1.04, -8, 0.36],
      [-10, 3, 1.17, 0.82, -4, 0.48],
      [-6, -2, 0.92, 1.08, 2, 0.62],
      [-3, 1, 1.06, 0.95, -1, 0.76],
      [-1, -1, 0.99, 1.025, 0, 0.9],
      [0, 0, 1, 1, 0, 1]
    ],
    victory: [
      [0, 0, 1, 1, 0, 0],
      [0, 3, 1.14, 0.82, 0, 0.15],
      [0, -12, 0.9, 1.13, -3, 0.28],
      [0, -24, 0.96, 1.05, 2, 0.4],
      [0, -11, 1, 1, 1, 0.55],
      [0, 3, 1.12, 0.86, 0, 0.7],
      [0, -3, 0.96, 1.06, 0, 0.84],
      [0, 0, 1, 1, 0, 1]
    ],
    dodge: [
      [0, 0, 1, 1, 0, 0],
      [-8, -1, 0.95, 1.05, -3, 0.18],
      [-22, -2, 0.9, 1.07, -7, 0.4],
      [-16, 0, 1.04, 0.95, -3, 0.62],
      [-5, 0, 0.98, 1.02, 0, 0.83],
      [0, 0, 1, 1, 0, 1]
    ],
    windup: [
      [0, 0, 1, 1, 0, 0],
      [-2, 0, 1.02, 0.98, -1, 0.18],
      [-5, 1, 1.06, 0.94, -2, 0.4],
      [-6, 2, 1.09, 0.91, -3, 0.55],
      [-3, 0, 0.98, 1.02, -1, 0.78],
      [0, 0, 1, 1, 0, 1]
    ],
    /* a heart lost: flattened, flung up thin, slapped down, and settled */
    'heart-hurt': [
      [0, 0, 1.65, 0.4, 0, 0],
      [0, -16, 0.58, 1.62, -8, 0.23],
      [0, 3, 1.45, 0.52, 8, 0.46],
      [0, -6, 0.8, 1.25, -5, 0.65],
      [0, 0, 1.12, 0.88, 0, 0.83],
      [0, 0, 1, 1, 0, 1]
    ],
    'heart-recover': [
      [0, 0, 0.55, 0.9, 0, 0],
      [0, -7, 1.2, 1.12, 0, 0.35],
      [0, 0, 0.96, 1.05, 0, 0.7],
      [0, 0, 1, 1, 0, 1]
    ],
    /* a button pressed and springing back; one that will not go, shaking its head */
    press: [
      [0, 2, 1.08, 0.84, 0, 0],
      [0, -3, 0.97, 1.08, 0, 0.4],
      [0, 0, 1.02, 0.98, 0, 0.7],
      [0, 0, 1, 1, 0, 1]
    ],
    denied: [
      [0, 0, 1.04, 0.92, 0, 0],
      [-6, 0, 0.98, 1.03, -2, 0.18],
      [5, 0, 1.02, 0.97, 1.6, 0.38],
      [-3, 0, 0.99, 1.01, -1, 0.58],
      [1, 0, 1, 1, 0.4, 0.78],
      [0, 0, 1, 1, 0, 1]
    ]
  };
  FR.defeat = FR.hurt;
  T.KINDS = Object.keys(FR);
  const DUR = {
    attack: 0.62,
    hurt: 0.55,
    defeat: 0.55,
    victory: 0.9,
    dodge: 0.5,
    windup: 0.6,
    'heart-hurt': 0.68,
    'heart-recover': 0.42,
    press: 0.28,
    denied: 0.3
  };
  T.frames = (kind, d) => {
    const rows = FR[kind] || FR.windup;
    d = d === undefined ? 1 : d;
    return rows.map(r => ({ at: r[5], x: r[0] * d, y: r[1], sx: r[2], sy: r[3], r: r[4] * d }));
  };
  /* the tracks alone, to put beside others in a clip of your own */
  T.tracks = (kind, o) => {
    o = o || {};
    const part = o.part || 'body',
      dur = o.dur || DUR[kind] || 0.6,
      unit = o.unit === undefined ? 1 / 180 : o.unit,
      along = o.along || [1, 0, 0],
      fr = T.frames(kind, o.d),
      keep = o.keep !== false,
      gain = o.gain === undefined ? 1 : o.gain,
      /* the turn is about the axis that looks at the viewer when `along` is to the right */
      spin = K.V.norm(K.V.cross(along, [0, 1, 0]), [0, 0, 1]),
      tracks = {};
    tracks[part + '.pos'] = fr.map(f => [f.at * dur, [along[0] * f.x * unit, -f.y * unit, along[2] * f.x * unit]]);
    if (keep) tracks[part + '.stretch'] = fr.map(f => [f.at * dur, Math.pow(Math.sqrt(f.sy / f.sx), gain)]);
    else tracks[part + '.scale'] = fr.map(f => [f.at * dur, [f.sx, f.sy, f.sx]]);
    tracks[part + '.rot'] = fr.map(f => [f.at * dur, [-spin[0] * f.r, -spin[1] * f.r, -spin[2] * f.r]]);
    return tracks;
  };
  T.DUR = DUR;
  T.clip = (kind, o) => {
    o = o || {};
    return K.anim.clip({
      id: kind,
      dur: o.dur || DUR[kind] || 0.6,
      loop: false,
      tracks: Object.assign(T.tracks(kind, o), o.more || {}),
      cues: o.cues,
      tools: o.tools,
      parents: o.parents
    });
  };
  T.spin = o => {
    o = o || {};
    const part = o.part || 'body',
      dur = o.dur || 8,
      tracks = {};
    tracks[part + '.rot'] = [
      [0, [16, 0, 12], 'linear'],
      [dur, [376, 720, 372], 'linear']
    ];
    tracks[part + '.pos'] = Array.from({ length: 33 }, (_, i) => [
      (i / 32) * dur,
      [0, (o.bob === undefined ? 0.09 : o.bob) * Math.sin((i / 32) * Math.PI * 4), 0]
    ]);
    return K.anim.clip({ id: 'spin', dur, loop: true, tracks });
  };
  T.breathe = (t, o) => {
    o = o || {};
    const k = o.k === undefined ? 0.03 : o.k,
      s = Math.sin(t * (o.rate || 1.6) + (o.phase || 0));
    return { stretch: 1 + k * 0.5 * s, waist: -k * 2 * (0.5 + 0.5 * s) };
  };
  T.hit = (age, kind, direction) => {
    const t = Math.max(0, age - 0.045),
      wave = Math.cos(t * 31) * Math.exp(-t * 13),
      on = t < 0.45,
      kx = kind === 'tree' ? 0.025 : kind === 'building' ? 0.015 : kind === 'stone' ? 0.025 : 0.1,
      ky = kind === 'tree' ? 0.015 : kind === 'building' ? 0.018 : kind === 'stone' ? 0.035 : 0.14;
    return {
      flash: age < 0.1 ? 1 : 0,
      x: on ? 1 + kx * wave : 1,
      y: on ? 1 - ky * wave : 1,
      lean: kind === 'tree' && on ? -(direction === undefined ? 1 : direction) * 0.065 * wave : 0
    };
  };

  /* ---- reactions */
  T.REACTIONS = [
    ['cold', 'Brr, cold', 'worried', 'shiver'],
    ['overheated', 'Too hot', 'yawning', 'steam'],
    ['surprise', 'Oh!', 'surprised', 'spring'],
    ['confused', 'Huh?', 'confused', 'curl'],
    ['romance-declined', 'Not seeking romance', 'neutral', 'rumble'],
    ['love', 'Love', 'adoring', 'heartbeat'],
    ['delight', 'Delighted', 'excited', 'twinkle'],
    ['idea', 'An idea!', 'inspired', 'sprout'],
    ['nervous', 'Nervous', 'bashful', 'droplet'],
    ['grumpy', 'Grumpy', 'grumpy', 'rumble'],
    ['determined', 'Determined', 'determined', 'steam'],
    ['disappointed', 'Disappointed', 'sad', 'droop'],
    ['humming', 'Humming', 'singing', 'notes'],
    ['sleepy', 'Sleepy', 'sleepy', 'sleep'],
    ['thinking', 'Thinking', 'thinking', 'dots'],
    ['dizzy', 'Dizzy', 'dizzy', 'spiral'],
    ['heartbroken', 'Heartbroken', 'crying', 'broken'],
    ['proud', 'Proud', 'smug', 'crown'],
    ['divine', 'A god noticed me', 'awed', 'ink'],
    ['hungry', 'Food, please', 'eager', 'sniff'],
    ['empty-bowl', 'Hungry', 'pleading', 'rattle'],
    ['rest', 'Need a rest', 'yawning', 'sleep'],
    ['work', 'Ready to work', 'determined', 'tap'],
    ['missing-plank', 'Need wood', 'confused', 'rattle'],
    ['witch-hunt', 'Witch hunt', 'angry', 'accuse']
  ].map(r => ({ id: r[0], label: r[1], expression: r[2], motion: r[3], duration: 3.4 }));
  T.reaction = id => T.REACTIONS.find(r => r.id === id);
  T.FEEL = { appear: 0.18, exit: 0.35, overshoot: 0.17, overshootTime: 0.45, decay: 2, shrink: 0.12, rise: 0.07 };
  T.envelope = (age, duration) => {
    duration = duration === undefined ? 3.4 : duration;
    const F = T.FEEL,
      appear = smooth(age / F.appear),
      exit = smooth((age - (duration - F.exit)) / F.exit);
    return {
      scale:
        appear *
        (1 + F.overshoot * Math.sin(Math.min(age / F.overshootTime, 1) * Math.PI) * Math.exp(-age * F.decay)) *
        (1 - F.shrink * exit),
      opacity: appear * (1 - exit),
      rise: F.rise * exit
    };
  };
  T.emotes = () => {
    const pl = {
      active: null,
      queue: [],
      sequence: 0,
      trigger(id, o) {
        o = o || {};
        const r = T.reaction(id);
        if (!r) throw new Error('unknown reaction: ' + id);
        const k = o.intensity,
          ev = {
            id,
            motion: r.motion,
            expression: o.expression || r.expression,
            duration: r.duration,
            intensity: Math.max(0.25, Math.min(1.5, isFinite(k) ? k : 1))
          };
        if (o.enqueue && pl.active) {
          if (pl.queue.length >= 6) pl.queue.shift();
          pl.queue.push(ev);
          return pl;
        }
        pl.active = Object.assign(ev, { age: 0, sequence: ++pl.sequence });
        if (!o.enqueue) pl.queue.length = 0;
        return pl;
      },
      clear() {
        pl.active = null;
        pl.queue.length = 0;
      },
      update(dt) {
        while (pl.active) {
          const left = pl.active.duration - pl.active.age;
          if (dt < left) {
            pl.active.age += dt;
            break;
          }
          dt -= left;
          pl.active = null;
          const next = pl.queue.shift();
          if (next) pl.trigger(next.id, { intensity: next.intensity, expression: next.expression, enqueue: true });
        }
        return pl.active;
      }
    };
    return pl;
  };
  T.COMBAT = {
    ready: { icon: 'determined', duration: 1.2, priority: 1 },
    hit: { icon: 'proud', duration: 1.3, priority: 1 },
    perfect: { icon: 'delight', duration: 1.4, priority: 1 },
    miss: { icon: 'grumpy', duration: 1.2, priority: 1 },
    skip: { icon: 'confused', duration: 1, priority: 1 },
    low: { icon: 'disappointed', duration: 1.3, priority: 1 },
    dodge: { icon: 'surprise', duration: 1.1, priority: 1 },
    hurt: { icon: 'dizzy', duration: 1.15, priority: 3 },
    death: { icon: 'heartbroken', duration: 2.6, priority: 4 },
    victory: { icon: 'delight', duration: 2.4, priority: 4, delay: 0.28 }
  };
  T.reactions = () => {
    const st = {
      events: {},
      trigger(side, kind, now) {
        const spec = T.COMBAT[kind];
        if (!spec) throw new Error('unknown combat reaction ' + kind);
        const cur = st.events[side];
        if (cur && now - cur.at < cur.duration && cur.priority > spec.priority) return null;
        return (st.events[side] = Object.assign({ kind, at: now, motion: T.reaction(spec.icon).motion }, spec));
      },
      /* what a side shows now: the event, its age, its envelope and the wobble of the icon (degrees) */
      at(side, now) {
        const e = st.events[side];
        if (!e) return null;
        const age = now - e.at;
        if (age >= e.duration) {
          st.events[side] = null;
          return null;
        }
        return {
          event: e,
          age,
          envelope: T.envelope(age, e.duration),
          wobble: Math.sin(age * (e.kind === 'hurt' ? 22 : 6)) * Math.exp(-age * 2) * (e.kind === 'hurt' ? 7 : 3)
        };
      },
      clear() {
        st.events = {};
      }
    };
    return st;
  };
  T.PERFORMANCE = {
    smear: { threshold: 850, maxLength: 48, headWeight: 1.6 },
    follow: { work: 1, chop: 0.82, mine: 0.58, fight: 0.55, delay: 0.012, decay: 24 },
    tools: { work: { raiseX: 0, raiseY: 0 }, chop: { raiseX: -12, raiseY: 18 }, mine: { raiseX: 22, raiseY: 42 } },
    gait: { swingFraction: 0.44, stride: 34, lift: 24, loadedStride: 0.78, loadedLift: 0.65 },
    tree: { lag: 0.085, amplitude: 0.085, decay: 7.5, frequency: 19 },
    gestures: { strength: 1 }
  };
  const P = T.PERFORMANCE;
  T.accent = ev => {
    const out = { headX: 0, headTilt: 0, bodyY: 0, armLift: 0, armSpread: 0 };
    if (!ev) return out;
    const t = ev.age,
      g = (ev.intensity === undefined ? 1 : ev.intensity) * P.gestures.strength,
      pulse = (a, b) => smooth((t - a) / 0.18) * (1 - smooth((t - b) / 0.35));
    if (ev.id === 'love' || ev.id === 'nervous') {
      const glance = pulse(0.02, 0.62),
        shy = pulse(0.42, 1.55);
      out.headX = 5 * glance - 4 * shy;
      out.headTilt = -0.07 * glance + 0.07 * shy;
      out.bodyY = 4 * shy;
      out.armLift = 0.1 * shy;
      out.armSpread = -0.12 * shy;
    } else if (ev.id === 'confused' || ev.id === 'missing-plank' || ev.id === 'empty-bowl') {
      const shrug = pulse(0.3, 1.1);
      out.armLift = 0.22 * shrug;
      out.armSpread = 0.14 * shrug;
      out.bodyY = -5 * shrug;
      out.headTilt = -0.06 * pulse(0.02, 0.35);
    } else if (ev.id === 'proud' || ev.id === 'delight' || ev.id === 'idea') {
      out.headTilt = 0.07 * pulse(0.65, 1.1);
      out.bodyY = 3 * pulse(0.8, 1.3);
    }
    for (const k in out) out[k] *= g;
    return out;
  };

  /* ---- work and impact */
  T.ACTION = {
    duration: { shoot: 2.4, till: 2.4, fight: 1.7, work: 3.4, chop: 2.5, mine: 2.7, harvest: 2.6 },
    contact: { shoot: 0.58, till: 0.52, fight: 0.515, work: 0.515, chop: 0.515, mine: 0.515, harvest: 0.55 },
    hitStop: 0.045,
    effort: 0.39
  };
  T.clock = (kind, phase) => {
    kind = kind || 'work';
    const dur = T.ACTION.duration[kind],
      contact = dur * T.ACTION.contact[kind];
    if (!dur) throw new Error('unknown action ' + kind);
    const c = {
      kind,
      time: (phase || 0) * dur,
      hold: 0,
      hit: (phase || 0) >= T.ACTION.contact[kind],
      effort: (phase || 0) >= T.ACTION.effort,
      finished: false,
      phase: () => Math.min(1, c.time / dur),
      advance(dt) {
        const ev = [];
        if (c.finished) return ev;
        let step = Math.max(0, dt);
        if (c.hold > 0) {
          const used = Math.min(c.hold, step);
          c.hold -= used;
          step -= used;
        }
        const next = c.time + step;
        if (!c.effort && next >= dur * T.ACTION.effort) {
          c.effort = true;
          ev.push('effort');
        }
        if (!c.hit && next >= contact) {
          c.time = contact;
          c.hit = true;
          c.hold = T.ACTION.hitStop;
          ev.push('contact');
          return ev;
        }
        c.time = Math.min(dur, next);
        if (c.time >= dur) {
          c.finished = true;
          ev.push('finish');
        }
        return ev;
      }
    };
    return c;
  };
  T.swingFollow = (p, kind) => {
    const t = p - 0.552 - P.follow.delay,
      gain = P.follow[kind || 'work'] || 0,
      wave = t > 0 ? Math.sin(t * 60) * Math.exp(-t * P.follow.decay) * gain : 0;
    return { headY: wave * 13, headX: -wave * 5, angle: -wave * 0.045 };
  };
  T.smear = (p, head, duration) => {
    if (p <= 0.44 || p >= 0.515) return { x: 0, y: 0, length: 0 };
    const a = head(Math.max(0.44, p - 0.002)),
      b = head(Math.min(0.515, p + 0.002)),
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      d = Math.hypot(dx, dy),
      speed = d / (0.004 * duration),
      gate = smooth((p - 0.44) / 0.025) * (1 - smooth((p - 0.503) / 0.012)),
      length = Math.min(P.smear.maxLength, Math.max(0, speed - P.smear.threshold) * 0.025) * gate;
    return { x: d ? dx / d : 0, y: d ? dy / d : 0, length };
  };
  T.harvestLift = p =>
    145 * smooth((p - 0.55) / 0.065) +
    12 * smooth((p - 0.6) / 0.025) -
    12 * smooth((p - 0.66) / 0.04) -
    22 * smooth((p - 0.69) / 0.13);
  T.hitFlash = (time, hitAt) => {
    const age = time - (hitAt === undefined ? -Infinity : hitAt);
    if (age < 0 || age >= 0.05 + 0.13) return 0;
    return 0.85 * (1 - smooth(Math.max(0, (age - 0.05) / 0.13)));
  };
  T.treeFollow = (age, direction) => {
    const t = age - P.tree.lag;
    return t > 0 && t < 1.2
      ? (direction === undefined ? 1 : direction) *
          P.tree.amplitude *
          Math.sin(t * P.tree.frequency) *
          Math.exp(-t * P.tree.decay)
      : 0;
  };
  /* a felled tree: after a short wait it leans over (radians) and then fades */
  T.fell = (age, direction) => {
    const a = age - 0.2;
    if (a < 0) return { lean: 0, fade: 1, landed: false };
    return {
      lean: -(direction === undefined ? 1 : direction) * 1.5 * smooth(a / 1.05),
      fade: 1 - smooth((a - 0.83) / 0.45),
      landed: a >= 0.8
    };
  };
  T.kick = (age, strength, duration) => {
    duration = duration || 0.065;
    if (age < 0 || age >= duration) return [0, 0];
    const e = Math.pow(1 - age / duration, 2);
    return [Math.sin(age * 230) * strength * e, Math.cos(age * 170) * strength * e];
  };

  /* ---- walking */
  T.gait = (cycle, leg) => {
    const span = P.gait.swingFraction,
      q = ((((cycle + leg * Math.PI) / (Math.PI * 2) + span / 2) % 1) + 1) % 1;
    if (q < span) {
      const u = q / span,
        stride = -1 + 2 * smooth(u);
      return { stride, lift: Math.pow(Math.sin(Math.PI * u), 1.5), arm: -stride, planted: false };
    }
    const stride = 1 - (2 * (q - span)) / (1 - span);
    return { stride, lift: 0, arm: -stride, planted: true };
  };

  /* ---- scenery */
  T.CLOUDS = [
    { art: 'cumulus', x: -5.1, y: 8.2, z: -5.1, width: 4.4, drift: 2.2, period: 370, phase: 0.2, meander: 0.32 },
    { art: 'wisp', x: 0.3, y: 9.2, z: -7.5, width: 4.6, drift: 2.7, period: 460, phase: 1.1, meander: 0.42 },
    { art: 'pufflet', x: 6.8, y: 8.8, z: -6, width: 2.2, drift: 1.8, period: 330, phase: 2.2, meander: 0.25 },
    { art: 'twins', x: -10, y: 9.2, z: -5.2, width: 3.8, drift: 2.5, period: 510, phase: 3.4, meander: 0.4 },
    { art: 'tower', x: 10.5, y: 10.2, z: -8, width: 2.7, drift: 1.9, period: 420, phase: 4.6, meander: 0.3 },
    { art: 'cushion', x: -1.7, y: 10.5, z: -12, width: 4.1, drift: 3.1, period: 590, phase: 0.7, meander: 0.5 },
    { art: 'clover', x: -14, y: 8.8, z: -9, width: 3.1, drift: 2.3, period: 480, phase: 2.8, meander: 0.35 },
    { art: 'patchwork', x: 13.5, y: 9, z: -3.5, width: 4, drift: 2.8, period: 540, phase: 5.3, meander: 0.45 },
    { art: 'dumpling', x: -7.5, y: 8.8, z: 0.5, width: 2.6, drift: 1.7, period: 390, phase: 1.8, meander: 0.28 }
  ];
  T.cloud = (c, time, rate) => {
    const ang = (time * (rate === undefined ? 1.6 : rate) * Math.PI * 2) / c.period,
      ph = c.phase;
    return [
      c.x + c.drift * (Math.sin(ang + ph) - Math.sin(ph)),
      c.y,
      c.z + c.meander * (Math.sin(ang * 0.73 + ph * 1.6) - Math.sin(ph * 1.6))
    ];
  };
  /* visitors to a patch { x, z, floor }: they come in, wander and settle for `visit` seconds, and go */
  T.butterflies = (patch, age, n, visit) => {
    visit = visit || 48;
    if (age < 0 || age >= visit) return [];
    const alpha = smooth(age / 5) * smooth((visit - age) / 6);
    return Array.from({ length: n || 3 }, (_, i) => {
      const ph = age * 0.62 + i * 2.4,
        drift = age * 0.16 + i,
        settle = 0.5 + 0.5 * Math.sin(age * 0.23 + i * 1.8);
      return {
        x: patch.x + Math.sin(ph) * 1.5 + Math.sin(drift) * 0.45,
        z: patch.z + Math.cos(ph * 0.73) * 1.15 + Math.sin(drift * 0.8) * 0.35,
        y: (patch.floor || 0) + 0.8 + settle * 1.2 + Math.sin(ph * 1.8) * 0.16,
        alpha,
        flap: Math.sin(age * 14 + i * 1.3)
      };
    });
  };
  T.newLeaf = (origin, direction, seed) => {
    const h = k => K.hash(seed, k);
    return {
      origin: origin.slice(),
      life: 3.5 + h(1),
      vx: (direction === undefined ? 1 : direction) * (0.15 + h(2) * 0.22),
      vz: (h(3) - 0.5) * 0.14,
      phase: h(4) * Math.PI * 2,
      size: 0.9 + h(5) * 0.65,
      landAt: null
    };
  };
  /* a leaf at age t over ground at height floor: a little lift, then down, fluttering across and turning edge on as it goes */
  T.leaf = (leaf, t, floor) => {
    floor = floor || 0;
    const flutter = Math.sin(t * 5 + leaf.phase) - Math.sin(leaf.phase),
      dx = leaf.vx * t + flutter * 0.12,
      dz = leaf.vz * t,
      y = leaf.origin[1] + 0.24 * (1 - Math.exp(-t * 6)) - 0.32 * t - 0.36 * t * t,
      down = y <= floor + 0.03;
    if (down && leaf.landAt === null) leaf.landAt = t;
    const settle = Math.min(1, (leaf.life - t) / 0.35, leaf.landAt === null ? 1 : 1 - (t - leaf.landAt) / 0.45);
    return {
      p: [leaf.origin[0] + dx, Math.max(floor + 0.03, y), leaf.origin[2] + dz],
      spin: Math.sin(t * 4 + leaf.phase) * 0.65 + leaf.phase,
      scale: [
        leaf.size * (0.45 + 0.55 * Math.abs(Math.cos(t * 5 + leaf.phase))) * Math.max(0, settle),
        leaf.size * Math.max(0, settle)
      ],
      done: t >= leaf.life || (leaf.landAt !== null && t - leaf.landAt > 0.45)
    };
  };
  T.bird = (f, time) => {
    const delay = f.takeoffDuration || 0,
      t = c01((time - f.at - delay) / Math.max(0.1, f.duration - delay)),
      q = t * t * (3 - 2 * t);
    return {
      x: f.from.x + (f.to.x - f.from.x) * q,
      z: f.from.z + (f.to.z - f.from.z) * q,
      y: f.from.y + (f.to.y - f.from.y) * q + Math.sin(Math.PI * q) * f.arc,
      t,
      q
    };
  };
})(KIT);
