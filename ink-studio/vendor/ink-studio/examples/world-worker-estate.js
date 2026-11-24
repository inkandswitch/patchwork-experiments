const ponds = Object.fromEntries(Array.from({ length: 8 }, (_, i) => {
  const x = i * 24;
  return ['pond-' + i, { kind: 'water', config: {
    width: 24, height: 16, cell: 0.5, origin: [x, 0],
    initial: [{ bounds: { min: [x + 0.1, 0.1], max: [x + 4, 7.5] }, value: 0.5 + i * 0.05 }],
    accounts: { inlet: [x + 1, 1] },
    pumps: { circulation: { from: [x + 2, 2], to: [x + 7, 6], rate: 0 } },
    sensors: { gauge: [x + 1, 1] }
  } }];
}));
const names = Object.keys(ponds);
const focus = (tick, x) => ({ tick, action: 'world/chunk-focus', args: { id: 'observer', at: [x, 0, 2] } });

module.exports = {
  format: 'ink-studio/world',
  id: 'worker-estate',
  dt: 0.06,
  systems: {
    ...ponds,
    'control-pump': { kind: 'control', config: { op: 'pass' } },
    overflow: { kind: 'exchange', config: {
      links: { boundary: { from: 'pond-0/inlet', to: 'pond-1/inlet', rate: 0.25 } }
    } }
  },
  connections: [
    { from: 'control-pump/value', to: 'pond-0/pump.circulation' },
    { from: 'control-pump/value', to: 'pond-1/pump.circulation', sample: 'average' },
    { from: 'control-pump/value', to: 'pond-2/pump.circulation', delay: 2 }
  ],
  commands: [
    { tick: 2, action: 'world/input', args: { port: 'control-pump/value', value: 2 } },
    { tick: 7, action: 'pond-3/bed', args: { height: -0.15, bounds: { min: [72, 0], max: [75, 3] } } },
    focus(12, 700),
    focus(15, 175),
    focus(20, 0)
  ],
  simulationChunks: {
    grid: { size: 24 },
    levels: [
      { id: 'near', within: 45, substeps: 2 },
      { id: 'far', within: 190, every: 2 },
      { id: 'sleep', sleep: true }
    ],
    focus: { observer: { at: [0, 0, 2] } },
    chunks: Object.fromEntries(names.map((name, i) => ['reach-' + i, { index: [i, 0], systems: [name] }]))
  }
};
