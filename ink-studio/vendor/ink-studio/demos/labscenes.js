// =====================================================================
// The lab's own dioramas. Each one is there to exercise a set of KIT modules where they can be seen, and each answers to a tap.
// =====================================================================
// a little shudder of the view: st.kick is read by the page
function labShake(st) {
  const k = (st.kick = [0, 0, 0]);
  let amt = 0;
  return {
    hit(a) {
      amt = Math.max(amt, a);
    },
    update(dt, t) {
      amt *= Math.max(0, 1 - 7 * dt);
      k[0] = amt * Math.sin(t * 61);
      k[1] = amt * Math.sin(t * 47 + 1);
      k[2] = 0;
      if (amt < 0.002) amt = 0;
    }
  };
}

// ---------------------------------------------------------------------
// Die Watcher: a die with an eye on one face. It hops, tumbles a quarter turn in the air and lands with a thud. The eye is flat artwork
// that lives on the face: it turns and squashes with the die, and looks about and blinks by itself.
// ---------------------------------------------------------------------
function sceneWatcher(seed) {
  const K = KIT,
    V = K.V,
    M = K.M,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x15171c, 0x2a2e36, 0x474d57, 0x6d747c, 0x9aa09c, 0x2a1638, 0x4a2760, 0x7a4296, 0xb070c4, 0xe2b8e8,
        0xf2ecd0, 0xffd24a, 0xff7a2a, 0xd9a441, 0x8a8478, 0xfff3c0, 0xc8321e
      ]
    );
  const S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    cap = K.light.capture(B, S);
  S.sun = B.norm([-0.4, 0.78, 0.5]);
  S.res = 0.1;
  S.amb = 0.15;
  S.sky = 0.26;
  const ST = { r: [1, 2, 2, 3, 4, 5], mod: (x, y, z) => 0.22 * (B.n3(x * 0.7, y * 0.7, z * 0.7) - 0.5) },
    H = { hold: true },
    TOP = 1.2,
    HS = 1.55,
    C0 = [0, TOP + HS, 0];
  S.ground({ r: [1, 1, 2, 2, 3] }, { rad: 11, zs: 1.3, res: 0.15 });
  // the dais: a block that goes down to the floor in steps on every side, with a ring of short posts round it and two twisted columns behind
  S.join('stairs', S.box([0, TOP / 2, 0], [2.6, TOP / 2, 2.6], ST, H), S.box([0, -0.5, 0], [6, 0.5, 6], ST, H), {
    r: 1.25,
    n: 4,
    res: 0.085
  });
  S.fold(S.lathe([5.4, 0, 0], 1.0, [0.26, 0.18], ST, H), { polar: 10, c: [0, 0, 0] }, { res: 0.08 });
  S.fold(S.ball([5.4, 1.12, 0], 0.24, ST, H), { polar: 10, c: [0, 0, 0] }, { res: 0.07 });
  for (const sx of [-1, 1]) {
    const col = S.lathe([sx * 4.4, 0, -4.6], 6.2, 0.62, ST, H),
      flutes = S.fold(S.lathe([sx * 4.4 + 0.62, 0.5, -4.6], 5.2, 0.13, ST, H), { polar: 6, c: [sx * 4.4, 0, -4.6] }, H);
    S.warp(S.join('cut', col, flutes, H), { twist: sx * 0.55, c: [sx * 4.4, 0, -4.6], wide: 0.7 }, { res: 0.075 });
    S.lathe([sx * 4.4, 6.2, -4.6], 0.5, [0.9, 0.75], ST, { res: 0.08 });
    S.lathe([sx * 4.4, 0, -4.6], 0.45, [0.95, 0.75], ST, { res: 0.08 });
  }
  S.bake();
  // The die is made by itself, afterwards, and whole: all six faces, and no hole or baked shadow left on the dais where it happened to be standing
  const die = S.regular(
    'd6',
    C0,
    HS,
    { r: [6, 7, 7, 8, 9, 10], mod: (x, y, z) => 0.1 * (B.n3(x * 1.3, y * 1.3, z * 1.3) - 0.5) },
    { rd: 0.24, res: 0.07, tag: 'die', whole: true }
  );
  S.bake();
  const pool = K.pool(B, 520),
    W = B.finish({
      cam: { target: [0, 3.4, 0], dist: 21, pitch: 0.16, yaw: 0.42, sway: 0.25 },
      detail: 12,
      palName: 'Watcher',
      dither: 0.25,
      radius: 12
    }),
    st = K.stage(W);
  rig.bind(st);
  // ---- the artwork. An eye on four faces: a white, an iris and pupil that wander, all of it closing to a line when it blinks; `glare` narrows it
  const mood = { glare: 0 },
    lid = t => Math.max(Math.max(0, 1 - 7 * Math.abs((t % 4.3) - 4.1)), mood.glare * 0.5),
    gx = t => 13 * Math.sin(t * 1.1),
    gy = t => 6 * Math.sin(t * 0.7 + 1),
    shut = (t, extra) => Object.assign({ sy: Math.max(0.04, 1 - lid(t)), px: 50, py: 50 }, extra);
  const eye = K.art({
    shapes: [
      { d: 'M2 50 C18 10 82 10 98 50 C82 90 18 90 2 50 Z', fill: 6, key: t => shut(t) },
      { d: 'M6 50 C22 16 78 16 94 50 C78 84 22 84 6 50 Z', fill: 11, key: t => shut(t) },
      {
        circle: [50, 50, 22],
        fill: 12,
        key: t => shut(t, { tx: gx(t), ty: gy(t) * (1 - lid(t)), fill: mood.glare > 0.3 ? 13 : 12 })
      },
      {
        circle: [50, 50, 10],
        fill: 0,
        key: t => shut(t, { tx: gx(t), ty: gy(t) * (1 - lid(t)), sx: 1 - 0.5 * mood.glare })
      },
      { circle: [44, 43, 4], fill: 11, key: t => shut(t, { tx: gx(t), ty: gy(t) * (1 - lid(t)), hide: lid(t) > 0.5 }) }
    ]
  });
  const pips = n =>
    K.art({
      shapes: [
        [50, 50],
        [24, 24],
        [76, 76],
        [76, 24],
        [24, 76],
        [24, 50],
        [76, 50]
      ]
        .slice(n % 2 ? 0 : 1, (n % 2 ? 0 : 1) + n)
        .map(p => ({ circle: [p[0], p[1], 9], fill: 14 }))
    });
  const face = n => die.faces.find(f => V.dot(f.n, n) > 0.9);
  // (the die only ever tumbles forward, top face coming round to the front: each eye is set so that it arrives the right way up)
  const art = K.art.faces(
    st,
    [
      [[0, 0, 1], eye, 0.9, 0],
      [[0, 1, 0], eye, 0.9, 0],
      [[0, 0, -1], eye, 0.9, Math.PI],
      [[0, -1, 0], eye, 0.9, 0],
      [[1, 0, 0], pips(3), 0.8, 0],
      [[-1, 0, 0], pips(4), 0.8, 0]
    ].map(e => ({ face: face(e[0]), art: e[1], size: e[2], turn: e[3], part: 'die' }))
  );
  // ---- how it moves. It gathers itself (squash), leaves the ground, turns a quarter in the air stretched along its path, and lands: the landing kicks
  // a spring, so it squashes hard, rebounds past its own height and settles. Height is a real throw (up fast, hang, down fast), not an eased slide.
  const AX = [1, 0, 0],
    RISE = 3.3,
    AIR = 0.7,
    ps = K.particles(st, pool, { ground: (x, z) => (Math.max(Math.abs(x), Math.abs(z)) < 2.6 ? TOP : 0) }),
    shake = labShake(st),
    lamp = { p: [0, 4, 4], r: 7, s: 0.26 };
  const lit = K.light.system(st, cap, [lamp], {
      sun: { dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK, parts: ['die'] }
    }),
    sq = K.spring(1, 480, 0.34),
    shade = K.shape.sphere([0, TOP - 1.2, 0], 3.2),
    under = K.field({ soft: 0.5, shapes: [{ shape: shade, color: [0.5, 0.5, 0.56] }] });
  let Q = M.id(),
    hops = 0,
    mode = 'idle',
    clock = 0,
    lastR = 0;
  const go = m => {
      mode = m;
      clock = 0;
    },
    land = () => {
      sq.kick(-9);
      ps.dust([0, TOP, 0], 34, [15, 4, 3], 3.4);
      ps.ring([0, TOP + 0.06, 0], 3.6, [5, 4, 3], 52, 0.5);
      ps.chips([0, TOP, 0], 10, [4, 3, 15], null, 3);
      shake.hit(0.2);
      Q = M.mul(M.rot(AX, Math.PI / 2), Q);
      hops++;
    };
  st.add(K.fx.reveal(st, { auto: true, dur: 1.4, block: 0.6 }));
  st.add({
    update(dt, t) {
      clock += dt;
      mood.glare = Math.max(0, mood.glare - dt * 1.3);
      let lift = 0,
        turn = 0,
        want = 1 + 0.025 * Math.sin(t * 2.1);
      if (mode === 'idle' && clock > 2.1) go('crouch');
      if (mode === 'crouch') {
        want = 1 - 0.3 * K.ease.out(clock / 0.26);
        if (clock > 0.26) {
          go('air');
          sq.kick(7);
          ps.dust([0, TOP, 0], 10, [15, 4], 1.6);
        }
      }
      if (mode === 'air') {
        const u = clock / AIR;
        if (u >= 1) {
          land();
          go('idle');
        } else {
          lift = 4 * RISE * u * (1 - u);
          turn = K.ease.inout3(K.clamp((u - 0.08) / 0.84, 0, 1));
          want = 1 + 0.2 * Math.abs(1 - 2 * u);
        }
      }
      const s = K.clamp(sq.step(want, dt), 0.5, 1.5),
        R = mode === 'air' ? M.mul(M.rot(AX, (turn * Math.PI) / 2), Q) : Q,
        Sq = M.stretch([0, 1, 0], s, true),
        base = [0, TOP, 0];
      // on the dais it squashes about its foot; in the air about its middle, and what the turn does to its footprint is allowed for so it never sinks in
      const half = HS * (Math.abs(Math.cos((turn * Math.PI) / 2)) + Math.abs(Math.sin((turn * Math.PI) / 2))),
        mid = [0, TOP + lift + (mode === 'air' ? Math.max(HS, half * (lift < 0.6 ? 1 : 0.9)) : HS), 0],
        p = mode === 'air' ? mid : V.add(base, M.app(Sq, V.sub(mid, base)));
      rig.set('die', M.mul(Sq, R), C0, p);
      rig.apply();
      const f = M.app(R, [0, 0, 1]),
        lp = [p[0] + f[0] * 3.4, p[1] + f[1] * 3.4 - 0.6, p[2] + f[2] * 3.4];
      if (V.dist(lp, lamp.p) > 0.06) {
        lamp.p = lp;
        lit.touch();
      }
      // its shadow on the dais: tighter and fainter the higher it is
      const r = 3.3 - (0.5 * lift) / RISE;
      if (Math.abs(r - lastR) > 0.03) {
        lastR = r;
        shade.r = r;
        shade.c = [0, TOP - 1.25 - (0.5 * lift) / RISE, 0];
        under.touch();
      }
    },
    poke(hit) {
      if (!hit) return;
      if (st.rig.names[hit.part] === 'die') {
        sq.kick(-7);
        mood.glare = 1;
        ps.sparks(hit.p, 16, [16, 12, 13], null, 5);
        shake.hit(0.09);
      } else ps.dust(hit.p, 10, [15, 4, 3], 1.4);
    }
  });
  st.add(lit);
  st.add(
    K.fx.tint(st, under, 'multiply', {
      where: i => !rig.bid[i] && st.base[i * 16 + 1] > TOP - 0.2 && st.base[i * 16 + 1] < TOP + 0.2
    })
  );
  st.add(art);
  st.add(ps);
  st.add(shake);
  W.lab = { art, ps, lit, hops: () => hops };
  return W;
}

