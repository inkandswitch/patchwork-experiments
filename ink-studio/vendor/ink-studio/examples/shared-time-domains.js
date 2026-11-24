/* Four independent clocks, native fixed simulation and a 12 fps articulated courier. */
function clockworkPavilion(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    { Q } = K,
    tau = Math.PI * 2;
  const palette = [
    0x080e24, 0x141e3f, 0x23375d, 0x365b9c, 0x6689db, 0xa8c4f2, 0x4d302c, 0x98603d, 0xe6a35a, 0xffd79a, 0xffebc3
  ];
  const nodes = {
    hero: { transform: { position: [-1.7, 0.35, 0.4] } },
    head: { parent: 'hero', transform: { position: [0, 1.45, 0] } },
    leftArm: { parent: 'hero', transform: { position: [-0.43, 1.08, 0] } },
    rightArm: { parent: 'hero', transform: { position: [0.43, 1.08, 0] } },
    leftLeg: { parent: 'hero', transform: { position: [-0.22, 0.51, 0] } },
    rightLeg: { parent: 'hero', transform: { position: [0.22, 0.51, 0] } },
    orrery: { transform: { position: [1.8, 1.55, -0.35] } },
    hand: { transform: { position: [1.8, 1.55, 0.12] } },
    drone: { transform: { position: [0, 2.9, 0] } },
    target: { parent: 'hero', transform: { position: [0, 1.1, 0.3] } }
  };
  const graph = K.sceneGraph.create({ nodes }),
    B = makeBuilder(624, palette),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S);
  S.pixel = true;
  S.pixelSize(38);
  const blue = { r: [1, 2, 3, 4, 5] },
    brass = { r: [6, 7, 8, 9, 10] },
    dark = { r: [0, 1, 2] },
    bright = { r: [4, 5, 10] },
    stone = K.pixel.masonry({ r: [1, 2, 3], stone: [7, 5], joint: 1, seed: 81 });
  function axes(id) {
    const a = graph.frame(id).matrix;
    return [
      [a[0], a[3], a[6]],
      [a[1], a[4], a[7]],
      [a[2], a[5], a[8]]
    ];
  }
  function box(id, p, h, m, res = 0.065) {
    S.box(id ? graph.toWorld(id, p) : p, h, m, { ...(id && { tag: id, ax: axes(id) }), rd: 0.025, res });
  }
  function ball(id, p, h, m, res = 0.055) {
    S.ball(id ? graph.toWorld(id, p) : p, h, m, { ...(id && { tag: id, ax: axes(id) }), res });
  }
  function tube(id, points, r, m, res = 0.06) {
    S.tube(id ? points.map(p => graph.toWorld(id, p)) : points, r, r, m, { ...(id && { tag: id }), res });
  }
  box(null, [0, -0.24, 0], [4.25, 0.27, 2.55], stone, 0.15);
  for (const x of [-1.7, 1.8]) {
    box(null, [x, 0.12, 0.1], [1.02, 0.11, 0.86], blue, 0.1);
    S.torus([x, 0.26, 0.1], 0.9, 0.035, brass, { res: 0.065 });
  }
  // Brass-inlaid midnight terrace with an architectural frame behind the two exhibits.
  for (const x of [-3.7, 0, 3.7]) {
    box(null, [x, 1.48, -1.65], [0.13, 1.45, 0.16], blue, 0.12);
    box(null, [x, 1.5, -1.46], [0.032, 1.28, 0.025], brass, 0.1);
    box(null, [x, 2.98, -1.65], [0.28, 0.14, 0.3], brass, 0.1);
  }
  box(null, [0, 3.18, -1.65], [3.95, 0.12, 0.22], blue, 0.12);
  for (const x of [-2.7, -1.8, -0.9, 0.9, 1.8, 2.7]) {
    tube(
      null,
      [
        [x, 3.15, -1.65],
        [x, 2.8, -1.65]
      ],
      0.018,
      brass
    );
    ball(null, [x, 2.72, -1.65], [0.09, 0.14, 0.09], brass);
  }
  box('hero', [0, 0.97, 0], [0.32, 0.35, 0.22], brass);
  box('hero', [0, 0.99, 0.235], [0.22, 0.2, 0.024], blue, 0.045);
  for (let i = 0; i < 3; i++) box('hero', [-0.13 + i * 0.13, 1.03, 0.27], [0.023, 0.08, 0.015], bright, 0.035);
  ball('head', [0, 0, 0], [0.42, 0.33, 0.31], blue);
  box('head', [0, -0.015, 0.27], [0.34, 0.14, 0.055], dark, 0.045);
  for (const x of [-0.15, 0.15]) box('head', [x, 0.005, 0.331], [0.075, 0.045, 0.012], brass, 0.03);
  for (const x of [-0.28, 0.28]) {
    tube(
      'head',
      [
        [x, 0.24, 0],
        [x, 0.48, 0]
      ],
      0.018,
      brass,
      0.04
    );
    ball('head', [x, 0.49, 0], [0.045, 0.045, 0.045], bright, 0.035);
  }
  for (const side of ['leftArm', 'rightArm']) {
    ball(side, [0, 0, 0], [0.12, 0.13, 0.13], bright);
    box(side, [0, -0.29, 0], [0.095, 0.26, 0.11], blue);
    ball(side, [0, -0.57, 0], [0.14, 0.14, 0.14], brass);
  }
  for (const side of ['leftLeg', 'rightLeg']) {
    ball(side, [0, 0, 0], [0.11, 0.11, 0.12], bright);
    box(side, [0, -0.18, 0], [0.1, 0.18, 0.12], blue);
    box(side, [0, -0.35, 0.09], [0.15, 0.1, 0.24], brass);
  }
  // Orbiting mechanism is separately sampled at 24 fps; its hand is driven by the fixed simulation.
  for (const radius of [0.73, 1.03]) {
    const pts = Array.from({ length: 81 }, (_, i) => {
      const a = (i / 80) * tau;
      return [Math.cos(a) * radius, Math.sin(a) * radius, 0];
    });
    tube('orrery', pts, 0.025, brass, 0.05);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * tau;
    ball('orrery', [Math.sin(a) * 1.03, Math.cos(a) * 1.03, 0], [0.055, 0.055, 0.055], i % 3 ? blue : brass, 0.04);
  }
  ball('orrery', [0.73, 0, 0], [0.18, 0.18, 0.18], blue);
  ball('orrery', [-1.03, 0, 0], [0.13, 0.13, 0.13], brass);
  tube(
    'hand',
    [
      [0, 0, 0],
      [0, 0.66, 0]
    ],
    0.035,
    bright,
    0.045
  );
  ball('hand', [0, 0, 0.02], [0.09, 0.09, 0.08], brass, 0.035);
  box('drone', [0, 0, 0], [0.16, 0.08, 0.14], brass);
  for (const x of [-0.25, 0.25]) {
    ball('drone', [x, 0, 0], [0.13, 0.035, 0.13], blue);
  }
  for (let i = 0; i < 14; i++) {
    const x = Math.sin(i * 2.71) * 3.8,
      z = Math.cos(i * 1.9) * 2;
    if (Math.abs(x) < 2.8 && Math.abs(z) < 1.2) continue;
    ball(null, [x, 0.13, z], [0.25, 0.15, 0.22], blue, 0.09);
    for (let j = 0; j < 3; j++)
      tube(
        null,
        [
          [x + (j - 1) * 0.11, 0.2, z],
          [x + (j - 1) * 0.17, 0.47 + j * 0.08, z - 0.06]
        ],
        0.025,
        brass,
        0.055
      );
  }
  S.bake();
  const atlas = SpriteSurface.make(256);
  atlas.mesh(
    TexturedSurface.heightfield({ bounds: [-4.13, 4.13, -2.43, 2.43], segments: [1, 1], height: () => 0.19 }),
    224,
    144,
    (x, y) => {
      const line = x % 16 === 0 || y % 16 === 0,
        edge = x < 3 || x > 220 || y < 3 || y > 140;
      return palette[edge ? 7 : line ? 3 : (x * 17 + y * 31) % 127 === 0 ? 2 : 1];
    }
  );
  // Pixel artwork in both exhibit plaques: no blurred text or splat windows.
  const glyphs = ['..##...#...###.', '.####.###...#..', '##..##.#...###.', '.####..#...#.#.', '..##..###..###.'];
  for (const [x, accent] of [
    [-1.7, 8],
    [1.8, 4]
  ])
    atlas.face([x - 0.65, 0.28, 1.35], [1.3, 0, 0], [0, 0.42, 0], 65, 21, (u, v) => {
      if (u === 0 || u === 64 || v === 0 || v === 20) return palette[accent];
      if (v > 5 && v < 16 && glyphs[Math.floor((v - 6) / 2)]?.[Math.floor((u - 17) / 2)] === '#') return palette[9];
      return palette[0];
    });
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 1.35, 0], dist: 13, yaw: 0.19, pitch: 0.32 };
  world.radius = 8;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const clocks = K.timeDomains.create({
      domains: { hero: { parent: 'animation', fps: 12 }, mechanism: { parent: 'animation', fps: 24 } }
    }),
    stage = K.stage(world).useTimeDomains(clocks);
  rig.bind(stage);
  const run = K.world.runtime.create({
      id: 'pavilion',
      dt: 1 / 60,
      systems: { beat: { kind: 'control', config: { op: 'timer', ticks: 60 } } }
    }),
    driver = K.timeDomains.simulation(clocks, run),
    counts = { hero: 0, mechanism: 0, camera: 0 };
  stage.add(driver);
  stage.add(
    {
      update(dt, t) {
        counts.hero++;
        graph.setLocal('hero', {
          position: [-1.7, 0.35 + Math.abs(Math.sin(t * 2.4)) * 0.6, 0.4],
          rotation: Q.fromAxisAngle([0, 1, 0], Math.sin(t * 1.2) * 0.18)
        });
        graph.setLocal('head', {
          position: [0, 1.45, 0],
          rotation: Q.fromAxisAngle([0, 0, 1], Math.sin(t * 2) * 0.12)
        });
        for (const [id, x, s] of [
          ['leftArm', -0.43, 1],
          ['rightArm', 0.43, -1]
        ])
          graph.setLocal(id, {
            position: [x, 1.08, 0],
            rotation: Q.fromAxisAngle([0, 0, 1], s * (0.3 + Math.sin(t * 2.4) * 0.65))
          });
        for (const [id, x, s] of [
          ['leftLeg', -0.22, 1],
          ['rightLeg', 0.22, -1]
        ])
          graph.setLocal(id, {
            position: [x, 0.51, 0],
            rotation: Q.fromAxisAngle([1, 0, 0], Math.sin(t * 2.4) * 0.4 * s)
          });
      }
    },
    { domain: 'hero' }
  );
  stage.add(
    {
      update(dt, t) {
        counts.mechanism++;
        graph.setLocal('orrery', { position: [1.8, 1.55, -0.35], rotation: Q.fromAxisAngle([0, 0, 1], t * 0.6) });
      }
    },
    { domain: 'mechanism' }
  );
  stage.add({
    update(dt, t) {
      graph.setLocal('hand', {
        position: [1.8, 1.55, 0.12],
        rotation: Q.fromAxisAngle([0, 0, 1], (-run.view().time * tau) / 6)
      });
      graph.setLocal('drone', {
        position: [Math.sin(t * 0.9) * 2.7, 2.5 + Math.cos(t * 1.2) * 0.2, 0.7 + Math.cos(t * 0.9) * 0.5]
      });
    }
  });
  const binding = K.sceneGraph.attach(world, graph, {
    geometry: Object.keys(nodes)
      .filter(id => id !== 'target')
      .map(id => ({ node: id, part: id }))
  });
  const cameraProgram = K.cameraRig.compile({
    rails: {
      track: {
        points: [
          [1.2, 5, 12.7],
          [-2, 4.7, 12.5],
          [-1.5, 4.1, 12.6],
          [2.2, 4.3, 12.5]
        ],
        closed: true
      }
    },
    shots: {
      orbit: {
        target: [0, 1.35, 0],
        rail: 'track',
        progress: [
          { time: 0, value: 0, ease: 'linear' },
          { time: 24, value: 1 }
        ]
      }
    }
  });
  K.cameraRig.bind(world, cameraProgram);
  const camera = world.cameraRig,
    sample = camera.sample.bind(camera);
  world.cameraRig = {
    ...camera,
    sample: (t, o) => {
      counts.camera++;
      return sample(t % 24, o);
    }
  };
  const inspection = {
    maxTargets: 1,
    style: { color: '#ffd79a', corner: 5, padding: 4 },
    targets: [
      {
        id: 'courier',
        at: { node: 'target' },
        label: () =>
          'COURIER / ' +
          (clocks.read('hero').effectiveRate === 0 ? 'HELD' : (clocks.read('hero').fps ?? 'CONTINUOUS') + ' FPS'),
        halfSize: [0.55, 0.75, 0.3],
        occlusion: 'none',
        ripple: { period: 4, radius: 38, speed: 22, width: 8, cell: 7, chars: '01:+' }
      }
    ]
  };
  return {
    world,
    graph,
    clocks,
    stage,
    run,
    driver,
    counts,
    binding,
    inspection,
    update(dt) {
      stage.update(dt, clocks.wall + dt);
      return world;
    }
  };
}
if (typeof module !== 'undefined') module.exports = clockworkPavilion;
