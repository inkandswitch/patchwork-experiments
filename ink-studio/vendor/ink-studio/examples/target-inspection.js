/* Inspection remains an optional layer over an ordinary SDF/splat scene. */
function inspectionScene({ KIT: K, makeBuilder, makeSculpt }) {
  const palette = [
    0x07131d, 0x102635, 0x1e4051, 0x326277, 0x519399, 0x86d2c5, 0xd3f4d4, 0x352d36, 0x674348, 0xa16950, 0xe1a366,
    0xffdba0, 0xfff3d0
  ];
  const B = makeBuilder(19, palette),
    S = K.sculpt(makeSculpt(B));
  S.pixel = true;
  S.pixelSize(26);
  S.sun = K.V.norm([-0.7, 0.9, 0.6]);
  S.amb = 0.35;
  S.sky = 0.2;
  S.sunK = 0.85;
  S.aoK = 0.3;
  const dark = { r: [0, 1, 2] },
    stone = K.pixel.masonry({ r: [1, 2, 3, 4], joint: 1, stone: [9, 5], seed: 19 }),
    metal = { r: [7, 8, 9, 10] },
    light = { r: [9, 10, 11], em: true },
    cool = { r: [3, 4, 5, 6], em: true };
  S.box([0, -0.18, 0], [5.2, 0.25, 2.65], dark, { res: 0.16, rd: 0.12 });
  for (const x of [-3.4, 0, 3.4]) {
    S.box([x, 0.05, -0.5], [1.15, 0.12, 1.1], stone, { res: 0.09, rd: 0.06 });
    S.box([x, 0.3, -0.5], [0.8, 0.18, 0.76], metal, { res: 0.085, rd: 0.08 });
    for (const z of [-1.2, 0.2]) S.box([x, 0.54, z], [0.69, 0.035, 0.05], cool, { res: 0.05, rd: 0.01 });
  }
  for (const x of [-4.8, 4.8]) {
    S.box([x, 1.3, -1.9], [0.18, 1.4, 0.21], stone, { res: 0.08, rd: 0.04 });
    S.box([x, 2.68, -1.9], [0.4, 0.16, 0.4], metal, { res: 0.065, rd: 0.05 });
    S.ball([x, 2.9, -1.9], [0.16, 0.18, 0.16], light, { res: 0.045 });
  }
  for (const z of [-2.45, 2.45])
    for (let x = -4.5; x < 4.6; x += 0.36) {
      S.box([x, 0.02, z], [0.11, 0.08, 0.045], metal, { res: 0.06, rd: 0.01 });
    }
  S.tube(
    [
      [-4.8, 2.5, -1.9],
      [-2.4, 3.4, -2],
      [2.4, 3.4, -2],
      [4.8, 2.5, -1.9]
    ],
    0.07,
    0.07,
    metal,
    { res: 0.08 }
  );
  const groups = {};
  const old = S.emit;
  S.emit = (p, a, b) => {
    old?.(p, a, b);
    if (p.tag) {
      groups[p.tag] ??= [];
      for (let i = a; i < b; i++) groups[p.tag].push(i);
    }
  };
  for (let i = 0; i < 48; i++) {
    const a = (i * Math.PI) / 24;
    S.ball([Math.cos(a) * 1.02, 1.9 + Math.sin(a) * 1.02, -0.5], [0.07, 0.07, 0.09], i % 4 ? metal : cool, {
      res: 0.05
    });
  }
  S.ball([0, 1.9, -0.5], [0.48, 0.48, 0.48], { r: [2, 3, 4, 5] }, { tag: 'core', res: 0.045 });
  S.ball([0, 1.9, -0.075], [0.3, 0.3, 0.08], light, { tag: 'core', res: 0.035 });
  S.ball([0, 1.9, -0.005], [0.21, 0.21, 0.04], cool, { tag: 'core', res: 0.025 });
  S.ball([0, 1.9, 0.03], [0.105, 0.13, 0.025], dark, { tag: 'core', res: 0.02 });
  S.ball([-0.065, 1.98, 0.055], [0.035, 0.035, 0.01], { r: [11, 12], em: true }, { tag: 'core', res: 0.015 });
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    S.tube(
      [
        [Math.cos(a) * 0.65, 1.9 + Math.sin(a) * 0.65, -0.5],
        [Math.cos(a) * 0.9, 1.9 + Math.sin(a) * 0.9, -0.5]
      ],
      0.035,
      0.02,
      light,
      { res: 0.04 }
    );
  }
  for (const x of [-3.4, 3.4]) {
    S.box([x, 1.28, -0.5], [0.41, 0.62, 0.33], stone, { tag: x < 0 ? 'archive' : 'probe', res: 0.06, rd: 0.09 });
    for (let y = 0.85; y < 1.8; y += 0.19)
      S.box([x, y, -0.155], [0.33, 0.022, 0.02], x < 0 ? cool : light, {
        tag: x < 0 ? 'archive' : 'probe',
        res: 0.035
      });
    S.box([x, 2.03, -0.5], [0.3, 0.12, 0.28], metal, { tag: x < 0 ? 'archive' : 'probe', res: 0.05, rd: 0.04 });
  }
  S.bake();
  const world = B.finish(),
    rest = world.data.slice();
  world.cam = { target: [0, 1, -0.5], dist: 15, yaw: 0.18, pitch: 0.36 };
  world.radius = 8;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const glyphs = {
    日: ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
    光: ['..#..', '#.#.#', '.###.', '..#..', '.###.', '#.#.#', '#..##'],
    波: ['.#.##', '#..#.', '.#.##', '#..#.', '.#.##', '#.#..', '#..##']
  };
  const options = { enabled: true, magnify: true, hide: false, occlusion: true, focus: 'CORE' };
  let clock = 0;
  const targets = [
    {
      id: 'CORE',
      at: () => [0, 1.9 + Math.sin(clock * 0.8) * 0.12, -0.5],
      halfSize: [0.5, 0.5, 0.5],
      label: '01 / 光 / RELAY',
      detail: ({ time }) => 'PHASE ' + (Math.floor(time * 17) % 1000).toString().padStart(3, '0'),
      priority: 3,
      style: { color: '#89e2d4', scale: 1 },
      ripple: { chars: '0123479:+日光', period: 4.2, radius: 92, width: 17, speed: 62 },
      magnify: { rect: [0.74, 0.07, 0.22, 0.25], zoom: 2.6 },
      coverage: () => (options.hide ? 0 : 1)
    },
    {
      id: 'ARCHIVE',
      at: [-3.4, 1.4, -0.5],
      halfSize: [0.44, 0.72, 0.36],
      label: '02 / 日 / ARCHIVE',
      detail: 'MEMORY  /  064',
      magnify: { rect: [0.74, 0.07, 0.22, 0.25], zoom: 2.6 },
      style: { color: '#89e2d4' },
      ripple: { chars: '日0123:+', period: 5.1, radius: 72, speed: 45 }
    },
    {
      id: 'PROBE',
      at: () => [3.4, 1.4 + Math.sin(clock) * 0.17, -0.5],
      halfSize: [0.45, 0.75, 0.36],
      label: '03 / 波 / PROBE',
      detail: 'UPLINK  /  ACTIVE',
      magnify: { rect: [0.74, 0.07, 0.22, 0.25], zoom: 2.6 },
      style: { color: '#ffd19a' },
      ripple: { chars: '波012347:+', period: 4.7, radius: 83, speed: 53 }
    }
  ];
  const definition = { targets, glyphs, maxTargets: 6 };
  const noLens = { ...definition, targets: targets.map(t => ({ ...t, magnify: false })) };
  const xray = { ...definition, targets: targets.map(t => ({ ...t, occlusion: 'none' })) };
  const xrayNoLens = { ...noLens, targets: noLens.targets.map(t => ({ ...t, occlusion: 'none' })) };
  return {
    world,
    options,
    setTime(t) {
      clock = t;
      for (const [name, ids] of Object.entries(groups))
        for (const id of ids) {
          const q = id * 16;
          world.data[q + 1] =
            rest[q + 1] + (name === 'core' ? Math.sin(t * 0.8) * 0.12 : name === 'probe' ? Math.sin(t) * 0.17 : 0);
        }
    },
    definition() {
      return !options.enabled
        ? false
        : options.occlusion
          ? options.magnify
            ? definition
            : noLens
          : options.magnify
            ? xray
            : xrayNoLens;
    }
  };
}
if (typeof module !== 'undefined') module.exports = inspectionScene;
