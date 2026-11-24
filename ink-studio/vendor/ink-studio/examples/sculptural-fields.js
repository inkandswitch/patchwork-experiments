module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'sculptural-fields',
  name: 'Three implicit sculptures',
  seed: 3,
  build() {
    const B = makeBuilder(25, [
      0x1c252a, 0x344049, 0x4b5354, 0x656b60, 0x838572,
      0x2a3d39, 0x37625a, 0x588274, 0x81a295, 0xb3c0a4,
      0x533d43, 0x834e45, 0xad6e55, 0xd39366, 0xefbc83,
      0x4f4a38, 0x736747, 0xa08a54, 0xc5ab66, 0xeade9d,
      0x263e4c, 0x3e5b6b, 0x6d8e9c, 0x9db4b1
    ]), S = K.sculpt(makeSculpt(B)), { forms, grammar } = K.procedural,
      stone = { r: [1,2,3,4] }, blue = { r: [20,21,22,23] },
      patina = { r: [5,6,7,8,9], mod: (x,y,z) => 0.18 * Math.sin(y * 3.2 + z * 0.4) };
    for (const x of [-2.28, 0, 2.28])
      S.box([x,0.04,0], [0.98,0.1,0.94], stone, { rd: 0.07, res: 0.064 });
    const ring = (n, amplitude) => Array.from({ length: n }, (_, i) => {
      const a = Math.PI * 2 * i / n, r = 1 + amplitude * Math.cos(4 * a);
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const section = [
      { y: 0.13, scale: 0.36, profile: ring(12, 0) },
      { y: 0.39, scale: 0.64, profile: ring(20, 0.05) },
      { y: 0.8, scale: 0.69, profile: ring(20, 0.08), roll: 0.22 },
      { y: 1.12, scale: 0.47, profile: ring(16, 0.05), roll: 0.36 },
      { y: 1.52, scale: 0.39, profile: ring(20, 0.09), roll: 0.5 },
      { y: 1.68, scale: 0.56, profile: ring(20, 0.1), roll: 0.59 },
      { y: 1.88, scale: 0.55, profile: ring(20, 0.1), roll: 0.67 }
    ], stoneware = forms.loft(section, { pose: { position: [-2.28,0,0] } }),
      hollow = forms.shell(stoneware, { inner: (x,y) => 0.063 + 0.037 * Math.exp(-((y - 1.54) ** 2) * 13) });
    S.implicitForm({ ...hollow, sd: (x,y,z) => Math.max(hollow.sd(x,y,z), y - 1.79) }, {
      r: [10,11,12,13,14],
      rf: (x,y,z) => y > 1.57 || (y > 0.42 && y < 0.84 && Math.sin(40 * y + Math.sin(8 * z)) > 0.16)
        ? [20,21,22,23] : null
    }, { res: 0.048, cell: 0.049 });

    const carrier = forms.superquadric({
      radii: [0.8,0.8,0.8], exponents: [3.8,3], pose: { position: [0,1.025,0], rotation: [0,0.19,-0.14] }
    });
    S.implicitForm(forms.periodic({
      bounds: carrier.bounds, period: [0.87,1.03,0.97], phase: [0.81,0.2,0.3], thickness: 0.086, host: carrier.sd
    }), patina, { res: 0.052, cell: 0.043 });
    S.ball([0,0.23,0], [0.55,0.14,0.55], blue, { res: 0.058 });

    const bronze = { r: [15,16,17,18,19] },
      scope = { id: 'ornament', symbol: 'horn', bounds: { min: [0.24,0.56,-0.16], max: [0.67,1.66,0.18] } },
      rules = {
        horn: { op: 'split', axis: 'y', parts: [
          { key: 'root', use: { op: 'emit', role: 'root' } },
          { key: 'inner', use: { op: 'emit', role: 'bend' } },
          { key: 'crest', use: { op: 'emit', role: 'crest' } }
        ] }
      }, frame = grammar.symmetry(scope, rules, { copies: [{ index: 1, scale: 0.89, offset: [-0.035,0.09,0.04] }] }),
      arms = [{ point: [2.28,0.34,0], radius: 0.21 }, { point: [2.28,0.87,0], parent: 0, radius: 0.29 }];
    for (const copy of [0,1]) {
      const parts = frame.parts.filter(p => p.copy === copy);
      let parent = 1;
      for (const [i, part] of parts.entries()) {
        const side = part.handedness, point = [2.28 + part.center[0] + Math.sin(i * 1.4) * side * 0.27,
          part.center[1] + i * 0.16, part.center[2] + i * 0.036];
        arms.push({ point, radius: [0.18,0.125,0.063][i], parent });
        parent = arms.length - 1;
      }
    }
    arms.push({ point: [2.28,1.35,0.1], radius: 0.2, parent: 1 });
    S.implicitForm(forms.skeleton(arms, { blend: 0.16 }), bronze, { res: 0.055 });
    S.implicitForm(forms.superquadric({
      radii: [0.3,0.31,0.22], exponents: [1.26,1.56], pose: { position: [2.28,1.17,0.24], rotation: [0,0,0.03] }
    }), blue, { res: 0.044 });
    S.bake();
    return B.finish({ cam: { target: [0,0.85,0], dist: 8.3, pitch: 0.35, yaw: 0.12 },
      detail: 20, dither: 0.22, radius: 3.72 });
  }
});
