/* A retained courtyard. Editing flowers writes only flower carriers and bones. */
function randomnessScene({ KIT: K, makeBuilder, makeSculpt, SpriteSurface }) {
  const R = K.random,
    root = R.create('courtyard-014'),
    flowers = root.stream('flowers'),
    trees = root.stream('trees'),
    rocks = root.stream('rocks'),
    lamps = root.stream('lanterns'),
    grass = root.stream('grass');
  const colors = [
    0x07151d, 0x0c2530, 0x173c44, 0x24565b, 0x437878, 0x78a09a, 0xb5c4ac, 0x073e44, 0x0a6565, 0x27918a, 0x62b8a5,
    0xa5d5b3, 0x302b29, 0x624735, 0xa67043, 0xdba565, 0xffd59a, 0xffefc6
  ];
  const B = makeBuilder(root.stream('geometry').seed32, colors),
    S = K.sculpt(makeSculpt(B)),
    tags = K.deform.tags(S);
  Object.assign(S, { pixel: true, sun: K.V.norm([-0.6, 0.82, 0.5]), amb: 0.28, sky: 0.22, sunK: 0.82, aoK: 0.24 });
  S.pixelSize(46);
  const dark = { r: [0, 1, 2] },
    stone = { r: [1, 2, 3, 4] },
    metal = { r: [12, 13, 14, 15] },
    wood = { r: [12, 13, 14] },
    leaf = { r: [7, 8, 9, 10, 11] },
    warm = { r: [13, 14, 15, 16, 17] },
    light = { r: [15, 16, 17], em: true };
  const box = (at, h, mat, options = {}) => S.box(at, h, mat, { res: 0.12, rd: 0.055, ...options });
  box([0, -0.25, 0], [5.45, 0.3, 3.45], dark, { res: 0.16, objectId: 'base' });
  box([0, 0.075, 0], [5.25, 0.025, 3.23], stone, { res: 0.16, objectId: 'ground' });
  for (const x of [-3, 0, 3]) {
    S.lathe([x, 0.12, -1.22], 0.18, 1.06, stone, { res: 0.095, objectId: 'planters' });
    S.torus([x, 0.3, -1.22], 0.91, 0.055, metal, { res: 0.07, objectId: 'planters' });
  }
  const anchors = [-3, 0, 3].map(x => [x, 0.29, -1.22]),
    treeIds = [];
  for (let i = 0; i < 3; i++) {
    const [x, y, z] = anchors[i],
      id = 'tree-' + i;
    treeIds.push(id);
    S.lathe([x, y, z], 1.4, t => 0.13 - 0.07 * t, wood, { res: 0.07, tag: id, objectId: id });
    for (const side of [-1, 1])
      S.tube(
        [
          [x, y + 0.55, z],
          [x + side * 0.26, y + 1, z],
          [x + side * 0.42, y + 1.35, z]
        ],
        0.055,
        0.025,
        wood,
        { res: 0.065, tag: id, objectId: id }
      );
    S.canopy({
      at: [x, y + 1.72, z],
      size: [0.93, 0.78, 0.78],
      lobes: 6,
      seed: root.stream('canopy', id).seed32,
      px: 1 / 46,
      res: 0.075,
      cluster: 6,
      leaf: 9,
      bump: 1.2,
      mat: leaf,
      opts: { tag: id, objectId: id }
    });
  }
  // A pair of front posts carries a sagging line of little lanterns.
  for (const x of [-4.97, 4.97]) {
    box([x, 1.92, 2.33], [0.11, 1.86, 0.13], wood, { objectId: 'posts' });
    box([x, 3.85, 2.33], [0.22, 0.08, 0.22], metal, { objectId: 'posts' });
    box([x, 0.16, 2.33], [0.23, 0.15, 0.26], stone, { objectId: 'posts' });
  }
  const rope = [];
  for (let i = 0; i <= 20; i++) {
    const x = -4.97 + (i * 9.94) / 20;
    rope.push([x, 3.7 - 0.32 * (1 - (x / 4.97) ** 2), 2.33]);
  }
  S.tube(rope, 0.022, 0.022, wood, { res: 0.09, objectId: 'rope' });
  const lampRecords = [];
  for (let i = 0; i < 8; i++) {
    const id = 'lantern-' + i,
      x = -4.35 + i * 1.245,
      drop = lamps.sample([id, 'drop'], { type: 'uniform', min: 0.28, max: 0.62 }),
      ropeY = 3.7 - 0.32 * (1 - (x / 4.97) ** 2),
      y = ropeY - drop,
      z = 2.33;
    const record = { id, x, y, z, drop, motif: lamps.sample([id, 'motif'], { type: 'integer', min: 0, max: 3 }) };
    lampRecords.push(record);
    S.tube(
      [
        [x, ropeY, z],
        [x, y + 0.16, z]
      ],
      0.012,
      0.012,
      wood,
      { res: 0.05, objectId: 'lanterns' }
    );
    box([x, y, z], [0.135, 0.18, 0.13], warm, { res: 0.048, rd: 0.035, objectId: 'lanterns' });
    box([x, y + 0.21, z], [0.18, 0.035, 0.17], metal, { res: 0.055, objectId: 'lanterns' });
    box([x, y - 0.21, z], [0.16, 0.025, 0.16], metal, { res: 0.05, objectId: 'lanterns' });
    for (const side of [-1, 1])
      box([x + side * 0.135, y, z + 0.135], [0.008, 0.16, 0.012], wood, { res: 0.035, objectId: 'lanterns' });
  }
  // Stones have their own keyed samples; neither plant count nor flower edits touch them.
  const rockRecords = [];
  for (let i = 0; i < 12; i++) {
    const id = 'rock-' + i,
      x = (i < 6 ? -1 : 1) * (1.35 + (i % 6) * 0.61),
      z = 2.34 + rocks.sample([id, 'z'], { type: 'uniform', min: -0.17, max: 0.3 });
    const r = rocks.sample([id, 'size'], { type: 'triangular', min: 0.14, max: 0.32, mode: 0.22 });
    rockRecords.push({ id, x, z, r });
    S.ball([x, 0.11 + r * 0.55, z], [r, r * 0.65, r * 0.8], stone, {
      res: 0.065,
      bump: [0.025, 0.15],
      objectId: 'rocks'
    });
  }
  for (let i = 0; i < 9; i++)
    box([Math.sin(i * 0.65) * 0.11, 0.205, 2.9 - i * 0.65], [0.48, 0.035, 0.23], i % 2 ? stone : metal, {
      res: 0.1,
      rd: 0.08,
      objectId: 'path'
    });
  const maxFlowers = 32,
    flowerIds = [],
    flowerAnchors = [];
  for (let i = 0; i < maxFlowers; i++) {
    const x = [-4.2, -3.4, -2.1, -1.25, 1.25, 2.1, 3.4, 4.2][i % 8],
      z = [0.72, -0.12, 1.57, -1.85][Math.floor(i / 8)],
      id = 'flower-' + i;
    flowerIds.push(id);
    flowerAnchors.push([x, 0.14, z]);
    S.tube(
      [
        [x, 0.14, z],
        [x + 0.015, 0.45, z],
        [x, 0.67, z]
      ],
      0.014,
      0.009,
      leaf,
      { res: 0.06, tag: id, objectId: id }
    );
    for (const side of [-1, 1])
      S.ball([x + side * 0.075, 0.35, z], [0.1, 0.025, 0.045], leaf, { res: 0.05, tag: id, objectId: id });
    for (let j = 0; j < 6; j++) {
      const a = (j * Math.PI) / 3;
      S.ball([x + Math.cos(a) * 0.105, 0.69 + Math.sin(a) * 0.105, z + 0.015], [0.073, 0.07, 0.035], warm, {
        res: 0.043,
        tag: id,
        objectId: id
      });
    }
    S.ball([x, 0.69, z + 0.055], [0.047, 0.047, 0.035], dark, { res: 0.035, tag: id, objectId: id });
  }
  S.bake();
  const atlas = SpriteSurface.make(1024),
    font = K.typography.fonts.bitmap();
  const label = (text, p, size = 0.18, c = colors[16]) =>
    K.typography.sprites(atlas, K.typography.layout(text, { font, size, align: 'center' }), {
      position: p,
      color: c,
      pixelsPerEm: 8
    });
  // A crisp ground atlas, with patches whose variation comes from an independent coherent field.
  const grassField = R.spatial(grass, { dimension: 2, scale: 1.45, octaves: 2, min: 0.65, max: 1.25 });
  atlas.face([-5.16, 0.19, 3.2], [10.32, 0, 0], [0, 0, -6.4], 258, 160, (x, y) => {
    if (x < 3 || x > 254 || y < 3 || y > 156) return colors[3];
    const u = (x / 258 - 0.5) * 10.32,
      v = (y / 160 - 0.5) * 6.4,
      walk = Math.abs(u) < 0.65;
    if (walk) return x % 12 === 0 || y % 12 === 0 ? colors[1] : colors[3];
    const light = grassField(u, v);
    return (x * 17 + y * 31) % 29 < 2 ? colors[light > 0.95 ? 9 : 7] : colors[light > 0.96 ? 2 : 1];
  });
  const tuft = atlas.reserve(17, 27, (x, y) => {
    const blades = [
      [-0.28, 4],
      [0.24, -4],
      [0, 0]
    ].some(([s, o]) => y > Math.abs(o) + 3 && Math.abs(x - 8 - o - (26 - y) * s) < 0.9);
    return blades ? colors[(x + y) % 7 === 0 ? 10 : 8] : null;
  });
  for (let i = 0; i < 148; i++) {
    const x = grass.sample([i, 'x'], { type: 'uniform', min: -4.8, max: 4.8 }),
      z = grass.sample([i, 'z'], { type: 'uniform', min: -2.8, max: 2.8 });
    if (Math.abs(x) < 0.75 || anchors.some(a => Math.hypot(x - a[0], z - a[2]) < 0.95)) continue;
    const h = grassField(x, z) * grass.sample([i, 'height'], { type: 'triangular', min: 0.18, max: 0.45, mode: 0.26 });
    atlas.faceRegion([x - 0.11, 0.195, z], [0.22, 0, 0], [0, h, 0], tuft);
  }
  for (const x of [-4.97, 4.97])
    atlas.face([x - 0.083, 0.18, 2.535], [0.166, 0, 0], [0, 3.5, 0], 12, 210, (u, v) => {
      if (v % 44 < 3) return colors[12];
      if (u === 0 || u === 11) return colors[14];
      return (u * 17 + Math.floor(v / 8) * 5) % 13 < 2 ? colors[12] : colors[13];
    });
  for (const record of lampRecords) {
    const { x, y, z, motif } = record;
    atlas.face([x - 0.105, y - 0.145, z + 0.155], [0.21, 0, 0], [0, 0.29, 0], 15, 21, (u, v) => {
      if (u === 0 || u === 14 || v === 0 || v === 20) return colors[14];
      if (u % 5 === 0) return colors[13];
      if (
        motif === 0
          ? u === 7 || v === 10
          : motif === 1
            ? Math.abs(u - 7) + Math.abs(v - 10) < 5
            : motif === 2
              ? u % 4 === 0 && v % 4 < 2
              : (u + v) % 9 === 0
      )
        return colors[17];
      return colors[16];
    });
  }
  for (const r of rockRecords)
    atlas.face([r.x - r.r * 0.48, 0.12, r.z + r.r * 0.82], [r.r * 0.96, 0, 0], [0, r.r * 0.55, 0], 12, 8, (u, v) =>
      (u * 3 + v * 7) % 11 < 3 ? colors[8] : null
    );
  label('THE SEEDED COURTYARD', [0, 4.35, -2.45], 0.35, colors[11]);
  label('INDEPENDENT CHANCE / SHARED CHARACTER', [0, 3.95, -2.4], 0.16, colors[16]);
  label('FLOWERS CHANGE / THE GARDEN REMEMBERS', [0, -0.24, 3.47], 0.23, colors[10]);
  const world = B.finish({
    spriteSurfaces: atlas.finish(),
    look: { pixel: true, pixelSize: 2, clean: 1, splatCoverage: 'continuous' },
    cam: { target: [0, 1.28, 0], dist: 17.5, yaw: 0.18, pitch: 0.39, focalLength: 36 },
    radius: 18,
    fog: { c: 0, start: 1, max: 0 },
    dither: 0.08
  });
  const ids = [...treeIds, ...flowerIds].flatMap(id => tags[id] ?? []),
    bid = new Uint16Array(ids.length),
    groups = [...treeIds, ...flowerIds];
  let index = 0;
  for (let group = 0; group < groups.length; group++) for (const id of tags[groups[group]] ?? []) bid[index++] = group;
  const matrices = new Float32Array(groups.length * 12),
    density = new Map(ids.map(id => [id, world.data[id * 16 + 3]])),
    ink = new Map(ids.map(id => [id, world.data[id * 16 + 7]]));
  let flowerRecords = [],
    treeRecords = [],
    pending = true;
  const state = { time: 0, revision: 0, count: 16, distribution: 'normal', correlation: 0.75 };
  const presets = {
    normal: { type: 'normal', mean: 1, deviation: 0.25, min: 0.5, max: 1.6 },
    uniform: { type: 'uniform', min: 0.5, max: 1.6 },
    triangular: { type: 'triangular', min: 0.5, max: 1.6, mode: 0.8 },
    power: { type: 'power', min: 0.5, max: 1.6, exponent: 3 }
  };
  function pose() {
    const all = [
      ...treeRecords.map((r, i) => ({ base: anchors[i], point: anchors[i], scale: [r.width, r.height, r.width] })),
      ...flowerRecords.map((r, i) => ({ base: flowerAnchors[i], point: r.point, scale: [r.width, r.height, r.width] }))
    ];
    for (let i = 0; i < all.length; i++) {
      const r = all[i],
        q = i * 12;
      for (let j = 0; j < 12; j++) matrices[q + j] = 0;
      for (let a = 0; a < 3; a++) {
        matrices[q + a * 3 + a] = r.scale[a];
        matrices[q + 9 + a] = r.point[a] - r.base[a] * r.scale[a];
      }
    }
  }
  function refresh() {
    const correlated = R.correlated({
      channels: [
        { name: 'height', distribution: { type: 'normal', mean: 1, deviation: 0.15, min: 0.75, max: 1.3 } },
        { name: 'width', distribution: { type: 'normal', mean: 1, deviation: 0.17, min: 0.72, max: 1.33 } }
      ],
      correlation: [
        [1, state.correlation],
        [state.correlation, 1]
      ]
    });
    treeRecords = treeIds.map(id => ({ id, ...trees.sample(id, correlated) }));
    const height = R.distribution(presets[state.distribution]);
    flowerRecords = flowerIds.map((id, i) => {
      const key = ['revision', state.revision, id],
        base = flowerAnchors[i];
      return {
        id,
        point: [
          base[0] + flowers.sample([...key, 'x'], { type: 'uniform', min: -0.13, max: 0.13 }),
          base[1],
          base[2] + flowers.sample([...key, 'z'], { type: 'uniform', min: -0.1, max: 0.1 })
        ],
        height: flowers.sample([...key, 'height'], height),
        width: flowers.sample([...key, 'width'], { type: 'uniform', min: 0.75, max: 1.25 }),
        pigment: flowers.sample([...key, 'pigment'], { type: 'integer', min: 14, max: 17 }),
        visible: i < state.count
      };
    });
    for (let i = 0; i < flowerIds.length; i++) {
      const r = flowerRecords[i];
      for (const id of tags[flowerIds[i]] ?? []) {
        const q = id * 16;
        world.data[q + 3] = r.visible ? density.get(id) : 0;
        const original = ink.get(id),
          red = original & 255,
          green = (original >>> 8) & 255,
          blue = (original >>> 16) & 255;
        if (red > green * 1.05) {
          const target = colors[r.pigment],
            factor = Math.max(red, green, blue) / 255;
          world.data[q + 7] =
            Math.round(((target >>> 16) & 255) * factor) |
            (Math.round(((target >>> 8) & 255) * factor) << 8) |
            (Math.round((target & 255) * factor) << 16);
        }
      }
    }
    pose();
    pending = true;
  }
  const rig = K.bones.bind(world, { ids, bid, M: matrices, pose });
  refresh();
  rig.update(0, 0);
  const control = K.cameraRig.control(() => ({ camera: world.cam }), { handoff: 0.6 });
  control.update(0, 0);
  const proof = () => ({
    lanterns: JSON.stringify(lampRecords),
    rocks: JSON.stringify(rockRecords),
    trees: JSON.stringify(treeRecords)
  });
  const stable = proof();
  return {
    world,
    root,
    state,
    control,
    presets,
    flowerIds,
    treeIds,
    tags,
    groups,
    matrices,
    stable,
    changeFlowers() {
      state.revision++;
      refresh();
    },
    addFlowers() {
      state.count = Math.min(maxFlowers, state.count + 8);
      refresh();
    },
    setDistribution(name) {
      if (!Object.hasOwn(presets, name)) throw new Error('Unknown flower distribution');
      state.distribution = name;
      refresh();
    },
    setCorrelation(value) {
      if (!Number.isFinite(value) || Math.abs(value) > 0.95) throw new Error('Invalid tree correlation');
      state.correlation = value;
      refresh();
    },
    reset() {
      state.revision = 0;
      state.count = 16;
      state.distribution = 'normal';
      state.correlation = 0.75;
      refresh();
    },
    update(dt) {
      state.time += dt;
      control.update(dt, state.time);
      if (!pending) return [];
      pending = false;
      rig.update(0, state.time);
      return [...new Set(ids.map(id => id >> 9))].sort((a, b) => a - b);
    },
    inspect() {
      const current = proof();
      return {
        count: world.count,
        visibleFlowers: state.count,
        revision: state.revision,
        correlation: state.correlation,
        streamCount: root.snapshot().streams.length,
        unchanged: {
          lanterns: current.lanterns === stable.lanterns,
          rocks: current.rocks === stable.rocks,
          trees: current.trees === stable.trees
        },
        flowers: flowerRecords.map(r => ({ ...r, point: r.point.slice() })),
        trees: treeRecords.map(r => ({ ...r })),
        seed: root.seed
      };
    },
    histogram() {
      const d = R.distribution(presets[state.distribution]),
        s = root.stream('inspector');
      return Array.from({ length: 768 }, (_, i) => s.at(i, d));
    },
    scatter() {
      const d = R.correlated({
          channels: [
            { name: 'x', distribution: { type: 'normal' } },
            { name: 'y', distribution: { type: 'normal' } }
          ],
          correlation: [
            [1, state.correlation],
            [state.correlation, 1]
          ]
        }),
        s = root.stream('correlation-inspector');
      return Array.from({ length: 128 }, (_, i) => s.sample(i, d));
    }
  };
}
if (typeof module !== 'undefined') module.exports = randomnessScene;
