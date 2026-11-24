module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'beacon-pool',
  name: 'Beacon pool',
  seed: 7,
  build(seed, { lighting = false } = {}) {
    const palette = [
      0x11171e, 0x192530, 0x263946, 0x36525c, 0x567178, 0x809795, 0x101e27, 0x172e3c, 0x214658, 0x316777, 0x54a0a6,
      0x9cdddd, 0xe5ece1, 0x422b2a, 0x6f4030, 0xa66942, 0xe5aa6c, 0xffdc9a, 0xfff1d4, 0x557a85, 0x806057, 0xa87854
    ];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    S.pixel = true;
    S.amb = 0.18;
    S.sky = 0.22;
    S.sunK = 0.55;
    S.sun = K.V.norm([-0.48, 0.8, 0.37]);
    const stone = { r: [1, 2, 3, 4, 5], materialId: 'stone' };
    const wet = K.surface.preset('wet-cobblestone', { r: [1, 2, 3, 4], materialId: 'stone' });
    const brass = K.surface.preset('brushed-brass', { r: [13, 14, 15, 16], materialId: 'brass' }, { direction: 'y' });
    const waterline = -0.24;
    const rings = K.ripple.field({
      amplitude: 0.46,
      scale: 0.58,
      speed: 1.15,
      width: 0.72,
      damping: 0.25,
      drops: [
        { at: [-0.67, waterline, 0.22], start: 0.1, repeat: 3.2 },
        { at: [1.1, waterline, -0.22], start: 0.85, repeat: 3.2, strength: 0.66 }
      ]
    });
    const mirror = K.reflection.plane({ id: 'pool', at: [0, waterline, 0] });
    const water = K.reflection.material(
      K.surface.preset(
        'rippling-water',
        { r: [6, 7, 8, 9], a: 0.58, materialId: 'water' },
        {
          normal: rings.normal,
          layers: {
            sky: { sky: '#40818e', horizon: '#377587', ground: '#203946', f0: 0.04, strength: 0.42 },
            sun: { color: '#dbe9de', roughness: [0.28, 0.13], strength: 0.65 },
            ripples: { color: '#9cdddd', strength: 0.48 }
          }
        }
      ),
      'pool',
      { f0: 0.78, distortion: 13, blur: 0.7, color: '#c3e6ed' }
    );
    S.ball([0, -1.89, 0], [2.72, 0.12, 1.63], { r: [6, 7, 7] }, { res: 0.15 });
    const wall = { r: [1, 2, 2, 3], materialId: 'stone' };
    for (let i = 0; i < 28; i++) {
      const a = (i * Math.PI * 2) / 28;
      const x = 2.72 * Math.cos(a),
        z = 1.59 * Math.sin(a);
      const ax = B.frame(Math.atan2(1.59 * Math.cos(a), -2.72 * Math.sin(a)), 0, 0);
      S.box([x, -1.09, z], [0.36, 0.8, 0.23], wall, { res: 0.12, rd: 0.065, ax });
      S.box([x, -0.31, z], [0.29, 0.14 + 0.03 * Math.sin(i * 2.29), 0.19], i % 3 ? wet : stone, {
        res: 0.095,
        rd: 0.066,
        ax
      });
    }
    for (const [x, z, height] of [
      [-1.44, -0.69, 1.04],
      [-0.08, -0.98, 1.65],
      [1.4, -0.58, 1.24]
    ]) {
      S.box([x, -0.26, z], [0.29, 0.25, 0.27], wet, { res: 0.076, rd: 0.05 });
      S.lathe([x, -0.02, z], height * 0.78, [0.085, 0.05], brass, { res: 0.046 });
      const top = height * 0.78;
      S.box([x, top + 0.16, z], [0.1, 0.17, 0.1], { r: [17, 18], em: true }, { res: 0.033, rd: 0.034 });
      S.lathe([x, top + 0.33, z], 0.14, [0.16, 0.05], brass, { res: 0.048 });
      S.lathe([x, top - 0.015, z], 0.045, [0.13, 0.13], brass, { res: 0.048 });
    }
    const shadow = lighting ? K.atmosphere.occluder(S.modelSource().field.sdf, { steps: 20 }) : undefined;
    S.bake();
    S.sun = K.V.norm([0.55, 0.52, -0.66]);
    S.ball([0, waterline - 0.025, 0], [2.57, 0.025, 1.45], water, { res: 0.07, ghost: true });
    S.bake();
    return B.finish({
      cam: { target: [0, -0.07, -0.04], dist: 8.7, yaw: -0.22, pitch: 0.78, sway: 0 },
      radius: 7,
      detail: 36,
      dither: 0,
      reflections: [mirror],
      atmosphere: [
        K.atmosphere.fog({ top: -0.35, density: 0.11, color: '#283a47', near: 5.9, far: 11 }),
        K.atmosphere.sphere({ at: [0.64, 0.06, -1.4], radius: 1.55, density: 0.11, color: '#627f88' }),
        K.atmosphere.shaft({
          from: [-0.08, 1.58, -0.98],
          to: [0.33, -0.1, -0.57],
          radius: 0.16,
          density: 0.49,
          color: '#e1bc80'
        })
      ],
      ...(lighting && {
        volumeLighting: {
          ambient: .52,
          sun: { direction: [-.38, .8, .48], color: '#afc8ee', intensity: .78, distance: 8 },
          point: { at: [-.08, 1.49, -.77], radius: 3.6, color: '#ffb872', intensity: 4.2 },
          shadow
        }
      }),
      look: { pixel: true, outline: true, clean: true }
    });
  }
});
