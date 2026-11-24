module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'sculpt-example',
  name: 'Carved stone',
  seed: 7,
  build(seed) {
    const palette = [0x080b10, 0x26313d, 0x566778, 0x9baeb8, 0xe5e9dc, 0x387548, 0x8fc75e];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const stone = { r: [1, 2, 3, 4] };

    S.ground({ r: [1, 1, 2] }, { rad: 4, res: 0.18 });
    S.box([0, 1.2, 0], [1, 1.2, 1], stone, { res: 0.12 });
    S.ball([0, 1.4, 0.9], 0.65, stone, { neg: true });
    S.ball([0, 2.7, 0], 0.5, { r: [1, 5, 6] }, { res: 0.1 });
    S.bake();

    return B.finish({
      cam: { target: [0, 1.4, 0], dist: 12, pitch: 0.2, yaw: 0.45 },
      detail: 14,
      dither: 0.25,
      radius: 5
    });
  }
});
