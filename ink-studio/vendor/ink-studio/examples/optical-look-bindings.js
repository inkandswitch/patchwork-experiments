module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'optical-look-bindings', name: 'Signal cistern', seed: 19,
  build(seed, { controls } = {}) {
    const variant = controls?.variant ?? 'bound';
    if (!['neutral', 'bound', 'reflection'].includes(variant)) throw new RangeError('Choose neutral, bound or reflection');
    const B = makeBuilder(seed, [0x121a26, 0x222e3c, 0x37495b, 0x536779, 0x72858c, 0x9b9e8f,
      0xbdb79d, 0xe6dcb8, 0x594638, 0x9b7546, 0xd6a459, 0xf7d786, 0x7f98a1, 0xb0c6cb, 0xf7ecd2]);
    const S = K.sculpt(makeSculpt(B));
    S.sun = B.norm([-.56, .78, .52]);
    S.amb = .24;
    const steel = { r: [1, 2, 3, 4] }, stone = { r: [2, 3, 4, 5, 6] }, brass = { r: [8, 9, 10, 11] };
    const porcelain = { r: [4, 5, 6, 7] }, lamp = { r: [11, 14], em: true };
    const box = (p, h, mat, o) => S.box(p, h, mat, { rd: .055, res: .057, ...o });
    const y = .12;
    box([0, -.99, 0], [3.03, .29, 2.06], steel, { rd: .21, res: .078 });
    box([0, -.71, 0], [2.84, .12, 1.87], stone, { rd: .11 });
    box([0, .28, -1.45], [2.78, .8, .23], steel);
    box([0, .78, -1.28], [2.74, .091, .20], stone);
    for (const x of [-2.54, 2.54]) {
      box([x, -.33, .12], [.24, .52, 1.53], stone, { rd: .085 });
      box([x, .19, .12], [.26, .077, 1.57], porcelain);
      box([x, .42, -1.18], [.18, .45, .18], brass);
    }
    for (let i = 0; i < 5; i++) {
      const z = 1.28 - i * .49, top = -.10 - i * .105;
      box([-.83, top - .09, z], [.67, .09, .25], porcelain, { rd: .036, res: .044 });
    }
    for (const [x, z, size] of [[.42,.94,.23],[1.02,.47,.28],[1.72,.58,.34],[.52,-.08,.18],[1.55,-.2,.23]]) {
      S.rock([x,-.56,z],[size,.62*size,.83*size],stone,{res:.048});
    }
    const sign = { target: { surface: 'signal-sign' }, res: .035 };
    box([-.71, 1.17, -1.17], [1.13, .34, .095], brass, { rd: .086 });
    box([-.71, 1.17, -1.06], [1.01, .259, .036], { r: [12, 13] }, { ...sign, rd: .05 });
    const mark = { r: [14], em: true };
    for (const x of [-1.43, -1.19, -.95]) box([x, 1.17, -1.013], [.043, .088, .018], mark, { rd: .019, res: .022 });
    box([-.30, 1.17, -1.013], [.30, .027, .018], mark, { rd: .018, res: .022 });
    for (const dy of [-1, 1]) S.tube([[.004, 1.17, -1.011], [-.13, 1.17 + dy * .119, -1.011]],
      .023, .023, mark, { res: .022 });
    for (const x of [1.63, 2.14]) {
      box([x, .82, -.87], [.063, .50, .07], brass);
      box([x, 1.31, -.85], [.09, .059, .094], lamp);
    }
    for (const height of [.39, 1.22]) box([1.88, height, -.85], [.27, .039, .065], steel);
    box([1.88, .80, -.96], [.198, .25, .052], porcelain);
    S.bake();

    const plane = K.reflection.plane({ id: 'cistern-mirror', at: [0, y, 0],
      select: (_i, x, height, z) => x > -1.86 && x < .44 && height > .88 && z < -.95 });
    const surface = K.reflection.material({ r: [3], a: .37 }, plane.id, { f0: 1, strength: 1, blur: .4 });
    const sheet = K.sculpt(makeSculpt(B));
    sheet.box([0, y - .01, .175], [2.30, .013, 1.385], surface, { res: .064, ghost: true });
    sheet.bake();

    const first = B.count();
    for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++)
      B.disc(1.70 + j * .12, .48 + i * .113, -.78, [0, 0, 1], .079, .012, B.P[13], .15, { gl: true, nd: true });
    B.describeSplats(first, B.count(), { object: 'inspection-pane' });

    const native = K.procedural.waterBodies;
    const water = native.scene([native.create({ id: 'cistern-water', bounds: { min: [-2.30, -1.21], max: [2.30, 1.56] },
      sample() { return { bed: -.70, surface: y }; },
      optics: { tint: [.20, .21, .24], extinction: [1.18, .71, .38], deepTint: [.11, .13, .18] } })]);
    const wash = (name, matrix, offset) => ({ name, steps: [{ type: 'channelMix', matrix, offset }] });
    const pack = { format: 'ink-studio/asset-pack', version: 1, id: 'cistern', revision: 1, title: 'Cistern finishes', looks: [
      { id: 'cistern/verdigris', label: 'Verdigris water', stack: wash('Verdigris', [[.36, 0, 0], [0, 1.35, .25], [0, .2, 1.37]], [.012, .15, .10]) },
      { id: 'cistern/mauve', label: 'Mauve mist', stack: wash('Mauve mist', [[.9, 0, 0], [0, .69, 0], [0, 0, 1.11]], [.16, .017, .11]) },
      { id: 'cistern/amber-glass', label: 'Amber glass', stack: wash('Amber glass', [[1, 0, 0], [0, .61, 0], [0, 0, .31]], [.26, .06, 0]) },
      { id: 'cistern/mirror-wash', label: 'Cool mirror', stack: wash('Cool mirror', [[.74, 0, 0], [0, 1, 0], [.32, 0, 1.09]], [0, .035, .11]) }
    ] };
    const catalog = K.authoring.assetPacks.create({ packs: [pack] });
    const optics = variant === 'neutral' ? [] : [
      { select: { medium: 'cistern-water' }, asset: 'cistern/verdigris' },
      { select: { medium: 'drift' }, asset: 'cistern/mauve' },
      { select: { medium: 'inspection-pane', mediumKind: 'glass' }, asset: 'cistern/amber-glass' },
      ...(variant === 'reflection' ? [{ select: { medium: plane.id, mediumKind: 'reflection' }, asset: 'cistern/mirror-wash' }] : [])
    ];
    return B.finish({
      cam: { target: [0, .08, 0], dist: 9.4, yaw: -.15, pitch: .58 },
      detail: 27, radius: 7, dither: 0, refract: 4, water, reflections: [plane],
      atmosphere: [K.atmosphere.sphere({ id: 'drift', mediumKind: 'fog', at: [1.67, .68, .10], radius: .97,
        density: .24, color: '#8095ac' })],
      look: K.authoring.looks.scene({
        pixelSize: 2, coverageAware: true, optics,
        paletteConstraints: { targets: [{ select: { surface: 'signal-sign' }, palette: ['#f54e46', '#ff7b62'] }] }
      }, catalog)
    });
  }
});
