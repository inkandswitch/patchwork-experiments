/* Render the same specimen board with and without its material bevel layers. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'material-bevel-highlights',
  name: 'Copper, stone and cloth bevel highlights',
  seed: 81,
  build(seed) {
    const palette = [
      0x151a24, 0x222a37, 0x303b49, 0x43505d, 0x5c6974, 0x74808a,
      0x3f2630, 0x67372f, 0x954f3b, 0xb96b47, 0xd58c58, 0xedb276, 0xffdaa1,
      0x2d302c, 0x484638, 0x66614c, 0x858269, 0xa6a183, 0xc9c3a0, 0xe9dec0,
      0x222c49, 0x303f66, 0x3c567f, 0x4f7298, 0x6993b0, 0x98bdcd, 0xc4dce1
    ];
    const roles = { copper: [9, 10, 11, 12], stone: [16, 17, 18, 19], cloth: [22, 23, 24, 25, 26] };
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, sun: [-0.48, 0.72, 0.5], amb: 0.27, sky: 0.23, sunK: 0.46, wob: 0.017 });
    const material = (base, role, settings) => K.surface.material(base, { layers: {
      highlight: { type: 'bevel', lightingRamp: { role }, ...settings }
    } });
    const copper = material([6, 7, 8, 9, 10], 'copper', { width: 2.25, minBend: 0.1, softness: 0.34, power: 0.6 });
    const stone = material([13, 14, 15, 16, 17], 'stone', { width: 3.25, minBend: 0.14, softness: 0.46, strength: 0.83 });
    const cloth = material([20, 21, 22, 23], 'cloth', { width: 4, minBend: 0.065, softness: 0.43, strength: 0.86, power: 0.8 });
    const plinth = { r: [1, 2, 3, 4] };
    const bed = { r: [1, 2, 3] };
    S.box([0, -0.26, 0], [6, 0.13, 3.6], bed, { res: 0.12, rd: 0.08 });
    for (const x of [-2.12, 0, 2.12]) {
      S.box([x, -0.075, 0], [0.88, 0.12, 0.63], plinth, { res: 0.065, rd: 0.08 });
      S.box([x, 0.05, 0], [0.80, 0.042, 0.56], plinth, { res: 0.05, rd: 0.025 });
    }

    S.box([-2.12, 0.91, 0], [0.75, 0.82, 0.29], copper, { res: 0.042, rd: 0.13, objectId: 'copper-bezel' });
    S.box([-2.12, 0.93, 0.36], [0.59, 0.62, 0.24], copper, { res: 0.038, rd: 0.15, neg: true });
    S.box([-2.12, 0.93, 0.122], [0.54, 0.57, 0.02], { r: [20, 21, 22] }, { res: 0.045, rd: 0.019 });
    for (const y of [0.23, 1.59]) for (const x of [-2.72, -1.52])
      S.ball([x, y, 0.289], [0.055, 0.055, 0.036], { r: [7, 8, 10, 11] }, { res: 0.024 });

    const planes = [
      { n: [1, 0, 0], d: 0.77 }, { n: [-1, 0, 0], d: 0.79 },
      { n: [0, 1, 0], d: 0.82 }, { n: [0, -1, 0], d: 0.81 },
      { n: [0, 0, 1], d: 0.37 }, { n: [0, 0, -1], d: 0.4 },
      { n: [-0.7, 0.7, 0.24], d: 0.86 }, { n: [0.7, 0.7, 0.42], d: 0.96 },
      { n: [0.8, -0.48, 0.35], d: 0.97 }
    ];
    S.poly([0, 0.9, 0], planes, stone, { res: 0.046, rd: 0.042, objectId: 'chipped-stone' });
    S.ball([0.59, 1.47, 0.42], [0.18, 0.16, 0.11], stone, { res: 0.037, neg: true });
    S.ball([-0.67, 0.43, 0.38], [0.17, 0.22, 0.11], stone, { res: 0.036, neg: true });
    S.tube([[-0.42, 0.76, 0.37], [-0.19, 0.60, 0.37], [0.025, 0.72, 0.37], [0.21, 0.58, 0.37]],
      0.027, 0.02, stone, { res: 0.026, neg: true });

    const clothCenter = [2.12, 0.95, 0.06];
    const fold = (x, y) => (0.08 + 0.045 * (0.8 - y)) * Math.cos(15 * x + 0.95 * y) +
      0.04 * Math.sin(3.2 * x - 2.4 * y) + 0.095 * (0.8 - y);
    const drape = (x, y) => y - 0.034 * Math.cos(3.4 * x + 1.2) + 0.052 * x;
    S.solid(clothCenter, 1.2, (x, y, z) => {
      const q = [Math.abs(x) - 0.73, Math.abs(drape(x,y)) - 0.77, Math.abs(z - fold(x,y)) - 0.038];
      return Math.hypot(...q.map(n => Math.max(0, n))) + Math.min(0, Math.max(...q)) - 0.017;
    }, (res, emit) => {
      const nx = Math.ceil(1.5 / res), ny = Math.ceil(1.6 / res);
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const x = 1.5 * i / nx - 0.75, y = 1.62 * j / ny - 0.81, z = fold(x,y);
        emit(x, y, z - 0.051);
        emit(x, y, z + 0.051);
      }
    }, cloth, { res: 0.032, reach: 0.08, objectId: 'folded-cloth' });
    S.tube([[1.27, 1.78, 0.07], [2.97, 1.78, 0.07]], 0.048, 0.048, { r: [6, 7, 9, 10] }, { res: 0.037 });
    for (const x of [1.24, 3.0]) S.ball([x, 1.78, 0.07], 0.071, { r: [7, 9, 10, 11] }, { res: 0.039 });
    S.bake();
    return B.finish({
      cam: { target: [0, 0.82, 0], dist: 4.45, yaw: -0.055, pitch: 0.155, ortho: true, sway: 0 },
      detail: 23, radius: 6, dither: 0, paletteRoles: roles,
      look: { pixel: true, splatCoverage: 'continuous' }
    });
  }
});
