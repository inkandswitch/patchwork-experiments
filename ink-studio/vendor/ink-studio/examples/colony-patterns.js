module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'colony-patterns',
  name: 'Mineral dendrites and lichen',
  seed: 7,
  build(seed) {
    const B = makeBuilder(18, [
      0x192c35, 0x27363e, 0x32454d, 0x45555b, 0x596463, 0x697673,
      0x345867, 0x407b8b, 0x65a9b3, 0x93c4bf, 0xc6e5d4,
      0x465245, 0x586a4e, 0x79845a, 0xa1a568, 0xbfb977,
      0x5a4b40, 0x7b624d, 0xa38462, 0xc7a779
    ]), S = K.sculpt(makeSculpt(B)), { growth } = K.procedural,
      width = 43, height = 43, cell = 0.074, mask = (x, z) => Math.hypot(x - 21, z - 21) < 20.4,
      cluster = growth.aggregate({ width, height, target: 330, launch: 4, seed, mask }),
      lichen = growth.grayScottGrid({ width, height, seed, steps: 760, mask, feed: 0.038, kill: 0.063,
        initial: ([x,z]) => [[13,15], [29,15], [21,28]].some(([a,b]) => Math.hypot(x-a,z-b) < 3.65) ? [0.44,0.31] : [1,0]
      });
    function rows(field) {
      return Array.from({ length: height }, (_, z) =>
        Array.from({ length: width }, (_, x) => mask(x, z) ? field(x, z) : '.').join(''));
    }
    const scale = [cell, 0.073, cell], stones = rows(() => 's'),
      frost = rows((x, z) => cluster.cells[z * width + x] ? 'a' : 's'),
      stains = rows((x, z) => {
        const n = lichen.sample(x,z).v;
        return n > 0.251 ? 'e' : n > 0.185 ? 'd' : n > 0.10 ? 'c' : n > 0.041 ? 'b' : 's';
      });
    for (const [i, top] of [frost, stains].entries()) {
      const x = i ? 1.78 : -1.78, at = [x, 0.06, 0];
      S.vox({ cell: scale, hard: true, key: {
        s: [1,2,3,4,5], a: [7,8,9,10,11], b: [12,13], c: [13,14], d: [14,15], e: [15,16,19]
      }, layers: [[stones, 2], top] }, { at, res: 0.03, round: 0.25 });
      S.ball([x, -0.055, 0], [1.6, 0.075, 1.6], { r: [16, 17, 18, 19] }, { res: 0.062 });
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0, 0], dist: 9.5, pitch: 1.26, yaw: 0.06 },
      detail: 21, dither: 0.13, radius: 4.06 });
  }
});
