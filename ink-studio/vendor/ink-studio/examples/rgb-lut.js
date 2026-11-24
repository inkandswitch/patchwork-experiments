module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'signal-vault',
  name: 'Signal vault',
  seed: 91,
  build(seed) {
    const palette = [
      0x0d1018, 0x22282e, 0x343b42, 0x525b62, 0x7b8483, 0xb5b6a7, 0xe2daca,
      0x141f45, 0x2033c8, 0x2a4be4, 0x5689f9, 0x8cbaff,
      0x331f07, 0x7a3314, 0x874b2a, 0xa5895b, 0xc3ba91,
      0x283d35, 0x3c5c42, 0x748457, 0xa2a96a, 0xf8c871, 0xffedd0
    ];
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    S.sun = B.norm([-.66, .79, .47]);
    S.amb = .19;
    S.sky = .17;
    const base = { r: [1, 2, 3, 4], mod: (x, y, z) => (B.n3(x * 2.5, y * 4, z * 2.5) - .5) * .23 };
    const steel = { r: [1, 2, 3, 4, 5] }, trim = { r: [2, 3, 4, 5, 6] };
    const light = { r: [21, 22], em: true };
    const leaf = { r: [17, 18, 19, 20] };
    const box = (at, half, material, rd = .045, res = .052) => S.box(at, half, material, { rd, res });
    const pipe = (pts, r, material = steel) => S.tube(pts, r, r, material, { res: .037 });
    box([0, -.18, 0], [2.85, .29, 1.68], base, .24, .074);
    box([0, .12, 0], [2.69, .12, 1.54], trim, .20, .067);
    box([0, .27, -.09], [2.18, .08, 1.01], steel, .11, .055);
    const units = [[-1.07, { r: [7, 8, 9, 10, 11] }], [1.07, { r: [12, 13, 14, 15, 16] }]];
    for (const [x, paint] of units) {
      box([x, .42, -.08], [.81, .11, .84], trim, .10);
      box([x, 1.03, -.13], [.73, .65, .64], paint, .15, .048);
      box([x, 1.62, -.13], [.76, .12, .67], paint, .085, .048);
      box([x, 1.42, .535], [.44, .13, .064], steel, .065, .040);
      box([x - .13, 1.45, .603], [.155, .024, .018], light, .02, .030);
      box([x + .22, 1.45, .602], [.056, .024, .019], trim, .02, .033);
      box([x, .91, .543], [.41, .42, .073], steel, .115, .042);
      S.torus([x, .93, .635], .30, .055, paint, { ax: B.frame(Math.PI / 2, 0, 0), res: .037 });
      S.ball([x, .93, .63], [.244, .243, .067], paint, { res: .042 });
      box([x, .93, .702], [.071, .071, .035], trim, .036, .035);
      for (const side of [-1, 1]) {
        box([x + side * .48, .57, .51], [.094, .092, .087], trim, .031, .039);
        box([x + side * .56, 1.68, -.30], [.075, .08, .16], steel, .038, .045);
      }
      pipe([[x + .50, 1.69, -.43], [x + .50, 1.84, -.43], [x + .50, 1.84, -1.01], [x + .50, .45, -1.01]], .073);
    }
    pipe([[-1.79, .45, -.99], [1.96, .45, -.99]], .086);
    box([0, .47, .87], [.17, .21, .19], trim, .046);
    box([0, .691, .9], [.102, .022, .103], light, .031, .036);
    for (let i = -3; i <= 3; i++)
      box([i * .29, .283, 1.23], [.10, .036, .10], steel, .025, .043);
    for (const [x, z, r] of [[-2.29, .89, .26], [-2.34, -.72, .29], [2.28, -.95, .30], [2.26, .94, .19]])
      S.rock([x, .23, z], [r, r * .64, r * .90], leaf, { res: .045 });
    S.bake();
    return B.finish({
      cam: { target: [0, .56, 0], dist: 8.6, pitch: .5, yaw: .36, sway: 0 },
      look: { pixelSize: 3, paletteRemap: { rules: [], protect: [0, 21, 22] } },
      radius: 7, detail: 18, dither: .26, outline: { c: 0, edge: .10 }
    });
  }
});
