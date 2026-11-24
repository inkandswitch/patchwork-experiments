const width = 224, height = 192, cell = 0.25, gateX = width * cell / 2;
const bed = Array.from({ length: height }, (_, z) => ({
  bounds: { min: [0, z * cell], max: [width * cell, (z + 1) * cell] },
  value: Math.round(z * Math.sin(z * 0.15)) * 0.0004
}));
const entities = Object.fromEntries(Array.from({ length: 2048 }, (_, i) => ['plot-' + i, {
  position: [i % 40 * 1.3, 0, Math.floor(i / 40) * 0.85],
  tags: ['survey-plot'], metadata: { plot: i, bank: i % 2 ? 'north' : 'south' }
}]));

module.exports = {
  format: 'ink-studio/world',
  id: 'checkpoint-branch',
  dt: 0.035,
  entities,
  systems: {
    canal: {
      kind: 'water',
      config: {
        width, height, cell, bed,
        initial: [{ bounds: { min: [3, 3], max: [gateX, 9] }, value: 0.85 }],
        gates: { sluice: {
          bounds: { min: [gateX - 0.01, 0], max: [gateX + 0.01, height * cell] },
          axis: 0, opening: 0
        } },
        sensors: { outlet: [gateX + 0.13, 5] }
      }
    }
  }
};
