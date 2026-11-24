// A model on its own: ink-studio render lab/example.js     (see: ink-studio catalog lab)
module.exports = kit => ({
  id: 'lab-example',
  name: 'Lab example',
  seed: 1,
  build(seed) {
    const B = kit.makeBuilder(seed, [0x07080b, 0x1c2026, 0x3a4048, 0x666c70, 0x9aa09c, 0x24542a, 0x66a640]),
      S = kit.makeSculpt(B);
    S.ground({ r: [1, 2, 2, 3] }, { rad: 5, res: 0.12 });
    S.lathe([0, 0, 0], 3, [1, 0.7], { r: [1, 2, 3, 4] }, { res: 0.09 });
    S.ball([0, 3.6, 0], 1, { r: [5, 5, 6] }, { res: 0.08 });
    S.bake();
    return B.finish({
      cam: { target: [0, 2, 0], dist: 16, pitch: 0.15, yaw: 0.4, sway: 0.3 },
      detail: 14,
      palName: 'Lab',
      dither: 0.25,
      radius: 7
    });
  }
});
