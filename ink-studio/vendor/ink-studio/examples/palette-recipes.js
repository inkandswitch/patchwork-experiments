/* The same SDF garden, recolored through stable palette slots. No runtime dependencies. */
function paletteGarden({ KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface }) {
  const themes = [
    { name: 'Tide & brass', primary: '#58aeb7', accent: '#efad72' },
    { name: 'Orchid & citron', primary: '#ab82d7', accent: '#c7d67a' },
    { name: 'Ember & indigo', primary: '#d97e83', accent: '#899ce4' }
  ];
  const reference = ['#10202b', '#284653', '#42717c', '#86a9a6', '#d9d9b9'];
  const controls = { theme: 0, hue: 0, chroma: 1, contrast: 1, reference: false };
  function definition(theme) {
    const gamma = controls.contrast,
      L = (lo, hi) => ({
        stops: [
          [0, lo],
          [0.5, lo + (hi - lo) * Math.pow(0.5, gamma)],
          [1, hi]
        ],
        interpolation: 'smooth'
      });
    const role = (anchor, steps, lo, hi, shift = [-16, 10], scale = [0.3, 1, 0.12]) => ({
      anchor,
      steps,
      hueShift: shift.map(v => v + controls.hue),
      chromaScale: scale.map(v => v * controls.chroma),
      curves: { lightness: L(lo, hi) }
    });
    return {
      anchors: { primary: theme.primary, accent: theme.accent },
      roles: {
        stone: controls.reference
          ? { anchor: 'primary', steps: 7, reference, pivot: 0.5 }
          : role('primary', 7, 0.14, 0.94),
        foliage: role('primary', 7, 0.16, 0.87, [-29, 13], [0.3, 1.2, 0.2]),
        bark: role('accent', 5, 0.13, 0.65, [-10, 15], [0.15, 0.55, 0.16]),
        metal: role('accent', 5, 0.19, 0.87, [-13, 12], [0.3, 0.85, 0.15]),
        glow: role('accent', 4, 0.62, 0.98, [-8, 6], [1, 0.8, 0.08]),
        water: role('primary', 4, 0.2, 0.72, [-8, 8], [0.3, 0.8, 0.15])
      }
    };
  }
  const original = K.palette.recipe(definition(themes[0])),
    B = makeBuilder(37, original.palette),
    S = K.sculpt(makeSculpt(B)),
    r = original.roles;
  S.pixel = true;
  S.pixelSize(28);
  S.sun = K.V.norm([-0.65, 0.9, 0.35]);
  S.amb = 0.25;
  S.sky = 0.23;
  S.sunK = 0.8;
  S.aoK = 0.3;
  const stone = K.pixel.masonry({ r: r.stone, joint: 1, stone: [7, 5], seed: 37 }),
    dark = { r: r.stone.slice(0, 3) },
    bark = { r: r.bark },
    leaves = { r: r.foliage },
    metal = { r: r.metal },
    glow = { r: r.glow, em: true };
  S.box([0, -0.3, 0], [3.9, 0.4, 2.6], dark, { res: 0.14, rd: 0.2 });
  for (const x of [-2.5, 0, 2.5]) S.box([x, 0.09, -0.15], [1.12, 0.12, 1.77], stone, { res: 0.1, rd: 0.08 });
  for (const z of [-2.4, 2.4])
    for (let x = -3.5; x < 3.6; x += 0.38) S.box([x, 0.13, z], [0.14, 0.07, 0.065], metal, { res: 0.065, rd: 0.02 });
  for (let i = 0; i < 4; i++)
    S.box([0, 0.03 + i * 0.1, 2.4 - i * 0.24], [0.73, 0.09, 0.2], stone, { res: 0.085, rd: 0.035 });
  // A broken ceremonial arch, shaped and shaded in the native SDF path.
  for (let i = 0; i < 17; i++) {
    const a = Math.PI * 0.07 + (i / 16) * Math.PI * 0.87,
      x = Math.cos(a) * 1.48,
      y = 0.9 + Math.sin(a) * 2.1;
    S.box([x, y, -1.35], [0.17, 0.21, 0.21], stone, { res: 0.065, rd: 0.04, ax: B.frame(0, 0, a - Math.PI / 2) });
  }
  for (const x of [-1.52, 1.52]) S.box([x, 0.56, -1.35], [0.23, 0.48, 0.25], stone, { res: 0.075, rd: 0.04 });
  const trunk = [
    [0, 0.27, -0.3],
    [-0.16, 0.9, -0.35],
    [0.05, 1.56, -0.5],
    [0.27, 2.2, -0.59],
    [0.09, 2.7, -0.63]
  ];
  S.tube(trunk, 0.17, 0.035, bark, { res: 0.055 });
  const branches = [
    [
      [0, 1.25, -0.45],
      [-0.75, 1.7, -0.6],
      [-1.05, 2.22, -0.55]
    ],
    [
      [0.16, 1.8, -0.55],
      [0.88, 2.1, -0.5],
      [1.12, 2.64, -0.65]
    ],
    [
      [0.2, 2.15, -0.6],
      [-0.4, 2.65, -0.76],
      [-0.58, 2.95, -0.8]
    ]
  ];
  for (const branch of branches) S.tube(branch, 0.09, 0.018, bark, { res: 0.05 });
  for (const [cx, cy, cz] of [
    [-1.02, 2.27, -0.58],
    [1.1, 2.65, -0.6],
    [-0.53, 2.98, -0.8],
    [0.12, 2.74, -0.63]
  ]) {
    for (let i = 0; i < 7; i++) {
      const a = (i * Math.PI * 2) / 7;
      S.ball(
        [cx + Math.cos(a) * 0.3, cy + Math.sin(a) * 0.18, cz + Math.sin(a * 2) * 0.15],
        [0.28, 0.16, 0.22],
        leaves,
        { res: 0.055 }
      );
    }
    S.ball([cx, cy - 0.02, cz + 0.17], [0.065, 0.08, 0.055], glow, { res: 0.035 });
  }
  for (const side of [-1, 1]) {
    const x = side * 2.65;
    S.box([x, 0.4, 0.65], [0.36, 0.2, 0.36], stone, { res: 0.075, rd: 0.05 });
    S.tube(
      [
        [x, 0.6, 0.65],
        [x, 1.18, 0.65]
      ],
      0.045,
      0.045,
      metal,
      { res: 0.045 }
    );
    S.box([x, 1.43, 0.65], [0.22, 0.28, 0.2], metal, { res: 0.055, rd: 0.04 });
    S.box([x, 1.43, 0.86], [0.15, 0.19, 0.015], glow, { res: 0.035 });
    S.box([x, 1.75, 0.65], [0.28, 0.06, 0.25], dark, { res: 0.05, rd: 0.02 });
    for (let i = 0; i < 3; i++) {
      const a = side * (0.55 + i * 0.2);
      S.ball([a, 0.28, 1.15 - i * 0.18], [0.12, 0.13, 0.12], stone, { res: 0.055 });
    }
  }
  const random = (() => {
    let state = 37;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();
  for (let i = 0; i < 105; i++) {
    const x = (random() - 0.5) * 7,
      z = (random() - 0.5) * 4.2;
    if (Math.abs(x) < 0.9 || (Math.abs(z + 1.35) < 0.35 && Math.abs(x) < 1.8)) continue;
    const h = 0.14 + random() * 0.26;
    S.tube(
      [
        [x, 0.2, z],
        [x + 0.03, h + 0.2, z - 0.01]
      ],
      0.018,
      0.004,
      leaves,
      { res: 0.04 }
    );
    if (i % 5 === 0) {
      S.tube(
        [
          [x, 0.2, z],
          [x - 0.08, h * 0.7 + 0.2, z + 0.05]
        ],
        0.018,
        0.003,
        leaves,
        { res: 0.04 }
      );
    }
  }
  for (const [x, z] of [
    [-1.7, 0.8],
    [1.7, 1.25],
    [-2.8, -1.2],
    [2.9, -1.1]
  ]) {
    S.ball([x, 0.29, z], [0.33, 0.22, 0.23], stone, { res: 0.06 });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.3;
      S.tube(
        [
          [x + Math.cos(a) * 0.2, 0.22, z + Math.sin(a) * 0.2],
          [x + Math.cos(a) * 0.2, 0.49 + i * 0.06, z + Math.sin(a) * 0.2]
        ],
        0.035,
        0.025,
        bark,
        { res: 0.035 }
      );
      S.ball([x + Math.cos(a) * 0.2, 0.5 + i * 0.06, z + Math.sin(a) * 0.2], [0.13, 0.055, 0.12], metal, { res: 0.04 });
    }
  }
  S.bake();
  const atlas = SpriteSurface.make(256);
  atlas.mesh(
    TexturedSurface.heightfield({ bounds: [-3.7, 3.7, -2.2, 2.2], segments: [1, 1], height: () => 0.217 }),
    240,
    144,
    (i, j) => {
      if (i > 94 && i < 145 && j > 99) return null;
      const seam = i % 20 === 0 || j % 16 === 0,
        mark = (i * 17 + j * 31) % 97 === 0;
      return original.palette[r.stone[seam ? 1 : mark ? 3 : 2]];
    }
  );
  const world = B.finish({ spriteSurfaces: atlas.finish(), paletteRoles: original.roles });
  world.cam = { target: [0, 1.1, -0.25], dist: 14.2, yaw: 0.36, pitch: 0.53 };
  world.radius = 6;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  let binding, program;
  const rebuild = () => {
    const defs = themes.map(definition),
      ordered = [
        defs[controls.theme],
        defs[(controls.theme + 1) % 3],
        defs[(controls.theme + 2) % 3],
        defs[controls.theme]
      ];
    program = K.palette.animate({ keys: ordered.map((recipe, i) => ({ time: i * 5, recipe })), playback: 'loop' });
    binding = K.palette.bind(world, program, {
      roles: Object.fromEntries(Object.keys(original.roles).map(n => [n, n]))
    });
  };
  rebuild();
  return {
    world,
    themes,
    controls,
    reference,
    get binding() {
      return binding;
    },
    get program() {
      return program;
    },
    rebuild,
    update: t => binding.update(t),
    sample: t => program.sample(t),
    definition
  };
}
if (typeof module !== 'undefined') module.exports = paletteGarden;
