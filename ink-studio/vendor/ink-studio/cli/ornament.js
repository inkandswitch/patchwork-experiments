const fs = require('node:fs');
const path = require('node:path');
const png = require('./png.js');

module.exports = function ornamentCLI(pos, opt, kit, outputFile) {
  const format = opt.format ?? 'pigment';
  if (pos.length !== 1 || Object.keys(opt).some(key => !['out', 'format'].includes(key)) ||
    !['pigment', 'relief', 'tiles'].includes(format) || (opt.out !== undefined && typeof opt.out !== 'string')) {
    throw new Error('ornament needs a pattern JSON file, optional --format pigment|relief|tiles, and optional --out file');
  }
  const { raster, tiles, ...definition } = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
  const pattern = kit.KIT.procedural.ornament.compile(definition);
  const file = outputFile('ornament-' + format + (format === 'tiles' ? '.json' : '.png'));
  let data;
  if (format === 'tiles') {
    const { kind, group, lattice, basis, operations } = pattern;
    data = JSON.stringify({ kind, group, lattice, basis, operations, tiles: pattern.tiles(tiles) }, null, 2) + '\n';
  } else {
    const { w, h, rgba } = pattern.raster({ ...raster, mode: format });
    data = png.encode(w, h, rgba, 4);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('wrote', file);
};
