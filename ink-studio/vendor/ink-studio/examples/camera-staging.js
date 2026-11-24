/* Orbit an aqueduct landmark and check its framing in the exported crop. */
module.exports = api => {
  const scene = require('./selective-ink.js')(api), { KIT: K } = api;
  return {
    id: 'camera-staging', name: 'Around the aqueduct gate', seed: scene.seed,
    build(seed) {
      const world = scene.build(seed);
      world.look.cameraStaging = {
        guides: { safe: [.08,.10], thirds: true, center: false },
        subjects: [
          { id: 'gate', select: { object: 'near-gate' }, minPixels: 200, minHeight: 24 },
          { id: 'courier', select: { object: 'courier' }, minPixels: 140, minHeight: 24 }
        ],
        depthOfField: [{ depth: [12.5,28], radius: 3.5, feather: 2 }]
      };
      return K.cameraRig.bind(world, K.cameraRig.compile({
        orbit: { yaw: [-.31,.34], pitch: [.08,.24], distance: [9,13] },
        shots: {
          approach: { target: [-2.80,1.23,-1.81], yaw: -.23, pitch: .12, dist: 11.7, focalLength: 31 },
          reveal: { target: [-2.65,1.14,-2.15], yaw: .30, pitch: .19, dist: 12, focalLength: 34 }
        },
        sequence: [{ time: 0, shot: 'approach' }, { time: .1, shot: 'reveal', blend: 2.3 }],
        duration: 2.4
      }));
    }
  };
};
