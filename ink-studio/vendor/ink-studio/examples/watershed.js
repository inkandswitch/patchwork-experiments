module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'watershed-example',
  name: 'Three streams and a pond',
  seed: 8,
  build(seed) {
    const palette = [
      0x18272f, 0x2d3932, 0x435641, 0x607650, 0x87985d, 0xafb36e,
      0x3f5355, 0x637471, 0x969689, 0xc7b994,
      0x194654, 0x22616d, 0x327e86, 0x5ba4a5, 0xa0c8b1,
      0x3e312a, 0x684837, 0x9e7050, 0xc49d6e
    ];
    const B = makeBuilder(seed, palette),
      S = K.sculpt(makeSculpt(B)),
      P = K.procedural,
      lake = (x, z) => Math.hypot((x - 0.58) / 1.2, (z - 0.65) / 0.85),
      level = 0.459;
    function height(x, z) {
      const edge = Math.abs(x - 0.57 * Math.sin(z * 0.75)),
        valley = 0.245 * (4 - z) + Math.min(1.3, edge * 0.31) +
          0.07 * Math.sin(x * 2.1 + z * 0.7) * Math.min(1, edge);
      const inlet = (at, amount) => Math.exp(-((x - at) ** 2) * 2) * Math.max(0, Math.min(1, amount));
      const tributaries = inlet(-1.35 * (z + 4) + 0.2, (-z - 1.1) * 0.8) + inlet(0.8 - z * 1.13, (0.2 - z) * 0.65);
      return valley - 0.28 * tributaries - 0.73 * Math.exp(-(lake(x, z) ** 2));
    }
    const basin = P.hydrology.analyze(height, {
      bounds: { min: [-5.2, -2, -4.2], max: [5.2, 4, 4.2] },
      cell: 0.2,
      channelArea: 3.4,
      wetnessArea: 4,
      lakeAt: (x, z) => lake(x, z) < 1 ? { id: 'pond', level } : null
    });
    const streams = basin.reaches.filter(reach => reach.route.points.some(p => Math.abs(p[2]) < 4));
    function streamDistance(x, z) {
      let distance = 10;
      for (const reach of streams) {
        const { min, max } = reach.route.bounds;
        if (x < min[0] - 0.5 || x > max[0] + 0.5 || z < min[2] - 0.5 || z > max[2] + 0.5) continue;
        const pts = reach.route.points;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i],
            dx = b[0] - a[0], dz = b[2] - a[2],
            t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz)));
          distance = Math.min(distance, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t));
        }
      }
      return distance;
    }
    const distance = K.tab2(streamDistance, [-5.3, 5.3, -4.3, 4.3], 0.09),
      wetness = K.tab2(basin.wetness, [-5.3, 5.3, -4.3, 4.3], 0.14),
      bank = (x, z) => height(x, z) - 0.11 * Math.max(0, 1 - distance(x, z) / 0.24),
      lakeDistance = (x, z) => Math.max((lake(x, z) - 1.08) * 0.85, bank(x, z) - level + 0.02),
      edge = (x, z) => Math.min((Math.hypot(x / 5.02, (z + 0.1) / 4.06) - 1) * 4.06, Math.max(Math.abs(x) - 0.39, z - 4.16, 3.7 - z)),
      inside = (x, z) => edge(x, z) < 0,
      coveredLake = (x, z) => lakeDistance(x, z) < 0,
      waterLevel = (x, z) => coveredLake(x, z) ? level : height(x, z) - 0.025,
      waterMask = (x, z) => Math.max(edge(x, z), Math.min(lakeDistance(x, z), distance(x, z) - 0.15)),
      cover = { x0: -5.1, x1: 5.1, z0: -4.18, z1: 4.18 };
    const soil = { r: [1, 2, 3, 4, 5], mod: (x, y, z) => (B.n3(x * 2, y * 2, z * 2) - 0.5) * 0.32 - wetness(x, z) * 0.18 },
      water = { r: [10, 11, 12, 13], mod: (x, y, z) => 0.28 * Math.sin(x * 16 + Math.sin(z * 3) * 0.6) },
      rock = { r: [6, 7, 8, 9] },
      leaves = { r: [2, 3, 4, 5] };
    S.terrain(soil, { ...cover, h: bank, keep: inside, res: 0.095 });
    S.add({
      bc: [0, 0.8, 0],
      br: 7,
      sd(x, y, z) {
        const offset = y - waterLevel(x, z);
        return Math.max(offset, -offset - 0.09, waterMask(x, z));
      },
      sample(emit) {
        for (let z = cover.z0; z <= cover.z1; z += this.res * 0.87)
          for (let x = cover.x0; x <= cover.x1; x += this.res) {
            if (waterMask(x, z) < 0) emit(x, waterLevel(x, z), z);
          }
      }
    }, water, { res: 0.066 });
    for (const [x, z, r] of [[-2.6, -2.8, 0.58], [-2.96, -3.1, 0.36], [2.83, -2.44, 0.58], [3.2, -2.05, 0.38], [-3.65, -0.26, 0.57], [3.55, 0.68, 0.61], [-2.84, 1.99, 0.38], [2.4, 2.61, 0.36]]) {
      S.rock([x, bank(x, z) + r * 0.3, z], r, rock, { res: 0.095 });
    }
    const dice = K.grow.dice(seed);
    for (let i = 0; i < 200; i++) {
      const x = (dice() * 2 - 1) * 4.9, z = (dice() * 2 - 1) * 3.97;
      if (!inside(x, z) || coveredLake(x, z) || distance(x, z) < 0.16) continue;
      const y = bank(x, z), wet = wetness(x, z), chance = dice();
      if (wet > 0.4 && chance < 0.78) {
        for (let j = -1; j <= 1; j++) {
          const t = 0.10 + 0.17 * dice();
          S.tube([[x + j * 0.03, y, z], [x + j * 0.07, y + t, z + 0.045]], 0.026, 0.013, leaves, { res: 0.058 });
        }
      } else if (chance < 0.21) {
        S.ball([x, y + 0.09, z], [0.13, 0.15 + 0.1 * dice(), 0.14], leaves, { res: 0.075 });
      }
    }
    S.bake();
    return B.finish({ cam: { target: [0, 1.0, 0], dist: 15, pitch: 0.81, yaw: 0.31 }, detail: 17, dither: 0.27, radius: 6.5 });
  }
});
