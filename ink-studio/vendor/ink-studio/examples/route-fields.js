module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'route-fields',
  name: 'Two paths through the ruins',
  seed: 0,
  build(seed) {
    const B = makeBuilder(24, [
      0x19282f, 0x3a352d, 0x665c43, 0x847855, 0xa59b69,
      0x2f414f, 0x425f67, 0x638282, 0x8c9a8c,
      0x505851, 0x747a64, 0x9a967a, 0xbab58c,
      0x936a4a, 0xb29164, 0xcbb485, 0xe7d29d, 0xf1dfb1
    ]);
    const S = K.sculpt(makeSculpt(B)),
      P = K.procedural,
      roadHeight = (x, z) => 0.13 + Math.sin(x * 0.6 - z * 0.8) * 0.045,
      ground = (x, z) => roadHeight(x, z) - 0.092,
      start = [-4.4, 0],
      end = [4.28, 0],
      wall = { x: 0, z: -0.16, u: 1.19, v: 0.91 };
    const island = (x, z) => Math.hypot(Math.max(0, Math.abs(x - wall.x) - wall.u), Math.max(0, Math.abs(z - wall.z) - wall.v)) +
      Math.min(0, Math.max(Math.abs(x - wall.x) - wall.u, Math.abs(z - wall.z) - wall.v)),
      slow = (x, z) => Math.hypot((x + 0.25) / 2.3, (z - 1.42) / 0.82),
      wet = (x, z) => slow(x, z) < 1.1;
    let route;
    if (seed % 2) {
      const wave = P.routes.travelTime([end], {
        bounds: { min: [-4.9, -3], max: [4.9, 3] },
        cell: 0.19,
        speed: (x, z) => island(x, z) < 0.34 ? 0 : wet(x, z) ? 0.22 : 1
      });
      const path = wave.trace(start, { height: roadHeight });
      if (path.status !== 'ok') throw new Error('Travel route failed: ' + path.status);
      route = path.route;
    } else {
      const to3D = ([x, z]) => [x, roadHeight(x, z), z],
        pad = 0.46,
        polygon = [[-wall.u - pad, wall.z - wall.v - pad], [wall.u + pad, wall.z - wall.v - pad],
          [wall.u + pad, wall.z + wall.v + pad], [-wall.u - pad, wall.z + wall.v + pad]];
      const path = P.routes.visibility(to3D(start), to3D(end), [polygon]),
        smooth = P.routes.spline(path.route, { radius: 0.72, spacing: 0.12, clearance: (x, y, z) => island(x, z), minClearance: 0.29 });
      if (smooth.status !== 'ok') throw new Error('Visibility route failed: ' + smooth.status);
      route = smooth.route;
    }
    const soil = {
      r: [1, 2, 3, 4],
      mod: (x, y, z) => (B.n3(x * 2, y, z * 2) - 0.5) * 0.29,
      tex(x, y, z, ny, t) {
        if (wet(x, z)) return S.pick([5, 6, 7, 8], t);
      }
    };
    S.ground(soil, { h: ground, rad: 5.15, zs: 1.49, edge: 0.024, res: 0.093 });
    const rock = { r: [9, 10, 11, 12] };
    S.box([0, 0.19, wall.z], [wall.u, 0.22, wall.v], rock, { rd: 0.045, res: 0.075 });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.72,
        y = 0.69 + 0.14 * i;
      S.box([x, y * 0.5, wall.z], [0.32, y * 0.5, 0.78 - 0.09 * i], rock, { rd: 0.054, res: 0.07 });
    }
    K.sweep(S, route.points, { w: 0.255, h: 0.063 }, { r: [13, 14, 15, 16, 17] }, { res: 0.061 });
    for (const [x, z] of [start, end]) {
      for (const side of [-1, 1]) S.lathe([x, ground(x, z + side * 0.4), z + side * 0.4], 0.31, [0.09, 0.066], { r: [13,14,16,17] }, { res: 0.06 });
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.14, 0], dist: 13.5, pitch: 0.77, yaw: 0.12 }, detail: 19, dither: 0.21, radius: 5.4 });
  }
});
