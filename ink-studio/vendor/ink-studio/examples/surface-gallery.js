/* The gallery uses ordinary sculpt materials. Run this file through the CLI for
   the still life, or use the gallery script to orbit each individual preset. */
const palettes = {
  slate: [0x192331, 0x2c3b50, 0x486178, 0x6c8499, 0xabc3d0, 0xe2f1f1],
  stone: [0x241f28, 0x3e3540, 0x5f5359, 0x837274, 0xae9891, 0xddc9b0],
  brass: [0x291b29, 0x523123, 0x8c512e, 0xc17b39, 0xe9b85b, 0xffe8a3],
  rose: [0x301d34, 0x502341, 0x793454, 0xae546e, 0xdc8194, 0xffc4bc, 0xffebdc],
  leaf: [0x112a2b, 0x1e4639, 0x346243, 0x578250, 0x82aa67, 0xb8d68d, 0xe9ffcc],
  water: [0x112a3e, 0x1c425c, 0x2b687e, 0x478f9f, 0x72b9c0, 0xa8dcea, 0xe1f6fa],
  snow: [0x456276, 0x6c8fa5, 0x94b3ce, 0xbcd4e8, 0xddeaf5, 0xf5fbff],
  iris: [0x252247, 0x3d3a74, 0x594f9b, 0x8b65a9, 0xbf8abc, 0xe8b9d7, 0xffedf5],
  cobalt: [0x152749, 0x234884, 0x3f66ba, 0x5d86e3, 0x83b4f6, 0xc2e8ff]
};
const palette = [0x121820],
  ramps = {};
for (const [name, colors] of Object.entries(palettes)) {
  ramps[name] = colors.map(c => palette.push(c) - 1);
}

const groups = [
  {
    name: 'Grain & fibre',
    id: 'grain-and-fibre',
    swatches: [
      ['brushed-steel', 'slate', 'orb'],
      ['brushed-brass', 'brass', 'orb'],
      ['machined-knob', 'slate', 'disc'],
      ['cross-brushed-metal', 'slate', 'panel'],
      ['scratched-metal', 'slate', 'panel'],
      ['carbon-fibre', 'slate', 'panel'],
      ['satin', 'rose', 'fold'],
      ['woven-ribbon', 'brass', 'fold'],
      ['corduroy', 'rose', 'fold'],
      ['hair', 'brass', 'strand'],
      ['combed-fur', 'brass', 'fur'],
      ['figured-wood', 'brass', 'wood']
    ]
  },
  {
    name: 'Grazing reflections',
    id: 'grazing-reflections',
    swatches: [
      ['puddle', 'water', 'water'],
      ['wet-cobblestone', 'slate', 'cobbles'],
      ['waxy-leaf', 'leaf', 'leaf'],
      ['glazed-pottery', 'rose', 'pot'],
      ['lacquered-wood', 'brass', 'wood'],
      ['clear-ice', 'water', 'gem'],
      ['glass-bottle', 'water', 'bottle'],
      ['velvet', 'rose', 'fold'],
      ['dust', 'stone', 'panel'],
      ['gold-leaf', 'brass', 'panel']
    ]
  },
  {
    name: 'Angle-dependent colour',
    id: 'angle-dependent-colour',
    swatches: [
      ['soap-bubble', 'iris', 'bubble'],
      ['oil-slick', 'iris', 'water'],
      ['beetle-shell', 'leaf', 'shell'],
      ['peacock-feather', 'water', 'feather'],
      ['butterfly-wing', 'cobalt', 'wing'],
      ['mother-of-pearl', 'iris', 'shell'],
      ['pearlescent-paint', 'iris', 'orb'],
      ['shot-silk', 'iris', 'fold'],
      ['holographic-foil', 'slate', 'disc']
    ]
  },
  {
    name: 'Surface-pinned glints',
    id: 'surface-pinned-glints',
    swatches: [
      ['snow', 'snow', 'snowbank'],
      ['mica-granite', 'stone', 'gem'],
      ['frost-crystals', 'water', 'gem'],
      ['metallic-paint', 'rose', 'orb'],
      ['sequins', 'iris', 'fold'],
      ['dewy-grass', 'leaf', 'grass'],
      ['rippling-water', 'water', 'water'],
      ['fish-scales', 'water', 'shell'],
      ['cut-gem', 'water', 'gem']
    ]
  }
];

