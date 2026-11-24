/* Harbor signal house with slate shingles and an amber lens. Both materials share a dither policy. */
const palette = ['#263747', '#536b84', '#b35b35', '#f6a74b'];
const pairs = [{ colors: palette.slice(0, 2), lightness: [.38, .44] }];

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'harbor-signal', name: 'Harbor signal', seed: 12,
  build(seed, { controls } = {}) {
    const mode = controls?.mode ?? 'authorized';
    if (!['open', 'authorized', 'outside-range'].includes(mode))
      throw new RangeError('Choose open, authorized or outside-range dithering');
    const B = makeBuilder(seed, [
      0x16222d, 0x24333b, 0x385158, 0x557073, 0x7b9186,
      0x392f32, 0x624a3d, 0x926c50, 0xb99767, 0xe2bb7d,
      0x313e48, 0x465863, 0x65737c, 0x889091, 0xadb0a3,
      0x384c60, 0x253342, 0xce7a3e, 0xeed79a, 0x42626c, 0x789291
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { sun: K.V.norm([-.46, .86, .40]), amb: .26, sky: .12, sunK: .72 });
    const stone = { r: [10, 11, 12, 13, 14] }, darkStone = { r: [0, 1, 10, 11] };
    const bronze = { r: [5, 6, 7, 8, 9] }, trim = { r: [0, 1, 5, 6, 7] };
    const slate = { r: [15], em: true, materialId: 'slate' }, cap = { r: [16, 10, 11] };
    const lens = { r: [17], em: true, materialId: 'lens' };
    const wick = { r: [18], em: true };
    const box = (p, h, material, res = .045) => S.box(p, h, material, { res, rd: res * .5 });
    const tube = (a, b, r, material) => S.tube([a, b], r, r, material, { res: Math.max(.021, r * .63) });

    box([0, -.13, 0], [2.62, .13, 1.17], darkStone, .10);
    box([0, .008, .055], [2.66, .06, 1.20], stone, .081);
    for (let i = 0; i < 12; i++) {
      const x = (i - 5.5) * .437;
      box([x, -.017, 1.231], [.211, .073, .033], i % 4 === 0 ? darkStone : stone, .055);
    }
    for (const [x, z] of [[-2.24, .93], [-2.24, -.77], [2.22, .96], [2.22, -.78]]) {
      box([x, .27, z], [.059, .22, .059], trim, .034);
      S.ball([x, .515, z], .082, bronze, { res: .027 });
      tube([x, .37, z], [x, .37, z > 0 ? -.77 : .93], .028, trim);
    }
    box([0, .45, 0], [1.73, .39, .84], stone, .07);
    for (let row = 0; row < 3; row++) for (let i = -4; i <= 4; i++) {
      const x = i * .38 + (row - 1) * .053;
      box([x, .206 + row * .238, .853], [.181, .105, .027], (i + row) % 5 === 0 ? darkStone : stone);
    }
    box([0, .835, .025], [1.80, .091, .916], trim, .064);
    box([0, .927, .026], [1.75, .043, .867], bronze, .050);
    box([0, 1.21, -.12], [1.53, .29, .64], trim, .063);
    box([0, 1.23, .567], [1.48, .243, .059], lens, .030);
    for (const x of [-1.54, -.75, 0, .75, 1.54]) box([x, 1.23, .65], [.039, .292, .047], bronze, .024);
    for (const y of [1.005, 1.459]) box([0, y, .65], [1.56, .029, .043], bronze, .030);
    for (const x of [-1.12, -.38, .37, 1.11]) box([x, 1.21, .648], [.065, .127, .010], wick, .023);

    const theta = Math.atan(.65), c = Math.cos(theta), s = Math.sin(theta);
    for (const side of [-1, 1]) {
      const ax = [[1, 0, 0], [0, c, side * s], [0, -s, side * c]];
      S.box([0, 1.81, side * .487], [1.94, .073, .614], cap, { ax, res: .062, rd: .017 });
      for (let row = 0; row < 4; row++) {
        const z = .162 + row * .254, y = 2.197 - z * .65 + row * .007;
        const edge = 1.956 + row * .012;
        for (let i = 0; i < 9; i++) {
          const x = -edge + (i + .5) * 2 * edge / 9;
          const width = edge / 9 - .012;
          S.box([x, y + .007 * Math.sin(i + 2 * row), side * z], [width, .028, .142],
            slate, { ax, res: .038, rd: .012 });
        }
      }
    }
    tube([-1.99, 2.18, 0], [1.99, 2.18, 0], .063, cap);
    for (const x of [-1.97, 1.97]) S.ball([x, 2.19, 0], .083, bronze, { res: .03 });
    tube([.90, 2.16, 0], [.90, 2.62, 0], .029, trim);
    box([1.04, 2.556, 0], [.137, .047, .019], bronze, .022);

    box([-2.12, .18, .31], [.19, .132, .18], { r: [1, 2, 3, 4] }, .037);
    box([2.12, .15, .13], [.224, .093, .194], { r: [1, 2, 3, 4] }, .034);
    S.bake();

    const dither = { pattern: 'bayer', strength: 1 };
    if (mode === 'authorized') dither.pairs = pairs;
    if (mode === 'outside-range') dither.pairs = [{ ...pairs[0], lightness: [.62, .70] }];
    return B.finish({
      cam: { target: [0, 1.04, .04], dist: 6.64, pitch: .33, yaw: .24, sway: 0 },
      radius: 7, detail: 34, dither: 0,
      skyEnvironment: { defaults: { zenith: '#233c4d', horizon: '#6c8c8e', ground: '#304754', sunStrength: 0 } },
      look: { splatCoverage: 'continuous',
        paletteConstraints: { targets: ['slate', 'lens'].map(material => ({ material, palette, dither })) } }
    });
  }
});
