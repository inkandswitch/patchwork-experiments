module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'river-processes',
  name: 'A river through the alluvium',
  seed: 1,
  build(seed) {
    const B = makeBuilder(38, [
      0x172b34, 0x3a3b31, 0x695941, 0x917856, 0xb1986b, 0xd0ae7f,
      0x2c443e, 0x4b6651, 0x758657, 0xa1a46c,
      0x163b51, 0x21627c, 0x3487a0, 0x56aab7,
      0x525650, 0x85857a, 0xb7ac88, 0xdac592
    ]);
    const S = K.sculpt(makeSculpt(B)),
      P = K.procedural,
      H = P.hydrology,
      advanced = Boolean(seed % 2),
      center = P.routes.polyline([[-5.0, 0.31, 0], [5.0, 0.13, 0]]),
      channel = advanced ? H.meander(center, {
        amplitude: 0.97, wavelength: 5.2, seed: 23, iterations: 5, curvatureGain: 0.018, smoothing: 0.31, spacing: 0.22
      }).route : center;
    const bedBase = (x, z) => 0.36 - x * 0.017 + 0.68 * Math.exp(-((x + 2.2) ** 2) / 3.3 - ((z + 2.35) ** 2) / 0.95) +
      0.066 * Math.cos(x * 1.35 - z) + 0.035 * Math.sin(z * 3.6);
    const raw = H.analyze(bedBase, { bounds: { min: [-5.1, -1, -3.5], max: [5.1, 3, 3.5] }, cell: 0.19, channelArea: 2.2 }),
      incision = H.incise(raw, { strength: 0.33, minArea: 0.4, maxDepth: 0.23 }),
      eroded = (x, z) => bedBase(x, z) - (advanced ? incision.incision(x, z) ?? 0 : 0);
    const banks = H.corridor([channel], eroded, {
      channelWidth: 0.32, floodWidth: 1.28, maxRise: 0.38, maxSlope: 0.58, leveeWidth: 0.32, leveeHeight: 0.145
    });
    const plan = P.contacts.field([channel.points.map(([x, , z]) => [x, 0, z])]),
      distance = (x, z) => plan.distance(x, 0, z),
      climate = H.habitat(raw, { wind: [1, 0.3], waterDistance: distance, waterRange: 0.65, humidity: 0.5 }),
      wet = K.tab2((x, z) => banks.floodplain(x, z) * 0.75 + (climate.sample(x, z)?.moisture ?? 0) * 0.38,
        [-5.2, 5.2, -3.45, 3.45], 0.115);
    const biomes = P.biomes.create({
      fallback: 'alluvium',
      conditions: (x, y, z) => ({ moisture: Math.min(1, wet(x, z)) }),
      regions: advanced ? [{
        id: 'floodplain',
        bounds: { min: [-5.2, -2, -3.45], max: [5.2, 3, 3.45] },
        weight: (x, y, z, time, { moisture }) => Math.min(1, moisture + 0.07)
      }] : []
    });
    const isFloodplain = (x, y, z) => advanced && biomes.sample(x, y, z).biome === 'floodplain';
    const y = K.tab2((x, z) => {
      const { river, distance = Infinity, levee } = banks.sample(x, z),
        soil = eroded(x, z) + (advanced ? levee : 0);
      if (river === null) return soil;
      const carve = Math.max(0, 1 - Math.max(0, distance - 0.24) / 0.23);
      return soil + (Math.min(soil, river - 0.08) - soil) * carve;
    }, [-5.2, 5.2, -3.45, 3.45], 0.075);
    const land = {
      r: [1, 2, 3, 4, 5],
      mod: (x, y, z) => (B.n3(x * 3, y * 2, z * 3) - 0.5) * 0.27,
      tex(x, y, z, ny, t) {
        if (isFloodplain(x, y, z) && distance(x, z) > 0.31) return S.pick([6, 7, 8, 9], t);
      }
    };
    S.ground(land, {
      h: y, rad: 5.09, zs: 1.48, edge: 0.025, res: 0.092,
      keep: (x, z) => Math.abs(x) < 4.95
    });
    K.sweep(S, channel.points.map(([x, y, z]) => [x, y - 0.035, z]), { w: 0.306, h: 0.04 },
      { r: [10, 11, 12, 13], mod: (x, y, z) => 0.15 * Math.sin(15 * x + Math.sin(16 * z)) }, { res: 0.064 });
    const dice = K.grow.dice(38),
      reeds = { r: [6, 7, 8, 9] },
      stone = { r: [14, 15, 16, 17] };
    for (let i = 0; i < 160; i++) {
      const x = (dice() * 2 - 1) * 4.55, z = (dice() * 2 - 1) * 2.9,
        d = distance(x, z), chance = dice(), h = y(x, z);
      if (d < 0.34 || Math.hypot(x / 4.8, z / 3.1) > 1) continue;
      if (chance < 0.64 && isFloodplain(x, h, z)) {
        for (let k = -1; k <= 1; k++) {
          const a = [x + k * 0.028, h, z], p = [x + k * 0.057, h + 0.16 + 0.09 * dice(), z + 0.042];
          S.tube([a, p], 0.026, 0.013, reeds, { res: 0.056 });
        }
      } else if (chance < 0.09) {
        const r = 0.16 + 0.07 * dice();
        S.rock([x, h + r * 0.25, z], r, stone, { res: 0.063 });
      }
    }
    S.bake();
    return B.finish({ cam: { target: [0, 0.23, 0], dist: 13.4, pitch: 0.78, yaw: 0.16 }, detail: 19, dither: 0.25, radius: 5.45 });
  }
});
