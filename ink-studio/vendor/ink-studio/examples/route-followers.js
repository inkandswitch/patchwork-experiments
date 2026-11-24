module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'route-followers',
  name: 'Loop-safe rail followers',
  seed: 12,
  build(seed) {
    const palette = [0x111c28, 0x2b4f62, 0x70b8c1, 0xe7edcd, 0xb85a35, 0xf2b465];
    const points = [[-4, 0.6, 3], [-4, 0.6, 0], [-3, 0.6, -2]];
    for (let i = 0; i <= 40; i++) {
      const a = i * Math.PI / 20;
      points.push([-1 + 2 * Math.sin(a), 0.6 + 2 * (1 - Math.cos(a)), -2 + a * 0.18]);
    }
    points.push([2, 0.6, 0], [4, 1.3, 2], [2, 0.6, 4], [-2, 0.6, 4]);
    const route = K.anim.route(K.anim.path(points, { closed: true }), {
      speed: 4.5, acceleration: 3, stops: [{ at: 0, duration: 1.5 }],
      sections: [{ from: 0, to: 3, speed: 1.8 }],
      bank: { gain: 1.5, limit: 0.25 }
    });
    const B = makeBuilder(seed, palette), S = K.sculpt(makeSculpt(B));
    S.ground({ r: [0, 1] }, { rad: 7, res: 0.25 });
    for (let d = 0; d < route.length; d += 0.22) {
      const a = route.frame(d), b = route.frame(d + 0.22);
      for (const side of [-0.25, 0.25]) {
        S.tube([K.V.mad(a.p, a.right, side), K.V.mad(b.p, b.right, side)],
          0.035, 0.035, { r: [1, 2, 3] }, { res: 0.07 });
      }
      if (Math.floor(d / 0.22) % 3 === 0) {
        S.tube([K.V.mad(a.p, a.right, -0.3), K.V.mad(a.p, a.right, 0.3)],
          0.04, 0.04, { r: [4, 5] }, { res: 0.08 });
      }
    }
    S.bake();
    const C = makeBuilder(seed, palette), T = K.sculpt(makeSculpt(C));
    T.box([0, 0.18, 0], [0.21, 0.16, 0.31], { r: [4, 5] }, { res: 0.07, rd: 0.04 });
    T.box([0, 0.35, -0.12], [0.18, 0.05, 0.08], { r: [2, 3] }, { res: 0.06 });
    T.bake();
    const car = K.frameSplats.capture(C.finish());
    const frame = K.frameSplats(B, car.count * 5, (draw, dt, time) => {
      for (const pose of route.vehicles(time, { count: 5, spacing: 0.8, wheelbase: 0.4 })) {
        draw.model(car, pose.p, { matrix: pose.matrix });
      }
    });
    const W = B.finish({ cam: { target: [0, 1.5, 0], dist: 19, pitch: 0.35, yaw: 0.4 }, detail: 24, dither: 0.1 });
    K.stage(W).add(frame);
    return W;
  }
});
