/* Bounded PXCX inspection and native import of saved RGBA8 art. */
const { inflateSync } = require('node:zlib');

const MAX_FILE = 64 * 1024 * 1024, MAX_PAYLOAD = 32 * 1024 * 1024, MAX_IMAGE = 1048576;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

function string(bytes) {
  const nul = bytes.indexOf(0);
  if (nul >= 0 && bytes.subarray(nul).some(n => n !== 0)) throw new RangeError('Unexpected bytes after a PXC string');
  return utf8.decode(nul === -1 ? bytes : bytes.subarray(0, nul));
}

function payload(bytes) {
  const first = bytes.find(n => ![9, 10, 13, 32].includes(n));
  const data = first === 123 ? bytes : inflateSync(bytes, { maxOutputLength: MAX_PAYLOAD });
  if (data.length > MAX_PAYLOAD) throw new RangeError('PXC payload exceeds the import budget');
  const value = JSON.parse(string(data));
  if (!record(value)) throw new TypeError('PXC payload needs a project object');
  return value;
}

function savedArt(value, thumbnail) {
  let preview = value.preview;
  if (typeof preview === 'string' && preview.trim().startsWith('{')) preview = JSON.parse(preview);
  if (record(preview) && preview.format === 6) {
    const { width, height, buffer } = preview, count = width * height;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || count > MAX_IMAGE ||
        typeof buffer !== 'string' || !buffer.length || buffer.length > 8 * MAX_IMAGE ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(buffer)) throw new RangeError('Invalid PXC RGBA8 preview');
    const data = inflateSync(Buffer.from(buffer, 'base64'), { maxOutputLength: count * 4 });
    if (data.length !== count * 4) throw new RangeError('PXC preview has an incorrect RGBA byte count');
    return { kind: 'preview', image: { width, height, channels: 4, data } };
  }
  if (thumbnail) {
    const data = inflateSync(thumbnail, { maxOutputLength: MAX_IMAGE * 4 });
    const side = Math.sqrt(data.length / 4);
    if (!Number.isSafeInteger(side) || side < 1) throw new RangeError('PXC thumbnail needs square RGBA8 data');
    return { kind: 'thumbnail', image: { width: side, height: side, channels: 4, data } };
  }
  return null;
}

function inspectPxc(source, { image = false } = {}) {
  if (!(source instanceof Uint8Array) || source.length < 8 || source.length > MAX_FILE)
    throw new TypeError('Expected a bounded PXCX project');
  const bytes = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'PXCX') throw new TypeError('Expected a PXCX project container');
  const offset = bytes.readUInt32LE(4);
  if (offset < 8 || offset >= bytes.length || offset > 8 * 1024 * 1024) throw new RangeError('Invalid PXC payload offset');
  const chunks = [];
  let thumbnail, metadata;
  for (let at = 8; at < offset;) {
    if (at + 8 > offset || chunks.length >= 64) throw new RangeError('Invalid PXC chunk table');
    const kind = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    at = start + size;
    if (!/^[A-Z0-9 ]{4}$/.test(kind) || at > offset) throw new RangeError('Truncated PXC header chunk');
    const chunk = bytes.subarray(start, at);
    chunks.push({ kind, size });
    if (kind === 'THMB') thumbnail = chunk;
    if (kind === 'META') {
      if (size < 4) throw new RangeError('Truncated PXC metadata chunk');
      metadata = { saveVersion: chunk.readUInt32LE(0), version: string(chunk.subarray(4)) };
    }
  }
  const project = payload(bytes.subarray(offset));
  const report = { container: 'PXCX', chunks, ...(metadata && { metadata }),
    ...(Number.isSafeInteger(project.version) && { saveVersion: project.version }),
    ...(typeof project.versions === 'string' && { version: project.versions }),
    fields: Object.keys(project).sort(), hasPreview: Boolean(project.preview), hasThumbnail: Boolean(thumbnail) };
  return { project, report, ...(image && { art: savedArt(project, thumbnail) }) };
}

function previewProject(bytes) {
  const { report, art } = inspectPxc(bytes, { image: true });
  if (!art) throw new RangeError('PXC needs a saved RGBA8 preview or thumbnail for the native raster import');
  const { width, height, channels, data } = art.image;
  const project = {
    format: 'ink-studio/graph-project', version: 1,
    nodes: { image: { op: 'data.typed', type: 'raster', inputs: { value: { width, height, channels, data: Array.from(data) } } } },
    outputs: { image: { node: 'image' } }, exports: { image: { output: 'image', format: 'png' } }
  };
  return { project, report: { ...report, mode: art.kind, width, height } };
}

module.exports = { inspectPxc, previewProject, maxPxcBytes: MAX_FILE };
