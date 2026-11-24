/* Matched specimens for comparing material response under a moving key light. */
module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'material-lighting-ramps',
  name: 'Cloth, iron and worn stone',
  seed: 71,
  build(seed) {
    const swatches = {
      studio: [0x121520, 0x1a2030, 0x232d3c, 0x323e4d, 0x435162, 0x596777, 0x7a8791],
      cloth: [0x262441, 0x323252, 0x3a4163, 0x465574, 0x516a86, 0x638197, 0x7d9aab],
      iron: [0x191d25, 0x242b34, 0x303942, 0x47535c, 0x65747e, 0xa9bbc0, 0xf0f2db],
      stone: [0x37252b, 0x543733, 0x754d3e, 0x906746, 0xb08355, 0xce9e66, 0xe7bb7f, 0xf3d09d],
      polish: [0x7e5c40, 0xba8e56, 0xe7bb7f, 0xf3d09d]
    };
    const palette = [], roles = {};
    for (const [role, colors] of Object.entries(swatches)) {
      roles[role] = colors.map(color => {
        if (!palette.includes(color)) palette.push(color);
        return palette.indexOf(color);
      });
    }
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const left = [-0.7, 0.48, 0.7], right = [0.66, 0.38, 0.72];
    Object.assign(S, { pixel: true, sun: left, amb: 0.52, sunK: 0.42 });

    const fabric = K.surface.material(roles.cloth, {
      direction: 'y',
      normal: { type: 'waves', amplitude: 0.035, scale: 0.16 },
      layers: {
        weave: { type: 'diffuse', lightingRamp: {
          role: 'cloth', interpolation: 'smooth', positions: [0, 0.10, 0.25, 0.44, 0.67, 0.86, 1]
        } },
        nap: { type: 'sheen', color: roles.cloth[3], power: 2, strength: 0.3 }
      }
    });
    const iron = K.surface.material(roles.iron.slice(0, 4), {
      direction: 'x',
      normal: { type: 'noise', amplitude: 0.032, scale: 0.18 },
      layers: {
        body: { type: 'diffuse', lightingRamp: {
          stops: [[0, roles.iron[0]], [0.38, roles.iron[1]], [0.72, roles.iron[2]], [1, roles.iron[3]]]
        } },
        glint: { type: 'specular', roughness: [0.12, 0.30], shadow: false, lightingRamp: {
          role: 'iron', positions: [0, 0.12, 0.24, 0.39, 0.56, 0.77, 1], weights: [0, 0.03, 0.16, 0.43, 0.71, 0.94, 1]
        } }
      }
    });
    const sandstone = K.surface.material(roles.stone, {
      normal: { type: 'noise', amplitude: 0.065, scale: 0.21 },
      layers: {
        body: { type: 'diffuse', lightingRamp: {
          role: 'stone', positions: [0, 0.11, 0.25, 0.40, 0.57, 0.77, 0.95, 1]
        } },
        worn: { type: 'specular', roughness: 0.53, strength: 0.58, lightingRamp: { role: 'polish' } }
      }
    });
    const neutral = { r: roles.studio.slice(1, 6) };
    const trim = { r: roles.studio.slice(2) };
    S.box([0, -0.28, -0.15], [6, 0.18, 3.3], neutral, { res: 0.15, rd: 0.09 });
    for (const [index, material] of [fabric, iron, sandstone].entries()) {
      const x = (index - 1) * 2.04;
      S.box([x, -0.015, 0], [0.84, 0.136, 0.76], neutral, { res: 0.062, rd: 0.075 });
      S.box([x, 0.09, 0], [0.73, 0.054, 0.68], trim, { res: 0.055, rd: 0.039 });
      S.ball([x, 0.83, 0.04], [0.732, 0.735, 0.732], material, { res: 0.044 });
    }
    S.bake();
    return B.finish({
      cam: { target: [0, 0.62, 0], dist: 4.65, yaw: 0, pitch: 0.13, sway: 0, ortho: true },
      detail: 25, radius: 5, dither: 0, paletteRoles: roles,
      surfaceLight: [[0, ...left], [1.5, ...right], [3, ...left]],
      look: { pixel: true, splatCoverage: 'continuous' }
    });
  }
});
