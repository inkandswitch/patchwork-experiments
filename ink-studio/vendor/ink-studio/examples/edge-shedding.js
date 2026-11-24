const seal = require('./stipple.json');

module.exports = ({ makeBuilder, KIT: K }) => ({
  id: 'edge-shedding',
  name: 'Edge shedding',
  seed: 42,
  build(seed) {
    let source, system;
    const spec = structuredClone(seal);
    spec.seed = seed;
    spec.camera.yaw += Math.PI / 4;
    const FX = K.splatEffects;
    const world = K.diorama.build(spec, {
      makeBuilder(seed, palette) {
        const B = makeBuilder(seed, palette);
        const finish = B.finish;
        B.finish = options => {
          system = FX.emitter(B, {
            source: (...args) => source(...args),
            rate: 180, start: -0.7, lifetime: [0.25, 0.72], size: 0.0055,
            speed: 0.22, spread: 0.10, drift: [-0.04, 0.055, 0],
            density: 1.35, seed,
            color(hit, rand) {
              if (hit.luma > 0.37 || rand() < 0.12) return 19;
              return hit.luma > 0.22 ? 6 : 5;
            }
          });
          return finish(options);
        };
        return B;
      }
    });
    const { target, yaw, pitch, dist } = world.cam;
    const eye = K.V.mad(target, [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)], dist);
    source = FX.surfaceSource(world, {
      eye, lit: true, grazing: 0.46, minLuma: 0.065, attempts: 36,
      weight: ({ position, luma }) => position[1] > 0.05 ? Math.min(1, luma * 4) : 0.18
    });
    const stage = K.stage(world);
    stage.add(system);
    return world;
  }
});
