// Binary glTF chunks, aligned buffer views, and typed accessors.
const fs = require('node:fs');
const path = require('node:path');

const FLOAT = 5126, UBYTE = 5121, USHORT = 5123, UINT = 5125;
const componentType = new Map([[Float32Array, FLOAT], [Uint8Array, UBYTE], [Uint16Array, USHORT], [Uint32Array, UINT]]);
const lanes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const zeroes = Buffer.alloc(3);

function document() {
  const gltf = { asset: { version: '2.0', generator: 'Ink Studio' }, scenes: [{ nodes: [] }], scene: 0 };
  const chunks = [];
  let length = 0;
  const add = (key, value) => (gltf[key] ||= []).push(value) - 1;
  function view(bytes, target) {
    const padding = (4 - length % 4) % 4;
    if (padding) chunks.push(zeroes.subarray(0, padding));
    length += padding;
    const index = add('bufferViews', { buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes);
    length += bytes.length;
    return index;
  }
  function accessor(array, type, { target, bounds = false } = {}) {
    const componentTypeValue = componentType.get(array.constructor), width = lanes[type];
    if (!componentTypeValue || !width || !array.length || array.length % width)
      throw new Error('Invalid glTF accessor shape');
    const item = { bufferView: view(Buffer.from(array.buffer, array.byteOffset, array.byteLength), target),
      componentType: componentTypeValue, count: array.length / width, type };
    if (bounds) {
      item.min = Array(width).fill(Infinity);
      item.max = Array(width).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const axis = i % width;
        item.min[axis] = Math.min(item.min[axis], array[i]);
        item.max[axis] = Math.max(item.max[axis], array[i]);
      }
    }
    return add('accessors', item);
  }
  function texture(bytes, name, mimeType = 'image/png') {
    const source = add('images', { name, mimeType, bufferView: view(bytes) });
    return add('textures', { sampler: 0, source });
  }
  function finish() {
    if (length) gltf.buffers = [{ byteLength: length }];
    if (gltf.textures?.length) gltf.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    return pack(gltf, Buffer.concat(chunks, length));
  }
  return { gltf, add, accessor, texture, finish };
}

function pack(gltf, bin) {
  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const paddedJson = Math.ceil(json.length / 4) * 4;
  const paddedBin = Math.ceil(bin.length / 4) * 4;
  const file = Buffer.alloc(20 + paddedJson + (bin.length ? 8 + paddedBin : 0));
  file.write('glTF');
  file.writeUInt32LE(2, 4);
  file.writeUInt32LE(file.length, 8);
  file.writeUInt32LE(paddedJson, 12);
  file.write('JSON', 16);
  file.fill(32, 20, 20 + paddedJson);
  json.copy(file, 20);
  if (bin.length) {
    const at = 20 + paddedJson;
    file.writeUInt32LE(paddedBin, at);
    file.write('BIN\0', at + 4);
    bin.copy(file, at + 8);
  }
  return file;
}

function readGlb(bytes) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length || bytes.toString('ascii', 16, 20) !== 'JSON')
    throw new Error('Invalid GLB 2.0 header');
  const end = 20 + bytes.readUInt32LE(12);
  if (end > bytes.length || end % 4) throw new Error('Invalid GLB JSON chunk');
  const gltf = JSON.parse(bytes.subarray(20, end).toString('utf8'));
  let bin;
  for (let at = end; at < bytes.length;) {
    const start = at + 8;
    if (start > bytes.length) throw new Error('Truncated GLB chunk header');
    const next = start + bytes.readUInt32LE(at), tag = bytes.toString('ascii', at + 4, start);
    if (next > bytes.length || next % 4) throw new Error('Invalid GLB chunk length');
    if (tag === 'JSON' || tag === 'BIN\0' && (bin || at !== end)) throw new Error('Invalid GLB chunk order');
    if (tag === 'BIN\0') bin = bytes.subarray(start, next);
    at = next;
  }
  return { gltf, bin: bin ?? Buffer.alloc(0) };
}

// glTF containers can be packed without decoding meshes, animations, or image data.
function embed(gltf, file, binary) {
  if (gltf.asset?.version !== '2.0') throw new Error('Expected a glTF 2.0 file');
  const pieces = [];
  let length = 0;
  const push = bytes => {
    const pad = (4 - length % 4) % 4;
    if (pad) pieces.push(zeroes.subarray(0, pad));
    pieces.push(bytes);
    length += pad + bytes.length;
    return length - bytes.length;
  };
  const read = uri => {
    if (typeof uri !== 'string') throw new Error('Asset URI must be a string');
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(',');
      if (comma < 0) throw new Error('Malformed data URI');
      return /;base64$/i.test(uri.slice(0, comma)) ? Buffer.from(uri.slice(comma + 1), 'base64')
        : Buffer.from(decodeURIComponent(uri.slice(comma + 1)));
    }
    if (/^\w+:/.test(uri)) throw new Error('Use local glTF companion files');
    return fs.readFileSync(path.resolve(path.dirname(file), decodeURIComponent(uri)));
  };
  const buffers = gltf.buffers || [];
  const bases = buffers.map(({ uri, byteLength }, index) => {
    const bytes = uri === undefined && index === 0 ? binary : read(uri);
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || !bytes || bytes.length < byteLength)
      throw new Error('Incomplete glTF buffer');
    return push(bytes.subarray(0, byteLength));
  });
  function relocate(view) {
    const offset = view.byteOffset ?? 0, size = view.byteLength;
    if (!Number.isSafeInteger(view.buffer) || !buffers[view.buffer] || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(size) || size < 1 || offset + size > buffers[view.buffer].byteLength)
      throw new RangeError('glTF data exceeds its source buffer');
    view.byteOffset = bases[view.buffer] + offset;
    view.buffer = 0;
  }
  for (const view of gltf.bufferViews || []) {
    relocate(view);
    const compression = view.extensions?.EXT_meshopt_compression;
    if (compression) relocate(compression);
  }
  for (const image of gltf.images || []) {
    if (image.uri === undefined) continue;
    const bytes = read(image.uri), uri = image.uri;
    const mime = image.mimeType || (/^data:([^;,]+)/.exec(uri)?.[1]) ||
      ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        '.ktx2': 'image/ktx2', '.avif': 'image/avif' })[path.extname(uri).toLowerCase()];
    if (!mime) throw new Error('Cannot determine glTF image type for ' + uri);
    const byteOffset = push(bytes);
    image.bufferView = (gltf.bufferViews ||= []).push({ buffer: 0, byteOffset, byteLength: bytes.length }) - 1;
    image.mimeType = mime;
    delete image.uri;
  }
  if (length) gltf.buffers = [{ byteLength: length }];
  else delete gltf.buffers;
  return pack(gltf, Buffer.concat(pieces, length));
}

module.exports = { document, pack, readGlb, embed };