// ---------------------------------------------------------------------
// Slow Burn: a stand of dry grass, brush and small trees, and a cold stone. Fire is lit (tap to light more) and goes where there is something
// to burn, climbing as it goes; what it leaves stays burnt. Frost creeps out from the stone and gives way where it is warm. Embers ride a
// current that goes round the trunks, not through them, and the fire lights what stands near it.
// ---------------------------------------------------------------------
function sceneBurn(seed) {
  const K = KIT,
    V = K.V,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x1a1410, 0x3a2a1c, 0x5c452c, 0x6b6a2c, 0xa09a3c, 0xcfc76a, 0x1f4a24, 0x3c7a34, 0x66a640, 0x2a1c14,
        0x4a3222, 0xfff3a0, 0xffc040, 0xff7a2a, 0xc8321e, 0x0e0c0c, 0x1c1818, 0x4a4648, 0x767072, 0x9fd0e8, 0xe8f6ff,
        0x3a4048, 0x666c70
      ]
    );
  const { rr } = B,
    S = K.sculpt(makeSculpt(B)),
    cap = K.light.capture(B, S);
  S.sun = B.norm([-0.5, 0.7, 0.5]);
  S.res = 0.11;
  S.amb = 0.14;
  S.sky = 0.24;
  const hf = (x, z) => 0.3 * B.fbm(x * 0.15 + 2, z * 0.15, 1.5, 2) - 0.1,
    BARK = { r: [10, 10, 11, 3] },
    DRY = { r: [2, 4, 5, 5, 6], blade: { h: 0.2, w: 0.035 } };
  S.ground(
    Object.assign(
      { tex: (x, y, z, ny, t) => (B.n3(x * 0.3, z * 0.3, 7) > 0.6 ? S.pick([1, 2, 2, 3], t) : undefined) },
      DRY
    ),
    { rad: 10.5, zs: 1.35, res: 0.14, h: hf }
  );
  for (const [x, z, h] of [
    [-2.6, -1.2, 4.6],
    [2.9, -2.0, 5.4],
    [0.6, 2.6, 3.8],
    [5.6, 1.6, 4.2]
  ])
    S.tree(x, hf(x, z) - 0.1, z, {
      h,
      r: 0.17,
      lean: [rr(-0.15, 0.15), rr(-0.1, 0.1)],
      nb: 4,
      spread: 1.9,
      cr: 0.9,
      cl: 3,
      bark: BARK,
      leaf: { r: [7, 7, 8, 9], leaf: {} },
      roots: 0,
      lres: 0.15
    });
  for (const [x, z, r] of [
    [-0.8, -0.4, 0.7],
    [3.6, 0.6, 0.6],
    [-4.4, 1.8, 0.65],
    [1.8, -3.6, 0.6],
    [-1.4, 3.8, 0.5]
  ])
    S.rock([x, hf(x, z) + r * 0.5, z], r, { r: [7, 8, 9], leaf: {} }, { res: 0.14 });
  // a heap of cut wood in the middle, and the cold stone off to the left
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9,
      y = hf(0.4, 0.4) + 0.18 + 0.2 * (k % 3);
    S.tube(
      [
        [0.4 - Math.cos(a) * 0.9, y, 0.4 - Math.sin(a) * 0.9],
        [0.4 + Math.cos(a) * 0.9, y + 0.1, 0.4 + Math.sin(a) * 0.9]
      ],
      0.15,
      0.13,
      BARK,
      { res: 0.07 }
    );
  }
  const STONE = [-6.2, 0, -1.4];
  S.rock([STONE[0], hf(STONE[0], STONE[2]) + 0.9, STONE[2]], [0.9, 1.5, 0.8], { r: [22, 22, 23, 19] }, { res: 0.1 });
  S.bake();
  const pool = K.pool(B, 900),
    W = B.finish({
      cam: { target: [0, 2.2, 0], dist: 26, pitch: 0.2, yaw: 0.3, sway: 0.25 },
      detail: 11.5,
      palName: 'Slow burn',
      dither: 0.25,
      radius: 12
    }),
    st = K.stage(W);
  const vx = K.voxels(st, { cell: 0.36 }),
    flow = K.flow.around(K.flow.sum(K.flow.curl(0.3, 1.1), K.flow.wind([0.5, 0.5, 0.1])), S.sdf, 0.6),
    ps = K.particles(st, pool, { flow, ground: hf }),
    lamp = { p: [0, 1, 0], r: 6, s: 0, off: true },
    lit = K.light.system(st, cap, [lamp]);
  const pi = K.palIndex(st),
    FUEL = [0, 0.05, 0.1, 0.15, 0.85, 0.9, 0.9, 1, 1, 1, 0.7, 0.7],
    fire = vx.fire({
      fuel: i => FUEL[pi[i]] || 0,
      burn: 3.2,
      spread: 1.0,
      heal: 9,
      look: { flame: [12, 13, 14, 14, 15], soot: [16, 17], ash: [18, 19], shoot: [8, 9] },
      onBurn: (p, h) => {
        if (KIT.rnd() < 0.5) ps.embers(p, 1, [12, 13, 14, 15]);
        else if (KIT.rnd() < 0.5) ps.smoke([p[0], p[1] + 0.3, p[2]], 1, [18, 18, 19]);
      }
    });
  const frost = vx.frost({ spread: 0.7, reach: 9, look: { pale: [20, 20, 21] } }),
    grade = K.fx.grade(st),
    dusk = K.spring(0, 6, 1);
  let lit0 = false,
    tick = 0;
  st.add(lit);
  st.add(fire);
  st.add(frost);
  st.add(ps);
  st.add({
    update(dt, t) {
      if (!lit0 && t > 1.2) {
        lit0 = true;
        fire.light([0.4, hf(0.4, 0.4) + 0.4, 0.4], 0.8);
        frost.chill([STONE[0], 0.8, STONE[2]], 1.6);
      }
      // one lamp stands for the whole fire: at the middle of whatever is burning, brighter the more of it there is, never steady
      tick += dt;
      if (tick > 0.08) {
        tick = 0;
        let n = 0;
        const c = [0, 0, 0],
          heat = vx.layer('heat');
        for (const k of fire.active)
          if (heat[k] > 100) {
            const q = vx.centre(k);
            c[0] += q[0];
            c[1] += q[1];
            c[2] += q[2];
            n++;
          }
        // while it burns the whole picture goes toward night, all but the colours of the fire itself
        grade.set(
          (r, g, b, i) => (i >= 12 && i <= 15 ? null : [r * 0.5, g * 0.52, b * 0.72]),
          dusk.step(Math.min(1, n / 60), 0.08)
        );
        if (n) {
          lamp.off = false;
          lamp.p = [c[0] / n, c[1] / n + 0.6, c[2] / n];
          lamp.r = 4 + Math.min(5, Math.sqrt(n) * 0.5);
          lamp.s = Math.min(0.75, 0.25 + n * 0.012) * (0.8 + 0.2 * Math.sin(t * 23) * Math.sin(t * 7.3));
        } else lamp.off = true;
        lit.touch();
      }
    },
    poke(hit) {
      if (hit) fire.light(hit.p, 0.7);
    }
  });
  W.lab = { vx, fire, frost, ps, lit };
  return W;
}

