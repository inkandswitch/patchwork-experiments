module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'surface-effects',
  name: 'Tidal signal',
  seed: 18,
  build(seed) {
    const FX = K.splatEffects;
    const palette = [0x000000, 0x0e2730, 0x18504e, 0x36725c, 0x8ca66b, 0xc8dda0,
      0x1d3878, 0x4775e5, 0x4dd5eb, 0xa879ff, 0xe8fbec, 0xde5b3f, 0xffbd6b];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const rig = K.rig(B, S);
    const stones = [[-3.7, 0, -0.46], [-1.4, 0, 0.15], [0.6, 0, 0.28], [3.25, 0, -0.36]];
    const projection = { type: 'ribbon', points: stones };
    const uv = FX.project(projection);
    const path = [[0, -3.35, 0.8, -0.54], [0.6, -2.8, 0.1, -0.33], [1.4, -1.4, 0.11, 0.15],
      [2.5, 0.28, 0.12, 0.29], [4.4, 3.14, 0.15, -0.36]];
    const position = t => K.anim.poseAt(t, path);
    const wake = FX.field({
      width: 169, height: 70, cell: 0.046, origin: [-0.55, -1.61],
      channels: {
        reveal: { decay: 0.09 }, foam: { decay: 1.35 }, wave: { combine: 'sum', decay: 1.15 },
        flowU: { combine: 'sum', decay: 2.0 }, flowV: { combine: 'sum', decay: 2.0 }
      }
    });
    const keys = Array.from({ length: 75 }, (_, i) => {
      const t = 0.57 + i * 0.05;
      return [t, ...uv(position(t))];
    });
    wake.stroke({ keys, spacing: 0.05, radius: 1.30, speed: 0.045, values: { reveal: 1.28 } });
    wake.stroke({
      keys, spacing: 0.05, radius: 0.38, lifetime: 2.2, velocity: [-0.38, 0.08],
      values: { foam: 1.2, flowU: 0.08, flowV: 0.12 }
    });
    for (const [time, u, v] of keys.filter((_, i) => i % 5 === 0))
      wake.stamp({ at: [u, v], time, shape: 'ring', radius: 0.09, speed: 0.84, width: 0.12,
        lifetime: 1.7, values: { wave: 0.66 } });

    const current = { type: 'projected', projection, field: 'wake' };
    const waterPalette = [1, 2, 3, 4, 5];
    const water = K.surface.material({ r: [1, 1, 2] }, { layers: {
      reveal: {
        ...current, revealChannel: 'reveal', range: [0.14, 0.63], pattern: 'solid',
        colors: [1, 1, 2], outputPalette: waterPalette
      },
      weave: {
        ...current, pattern: 'tidal-weave', color: 4, scale: 0.58, strength: 0.98,
        warpChannels: ['flowU', 'flowV'], warp: 0.52, outputPalette: waterPalette
      },
      ripples: {
        ...current, pattern: 'contour', contourChannel: 'wave', maskChannel: 'wave',
        range: [0.06, 0.76], scale: 0.23, width: 0.18, colors: [3, 4, 5], outputPalette: waterPalette
      },
      trail: {
        ...current, pattern: 'solid', maskChannel: 'foam', range: [0.04, 0.53],
        colors: [6, 7, 8, 10], outputPalette: [1, 2, 6, 7, 8, 9, 10], ink: true
      },
      foam: {
        ...current, pattern: 'chevrons', maskChannel: 'foam', range: [0.06, 0.72], scale: 0.34,
        width: 0.25, colors: [6, 7, 8, 10], outputPalette: [6, 7, 8, 9, 10], ink: true,
        warpChannels: ['flowU', 'flowV'], warp: 0.1, scroll: [-0.11, 0]
      }
    } });
    S.box([0, -0.065, 0], [4.3, 0.065, 1.64], water, { res: 0.065, rd: 0.05 });

    // A small animated pixel tile is sampled in the skimmer's rest coordinates.
    const glyphs = [
      ['000000', '001100', '011110', '001100', '000000'],
      ['000000', '010010', '001100', '010010', '000000'],
      ['001100', '011110', '110011', '011110', '001100']
    ];
    const tile = glyphs.map(rows => rows.flatMap(row => Array.from(row).flatMap(mark => [246, 252, 207, mark === '1' ? 255 : 0])));
    const hull = K.surface.material({ r: [11, 11, 12] }, { layers: {
      signal: {
        type: 'projected', pattern: 'raster', scale: 0.36, ink: true,
        projection: { origin: [-0.18, 0, -0.18] },
        raster: { width: 6, height: 5, frames: tile, fps: 5, repeat: true },
        outputPalette: [11, 12, 10]
      }
    } });
    S.ball([0, 0, 0], [0.255, 0.11, 0.135], hull, { res: 0.023, tag: 'skimmer' });
    S.bake();

    const sparks = FX.emitter(B, {
      source(t, i, random) {
        return {
          position: K.V.add(position(t), [-0.16, 0.015, (random() - 0.5) * 0.07]),
          normal: [-0.5, 0.7, 0], rgb: i % 5 === 0 ? [1, 0.7, 0.27] : [0.38, 0.82, 1]
        };
      },
      start: 0.2, end: 4.3, rate: 73, lifetime: [0.26, 0.68], size: 0.012,
      speed: 0.20, drift: [-0.48, 0.02, 0], spread: 0.26, gravity: [0, -0.28, 0], density: 1.3, seed
    });
    const world = B.finish({
      cam: { target: [0, 0.04, 0], dist: 10.3, pitch: 0.91, yaw: 0.54 },
      look: { pixelSize: 2 }, radius: 8, detail: 22, dither: 0.35,
      surfaceEffects: {
        fields: { wake },
        shaders: {
          'tidal-weave'({ x, y, time, field }, result) {
            const z = y + 0.28 * Math.sin(x * 2.3 + time * 1.9);
            const cell = q => q - Math.floor(q);
            const chevron = Math.abs(cell(z + Math.abs(cell(x) - 0.5)) - 0.5);
            const ring = Math.abs(Math.hypot(cell(x) - 0.5, cell(z) - 0.5) - 0.27);
            const blend = 0.5 + 0.5 * Math.sin(time * 2.4 + 0.6);
            const density = Math.min(1, field('reveal') * 2.1);
            result[3] = Math.min(1, K.mix(Math.max(0, 1 - chevron * 4),
              Math.max(0, 1 - ring * 7), blend) * 1.28) * density;
          }
        }
      }
    });
    const stage = K.stage(world);
    rig.bind(stage);
    stage.add({
      pre(dt, t) {
        rig.set('skimmer', K.M.id(), [0, 0, 0], position(t));
        rig.apply();
      }
    });
    stage.add(sparks);
    return world;
  }
});
