/* Signal House: a small SDF relay station with crisp original pixel print. */
function renderEffectsScene({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const colors = [
    0x060d18, 0x0d1c29, 0x152f3f, 0x254858, 0x3a6471, 0x60888d, 0x95b4ae, 0x073d50, 0x086a80, 0x16a4b2, 0x63ded7,
    0xbaffeb, 0x3f2528, 0x743c32, 0xae533a, 0xe87b43, 0xffb05b, 0xffdf9b
  ];
  const B = makeBuilder(71, colors),
    S = K.sculpt(makeSculpt(B));
  Object.assign(S, { pixel: true, sun: K.V.norm([-0.6, 0.9, 0.55]), amb: 0.27, sky: 0.2, sunK: 0.8, aoK: 0.3 });
  S.pixelSize(48);
  const dark = { r: [0, 1, 2] },
    steel = { r: [1, 2, 3, 4, 5] },
    cool = { r: [7, 8, 9, 10, 11], em: true },
    warm = { r: [13, 14, 15, 16, 17], em: true },
    copper = { r: [12, 13, 14, 15] },
    stone = { r: [2, 3, 4, 5] };
  const box = (at, size, mat, extra = {}) => S.box(at, size, mat, { res: 0.11, rd: 0.035, ...extra });
  box([0, -0.35, 0], [5.8, 0.35, 3.5], dark, { res: 0.18, rd: 0.14, objectId: 'base' });
  box([0, 0.025, 0], [5.6, 0.025, 3.3], steel, { res: 0.16, objectId: 'deck' });
  // Back gantry and cable trays.
  for (const x of [-5.15, 5.15]) {
    box([x, 2, -2.6], [0.16, 2.05, 0.2], steel, { objectId: 'gantry' });
    box([x, 3.9, -2.6], [0.29, 0.16, 0.3], copper, { objectId: 'gantry' });
    box([x, 3.42, -2.34], [0.055, 0.32, 0.045], warm, { res: 0.04, objectId: 'neon' });
  }
  box([0, 4.05, -2.6], [5.3, 0.15, 0.18], steel, { objectId: 'gantry' });
  box([0, 3.84, -2.38], [4.5, 0.025, 0.035], cool, { res: 0.07, objectId: 'neon' });
  for (let x = -4.9; x < 5; x += 0.36)
    box([x, 4.05, -2.39], [0.055, 0.09, 0.025], copper, { res: 0.05, objectId: 'gantry' });
  for (const x of [-3.5, 0, 3.5]) {
    box([x, 0.25, -0.25], [1.28, 0.19, 1.17], dark, { objectId: 'plinth' });
    box([x, 0.46, -0.25], [1.17, 0.035, 1.08], copper, { objectId: 'plinth' });
    box([x, 0.51, 0.85], [0.94, 0.02, 0.03], cool, { res: 0.045, objectId: 'neon' });
  }
  // Central induction ring. All emitters share an owner, so the glow scope is cheap.
  S.torus([0, 1.9, -0.3], 1.06, 0.13, steel, { res: 0.055, ax: S.AZ, objectId: 'relay' });
  S.torus([0, 1.9, -0.16], 0.93, 0.035, cool, { res: 0.035, ax: S.AZ, objectId: 'neon' });
  S.torus([0, 1.9, -0.18], 1.24, 0.024, copper, { res: 0.045, ax: S.AZ, objectId: 'relay' });
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12;
    S.ball([Math.cos(a) * 1.22, 1.9 + Math.sin(a) * 1.22, -0.15], [0.035, 0.035, 0.055], i % 3 ? cool : warm, {
      res: 0.04,
      objectId: 'neon'
    });
  }
  S.ball([0, 1.9, -0.1], 0.56, { r: [7, 8, 9, 10] }, { res: 0.035, objectId: 'core' });
  S.ball([0, 1.9, 0.4], [0.36, 0.36, 0.065], warm, { res: 0.028, objectId: 'neon' });
  S.ball([0, 1.9, 0.47], [0.21, 0.21, 0.035], dark, { res: 0.025, objectId: 'core' });
  S.ball([-0.1, 2.03, 0.49], 0.055, cool, { res: 0.018, objectId: 'neon' });
  box([0, 0.82, -0.36], [0.15, 0.3, 0.15], steel, { objectId: 'relay' });
  // Left apparatus: three glass-like channel slots and physical cable coils.
  box([-3.5, 1.49, -0.5], [0.88, 0.93, 0.42], steel, { objectId: 'console' });
  box([-3.5, 1.55, -0.045], [0.76, 0.72, 0.035], dark, { res: 0.08, objectId: 'scope' });
  for (const x of [-3.96, -3.5, -3.04]) {
    box([x, 1.55, 0.015], [0.12, 0.62, 0.025], cool, { res: 0.045, objectId: 'neon' });
    for (let j = 0; j < 7; j++)
      box([x, 1.01 + j * 0.18, 0.05], [0.17, 0.008, 0.018], steel, { res: 0.035, objectId: 'console' });
  }
  for (let i = 0; i < 5; i++)
    S.torus([-3.5, 2.58 + i * 0.06, -0.5], 0.42, 0.025, copper, { res: 0.05, objectId: 'console' });
  S.ball([-3.5, 2.98, -0.5], 0.12, warm, { res: 0.035, objectId: 'neon' });
  // Right display's face is printed in an atlas, not blobs of geometry.
  box([3.5, 1.72, -0.48], [1.02, 1.18, 0.24], steel, { res: 0.09, objectId: 'monitor' });
  box([3.5, 1.85, -0.205], [0.88, 0.87, 0.025], dark, { res: 0.07, objectId: 'screen' });
  box([3.5, 2.76, -0.14], [0.87, 0.035, 0.03], warm, { res: 0.04, objectId: 'neon' });
  for (const x of [2.76, 4.24]) S.ball([x, 0.78, -0.13], 0.075, warm, { res: 0.04, objectId: 'neon' });
  // Foreground instrument bank deliberately occludes the bright ring.
  box([0, 0.41, 2.15], [3.2, 0.3, 0.38], steel, { objectId: 'foreground' });
  for (let i = 0; i < 9; i++) {
    const x = -2.72 + i * 0.68;
    box([x, 0.74, 2.14], [0.21, 0.045, 0.21], copper, { res: 0.08, objectId: 'foreground' });
    S.ball([x, 0.82, 2.14], [0.06, 0.09, 0.06], i % 3 ? cool : warm, { res: 0.035, objectId: 'neon' });
  }
  for (const x of [-5.22, 5.22])
    for (let z = -2; z < 3; z += 0.45) box([x, 0.19, z], [0.03, 0.045, 0.14], warm, { res: 0.065, objectId: 'neon' });
  S.bake();
  const atlas = SpriteSurface.make(1024),
    font = K.typography.fonts.bitmap();
  const label = (text, at, size = 0.18, c = colors[10]) =>
    K.typography.sprites(atlas, K.typography.layout(text, { font, size, align: 'center' }), {
      position: at,
      color: c,
      pixelsPerEm: 8
    });
  atlas.face([-5.55, 0.14, 3.26], [11.1, 0, 0], [0, 0, -6.52], 222, 130, (x, y) => {
    if (x < 3 || x > 218 || y < 3 || y > 126) return colors[3];
    if (x % 13 === 0 || y % 13 === 0) return colors[1];
    if ((x === 13 || x === 208) && y > 8 && y < 121) return y % 9 < 4 ? colors[14] : colors[3];
    if (y === 111 && x > 20 && x < 201) return colors[8];
    return (Math.floor(x / 13) + Math.floor(y / 13)) % 2 ? colors[2] : colors[3];
  });
  // A tiny raster plotted directly onto an upright sprite surface.
  const W = 96,
    H = 80,
    rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c = colors[1];
      if (x % 12 === 0 || y % 10 === 0) c = colors[3];
      const wave = 39 + Math.sin(x * 0.13) * 12 + Math.sin(x * 0.047) * 8;
      if (Math.abs(y - wave) < 1.3) c = colors[10];
      const bars = x > 9 && x < 87 && y > 58 && y < 74;
      if (bars && x % 6 < 3 && y > 73 - ((x * 17) % 15)) c = colors[15];
      if ((y === 6 || y === 76) && x > 5 && x < 91) c = colors[16];
      rgba.set([(c >>> 16) & 255, (c >>> 8) & 255, c & 255, 255], (y * W + x) * 4);
    }
  const tile = atlas.reserve(W, H, (x, y) => {
    const q = (y * W + x) * 4;
    return rgba[q] * 65536 + rgba[q + 1] * 256 + rgba[q + 2];
  });
  atlas.faceRegion([2.635, 1.025, 0.02], [1.73, 0, 0], [0, 1.65, 0], tile);
  label('SIGNAL HOUSE', [0, 4.5, -2.4], 0.48, colors[11]);
  label('STATION 012 / AFTERIMAGE', [0, 3.51, -2.12], 0.21, colors[16]);
  label('INDUCTION', [0, 0.33, 0.99], 0.2, colors[16]);
  label('MEMORY', [-3.5, 0.33, 0.99], 0.2);
  label('LIVE SIGNAL', [3.5, 0.33, 0.99], 0.2);
  label('072.81', [3.5, 2.35, 0.045], 0.25, colors[17]);
  label('CHANNEL / 03', [3.5, 1.22, 0.045], 0.15, colors[11]);
  label('PERSISTENCE / DO NOT POWER DOWN', [0, 0.22, 2.55], 0.21, colors[10]);
  for (const x of [-4.92, 4.92]) label('012', [x, 0.35, 3.51], 0.2, colors[16]);
  const graph = K.renderGraph.create({
    passes: [
      { id: 'screenMask', type: 'mask', volume: { at: [3.5, 1.85, 0.02], extent: [1.4, 1.5, 0.3], feather: 0.06 } },
      {
        id: 'bloom',
        type: 'bloom',
        select: { object: 'neon' },
        radius: 19,
        intensity: 1.2,
        threshold: 0.5,
        budget: { maxPixels: 65536, maxSamples: 32 }
      },
      {
        id: 'halation',
        type: 'halation',
        select: { object: 'neon' },
        radius: 8,
        intensity: 0.5,
        threshold: 0.5,
        budget: { maxPixels: 49152, maxSamples: 24 }
      },
      {
        id: 'outline',
        type: 'outline',
        width: 1.15,
        depthThreshold: 0.18,
        relativeDepth: 0.007,
        color: [5, 13, 23],
        opacity: 0.65,
        budget: { maxPixels: 1048576, filter: 'nearest' }
      },
      {
        id: 'chromatic',
        type: 'chromatic',
        offset: [0.7, 0],
        radial: 0.35,
        opacity: 0.4,
        budget: { maxPixels: 524288 }
      },
      {
        id: 'blocks',
        type: 'blocks',
        mask: 'screenMask',
        protectObjects: false,
        offset: [21, 0],
        blockSize: [65, 15],
        probability: 0.2,
        rate: 4,
        seed: 12,
        budget: { maxPixels: 196608 }
      },
      {
        id: 'pixelSort',
        type: 'pixelSort',
        mask: 'screenMask',
        protectObjects: false,
        span: 12,
        axis: 'y',
        threshold: [0.1, 0.9],
        opacity: 0.42,
        budget: { maxPixels: 65536, maxSamples: 12 }
      },
      {
        id: 'feedback',
        type: 'feedback',
        select: { object: 'neon' },
        gain: 0.16,
        halfLife: 0.2,
        opacity: 0.2,
        threshold: [0.6, 1],
        warp: { velocity: [3, -5] },
        budget: { maxPixels: 131072 },
        cameraMotion: 'reset'
      }
    ]
  });
  const world = B.finish({
    spriteSurfaces: atlas.finish(),
    look: { pixel: true, pixelSize: 2, clean: 1, splatCoverage: 'continuous', renderGraph: graph },
    cam: { target: [0, 1.3, -0.1], dist: 16.9, yaw: 0.28, pitch: 0.36, focalLength: 36 },
    radius: 17,
    fog: { c: 0, start: 1, max: 0 },
    dither: 0.08
  });
  const control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.55 });
  control.update(0, 0);
  let screenTick = -1;
  const state = { time: 0, paused: false },
    settings = { all: true };
  return {
    world,
    graph,
    control,
    state,
    settings,
    toggle(id, enabled) {
      graph.update(id, { enabled });
    },
    update(dt) {
      if (!state.paused) state.time += dt;
      control.update(dt, state.time);
      const tick = Math.floor(state.time * 12);
      if (tick !== screenTick) {
        screenTick = tick;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            let c = x % 12 === 0 || y % 10 === 0 ? colors[3] : colors[1];
            const wave = 35 + Math.sin(x * 0.13 + state.time * 1.8) * 12 + Math.sin(x * 0.047 - state.time) * 8;
            if (Math.abs(y - wave) < 1.3) c = colors[10];
            if (x > 9 && x < 87 && y > 58 && y < 74 && x % 6 < 3 && y > 73 - ((x * 17 + tick) % 15)) c = colors[15];
            if ((y === 6 || y === 76) && x > 5 && x < 91) c = colors[16];
            rgba.set([(c >>> 16) & 255, (c >>> 8) & 255, c & 255, 255], (y * W + x) * 4);
          }
        SpriteSurface.update(world.spriteSurfaces, tile, { w: W, h: H, rgba });
      }
    },
    inspect(w = 1100, h = 760) {
      return K.renderGraph.resources(K.renderGraph.prepare(graph), w, h);
    }
  };
}
if (typeof module !== 'undefined') module.exports = renderEffectsScene;
