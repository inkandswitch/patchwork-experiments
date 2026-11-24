const Palette = require('./look-palette.js');
const counts = () => ({ samples: 0, below: 0, above: 0 });
const outside = (r, g, b) => r < 0 || g < 0 || b < 0 || r > 1 || g > 1 || b > 1;

function count(row, r, g, b) {
  row.samples++;
  row.below += Number(r < 0) + Number(g < 0) + Number(b < 0);
  row.above += Number(r > 1) + Number(g > 1) + Number(b > 1);
}

function createAudit() {
  const pixels = new Set(), stages = new Map(), sampleStages = new Map(), swatches = new Set(), paletteClips = new Map();
  function add(map, stage, r, g, b) {
    if (!map.has(stage)) map.set(stage, counts());
    count(map.get(stage), r, g, b);
  }
  return {
    addPalette(palette) {
      for (const color of palette ?? []) swatches.add(color);
    },
    pixel(stage, index, r, g, b) {
      if (!outside(r, g, b)) return;
      pixels.add(index);
      add(stages, stage, r, g, b);
    },
    sample(stage, r, g, b) {
      if (outside(r, g, b)) add(sampleStages, stage, r, g, b);
    },
    palette(scope, input, r, g, b) {
      if (!outside(r, g, b)) return;
      const { assetId, stack } = scope;
      const key = JSON.stringify([assetId, stack, input, r, g, b]);
      if (!paletteClips.has(key)) paletteClips.set(key, {
        input: Palette.hex(input), rgb: [r, g, b], ...(assetId && { asset: assetId }), ...(stack && { stack })
      });
    },
    report() {
      return { swatches: [...swatches].sort((a, b) => a - b),
        clipping: { pixels: pixels.size, stages: Object.fromEntries(stages), sampleStages: Object.fromEntries(sampleStages),
          palette: [...paletteClips.values()] } };
    }
  };
}

module.exports = { createAudit };
