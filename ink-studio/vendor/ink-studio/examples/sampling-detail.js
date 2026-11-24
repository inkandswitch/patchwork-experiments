module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'sampling-detail',
  name: 'Surface strata and progressive samples',
  seed: 0,
  build(seed) {
    const B = makeBuilder(91, [
      0x17252e, 0x263945, 0x3b5567, 0x638095, 0x879daa,
      0x3b3435, 0x695049, 0x9d7458, 0xc39d77, 0xeec57c,
      0xc8dace, 0x90b7a5, 0x71a08c
    ]);
    const S = K.sculpt(makeSculpt(B)),
      { sampling } = K.procedural,
      mode = ((seed % 3) + 3) % 3,
      finish = () => B.finish({ cam: { target: [0, 0.37, 0], dist: 9.3, pitch: 0.81, yaw: 0.11 }, detail: 21, dither: 0.21, radius: 3.5 });
    const slab = { r: [5, 6, 7, 8] };
    S.box([0, -0.12, 0], [3.0, 0.19, 1.92], slab, { rd: 0.075, res: 0.088 });
    if (mode === 2) {
      const candidate = Array.from({ length: 280 }, () => [(B.R() * 2 - 1) * 2.7, (B.R() * 2 - 1) * 1.6]),
        layout = sampling.eliminate(candidate, { count: 58, progressive: true });
      for (const [i, [x, z]] of layout.points.entries()) {
        const coarse = i < layout.levels[3],
          middle = i < layout.levels[4],
          r = coarse ? 0.126 : middle ? 0.095 : 0.068,
          stone = { r: coarse ? [7, 8, 9] : middle ? [4, 11, 10] : [1, 2, 3, 4] };
        S.ball([x, 0.073, z], [r, r * 0.75, r], stone, { res: 0.045 });
      }
      S.bake();
      return finish();
    }
    const height = (x, z) => 0.11 + 0.83 * Math.exp(-2.4 * (x - 0.4 * Math.sin(1.5 * z)) ** 2),
      patch = (u, v) => {
        const x = (u * 2 - 1) * 2.84, z = (v * 2 - 1) * 1.78;
        return [x, height(x, z), z];
      };
    S.terrain({ r: [1, 2, 3, 4] }, { x0: -2.89, x1: 2.89, z0: -1.80, z1: 1.80, h: height, res: 0.073 });
    S.bake();
    const points = sampling.patch({ spacing: 0.45, sample: patch, jitter: mode ? 0.84 : 0, curvature: mode ? 3.9 : 0, seed: 91 });
    for (const { point: [x, y, z] } of points) {
      const h = 0.002,
        normal = K.V.norm([
          -(height(x + h, z) - height(x - h, z)) / (2 * h), 1,
          -(height(x, z + h) - height(x, z - h)) / (2 * h)
        ]);
      B.disc(x, y + 0.043, z, normal, 0.032, 0.012, B.P[9], 1, { em: true });
    }
    return finish();
  }
});
