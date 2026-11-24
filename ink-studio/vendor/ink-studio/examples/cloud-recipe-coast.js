const coast = require('./cloud-shadows.js');

module.exports = kit => ({
  id: 'cloud-recipe-coast',
  name: 'Four skies over the same coast',
  seed:29,
  build(seed) {
    const { KIT: K } = kit;
    const world = coast(kit).build(seed);
    const cam = { target:[.2,1.74,-5.5], dist:19.2, pitch:-.029, yaw:.02, sway:0 };
    const skyEnvironment = K.skyEnvironment.compile({
      defaults:{ zenith:'#347fb8', horizon:'#d0e6e3', ground:'#557a8e',
        sunAltitude:.49,sunAzimuth:-2.42,sunStrength:.66 }
    });
    return { ...world, cam, skyEnvironment,
      cloudField:K.clouds.recipe('cumulus',{ seed }),
      cloudShadows:{ strength:.61, softness:.95 },
      liveSun:{ ...world.liveSun, direction:[-.60,.48,.59] },
      aerialPerspective:{ start:11, density:.024, contrast:.31 }
    };
  }
});
