module.exports = ({ KIT: { world: W } }) => {
  const water = gate => ({
    kind: 'water', config: { width: 8, height: 4, cell: 0.5,
      initial: [{ bounds: { min: [0, 0], max: [2, 2] }, value: 0.65 }],
      gates: { [gate]: { bounds: { min: [1.99, 0], max: [2.01, 2] }, axis: 0, opening: 0 } }
    }
  });
  const timer = ticks => ({ kind: 'control', config: { op: 'timer', ticks } });
  const original = W.manifest({
    id: 'prefab-upgrade-canal', dt: 0.05, causality: true,
    systems: { enable: { kind: 'control', config: { op: 'not' } },
      display: { kind: 'control', config: { op: 'pass' } } },
    prefabs: {
      'sluice.v1': {
        revision: 1, params: { span: 1 }, sockets: { tether: [0, 0, 1] },
        entities: { frame: { position: [0, 0, 0], sockets: { top: [0, 1, 0] } },
          panel: { position: [0, 0.2, 0], anchor: { entity: 'frame', socket: 'top' }, span: { $param: 'span' },
            thickness: 0.2, paint: 'red' } },
        systems: { clock: timer(8), pool: water('sluice') },
        ports: { arm: 'clock/enabled', count: 'clock/value', open: 'pool/gate.sluice' }
      },
      'sluice.v2': {
        revision: 2, source: 'sluice.v1', params: { width: 1.25 }, sockets: { mount: [0, 0, 1] },
        entities: { housing: { position: [0, 0, 0], sockets: { lug: [0, 1.25, 0] } },
          panel: { position: [0, 0.2, 0], anchor: { entity: 'housing', socket: 'lug' }, width: { $param: 'width' },
            thickness: 0.4, finish: 'blue' } },
        systems: { counter: timer(12), basin: water('door') },
        ports: { run: 'counter/enabled', progress: 'counter/value', aperture: 'basin/gate.door' }
      }
    }
  });
  const placed = W.stamp(original, 'sluice.v1', 'lock', {
    position: [2, 0, 2], params: { span: 2.4 },
    overrides: [
      { op: 'set', path: '/entities/lock.panel/thickness', value: 0.2 },
      { op: 'set', path: '/entities/lock.panel/paint', value: 'bronze' }
    ]
  }).world;
  return W.apply(placed, [
    { op: 'merge', path: '/entities', value: {
      plaque: { position: [0, 0.1, 0], anchor: { entity: 'lock.frame', socket: 'top' } },
      rope: { position: [0, 0, 0], anchor: { entity: 'lock', socket: 'tether' } }
    } },
    { op: 'set', path: '/connections', value: [
      { from: 'enable/value', to: 'lock/arm' },
      { from: 'lock/count', to: 'display/value', delay: 2 }
    ] },
    { op: 'set', path: '/commands', value: [
      { tick: 1, action: 'lock.pool/gate', args: { gate: 'sluice', opening: 0.35 } },
      { tick: 8, action: 'lock.pool/gate', args: { gate: 'sluice', opening: 0.85 } }
    ] },
    { op: 'set', path: '/simulationChunks', value: {
      grid: { size: 8 }, levels: [{ id: 'near', within: 8 }, { id: 'sleep', sleep: true }],
      focus: { operator: { at: { entity: 'lock', socket: 'tether' } } },
      chunks: { reach: { index: [0, 0], systems: ['lock.clock', 'lock.pool'] } }
    } }
  ]).world;
};
