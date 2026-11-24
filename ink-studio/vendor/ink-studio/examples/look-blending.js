const spillway = require('./wet-spillway.js');

module.exports = api => {
  const { KIT: K } = api, scene = spillway(api);
  const select = { surface: 'spillway-wall' };
  const pack = {
    format: 'ink-studio/asset-pack', version: 1, id: 'spillway', revision: 1, title: 'Spillway grades',
    looks: [
      { id: 'spillway/sandstone', label: 'Sandstone', stage: 'lit', order: 10, weight: .85,
        stack: { name: 'Sandstone', steps: [{ type: 'channelMix',
          matrix: [[1.04, .06, 0], [0, .9, 0], [0, 0, .61]], offset: [.19, .095, .025] }] } },
      { id: 'spillway/runoff', label: 'Runoff', stage: 'lit', order: 20, weight: .9,
        mask: { type: 'query', field: 'runoff/wetness', range: [.02, .9] },
        stack: { name: 'Runoff', steps: [{ type: 'exposure', stops: -1.6 }, { type: 'channelMix',
          matrix: [[.65, .06, 0], [0, .91, .07], [0, .12, 1.06]], offset: [.025, .065, .11] }] } },
      { id: 'spillway/blue-hour', label: 'Blue hour', stage: 'frame', order: 30, weight: .75,
        stack: { name: 'Blue hour', steps: [{ type: 'channelMix',
          matrix: [[.73, 0, 0], [.01, .84, .02], [.02, .06, 1.05]], offset: [.012, .038, .092] }] } }
    ]
  };
  const catalog = K.authoring.assetPacks.create({ packs: [pack] });
  return {
    ...scene, id: 'spillway-look-blending', name: 'Spillway at blue hour',
    build(seed, { controls } = {}) {
      const variant = controls?.variant ?? 'layered';
      if (!['base', 'layered', 'reversed'].includes(variant)) throw new RangeError('Choose base, layered or reversed');
      const world = scene.build(seed);
      const look = K.authoring.looks.scene({ pixelSize: 2, renderStages: [
        { asset: 'spillway/blue-hour', ...(variant === 'base' && { weight: 0 }) },
        { asset: 'spillway/runoff', select, ...(variant === 'base' && { weight: 0 }),
          ...(variant === 'reversed' && { order: 5 }) },
        { asset: 'spillway/sandstone', select }
      ] }, catalog);
      return { ...world, look };
    }
  };
};
