const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { json } = require('./asset-files.js');
const { render, cameraCapture, pixelIndex } = require('./render.js');
const { depthRange } = require('./pass-preview.js');

const passes = ['depth', 'normal', 'objectId', 'materialId'];
const encodings = {
  color: { format: 'rgba8-png', alpha: 'straight' },
  depth: { format: 'gray16-png', units: 'scene', space: 'camera-axis', empty: 0, first: 1, last: 65535 },
  depthFloat: { format: 'float32-le', headerBytes: 0, units: 'scene', space: 'camera-axis', empty: '+Infinity' },
  normal: { format: 'rgba8-png', space: 'world', decode: '2 * (RGB / 255) - 1', validAlpha: 255 },
  objectId: { format: 'rgb24-png', decode: '65536 * R + 256 * G + B', empty: 0 },
  materialId: { format: 'rgb24-png', decode: '65536 * R + 256 * G + B', empty: 0 },
  materialMasks: { format: 'gray8-png', kind: 'visible-surface', foreground: 255, background: 0 }
};

function packId(image, at, id) {
  if (id > 0xffffff) throw new RangeError('Layered export IDs must fit in 24 bits');
  image[at] = id >>> 16;
  image[at + 1] = id >>> 8 & 255;
  image[at + 2] = id & 255;
}

function writeFrame(frame, camera, w, h, write) {
  const data = frame.passes;
  if (!frame.alpha || !camera || passes.some(name => !data?.[name]))
    throw new Error('The renderer did not supply a transparent frame and all surface passes');
  const count = w * h, color = new Uint8Array(count * 4), normal = new Uint8Array(count * 4);
  const objectIds = new Uint8Array(count * 3), materialIds = new Uint8Array(count * 3);
  const depth = new Float32Array(count), masks = new Map();
  const colorAt = pixelIndex(w, h, frame.w, frame.h), surfaceAt = pixelIndex(w, h, data.w, data.h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, q = p * 3, a = p * 4, c = colorAt(x, y), source = surfaceAt(x, y), n = source * 3;
    color[a + 3] = frame.alpha[c];
    if (frame.alpha[c]) for (let channel = 0; channel < 3; channel++) color[a + channel] = frame.rgb[c * 3 + channel];
    depth[p] = data.depth[source];
    if (data.normal[n] || data.normal[n + 1] || data.normal[n + 2]) {
      for (let channel = 0; channel < 3; channel++)
        normal[a + channel] = Math.round((Math.max(-1, Math.min(1, data.normal[n + channel])) + 1) * 127.5);
      normal[a + 3] = 255;
    }
    const material = data.materialId[source];
    packId(objectIds, q, data.objectId[source]);
    packId(materialIds, q, material);
    if (!material) continue;
    if (!masks.has(material)) masks.set(material, []);
    masks.get(material).push(p);
  }
  const range = depthRange(depth), depthImage = new Uint16Array(count), floats = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    const z = depth[i];
    floats.writeFloatLE(z, i * 4);
    if (Number.isFinite(z)) depthImage[i] = 1 + Math.round(65534 * (z - range.near) / (range.far - range.near || 1));
  }
  const files = {
    color: write('color', 'png', PNG.encode(w, h, color, 4)),
    depth: write('depth', 'png', PNG.encodeGray(w, h, depthImage)),
    depthFloat: write('depth', 'f32le', floats),
    normal: write('normal', 'png', PNG.encode(w, h, normal, 4)),
    objectId: write('object-id', 'png', PNG.encode(w, h, objectIds)),
    materialId: write('material-id', 'png', PNG.encode(w, h, materialIds))
  };
  const matte = new Uint8Array(count), materialMasks = [];
  for (const [id, pixels] of [...masks].sort(([a], [b]) => a - b)) {
    for (const pixel of pixels) matte[pixel] = 255;
    const file = write('materials/' + id, 'png', PNG.encodeGray(w, h, matte));
    materialMasks.push({ id, label: data.materials[id] ?? null, file });
    for (const pixel of pixels) matte[pixel] = 0;
  }
  return { width: w, height: h, surfaceSize: [data.w, data.h], camera: { ...camera, view: Array.from(camera.view) },
    files, depthRange: range, objects: data.objects.slice(), materials: data.materials.slice(), materialMasks };
}

function exportLayers(world, { out, view = {}, times = [view.time ?? view.t ?? world?.lookSnapshot?.time ?? 0],
  native = false, pose, replay } = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Layered exports need an output directory');
  if (!Array.isArray(times) || !times.length || !Array.from(times).every((t, i) =>
      Number.isFinite(t) && (!i || t >= times[i - 1])))
    throw new RangeError('Layered export times must be finite and in playback order');
  const width = view.w ?? view.width ?? 900, height = view.h ?? view.height ?? 620;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || width * height > 16777216)
    throw new RangeError('Layered export dimensions must fit within 16,777,216 pixels');
  const directory = path.resolve(out);
  fs.mkdirSync(directory, { recursive: true });
  const take = fs.mkdtempSync(path.join(directory, 'take-')), prefix = path.basename(take);
  const manifest = { version: 1, rows: 'top-down', encodings: structuredClone(encodings), frames: [] };
  function draw(time, resetRenderHistory) {
    pose?.(world, time);
    let camera;
    const frame = render(world, { ...view, w: width, h: height, time, t: time, transparent: true,
      passes, resetRenderHistory, ...cameraCapture(view, result => { camera ??= result; }) });
    return { frame, camera };
  }
  try {
    for (const [index, time] of times.entries()) {
      const { frame, camera } = replay ? replay.sample(time, draw) : draw(time, view.resetRenderHistory);
      const name = 'frame-' + String(index).padStart(6, '0');
      const write = (channel, extension, bytes) => {
        const relative = channel + '/' + name + '.' + extension;
        fs.mkdirSync(path.join(take, channel), { recursive: true });
        fs.writeFileSync(path.join(take, relative), bytes);
        return prefix + '/' + relative;
      };
      manifest.frames.push({ index, time, ...writeFrame(frame, camera, native ? frame.w : width, native ? frame.h : height, write) });
    }
    const file = path.join(directory, 'layers.json');
    json(file, manifest);
    return { file, manifest };
  } catch (error) {
    fs.rmSync(take, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { exportLayers };
