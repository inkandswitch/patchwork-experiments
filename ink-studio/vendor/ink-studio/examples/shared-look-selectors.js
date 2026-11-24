module.exports = ({ KIT }) => {
  const scene = JSON.parse(JSON.stringify(require('./look-assets.json')));
  scene.id = 'selected-relays';
  scene.name = 'Selected relays';
  const pack = require('./relay-look-pack.json');
  scene.assetPacks = [pack];
  const [west, east] = scene.solids.filter(solid => solid.mat?.lookAsset);
  west.surfaceId = 'west-enamel';
  east.surfaceId = 'east-enamel';
  east.tags = ['paint-sample'];
  scene.finish.look.targets = [
    { select: { entity: west.id, surface: 'west-enamel' }, asset: west.mat.lookAsset },
    { select: { tag: 'paint-sample', material: 'bone' }, asset: east.mat.lookAsset }
  ];
  delete west.mat.lookAsset;
  delete east.mat.lookAsset;
  return KIT.diorama.scene(scene);
};
