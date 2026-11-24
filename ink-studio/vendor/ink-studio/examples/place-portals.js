/* Two authored places with live views through a doorway and a separate fade link. */
module.exports = function placePortals(K, makeBuilder, makeSculpt, options = {}) {
  const a = { origin: [0, 1.65, 0], normal: [0, 0, 1] };
  const b = { origin: [8, 1.65, 4], normal: [1, 0, 0] };
  const courtyard = { place: 'court', anchor: 'door' }, cave = { place: 'garden', anchor: 'door' };
  const aperture = { halfWidth: 1.03, halfHeight: 1.39 };
  function court() {
    const B = makeBuilder(15, [0x181520, 0x4d303c, 0x834c4a, 0xb9775c, 0xe8ae75, 0x543c49, 0xfdd991]);
    const S = K.sculpt(makeSculpt(B));
    const masonry = { r: [1, 2, 3, 4], mod: (x, y, z) => B.n3(x * 2, y * 5, z * 2) * 0.25 };
    S.box([0, -0.14, 1.62], [4.3, 0.15, 4.1], { r: [1, 2, 3] }, { res: 0.095 });
    S.box([0, 1.65, -0.57], [4.1, 1.65, 0.24], masonry, { res: 0.11 });
    for (const side of [-1, 1]) {
      S.box([1.24 * side, 1.64, 0.05], [0.23, 1.66, 0.35], masonry, { res: 0.07 });
      for (let i = 0; i < 7; i++) {
        S.box([1.24 * side, 0.22 + i * 0.47, 0.42], [0.265, 0.03, 0.03], { r: [2, 3, 4] }, { res: 0.045 });
      }
      S.box([1.62 * side, 0.48, 0.8], [0.27, 0.49, 0.24], masonry, { res: 0.07 });
      for (let i = 0; i < 4; i++) {
        B.iso(1.62 * side, 1.03 + i * 0.075, 0.8, 0.15 - i * 0.025, B.P[6], 1);
      }
    }
    S.box([0, 3.33, 0.05], [1.51, 0.24, 0.35], masonry, { res: 0.07 });
    S.box([0, 0.16, 0.03], [1.25, 0.11, 0.38], { r: [2, 3, 4] }, { res: 0.075 });
    S.bake();
    return B.finish({ cam: { target: [0, 1.65, 0], dist: 5.8, yaw: 0.075, pitch: 0.08 } });
  }
  function garden(state) {
    const B = makeBuilder(172, [0x101727, 0x25324a, 0x3b5064, 0x5e8c89, 0x4cb6a1, 0x7ad5bd, 0xfbe3a6, 0x9ccdad]);
    const S = K.sculpt(makeSculpt(B));
    S.box([12.08, -0.22, 4], [4.06, 0.21, 3.2], { r: [1, 2, 3] }, { res: 0.095 });
    for (let i = 0; i < 7; i++) {
      const x = 8.66 + i * 0.52, h = 0.03 + i * 0.07;
      S.box([x, h * 0.5, 4], [0.27, h * 0.5, 0.95], { r: [2, 3, 7] }, { res: 0.078 });
    }
    S.ball([12.25, 0.26, 4], [1.25, 0.24, 1.24], { r: [2, 3, 7] }, { res: 0.072 });
    for (let i = 0; i < 21; i++) {
      const side = i % 2 ? 1 : -1, x = B.rr(8.5, 15.6), z = 4 + side * B.rr(1.02, 2.65);
      const h = B.rr(0.38, 2.7);
      S.ball([x, h * 0.5, z], [0.18, h * 0.5, 0.18],
        { r: i % 4 ? [2, 3, 4, 5] : [3, 5, 7] }, { res: 0.074 });
      B.iso(x, h, z, 0.095, B.P[5], 1);
    }
    for (let i = 0; i < 42; i++)
      B.iso(B.rr(8.2, 16), B.rr(0.32, 4.6), B.rr(1.3, 6.7), B.rr(0.026, 0.052), B.P[i % 4 ? 5 : 6], 1);
    if (state.lamp !== false) {
      S.ball([12.2, 1.42, 4], [0.38, 0.71, 0.38], { r: [5, 6, 6] }, { res: 0.065 });
      B.iso(12.2, 2.27, 4, 0.14, B.P[6], 1);
    }
    S.bake();
    return B.finish({ cam: { target: [11.8, 1.65, 4], dist: 5.8, yaw: -Math.PI / 2, pitch: 0.08 } });
  }
  const session = K.world.portals.create({
    places: [
      { id: 'court', anchors: { door: a, pool: { origin: [2.4, 0.1, 1.8] } }, prepare: () => ({ world: court() }) },
      { id: 'garden', tickPolicy: 'continue', anchors: { door: b, bank: { origin: [11.75, 0.5, 4] } }, prepare({ state }) {
        const saved = { lamp: state?.lamp ?? true, elapsed: state?.elapsed ?? 0 };
        const asset = { world: garden(saved), checkpoint: () => ({ ...saved }),
          step({ time }) { saved.elapsed = time; },
          setLamp(value) {
            const next = { lamp: Boolean(value) };
            if (next.lamp === saved.lamp) return;
            asset.world = garden(next);
            saved.lamp = next.lamp;
          } };
        return asset;
      } }
    ],
    links: [
      { id: 'garden-door', from: courtyard, to: cave, aperture },
      { id: 'court-door', from: cave, to: courtyard, aperture },
      { id: 'pool', mode: 'fade', from: { place: 'court', anchor: 'pool' }, to: { place: 'garden', anchor: 'bank' } }
    ], ...options
  });
  return session;
};
