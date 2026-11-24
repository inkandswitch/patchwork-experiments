module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'branching-networks',
  name: 'Roads and shared conduits',
  seed: 0,
  build(seed) {
    const B = makeBuilder(17, [
      0x16262e, 0x303a32, 0x596044, 0x75794f, 0x97905f,
      0x4e4840, 0x827160, 0xb18d6b, 0xd4b38b, 0xf0d0a3,
      0x264957, 0x3d7482, 0x5fa4ab, 0x96c5b7,
      0x512f32, 0x905241, 0xc47a50, 0xdb9f61
    ]);
    const S = K.sculpt(makeSculpt(B)),
      { routes } = K.procedural,
      elevation = (x, z) => 0.03 + 0.12 * Math.sin(x * 0.7 + z * 0.65) + 0.20 * Math.exp(-(x * x + z * z) * 0.18),
      sites = [[-3.7,-0.9],[-2.8,1.7],[-1.1,-1.63],[1.1,1.7],[3.5,0.59],[2.5,-1.93],[0.0,0.13],[1.11,-0.35],[-1.35,0.35]],
      points = sites.map(([x, z]) => [x, elevation(x, z) + 0.11, z]),
      conduit = Boolean(seed % 2),
      road = routes.network(points, { loops: 2, minStretch: 1.3 });
    if (road.status !== 'ok') throw new Error('Demo network failed');
    const conduitLinks = road.candidates.map(edge => ({
      ...edge, cost: edge.cost * (edge.a < 6 && edge.b < 6 ? 2.3 : 1)
    }));
    const plan = conduit ? routes.steiner(points, conduitLinks, [0, 1, 2, 3, 4, 5]) : road;
    if (plan.status !== 'ok') throw new Error('Demo network failed');
    S.ground({ r: [1,2,3,4], mod: (x,y,z) => (B.n3(x * 1.5, y, z * 1.5) - 0.5) * 0.27 },
      { h: elevation, rad: 4.64, edge: 0.03, zs: 1.57, res: 0.094 });
    for (const edge of plan.edges) {
      const samples = Array.from({ length: 15 }, (_, i) => {
        const [x, , z] = edge.route.sample(i / 14).point;
        return [x, elevation(x, z) + 0.08, z];
      });
      if (conduit) S.tube(samples, 0.11, 0.10, { r: [10,11,12,13] }, { res: 0.063 });
      else K.sweep(S, samples, { w: edge.loop ? 0.13 : 0.18, h: 0.055 }, { r: edge.loop ? [14,15,16,17] : [5,6,7,8,9] }, { res: 0.065 });
    }
    for (const [i, [x, y, z]] of points.entries()) {
      if (i >= 6 && !(plan.nodes?.includes(i) ?? true)) continue;
      const n = i >= 6 ? 0.15 : 0.25;
      S.lathe([x, y - 0.1, z], i >= 6 ? 0.2 : 0.44, [n, n * 0.78],
        { r: i >= 6 ? [5,6,7,8,9] : [14,15,16,17] }, { res: 0.058 });
      if (i < 6) S.ball([x, y + 0.31, z], [n * 0.74, n * 0.59, n * 0.74], { r: [6,7,8,9] }, { res: 0.058 });
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.2, 0], dist: 12.3, pitch: 0.89, yaw: 0.21 }, detail: 20, dither: 0.24, radius: 4.8 });
  }
});
