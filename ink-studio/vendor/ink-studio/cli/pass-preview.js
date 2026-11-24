const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { upscale } = require('./render.js');
const { channels, environment } = require('../src/art-passes.js');

const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
const idColor = id => Math.imul(id, 0x9e3779b1) & 0xffffff;

function labels(passes) {
  return Object.fromEntries(['objects', 'materials', 'targets', 'paletteOwners'].flatMap(key => passes[key] ? [[key,
    passes[key].map((label, index) => ({ label, color: '#' + idColor(index).toString(16).padStart(6, '0') }))
  ]] : []));
}

const environmentEncodings = {
  sky: 'RGB8 backdrop',
  fogTransmittance: 'RGB8 grayscale, white is full transmission',
  precipitation: 'RGBA8 straight alpha',
  reflections: 'RGB8 premultiplied reflected contribution',
  foregroundCoverage: 'RGB8 grayscale, white is full coverage'
};

function environmentEncoding(passes) {
  const encodings = Object.fromEntries(environment.filter(channel => passes[channel])
    .map(channel => [channel, environmentEncodings[channel]]));
  return Object.keys(encodings).length ? { encodings } : {};
}

function depthRange(data) {
  let near = Infinity, far = -Infinity;
  for (const depth of data) if (Number.isFinite(depth)) {
    near = Math.min(near, depth);
    far = Math.max(far, depth);
  }
  return Number.isFinite(near) ? { near, far } : null;
}

function encode(frame, channel) {
  const { w, h, passes } = frame;
  if (channel === 'color') return { w, h, rgb: frame.rgb };
  const data = passes[channel];
  if (!data) throw new Error('The renderer did not supply the ' + channel + ' pass');
  const rgb = new Uint8Array(w * h * 3);
  const alpha = channel === 'precipitation' && new Uint8Array(w * h);
  const depth = ['depth', 'emissionDepth'].includes(channel) && depthRange(data);
  for (let p = 0; p < w * h; p++) {
    const q = p * 3;
    if (['coverage', 'protected', 'mask', 'fogTransmittance', 'foregroundCoverage'].includes(channel))
      rgb.fill(byte(data[p]), q, q + 3);
    else if (channel === 'depth' || channel === 'emissionDepth') {
      if (depth && Number.isFinite(data[p]))
        rgb.fill(byte(1 - .85 * (data[p] - depth.near) / (depth.far - depth.near || 1)), q, q + 3);
    } else if (channel === 'normal') {
      if (data[q] || data[q + 1] || data[q + 2])
        for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c] * .5 + .5);
    } else if (channel === 'motion' || channel === 'emissionMotion') {
      rgb[q] = byte(.5 + data[p * 2] / 8);
      rgb[q + 1] = byte(.5 + data[p * 2 + 1] / 8);
    } else if (alpha) {
      const i = p * 4, a = data[i + 3];
      alpha[p] = byte(a);
      if (alpha[p]) for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[i + c] / a);
    } else if (channel === 'emission' || channel === 'sky' || channel === 'reflections') {
      for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c]);
    } else {
      const color = idColor(data[p]);
      rgb[q] = color >> 16;
      rgb[q + 1] = color >> 8 & 255;
      rgb[q + 2] = color & 255;
    }
  }
  return { w, h, rgb, ...(alpha && {alpha}) };
}

function writePasses(directory, frame, scale = 1) {
  const passes = frame.passes;
  const manifest = { width: frame.w, height: frame.h, scale, rows: 'top-down', files: {}, ...environmentEncoding(passes) };
  if (passes.objects) manifest.objects = passes.objects;
  if (passes.materials) manifest.materials = passes.materials;
  if (passes.targets) manifest.targets = passes.targets;
  if (passes.paletteOwners) manifest.paletteOwners = passes.paletteOwners;
  manifest.legend = labels(passes);
  if (passes.depth || passes.emissionDepth) manifest.depth = depthRange(passes.depth || passes.emissionDepth);
  fs.mkdirSync(directory, { recursive: true });
  for (const channel of ['color', ...channels]) {
    if (channel !== 'color' && (!passes[channel] || ['position', 'objectPosition'].includes(channel))) continue;
    const native = encode(frame, channel), image = scale === 1 ? native : upscale(native, scale);
    const file = channel + '.png';
    PNG.write(path.join(directory, file), image.w, image.h, image.rgb, image.alpha);
    manifest.files[channel] = file;
  }
  fs.writeFileSync(path.join(directory, 'passes.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { encode, labels, depthRange, environmentEncoding, writePasses };
