/* Midnight midway: working route followers, native rubble and independently sampled camera motion. */
function midnightMidway(kit, { sharedTime = true } = {}) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface, CameraLens: L } = kit,
    { V, M } = K,
    tau = 2 * Math.PI;
  const palette = [
    0x0b1024, 0x1b2446, 0x303d68, 0x526a9a, 0x8da9ce, 0xc8dbdd, 0x4a302b, 0x94623e, 0xe3a65c, 0xffd99b, 0xffedc7,
    0x304846, 0x5c8270
  ];
  const points = [
    [-4, 0.85, 3],
    [-4, 1.3, 0],
    [-3, 0.85, -2]
  ];
  for (let i = 0; i <= 48; i++) {
    const a = (i * tau) / 48;
    points.push([-1 + 2.0 * Math.sin(a), 0.85 + 2.0 * (1 - Math.cos(a)), -2 + a * 0.18]);
  }
  points.push([2, 0.85, 0], [4, 1.5, 2], [2, 0.85, 4], [-2, 0.85, 4]);
  const route = K.anim.route(K.anim.path(points, { closed: true }), {
    speed: 4.3,
    bank: { gain: 1.3, limit: 0.22 },
    step: 0.12
  });
  const firstCars = route.vehicles(0, { count: 3, spacing: 0.95, wheelbase: 0.5 }),
    graph = K.sceneGraph.create({
      nodes: Object.fromEntries(
        firstCars.map((c, i) => ['car' + i, { transform: { position: c.p, matrix: c.matrix } }])
      )
    });
  const B = makeBuilder(64, palette),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S);
  S.pixel = true;
  S.pixelSize(44);
  const stone = K.pixel.masonry({ r: [0, 1, 2], stone: [7, 5], joint: 1, seed: 64 }),
    metal = { r: [0, 1, 2, 3, 4] },
    brass = { r: [6, 7, 8, 9] },
    bright = { r: [8, 9, 10] },
    leaves = { r: [11, 12, 4] },
    height = (x, z) => 0.24 + 0.11 * Math.sin(x * 0.55) * Math.cos(z * 0.65);
  S.box([0, -0.25, 0], [7, 0.3, 6.2], stone, { res: 0.2, rd: 0.1 });
  const rail = [[], []];
  for (let d = 0; d <= route.length; d += 0.12) {
    const f = route.frame(Math.min(d, route.length));
    [-0.26, 0.26].forEach((side, i) => rail[i].push(V.mad(f.p, f.right, side)));
  }
  for (const side of rail) S.tube(side, 0.035, 0.035, brass, { res: 0.07 });
  for (let d = 0; d < route.length; d += 0.48) {
    const f = route.frame(d);
    S.tube([V.mad(f.p, f.right, -0.34), V.mad(f.p, f.right, 0.34)], 0.04, 0.04, metal, { res: 0.08 });
  }
  for (let d = 0; d < route.length; d += 1.6) {
    const f = route.frame(d);
    if (f.p[1] < 1.2) continue;
    for (const side of [-0.43, 0.43]) {
      const p = V.mad(f.p, f.right, side),
        foot = [p[0], height(p[0], p[2]), p[2]];
      S.tube([foot, p], 0.065, 0.055, metal, { res: 0.1 });
    }
    if (f.p[1] > 2)
      S.tube(
        [
          [f.p[0] - 0.42, height(f.p[0], f.p[2]), f.p[2]],
          [f.p[0] + 0.42, f.p[1] - 0.1, f.p[2]]
        ],
        0.035,
        0.035,
        brass,
        { res: 0.09 }
      );
  }
  // A compact station kept clear of the running rails.
  S.box([4.9, 0.43, 3.1], [1.25, 0.15, 0.82], metal, { res: 0.12, rd: 0.05 });
  for (const x of [3.8, 6])
    for (const z of [2.45, 3.75])
      S.tube(
        [
          [x, 0.48, z],
          [x, 2.35, z]
        ],
        0.055,
        0.045,
        brass,
        { res: 0.08 }
      );
  S.box([4.9, 2.45, 3.1], [1.45, 0.13, 1], metal, { res: 0.12, rd: 0.06 });
  for (const side of [-1, 1])
    S.tube(
      [
        [4.9, 2.8, 3.1],
        [4.9 + side * 1.55, 2.45, 3.1]
      ],
      0.08,
      0.06,
      brass,
      { res: 0.1 }
    );
  // Foliage uses layered blades rather than spherical crowns.
  for (const [x, z] of [
    [-5.7, -3.5],
    [5.7, -3.1],
    [-5.9, 2.9],
    [5.9, 0.1]
  ]) {
    const y = height(x, z);
    S.tube(
      [
        [x, y, z],
        [x + 0.08, y + 2.5, z]
      ],
      0.12,
      0.05,
      brass,
      { res: 0.1 }
    );
    for (let level = 0; level < 4; level++)
      for (let j = 0; j < 5; j++) {
        const a = (j * tau) / 5 + level * 0.55,
          r = 0.9 - level * 0.16;
        const tip = [x + Math.cos(a) * r, y + 0.65 + level * 0.45, z + Math.sin(a) * r];
        S.tube([[x, y + 1.25 + level * 0.4, z], tip], 0.035, 0.018, metal, { res: 0.07 });
        S.ball(tip, [0.47 - level * 0.05, 0.075, 0.2], leaves, { res: 0.075, ax: B.frame(0, a, Math.sin(a) * 0.2) });
      }
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.sin(i * 9.1) * 6.5,
      z = Math.cos(i * 5.7) * 5.4;
    if (Math.abs(x) < 4.7 && Math.abs(z) < 4.4) continue;
    const y = height(x, z);
    S.rock([x, y, z], [0.3, 0.22, 0.25], metal, { res: 0.095 });
    if (i % 3 === 0)
      for (let j = 0; j < 5; j++) {
        const a = (j * tau) / 5;
        S.ball([x + Math.cos(a) * 0.14, y + 0.4 + Math.sin(a) * 0.14, z], [0.085, 0.085, 0.035], bright, { res: 0.05 });
      }
  }
  const instrument = [-3.5, 0.85, 5.15];
  S.box([-3.5, 0.49, 5.15], [0.6, 0.2, 0.5], metal, { res: 0.1, rd: 0.06 });
  S.tube(
    [
      [-3.5, 0.75, 5.15],
      [-3.5, 1.22, 4.4]
    ],
    0.13,
    0.11,
    brass,
    { res: 0.065 }
  );
  for (let i = 0; i < 5; i++)
    S.torus([-3.5, 0.78 + i * 0.07, 5.08 - i * 0.11], 0.13, 0.025, metal, { res: 0.045, ax: B.frame(0.65, 0, 0) });
  function axes(id) {
    const a = graph.frame(id).matrix;
    return [
      [a[0], a[3], a[6]],
      [a[1], a[4], a[7]],
      [a[2], a[5], a[8]]
    ];
  }
  function carBox(id, p, h, mat) {
    S.box(graph.toWorld(id, p), h, mat, { tag: id, ax: axes(id), res: 0.055, rd: 0.025 });
  }
  for (let i = 0; i < 3; i++) {
    const id = 'car' + i;
    carBox(id, [0, 0.2, 0], [0.32, 0.16, 0.42], brass);
    carBox(id, [0, 0.44, -0.28], [0.29, 0.13, 0.09], metal);
    for (const x of [-0.16, 0.16]) {
      S.ball(graph.toWorld(id, [x, 0.58, -0.07]), [0.085, 0.09, 0.085], bright, { tag: id, res: 0.045 });
      carBox(id, [x, 0.44, -0.08], [0.085, 0.1, 0.08], metal);
    }
    carBox(id, [0, 0.36, 0.24], [0.27, 0.035, 0.035], bright);
  }
  S.bake();
  const atlas = SpriteSurface.make(512),
    ground = TexturedSurface.heightfield({ bounds: [-6.88, 6.88, -6.05, 6.05], segments: [24, 20], height });
  atlas.mesh(ground, 224, 192, (x, y) => {
    const path = Math.abs(x - 112) < 10 || Math.abs(y - 151) < 8;
    return palette[path ? (x % 9 === 0 || y % 7 === 0 ? 3 : 2) : (x * 19 + y * 31) % 137 < 4 ? 12 : 11];
  });
  const grass = atlas.reserve(15, 23, (x, y) =>
    [
      [-0.34, 3],
      [0.27, -3],
      [0, 0]
    ].some(([s, o]) => y > 3 + Math.abs(o) && Math.abs(x - 7 - o - (22 - y) * s) < 0.8)
      ? palette[(x + y) % 4 === 0 ? 4 : 12]
      : null
  );
  for (let i = 0; i < 110; i++) {
    const x = Math.sin(i * 13.3) * 6.7,
      z = Math.cos(i * 7.4) * 5.9;
    if (Math.abs(x) < 0.5 || Math.abs(z - 3.4) < 0.45) continue;
    atlas.faceRegion([x - 0.12, height(x, z), z], [0.24, 0, 0], [0, 0.38, 0], grass);
  }
  const letters = ['..##..#..#..##..', '.####.#..#.####.', '##..#####.##..##', '.####.#..#.####.', '..##..#..#..##..'];
  atlas.face([3.95, 1.9, 4.15], [1.9, 0, 0], [0, 0.4, 0], 76, 16, (x, y) => {
    if (x === 0 || x === 75 || y === 0 || y === 15) return palette[8];
    return letters[Math.floor((y - 3) / 2)]?.[Math.floor((x - 22) / 2)] === '#' ? palette[9] : palette[0];
  });
  const thunderSource = [-25, 12, -45],
    cloudRight = [0.94, 0, -0.34];
  atlas.face(
    V.add(V.add(thunderSource, V.mul(cloudRight, -11)), [0, -2.5, 0]),
    V.mul(cloudRight, 22),
    [0, 6, 0],
    176,
    48,
    (x, y) => {
      const inside = [
        [32, 28, 33, 19],
        [72, 20, 35, 20],
        [111, 27, 35, 19],
        [143, 31, 29, 14]
      ].some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1);
      if (!inside) return null;
      const edge = (x * 17 + y * 31) % 19 < 3;
      return palette[y < 17 ? (edge ? 3 : 2) : edge ? 2 : 1];
    }
  );
  atlas.face([5, 13, -43], [3.2, 0, 0], [0, 3.2, 0], 40, 40, (x, y) => {
    const r = Math.hypot(x - 20, y - 20);
    return r < 18 ? palette[(x * 19 + y * 7) % 29 < 8 ? 8 : 9] : null;
  });
  let physics;
  const state = { pending: null, broken: false, latest: null, flash: 0, lightning: 0, sparks: null };
  const effects = K.cameraImpulses.create({
    seed: 73,
    translationLimit: 0.9,
    rotationLimit: 0.24,
    handheld: [
      {
        id: 'breath',
        frequency: 0.3,
        translation: [0.008, 0.012, 0.003],
        rotation: [0.001, 0.0014, 0.0008],
        weight: 0.6,
        seed: 19
      },
      {
        id: 'steps',
        frequency: 1.7,
        translation: [0.003, 0.005, 0.002],
        rotation: [0.0005, 0.0003, 0.0006],
        weight: 0.35,
        seed: 27
      }
    ]
  });
  const bursts = K.frameSplats(B, 160, (draw, dt, t) => {
    const wall = sharedTime ? motionTime() : t;
    if (wall >= state.flash - 0.12 && wall < state.flash)
      draw.streak([-3.5, 1.2, 4.4], [-3.5, 1.45, 3.8], { width: 0.08, color: 10, depth: true });
    if (wall >= state.lightning - 0.27 && wall < state.lightning) {
      const p = thunderSource;
      for (const [a, b] of [
        [
          [0, 1, 0],
          [1, -1, 0]
        ],
        [
          [1, -1, 0],
          [-0.1, -2.3, 0]
        ],
        [
          [-0.1, -2.3, 0],
          [1.6, -4.6, 0]
        ]
      ])
        draw.streak(V.add(p, a), V.add(p, b), { width: 0.09, color: 10, depth: true });
    }
    if (state.sparks) {
      const age = t - state.sparks.time;
      if (age >= 0 && age < 0.65)
        for (let i = 0; i < 30; i++) {
          const a = i * 2.4,
            v = [Math.cos(a) * 2.4, 1.2 + (i % 5) * 0.6, Math.sin(a) * 2.4],
            p = V.add(state.sparks.p, V.mul(v, age));
          p[1] -= 6 * age * age;
          draw.point(p, { width: 0.018, color: 8 + (i % 3), depth: true });
        }
    }
  });
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 1.8, 0], dist: 17.5, yaw: 0.43, pitch: 0.22, focalLength: 31 };
  world.radius = 23;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const clocks = K.timeDomains.create({ domains: { impulses: { parent: 'camera' } } }),
    stage = K.stage(world);
  if (sharedTime) stage.useTimeDomains(clocks);
  else stage.t0 = 0;
  rig.bind(stage);
  effects.bind(world);
  const settings = { handheld: true, view: 'overview', motionOffset: 0 },
    views = K.cameraRig.compile({
      shots: {
        overview: { target: [0, 1.8, 0], dist: 17.5, yaw: 0.43, pitch: 0.22, focalLength: 31 },
        trackside: { target: [0, 1.7, 0], dist: 11.5, yaw: 0.18, pitch: 0.16, focalLength: 28 },
        wide: { target: [0, 1.6, 0], dist: 24, yaw: 0.58, pitch: 0.38, focalLength: 35 }
      }
    });
  K.cameraRig.bind(world, views);
  const bound = world.cameraRig,
    control = K.cameraRig.control(t => bound.sample(t, { shot: settings.view }), { handoff: 0.6 });
  control.update(0, 0);
  const motionTime = () => Math.max(0, clocks.read('impulses').time - settings.motionOffset);
  function emit(name, source) {
    const time = motionTime();
    effects.prune(Math.max(0, time - 8));
    const event = K.cameraImpulses.preset(name, {
        ...(source && { source }),
        time,
        ...(name === 'crash'
          ? {
              translation: [0, 0, 0.65],
              rotation: [0.02, 0.01, 0.04],
              angularGain: 0.9,
              falloff: { inner: 4, outer: 40, power: 1.3 }
            }
          : name === 'thunder'
            ? { translation: [0, 0.09, 0.06], rotation: [0.008, 0.009, 0.007] }
            : {})
      }),
      id = effects.emit(event);
    state.latest = {
      id,
      type: name,
      time,
      source: source ?? null,
      duration: event.duration,
      propagationSpeed: event.propagationSpeed ?? 0
    };
    return id;
  }
  stage.add({
    update(dt, t) {
      for (const [i, c] of route.vehicles(t, { count: 3, spacing: 0.95, wheelbase: 0.5 }).entries())
        graph.setLocal('car' + i, { position: c.p, matrix: c.matrix });
    }
  });
  K.sceneGraph.attach(world, graph, { geometry: firstCars.map((_, i) => ({ node: 'car' + i, part: 'car' + i })) });
  stage.add({
    update(dt, t) {
      if (state.pending !== null && t >= state.pending) {
        state.pending = null;
        const cars = route.vehicles(t, { count: 3, spacing: 0.95, wheelbase: 0.5 });
        for (const [i, c] of cars.entries())
          physics.release('car' + i, {
            v: V.add(c.velocity, [i * 0.4, 3.1, 0.8]),
            w: [1.3, i * 0.7, 2.5],
            origin: c.p,
            fragmentSize: 0.25,
            scatter: 1.6
          });
        state.broken = true;
        state.sparks = { p: cars[0].p.slice(), time: t };
        emit('crash', cars[0].p);
      }
    }
  });
  const groups = firstCars.map((_, i) => ({
    id: 'car' + i,
    ids: Array.from(rig.bid).flatMap((part, id) => (part === rig.names.indexOf('car' + i) ? [id] : [])),
    mass: 2.5,
    strength: 10,
    fragmentSize: 0.25
  }));
  physics = stage.add(K.destruction(stage, { groups, gravity: 12, ground: height, maxPieces: 40, points: 6 }));
  stage.add(bursts);
  stage.update(0, 0);
  return {
    world,
    stage,
    graph,
    clocks,
    effects,
    route,
    physics,
    control,
    settings,
    state,
    motionTime,
    trigger(name) {
      clocks.pause('impulses', false);
      if (name === 'crash') {
        if (state.broken) {
          physics.reset();
          state.broken = false;
          state.sparks = null;
          return 'reset';
        }
        clocks.pause('animation', false);
        state.pending = stage.time + 0.25;
        return 'armed';
      }
      if (name === 'recoil') {
        state.flash = motionTime() + 0.12;
        return emit(name);
      }
      if (name === 'thunder') {
        state.lightning = motionTime() + 0.27;
        return emit(name, thunderSource);
      }
      throw new Error('Unknown camera impulse demo event');
    },
    seek(time) {
      settings.motionOffset = clocks.read('impulses').time - Math.max(0, time);
      clocks.pause('impulses');
      effects.seek(motionTime());
    },
    reset() {
      physics.reset();
      effects.clear();
      state.broken = false;
      state.pending = null;
      state.latest = null;
      state.sparks = null;
    },
    update(dt) {
      stage.update(dt, clocks.wall + dt);
      effects.seek(motionTime());
      control.update(sharedTime ? clocks.read('interface').dt : dt, clocks.read('camera').time);
      return world;
    },
    listener() {
      const camera = control.read().camera,
        target = L.target(camera, 1080 / 760),
        back = [
          Math.sin(camera.yaw) * Math.cos(camera.pitch),
          Math.sin(camera.pitch),
          Math.cos(camera.yaw) * Math.cos(camera.pitch)
        ],
        right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)],
        up = V.cross(back, right),
        pose = { eye: V.mad(target, back, camera.dist), right, up, back };
      return pose;
    },
    inspect(time = motionTime()) {
      return effects.sample(time, { pose: this.listener() });
    }
  };
}
if (typeof module !== 'undefined')
  module.exports = Object.assign(
    kit => ({
      id: 'directional-camera-impulses',
      name: 'Midnight midway',
      build: () => midnightMidway(kit, { sharedTime: false }).world
    }),
    { demo: midnightMidway }
  );
