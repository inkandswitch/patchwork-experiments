/* The print workshop with a protected mark, coarse relief and an export-size cloth fade. */
const workshop = require('./palette-dither-spaces.js');
const width = 48, height = 48;
const frame = Array.from({ length: width * height }, (_, i) => {
  const u = ((i % width) + .5) / width, v = (Math.floor(i / width) + .5) / height;
  const emblem = Math.hypot((u - .5) / .25, (v - .55) / .29);
  const caption = Math.max(Math.abs(u - .5) / .34, Math.abs(v - .17) / .12);
  const amount = Math.max(0, Math.min(1, (1 - Math.min(emblem, caption)) * 5));
  return [0, 0, 0, Math.round(255 * amount)];
}).flat();
const printMask = { type: 'texture', space: 'rest', scale: [2, 1.93], interpolation: 'linear',
  projection: { origin: [-3.85, .725, -.304], along: [1, 0, 0], across: [0, 1, 0] },
  raster: { width, height, frames: [frame] } };

module.exports = kit => ({
  id: 'palette-dither-scale', name: 'Print workshop dither scales', seed: 31,
  build(seed, { controls } = {}) {
    const mode = controls?.mode ?? 'tuned';
    if (!['tuned', 'unfiltered'].includes(mode)) throw new RangeError('Dither study mode must be tuned or unfiltered');
    const tuned = mode === 'tuned';
    const world = workshop(kit).build(seed);
    const walls = { type: 'axis', space: 'world', axis: 'y', range: [1.45, 1.68] };
    const settings = {
      paper: { scale: 2, ...(tuned && { regions: [{ mask: printMask, strength: 0 }] }) },
      cloth: { scale: .64, ...(tuned && { fade: [.86, 1.45] }) },
      relief: { scale: 1.05, regions: [{ mask: walls, scale: 1.95 }] }
    };
    world.look = { ...world.look, paletteConstraints: { targets: world.look.paletteConstraints.targets.map(target =>
      ({ ...target, dither: { ...target.dither, ...settings[target.material] } })) } };
    const near = { target: [0, 1.56, -.07], yaw: .11, pitch: .16, dist: 8.0, fov: .79 };
    const far = { ...near, yaw: -.06, pitch: .20, dist: 14.2 };
    const { cameraRig } = kit.KIT;
    return cameraRig.bind(world, cameraRig.compile({
      shots: { near, far },
      sequence: [{ time: 0, shot: 'near' }, { time: .4, shot: 'far', blend: 2.4 },
        { time: 3.2, shot: 'near', blend: 2.4 }],
      duration: 6
    }));
  }
});
