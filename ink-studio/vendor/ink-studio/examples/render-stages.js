module.exports = ({ KIT }) => {
  const source = require('./look-assets.json');
  const blue = {
    name: 'Cobalt enamel',
    steps: [{ type: 'channelMix', matrix: [[.52, .05, 0], [.12, .67, 0], [.25, .18, .66]], offset: [.025, .075, .22] }]
  };
  const palette = {
    palette: ['#131d33', '#253551', '#38537d', '#537da4', '#77a6c6', '#a6ced4', '#dce9df',
      '#79504a', '#d98a50', '#ffe4a2'],
    dither: { pattern: 'bayer', strength: .65 }
  };
  const asset = 'relay/cobalt';
  const pack = {
    format: 'ink-studio/asset-pack', id: 'relay', title: 'Relay finishes', version: 1, revision: 1,
    looks: [{ id: asset, label: 'Cobalt enamel', stack: blue }]
  };
  return {
    id: 'explicit-render-stages', name: 'Relay workshop', seed: source.seed,
    build(seed, { controls } = {}) {
      const stage = controls?.stage ?? 'material';
      if (!['material', 'lit', 'frame', 'palette', 'review'].includes(stage))
        throw new Error('Choose material, lit, frame, palette or review');
      const scene = JSON.parse(JSON.stringify(source));
      scene.id = 'explicit-render-stages';
      scene.seed = seed;
      scene.assetPacks = [pack];
      scene.finish.look = { pixelSize: 2 };
      if (stage === 'material' || stage === 'lit') {
        scene.finish.look.targets = [{ select: { entity: 'sea-glaze' }, asset, stage }];
      } else {
        scene.finish.look.asset = { asset, stage: 'frame' };
        if (stage === 'palette' || stage === 'review') scene.finish.look.renderStages = [{ stage:'palette', palette }];
        if (stage === 'review') scene.finish.look.renderStages.unshift({
          stage:'material', select:{entity:'sea-glaze'},
          stack:{name:'Warm enamel',steps:[{type:'channelMix',
            matrix:[[.92,0,0],[0,.67,0],[0,0,.49]],offset:[.045,0,.01]}]}
        });
      }
      for (const relay of scene.solids.filter(solid => solid.mat?.lookAsset)) {
        relay.mat = {
          role: relay.id === 'sea-glaze' ? 'bone' : 'wood',
          surface: {
            layers: {
              warm: { type: 'sheen', color: '#ffab56', strength: .85, power: 1.15 },
              gloss: { type: 'specular', color: '#ffe0a2', strength: .9, roughness: [.21, .36], shadow: false }
            }
          }
        };
      }
      return KIT.diorama.build(scene);
    }
  };
};
