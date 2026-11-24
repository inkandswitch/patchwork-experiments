module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'splat-surface-coverage',
  name: 'The sandstone gate',
  seed: 47,
  build(seed) {
    const B = makeBuilder(seed, [
      0x192d40, 0x3b3a43, 0x63504d, 0x906753, 0xbd8c69, 0xd4a77c, 0xf0c99a,
      0x27393e, 0x3e5860, 0x628886, 0x91a99b, 0xc4caaf,
      0x3d695c, 0x4d8068, 0x77a079, 0xb1bc85,
      0x504c62, 0x74667b, 0x99849a, 0xabbcc9, 0xcbdbe0
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: .3, sky: .20, sun: K.V.norm([-.53, .72, .53]) });
    const stone = { r: [1, 2, 3, 4, 5, 6], a: 1.35, fat: .40 };
    const floor = { r: [1, 2, 3, 4], a: 1.45, fat: .40 };
    const bronze = { r: [7, 8, 9, 10, 11], a: 1.35, fat: .41 };
    const shrubs = { r: [7, 12, 13, 14, 15], a: 1.2, fat: .42 };
    S.box([0, -.32, .06], [3.38, .21, 1.87], stone, { rd: .11, res: .19 });
    for (let z = 0; z < 6; z++) for (let x = 0; x < 12; x++) {
      S.box([(x - 5.5) * .55, -.063, (z - 2.5) * .55], [.268, .09, .263],
        (x + 2 * z) % 5 ? floor : stone, { rd: .028, res: .141 });
    }
    for (const x of [-1.42, 1.42]) {
      S.box([x, .17, -.63], [.49, .19, .49], stone, { rd: .08, res: .12 });
      S.lathe([x, .35, -.63], 2.03, [.345, .281], stone, { res: .143 });
      S.box([x, 2.33, -.63], [.43, .17, .47], stone, { rd: .076, res: .124 });
    }
    S.box([0, 2.59, -.63], [1.99, .17, .44], stone, { rd: .081, res: .157 });
    S.box([0, 2.83, -.65], [2.10, .09, .52], stone, { rd: .048, res: .148 });
    S.box([0, 2.12, -.66], [.37, .11, .4], bronze, { rd: .055, res: .095 });
    S.lathe([-2.29, .11, .48], .49, [.40, .31], stone, { res: .107 });
    S.ball([-2.29, .91, .48], [.34, .46, .26], bronze, { res: .105 });
    S.ball([-2.29, .93, .69], [.092, .13, .09], bronze, { res: .071 });
    S.lathe([-2.29, 1.22, .48], .14, [.31, .22], bronze, { res: .092 });
    for (const [x, z, scale] of [[2.51, .24, 1], [2.85, -.25, .76], [-2.94, -.65, .85]])
      S.rock([x, .24, z], [.46 * scale, .33 * scale, .45 * scale], shrubs, { res: .111 });
    S.bake();

    // A narrow ribbon painted in space retains its translucent brush edges.
    for (let i = 0; i < 17; i++) {
      const step = i / 16;
      B.disc(-.70 + 1.55 * step, .23 + .29 * Math.sin(step * Math.PI), .40 + .40 * step,
        [0, .46, 1], .18, .042, B.P[i % 3 ? 19 : 20], .22, { nd: true });
    }
    return B.finish({
      cam: { target: [0, 1.18, -.12], dist: 9.9, pitch: .28, yaw: -.14, sway: 0 },
      look: { splatCoverage: 'continuous' }, dither: 0, radius: 8, detail: 25
    });
  }
});