// ---------------------------------------------------------------------
// Old Idol: a stone figure on a block. Each blow (tap it) knocks a lump out and leaves a real hollow; cut through something that was holding
// a part up and that part comes down and breaks. Left alone, it is struck a few times so that there is something to see.
// ---------------------------------------------------------------------
function sceneIdol(seed) {
  const K = KIT,
    V = K.V,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x16181c, 0x2c3036, 0x4a5058, 0x70777e, 0xa0a6a2, 0xcfd2c8, 0x1f4a24, 0x3c7a34, 0x8a8478, 0x5c5a54,
        0xffd24a
      ]
    );
  const S = K.sculpt(makeSculpt(B));
  S.sun = B.norm([-0.45, 0.75, 0.5]);
  S.res = 0.095;
  S.amb = 0.15;
  S.sky = 0.26;
  const ST = {
      r: [1, 2, 3, 3, 4, 5],
      mod: (x, y, z) => 0.25 * (B.n3(x * 0.8, y * 0.8, z * 0.8) - 0.5),
      tex: (x, y, z, ny, t) => (ny > 0.5 && B.n3(x * 0.9 + 3, y * 0.9, z * 0.9) > 0.66 ? S.pick([7, 8], t) : undefined)
    },
    H = { hold: true };
  S.ground({ r: [1, 1, 2, 2, 3] }, { rad: 10, zs: 1.3, res: 0.15 });
  S.join('chamfer', S.box([0, 0.6, 0], [2.2, 0.6, 1.8], ST, H), S.box([0, -0.5, 0], [5, 0.5, 5], ST, H), {
    r: 0.5,
    res: 0.09
  });
  S.join(
    'round',
    S.lathe([0, 1.2, 0], 2.9, t => 1.25 - 0.4 * t + 0.16 * Math.sin(t * 8), ST, H),
    S.box([0, 3.9, 0], [1.9, 0.42, 0.7], ST, H),
    { r: 0.35, res: 0.085 }
  );
  for (const sx of [-1, 1]) {
    S.tube(
      [
        [sx * 1.8, 3.9, 0],
        [sx * 2.5, 2.8, 0.5],
        [sx * 2.1, 1.9, 1.2]
      ],
      0.36,
      0.3,
      ST,
      { res: 0.085 }
    );
    S.ball([sx * 2.1, 1.8, 1.3], 0.42, ST, { res: 0.085 });
  }
  S.lathe([0, 4.3, 0], 0.7, 0.42, ST, { res: 0.085 });
  S.ball([0, 5.75, 0], [1.05, 1.0, 0.95], ST, { res: 0.085 });
  S.box([0, 6.0, 0.75], [0.8, 0.14, 0.3], ST, { res: 0.07, rd: 0.06 });
  for (const sx of [-1, 1]) {
    S.ball([sx * 0.42, 5.75, 0.85], 0.17, { r: [11], em: true }, { res: 0.05 });
    S.tube(
      [
        [sx * 0.6, 6.6, 0],
        [sx * 1.3, 7.5, -0.1]
      ],
      0.2,
      0.05,
      ST,
      { res: 0.07 }
    );
  }
  for (const [x, z, r] of [
    [4.2, 2.6, 0.6],
    [-4.6, -2.2, 0.8],
    [3.4, -3.4, 0.5]
  ])
    S.rock([x, r * 0.3, z], r, { r: [1, 2, 3, 4] }, { res: 0.12 });
  // built to rule: two pillars of fitted drums with an arch of fitted stones between them, behind; steps up to the block in front; a run of fence
  const MATS = { stone: ST, post: { r: [1, 2, 3] }, rail: { r: [2, 3, 4] } };
  for (const sx of [-1, 1]) K.build.pillar(S, [sx * 4.6, 0, -3.2], 5.6, { r: 0.55, flutes: 9, mats: MATS, res: 0.085 });
  K.build.arch(S, [0, 0, -3.6], { span: 4.4, height: 7.2, depth: 0.9, thick: 0.6, mats: MATS, res: 0.09 });
  K.build.stairs(S, [0, 0, 3.6], [0, -1], 1.2, { width: 2.2, mats: MATS, res: 0.085 });
  K.build.fence(S, [-7.5, 0, 2.4], [-3.4, 0, 4.6], { h: 0.9, bay: 1.0, pickets: true, mats: MATS, res: 0.06 });
  S.bake();
  const fresh = K.pool(B, 5200),
    bits = K.pool(B, 360),
    W = B.finish({
      cam: { target: [0, 3.4, 0], dist: 25, pitch: 0.12, yaw: 0.35, sway: 0.25 },
      detail: 12,
      palName: 'Old idol',
      dither: 0.25,
      radius: 11
    }),
    st = K.stage(W);
  const vx = K.voxels(st, { cell: 0.3 }),
    shake = labShake(st),
    ps = K.particles(st, bits, { ground: () => 0 }),
    deb = K.debris(st, {
      ground: (x, z) => (Math.abs(x) < 2.2 && Math.abs(z) < 1.8 ? 1.2 : 0),
      onLand: (c, hard) => {
        ps.dust(c, Math.min(14, 3 + hard), [9, 10, 4], 1.5);
        shake.hit(Math.min(0.2, hard * 0.012));
      }
    });
  // What still stands is asked of the sculpt itself, in cells of 0.16: a hand that hangs a finger's width over the block is not held up by it.
  // Pieces that come away are rubble: they land on the figure, the block, the steps and each other, tip, roll and sometimes break again.
  let brk = null;
  const sg = K.solids((x, y, z) => brk.sdf(x, y, z), [-9.5, 0.02, -7], [8.5, 8.2, 7], 0.16);
  const rub = K.rubble(st, {
    solid: (x, y, z) => brk.standing(x, y, z),
    chips: deb,
    onHit: (c, hard) => {
      if (hard > 2.5) {
        ps.dust(c, Math.min(12, 2 + hard), [9, 10, 4], 1.4);
        shake.hit(Math.min(0.22, hard * 0.014));
      }
    }
  });
  brk = K.breaker(st, {
    sdf: S.sdf,
    solids: sg,
    rubble: rub,
    debris: deb,
    pool: fresh,
    inner: [2, 3, 4, 5, 6],
    particles: ps,
    chips: [4, 5, 9],
    dust: [9, 10],
    sun: S.sun,
    res: 0.1,
    where: i => st.base[i * 16 + 1] > 0.06
  });
  const plan = [
    [2.2, [2.1, 1.9, 1.2], 0.6],
    [3.4, [-2.4, 2.9, 0.5], 0.55],
    [4.6, [0.5, 2.6, 0.9], 0.7],
    [5.8, [-0.6, 3.2, 0.8], 0.65],
    [7.4, [0, 4.62, 0], 0.72]
  ];
  let touched = false,
    pi = 0;
  st.add(K.fx.reveal(st, { auto: true, dur: 1.5, block: 0.5 }));
  st.add({
    update(dt, t) {
      while (!touched && pi < plan.length && t > plan[pi][0]) {
        const p = plan[pi++];
        brk.strike(p[1], p[2], [0, 0.1, -0.6], 4.5);
        shake.hit(0.06);
      }
    },
    poke(hit, o, d) {
      if (!hit) return;
      touched = true;
      brk.strike(V.mad(hit.p, d, 0.25), 0.6, d, 4.5);
      shake.hit(0.07);
    }
  });
  st.add(rub);
  st.add(deb);
  st.add(ps);
  st.add(shake);
  W.lab = { vx, brk, deb, rub, sg, ps };
  return W;
}

