const cliff = require('./review-cliff-path.js');
const bands = require('./atmosphere-depth-bands.json');

module.exports = kit => {
  const scene = cliff(kit);
  return {
    ...scene,
    id:'cliff-depth-bands',
    name:'Mist in three depth bands at the cliff path',
    build(seed) {
      const world = scene.build(seed);
      return { ...world, cloudRepresentation:'off', atmosphere:[], atmosphereDepthBands:bands,
        volumeQuality:{scale:2,steps:105,depthTolerance:.19} };
    }
  };
};
