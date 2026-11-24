module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'gear-lantern',
  name: 'Gear Lantern',
  seed: 48,
  build(seed) {
    const B = makeBuilder(seed, [
      0x101929, 0x24334b, 0x3b5068, 0x64818a, 0x95aaac,
      0x234953, 0x2d7d79, 0x65bdaf, 0xc5f5d7,
      0x664147, 0xa06455, 0xde965d, 0xffc885, 0xffeab0,
      0x4a406c, 0x7e65aa, 0xbca2e6
    ]);
    const S = K.sculpt(makeSculpt(B)), { V, curve: C } = K;
    Object.assign(S, { pixel: true, amb: .34, sky: .23, sun: V.norm([-.54, .73, .47]), sunK: .88 });
    const base = { r: [0, 1, 2, 3, 4] }, brass = { r: [9, 10, 11, 12, 13] };
    const teal = { r: [5, 6, 7, 8] }, violet = { r: [14, 15, 16] }, lamp = { r: [11, 12, 13], em: true };
    S.lathe([0, -.16, 0], .29, [2.42, 2.31], base, { res: .13 });
    S.lathe([0, .033, 0], .11, [2.26, 2.23], brass, { res: .11 });
    S.lathe([0, .095, 0], .25, [2.13, 2.06], base, { res: .12 });
    S.torus([0, .22, 0], 1.89, .030, brass, { res: .094 });
    for (let i = 0; i < 24; i++) {
      const a = Math.PI * i / 12;
      S.ball([1.88 * Math.cos(a), .256, 1.88 * Math.sin(a)], .031, i % 6 ? teal : lamp, { res: .046 });
    }
    S.lathe([0, .24, 0], .48, [.63, .42], brass, { res: .093 });
    S.ball([0, 1.71, 0], [.43, 1.23, .43], base, { res: .086 });
    for (const y of [.72, 1.43, 2.08, 2.57])
      S.torus([0, y, 0], y > 2.4 ? .36 : .43, .028, brass, { res: .063 });
    S.ball([0, 1.75, 0], [.34, .53, .34], lamp, { res: .055, ghost: true });
    S.ball([0, 3.01, 0], [.17, .26, .17], lamp, { res: .055 });

    const outer = C.create({ type: 'epitrochoid', fixedRadius: 1.13, fixedTeeth: 5, rollingTeeth: 2, pen: .60,
      origin: [0, 2.06, 0], axis: [0, 0, 1], phase: .33, segments: 168 });
    const inner = C.create({ type: 'hypotrochoid', fixedRadius: 1.55, fixedTeeth: 7, rollingTeeth: 3, pen: .83,
      origin: [0, 1.91, 0], axis: [.87, 0, .49], phase: .34, segments: 168 });
    const spiral = C.create({ type: 'fermatSpiral', startRadius: .44, endRadius: 1.45, turns: 1.18,
      phase: 1.3, origin: [0, .31, 0], height: 3.04, segments: 110 });
    for (const [path, mat, width] of [[outer, teal, .069], [inner, violet, .049], [spiral, brass, .098]]) {
      K.sweep(S, path.points, { shape: 'rect', w: width, h: .026, round: .50 }, mat, { res: .050 });
    }
    for (const u of [.02, .22, .61, .96]) {
      const p = spiral.sample(u);
      S.tube([[0, p[1], 0], p], .038, .021, base, { res: .074 });
      S.ball(p, .071, lamp, { res: .044 });
    }
    const inscription = C.text(spiral, 'GEAR LANTERN', { size: .21, lift: .15, offset: spiral.length * .41 });
    for (const stroke of inscription.strokes)
      if (stroke.length > 1) S.tube(stroke, .014, .014, lamp, { res: .026 });
    S.bake();

    const duration = 5;
    const traces = [outer, inner].map(path => [path, V.norm(path.snapshot().axis)]);
    const tracer = K.frameSplats(B, 44, (draw, _dt, t) => {
      for (const [index, [path, normal]] of traces.entries()) {
        for (let i = 0; i < 11; i++) {
          const point = path.at(path.length * (t / duration + index * .49 - i * .0065)).p;
          const color = index ? (i < 3 ? 13 : 12) : (i < 3 ? 8 : 7);
          for (const side of [-.077, .077]) draw.point(V.mad(point, normal, side),
            { width: i < 3 ? .046 : .036, density: 1.45 - i * .076, color, depth: true });
        }
      }
    });
    const world = B.finish({
      cam: { target: [0, 1.51, 0], dist: 8.0, yaw: -.34, pitch: .34, fov: .61 },
      radius: 5, detail: 27, dither: .11, look: { pixelSize: 2, splatCoverage: 'continuous' }
    });
    K.stage(world).add(tracer);
    const rail = { type: 'archimedeanSpiral', startRadius: 8.25, endRadius: 7.52, turns: .235,
      phase: -2.04, height: .92, origin: [0, 3.86, 0] };
    return K.cameraRig.bind(world, K.cameraRig.compile({
      rails: { survey: { family: rail } },
      shots: { orbit: { target: [0, 1.35, 0], rail: 'survey', fov: .74,
        progress: [{ time: 0, value: 0 }, { time: duration / 2, value: 1, ease: 'smooth' },
          { time: duration, value: 0, ease: 'smooth' }] } },
      duration
    }));
  }
});