// ---------------------------------------------------------------------
// The Bench: four small things on a slab. A lump of jelly that wobbles when it is prodded (tap it). Sand running out of a hopper into a pile
// that slides when it gets too steep. A beetle that walks round the edge on feet that choose their own steps. Two rods with a spark between.
// ---------------------------------------------------------------------
function sceneBench(seed) {
  const K = KIT,
    V = K.V,
    M = K.M,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x16181c, 0x2c3036, 0x4a5058, 0x70777e, 0xa0a6a2, 0x0f3a36, 0x1c6a5c, 0x3aa888, 0x8ee0b0, 0xe8ffe0,
        0x8a6a2c, 0xc8a04a, 0xecd48a, 0x241a2c, 0x4a3460, 0xb8d8ff, 0xffffff, 0xffd24a
      ]
    );
  const S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    cap = K.light.capture(B, S);
  S.sun = B.norm([-0.4, 0.78, 0.5]);
  S.res = 0.09;
  S.amb = 0.15;
  S.sky = 0.26;
  const ST = { r: [1, 2, 2, 3, 4, 5] },
    H = { hold: true },
    JEL = { r: [6, 7, 7, 8, 9, 10], mod: (x, y, z) => 0.1 * Math.sin(y * 7) },
    JC = [-2.6, 0.5, 0.6],
    G = Object.assign(S.grp(0.5), { tag: 'jelly', res: 0.085 });
  S.join('chamfer', S.lathe([0, 0, 0], 0.5, 6.6, ST, H), S.lathe([0, -0.6, 0], 0.6, 9, ST, H), { r: 0.3, res: 0.1 });
  const HOP = [2.8, 4.2, 0.4],
    RODS = [
      [-1.2, 0.5, -4.2],
      [1.4, 0.5, -4.4]
    ];
  S.join(
    'cut',
    S.lathe([HOP[0], HOP[1], HOP[2]], 1.5, [0.22, 1.2], ST, H),
    S.lathe([HOP[0], HOP[1] - 0.2, HOP[2]], 1.9, [0.1, 1.08], ST, H),
    { res: 0.075 }
  );
  S.fold(
    S.tube(
      [
        [HOP[0] + 1.0, HOP[1] + 1.2, HOP[2]],
        [HOP[0] + 1.5, 0.5, HOP[2]]
      ],
      0.08,
      0.08,
      ST,
      H
    ),
    { polar: 3, c: [HOP[0], 0, HOP[2]] },
    { res: 0.06 }
  );
  for (const r of RODS) {
    S.lathe(r, 2.6, [0.12, 0.07], ST, { res: 0.06 });
    S.ball([r[0], r[1] + 2.75, r[2]], 0.2, { r: [4, 5, 16] }, { res: 0.05 });
  }
  S.bake();
  // (what moves is made afterwards and by itself, so the slab has no hole under it and no piece has a gap where it met another)
  S.ball([JC[0], JC[1] + 0.9, JC[2]], [1.5, 1.15, 1.4], JEL, G);
  S.ball([JC[0] - 0.3, JC[1] + 1.9, JC[2] + 0.1], [0.9, 0.8, 0.85], JEL, G);
  S.ball([JC[0] + 0.8, JC[1] + 0.5, JC[2] + 0.5], [0.8, 0.5, 0.7], JEL, G);
  for (const sx of [-1, 1])
    S.ball(
      [JC[0] - 0.3 + sx * 0.36, JC[1] + 2.05, JC[2] + 0.82],
      0.15,
      { r: [17], em: true },
      { res: 0.05, tag: 'jelly' }
    );
  // the beetle, made standing at its starting place facing +z: a shell, a head, four legs of two pieces each, a tail of beads
  const R0 = 5.1,
    BB = [R0, 0.95, 0],
    BM = { r: [14, 14, 15, 15, 4] },
    HIP = [
      [0.42, -0.1, 0.5],
      [-0.42, -0.1, 0.5],
      [0.42, -0.1, -0.5],
      [-0.42, -0.1, -0.5]
    ],
    L1 = 0.62,
    L2 = 0.72,
    FOOT = HIP.map(h => [h[0] * 2.3, h[2] * 1.5]);
  S.ball(BB, [0.6, 0.42, 0.85], BM, { res: 0.06, tag: 'bug', whole: true });
  S.ball([BB[0], BB[1] + 0.02, BB[2] + 0.85], 0.3, BM, { res: 0.06, tag: 'bug', whole: true });
  for (const sx of [-1, 1])
    S.ball([BB[0] + sx * 0.16, BB[1] + 0.12, BB[2] + 1.08], 0.07, { r: [18], em: true }, { res: 0.04, tag: 'bug' });
  HIP.forEach((h, k) => {
    const a = V.add(BB, h),
      sg = Math.sign(h[0]),
      kn = [a[0] + sg * 0.45, a[1] + 0.42, a[2]],
      ft = [a[0] + sg * 0.75, 0.52, a[2]];
    S.tube([a, kn], 0.09, 0.07, BM, { res: 0.05, tag: 'leg' + k + 'a', whole: true });
    S.tube([kn, ft], 0.07, 0.03, BM, { res: 0.05, tag: 'leg' + k + 'b', whole: true });
    HIP[k].rest = { a, kn, ft };
  });
  const TAIL = [];
  for (let k = 0; k < 6; k++) {
    const p = [BB[0], BB[1] - 0.05, BB[2] - 0.95 - k * 0.24];
    TAIL.push(p);
    S.ball(p, 0.13 - k * 0.015, BM, { res: 0.05, tag: 'tail' + k, whole: true });
  }
  S.bake();
  const grains = K.pool(B, 2600),
    bits = K.pool(B, 260),
    W = B.finish({
      cam: { target: [0, 2.2, 0], dist: 24, pitch: 0.24, yaw: 0.4, sway: 0.25 },
      detail: 12.5,
      palName: 'Bench',
      dither: 0.25,
      radius: 10
    }),
    st = K.stage(W);
  rig.bind(st);
  const jel = K.jelly(st, Array.from(rig.list[rig.part('jelly')]), {
    cell: 0.55,
    stiff: 0.1,
    damp: 2.4,
    squash: 0.7,
    vmax: 6
  });
  jel.pin(q => q[1] < JC[1] + 0.45);
  const sand = K.sand(st, grains, { cell: 0.15, ground: (x, z) => (Math.hypot(x, z) < 6.6 ? 0.5 : 0), slope: 1.5 }),
    ps = K.particles(st, bits, { ground: () => 0.5 }),
    lit = K.light.system(st, cap, []);
  const gait = K.gait({
      feet: FOOT.map((f, k) => ({ home: f, group: k === 0 || k === 3 ? 0 : 1 })),
      reach: 0.34,
      time: 0.16,
      lift: 0.3,
      ground: () => 0.5
    }),
    rope = K.rope(TAIL, { gravity: 3, damp: 0.86, floor: () => 0.62, stiff: 0.02 });
  let ang = 0,
    nextPoke = 2,
    nextBolt = 2.6,
    poured = 0;
  st.add(lit);
  st.add(jel);
  st.add(sand);
  st.add(ps);
  st.add({
    update(dt, t) {
      dt = Math.min(dt, 0.05);
      // the beetle: its body goes round, yawing to face along the circle; the feet are left to the gait; each leg is bent to reach its foot
      ang += dt * 0.2;
      const bp = [Math.cos(ang) * R0, 0.95 + 0.03 * Math.sin(t * 9), -Math.sin(ang) * R0],
        yaw = ang + Math.PI,
        Rb = M.rot([0, 1, 0], yaw),
        feet = gait.update(dt, { p: bp, yaw, v: [-Math.sin(ang) * R0 * 0.2, -Math.cos(ang) * R0 * 0.2] });
      rig.set('bug', Rb, BB, bp);
      HIP.forEach((h, k) => {
        const r = h.rest,
          hip = V.add(bp, M.app(Rb, [h[0], h[1], h[2]])),
          out = M.app(Rb, [Math.sign(h[0]), 0, 0]),
          ik = K.ik2(hip, feet[k].p, L1, L2, [out[0] * 0.5, 1, out[2] * 0.5]);
        rig.set('leg' + k + 'a', M.aim(V.norm(V.sub(r.kn, r.a)), V.norm(V.sub(ik.mid, hip))), r.a, hip);
        rig.set('leg' + k + 'b', M.aim(V.norm(V.sub(r.ft, r.kn)), V.norm(V.sub(ik.tip, ik.mid))), r.kn, ik.mid);
      });
      const tp = rope.step(dt, V.add(bp, M.app(Rb, V.sub(TAIL[0], BB))));
      for (let k = 0; k < 6; k++) rig.set('tail' + k, M.id(), TAIL[k], tp[k]);
      rig.apply();
      if (poured < 2500) {
        const n = Math.min(2500 - poured, Math.round(dt * 150));
        if (n) {
          sand.pour([HOP[0], HOP[1] - 0.1, HOP[2]], n, [11, 12, 12, 13], 0.25);
          poured += n;
        }
      }
      if (t > nextPoke) {
        nextPoke = t + 2.4 + KIT.rnd();
        const a = KIT.rnd() * 6.28;
        jel.poke(
          [JC[0] + Math.cos(a) * 1.3, JC[1] + 1.6, JC[2] + Math.sin(a) * 1.3],
          [-Math.cos(a), 0.3, -Math.sin(a)],
          3,
          2.4
        );
      }
      if (t > nextBolt) {
        nextBolt = t + 2.2 + KIT.rnd() * 1.5;
        const a = [RODS[0][0], RODS[0][1] + 2.8, RODS[0][2]],
          b = [RODS[1][0], RODS[1][1] + 2.8, RODS[1][2]];
        ps.bolt(a, b, [17, 16, 16]);
        ps.bolt(a, b, [16, 15], 0.5);
        ps.sparks(b, 6, [17, 16, 18], null, 4);
        lit.flash(0.3, 0.14);
      }
    },
    poke(hit, o, d) {
      if (!hit) return;
      jel.poke(hit.p, V.mul(d, 1), 5, 2.2);
      ps.sparks(hit.p, 6, [9, 10, 17], null, 3);
    }
  });
  // a soft shadow under the jelly, since the slab was made without it
  st.add(
    K.fx.tint(
      st,
      K.field({
        soft: 0.5,
        shapes: [{ shape: K.shape.sphere([JC[0] + 0.1, JC[1] - 1.1, JC[2] + 0.1], 2.0), color: [0.5, 0.5, 0.56] }]
      }),
      'multiply',
      { where: i => !rig.bid[i] && st.base[i * 16 + 1] < JC[1] + 0.2 }
    )
  );
  W.lab = { jel, sand, gait, ps, lit };
  return W;
}

