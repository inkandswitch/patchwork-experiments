module.exports = ({ KIT: K, makeBuilder, makeSculpt, ColorCurves }) => ({
  id: 'thermal-station',
  name: 'Thermal station',
  seed: 57,
  build(seed) {
    const W = K.world;
    const run = W.runtime.create({ systems: { spring: { kind: 'thermal-spring' } } }, { implementations: {
      'thermal-spring': () => ({
        initial: () => null,
        fields: { temperature: { type: 'number', units: '°C', read: ({ target }) => {
          if (!target.point) return W.query.missing('point required');
          const [x, , z] = target.point;
          const front = x + .36 * Math.sin(z * 5 + x * .9) + .12 * Math.sin(x * 4 - z * 3);
          return W.query.ok(14 + 79 * K.clamp((front + 2.55) / 5.1, 0, 1));
        } } }
      })
    } });
    const palette = [
      0x0b111a, 0x202b38, 0x3a4b5b, 0x586776, 0x818e91, 0xb4b8a9, 0xe0d9bd,
      0x173041, 0x2b4858, 0x3d6676, 0x6e9ba0, 0xb2d5cd,
      0x261c34, 0x442b4f, 0x784764, 0xbb716e, 0xe5aa7c,
      0x26372e, 0x42503a, 0x697245, 0xa5a35f, 0xf4cb77, 0xffefd2
    ];
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.sun = B.norm([-.65, .82, .4]);
    S.amb = .22;
    S.sky = .20;
    const stops = [[14, '#17364c'], [27, '#235372'], [42, '#338c99'], [55, '#60b4a7'],
      [65, '#baa95b'], [73, '#e78b50'], [82, '#f8b86b'], [93, '#ffefd2']];
    function basin(interpolation) {
      const ramp = { stops, interpolation };
      const sample = ColorCurves.ramp(ramp);
      const outputPalette = interpolation === 'step' ? stops.map(row => row[1]) :
        Array.from({ length: 31 }, (_, i) => sample(14 + 79 * i / 30));
      return K.surface.material({ r: [7, 8, 9, 10, 11] }, { layers: {
        thermometer: { type: 'colorCurve', source: { field: 'spring/temperature' },
          ramp, outputPalette, strength: .94 }
      } });
    }
    const painted = K.surface.material({ r: [1, 2, 3, 4, 5, 6] }, { layers: {
      enamel: { type: 'colorCurve', outputPalette: [12, 13, 14, 15, 16, 22], channels: {
        red: { interpolation: 'smooth', stops: [[0, .04], [.28, .48], [.67, .77], [1, 1]] },
        green: { stops: [[0, 0], [.55, .31], [1, .83]] },
        blue: { stops: [[0, .06], [.65, .46], [1, .8]] }
      } }
    } });
    const ground = { r: [1, 2, 3, 4, 5], mod: (x, y, z) => (B.n3(x * 2.1, y * 3, z * 2.1) - .5) * .38 };
    const concrete = { r: [2, 3, 4, 5, 6] }, grate = { r: [1, 2, 3, 4] };
    const light = { r: [21, 22], em: true };
    function box(at, half, mat, rd = .05, res = .058) { S.box(at, half, mat, { res, rd }); }
    box([0, -.21, 0], [3.45, .48, 2.22], ground, .29, .075);
    box([0, .13, 0], [3.22, .15, 2.01], concrete, .21, .066);

    const pools = [[-.71, 'smooth'], [.86, 'step']];
    for (const [z, mode] of pools) {
      box([-.21, .30, z], [2.57, .11, .58], grate, .15);
      box([-.21, .43, z], [2.48, .102, .49], basin(mode), .128, .046);
      for (const side of [-1, 1]) {
        box([-.22, .43, z + side * .57], [2.46, .11, .056], concrete, .04, .048);
        box([-.22 + side * 2.5, .43, z], [.062, .11, .49], concrete, .044, .05);
      }
    }
    for (let i = -4; i <= 4; i++) box([i * .54, .35, .04], [.248, .07, .145], grate, .025, .05);
    box([0, .39, 1.68], [2.42, .065, .12], concrete, .05);
    for (const x of [-2.48, -.8, .87, 2.52]) {
      box([x, .47, 1.74], [.06, .15, .07], grate, .016, .04);
      box([x, .61, 1.74], [.077, .034, .074], concrete, .016, .04);
    }
    S.tube([[-2.48, .62, 1.74], [2.52, .62, 1.74]], .036, .036, grate, { res: .038 });

    box([2.81, .46, .02], [.39, .26, 1.46], concrete, .13);
    for (const z of [-.71, .86]) {
      box([2.76, .73, z], [.35, .47, .29], painted, .115, .044);
      box([2.75, 1.19, z], [.35, .075, .30], grate, .05, .045);
      box([2.75, 1.27, z], [.25, .038, .15], light, .055, .038);
      S.tube([[2.73, .84, z], [2.40, .84, z], [2.23, .66, z]], .11, .095, painted, { res: .04 });
      for (const x of [2.18, 2.39]) box([x, .61, z], [.061, .12, .17], grate, .022, .041);
    }
    box([-2.83, .56, .01], [.20, .34, .31], painted, .09, .045);
    box([-2.85, .89, .08], [.20, .059, .24], concrete, .035, .046);
    box([-2.84, .937, .11], [.09, .02, .08], light, .02, .034);
    for (const [x, z, r] of [[-2.69, -1.62, .42], [-1.94, -1.73, .25], [-.37, -1.71, .22], [1.05, -1.63, .35],
      [-2.79, 1.51, .29], [2.83, 1.67, .22], [3.03, -1.64, .22]])
      S.rock([x, .27, z], [r, r * .68, r * .74], { r: [17, 18, 19, 20] }, { res: .049 });
    S.bake();

    const query = run.query();
    return B.finish({
      cam: { target: [0, .37, .05], dist: 10.9, pitch: .83, yaw: .34, sway: 0 },
      look: { pixel: true, pixelSize: 3 },
      detail: 20, radius: 8, dither: .30, outline: { c: 0, edge: .08 },
      query: () => query,
      surfaceEffects: { query }
    });
  }
});
