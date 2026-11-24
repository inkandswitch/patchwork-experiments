// Headless recipe example. Asset and sound IDs belong to the consuming project.
module.exports = (K, snapshot) => {
  const { biomeRecipes, waterBodies } = K.procedural;
  const inlet = waterBodies.create({
    id: 'clear-inlet', bounds: { min: [0, 0], max: [8, 6] },
    sample: () => ({ bed: -4, surface: 0, current: [0.18, 0] })
  });
  const cave = waterBodies.create({
    id: 'lower-pool', bounds: { min: [0, 0], max: [8, 6] },
    sample: () => ({ bed: -12, surface: -7 })
  });
  const water = waterBodies.scene([inlet, cave]);
  return biomeRecipes.create({
    seed: 26, fallback: 'alpine', snapshot,
    media: water.media,
    conditions(x, y, z, time, medium) {
      return {
        moisture: x >= -7 && x < 0 ? 0.86 : 0.28,
        exposure: medium.id === 'lower-pool' ? 0.04 : x < -7 ? 0.93 : 0.63,
        clarity: medium.id === 'clear-inlet' && x < 6 ? 0.92 : 0.24
      };
    },
    regions: [
      { id: 'ridge', biome: 'alpine', bounds: { min: [-16, 3, 0], max: [-6, 9, 8] } },
      { id: 'estuary', biome: 'marsh', bounds: { min: [-7, -0.25, 0], max: [0, 1.8, 8] }, weight: 0.85 },
      { id: 'inlet', biome: 'kelp-bed', bounds: { min: [0, -4, 0], max: [8, 0, 6] } },
      { id: 'deep-chamber', biome: 'flooded-cave', bounds: { min: [0, -12, 0], max: [8, -7, 6] } }
    ],
    recipes: [
      {
        id: 'alpine', landform: { kind: 'ridge', height: { type: 'ridge',
          source: { type: 'simplex', axes: ['x', 'z'], scale: 3 }, octaves: 3 } },
        strata: { fallback: 'scree', layers: [{ min: -10, max: -0.4, material: 'slate' }] },
        materials: { scree: ['#535d66', '#aeb6b9', '#e1e8eb'], slate: ['#272f3e', '#5d6877'] },
        habitat: { media: ['air'], ranges: { elevation: { min: 3, fade: 2 } } },
        populations: [{ id: 'crust', species: 'lichen', asset: 'silver-lichen', density: 0.8,
          habitat: { media: ['air'], ranges: { elevation: { min: 2.5 }, exposure: { min: 0.65 } } } }],
        landmarks: [{ id: 'beacon', at: [0.74, 0.67, 0.61], asset: 'stone-beacon', jitter: 0.42, clearance: 0.8 }],
        routes: [{ id: 'ascent', points: [[0.08, 0.15, 0.14], [0.45, 0.5, 0.39], { landmark: 'beacon' }], clearance: 0.35 }],
        ambient: [{ id: 'ridge-wind', gain: 0.8 }], traversal: ['walk', 'slide']
      },
      {
        id: 'marsh', landform: { kind: 'tidal-flat', height: -0.15 },
        strata: { fallback: 'silt', layers: [{ min: -3, max: -0.2, material: 'peat' }] },
        materials: { silt: ['#423c34', '#7d6945', '#a78c62'], peat: ['#29221d', '#5b4537'] },
        habitat: { ranges: { moisture: { min: 0.65, fade: 0.15 }, elevation: { max: 1.4, fade: 0.3 } } },
        populations: [{ id: 'stands', species: 'reed', asset: 'salt-reed', density: 0.92,
          habitat: { media: ['air'], ranges: { moisture: { min: 0.7 } } } }],
        landmarks: [{ id: 'post', at: [0.42, 0.43, 0.67], asset: 'tide-post', clearance: 0.4 }],
        routes: [{ id: 'boardwalk', points: [[0.06, 0.43, 0.12], { landmark: 'post' }, [0.9, 0.43, 0.92]], clearance: 0.4 }],
        ambient: [{ id: 'reed-rustle', gain: 0.6 }, { id: 'tide', gain: 0.3 }], traversal: ['wade', 'walk']
      },
      {
        id: 'kelp-bed', landform: { kind: 'shelf', height: -0.5 },
        strata: { fallback: 'shell-sand', layers: [{ min: -4, max: -0.3, material: 'basalt' }] },
        materials: { 'shell-sand': ['#526970', '#a2ad86'], basalt: ['#243445', '#54716c'] },
        habitat: { media: ['water'], ranges: { depth: { min: 0.2, max: 4 } } },
        populations: [{ id: 'canopy', species: 'kelp', asset: 'ribbon-kelp', density: 0.93,
          habitat: { media: ['water'], ranges: { clarity: { min: 0.7, fade: 0.1 }, depth: { min: 0.8, max: 3.4 } } } }],
        landmarks: [{ id: 'rock', at: [0.31, 0.31, 0.62], asset: 'reef-arch', clearance: 0.45 }],
        ambient: [{ id: 'inlet-flow', gain: 0.46 }], traversal: ['swim', 'current']
      },
      {
        id: 'flooded-cave', landform: { kind: 'chamber', height: -0.28 },
        strata: { fallback: 'limestone', layers: [{ min: -5, max: -0.75, material: 'shale' }] },
        materials: { limestone: ['#3b444c', '#66898a'], shale: ['#182535', '#374b5f'] },
        habitat: { media: ['water'], ranges: { exposure: { max: 0.12 } } },
        populations: [{ id: 'glow', species: 'glow-moss', asset: 'cave-glow-moss', density: 0.72,
          habitat: { media: ['water'], ranges: { exposure: { max: 0.1 }, depth: { min: 1.2 } } } }],
        landmarks: [{ id: 'arch', at: [0.55, 0.3, 0.57], asset: 'sunken-arch', jitter: 0.25 }],
        routes: [{ id: 'dive', points: [[0.13, 0.43, 0.15], { landmark: 'arch' }], clearance: 0.5 }],
        ambient: [{ id: 'cave-reverb', gain: 0.55 }], traversal: ['swim', 'low-visibility']
      }
    ]
  });
};
