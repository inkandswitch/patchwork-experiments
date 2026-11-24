const floodValley = require('./biome-flood.js');

exports.dependencies = async ({KIT}) => {
  const valley = floodValley(KIT);
  const before = await valley.build();
  const after = await valley.cut();
  return {format:'ink-studio/spatial-dependencies',version:1,id:'highland-valley',
    fromRevision:before.id,toRevision:after.id,...after.dependencies,
    totals:{spanTiles:after.spans.tiles.length,splatChunks:after.chunks.length}};
};