const nameOf = id =>
  id
    .split('-')
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ');
const options = { res: 0.055, rd: 0.11 };
const CAM = { target: [0, 0.12, 0], dist: 5.7, pitch: 0.26, yaw: -0.24, sway: 0 };
const SUN = [-0.48, 0.68, 0.55];
const stone = { r: ramps.stone.slice(0, 5) };
const ground = { r: ramps.slate.slice(0, 4) };
const points = (n, fn) => Array.from({ length: n }, (_, i) => fn((i / Math.max(1, n - 1)) * Math.PI * 2, i));
const floor = (S, y = -0.76) => S.box([0, y - 0.12, 0], [5, 0.12, 4.8], ground, { res: 0.15 });

function gem(S, material, center = [0, 0, 0], size = 1) {
  const ring = fn => Array.from({ length: 8 }, (_, i) => fn((Math.PI * i) / 4, i));
  const planes = [
    { n: [0, 1, 0], d: 0.59 * size },
    { n: [0, -1, 0], d: 0.74 * size },
    ...ring((a, i) => ({ n: [Math.sin(a), 0.46, Math.cos(a)], d: (i % 2 ? 0.83 : 0.87) * size })),
    ...ring((a, i) => ({ n: [Math.sin(a + 0.36), -0.75, Math.cos(a + 0.36)], d: (i % 2 ? 0.7 : 0.74) * size }))
  ];
  S.poly(center, planes, material, { res: 0.07 });
}

function cobbles(S, material, at = [0, -0.65, 0]) {
  for (let z = -1; z <= 1; z++)
    for (let x = -1; x <= 1; x++) {
      const p = [at[0] + x * 0.64 + (z % 2) * 0.16, at[1] + Math.sin(x * 2.3 + z) * 0.04, at[2] + z * 0.49];
      S.ball(p, [0.305, 0.115 + 0.02 * Math.cos(x - z), 0.225], material, { res: 0.056 });
    }
}

function bottle(S, material, at = [0, -0.68, 0], scale = 1) {
  S.lathe(at, 1.96 * scale, t => scale * (t < 0.57 ? 0.51 : t < 0.75 ? 0.51 - (t - 0.57) * 1.88 : 0.17), material, {
    res: 0.049
  });
  S.lathe(
    [at[0], at[1] + 1.94 * scale, at[2]],
    0.18 * scale,
    [0.15 * scale, 0.14 * scale],
    { r: ramps.brass },
    { res: 0.06 }
  );
}

function pot(S, mat, at = [0, -0.73, 0], scale = 1) {
  S.lathe(at, 1.52 * scale, t => scale * (0.42 + 0.28 * Math.sin(t * Math.PI) + 0.04 * t), mat, { res: 0.053 });
  S.lathe([at[0], at[1] + 1.5 * scale, at[2]], 0.08 * scale, 0.48 * scale, mat, { res: 0.048 });
}

function fabric(S, material) {
  for (const c of [-0.42, 0.34]) {
    const pts = points(17, (a, i) => [c + 0.18 * Math.sin(a), -0.63 + i * 0.104, 0.22 + 0.26 * Math.cos(a)]);
    S.tube(pts, t => 0.35 - t * 0.05, 0, material, { res: 0.058 });
  }
}

