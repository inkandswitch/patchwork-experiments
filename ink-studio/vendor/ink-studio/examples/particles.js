module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'particles-example',
  name: 'Embers in a current',
  seed: 4,
  build(seed) {
    const B = makeBuilder(seed);
    const S = K.sculpt(makeSculpt(B));
    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.2 });
    S.ball([0, 0.4, 0], 0.4, { r: [5, 6, 7], em: true }, { res: 0.12 });
    S.bake();

    const pool = K.pool(B, 160);
    const W = B.finish({
      cam: { target: [0, 1.2, 0], dist: 12, pitch: 0.2, yaw: 0.4 },
      detail: 14,
      dither: 0.25
    });
    const stage = K.stage(W);
    const particles = stage.add(K.particles(stage, pool, {
      flow: K.flow.sum(K.flow.wind([0.3, 1, 0]), K.flow.curl(1, 0.4)),
      ground: () => 0
    }));
    let next = 0;
    stage.add({
      update(dt, t) {
        if (t >= next) {
          particles.embers([0, 0.6, 0], 3, [6, 7, 5]);
          next = t + 0.1;
        }
      },
      poke(hit) {
        if (hit) particles.sparks(hit.p, 16, [7, 6, 5]);
      }
    });
    return W;
  }
});
