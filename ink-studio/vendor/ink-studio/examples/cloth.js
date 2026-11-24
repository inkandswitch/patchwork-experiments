module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'cloth-example',
  name: 'Cloth in the wind',
  seed: 1,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
    S.bake();

    const cloth = K.cloth(B, {
      at: [-1, 3, 0],
      u: [2, 0, 0],
      v: [0, -2, 0],
      nu: 12,
      nv: 10,
      pins: (i, j) => j === 0,
      wind: K.xpbd.gust([2, 0, 1]),
      pattern: (u, v) => (Math.floor(u * 6) + Math.floor(v * 6)) % 2 ? [1, 2, 3] : [5, 6, 7],
      sdf: S.sdf
    });
    const W = B.finish({
      cam: { target: [0, 1.5, 0], dist: 12, pitch: 0.2, yaw: 0.5 },
      detail: 14,
      dither: 0.25
    });
    K.stage(W).add(cloth);
    return W;
  }
});