function addSwatch(S, material, shape) {
  switch (shape) {
    case 'orb':
      S.ball([0, 0.17, 0], 0.9, material, options);
      break;
    case 'panel':
      S.ball([0, 0.18, 0], [1.0, 0.87, 0.41], material, options);
      break;
    case 'disc':
      S.ball([0, 0.17, 0], [0.93, 0.94, 0.24], material, options);
      S.ball([0, 0.17, 0.25], [0.23, 0.23, 0.11], material, options);
      break;
    case 'fold':
      fabric(S, material);
      break;
    case 'strand':
      for (let k = 0; k < 8; k++) {
        const pts = points(16, (a, i) => [
          0.16 * (k - 3.5) + 0.23 * Math.sin(a + k * 0.28),
          -0.66 + i * 0.12,
          Math.cos(a + k * 0.18) * 0.23
        ]);
        S.tube(pts, t => 0.14 - t * 0.05, 0, material, { res: 0.066 });
      }
      break;
    case 'fur':
      S.ball(
        [0, 0.1, 0],
        [0.86, 0.76, 0.62],
        { ...material, fur: { len: 0.15, comb: [0.21, 1, 0.1], n: 1, w: 0.019, still: true } },
        { res: 0.083 }
      );
      break;
    case 'wood':
      S.ball(
        [0, 0.1, 0],
        [0.94, 0.81, 0.52],
        { ...material, mod: (x, y) => 0.13 * Math.sin(24 * x + 1.2 * Math.sin(7 * y)) },
        options
      );
      break;
    case 'water':
      S.ball([0, -0.61, 0], [1.24, 0.14, 1.01], stone, { res: 0.067 });
      S.ball([0, -0.47, 0], [1.14, 0.061, 0.89], material, { res: 0.045 });
      for (const [x, z, r] of [
        [-0.98, 0.45, 0.21],
        [1.05, -0.31, 0.31],
        [-0.42, -0.89, 0.24],
        [0.55, 0.65, 0.17]
      ]) {
        S.ball([x, -0.64, z], [r, r * 0.66, r], stone, options);
      }
      break;
    case 'cobbles':
      cobbles(S, material);
      break;
    case 'leaf':
    case 'feather':
      S.ball([0, 0.01, 0], [0.53, 0.99, 0.18], material, options);
      S.tube(
        [
          [0, -0.78, 0.02],
          [0.03, 0, 0.17],
          [0, 0.91, 0.05]
        ],
        0.035,
        0.012,
        { r: material.r.slice(1) },
        { res: 0.053 }
      );
      break;
    case 'wing':
      for (const k of [-1, 1]) {
        S.ball([k * 0.54, 0.41, -k * 0.14], [0.52, 0.67, 0.21], material, options);
        S.ball([k * 0.38, -0.26, -k * 0.1], [0.4, 0.49, 0.19], material, options);
      }
      S.tube(
        [
          [0, -0.4, 0.19],
          [0, 0.58, 0.19]
        ],
        0.105,
        0.048,
        { r: ramps.slate.slice(0, 3) },
        { res: 0.056 }
      );
      break;
    case 'shell':
      S.ball([0, 0.05, 0], [0.78, 0.91, 0.56], material, options);
      S.tube(
        [
          [0, -0.68, 0.36],
          [0, 0.12, 0.57],
          [0, 0.88, 0.23]
        ],
        0.032,
        0.017,
        { r: material.r.slice(0, 3) },
        { res: 0.055 }
      );
      break;
    case 'pot':
      pot(S, material);
      break;
    case 'bottle':
      bottle(S, material);
      break;
    case 'bubble':
      S.ball([0, 0.22, 0], 0.89, material, { res: 0.069 });
      S.ball([0.82, -0.48, 0.06], 0.26, material, { res: 0.068 });
      break;
    case 'grass':
      S.ball([0, -0.54, 0], [0.99, 0.08, 0.75], stone, options);
      for (const [x, z, h] of [
        [-0.62, 0.19, 0.58],
        [-0.47, -0.36, 0.82],
        [-0.15, 0.12, 1.08],
        [0.16, -0.24, 1.29],
        [0.42, 0.32, 0.89],
        [0.67, -0.07, 0.69]
      ]) {
        S.tube(
          [
            [x, -0.53, z],
            [x * 1.13, -0.1, z],
            [x * 1.34, -0.53 + h, z + 0.13]
          ],
          0.1,
          0.018,
          material,
          options
        );
      }
      break;
    case 'snowbank':
      S.ball([0, -0.62, 0], [1.08, 0.38, 0.86], material, options);
      S.ball([0.48, -0.68, 0.16], [0.73, 0.29, 0.61], material, options);
      break;
    case 'gem':
      gem(S, material);
      break;
  }
}