// =====================================================================
// Soft Things: four kinds of stuff on one solver. Jelly lands and wobbles, a cake is pressed and stays pressed (and shows its layers),
// a tower of sand slumps to a heap, water drops into a basin and finds its level. A tap shoves the jelly and the water, and takes a bite out of the
// cake or the sand
// =====================================================================
function sceneStuff(seed) {
  const K = KIT,
    M = K.M,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x15171c, 0x2a2e36, 0x474d57, 0x6d747c, 0x9aa09c, 0x3a1a4a, 0x6a2a7a, 0xa84aa8, 0xe07ac8, 0xffb8e0,
        0x7a4a1c, 0xb8843a, 0xe8c060, 0xfff0b0, 0xfff8ec, 0x8a1420, 0xd02838, 0xf2a0b0, 0xffd0d8, 0x10305a, 0x1c5a96,
        0x3a96d0, 0x9adcf0, 0xffe9a0
      ]
    );
  const S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S);
  S.sun = B.norm([-0.4, 0.8, 0.45]);
  S.res = 0.1;
  S.amb = 0.16;
  S.sky = 0.28;
  const ST = { r: [1, 2, 3, 4, 5], mod: (x, y, z) => 0.2 * (B.n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) },
    H = { hold: true },
    CX = -1.8,
    WX = 5.0;
  S.ground({ r: [1, 1, 2, 2, 3] }, { rad: 8.6, zs: 0.5, res: 0.15 });
  const basin = S.join('cut', S.lathe([WX, 0, 0], 0.95, 1.6, ST, H), S.lathe([WX, 0.32, 0], 1.2, 1.02, ST, H), {
    res: 0.085
  });
  // a frame over the cake for the weight to hang from
  S.box([CX, 2.6, -1.9], [0.18, 2.6, 0.18], ST, { res: 0.085 });
  S.box([CX, 5.1, -0.85], [0.2, 0.16, 1.25], ST, { res: 0.085 });
  S.box([CX, 0.12, -1.9], [0.5, 0.12, 0.5], ST, { res: 0.085 });
  S.bake();
  const jel = S.box(
    [-5.3, 2.7, 0],
    [0.72, 0.72, 0.72],
    { r: [6, 7, 8, 9, 10] },
    { rd: 0.26, res: 0.095, tag: 'jelly', whole: true }
  );
  const cake = S.lathe(
    [CX, 0.03, 0],
    1.05,
    0.95,
    {
      r: [18, 18, 19, 19],
      tex: (x, y, z, ny) => (ny > 0.7 ? (Math.hypot(x - CX, z) > 0.62 ? 15 : 19) : y > 0.5 && y < 0.62 ? 15 : undefined)
    },
    { res: 0.095, tag: 'cake', whole: true }
  );
  const sand = S.lathe(
    [1.7, 0.03, 0],
    2.1,
    [0.66, 0.5],
    { r: [11, 12, 13, 14], mod: (x, y, z) => 0.5 * (B.n3(x * 2.2, y * 2.2, z * 2.2) - 0.5) },
    { res: 0.095, tag: 'sand', whole: true }
  );
  const wat = S.ball([WX, 2.1, 0], 0.68, { r: [20, 21, 22, 23] }, { res: 0.09, tag: 'water', whole: true });
  const R0 = [CX, 3.7, 0];
  S.ball(R0, 0.6, ST, { res: 0.08, tag: 'ram', whole: true });
  S.lathe([CX, 4.2, 0], 2.6, 0.07, { r: [2, 3, 4] }, { res: 0.06, tag: 'ram', whole: true });
  S.bake();
  // what they are inside: the jelly paler toward its middle, the cake in layers (sponge, jam, sponge, cream, sponge), sand and water all through
  const layer = y => (y < 0.3 ? 13 : y < 0.4 ? 17 : y < 0.68 ? 12 : y < 0.78 ? 15 : 13),
    IN = { cell: 0.15 };
  const inJ = K.inside(B, jel.sd, Object.assign({ lo: [-6.1, 1.9, -0.8], hi: [-4.5, 3.5, 0.8], ramp: [9, 10] }, IN)),
    inC = K.inside(
      B,
      cake.sd,
      Object.assign(
        { lo: [CX - 1, 0, -1], hi: [CX + 1, 1.1, 1], cols: (d, x, y) => layer(y + 0.04 * Math.sin(x * 9)) },
        IN
      )
    );
  const inS = K.inside(
      B,
      sand.sd,
      Object.assign(
        {
          lo: [1, 0, -0.7],
          hi: [2.4, 2.2, 0.7],
          cols: (d, x, y, z) => 11 + Math.floor(B.n3(x * 3, y * 3, z * 3) * 3.99)
        },
        IN
      )
    ),
    inW = K.inside(
      B,
      wat.sd,
      Object.assign({ lo: [WX - 0.7, 1.4, -0.7], hi: [WX + 0.7, 2.8, 0.7], ramp: [21, 22] }, IN)
    );
  const pool = K.pool(B, 260),
    W = B.finish({
      cam: { target: [0, 1.5, 0], dist: 17, pitch: 0.2, yaw: 0.1, sway: 0.2 },
      detail: 12,
      palName: 'Soft',
      dither: 0.25,
      radius: 9
    }),
    st = K.stage(W);
  rig.bind(st);
  const ps = K.particles(st, pool, { ground: () => 0 }),
    mp = K.mpm(st, {
      lo: [-8.5, 0, -4],
      hi: [8.5, 6, 4],
      cell: 0.25,
      floor: 0,
      sdf: basin.sd,
      onScoop: (p, body) => ps.chips(p, 9, body.name === 'sand' ? [13, 12, 14] : [13, 15, 17, 19], null, 3)
    }),
    all = (tag, ins) => Array.from(rig.list[rig.part(tag)]).concat(Array.from(ins.ids));
  const ball = {
      c: R0.slice(),
      r: 0.6,
      v: [0, 0, 0],
      sd: (x, y, z) => Math.hypot(x - ball.c[0], y - ball.c[1], z - ball.c[2]) - ball.r
    },
    bodies = {},
    DOWN = [1.2, 0.95, 0.75];
  let started = false,
    landed = false;
  st.add(K.fx.reveal(st, { auto: true, dur: 1.2, block: 0.6 }));
  st.add({
    update(dt, t) {
      if (!started && t > 1.5) {
        started = true;
        bodies.jelly = mp.add(all('jelly', inJ), { kind: 'jelly' });
        bodies.cake = mp.add(all('cake', inC), { kind: 'clay', yield: 14, tap: 'scoop', scoop: 0.5 });
        bodies.sand = mp.add(all('sand', inS), { kind: 'sand', tap: 'scoop', scoop: 0.42 });
        bodies.water = mp.add(all('water', inW), { kind: 'water' });
        mp.collider(ball);
      }
      // the weight comes down on the cake three times, a little lower each time, and then hangs still
      const u = t - 4.5,
        k = Math.floor(u / 4.5),
        ph = u - k * 4.5;
      let y = R0[1];
      if (u >= 0 && k < 3) {
        const d = DOWN[k];
        y =
          ph < 0.7
            ? K.mix(R0[1], d, K.ease.inout3(ph / 0.7))
            : ph < 1.5
              ? d
              : ph < 2.6
                ? K.mix(d, R0[1], K.ease.inout3((ph - 1.5) / 1.1))
                : R0[1];
        if (ph >= 0.7 && ph < 0.75 && !landed) {
          landed = true;
          ps.dust([CX, 0.9, 0], 14, [19, 15, 18], 2.2);
        }
        if (ph > 1) landed = false;
      }
      ball.v[1] = dt > 0 ? (y - ball.c[1]) / dt : 0;
      ball.c[1] = y;
      rig.set('ram', M.id(), R0, [R0[0], y, R0[2]]);
      rig.apply();
    },
    poke(hit) {
      if (hit) ps.sparks(hit.p, 8, [24, 14, 13], null, 3);
    }
  });
  st.add(mp);
  st.add(ps);
  W.lab = { mp, bodies, ball };
  return W;
}
// =====================================================================
// Night Cabinet: light that goes through things. The light is behind and to the left, so everything is seen against it. A slime under a
// bell jar: see-through, brightest round its edge where the light has least of it to cross, with a lit heart, a wet highlight, and a pool
// of green light thrown on the stone in front of it; the glass bends the posts behind. A beast whose coat lies in locks and is rimmed with
// light, and whose ears glow red where they are thin. A censer whose smoke shades itself. Mist, shafts, distance, and contact shade that
// follows what moves. Tap for a puff of smoke
// =====================================================================
function sceneCabinet(seed) {
  const K = KIT,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x15171c, 0x2a2e36, 0x474d57, 0x6d747c, 0x9aa09c, 0x2a4a5a, 0x6aa6b0, 0xcfeef0, 0x123a2a, 0x1f6a3c,
        0x3fae4a, 0x9ae05a, 0xe8ffa0, 0x2a1a14, 0x4a2c1c, 0x7a4a26, 0xb0763a, 0xdcae6a, 0xc8503a, 0xff9a6a, 0xd8d4c8,
        0xa8a49c, 0x76747a, 0x4a4a54, 0x2a2c36, 0xc8321e, 0xff7a2a, 0xffd24a, 0x1c2430, 0x34404c, 0xfff3c0, 0x6a5a2a,
        0xa88a3a, 0xe0c060, 0xf6ffd8, 0xffffff, 0x7a1c1c, 0xffd0a0, 0xffe2a8, 0x2c2820, 0x4a4432
      ]
    );
  const S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    tags = K.deform.tags(S);
  S.sun = B.norm([-0.55, 0.6, -0.58]);
  S.view = B.norm([0.21, 0.19, 0.96]);
  S.res = 0.1;
  S.amb = 0.2;
  S.sky = 0.3;
  const ST = { r: [1, 2, 3, 4, 5], mod: (x, y, z) => 0.2 * (B.n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) },
    BRASS = { r: [32, 32, 33, 34], gloss: { c: 34, at: 0.985 } },
    JX = -4.6,
    BX = 0,
    CX = 4.6;
  S.lights.push({ p: [JX, 1.15, 0], r: 2.8, s: 0.55 }, { p: [CX, 1.7, 0], r: 3.2, s: 0.7 });
  S.ground({ r: [1, 1, 2, 2, 3] }, { rad: 8.4, zs: 0.56, res: 0.15 });
  for (const x of [JX, BX, CX]) S.lathe([x, 0, 0], 0.5, [1.75, 1.6], ST, { res: 0.09 });
  // three posts behind the jar, to be seen through it
  for (const dx of [-0.9, 0, 0.9]) {
    S.lathe([JX + dx, 0, -2.3], 3.4, 0.17, ST, { res: 0.08 });
    S.ball([JX + dx, 3.5, -2.3], 0.26, BRASS, { res: 0.07 });
  }
  // the slime: a skin that lets the light and the eye through, wet where it mirrors the light, with a lit heart
  const slime = S.ball(
    [JX, 1.12, 0],
    [0.82, 0.64, 0.82],
    K.look.jelly([9, 10, 10, 11, 12], {
      depth: 1.3,
      k: 0.85,
      glow: [11, 12, 12, 13, 13, 35],
      at: 0.2,
      core: { p: [JX - 0.12, 0.92, -0.05], r: 0.3, k: 0.62 },
      gloss: { c: 36, at: 0.985, c2: 35, at2: 0.972 }
    }),
    { res: 0.062, bump: [0.1, 1.6] }
  );
  for (const sx of [-1, 1]) {
    // eyes are set into the skin where the eye of whoever is looking finds it, not at coordinates: they cannot end up under it
    const eye = S.stud(slime, { at: [sx * 0.33, 0.24] }, 0.1, { r: [0], em: true }, { ghost: true, res: 0.035 });
    S.stud(eye, { at: [-0.3, 0.4], sink: 0.2 }, 0.03, { r: [36], em: true }, { ghost: true, res: 0.03 });
  }
  // the bell jar: glass is a ghost (it shades nothing and hides nothing), with a knob on top
  const dome = t => 1.3 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.42) / 0.58), 2))) + 0.02;
  S.lathe([JX, 0.5, 0], 2.5, dome, K.look.glass([6, 7, 8], { a: 0.085 }), { ghost: true, res: 0.065 });
  S.ball([JX, 3.1, 0], 0.2, K.look.glass([7, 8, 8], { a: 0.5 }), { ghost: true, res: 0.05 });
  // the beast sits facing us: a coat that falls back and down in locks, a short-haired face, and two ears held up against the light
  const FUR = [14, 15, 16, 17, 18],
    RIM = [18, 18, 39],
    comb = [0.45, -0.55, -0.25],
    coat = o => K.look.fur(FUR, Object.assign({ comb, rim: RIM }, o)),
    HX = BX - 0.7,
    HZ = 0.5;
  S.ball([BX + 0.2, 1.45, -0.05], [1.25, 0.95, 0.95], coat({ len: 0.44, lay: 0.62, droop: 0.4, clump: 0.55 }), {
    res: 0.08,
    tag: 'coat'
  });
  const head = S.ball(
    [HX, 2.02, HZ],
    [0.62, 0.56, 0.56],
    coat({ len: 0.12, lay: 0.75, droop: 0.2, clump: 0.3, comb: [0, -0.4, -0.6] }),
    { res: 0.062, tag: 'head' }
  );
  const muzzle = S.ball(
    [HX, 1.84, HZ + 0.5],
    [0.27, 0.2, 0.2],
    K.look.fur([16, 17, 18, 18], { len: 0.06, lay: 0.6, droop: 0.2, clump: 0.2, n: 1, comb: [0, -0.5, 0.3] }),
    { res: 0.05, tag: 'head' }
  );
  S.stud(
    muzzle,
    { at: [0, 0.3], sink: 0.3 },
    0.07,
    { r: [14, 14, 15], gloss: { c: 36, at: 0.97 } },
    { res: 0.035, tag: 'head' }
  );
  for (const sx of [-1, 1]) {
    const sd = sx < 0 ? 'l' : 'r',
      eye = S.stud(
        head,
        { at: [sx * 0.42, 0.2], sink: 0.25 },
        0.11,
        { r: [28], em: true },
        { ghost: true, res: 0.035, tag: 'eye-' + sd }
      ),
      pupil = S.stud(eye, { sink: 0.3 }, 0.06, { r: [0], em: true }, { ghost: true, res: 0.028, tag: 'pupil-' + sd });
    S.stud(
      pupil,
      { at: [-0.45, 0.5], sink: 0.2 },
      0.022,
      { r: [36], em: true },
      { ghost: true, res: 0.02, tag: 'pupil-' + sd }
    );
    // the ears: thin leaves of skin, broad side to us and the light behind them
    S.ball(
      [HX + sx * 0.4, 2.72, HZ - 0.1],
      [0.2, 0.42, 0.05],
      K.look.wax([15, 16, 17], { depth: 0.5, k: 1.0, glow: [37, 26, 19, 19, 20], at: 0.2 }),
      { ax: B.frame(0, -0.15, -sx * 0.32), res: 0.042, tag: 'ear-' + sd }
    );
    S.ball(
      [HX + sx * 0.36, 0.68, 0.72],
      [0.24, 0.18, 0.3],
      K.look.fur([15, 16, 17, 18], { len: 0.1, lay: 0.7, droop: 0.4, clump: 0.3, comb: [0, -0.3, 0.6], rim: RIM }),
      { res: 0.06, tag: 'coat' }
    );
  }
  S.tube(
    [
      [BX + 1.3, 1.2, -0.1],
      [BX + 1.95, 1.5, 0.1],
      [BX + 2.2, 2.2, 0.15],
      [BX + 1.95, 2.75, 0.1]
    ],
    0.24,
    0.12,
    coat({ len: 0.4, comb: [0.2, 0.6, 0], lay: 0.45, droop: 0.05, clump: 0.5 }),
    { res: 0.07, tag: 'tail' }
  );
  // the censer
  S.lathe([CX, 0.5, 0], 0.5, [0.18, 0.5], BRASS, { res: 0.07 });
  S.lathe([CX, 1.0, 0], 0.45, t => 0.55 + 0.25 * Math.sin(t * 3.14), BRASS, { res: 0.07 });
  S.ball([CX, 1.45, 0], [0.42, 0.12, 0.42], { r: [26, 27, 28], em: true }, { res: 0.06 });
  S.bake();
  K.caustic(B, [JX + 0.55, 0.515, 1.02], 0.5, [35, 13, 12, 11], { a: 0.62, zs: 0.6, n: 22 });
  const fog = K.mist(B, {
    rad: 8.2,
    zs: 0.56,
    y: 0.06,
    depth: 0.3,
    n: 90,
    cols: [29, 30],
    a: 0.1,
    size: [0.6, 1.2],
    drift: 0.35,
    where: (x, z) => Math.hypot(x, z / 0.56) > 5.4
  });
  K.shafts(B, { from: [-3.4, 6.3, -3.6], dir: [0.55, -0.6, 0.58], len: 7.2, r: 0.42, n: 12, col: 31, a: 0.09 });
  K.shafts(B, { from: [-1.9, 6.6, -3.9], dir: [0.55, -0.6, 0.58], len: 7.6, r: 0.3, n: 11, col: 31, a: 0.07 });
  K.glint(B, [JX - 0.72, 2.05, 1.0], [0.25, 1, 0], 0.26, 8);
  K.glint(B, [JX - 0.98, 1.3, 0.86], [0.1, 1, 0], 0.12, 8);
  const pool = K.pool(B, 150),
    W = B.finish({
      cam: { target: [0, 1.75, 0], dist: 12.6, pitch: 0.19, yaw: 0.22, sway: 0.2 },
      detail: 12,
      warnings: S.warnings,
      palName: 'Cabinet',
      dither: 0.3,
      radius: 8.6,
      ao: { k: 0.55, range: 0.7 },
      fog: { c: 29, start: 0.62, max: 0.38 },
      refract: 7
    }),
    st = K.stage(W);
  rig.bind(st);
  const smoke = st.add(
    K.smoke(st, pool, {
      at: [CX, 1.6, 0],
      ramp: [21, 21, 22, 23, 24],
      sun: S.sun,
      rate: 8,
      life: 3.4,
      size: [0.13, 0.6],
      a: 0.5,
      shadow: 1.3,
      rise: 2.1,
      flow: K.flow.sum(K.flow.wind([0.25, 0, 0]), K.flow.curl(0.6, 0.7))
    })
  );
  const beast = cabinetBeast(W, st, tags, { HX, HZ, BX });
  st.add({
    poke(hit) {
      if (!hit) return;
      if (beast.owns(hit.i)) beast.startle(hit.p);
      else {
        smoke.burst([hit.p[0], hit.p[1] + 0.2, hit.p[2]], 10);
        beast.notice(hit.p);
      }
    }
  });
  W.lab = { smoke, fog, beast };
  return W;
}
/* The beast, alive. Its parts hang from one another (coat > head > ears and eyes > pupils; coat > tail) and ride bones on the graphics
   card. What moves it is all from the animation tools: a state machine (idle, startle; and a second layer that dozes), an idle clip with
   follow-through on the ears, a face that blinks and looks about, a head that turns to what it noticed, a tail laid along a curve whose far
   end trails and overshoots, breath as squash and stretch, a reaction field through the coat when it is startled, a pulse in the air that
   the ears answer late, and a hit stop with a small shake */
