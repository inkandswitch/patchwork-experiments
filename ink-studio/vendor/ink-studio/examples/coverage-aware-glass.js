module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'coverage-aware-glass', name: 'The lens workshop', seed: 23,
  build(seed, { controls } = {}) {
    const glass = controls?.glass ?? 'blue';
    if (!['clear', 'blue', 'rose'].includes(glass)) throw new RangeError('Choose clear, blue or rose glass');
    const B = makeBuilder(seed, [
      0x111a27, 0x202939, 0x384556, 0x5a6976, 0x798687, 0xa4a79b, 0xd3c6a4, 0xf0e0bb,
      0x315160, 0x517786, 0x83aab5, 0xb7d2d0, 0xffe5a5, 0xffffda
    ]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = B.norm([-.54, .74, .45]);
    S.sky = .22;
    const steel = { r: [1, 2, 3, 4], materialId: 'steel' };
    const concrete = { r: [2, 3, 4, 5, 6], mod: (x, y, z) => B.n3(x * 3, y * 4, z * 3) * .22 };
    const atlas = { r: [4, 5, 6, 7], materialId: 'enamel' };
    const bulb = { r: [12, 13], em: true };
    const box = (at, size, mat, extra) => S.box(at, size, mat, { res: .052, rd: .056, ...extra });
    box([0, -.14, -.12], [2.59, .23, 1.42], steel, { rd: .17, res: .072 });
    box([0, .10, -.12], [2.43, .075, 1.32], concrete, { rd: .13, res: .066 });
    box([0, .975, -.95], [2.13, .82, .08], steel);
    for (const x of [-1.7, -1.15, -.6, 0, .6, 1.15, 1.7]) box([x, 1.0, -.85], [.022, .76, .022], concrete, { rd: .02 });
    for (const x of [-2.02, 0, 2.02]) box([x, .99, .81], [.067, .87, .095], steel);
    for (const y of [.23, 1.78]) box([0, y, .81], [2.14, .065, .105], steel);
    for (const x of [-2.02, 2.02]) {
      box([x, 1.70, -.1], [.065, .065, .906], steel);
      box([x, .23, -.1], [.087, .065, .906], steel);
    }
    box([0, 1.79, -.93], [2.14, .067, .098], steel);
    for (const x of [-1.02, 1.02]) {
      const surface = x < 0 ? 'amber-instrument' : 'mint-instrument';
      box([x, .24, -.28], [.63, .085, .52], steel);
      box([x, .53, -.29], [.47, .22, .4], atlas, { target: { surface } });
      S.ball([x, .94, -.31], [.42, .61, .39], atlas, { res: .044, target: { surface } });
      box([x, .55, .12], [.27, .082, .045], steel);
      for (const dx of [-.14, 0, .14]) S.ball([x + dx, .55, .174], .036, bulb, { res: .022 });
      S.tube([[x, 1.43, -.31], [x, 1.54, -.31], [x + .29, 1.58, -.48]], .042, .042, concrete, { res: .035 });
    }
    for (const x of [-1.83, 1.83]) box([x, 1.52, -.71], [.09, .11, .081], bulb, { rd: .05 });
    S.bake();

    const first = B.count();
    for (const center of [-1.01, 1.01]) for (let row = 0; row < 10; row++) for (let column = 0; column < 13; column++) {
      const x = center + (column - 6) * .148, y = .35 + row * .149;
      const shine = Math.abs(y - .66 - (x - center) * .65) < .095;
      B.disc(x, y, .825, [0, 0, 1], .100, .017, shine ? B.P[11] : B.P[9],
        shine ? .085 : .14, { gl: true, nd: true });
    }
    B.describeSplats(first, B.count(), { object: 'glass', target: { surface: 'glass' } });

    const targets = [
      { select: { surface: 'amber-instrument' }, palette: ['#684135', '#a65934', '#d57b39', '#ed9e4e', '#ffc76f'] },
      { select: { surface: 'mint-instrument' }, palette: ['#174745', '#246f64', '#35a079', '#74c990', '#bbebac'] }
    ];
    if (glass !== 'clear') targets.push({ select: { surface: 'glass' },
      palette: glass === 'blue' ? ['#4588d6', '#77bdfa'] : ['#bc4c87', '#ec8aac'] });
    return B.finish({
      cam: { target: [0, .72, -.08], dist: 8.5, pitch: .225, yaw: .19 },
      radius: 6.4, detail: 20, refract: 12, outline: { c: 0, edge: .075 },
      look: { coverageAware: true, pixelSize: 2, paletteConstraints: { targets } }
    });
  }
});