function makeSculpture(kit, seed) {
  const B = kit.makeBuilder(seed, palette);
  const S = kit.KIT.sculpt(kit.makeSculpt(B));
  S.pixel = true;
  S.sun = kit.KIT.V.norm(SUN);
  S.amb = 0.23;
  S.sky = 0.22;
  S.sunK = 0.49;
  S.wob = 0;
  return { S, B };
}

function swatch(kit, name, ramp, shape, overrides) {
  const lowView = shape === 'water' || shape === 'cobbles';
  const cam = { ...CAM, pitch: lowView ? 0.58 : CAM.pitch, target: [0, lowView ? -0.48 : 0.12, 0] };
  const { S, B } = makeSculpture(kit, 11);
  const material = kit.KIT.surface.preset(name, { r: ramps[ramp].slice(0, -1) }, { seed: 17, ...overrides });
  floor(S);
  addSwatch(S, material, shape);
  S.bake();
  return B.finish({ cam, radius: 6, detail: 24, dither: 0, look: { pixel: true, outline: true, clean: true } });
}

function stillLife(kit) {
  return {
    id: 'surface-gallery',
    name: 'After the rain',
    seed: 19,
    build(seed) {
      const { S, B } = makeSculpture(kit, seed);
      const finish = (name, ramp, options) => kit.KIT.surface.preset(name, { r: ramps[ramp] }, options);
      // Keep the seams, recessed water and separate dielectric and metallic surfaces.
      floor(S, -0.78);
      S.box([0, -0.58, -0.56], [2.5, 0.2, 1.65], stone, { res: 0.1, rd: 0.09 });
      S.box([0, -0.4, -0.55], [0.04, 0.05, 1.62], { r: ramps.brass }, { res: 0.075 });
      const ceramic = finish('glazed-pottery', 'rose');
      pot(S, ceramic, [-0.77, -0.36, -0.61], 1.01);
      const brass = finish('brushed-brass', 'brass');
      S.lathe([-0.77, 1.17, -0.61], 0.1, [0.48, 0.3], brass, { res: 0.054 });
      const glass = finish('glass-bottle', 'water');
      bottle(S, glass, [0.61, -0.36, -0.8], 0.93);
      const wood = finish('lacquered-wood', 'brass');
      S.box([1.47, -0.25, -0.98], [0.57, 0.12, 0.51], wood, { res: 0.068, rd: 0.08 });
      gem(S, finish('cut-gem', 'water'), [1.46, 0.16, -0.94], 0.56);
      const leaves = finish('waxy-leaf', 'leaf');
      S.tube(
        [
          [-1.67, -0.33, -0.99],
          [-1.78, 0.21, -1.07],
          [-1.57, 0.87, -1.25]
        ],
        0.061,
        0.026,
        wood,
        { res: 0.07 }
      );
      for (const [x, y, z, sx] of [
        [-1.56, 0.92, -1.27, 0.24],
        [-1.94, 0.6, -1.21, 0.3],
        [-1.64, 0.48, -0.99, 0.23]
      ]) {
        S.ball([x, y, z], [sx, 0.38, 0.13], leaves, { res: 0.05 });
      }
      cobbles(S, finish('wet-cobblestone', 'slate'), [-1.23, -0.67, 1.68]);
      S.ball([0.63, -0.705, 1.66], [1.08, 0.07, 0.64], finish('rippling-water', 'water'), { res: 0.048 });
      S.ball([1.65, -0.63, 1.53], [0.36, 0.16, 0.27], finish('mica-granite', 'stone'), options);
      S.bake();
      return B.finish({
        cam: { target: [0, 0.12, -0.2], dist: 9.4, pitch: 0.4, yaw: -0.4, sway: 0 },
        radius: 8,
        detail: 35,
        dither: 0,
        refract: 2,
        look: { pixel: true, outline: true, clean: true }
      });
    }
  };
}

module.exports = stillLife;
module.exports.groups = groups;
module.exports.swatch = swatch;
module.exports.nameOf = nameOf;
