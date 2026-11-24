module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'selective-edge-filter',
  name: 'Harbor signal watch',
  seed: 43,
  build(seed) {
    const B = makeBuilder(seed, [
      0x526773, 0x364957, 0x2b3646, 0x617580, 0x74858b, 0x83949a,
      0xbab8a6, 0xa39b87, 0x918670, 0x7e705d, 0xccc4a9, 0xe6d3a5,
      0x533b47, 0x83454c, 0xb26458, 0xd48466, 0xfbc79a, 0xf9e5ae,
      0x3c4750, 0x54606a, 0x6d7980, 0x9a9c91, 0x626873, 0xb7c5bc
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { amb: .46, sky: .12, sunK: .5, sun: K.V.norm([-.45, .72, .62]) });
    const stone = { r: [1, 18, 19, 20, 21] }, red = { r: [12, 13, 14, 15] };
    const dark = { r: [2, 18, 19] }, brass = { r: [8, 9, 10, 11] };
    const box = (at, half, mat, objectId, res = .12) => S.box(at, half, mat, { res, rd: .025, objectId });
    box([0, -.78, 0], [3.38, .22, .96], stone, 'quay');
    box([0, -.51, .03], [3.40, .06, .98], stone, 'quay');
    for (let x = -3; x <= 3; x += 1)
      box([x, -.84, .96], [.036, .15, .022], dark, 'quay');
    box([-2.87, .47, -.39], [.085, .95, .071], dark, 'signal-post', .075);
    box([2.88, .38, -.51], [.09, .86, .065], dark, 'signal-post', .075);
    for (const x of [-1.64, -1.27]) {
      box([x, -.33, .28], [.10, .13, .095], dark, 'watchkeeper', .061);
      box([x, -.40, .36], [.115, .057, .14], dark, 'watchkeeper', .061);
    }
    box([-1.45, .02, .26], [.29, .28, .155], red, 'watchkeeper', .063);
    box([-1.71, .09, .25], [.092, .21, .10], red, 'watchkeeper', .057);
    box([-1.16, .07, .30], [.086, .20, .09], red, 'watchkeeper', .057);
    box([-1.44, .38, .26], [.142, .135, .132], { r: [8, 15, 16] }, 'watchkeeper', .059);
    box([-1.44, .53, .26], [.195, .053, .146], dark, 'watchkeeper', .056);
    box([-1.44, .59, .23], [.155, .079, .133], red, 'watchkeeper', .058);
    box([.15, -.15, .37], [.26, .29, .23], dark, 'signal-lamp', .09);
    box([.15, .15, .38], [.275, .045, .24], brass, 'signal-lamp', .08);
    box([.15, .28, .38], [.154, .095, .142], { r: [10, 11, 17], em: true }, 'signal-lamp', .073);
    box([.15, .42, .38], [.223, .052, .188], brass, 'signal-lamp', .08);
    S.bake();

    function wires(object, material, paths, thickness, color) {
      const first = B.count();
      for (const path of paths) for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], delta = K.V.sub(b, a);
        const position = a.map((n, k) => (n + b[k]) / 2);
        B.axial(...position, K.V.norm(delta), Math.hypot(...delta) * .44, thickness, B.P[color], 1.3);
      }
      B.describeSplats(first, B.count(), { object, material });
    }
    const catenary = Array.from({ length: 34 }, (_, i) => {
      const t = i / 33;
      return [-2.87 + 5.75 * t, 1.4 - .18 * t - .42 * 4 * t * (1 - t), -.40 - .1 * t];
    });
    wires('signal-rope', 'hemp', [catenary, [[-.62, .94, -.46], [.12, .47, .34]]], .018, 11);
    const rail = y => [[.67, y, -.70], [1.19, y - .03, -.75], [1.71, y - .06, -.80],
      [2.23, y - .09, -.85], [2.75, y - .12, -.90], [3.27, y - .15, -.95]];
    const pillars = rail(.35).map(([x, y, z]) => [[x, y, z], [x, -.45, z]]);
    const braces = rail(.25).slice(0, -1).map(([x, y, z]) => [[x + .04, -.25, z], [x + .49, y, z - .04]]);
    wires('rear-guardrail', 'iron', [rail(.32), rail(.06), ...pillars, ...braces], .017, 2);
    return B.finish({
      cam: { target: [0, .16, 0], dist: 7.3, pitch: .14, yaw: .12, ortho: true, sway: 0 },
      radius: 6, dither: 0, look: { edgeFilter: { rules: [
        { select: { object: 'watchkeeper' }, strength: 0 },
        { select: { material: 'hemp' } },
        { select: { object: 'rear-guardrail' } }
      ] } }
    });
  }
});
