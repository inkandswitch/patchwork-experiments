module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'wet-spillway',
  name: 'Wet spillway',
  seed: 28,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101a25, 0x202b34, 0x38434b, 0x525c61, 0x737a75, 0x92948a, 0xb2b0a0, 0xd2c8ad,
      0x142d36, 0x193b46, 0x275660, 0x36747a, 0x65a5a0, 0x90c8b4,
      0x292f25, 0x424d36, 0x5f6642, 0x7a8050, 0x989d5c,
      0x3f312a, 0x624434, 0x9e6e42, 0xe3ac5e, 0xffd080, 0xffefcf
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = B.norm([-.57, .78, .39]);
    S.amb = .19;
    S.sky = .22;
    const base = { r: [1, 2, 3, 4, 5] };
    const stone = { r: [3, 4, 5, 6, 7], materialId: 'granite',
      mod: (x, y, z) => (B.n3(x * 6, y * 4, z * 6) - .5) * .35 };
    const gravel = { r: [2, 3, 4, 5, 6] }, moss = { r: [14, 15, 16, 17, 18] };
    const water = { r: [8, 9, 10, 11, 12], mod: (x, y, z) => (B.n3(x * 11, y, z * 4) - .5) * .48 };
    const iron = { r: [1, 2, 3, 4] }, brass = { r: [19, 20, 21, 22] };
    const lamp = { r: [23, 24], em: true }, target = { surface: 'spillway-wall' };
    const box = (p, h, mat, options = {}) => S.box(p, h, mat, { rd: .08, res: .066, ...options });
    const wall = (p, h, options = {}) => box(p, h, stone, { target, ...options });
    box([0, -.25, .12], [3.38, .35, 2.03], base, { rd: .28, res: .089 });
    box([0, .112, .15], [3.23, .076, 1.87], gravel, { rd: .14 });
    box([.22, .204, .84], [2.66, .045, 1.02], water, { rd: .20, res: .048 });
    for (const [x, z, size] of [[-2.71, .85, .37], [-2.69, 1.5, .26], [-1.99, 1.57, .32], [-1.29, 1.69, .21],
      [1.78, 1.67, .27], [2.39, 1.4, .32], [2.63, .87, .36], [2.69, .43, .27]]) {
      S.rock([x, .235, z], [size, .56 * size, .73 * size], gravel, { res: .049 });
    }
    for (let row = 0; row < 4; row++) {
      const y = .39 + row * .37;
      const starts = row % 2 ? [-2.84, -1.98, -1.12, .98, 1.84, 2.70] : [-2.74, -1.86, -1.00, 1.08, 1.94, 2.80];
      for (const x of starts) wall([x, y, -.53], [.45, .176, .49], { rd: .063 });
    }
    K.build.arch(S, [0, .20, -.49], { span: 1.04, height: 1.57, depth: 1.10, thick: .24,
      block: .23, res: .051, mats: { stone }, target });
    wall([0, 1.65, -.53], [3.20, .15, .50], { rd: .063 });
    for (let i = -4; i <= 4; i++) wall([i * .70, 1.87, -.53], [.35, .11, .57], { rd: .065 });
    box([0, .44, -.63], [.49, .23, .09], iron, { rd: .02, res: .044 });
    for (let i = -2; i <= 2; i++) box([i * .18, .68, -.09], [.025, .42, .034], iron, { rd: .015, res: .033 });
    box([0, 1.05, -.06], [.48, .046, .047], brass, { rd: .02, res: .036 });
    for (const x of [-2.83, 2.83]) {
      box([x, 1.10, .02], [.15, .095, .10], iron, { res: .042 });
      box([x, 1.26, .10], [.123, .116, .11], lamp, { rd: .046, res: .039 });
      box([x, 1.40, .10], [.157, .037, .14], brass, { rd: .025, res: .041 });
    }
    for (const [x, z, r] of [[-2.77, -.61, .25], [-2.48, -.77, .16], [-2.9, .54, .19], [2.94, .5, .24], [2.6, -.9, .22]]) {
      S.rock([x, z < 0 ? 1.97 : .20, z], [r, .62 * r, .78 * r], moss, { res: .048 });
    }
    for (let i = 0; i < 9; i++) {
      const z = .45 + i * .14, x = Math.sin(i * .81) * .24;
      box([x, .25, z], [.23 - i * .014, .012, .021], { r: [11, 12, 13] }, { rd: .012, res: .043 });
    }
    S.bake();
    const run = K.world.runtime.create({ systems: { runoff: { kind: 'capillary-field' } } }, { implementations: {
      'capillary-field': () => ({
        initial: () => null,
        fields: { wetness: { type: 'number', units: 'fraction', read: ({ target: sample }) => {
          if (!sample.point) return K.world.query.missing('point required');
          const [x, y, z] = sample.point;
          const rise = .98 + .12 * Math.cos(x * 1.4) + .13 * B.n3(x * 2.8, y * 2, z * 3.9);
          return K.world.query.ok(K.clamp((rise - y) / .70, 0, 1));
        } } }
      })
    } });
    const query = run.query();
    const pack = { format: 'ink-studio/asset-pack', version: 1, id: 'spillway', revision: 1, title: 'Spillway finishes', looks: [{
      id: 'spillway/damp-stone', label: 'Damp stone', stack: { name: 'Damp stone', steps: [
        { type: 'exposure', stops: -1.15 },
        { type: 'channelMix', matrix: [[.62, .04, 0], [.01, .86, .08], [0, .09, 1.04]] }
      ] }, mask: { type: 'query', field: 'runoff/wetness', space: 'world', range: [.02, .90] }
    }] };
    const catalog = K.authoring.assetPacks.create({ packs: [pack] });
    const look = K.authoring.looks.scene({ pixelSize: 3, targets: [{ select: { surface: 'spillway-wall' },
      asset: { asset: 'spillway/damp-stone', revision: 1 } }] }, catalog);
    return B.finish({
      cam: { target: [0, .75, .12], dist: 10.7, pitch: .49, yaw: .28, sway: 0 },
      look, radius: 8, detail: 20, dither: .26, outline: { c: 0, edge: .11 },
      surfaceEffects: { query }, query: () => query
    });
  }
});
