/* The prism court: original SDF architecture with live panels, discs, tubes and colored gobos. */
function prismCourt(kit) {
  const { KIT: K, makeBuilder, makeSculpt, SpriteSurface, TexturedSurface } = kit,
    E = K.lightEmitters;
  const palette = [
    0x070c1a, 0x171a32, 0x2d304b, 0x535568, 0x92949b, 0xc5c8bc, 0x342640, 0x634b7d, 0xa48bc6, 0xe6caff, 0x493027,
    0x8b5939, 0xd89650, 0xffce81, 0xffedd1
  ];
  const B = makeBuilder(61, palette),
    S = K.sculpt(makeSculpt(B));
  S.keepRenderSdf = true;
  S.pixel = true;
  S.pixelSize(52);
  S.amb = 0.25;
  S.sky = 0.18;
  S.sunK = 0.28;
  S.wob = 0.012;
  const stone = { r: [1, 2, 3, 4] },
    dark = { r: [0, 1, 2] },
    bronze = { r: [10, 11, 12] },
    ivory = { r: [3, 4, 5] },
    violet = { r: [6, 7, 8] };
  S.box([0, -0.25, 0], [5.6, 0.25, 3.55], dark, { res: 0.2, rd: 0.11 });
  S.box([0, 0.02, 0], [5.25, 0.04, 3.2], stone, { res: 0.2, rd: 0.04 });
  S.box([0, 1.8, -2.7], [5.35, 1.8, 0.18], stone, { res: 0.15, rd: 0.07 });
  S.box([0, 3.65, -2.65], [5.5, 0.13, 0.35], dark, { res: 0.14, rd: 0.06 });
  for (const x of [-5.05, 5.05]) {
    S.box([x, 1.77, -0.8], [0.19, 1.77, 1.9], dark, { res: 0.16, rd: 0.06 });
    for (const z of [-2.35, 0.95]) {
      S.box([x, 1.7, z], [0.29, 1.7, 0.28], stone, { res: 0.12, rd: 0.07 });
      S.box([x, 3.43, z], [0.4, 0.12, 0.4], bronze, { res: 0.09, rd: 0.03 });
    }
  }
  // Recessed bays and individually jointed voussoirs frame the luminous apertures.
  for (const x of [-3.5, 3.5]) {
    S.box([x, 1.9, -2.45], [1.1, 1.45, 0.08], dark, { res: 0.12, rd: 0.06 });
    for (const side of [-1, 1])
      for (let y = 0; y < 6; y++)
        S.box([x + side * 1.05, 0.35 + y * 0.49, -2.3], [0.13, 0.23, 0.17], stone, { res: 0.08, rd: 0.035 });
    for (let i = 0; i < 17; i++) {
      const a = ((i + 0.5) * Math.PI) / 17,
        c = Math.cos(a),
        s = Math.sin(a);
      S.box([x + 1.04 * c, 2.59 + 0.72 * s, -2.3], [0.13, 0.16, 0.17], stone, {
        res: 0.08,
        rd: 0.03,
        ax: [
          [c, s, 0],
          [-s, c, 0],
          [0, 0, 1]
        ]
      });
    }
  }
  // The previous typography primitive becomes a solid, shadow-casting light specimen.
  S.box([0, 0.25, -0.5], [1.8, 0.2, 0.95], dark, { res: 0.13, rd: 0.08 });
  S.box([0, 0.51, -0.5], [1.64, 0.07, 0.77], bronze, { res: 0.1, rd: 0.035 });
  const letters = K.typography.layout('LUX', { size: 1.65, align: 'center', tracking: 0.08 });
  for (const glyph of letters.glyphs) {
    const loops = K.typography.outline(letters.font, glyph.char).map(l => l.map(p => p.map(n => n * glyph.scale)));
    S.extrude(loops, [glyph.x, 1.12, -0.2], 0.35, ivory, { res: 0.04 });
  }
  for (const x of [-2.35, 2.35]) {
    S.box([x, 0.35, 0.6], [0.34, 0.3, 0.34], stone, { res: 0.09, rd: 0.04 });
    S.lathe([x, 0.65, 0.6], 1.3, [0.2, 0.12], ivory, { res: 0.065 });
    S.ball([x, 2.1, 0.6], [0.36, 0.36, 0.36], ivory, { res: 0.055 });
  }
  // The dark housings remain geometry; their luminous faces come from the emitter definitions.
  S.box([-3.5, 1.8, -2.1], [0.89, 1.23, 0.09], bronze, { res: 0.1, rd: 0.05 });
  S.box([-3.5, 1.8, -1.98], [0.81, 1.13, 0.04], dark, { res: 0.09 });
  S.torus([3.5, 2.35, -2.05], 0.62, 0.065, bronze, {
    res: 0.07,
    ax: [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0]
    ]
  });
  for (const x of [-3.75, 3.75])
    S.tube(
      [
        [x, 3.5, -0.05],
        [x, 3.95, -0.05]
      ],
      0.028,
      0.028,
      bronze,
      { res: 0.06 }
    );
  S.tube(
    [
      [-3.8, 3.5, -0.05],
      [3.8, 3.5, -0.05]
    ],
    0.065,
    0.065,
    dark,
    { res: 0.09 }
  );
  S.box([0, 0.35, 2.95], [4.65, 0.15, 0.18], dark, { res: 0.13, rd: 0.04 });
  S.bake();
  const atlas = SpriteSurface.make(1024),
    floor = TexturedSurface.heightfield({ bounds: [-5.2, 5.2, -3.15, 3.15], segments: [12, 10], height: () => 0.13 });
  atlas.mesh(floor, 256, 160, (x, y) => {
    const u = x % 32,
      v = y % 20,
      tile = (((x / 32) | 0) * 7 + ((y / 20) | 0) * 3) % 9;
    if (u < 2 || v < 2) return palette[1];
    if (u === 2 || v === 2) return palette[3];
    if (tile === 2 && Math.abs(u - 9 - v * 0.4) < 0.6) return palette[1];
    return palette[tile < 4 ? 3 : 2];
  });
  const label = (s, p, size = 0.2, color = palette[13]) =>
    K.typography.sprites(atlas, K.typography.layout(s, { font: K.typography.fonts.bitmap(), size, align: 'center' }), {
      position: p,
      pixelsPerEm: 8,
      color
    });
  label('01 / PANEL', [-3, 0.28, 3.15], 0.16);
  label('02 / DISC', [3, 0.28, 3.15], 0.16);
  label('THE PRISM COURT', [0, -0.27, 3.58], 0.22, palette[8]);
  label('LINE / 7.5m', [0, 3.7, -0.04], 0.16, palette[8]);
  const corner = atlas.reserve(32, 32, (x, y) =>
    x === 0 || y === 0 || x === 31 || y === 31 ? palette[11] : (x + y) % 11 === 0 ? palette[2] : palette[1]
  );
  atlas.faceRegion([-0.82, 0.59, 0.3], [1.64, 0, 0], [0, 0, -1.64], corner);
  const world = B.finish({ spriteSurfaces: atlas.finish() });
  world.cam = { target: [0, 1.65, 0], dist: 15.1, yaw: 0.23, pitch: 0.23, focalLength: 34 };
  world.radius = 20;
  world.look = { pixelSize: 2, clean: 1 };
  world.fog = { c: 0, start: 1, max: 0 };
  const settings = {
      panel: true,
      disc: true,
      lines: true,
      projector: true,
      shadows: true,
      fog: true,
      animate: true,
      held: false,
      power: 1,
      roll: 0,
      pattern: 'rosette'
    },
    state = { time: 0 };
  const patterns = {
    glass: E.cookie({
      pattern: 'stainedGlass',
      width: 64,
      height: 64,
      frequency: 4,
      thickness: 0.8,
      colors: ['#f5b56f', '#a486e5', '#ffe3ac', '#8462c4'],
      angle: 31
    }),
    rosette: E.cookie({ pattern: 'rosette', frequency: 10, thickness: 0.53, color: '#ffdb9d', angle: 31 }),
    stripes: E.cookie({ pattern: 'stripes', frequency: 9, thickness: 0.42, color: '#c1a1f0', angle: 31 })
  };
  const pane = E.cookie({
    pattern: 'stainedGlass',
    width: 32,
    height: 48,
    frequency: 3,
    colors: ['#f5b56f', '#ad89e5', '#ffe3ac'],
    angle: 45,
    filter: 'nearest'
  });
  const panel = E.rectangle({
    id: 'panel',
    at: [-3.5, 1.8, -1.55],
    normal: [0.32, -0.15, 1],
    size: [1.5, 2.05],
    color: '#ffe7bd',
    intensity: 14,
    radius: 8,
    sampleGrid: 2,
    volumeIntensity: 0,
    cookie: pane
  });
  const disc = E.disc({
    id: 'disc',
    at: [3.5, 2.35, -1.5],
    normal: [-0.28, -0.25, 1],
    size: [1.1, 1.1],
    color: '#ffe0a0',
    intensity: 18,
    radius: 7,
    sampleGrid: 3,
    volumeIntensity: 0
  });
  const tube = E.line({
    id: 'tube',
    from: [-3.75, 3.5, 0.14],
    to: [3.75, 3.5, 0.14],
    width: 0.055,
    normal: [0, 0, 1],
    color: '#ae8ae7',
    intensity: 8,
    radius: 6,
    sampleGrid: 6,
    volumeIntensity: 0,
    shadows: false
  });
  const rail = E.line({
    id: 'footlight',
    from: [-4.35, 0.5, 3.16],
    to: [4.35, 0.5, 3.16],
    width: 0.04,
    normal: [0, 0, 1],
    color: '#ffca7c',
    intensity: 5,
    radius: 4,
    sampleGrid: 5,
    volumeIntensity: 0,
    shadows: false
  });
  const projector = {
    at: [-0.15, 3.2, 2.65],
    direction: [0, -0.33, -1],
    innerAngle: 32,
    outerAngle: 37,
    radius: 9,
    color: '#ffffff',
    intensity: 3.5,
    surfaceIntensity: 14,
    castsShadow: true,
    cookie: patterns.rosette
  };
  const fog = K.atmosphere.box({
    id: 'gallery-haze',
    min: [-4.7, 0.08, -2.1],
    max: [4.7, 3.75, 2.7],
    color: '#c7bed9',
    density: 0.065,
    lit: true,
    step: 0.2
  });
  world.areaLights = [panel, disc, tube, rail];
  world.volumeLighting = { ambient: 0.07, spots: [projector] };
  world.atmosphere = [fog];
  const control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.7 });
  control.update(0, 0);
  function apply() {
    panel.intensity = settings.panel ? 14 * settings.power : 0;
    disc.intensity = settings.disc ? 18 * settings.power : 0;
    tube.intensity = settings.lines ? 8 * settings.power : 0;
    rail.intensity = settings.lines ? 5 * settings.power : 0;
    panel.shadows = disc.shadows = projector.castsShadow = settings.shadows;
    projector.intensity = settings.projector ? 3.5 * settings.power : 0;
    projector.surfaceIntensity = settings.projector ? 14 * settings.power : 0;
    projector.cookie = patterns[settings.pattern];
    projector.cookie.roll = settings.roll + (settings.animate ? state.time * 9 : 0);
    world.atmosphere = settings.fog ? [fog] : [];
  }
  apply();
  return {
    world,
    settings,
    state,
    control,
    patterns,
    apply,
    update(dt) {
      if (!settings.held) state.time += dt;
      apply();
      control.update(dt, state.time);
      return world;
    },
    inspect: () => ({
      time: state.time,
      emitters: E.report(world.areaLights, { time: state.time }),
      settings: { ...settings }
    })
  };
}
if (typeof module !== 'undefined')
  module.exports = Object.assign(
    kit => ({ id: 'additional-light-emitters', name: 'The prism court', build: () => prismCourt(kit).world }),
    { demo: prismCourt }
  );
