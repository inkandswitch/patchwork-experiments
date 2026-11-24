module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'woodland-courier',
  name: 'Woodland courier',
  seed: 74,
  build(seed) {
    const colors = [
      0x101722, 0x222b32, 0x374149, 0x596265, 0x808583, 0xa2a7a0, 0xd6d0b9,
      0x302d26, 0x4c4431, 0x6b5b38, 0x887749, 0xa6965c, 0xc5b57e,
      0x262d1c, 0x3b482d, 0x565b34, 0x737b42, 0x93994e, 0xa7ad59, 0xc0c473,
      0x3c302f, 0x604c43, 0x8c6c58, 0xaf9274, 0xd1af8b, 0xe3c6a0, 0xf4dfb6, 0xff654e, 0xffdeb0
    ];
    const B = makeBuilder(seed, colors), S = K.sculpt(makeSculpt(B));
    S.sun = B.norm([-.54, .82, .44]);
    S.amb = .22;
    S.sky = .19;
    const rock = { r: [1, 2, 3, 4, 5, 6] };
    const soil = { r: [7, 8, 9, 10, 11] };
    const bark = { r: [7, 8, 9, 10, 11, 12] };
    const leaves = { r: [13, 14, 15, 16, 17, 18, 19], materialId: 'foliage',
      mod: (x, y, z) => .32 * (B.n3(x * 7, y * 8, z * 7) - .5) };
    const ceramic = { r: [20, 21, 22, 23, 24, 25, 26], materialId: 'ceramic' };
    const shell = { r: [20, 21, 22, 23, 24, 25, 26], materialId: 'shell' };
    const eye = { r: [27], materialId: 'status', em: true };
    const box = (at, half, mat, options = {}) => S.box(at, half, mat, { rd: .06, res: .055, ...options });
    const part = (at, half, mat, options = {}) => box(at, half, mat, { objectId: 'courier', ...options });
    const almond = (at, r, mat, options = {}) => S.ball(at, r, mat, { res: .051, ...options });
    box([0, -.3, 0], [2.83, .31, 1.94], rock, { rd: .25, res: .081 });
    box([0, -.04, 0], [2.8, .23, 1.91], soil, { rd: .22, res: .075 });
    box([0, .12, 0], [2.68, .12, 1.81], leaves, { rd: .18, res: .072 });
    for (let i = 0; i < 6; i++) {
      const z = 1.62 - i * .46, x = .35 + Math.sin(i * .55) * .32;
      box([x, .24, z], [.66 - i * .028, .043, .18], rock, { rd: .047, res: .041 });
    }
    for (const [x, z, size] of [[-2.06, -.57, .84], [1.95, -1.02, .74], [-1.73, 1.03, .50], [2.04, .83, .38]]) {
      const tall = size > .7, stem = tall ? 1.23 : .38;
      if (tall) S.tube([[x, .24, z], [x + .12, .86, z - .02], [x + .19, 1.49, z]], .14, .06, bark, { res: .045 });
      for (const [dx, dy, dz, scale] of [[0, 0, 0, 1], [-.53, -.16, .13, .66], [.49, -.21, .23, .60], [.14, .42, -.12, .75]]) {
        const r = size * scale;
        S.rock([x + dx * size, stem + .32 + dy * size, z + dz * size], [r, r * .64, r * .76], leaves, { res: .052 });
      }
    }
    for (const [x, z, r] of [[-2.11, 1.31, .26], [-1.23, .72, .25], [1.64, 1.41, .23], [1.72, -.16, .21], [-.75, -1.44, .31]]) {
      S.rock([x, .26, z], [r, .55 * r, .73 * r], rock, { res: .048 });
      for (let i = -1; i <= 1; i++) almond([x + i * .09, .31 + .02 * i, z + r * .64], [.052, .12, .045], leaves);
    }
    const x = .43, z = .08;
    part([x, .89, z], [.51, .46, .34], shell, { rd: .16, res: .045 });
    part([x, 1.57, z + .02], [.57, .28, .36], ceramic, { rd: .135, res: .044 });
    part([x, 1.53, z + .373], [.408, .13, .033], rock, { rd: .082, res: .028 });
    const face = { objectId: 'courier', res: .026 };
    for (const side of [-1, 1]) {
      almond([x + side * .173, 1.55, z + .409], [.074, .051, .018], eye, face);
      part([x + side * .324, .46, z + .063], [.213, .155, .274], ceramic, { rd: .095, res: .038 });
      S.tube([[x + side * .45, 1.10, z], [x + side * .66, .97, z + .05], [x + side * .72, .78, z + .18]],
        .09, .075, rock, { objectId: 'courier', res: .037 });
      almond([x + side * .72, .735, z + .202], [.107, .111, .09], ceramic, face);
    }
    part([x, .91, z + .338], [.212, .106, .035], ceramic, { rd: .04, res: .034 });
    part([x, .895, z + .372], [.107, .018, .016], eye, { rd: .012, res: .026 });
    S.tube([[x - .29, 1.81, z - .04], [x - .38, 2.02, z - .07]], .029, .023, rock, { res: .024 });
    almond([x - .39, 2.046, z - .07], .061, eye, face);
    S.bake();

    return B.finish({
      cam: { target: [0, .55, 0], dist: 9.3, pitch: .58, yaw: .38, sway: 0 },
      radius: 7, detail: 23, dither: .32, outline: { c: 0, edge: .11 },
      paletteRoles: { status: [27] },
      look: { pixelSize: 3, paletteConstraints: { targets: [
        { material: 'foliage', palette: ['#152a2a', '#234839', '#356449', '#4c8054', '#71a260', '#a0bf77'],
          dither: { pattern: 'blue-noise', strength: .85, seed: 74 } },
        { object: 'courier', material: 'shell', palette: ['#202039', '#323459', '#484b7b', '#6964a5', '#9890bc'],
          dither: { pattern: 'bayer', strength: .95 } },
        { object: 'courier', material: 'ceramic', palette: ['#462c39', '#744156', '#bd635d', '#dd8b6e', '#f3b987'] },
        { object: 'courier', material: 'status', palette: ['#9c343a', '#d84a43'], reserved: ['status'] }
      ] } }
    });
  }
});
