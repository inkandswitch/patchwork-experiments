/* Cabinet of transformations: four uses of one finite field contract. */
function mathFieldsScene({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const math = K.procedural.mathFields;
  const colors = [
    0x080c19, 0x11182b, 0x20283f, 0x353d55, 0x596278, 0x89939d, 0x24213d, 0x37305c, 0x514583, 0x7966ac, 0xb09cd2,
    0xe1d3ee, 0x3a302b, 0x68533b, 0x9a7d51, 0xd0b279, 0xf1daa0, 0xfff3cf
  ];
  const B = makeBuilder(131, colors),
    S = K.sculpt(makeSculpt(B)),
    tags = K.deform.tags(S);
  Object.assign(S, { pixel: true, sun: K.V.norm([-0.6, 0.8, 0.65]), amb: 0.32, sky: 0.23, sunK: 0.78, aoK: 0.26 });
  S.pixelSize(48);
  const dark = { r: [0, 1, 2] },
    stone = { r: [1, 2, 3, 4] },
    metal = { r: [12, 13, 14, 15] },
    violet = { r: [6, 7, 8, 9, 10, 11] },
    gold = { r: [13, 14, 15, 16, 17] },
    light = { r: [14, 15, 16, 17], em: true };
  const box = (p, h, m, o = {}) => S.box(p, h, m, { res: 0.12, rd: 0.045, ...o });
  box([0, -0.36, 0], [5.8, 0.36, 3.25], dark, { res: 0.16, objectId: 'cabinet' });
  box([0, 0.025, 0], [5.58, 0.025, 3.02], stone, { res: 0.16, objectId: 'floor' });
  for (const x of [-3.65, 0, 3.65]) {
    S.lathe([x, 0.08, -0.35], 0.31, t => 1.16 - 0.06 * Math.sin(t * Math.PI), stone, { res: 0.09, objectId: 'plinth' });
    S.torus([x, 0.43, -0.35], 1.03, 0.045, metal, { res: 0.07, objectId: 'plinth' });
    box([x, 0.45, 0.84], [0.9, 0.022, 0.025], light, { res: 0.055, objectId: 'emitters' });
  }
  for (const x of [-5.24, 5.24]) {
    box([x, 1.71, -2.1], [0.115, 1.72, 0.14], stone, { objectId: 'arch' });
    S.ball([x, 3.48, -2.1], 0.14, light, { res: 0.04, objectId: 'emitters' });
  }
  S.tube(
    [
      [-5.24, 3.4, -2.1],
      [-4, 3.95, -2.1],
      [0, 4.16, -2.1],
      [4, 3.95, -2.1],
      [5.24, 3.4, -2.1]
    ],
    0.05,
    0.05,
    metal,
    { res: 0.09, objectId: 'arch' }
  );
  // The left tapestry is an atlas surface carrying mapped material coordinates.
  box([-3.65, 1.85, -0.56], [1.04, 1.22, 0.16], stone, { res: 0.09, objectId: 'chart-frame' });
  box([-3.65, 1.85, -0.36], [0.92, 1.09, 0.025], dark, { res: 0.085, objectId: 'chart-frame' });
  for (const x of [-4.69, -2.61])
    box([x, 1.85, -0.28], [0.022, 1.18, 0.025], metal, { res: 0.05, objectId: 'chart-frame' });
  for (const y of [0.67, 3.03])
    box([-3.65, y, -0.28], [1.06, 0.025, 0.025], gold, { res: 0.055, objectId: 'chart-frame' });
  // A flower remains native SDF splats, animated through a small GPU skin.
  S.torus([3.65, 1.78, -0.28], 0.98, 0.035, metal, { ax: S.AZ, res: 0.05, tag: 'flower', objectId: 'flower' });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    S.ball([3.65 + Math.sin(a) * 0.68, 1.78 + Math.cos(a) * 0.68, -0.23], [0.16, 0.43, 0.065], i % 3 ? violet : gold, {
      res: 0.039,
      ax: [
        [Math.cos(a), -Math.sin(a), 0],
        [Math.sin(a), Math.cos(a), 0],
        [0, 0, 1]
      ],
      tag: 'flower',
      objectId: 'flower'
    });
  }
  S.ball([3.65, 1.78, -0.1], [0.32, 0.32, 0.075], gold, { res: 0.035, tag: 'flower', objectId: 'flower' });
  S.ball([3.65, 1.78, 0.0], [0.16, 0.16, 0.03], dark, { res: 0.03, tag: 'flower', objectId: 'flower' });
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    S.ball([Math.cos(a) * 1.35, 1.85 + Math.sin(a) * 1.35, -0.8], 0.027, light, { res: 0.04, objectId: 'emitters' });
  }
  S.bake();
  const profiles = new Map();
  function profile(family) {
    if (profiles.has(family)) return profiles.get(family);
    const orbit = K.procedural.attractors.trace({ family, steps: 5000, burnIn: 1200 }),
      b = orbit.bounds,
      center = b.min.map((n, i) => (n + b.max[i]) / 2),
      span = Math.max(...b.max.map((n, i) => n - b.min[i]));
    const place = p => [
      ((p[0] - center[0]) * 2.55) / span,
      0.64 + ((p[2] - b.min[2]) * 2.55) / span,
      ((p[1] - center[1]) * 1.3) / span - 0.35
    ];
    const value = { orbit, place, family };
    profiles.set(family, value);
    return value;
  }
  const initial = profile('lorenz'),
    startOrbit = B.count();
  for (let i = 0; i < 5000; i++) {
    const p = initial.place(initial.orbit.points[i]),
      c = colors[7 + Math.min(4, Math.floor(initial.orbit.speeds[i] / 65))];
    B.disc(...p, [0, 0, 1], 0.012, 0.005, B.P[colors.indexOf(c)], 3);
  }
  const endOrbit = B.count();
  B.describeSplats(startOrbit, endOrbit, { object: 'orbit', material: 'iris' });
  const particleStart = B.count(),
    particleCount = 28;
  for (let i = 0; i < particleCount; i++)
    B.disc(...initial.place(initial.orbit.points[i * 137]), [0, 0, 1], 0.033, 0.012, B.P[16], 3);
  B.describeSplats(particleStart, B.count(), { object: 'live-flow', material: 'ivory' });
  // Full removal and reappearance is driven by the scalar chart mask.
  const revealStart = B.count();
  for (let j = 0; j < 17; j++)
    for (let i = 0; i < 153; i++) {
      const x = -4.75 + i * 0.0625,
        y = -0.6 + j * 0.026;
      if (j % 4 === 0 || i % 9 === 0 || Math.abs(Math.sin(x * 2.1) * 0.22 - 0.39 - y) < 0.02)
        B.disc(x, y, 3.42, [0, 0, 1], 0.018, 0.012, B.P[(i + j) % 4 ? 9 : 16], 3);
    }
  const revealEnd = B.count();
  B.describeSplats(revealStart, revealEnd, { object: 'reveal-lattice' });
  const atlas = SpriteSurface.make(1024),
    font = K.typography.fonts.bitmap();
  const label = (text, p, size = 0.18, c = colors[16]) =>
    K.typography.sprites(atlas, K.typography.layout(text, { font, size, align: 'center' }), {
      position: p,
      color: c,
      pixelsPerEm: 8
    });
  atlas.face([-5.5, 0.14, 3], [11, 0, 0], [0, 0, -6], 220, 120, (x, y) => {
    if (x < 3 || x > 216 || y < 3 || y > 116) return colors[3];
    if (x % 20 === 0 || y % 20 === 0) return colors[1];
    if ((x === 10 || x === 209) && y % 8 < 3) return colors[14];
    return (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? colors[2] : colors[3];
  });
  const texW = 112,
    texH = 144,
    region = atlas.reserve(texW, texH);
  atlas.faceRegion([-4.57, 0.77, -0.17], [1.84, 0, 0], [0, 2.16, 0], region);
  label('THE STRANGE GARDEN', [0, 4.48, -1.9], 0.39, colors[11]);
  label('COMPLEX CHARTS / BOUNDED CHAOS', [0, 3.85, -1.85], 0.18, colors[16]);
  label('01 / MATERIAL', [-3.65, 0.27, 0.91], 0.21);
  label('02 / FLOW', [0, 0.27, 0.91], 0.21);
  label('03 / FORM', [3.65, 0.27, 0.91], 0.21);
  label('04 / REVEAL FIELD', [0, -0.025, 3.44], 0.22, colors[10]);
  const graph = K.renderGraph.create({
    passes: [
      {
        id: 'bloom',
        type: 'bloom',
        select: { material: 'ivory' },
        radius: 10,
        intensity: 0.35,
        threshold: 0.65,
        budget: { maxPixels: 49152, maxSamples: 20 }
      }
    ]
  });
  const world = B.finish({
    spriteSurfaces: atlas.finish(),
    look: { pixel: true, pixelSize: 2, clean: 1, splatCoverage: 'continuous', renderGraph: graph },
    cam: { target: [0, 1.42, -0.1], dist: 17.1, yaw: 0.21, pitch: 0.29, focalLength: 36 },
    radius: 18,
    fog: { c: 0, start: 1, max: 0 },
    dither: 0.07
  });
  const warp = math
    .mapping({
      plane: 'xy',
      origin: [3.65, 1.78, -0.23],
      scale: [0.9, 0.9],
      steps: [
        { type: 'affine', spin: 0.24 },
        { type: 'spiral', twist: 1.1 },
        { type: 'mobius', c: [0.08, 0.04] }
      ]
    })
    .deform({ amount: 0.47, maxDisplacement: 0.54 });
  if (!tags.flower)
    throw new Error(
      'Missing flower tags: ' +
        JSON.stringify({ tags: Object.keys(tags), objects: world.renderMetadata?.objects, count: world.count })
    );
  const skin = K.deform.skin(world, tags.flower, { grid: [7, 7, 1] }),
    bones = new Float32Array(skin.n * 12);
  const rig = K.bones.bind(world, {
    ids: tags.flower,
    bid: skin.bid,
    bid2: skin.bid2,
    w2: skin.w2,
    M: bones,
    pose(t) {
      warp.time = t;
      skin.fill(bones, 0, state.deform ? warp : null);
    }
  });
  const reveal = math
    .mapping({
      plane: 'xy',
      origin: [0, -0.39, 3.42],
      scale: [1.2, 0.38],
      steps: [
        { type: 'mobius', c: [0.045, 0.04] },
        { type: 'spiral', twist: 1.35 }
      ]
    })
    .mask({ pattern: 'rings', frequency: 0.72, rate: -0.11, feather: 0.08, threshold: 0.34 });
  const chart = math.mapping({
    plane: 'xy',
    scale: [1, 1],
    steps: [
      { type: 'mobius', a: [1, 0.2], b: [0.15, 0], c: [0.28, 0.16], d: [1, 0] },
      { type: 'spiral', twist: 1.65 }
    ]
  });
  const pattern = chart.mask({ pattern: 'checker', frequency: 2.4, rate: 1 / 3, feather: 0.18 });
  const frames = Array.from({ length: 24 }, (_, frame) => {
    const rgba = new Uint8Array(texW * texH * 4);
    for (let y = 0; y < texH; y++)
      for (let x = 0; x < texW; x++) {
        const u = ((x + 0.5) / texW) * 3.4 - 1.7,
          v = ((y + 0.5) / texH) * 4.4 - 2.2,
          s = chart.sample(u, v, 0),
          a = s.valid ? pattern(u, v, 0, (frame / 24) * 3) : 0;
        const value = s.valid
          ? Math.min(1, Math.max(0, a * 0.76 + (0.5 + 0.5 * Math.sin(Math.hypot(...s.point) * 16)) * 0.24))
          : 0;
        const index = value > 0.7 ? 16 : value > 0.48 ? 10 : value > 0.24 ? 8 : 6,
          c = colors[index];
        rgba.set([(c >>> 16) & 255, (c >>> 8) & 255, c & 255, 255], (y * texW + x) * 4);
      }
    return rgba;
  });
  const state = { time: 0, paused: false, reveal: true, deform: true, material: true, flow: true, family: 'lorenz' },
    control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.6 });
  control.update(0, 0);
  let active = initial,
    particles = [],
    lastFrame = -1,
    visible = 0,
    profileDirty = true;
  function setFamily(family) {
    profileDirty = true;
    active = profile(family);
    state.family = family;
    particles = Array.from({ length: particleCount }, (_, i) =>
      math.integrator({ family, start: active.orbit.points[i * 137], maxSteps: 16, maxEvaluations: 64 })
    );
    for (let i = 0; i < 5000; i++) {
      const q = (startOrbit + i) * 16,
        p = active.place(active.orbit.points[i]);
      world.data[q] = p[0];
      world.data[q + 1] = p[1];
      world.data[q + 2] = p[2];
    }
  }
  setFamily('lorenz');
  const rows = new Set();
  for (let i = particleStart; i < revealEnd; i++) rows.add(i >> 9);
  return {
    world,
    state,
    control,
    chart,
    warp,
    skin,
    frames,
    particleCount,
    setFamily,
    update(dt) {
      if (!state.paused) state.time += dt;
      const t = state.time;
      rig.update(state.paused ? 0 : dt, state.deform ? t : 0);
      control.update(dt, t);
      if (state.flow && !state.paused)
        for (let i = 0; i < particles.length; i++) {
          const sample = particles[i].advance(dt * 0.75),
            p = active.place(sample.point),
            q = (particleStart + i) * 16;
          world.data[q] = p[0];
          world.data[q + 1] = p[1];
          world.data[q + 2] = p[2];
        }
      visible = 0;
      for (let i = revealStart; i < revealEnd; i++) {
        const q = i * 16,
          a = state.reveal ? reveal(world.data[q], world.data[q + 1], world.data[q + 2], t) : 1;
        world.data[q + 3] = 3 * a;
        visible += a > 0.5 ? 1 : 0;
      }
      const frame = state.material ? Math.floor(((t % 3) / 3) * 24) : 0;
      if (frame !== lastFrame) {
        lastFrame = frame;
        SpriteSurface.update(world.spriteSurfaces, region, { w: texW, h: texH, rgba: frames[frame] });
      }
      const changed = new Set([...rows, ...Array.from(rig.rows ?? [], (v, i) => (v ? i : -1)).filter(i => i >= 0)]);
      if (profileDirty) {
        for (let i = startOrbit; i < endOrbit; i += 512) changed.add(i >> 9);
        changed.add((endOrbit - 1) >> 9);
        profileDirty = false;
      }
      return [...changed].sort((a, b) => a - b);
    },
    inspect() {
      return {
        count: world.count,
        bones: skin.n,
        particles: particleCount,
        visible,
        totalReveal: revealEnd - revealStart,
        chartCost: chart.cost,
        integration: particles[0]?.state,
        range: { startOrbit, endOrbit, particleStart, revealStart, revealEnd },
        camera: control.read().mode
      };
    }
  };
}
if (typeof module !== 'undefined') module.exports = mathFieldsScene;
