const sides = [
  ['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]
];

module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'constraint-tiles',
  name: 'A paved junction and a ceramic panel',
  seed: 0,
  build(seed) {
    const palette = [
      0x17272d, 0x303332, 0x504039, 0x755343, 0x9b7761,
      0x293936, 0x3d5745, 0x607456, 0x819460,
      0x345060, 0x3d7782, 0x579da0, 0x86b5ae,
      0x9d754e, 0xc3a173, 0xe1c697, 0xf1dfb7,
      0x663936, 0x965742, 0xc68158
    ];
    const B = makeBuilder(9, palette),
      S = K.sculpt(makeSculpt(B)),
      T = K.procedural.tiles;
    const frame = { r: [1, 2, 3, 4] },
      ceramic = { a: { r: [9, 10, 11, 12] }, b: { r: [13, 14, 15, 16] }, c: { r: [17, 18, 19] } };
    if (seed % 2) {
      const swatch = [
          'ccbbccbb', 'ccbbccbb', 'bbaaabaa', 'bbaabbaa',
          'ccbbccbb', 'ccbbccbb', 'aabbaaab', 'aabbaabb'
        ],
        bank = T.learn(swatch, { size: 2, periodic: true }),
        pattern = T.overlap(bank, { width: 15, height: 11, seed: 91, pins: [{ x: 0, z: 0, value: 'c' }] });
      if (pattern.status !== 'ok') throw new Error('Demo swatch: ' + pattern.status);
      const w = 0.54;
      S.box([0, -0.15, 0], [4.16, 0.2, 3.08], frame, { rd: 0.085, res: 0.103 });
      for (let z = 0; z < pattern.height; z++) {
        for (let x = 0; x < pattern.width; x++) {
          S.box([(x - 7) * w, 0.1, (z - 5) * w], [0.25, 0.074, 0.25], ceramic[pattern.at(x, z)], { rd: 0.039, res: 0.062 });
        }
      }
    } else {
      const model = T.compile([
        { id: 'grass', weight: 8 }, { id: 'shrub', weight: 3 }, { id: 'stone', weight: 2 },
        ...Array.from({ length: 15 }, (_, i) => i + 1).flatMap(mask => {
          const sockets = Object.fromEntries(sides.map(([direction], i) => [direction, mask & (1 << i) ? 'path' : null]));
          return [{ id: 'paver-' + mask, weight: 5, sockets }, { id: 'worn-' + mask, weight: 1, sockets }];
        })
      ]);
      const planned = [
        [[0, 3], [1, 3], [2, 3], [2, 2], [3, 2], [4, 2], [5, 2], [5, 3], [6, 3], [7, 3], [8, 3]],
        [[4, 2], [4, 3], [4, 4], [4, 5]]
      ];
      const graph = new Map();
      function end(a, b) {
        const id = a.join(':');
        if (!graph.has(id)) graph.set(id, new Set());
        graph.get(id).add(sides.find(([direction, x, z]) => x === b[0] - a[0] && z === b[1] - a[1])[0]);
      }
      for (const route of planned) {
        for (let i = 1; i < route.length; i++) {
          end(route[i - 1], route[i]);
          end(route[i], route[i - 1]);
        }
      }
      const ports = [], pins = [],
        mask = (x, z) => !((x === 0 || x === 8) && (z === 0 || z === 6));
      for (let z = 0; z < 7; z++) {
        for (let x = 0; x < 9; x++) {
          if (!mask(x, z)) continue;
          const edges = graph.get(x + ':' + z);
          if (edges) {
            for (const [direction] of sides) ports.push({ x, z, direction, socket: edges.has(direction) ? 'path' : null });
          } else pins.push({ x, z, tiles: ['grass', 'shrub', 'stone'] });
        }
      }
      const plan = T.solve(model, { width: 9, height: 7, mask, pins, ports, seed: 23 });
      if (plan.status !== 'ok') throw new Error('Demo pavement: ' + plan.status);
      const w = 0.88,
        green = { r: [5, 6, 7, 8] },
        paving = { r: [13, 14, 15, 16] };
      const byId = new Map(model.tiles.map(tile => [tile.id, tile]));
      for (let z = 0; z < 7; z++) {
        for (let x = 0; x < 9; x++) {
          const id = plan.at(x, z);
          if (id === null) continue;
          const a = (x - 4) * w, b = (z - 3) * w;
          S.box([a, -0.14, b], [w * 0.5, 0.19, w * 0.5], frame, { rd: 0.027, res: 0.085 });
          S.box([a, 0.014, b], [w * 0.482, 0.070, w * 0.482], green, { rd: 0.029, res: 0.085 });
          if (id === 'shrub') S.ball([a + 0.06, 0.19, b], [0.24, 0.21, 0.21], green, { res: 0.068 });
          if (id === 'stone') S.rock([a, 0.12, b], 0.22, { r: [9, 10, 11, 12] }, { res: 0.063 });
          const { sockets } = byId.get(id);
          if (!Object.values(sockets).some(Boolean)) continue;
          const material = id.startsWith('worn') ? ceramic.c : paving;
          S.box([a, 0.11, b], [0.22, 0.05, 0.22], material, { rd: 0.022, res: 0.056 });
          for (const [name, dx, dz] of sides) {
            if (!sockets[name]) continue;
            const hx = dx ? 0.276 : 0.22, hz = dz ? 0.276 : 0.22;
            S.box([a + dx * 0.21, 0.108, b + dz * 0.21], [hx, 0.049, hz], material, { rd: 0.018, res: 0.058 });
          }
        }
      }
      for (const [x, z] of [[0, 3], [8, 3], [4, 5]]) {
        S.lathe([(x - 4) * w, 0.15, (z - 3) * w], 0.32, [0.105, 0.079], ceramic.c, { res: 0.066 });
      }
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.05, 0], dist: 11.5, pitch: 0.88, yaw: 0.16 }, detail: 18, dither: 0.24, radius: 5.2 });
  }
});