function cabinetBeast(W, st, tags, o) {
  const K = KIT,
    A = K.anim,
    V = K.V,
    HX = o.HX,
    HZ = o.HZ,
    BX = o.BX,
    T0 = [BX + 1.3, 1.2, -0.1],
    T1 = [BX + 1.95, 2.75, 0.1],
    parents = { 'ear-l': 'head', 'ear-r': 'head' },
    tail = K.deform.noodle({ from: T0, to: T1, handles: 4 }),
    spring = K.deform.emote({ center: [BX + 0.2, 1.45, 0], width: 2.5, height: 1.9 }),
    idle = A.clip({
      id: 'idle',
      dur: 9,
      loop: true,
      parents,
      tracks: {
        'head.rot': [
          [0, [0, 0, 0]],
          [1.6, [2, 16, 3]],
          [3.1, [3, 14, 2]],
          [4.6, [-3, -12, -4], 'out-back'],
          [6.4, [-2, -15, -2]],
          [7.8, [4, 3, 5]],
          [9, [0, 0, 0]]
        ]
      },
      tools: {
        follow: [
          { id: 'fl', part: 'ear-l', preset: 'loose', limit: 30 },
          { id: 'fr', part: 'ear-r', preset: 'loose', limit: 30 }
        ]
      }
    }),
    /* (watched at full speed, the clip as drawn reared the whole body off its paws: it is played at 0.85 of its squash, and the paws
       belong to the coat so they come up with it) */
    startle = K.acts.clip('hurt', {
      part: 'coat',
      gain: 0.85,
      unit: 1 / 110,
      along: [0, 0, 1],
      dur: 0.7,
      more: {
        'head.rot': [
          [0, [4, 0, 0]],
          [0.16, [9, 0, 0], 'out-back'],
          [0.5, [-3, 0, 0]],
          [0.7, [0, 0, 0]]
        ],
        'ear-l.rot': [
          [0, [0, 0, 30]],
          [0.2, [0, 0, 44], 'out-elastic'],
          [0.7, [0, 0, 0]]
        ],
        'ear-r.rot': [
          [0, [0, 0, -30]],
          [0.2, [0, 0, -44], 'out-elastic'],
          [0.7, [0, 0, 0]]
        ]
      }
    }),
    doze = A.clip({
      id: 'doze',
      dur: 5,
      loop: true,
      tracks: {
        'head.rot': [
          [0, [13, 0, 4]],
          [2.5, [17, 0, 5]],
          [5, [13, 0, 4]]
        ],
        'ear-l.rot': [
          [0, [0, 0, 26]],
          [5, [0, 0, 26]]
        ],
        'ear-r.rot': [
          [0, [0, 0, -26]],
          [5, [0, 0, -26]]
        ]
      }
    }),
    brain = A.machine({
      inputs: [
        { id: 'poke', type: 'trigger' },
        { id: 'drowsy', type: 'boolean', value: false }
      ],
      layers: [
        {
          id: 'body',
          entry: 'idle',
          states: [
            { id: 'idle', clip: idle },
            { id: 'startle', clip: startle, playback: 'once' }
          ],
          transitions: [
            { from: 'any', to: 'startle', conditions: [{ input: 'poke', op: 'fired' }], duration: 0.04 },
            { from: 'startle', to: 'idle', exitTime: 1, duration: 0.35 }
          ]
        },
        {
          id: 'mood',
          entry: 'awake',
          states: [{ id: 'awake' }, { id: 'doze', clip: doze }],
          transitions: [
            { from: 'awake', to: 'doze', conditions: [{ input: 'drowsy', op: 'eq', value: true }], duration: 2.2 },
            { from: 'doze', to: 'awake', conditions: [{ input: 'drowsy', op: 'eq', value: false }], duration: 0.3 }
          ]
        }
      ]
    }),
    face = A.face({ gaze: { mode: 'curious', response: 6, amplitude: [0.8, 0.3], frequency: [0.41, 0.27] } }),
    look = {},
    cues = { cues: [] },
    fields = [],
    /* the tail's sway: three handle poses round a loop; the far handles answer later and carry on past */
    sway = (dx, dz, tw) => ({
      points: tail.rest.map((p, i) => [p[0] + (dx * i * i) / 9, p[1], p[2] + (dz * i * i) / 9]),
      twists: [0, tw * 0.3, tw * 0.7, tw]
    }),
    tailKeys = [
      { t: 0, v: sway(0.3, 0.2, 16) },
      { t: 1.7, v: sway(-0.28, -0.08, -12) },
      { t: 2.6, v: sway(-0.12, 0.26, 4) },
      { t: 4.2, v: sway(0.3, 0.2, 16) }
    ],
    ids = new Set(tags.of('coat', 'head', 'tail', 'ear-l', 'ear-r', 'eye-l', 'eye-r', 'pupil-l', 'pupil-r'));
  let clock = 0,
    pokeAt = -99,
    seenAt = -99,
    quiet = 0,
    seen = [0, 2, 6];
  const flick = (t, period, seed) => {
    const n = Math.floor(t / period),
      at = (n + 0.2 + 0.6 * K.hash(n, seed)) * period;
    return A.dynamic({ duration: 0.55, speed: 5.5, damping: 4, rotation: 16 }, t - at).rotation;
  };
  const pup = K.puppet(W, {
    parts: {
      coat: { ids: tags.coat, pivot: [BX + 0.2, 0.5, -0.05], slices: 5 },
      head: { ids: tags.head, pivot: [HX + 0.25, 1.72, HZ - 0.2], parent: 'coat' },
      'ear-l': { ids: tags['ear-l'], pivot: [HX - 0.36, 2.36, HZ - 0.1], parent: 'head', slices: 3 },
      'ear-r': { ids: tags['ear-r'], pivot: [HX + 0.36, 2.36, HZ - 0.1], parent: 'head', slices: 3 },
      'eye-l': { ids: tags['eye-l'], parent: 'head' },
      'eye-r': { ids: tags['eye-r'], parent: 'head' },
      'pupil-l': { ids: tags['pupil-l'], parent: 'eye-l' },
      'pupil-r': { ids: tags['pupil-r'], parent: 'eye-r' },
      tail: { ids: tags.tail, pivot: T0, parent: 'coat', axis: V.norm(V.sub(T1, T0)), slices: 7, maps: [tail] }
    },
    pose(t, dt, p) {
      /* the beast's own clock stands still through a hit stop */
      const ct = A.animTime(cues, t),
        cdt = Math.max(0, ct - clock);
      clock = ct;
      quiet += cdt;
      brain.set('drowsy', quiet > 16);
      brain.advance(cdt);
      brain.pose(p.pose);
      const since = ct - pokeAt,
        drowse = brain.state('mood') === 'doze';
      face.set(since < 1.3 ? 'surprised' : drowse ? 'sleepy' : 'neutral');
      const f = face.step(cdt),
        br = K.acts.breathe(ct, { k: drowse ? 0.05 : 0.032, rate: drowse ? 1.0 : 1.7 }),
        co = p.pose.coat || (p.pose.coat = {});
      co.stretch = (co.stretch === undefined ? 1 : co.stretch) * br.stretch;
      co.waist = br.waist;
      /* startled: the spring field runs through the coat, and the tail stands and fluffs */
      const env = since < 1.4 ? K.acts.envelope(since, 1.4).opacity : 0;
      spring.motion = env > 0 ? 'spring' : null;
      spring.t = since;
      spring.k = 1.5 * env;
      if (env > 0) p.deform('coat', spring);
      const tp = K.deform.noodleAt(tail, tailKeys, ct, { dur: 4.2, loop: true, lag: 0.45, spring: 0.5 });
      tp.thickness = 1 + 0.25 * env;
      tp.stretch = 1 + 0.08 * env;
      tail.set(tp);
      /* the ears: follow-through came with the clip; add a flick now and then, and the late answer to a pulse in the air */
      for (const sd of ['l', 'r']) {
        const name = 'ear-' + sd,
          e = p.pose[name] || (p.pose[name] = {}),
          r = e.rot ? e.rot.slice() : [0, 0, 0],
          push = A.response(fields, [HX + (sd === 'l' ? -0.4 : 0.4), 2.7, HZ], t, { lag: 0.16, strength: 1 });
        r[2] += flick(ct, sd === 'l' ? 4.3 : 6.1, sd === 'l' ? 3 : 7) * (drowse ? 0.4 : 1);
        e.rot = r;
        e.bend = [push[0], push[2]];
        const eye = p.pose['eye-' + sd] || (p.pose['eye-' + sd] = {});
        eye.scale = [1, Math.max(0.08, Math.min(1.15, f.open)), 1];
        (p.pose['pupil-' + sd] || (p.pose['pupil-' + sd] = {})).pos = [f.gaze[0] * 0.035, f.gaze[1] * 0.035, 0];
      }
      /* it turns its head to what it noticed, for a few seconds, and never further than a neck allows */
      const care = Math.max(0, 1 - (t - seenAt) / 4),
        at = p.solve().point('head', [HX, 2.02, HZ]),
        d = care > 0 ? V.sub(seen, at) : [0, 0, 1];
      (p.pose.head || (p.pose.head = {})).turn = A.track(
        { yaw: [-0.6, 0.6], pitch: [-0.22, 0.4], response: care > 0 ? 7 : 2.5 },
        look,
        d,
        dt
      );
      A.show(st, A.present(cues, t), W.pal, { unit: 0.02 });
    }
  });
  return {
    pup,
    brain,
    face,
    owns: i => ids.has(i),
    startle(p) {
      const t = st.time;
      pokeAt = clock;
      quiet = 0;
      brain.fire('poke');
      face.blink();
      cues.cues = A.preset('contact-impact', t).filter(c => c.type !== 'sprite-flash');
      cues.cues.push(A.cue('wince', 'flash', t, { amount: 0.16, duration: 0.14 }));
      fields.length = 0;
      fields.push({
        kind: 'pulse',
        center: p,
        radial: true,
        radius: 6,
        strength: 0.5,
        start: t,
        duration: 2,
        speed: 14,
        decay: 5
      });
    },
    notice(p) {
      seen = p.slice();
      seenAt = st.time;
      quiet = 0;
      fields.length = 0;
      fields.push({
        kind: 'pulse',
        center: p,
        radial: true,
        radius: 9,
        strength: 0.35,
        start: st.time,
        duration: 2,
        speed: 12,
        decay: 4
      });
    }
  };
}
// The Rehearsal: every ready clip, one after another, on one small creature. First the ten squash and stretch clips (attack, hurt, defeat,
// victory, dodge, windup, a heart lost and found, a button pressed and one refused), each with the cues that go with it; then a cage of
// handles pulling its cheeks about; then the twenty-one reaction fields. Its tail is laid along a curve whose end trails; its ears fold;
// it breathes and blinks throughout. Tap to go on to the next
// =====================================================================
function sceneRehearsal(seed) {
  const K = KIT,
    A = K.anim,
    V = K.V,
    B = makeBuilder(
      seed,
      [
        0x07080b, 0x15171c, 0x2a2e36, 0x474d57, 0x6d747c, 0x9aa09c, 0x2a1830, 0x5a2c4a, 0x9a4a5a, 0xd8786a, 0xf4b48c,
        0xffe6c4, 0xffffff, 0x1a1420, 0x6aa6b0, 0xcfeef0
      ]
    ),
    S = K.sculpt(makeSculpt(B)),
    tags = K.deform.tags(S);
  S.sun = B.norm([-0.5, 0.75, 0.45]);
  S.view = B.norm([0.3, 0.2, 0.93]);
  S.res = 0.1;
  S.amb = 0.24;
  S.sky = 0.3;
  const ST = { r: [1, 2, 3, 4, 5], mod: (x, y, z) => 0.2 * (B.n3(x * 0.8, y * 0.8, z * 0.8) - 0.5) },
    SKIN = { r: [6, 7, 8, 9, 10], mod: (x, y, z) => 0.12 * (B.n3(x * 1.4, y * 1.4, z * 1.4) - 0.5) },
    BELLY = { r: [9, 10, 11] };
  S.ground({ r: [1, 1, 2, 2, 3] }, { rad: 5, res: 0.15 });
  S.lathe([0, 0, 0], 0.5, [2.3, 2.1], ST, { res: 0.09 });
  S.bake();
  /* the creature is made by itself and whole, so no part has a hole or a shadow where another happened to stand */
  const body = S.ball([0, 1.42, 0], [0.86, 0.92, 0.78], SKIN, { res: 0.06, tag: 'core', whole: true });
  S.ball([0, 1.2, 0.46], [0.5, 0.52, 0.4], BELLY, { res: 0.06, tag: 'core', whole: true });
  for (const sx of [-1, 1]) {
    const sd = sx < 0 ? 'l' : 'r',
      eye = S.stud(
        body,
        { at: [sx * 0.36, 0.34], sink: 0.3 },
        0.13,
        { r: [12], em: true },
        { ghost: true, res: 0.035, tag: 'eye-' + sd }
      );
    S.stud(
      eye,
      { at: [0.1 * sx, -0.1], sink: 0.35 },
      0.07,
      { r: [13], em: true },
      { ghost: true, res: 0.03, tag: 'eye-' + sd }
    );
    S.ball([sx * 0.42, 0.62, 0.3], [0.26, 0.14, 0.34], SKIN, { res: 0.06, tag: 'core', whole: true });
    S.tube(
      [
        [sx * 0.42, 2.12, 0],
        [sx * 0.6, 2.62, -0.04],
        [sx * 0.66, 3.02, -0.06]
      ],
      0.2,
      0.05,
      SKIN,
      { res: 0.05, tag: 'ear-' + sd, whole: true }
    );
  }
  S.tube(
    [
      [0, 0.95, -0.6],
      [0, 1.15, -1.25],
      [0, 1.7, -1.6],
      [0, 2.25, -1.5]
    ],
    0.26,
    0.09,
    SKIN,
    { res: 0.055, tag: 'tail', whole: true }
  );
  S.bake();
  const W = B.finish({
      cam: { target: [0, 1.55, 0], dist: 8.6, pitch: 0.17, yaw: 0.5, sway: 0.25 },
      detail: 12,
      warnings: S.warnings,
      palName: 'Rehearsal',
      dither: 0.25,
      radius: 5.4,
      ao: { k: 0.5, range: 0.6 }
    }),
    st = K.stage(W),
    T0 = [0, 0.95, -0.6],
    T1 = [0, 2.25, -1.5],
    tail = K.deform.noodle({ from: T0, to: T1, handles: 4 }),
    field = K.deform.emote({ center: [0, 1.42, 0], width: 1.9, height: 1.84, right: [1, 0, 0] }),
    smear = K.deform.smear({ extent: 1.7, threshold: 1.2, gain: 0.07, max: 0.45 }),
    cage = K.deform.lattice({ min: [-0.95, 0.5, -0.85], max: [0.95, 2.4, 0.85] }, [2, 3, 2]),
    calm = cage.pts.slice();
  /* the cage's other pose: cheeks out, crown down */
  for (const i of [0, 1])
    for (const k of [0, 1]) {
      cage.move(i, 1, k, [(i ? 1 : -1) * 0.42, -0.05, (k ? 1 : -1) * 0.2]);
      cage.move(i, 2, k, [(i ? -1 : 1) * 0.12, -0.28, 0]);
    }
  const puffed = cage.pts.slice(),
    CUE = {
      attack: ['heavy-impact', 0.3],
      hurt: ['contact-impact', 0],
      defeat: ['contact-impact', 0],
      'heart-hurt': ['contact-impact', 0],
      victory: ['discovery', 0.28]
    },
    items = K.acts.KINDS.map(k => ({
      kind: k,
      /* (the two heart clips were drawn for a small icon and are far too much for a body: they are played at half strength) */
      clip: K.acts.clip(k, {
        part: 'core',
        unit: 1 / 62,
        gain: k.startsWith('heart') ? 0.55 : 1.3,
        dur: (K.acts.DUR[k] || 0.6) * 1.35
      }),
      dur: (K.acts.DUR[k] || 0.6) * 1.35 + 0.7
    }))
      .concat([{ kind: 'cage', dur: 3 }])
      .concat(K.deform.EMOTES.map(m => ({ kind: 'field', motion: m, dur: 2.3 }))),
    face = A.face({ gaze: { mode: 'curious', response: 6, amplitude: [0.7, 0.25], frequency: [0.5, 0.33] } }),
    cues = { cues: [] },
    sway = (dx, tw) => ({
      points: tail.rest.map((p, i) => [p[0] + (dx * i * i) / 9, p[1], p[2]]),
      twists: [0, tw * 0.3, tw * 0.7, tw]
    }),
    tailKeys = [
      { t: 0, v: sway(0.45, 25) },
      { t: 1.2, v: sway(-0.45, -25) },
      { t: 2.4, v: sway(0.45, 25) }
    ];
  let at = 0,
    tc = 0,
    clock = 0,
    cued = false;
  const next = () => {
    at = (at + 1) % items.length;
    tc = 0;
    cued = false;
  };
  const pup = K.puppet(W, {
    parts: {
      core: { ids: tags.core, pivot: [0, 0.5, 0], grid: [3, 5, 3] },
      'eye-l': { ids: tags['eye-l'], parent: 'core' },
      'eye-r': { ids: tags['eye-r'], parent: 'core' },
      'ear-l': {
        ids: tags['ear-l'],
        pivot: [-0.42, 2.12, 0],
        parent: 'core',
        axis: V.norm([-0.24, 0.9, -0.06]),
        slices: 9
      },
      'ear-r': {
        ids: tags['ear-r'],
        pivot: [0.42, 2.12, 0],
        parent: 'core',
        axis: V.norm([0.24, 0.9, -0.06]),
        slices: 9
      },
      tail: { ids: tags.tail, pivot: T0, parent: 'core', axis: V.norm(V.sub(T1, T0)), slices: 7, maps: [tail] }
    },
    pose(t, dt, p) {
      const ct = A.animTime(cues, t),
        cdt = Math.max(0, ct - clock),
        it = items[at];
      clock = ct;
      tc += cdt;
      if (tc > it.dur) next();
      const cur = items[at],
        core = p.pose.core || (p.pose.core = {}),
        br = K.acts.breathe(ct, { k: 0.03, rate: 2 });
      if (cur.clip) {
        cur.clip.sample(tc, p.pose);
        /* the cue that goes with the clip, once, at its moment */
        const q = CUE[cur.kind];
        if (q && !cued && tc >= q[1] * cur.clip.dur) {
          cued = true;
          cues.cues = A.preset(q[0], t).filter(c => c.type !== 'sprite-flash');
          /* a flash over a whole dark diorama is a lot: half of what was authored */
          for (const c of cues.cues) if (c.type === 'flash') c.amount *= 0.5;
        }
        /* and a smear when it is moving fast enough: what trails is left behind along the way it is going */
        const a = cur.clip.sample(tc, {}).core.pos,
          b = cur.clip.sample(Math.max(0, tc - 0.03), {}).core.pos,
          vel = V.mul(V.sub(a, b), 1 / 0.03);
        smear.from(vel, V.mad([0, 1.42, 0], V.norm(vel, [1, 0, 0]), 0.85));
        if (smear.len > 0) p.deform('core', smear);
      } else if (cur.kind === 'cage') {
        cage.mix(calm, puffed, 0.5 - 0.5 * Math.cos((tc / cur.dur) * Math.PI * 4));
        p.deform('core', cage);
      } else {
        field.motion = cur.motion;
        field.t = tc;
        field.k = 1.7 * K.acts.envelope(tc, cur.dur).opacity;
        p.deform('core', field);
      }
      const c2 = p.pose.core;
      c2.stretch = (c2.stretch === undefined ? 1 : c2.stretch) * br.stretch;
      c2.waist = br.waist;
      tail.set(K.deform.noodleAt(tail, tailKeys, ct, { dur: 2.4, loop: true, lag: 0.5, spring: 0.6 }));
      const f = face.step(cdt);
      for (const sd of ['l', 'r']) {
        p.pose['eye-' + sd] = {
          scale: [1, Math.max(0.08, Math.min(1.1, f.open)), 1],
          pos: [f.gaze[0] * 0.02, f.gaze[1] * 0.02, 0]
        };
        /* the ears fold over and spring back, one after the other */
        const ph = ct * 1.3 + (sd === 'l' ? 0 : 1.9);
        p.pose['ear-' + sd] = {
          fold: {
            angle: 0.9 * Math.pow(Math.max(0, Math.sin(ph)), 3) * (sd === 'l' ? -1 : 1),
            offset: 0.3,
            width: 0.45
          }
        };
      }
      A.show(st, A.present(cues, t), W.pal, { unit: 0.02 });
    }
  });
  st.add({
    poke() {
      next();
      face.blink();
    }
  });
  W.lab = { pup, items, now: () => items[at], next };
  return W;
}
SCENES.push(
  { id: 'watcher', name: 'Die Watcher', blurb: 'A die with an eye on one face. Tap it', seed: 2, build: sceneWatcher },
  {
    id: 'burn',
    name: 'Slow Burn',
    blurb: 'Fire that remembers where it has been. Tap to light more',
    seed: 3,
    build: sceneBurn
  },
  { id: 'idol', name: 'Old Idol', blurb: 'Tap it. What you knock out stays out', seed: 4, build: sceneIdol },
  {
    id: 'bench',
    name: 'The Bench',
    blurb: 'Jelly, sand, a beetle and a spark. Tap the jelly',
    seed: 5,
    build: sceneBench
  },
  {
    id: 'stuff',
    name: 'Soft Things',
    blurb: 'Jelly, cake, sand and water on one solver. Tap the cake',
    seed: 6,
    build: sceneStuff
  },
  {
    id: 'cabinet',
    name: 'Night Cabinet',
    blurb:
      'Glass, a slime lit from inside, a beast that minds you, smoke that shades itself. Tap the beast, or anywhere',
    seed: 7,
    build: sceneCabinet
  },
  {
    id: 'rehearsal',
    name: 'The Rehearsal',
    blurb: 'Every ready clip in turn: squash and stretch, a cage, the reaction fields. Tap for the next',
    seed: 8,
    build: sceneRehearsal
  }
);
