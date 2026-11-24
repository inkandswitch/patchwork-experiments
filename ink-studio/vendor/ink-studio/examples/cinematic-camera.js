/* Lantern passage: physical SDF/splat scenery, crisp optional atlas surfaces and shared camera rigs. */
function lanternPassage(kit, { sharedTime = true } = {}) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    { Q } = K,
    tau = 2 * Math.PI;
  const palette = [
    0x071a24, 0x102e3b, 0x1e4b57, 0x327480, 0x66a5a7, 0xb6d6cb, 0x50302d, 0x97513c, 0xdd8b59, 0xffc58a, 0xffe6b2,
    0x304d47, 0x57806a
  ];
  const B = makeBuilder(73, palette),
    S = K.sculpt(makeSculpt(B)),
    rig = K.rig(B, S),
    cap = K.light.capture(B, S);
  S.pixel = true;
  S.pixelSize(46);
  const stone = K.pixel.masonry({ r: [0, 1, 2, 3], stone: [7, 5], joint: 1, seed: 73 }),
    teal = { r: [0, 1, 2, 3, 4, 5] },
    copper = { r: [6, 7, 8, 9] },
    paper = { r: [7, 8, 9, 10] },
    leaf = { r: [11, 12, 4] };
  S.box([0, -0.28, -5], [4.3, 0.3, 8.5], stone, { res: 0.19, rd: 0.1 });
  for (const [i, z] of [0, -3.8, -7.6, -11.4].entries()) {
    const x = 2.75 + i * 0.08,
      mat = i > 1 ? { r: [0, 1, 2] } : teal;
    for (const d of [-1, 1]) {
      S.box([d * x, 1.75, z], [0.16, 1.75, 0.2], mat, { res: 0.12, rd: 0.035 });
      S.box([d * x, 0.24, z], [0.32, 0.2, 0.34], stone, { res: 0.12, rd: 0.04 });
      S.box([d * x, 3.5, z], [0.36, 0.15, 0.34], copper, { res: 0.09, rd: 0.035 });
      S.box([d * x, 1.75, z + 0.22], [0.027, 1.44, 0.017], copper, { res: 0.08 });
      S.tube(
        [
          [d * (x - 0.06), 3.52, z],
          [d * (x - 0.4), 3.25, z],
          [d * (x - 0.7), 3.17, z]
        ],
        0.04,
        0.04,
        copper,
        { res: 0.07 }
      );
    }
    S.box([0, 3.76, z], [x + 0.45, 0.13, 0.31], mat, { res: 0.13, rd: 0.055 });
    S.tube(
      [
        [-x - 0.5, 3.92, z],
        [-1.6, 3.87, z],
        [0, 3.84, z],
        [1.6, 3.87, z],
        [x + 0.5, 3.92, z]
      ],
      0.045,
      0.045,
      copper,
      { res: 0.1 }
    );
    for (const d of [-1, 1]) {
      S.tube(
        [
          [d * 1.85, 3.75, z],
          [d * 1.85, 3.2, z]
        ],
        0.018,
        0.018,
        copper,
        { res: 0.06 }
      );
      S.ball([d * 1.85, 3.08, z], [0.15, 0.23, 0.15], paper, { res: 0.065 });
    }
  }
  const graph = K.sceneGraph.create({
    nodes: {
      lantern: { transform: { position: [0, 1.9, 0] } },
      sigil: { parent: 'lantern' },
      bulb: { parent: 'lantern' },
      target: { parent: 'lantern' }
    }
  });
  const center = graph.frame('lantern').position;
  S.ball(center, [0.55, 0.73, 0.48], paper, { tag: 'lantern', res: 0.047 });
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * tau,
      points = Array.from({ length: 25 }, (_, i) => {
        const b = -1.2 + (i / 24) * 2.4;
        return [Math.cos(a) * 0.557 * Math.cos(b), 1.9 + Math.sin(b) * 0.81, Math.sin(a) * 0.487 * Math.cos(b)];
      });
    S.tube(points, 0.013, 0.013, copper, { tag: 'lantern', res: 0.04 });
  }
  for (const y of [1.15, 2.65]) S.box([0, y, 0], [0.39, 0.06, 0.34], teal, { tag: 'lantern', res: 0.055, rd: 0.035 });
  S.tube(
    [
      [0, 2.7, 0],
      [0, 2.98, 0]
    ],
    0.02,
    0.02,
    copper,
    { tag: 'lantern', res: 0.04 }
  );
  S.tube(
    [
      [0, 1.09, 0],
      [0.02, 0.86, 0],
      [-0.03, 0.63, 0]
    ],
    0.024,
    0.019,
    copper,
    { tag: 'lantern', res: 0.04 }
  );
  for (let i = 0; i < 7; i++)
    S.tube(
      [
        [0, 0.76, 0],
        [(i - 3) * 0.038, 0.47 + Math.abs(i - 3) * 0.025, 0.02]
      ],
      0.012,
      0.008,
      paper,
      { tag: 'lantern', res: 0.035 }
    );
  for (let i = 0; i < 34; i++) {
    const d = i % 2 ? -1 : 1,
      x = d * (2.9 + Math.sin(i * 7.2) * 0.7),
      z = 2 - (i / 2) * 0.85;
    S.ball([x, 0.16, z], [0.3 + Math.cos(i) * 0.1, 0.21, 0.25], stone, { res: 0.095 });
    for (let j = 0; j < 4; j++) {
      const a = j * 2.4 + i,
        xx = x + Math.cos(a) * 0.23,
        zz = z + Math.sin(a) * 0.2;
      S.ball([xx, 0.4 + (j % 3) * 0.1, zz], [0.23, 0.055, 0.105], leaf, { res: 0.06, ax: B.frame(0, 0, a * 0.5) });
    }
    if (i % 4 === 0) {
      S.tube(
        [
          [x, 0.2, z],
          [x + 0.05, 0.7, z]
        ],
        0.02,
        0.014,
        leaf,
        { res: 0.06 }
      );
      for (let j = 0; j < 5; j++) {
        const a = (j * tau) / 5;
        S.ball([x + 0.05 + Math.cos(a) * 0.11, 0.72 + Math.sin(a) * 0.11, z], [0.075, 0.075, 0.035], paper, {
          res: 0.045
        });
      }
    }
  }
  S.bake();
  const atlas = SpriteSurface.make(512);
  atlas.mesh(
    TexturedSurface.heightfield({ bounds: [-4.18, 4.18, -13.35, 3.35], segments: [1, 1], height: () => 0.23 }),
    224,
    448,
    (x, y) => {
      const edge = x < 3 || x > 220,
        line = x % 28 === 0 || y % 28 === 0;
      if (edge) return palette[7];
      if (line) return palette[3];
      const tile = (Math.floor(x / 28) + Math.floor(y / 28)) % 2;
      return palette[tile ? 1 : 2];
    }
  );
  const grass = atlas.reserve(15, 23, (x, y) => {
    const blade = [
      [-0.3, 4],
      [0.25, -3],
      [0, 0]
    ].some(([s, o]) => y > Math.abs(o) + 2 && Math.abs(x - 7 - o - (22 - y) * s) < 0.8);
    return blade ? palette[(x + y) % 5 === 0 ? 4 : 12] : null;
  });
  for (let i = 0; i < 56; i++) {
    const x = (i % 2 ? -1 : 1) * (2.45 + Math.sin(i * 13.7) * 1.3),
      z = 2.8 - (i / 2) * 0.56;
    atlas.faceRegion([x - 0.13, 0.23, z], [0.26, 0, 0], [0, 0.4, 0], grass);
  }
  const glyph = [
    '..#..#..#..',
    '.###.#.###.',
    '..#..#..#..',
    '.#########.',
    '....###....',
    '..#######..',
    '...#####...',
    '...##.##...',
    '..##...##..',
    '..#.....#..'
  ];
  // Gate plaques use crisp atlas pixels; the paper lantern carries the same motif in its local hierarchy.
  for (const z of [-0.01, -3.81, -7.61, -11.41])
    atlas.face([-0.4, 3.3, z + 0.34], [0.8, 0, 0], [0, 0.36, 0], 48, 22, (x, y) => {
      if (x === 0 || x === 47 || y === 0 || y === 21) return palette[8];
      return glyph[Math.floor((y - 1) / 2)]?.[Math.floor((x - 13) / 2)] === '#' ? palette[9] : palette[0];
    });
  const first = atlas.finish().vertices.length / 5;
  atlas.face([-0.22, 1.58, 0.49], [0.44, 0, 0], [0, 0.48, 0], 44, 48, (x, y) =>
    glyph[Math.floor(y / 4)]?.[Math.floor(x / 4)] === '#' ? palette[6] : null
  );
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 1.9, 0], dist: 10, yaw: 0, pitch: 0.13, focalLength: 38 };
  world.radius = 18;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const clocks = K.timeDomains.create(),
    stage = K.stage(world);
  if (sharedTime) stage.useTimeDomains(clocks);
  else stage.t0 = 0;
  rig.bind(stage);
  const settings = { shot: 'dolly', drift: true, composition: [0.5, 0.5], breathing: true };
  stage.add({
    update(dt, t) {
      graph.setLocal('lantern', {
        position: [Math.sin(t * 0.55) * 0.28, 1.9 + Math.sin(t * 0.9) * 0.1, 0],
        rotation: Q.fromAxisAngle([0, 0, 1], Math.sin(t * 0.7) * 0.035)
      });
    }
  });
  const lamp = { p: center.slice(), r: 4.8, s: 1.1, ramp: [6, 7, 8, 9, 10] };
  let lighting;
  K.sceneGraph.attach(world, graph, {
    geometry: [{ node: 'lantern', part: 'lantern' }],
    sprites: [{ node: 'sigil', first, count: 6 }],
    lights: [{ node: 'bulb', light: lamp, touch: () => lighting?.touch() }]
  });
  lighting = stage.add(K.light.system(stage, cap, [lamp]));
  const keys = (a, b) => [
      { time: 0, value: a, ease: 'in-out-sine' },
      { time: 8, value: b }
    ],
    definition = {
      targets: { subject: { node: 'target' } },
      shots: {
        dolly: {
          target: 'subject',
          pitch: 0.12,
          composition: [0.5, 0.5],
          motion: { type: 'dollyZoom', distance: keys(7, 16), frameHeight: 4.1 }
        },
        orbit: {
          target: 'subject',
          focalLength: 35,
          composition: [1 / 3, 0.48],
          motion: { type: 'orbit', yaw: keys(-0.55, 0.55), pitch: keys(0.14, 0.3), distance: 9.4 }
        },
        crane: {
          target: 'subject',
          focalLength: 32,
          composition: [0.5, 0.48],
          motion: { type: 'crane', eye: keys([4, 3, 9], [0.6, 8.6, 9]) }
        },
        breathe: {
          target: 'subject',
          yaw: 0.08,
          pitch: 0.13,
          dist: 8,
          focalLength: 42,
          composition: [0.5, 0.5],
          lensBreathing: { amount: 0.12, reference: 4, focus: keys(1.2, 8) }
        }
      }
    };
  const program = K.cameraRig.compile(definition);
  K.cameraRig.bind(world, program);
  const bound = world.cameraRig;
  let start = 0,
    scrub = null;
  const local = () => scrub ?? Math.min(8, Math.max(0, clocks.read('camera').sampleTime - start));
  const source = () =>
    bound.sample(local(), {
      shot: settings.shot,
      channels: {
        composition: settings.composition,
        ...(!settings.breathing && settings.shot === 'breathe' && { focusDistance: 4 })
      }
    });
  const control = K.cameraRig.control(source, { handoff: 0.7, damping: 13 });
  control.update(0, 0);
  return {
    world,
    program,
    definition,
    graph,
    clocks,
    stage,
    control,
    settings,
    get time() {
      return local();
    },
    get frame() {
      return control.read();
    },
    select(id) {
      settings.shot = id;
      settings.composition = id === 'orbit' ? [1 / 3, 0.48] : [0.5, 0.5];
      start = clocks.read('camera').sampleTime;
      scrub = null;
      control.release();
    },
    seek(t) {
      scrub = K.clamp(t, 0, 8);
      control.release({ duration: 0 });
    },
    replay() {
      start = clocks.read('camera').sampleTime;
      scrub = null;
      control.release();
    },
    update(dt) {
      clocks.pause('animation', !settings.drift);
      stage.update(dt, clocks.wall + dt);
      control.update(clocks.read('interface').dt, clocks.read('camera').sampleTime);
      return world;
    }
  };
}
if (typeof module !== 'undefined')
  module.exports = Object.assign(
    kit => ({
      id: 'cinematic-camera',
      name: 'Lantern passage',
      build: () => lanternPassage(kit, { sharedTime: false }).world
    }),
    { demo: lanternPassage }
  );
