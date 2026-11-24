module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'terrain-route',
  name: 'Two trailheads',
  seed: 13,
  build(seed) {
    const palette = [
      0x17242b, 0x222e2c, 0x3f523b, 0x5e7546, 0x819558, 0xaeb676,
      0x313b41, 0x626b6d, 0x9a9a88, 0xd0c8a4, 0xf0dfb1,
      0x472f33, 0x804537, 0xb97346, 0xdda761
    ];
    const B = makeBuilder(13, palette),
      S = K.sculpt(makeSculpt(B)),
      { routes } = K.procedural,
      { add, mul } = K.V;
    const cx = seed % 2 ? -0.7 : 0.7,
      cz = seed % 2 ? -1.0 : 0.95,
      height = (x, z) => 0.11 * Math.sin(x * 0.85 - z * 0.55) + 0.34 * Math.exp(-((x - 2.9) ** 2 + (z + 2) ** 2) / 4);
    const soil = { r: [1, 2, 3, 4], mod: (x, y, z) => (B.n3(x * 2, y * 2, z * 2) - 0.5) * 0.25 },
      stone = { r: [6, 7, 8, 9] },
      paver = { r: [7, 8, 9, 10] },
      support = { r: [11, 12, 13, 14] },
      leaves = { r: [2, 3, 4, 5] };
    S.ground(soil, { h: height, rad: 6.4, edge: 0.025, zs: 1.25, res: 0.13 });
    const rocks = [
      S.rock([cx - 0.52, height(cx, cz) + 0.35, cz], 0.92, stone, { res: 0.1 }),
      S.rock([cx + 0.6, height(cx, cz) + 0.24, cz + 0.42], 0.69, stone, { res: 0.09 }),
      S.rock([cx - 0.31, height(cx, cz) + 0.95, cz + 0.16], 0.49, stone, { res: 0.08 })
    ];
    const clearance = (x, y, z) => Math.min(...rocks.map(p => S.psd(p, x, y, z))),
      reserve = (x, z) => Math.hypot(x - cx - 0.54, z - cz + 0.08) < 0.72;
    const pin = (x, z) => [x, height(x, z) + 0.15, z],
      start = pin(-4.65, 0.04),
      end = pin(4.55, -0.12);
    const planned = routes.terrain(start, end, {
      bounds: { min: [-5, -1, -3.3], max: [5, 2, 3.3] },
      height: (x, z) => height(x, z) + 0.15,
      clearance,
      keepOut: reserve,
      cell: 0.22,
      sampleStep: 0.055,
      minClearance: 0.46,
      maxSlope: 0.34,
      maxDeviation: 0.064,
      slopeCost: 0.45,
      turnCost: 0.23
    });
    if (planned.status !== 'ok') throw new Error('Demo route failed: ' + planned.status);

    const route = planned.route;
    K.sweep(S, route.points.map(p => [p[0], p[1] - 0.065, p[2]]), { w: 0.32, h: 0.07 }, stone, { res: 0.08 });
    for (const { frame, length } of routes.layout(route, { pitch: 0.47, gap: 0.045 })) {
      const { point, side, normal, tangent } = frame;
      S.box(point, [0.34, 0.066, length / 2], paver, { ax: [side, normal, tangent], rd: 0.035, res: 0.065 });
      for (const sign of [-1, 1]) {
        const [x, , z] = add(point, mul(side, 0.24 * sign)),
          y = height(x, z),
          half = (point[1] - y) * 0.5;
        if (half > 0.035) S.box([x, y + half - 0.015, z], [0.10, half + 0.015, 0.11], support, { res: 0.075 });
      }
    }
    for (const [x, y, z] of [start, end]) {
      for (const sign of [-1, 1]) {
        S.box([x, y + 0.27, z + sign * 0.49], [0.10, 0.37, 0.10], support, { rd: 0.023, res: 0.07 });
        S.ball([x, y + 0.66, z + sign * 0.49], 0.10, { r: [12, 13, 14, 10] }, { res: 0.065 });
      }
    }
    for (let i = 0; i < 68; i++) {
      const angle = i * 2.399963,
        radius = 0.75 * Math.sqrt(i / 68),
        x = cx + 1.38 + radius * Math.cos(angle),
        z = cz + radius * Math.sin(angle),
        y = height(x, z);
      if (route.closest([x, y, z]).distance < 0.52 || clearance(x, y, z) < 0.15) continue;
      S.ball([x, y + 0.04, z], [0.045, 0.08 + 0.08 * B.R(), 0.055], leaves, { res: 0.06 });
    }
    for (const [x, z] of [[-3.2, 2.0], [-2.7, -2.65], [3.45, 2.0], [0.25, 3.25], [2.7, -2.95]]) {
      const y = height(x, z);
      S.ball([x, y + 0.09, z], [0.24, 0.18, 0.22], leaves, { res: 0.075 });
      S.ball([x + 0.15, y + 0.16, z + 0.13], [0.15, 0.29, 0.15], leaves, { res: 0.075 });
    }

    S.bake();
    return B.finish({ cam: { target: [0, 0.08, 0], dist: 16, pitch: 0.68, yaw: 0.22 }, detail: 15, dither: 0.26, radius: 6.4 });
  }
});
