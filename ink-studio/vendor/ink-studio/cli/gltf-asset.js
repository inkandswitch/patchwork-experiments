const fs = require('node:fs');
const path = require('node:path');
const { embed, pack, readGlb } = require('./glb-file.js');
const files = require('./asset-files.js');

function format(file) {
  const extension = path.extname(file).toLowerCase();
  if (!['.gltf', '.glb'].includes(extension)) throw new TypeError('Choose a .gltf or .glb filename');
  return extension;
}

function readGltfAsset(file) {
  const location = path.resolve(file), extension = format(location), bytes = fs.readFileSync(location);
  let { gltf, bin } = extension === '.glb' ? readGlb(bytes) : { gltf: JSON.parse(bytes.toString('utf8')) };
  if (gltf.buffers?.some(buffer => buffer.uri !== undefined) || gltf.images?.some(image => image.uri !== undefined))
    ({ gltf, bin } = readGlb(embed(gltf, location, bin)));
  return require('../index.js').load().KIT.authoring.gltfAssets.create({ document: gltf, binary: bin });
}

function writeGltfAsset(source, { out } = {}) {
  if (typeof out !== 'string') throw new TypeError('Choose a .gltf or .glb output filename');
  const file = path.resolve(out), extension = format(file);
  const { document, binary } = require('../index.js').load().KIT.authoring.gltfAssets.create(source).snapshot();
  const bytes = Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength);
  if (extension === '.glb') files.write(file, pack(document, bytes));
  else {
    if (document.buffers?.length) document.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.toString('base64');
    files.json(file, document);
  }
  return { file };
}

module.exports = { readGltfAsset, writeGltfAsset };
