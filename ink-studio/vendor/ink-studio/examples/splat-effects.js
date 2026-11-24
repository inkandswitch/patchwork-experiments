module.exports = ({ makeBuilder, KIT: K }) => ({
  id: 'splat-effects',
  name: 'Vortex and squash',
  seed: 12,
  build(seed) {
    const palette = [0x101827, 0x234557, 0x377a91, 0x73c9d1, 0xcbf6e9, 0x64528a, 0xb08ad2, 0xecc8f3];
    const modelBuilder = makeBuilder(seed, palette);
    modelBuilder.ball(0, 0, 0, 0.55, 0.55, 0.55, 120, [1, 2, 3, 4]);
    modelBuilder.iso(-0.22, 0.27, 0.48, 0.09, modelBuilder.P[4], 3);
    const bubble = K.frameSplats.capture(modelBuilder.finish());

    const B = makeBuilder(seed, palette);
    const frame = K.frameSplats(B, bubble.count + 3 * 24, (draw, dt, t) => {
      const squash = 1 + 0.55 * K.wobble(K.frac(t / 1.5));
      draw.model(bubble, [1.25, 0.66 * squash, 0], {
        matrix: K.M.stretch([0, 1, 0], squash, true)
      });
      draw.vortex([-1.1, 0, 0], {
        radius: [0.25, 0.95],
        height: 1.9,
        turns: 0.8,
        segments: 24,
        phase: t * 4,
        width: 0.05,
        color: 6
      });
    });
    const W = B.finish({
      cam: { target: [0, 0.95, 0], dist: 8, pitch: 0.18, yaw: 0.25 },
      detail: 24,
      dither: 0
    });
    K.stage(W).add(frame);
    return W;
  }
});
