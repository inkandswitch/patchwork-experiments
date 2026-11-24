const fs = require('node:fs');
const path = require('node:path');
const { raster } = require('./png.js');
const files = require('./asset-files.js');

function readRasterAsset(file, create) {
  const location = path.resolve(file), directory = path.dirname(location);
  const manifest = JSON.parse(fs.readFileSync(location, 'utf8'));
  if (!manifest || typeof manifest.layers !== 'object' || !manifest.layers) throw new TypeError('Raster manifest needs layers');
  const { width, height } = manifest;
  let channels = 0;
  const layers = Object.fromEntries(Object.entries(manifest.layers).map(([name, layer]) => {
    if (!Array.isArray(layer?.frames)) throw new TypeError('Raster layer needs frames: ' + name);
    const frames = layer.frames.map(frame => {
      const reference = typeof frame === 'string' ? { file: frame } : frame;
      if (reference?.file === undefined) return frame;
      if (typeof reference.file !== 'string' || reference.data !== undefined)
        throw new TypeError('Raster file frames need a PNG path');
      const image = raster(path.resolve(directory, reference.file));
      if (image.w !== width || image.h !== height)
        throw new RangeError('Raster image dimensions do not match manifest: ' + reference.file);
      channels += image.data.length;
      if (channels > 64e6) throw new RangeError('Raster manifest exceeds the pixel budget');
      const data = image.max === 255 ? image.data : Uint8Array.from(image.data, value => Math.round(value * 255 / image.max));
      return { data, pivot: reference.pivot };
    });
    return [name, { ...layer, frames }];
  }));
  return create({ ...manifest, layers });
}

function writeRasterAsset(source, { out } = {}) {
  if (typeof out !== 'string' || path.extname(out).toLowerCase() !== '.json') throw new TypeError('Choose a raster .json manifest filename');
  const file = path.resolve(out), directory = path.dirname(file);
  const create = require('../index.js').load().KIT.procedural.graph.raster;
  const manifest = create(source).snapshot();
  for (const layer of Object.values(manifest.layers)) {
    layer.frames = layer.frames.map(({ data, ...frame }) => ({
      ...frame, file: files.image(directory, manifest.width, manifest.height, data)
    }));
  }
  files.json(file, manifest);
  return { file };
}

module.exports = { readRasterAsset, writeRasterAsset };
