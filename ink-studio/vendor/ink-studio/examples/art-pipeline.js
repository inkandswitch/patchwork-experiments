const beaconPool = require('./beacon-pool.js');

module.exports = kit => {
  const scene = beaconPool(kit);
  return {
    ...scene,
    id: 'art-pipeline',
    name: 'Beacon pool art pipeline',
    build(seed) {
      const world = scene.build(seed, { lighting: true });
      const { KIT: K } = kit;
      const density = K.procedural.density;
      const noise = K.procedural.fields.compile({ type: 'warp', strength: .4, scale: .6,
        source: { type: 'loop', axes: ['x', 'z'], scale: .37, period: 4.8, radius: .61 } }, { seed });
      const floorMist = density.fromSdf({
        bounds: { min: [-2.72, -.24, -2.0], max: [2.72, .68, 1.95] },
        field: (x, y, z) => (Math.hypot(x / 2.7, (y - .12 - .15 * Math.sin(x * 1.3)) / .29, z / 1.75) - 1) * .30,
        feather: .078, breakup: .89, noise: (x, y, z, time) => Math.max(0, noise(x, y, z, time) * .86 + .44),
        drift: [.08, .04], windInfluence: .6
      });
      const steam = density.fromSdf({
        bounds: { min: [-1.55, .02, -1.6], max: [1.18, 1.63, .78] },
        field: (x, y, z) => {
          const axis = .42 * Math.sin((y - .28) * 1.8);
          return (Math.hypot((x - axis) / .61, (y - .66) / .85, (z + .57) / .60) - 1) * .60;
        },
        feather: .27, breakup: .92, noise: (x, y, z, time) => Math.max(0, noise(x + y * .65, y, z, time) * 1.2 + .38)
      });
      world.atmosphere = [
        world.atmosphere[0],
        K.atmosphere.field({ field: floorMist, density: .65, step: .14, anisotropy: .21,
          ramp: ['#344e62', '#668c9e', '#b9d6d4'] }),
        K.atmosphere.field({ field: steam, density: .93, step: .15, anisotropy: .28,
          ramp: ['#344a62', '#637f99', '#a4bbbf'], emissive: '#6392a6', emissiveGain: .15 })
      ];
      world.volumeWind = [.12, .08];
      world.volumeQuality = { scale: 2, depthTolerance: .22, steps: 38 };
      world.look = {
        ...world.look,
        ink: {
          silhouette: { shadow: '#0b1927', highlight: '#9c8e70' },
          crease: { shadow: '#1b3445', highlight: '#6e898a' },
          boundary: { shadow: '#162839', highlight: '#b19267' },
          suppressSameMaterial: true,
          depthGap: .21,
          creaseCosine: .51,
          litAt: .59,
          materials: {
            brass: { ramp: [13, 14, 15, 16], crease: false, silhouette: { shadow: '#492a2b', highlight: '#e1ad73' } }
          },
          fogThreshold: .24,
          reserved: { emission: ['#d48144', '#ffd786', '#fff4d8'], fog: ['#192b37', '#304853', '#49616a', '#687c83'] }
        },
        effects: {
          glow: { bands: 2, radius: 2, colors: ['#493436', '#976041'], threshold: .32 },
          heat: { radius: 5, up: 3, pixels: 1, rate: 5, threshold: .34 },
          reflection: { colors: ['#b98260', '#e2ae6d', '#ffed9e'], rate: .75 },
          cycle: { colors: [7, 8, 9], rate: 2, material: 'water' }
        }
      };
      return world;
    }
  };
};
