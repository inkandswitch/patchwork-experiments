/* Named recipes for the shared shader. Effects and masks are ordinary settings
   so a preset can be combined with an existing sculpt material. */
(function (K) {
  const spec = (roughness, color, strength = 0.85, extra) => ({
    type: 'specular',
    roughness,
    color,
    strength,
    ...extra
  });
  const fiber = (roughness, color, strength, extra) => ({ type: 'fiber', roughness, color, strength, ...extra });
  const sheen = (color, strength, extra) => ({ type: 'sheen', color, strength, ...extra });
  const film = (thickness, strength, extra) => ({ type: 'film', thickness, strength, ...extra });
  const glints = (color, scale, strength = 1, extra) => ({ type: 'glints', color, scale, strength, ...extra });
  const reflect = (strength, extra) => ({ type: 'reflection', strength, ...extra });
  const waves = (amplitude, scale, speed = 0) => ({ type: 'waves', amplitude, scale, speed });
  const grain = (amplitude, scale) => ({ type: 'noise', amplitude, scale });
  const matte = '#f7f5ec';
  const waterSky = { sky: '#a9dbff', horizon: '#eff5ea', ground: '#344543' };
  const radial = { type: 'circular', axis: 'z' };
  const crossWeave = { type: 'weave', along: 'x', across: 'y', scale: 0.22 };

  const presets = {
    'brushed-steel': { direction: 'y', layers: { brush: spec([0.09, 0.58], '#dceeff', 1) } },
    'brushed-brass': {
      direction: 'y',
      layers: { brush: spec([0.1, 0.51], '#ffe9a2', 1), coat: reflect(0.4, { sky: '#ffd277' }) }
    },
    'machined-knob': {
      direction: radial,
      normal: { ...waves(0.025, 0.1), axis: 'x', cross: 'y' },
      layers: { grooves: spec([0.08, 0.63], '#e8f5ff', 1) }
    },
    'cross-brushed-metal': {
      direction: { ...crossWeave, scale: 0.37 },
      layers: { brush: spec([0.09, 0.49], '#d4e9ff', 1) }
    },
    'scratched-metal': {
      direction: 'y',
      layers: {
        gloss: spec(0.26, '#aabdcf', 0.47),
        scratches: spec([0.09, 0.7], '#eff8ff', 1, { mask: { type: 'stripes', axis: 'x', scale: 0.11, width: 0.19 } })
      }
    },
    'carbon-fibre': {
      direction: crossWeave,
      layers: { weave: spec([0.11, 0.48], '#9bb6c8', 0.9), resin: spec(0.12, '#e5f4ff', 0.45) }
    },
    satin: { direction: 'y', layers: { silk: spec([0.12, 0.53], '#ffdbca', 0.93), rim: sheen('#f998bc', 0.45) } },
    'woven-ribbon': {
      layers: {
        warp: spec([0.11, 0.44], '#fee2a6', 0.95, { mask: { type: 'stripes', axis: 'x', scale: 0.19, width: 0.6 } }),
        weft: spec([0.11, 0.44], '#f8af85', 0.65, {
          rotation: Math.PI / 2,
          mask: { type: 'stripes', axis: 'x', scale: 0.19, width: 0.6, invert: true }
        })
      }
    },
    corduroy: {
      direction: 'y',
      layers: {
        ribs: spec([0.16, 0.65], '#f4aa73', 0.88, { mask: { type: 'stripes', axis: 'x', scale: 0.2, width: 0.55 } }),
        pile: sheen('#e48d6d', 0.65, { directional: 0.35 })
      }
    },
    hair: {
      direction: 'y',
      layers: {
        primary: fiber(0.1, '#ffdcba', 0.87, { shift: 0.15 }),
        secondary: fiber(0.18, '#b87557', 0.54, { shift: -0.28 })
      }
    },
    'combed-fur': {
      direction: 'y',
      layers: {
        hair: fiber(0.21, '#ecd9b2', 0.68, { shift: 0.22, figure: 0.12 }),
        tips: sheen('#fff2c9', 0.72, { directional: 0.72 })
      }
    },
    'figured-wood': {
      direction: 'y',
      layers: {
        grain: fiber(0.19, '#ffc07a', 0.82, { axis: 'y', shift: 0.19, figure: 0.56, scale: 0.38 }),
        finish: spec(0.27, matte, 0.33)
      }
    },
    puddle: {
      base: { a: 0.31, line: false },
      opacity: { facing: 0.18, grazing: 1, power: 2.4 },
      normal: waves(0.042, 0.5),
      layers: { water: reflect(1, { ...waterSky, f0: 0.025, power: 3 }), sun: spec([0.17, 0.09], matte, 0.7) }
    },
    'wet-cobblestone': {
      normal: grain(0.12, 0.19),
      layers: {
        pools: reflect(0.8, { ...waterSky, f0: 0.07, mask: { type: 'noise', scale: 0.33, low: 0.19, high: 0.67 } }),
        wet: spec([0.16, 0.3], '#c0def5', 0.92)
      }
    },
    'waxy-leaf': {
      direction: 'y',
      layers: { wax: spec([0.1, 0.24], '#ecffd0', 0.89), rim: reflect(0.43, { sky: '#d0faa9' }) }
    },
    'glazed-pottery': { layers: { glaze: spec(0.18, '#fff2db', 1), rim: reflect(0.64, { f0: 0.03 }) } },
    'lacquered-wood': {
      direction: 'y',
      layers: {
        wood: fiber(0.27, '#e29a69', 0.64, { figure: 0.27, shift: 0.16 }),
        lacquer: spec(0.085, '#fff2d9', 0.98)
      }
    },
    'clear-ice': {
      base: { a: 0.34, glass: true, line: false },
      opacity: { facing: 0.34, grazing: 1, power: 3 },
      normal: grain(0.074, 0.25),
      layers: {
        frost: sheen('#d8f7ff', 0.63, { mask: { type: 'noise', scale: 0.33, low: 0.44, high: 0.75 } }),
        ice: reflect(0.96, { sky: '#a8dfff', f0: 0.07 }),
        sun: spec(0.13, '#effaff', 0.8)
      }
    },
    'glass-bottle': {
      base: { a: 0.25, glass: true, line: false },
      opacity: { facing: 0.28, grazing: 1, power: 2.1 },
      layers: {
        reflection: reflect(0.95, { ...waterSky, f0: 0.045, power: 3 }),
        highlight: spec([0.09, 0.25], '#efffff', 1)
      }
    },
    velvet: {
      direction: 'y',
      layers: { pile: sheen('#f4a4de', 0.95, { power: 1.25, directional: 0.2 }), fibre: fiber(0.33, '#aa4d8b', 0.2) }
    },
    dust: {
      layers: {
        dust: sheen('#d8c6a5', 0.82, { power: 1.1, mask: { type: 'noise', scale: 0.33, low: 0.2, high: 0.72 } })
      }
    },
    'gold-leaf': {
      normal: grain(0.38, 0.23),
      layers: {
        foil: spec([0.22, 0.36], '#fff0a5', 0.96),
        reflection: reflect(0.64, { f0: 0.3, sky: '#ffcd54', ground: '#79521c' })
      }
    },
    'soap-bubble': {
      base: { a: 0.2, line: false },
      opacity: { facing: 0.19, grazing: 1, power: 1.3 },
      layers: { film: film(455, 1, { f0: 0.6, variation: 190, scale: 0.56 }), gleam: spec(0.125, matte, 0.92) }
    },
    'oil-slick': {
      normal: waves(0.055, 0.59),
      layers: {
        film: film(355, 1, {
          variation: 160,
          scale: 0.48,
          f0: 0.7,
          colors: ['#44308d', '#426bc1', '#42c891', '#ebbc56', '#dc638c']
        }),
        surface: reflect(0.23, waterSky)
      }
    },
    'beetle-shell': {
      direction: 'y',
      layers: {
        shell: film(390, 1, { f0: 0.86, colors: ['#166348', '#44d994', '#206eac', '#965d36'], period: 370 }),
        gloss: spec([0.15, 0.26], '#d5ffd8', 0.73)
      }
    },
    'peacock-feather': {
      direction: 'y',
      layers: {
        barb: film(315, 1, {
          axisBias: 0.53,
          f0: 0.89,
          flash: 0.26,
          colors: ['#102d4e', '#2a94ea', '#52deaf', '#131f46']
        })
      }
    },
    'butterfly-wing': {
      direction: 'x',
      layers: {
        scales: film(260, 1, { f0: 0.94, flash: 0.075, colors: ['#467fff', '#87caff', '#3c39ce'] }),
        sheen: sheen('#7253bd', 0.32)
      }
    },
    'mother-of-pearl': {
      layers: {
        nacre: film(585, 0.83, {
          variation: 138,
          scale: 0.38,
          f0: 0.73,
          colors: ['#dccdfa', '#f5e2d3', '#c9e8e6', '#f9d7e5']
        }),
        coat: spec(0.19, '#fff3e6', 0.65)
      }
    },
    'pearlescent-paint': {
      layers: {
        pigment: film(480, 0.94, { f0: 0.8, colors: ['#9258a5', '#66babb', '#ae8c52', '#605ca1'], period: 440 }),
        coat: spec(0.14, '#fff7f0', 0.65)
      }
    },
    'shot-silk': {
      direction: 'y',
      layers: {
        threads: { type: 'directionalColor', color: '#d9579a', crossColor: '#4888b6', strength: 0.83, width: 0.65 },
        satin: spec([0.09, 0.39], '#ffc4b2', 0.66)
      }
    },
    'holographic-foil': {
      direction: radial,
      layers: {
        metal: reflect(0.48, { f0: 0.2 }),
        rainbow: { type: 'diffraction', spacing: 1250, roughness: 0.56, strength: 1, bandwidth: 64 }
      }
    },
    snow: {
      layers: {
        crystals: glints('#fffefe', 0.14, 1, { tilt: 0.62, roughness: 0.16, density: 0.79 }),
        rim: sheen('#d8ecfd', 0.69)
      }
    },
    'mica-granite': {
      normal: grain(0.15, 0.17),
      layers: {
        mica: glints('#f5d9ad', 0.19, 0.98, {
          tilt: 0.55,
          roughness: 0.19,
          density: 0.64,
          colors: ['#f4dbb6', '#dce2e8']
        })
      }
    },
    'frost-crystals': {
      layers: {
        crystal: glints('#e1faff', 0.14, 0.99, { tilt: 0.58, roughness: [0.14, 0.22], density: 0.88 }),
        ice: sheen('#ade6fb', 0.61)
      }
    },
    'metallic-paint': {
      layers: {
        metal: spec(0.28, '#ffd4ab', 0.72),
        flakes: glints('#ffefcd', 0.105, 1, { tilt: 0.58, roughness: 0.18, density: 0.78 }),
        coat: spec(0.09, matte, 0.52)
      }
    },
    sequins: {
      layers: {
        discs: glints('#fff3e4', 0.2, 1, {
          roughness: 0.21,
          tilt: 0.28,
          density: 1,
          radius: 0.42,
          colors: ['#ffe8a3', '#fac0d5', '#def8fc']
        })
      }
    },
    'dewy-grass': {
      direction: 'y',
      layers: {
        dew: glints('#f0fff0', 0.15, 1, { roughness: 0.17, tilt: 0.58, density: 0.73 }),
        wax: spec([0.13, 0.25], '#b5e5a0', 0.55)
      }
    },
    'rippling-water': {
      direction: 'x',
      normal: { ...waves(0.2, 0.44, 2.1), cadence:'water' },
      layers: {
        sky: reflect(0.88, { ...waterSky, f0: 0.08 }),
        sun: spec([0.42, 0.12], '#fff3c2', 0.98),
        ripples: glints('#e5f5ff', 0.21, 0.82, { roughness: [0.27, 0.12], tilt: 0.29, density: 0.85 })
      }
    },
    'fish-scales': {
      direction: 'x',
      normal: waves(0.11, 0.2),
      layers: {
        scale: film(320, 0.52, { f0: 0.69, colors: ['#599fa5', '#c7d9b4', '#6fa1ca'] }),
        flash: glints('#e7f9e5', 0.2, 1, { roughness: [0.23, 0.18], tilt: 0.31, density: 0.92 })
      }
    },
    'cut-gem': {
      layers: {
        body: film(450, 0.46, { f0: 0.65, colors: ['#247d82', '#7ddbc9', '#42669f'] }),
        facets: spec(0.19, '#e7fff7', 1),
        reflection: reflect(0.75, { f0: 0.17 })
      }
    }
  };

  function preset(name, base = {}, overrides) {
    if (!Object.hasOwn(presets, name)) throw new RangeError('Unknown surface preset: ' + name);
    const { base: defaults, ...recipe } = presets[name];
    const source = Array.isArray(base) ? { r: base } : base;
    const settings = SurfaceLook.merge(SurfaceLook.merge(recipe, source.surface), overrides);
    return { r: [1, 2, 3], ...defaults, ...source, surface: settings };
  }

  K.surface = { ...SurfaceLook, preset, presets: Object.freeze(Object.keys(presets)) };
})(KIT);
