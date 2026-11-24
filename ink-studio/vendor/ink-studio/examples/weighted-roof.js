module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'weighted-roof',
  name: 'A pitched roof over an L-shaped hall',
  seed: 1,
  build(seed) {
    const B = makeBuilder(28, [
      0x1c272d, 0x394442, 0x525b51, 0x6d7160, 0x89896d, 0xa6a180,
      0x635247, 0x896e57, 0xac8d68, 0xc8a980, 0xe4c697,
      0x422f36, 0x683d43, 0x8b4f4b, 0xb36451, 0xcb8261, 0xdda079,
      0x3e403f, 0x625348, 0x8f7454, 0xc09a66, 0xe4bd7c,
      0x34545c, 0x508182, 0x7da7a0, 0xadc0b2,
      0x30493d, 0x4c6750, 0x6d8059
    ]), S = K.sculpt(makeSculpt(B)), { construct } = K.procedural,
      plan = [[-3.06,-1.62],[2.95,-1.62],[2.95,0.62],[0.7,0.62],[0.7,2.19],[-3.06,2.19]],
      profile = construct.profile([plan]),
      roof = construct.weightedRoof([plan], seed % 2
        ? { pitches: [[0.53,0.63,0.86,0.72,0.65,0.57]] } : { pitch: 0.65 }),
      wall = { r: [6,7,8,9,10], mod: (x,y,z) => (B.n3(x * 8,y * 8,z * 8) - 0.5) * 0.16 },
      stone = { r: [1,2,3,4,5] }, ledge = { r: [17,18,19,20] }, glass = { r: [22,23,24,25] },
      red = { r: [11,12,13,14,15,16], mod: (x,y,z) =>
        0.06 * Math.sin(y * 52 + 0.2 * Math.sin(z * 20)) + (B.n3(x * 4,y * 5,z * 4) - 0.5) * 0.18 };
    if (roof.status !== 'ok') throw new Error(roof.reason);
    S.box([0,-0.09,0.25], [3.57,0.17,2.36], stone, { rd: 0.15, res: 0.091 });
    S.implicitForm(construct.extrude(construct.offset(profile,0.13), { low: 0.02, high: 0.22 }), ledge, { res: 0.076 });
    S.implicitForm(construct.extrude(construct.offset(profile,-0.16), { low: 0.18, high: 1.86 }), wall, { res: 0.069 });
    S.implicitForm(construct.extrude(construct.offset(profile,-0.064), { low: 1.75, high: 1.93 }), ledge, { res: 0.061 });
    S.implicitForm(roof.solid({ base: 2.01, thickness: 0.13 }), red, { res: 0.056, maxWork: 80000000 });
    for (const { a,b,kind } of roof.arcs) {
      const r = kind === 'valley' ? 0.026 : 0.036;
      S.tube([[a[0],a[1] + 2.015,a[2]],[b[0],b[1] + 2.015,b[2]]], r, r,
        kind === 'valley' ? ledge : { r: [12,13,14,15,16] }, { res: 0.058 });
    }
    for (const [x, z] of [[-2.4,2.06],[-0.61,2.06],[1.23,0.49],[2.36,0.49]]) {
      S.box([x,1.14,z], [0.29,0.45,0.09], ledge, { rd: 0.055, res: 0.058 });
      S.box([x,1.15,z + 0.074], [0.209,0.345,0.036], glass, { rd: 0.035, res: 0.051 });
      S.box([x,1.15,z + 0.118], [0.028,0.328,0.021], ledge, { rd: 0.01, res: 0.05 });
      S.box([x,0.68,z + 0.104], [0.36,0.05,0.11], ledge, { rd: 0.02, res: 0.055 });
    }
    S.box([-1.47,0.91,2.072], [0.42,0.71,0.077], ledge, { rd: 0.09, res: 0.062 });
    S.box([-1.47,0.88,2.131], [0.318,0.63,0.045], { r: [26,27,28] }, { rd: 0.062, res: 0.051 });
    S.ball([-1.31,0.78,2.189], 0.046, { r: [19,20,21] }, { res: 0.05 });
    S.box([-1.47,0.174,2.27], [0.57,0.086,0.23], stone, { rd: 0.036, res: 0.064 });
    for (const [x, z] of [[1.1,1.48],[1.55,1.42],[2.6,1.47],[2.84,1.6]]) {
      S.rock([x,0.22,z], 0.14 + (0.05 * K.hash(Math.round(x * 100),seed,7)), { r: [26,27,28] }, { res: 0.066 });
    }
    S.bake();
    return B.finish({ cam: { target: [0,1.1,0.24], dist: 10.55, pitch: 0.62, yaw: 0.3 },
      detail: 22, dither: 0.22, radius: 4.45 });
  }
});
