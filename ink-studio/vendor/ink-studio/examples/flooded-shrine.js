module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'flooded-shrine',
  name: 'Flooded shrine',
  seed: 19,
  build(seed, { controls, snapshot } = {}) {
    const P = K.procedural, shrine = P.floodedShrine.create({ seed, controls, snapshot });
    if (snapshot && controls) shrine.setControls(controls);
    const { waterline, age } = shrine.describe().controls;
    const B = makeBuilder(seed, [
      0x111722, 0x202630, 0x323842, 0x525558, 0x78756a, 0xa2967b,
      0x263443, 0x304e58, 0x3f6b6b, 0x72a4a0, 0x9dd9c0,
      0x312938, 0x553e51, 0x805562, 0xb37970,
      0x14382d, 0x325b3f, 0x5f8551, 0x9ca264,
      0x596ea3, 0x92b2bb, 0xd4f4d1, 0xffe3a9, 0xb27650
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.sun = K.V.norm([-1, 1.25, .65]);
    S.amb = .20;
    const stoneRamp = [1, 2, 3, 4, 5], wetRamp = [1, 6, 7, 8];
    const flood = y => Math.max(0, Math.min(1, (waterline + .32 - y) / .42));
    const material = P.graph.material({
      height: (u, v) => B.n3(u * 4, v * 4, 2) * .075,
      wetness: (u, v, time, { y = waterline } = {}) => flood(y),
      ink: (u, v) => B.n3(u * 13, 2, v * 13),
      palette: (u, v, time, { y = waterline } = {}) => flood(y) > .54 ? 'wet' : 'stone'
    });
    const stone = { r: stoneRamp, materialId: 'stone',
      rf: (x, y, z) => material.palette(x, z, 0, { y }) === 'wet' ? wetRamp : stoneRamp };
    const moss = { r: [15, 16, 17, 18], materialId: 'plant' };
    const roof = { r: [11, 12, 13, 14], materialId: 'roof' };
    const light = { r: [10, 20, 21], em: true, materialId: 'glow' };
    const hero = shrine.document.get('silhouette').parameters;
    for (const part of shrine.document.entities().filter(entity => entity.derived)) {
      const p = part.parameters;
      if (p.visible === false) continue;
      const tag = part.id;
      if (part.type === 'foundation' || part.type === 'step' || part.type === 'wall') {
        S.box(p.point, p.half, stone, { tag, res: part.type === 'foundation' ? .18 : .12,
          rd: .045 + (p.wear || 0) * .13, ax: B.frame(p.yaw || 0, 0, 0) });
      } else if (part.type === 'moss') {
        const wetness = material.wetness(p.point[0], p.point[2], 0, { y: p.point[1] + .19 });
        const growth = p.height * (.72 + .58 * wetness);
        S.ball(p.point, [growth * .56 + .04, growth * .26, growth * .44 + .05], moss, { tag, res: .10 });
      } else {
        for (let i = 0; i < 3; i++) {
          const at = [p.point[0] + (i - 1) * .055, p.point[1], p.point[2] + (i - 1) * .026];
          S.tube([at, [at[0] - .08, at[1] + p.height + i * .074, at[2]]],
            .024, .018, moss, { tag, res: .069 });
        }
      }
    }
    const [x, y, z] = hero.point, h = hero.height;
    S.box([x, y - .24, z], [1.44, .18, 1.03], stone, { tag: 'hero', res: .105, rd: .11 });
    for (const side of [-1, 1]) {
      S.box([x + side * .96, y + h * .35, z], [.20, h * .45, .22], stone,
        { tag: 'hero', res: .085, rd: .05 });
      S.box([x + side * 1.03, y + h * .59, z + .25], [.23, .11, .25], stone, { tag: 'hero', res: .07 });
      S.ball([x + side * 1.03, y + h * .67, z + .27], [.097, .127, .097], light, { tag: 'lamp-' + side, res: .056 });
    }
    const tiers = P.graph.repeat([], 3, (steps, { index }) => [...steps, [index, 1.4 - index * .24]], { seed });
    for (const [index, half] of tiers) S.box(
      [x, y + h * .83 + index * .17, z], [half, .09, .65 - index * .11], roof,
      { tag: 'hero', res: .074, rd: .042 }
    );
    S.ball([x, y + h * .64, z - .15], [.40, .63, .23], stone, { tag: 'hero', res: .074, rd: .045 });
    const map = { points: [
      [x, y + h * .38, z + .091], [x - .23, y + h * .56, z + .106],
      [x, y + h * .76, z + .081], [x + .23, y + h * .56, z + .105], [x, y + h * .58, z + .104]
    ], faces: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]] };
    const paths = P.geometry.meshPaths(map, { sources: [0], edgeCost: e => e.length * (e.a === 4 || e.b === 4 ? 5 : 1) });
    for (const { points } of paths.curves([2, 3]))
      S.tube(points, .040, .035, light, { tag: 'sigil', res: .043 });
    S.bake();
    const water = { r: [6, 7, 8, 9], a: .74, materialId: 'water', line: false,
      tex: (x, y, z) => 6 + Math.floor(3 * (.50 + .49 * Math.sin(x * 6 + 1.56 * Math.sin(z * 4)))) };
    S.box([0, waterline - .04, .04], [3.10, .027, 2.59], water,
      { tag: 'floodline', ghost: true, res: .16, rd: .024 });
    S.bake();
    const air = P.density.fromSdf({
      bounds: { min: [-3.1, waterline, -2.15], max: [3.1, waterline + .7, 2.31] },
      field: (x, y, z) => (Math.hypot(x / 3, (y - waterline - .19) / .33, z / 2.1) - 1) * .35,
      feather: .12, breakup: .65,
      noise: (x, y, z, time) => B.fbm(x * 2.6, y * 3.1 + time * .15, z * 2.2, 2) * flood(y)
    });
    return B.finish({
      cam: { target: [0, .74, -.03], dist: 11.7, yaw: -.22, pitch: .54 }, radius: 9,
      detail: 27, dither: .11,
      atmosphere: [K.atmosphere.field({ field: air, density: .18, color: '#34555e', step: .18 })],
      volumeQuality: { scale: 2, steps: 29 },
      look: { pixel: true, stable: { snap: true, protect: ['sigil', 'glow'] },
        ink: { depthGap: .18, litAt: .66, creaseCosine: .5,
          silhouette: { shadow: '#121b27', litSteps: 0 },
          crease: { shadow: '#283843', litSteps: 0 },
          materials: { plant: { crease: false }, roof: { ramp: [11, 12, 13, 14] } } },
        effects: { glow: { radius: 2, bands: 2, colors: ['#274449', '#588e80'], threshold: .43 } }
      },
      variant: shrine.describe(),
      shrineSnapshot: shrine.document.snapshot()
    });
  }
});
