const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const R = require('./render.js');

function pngMap(filename, opt) {
  const { w, h, max, data } = PNG.raster(filename);
  const depth = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  const channel = opt.channel === undefined ? -1 : ['r', 'g', 'b', 'a'].indexOf(opt.channel);
  if (opt.channel !== undefined && channel < 0) throw new Error('Depth channel must be r, g, b or a');
  const metric = opt['depth-scale'] !== undefined;
  if (metric && (opt.near !== undefined || opt.far !== undefined || opt['white-near']))
    throw new Error('Use either raw depth scaling or a grayscale near/far range');
  const near = Number(opt.near ?? 1);
  const far = Number(opt.far ?? 2);
  if (!metric && (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0 || far <= near))
    throw new Error('Near and far must be positive and near must be less than far');
  const invalid = opt.invalid === undefined ? undefined : Number(opt.invalid);
  if (invalid !== undefined && !Number.isFinite(invalid)) throw new Error('Invalid depth sentinel must be numeric');
  for (let i = 0; i < depth.length; i++) {
    const j = i * 4;
    if (channel !== 3 && data[j + 3] === 0) continue;
    if (channel < 0 && (data[j] !== data[j + 1] || data[j] !== data[j + 2]))
      throw new Error('Depth PNG is not grayscale. Choose an explicit --channel r, g, b or a');
    const value = data[j + Math.max(0, channel)];
    if (value === invalid) continue;
    mask[i] = 1;
    const fraction = opt['white-near'] ? 1 - value / max : value / max;
    depth[i] = metric ? value : near + fraction * (far - near);
  }
  return { width: w, height: h, depth, mask };
}

function colorImage(filename) {
  const { w, h, max, data } = PNG.raster(filename);
  return { width: w, height: h, channels: 4, data: Uint8Array.from(data, v => Math.round((v * 255) / max)) };
}

function writeJSON(filename, value) {
  fs.writeFileSync(
    filename,
    JSON.stringify(value, (_, item) => (ArrayBuffer.isView(item) ? Array.from(item) : item)) + '\n'
  );
}

module.exports = function depthCommand(filename, opt, kit, output) {
  if (!filename) throw new Error('depth <depth.png|depth.json> [--image aligned.png] [--out-dir directory]');
  const extension = path.extname(filename).toLowerCase();
  if (extension !== '.png' && extension !== '.json') throw new Error('Depth input must be PNG or JSON');
  const spec = extension === '.png' ? pngMap(filename, opt) : JSON.parse(fs.readFileSync(filename, 'utf8'));
  const camera = { ...spec.camera };
  for (const key of ['fx', 'fy', 'cx', 'cy', 'fov']) {
    if (opt[key] !== undefined) camera[key] = Number(opt[key]);
  }
  if (opt.projection) camera.type = opt.projection;
  if (opt['world-height'] !== undefined) camera.height = Number(opt['world-height']);
  const options = { ...spec, camera };
  for (const [flag, property] of [
    ['depth-scale', 'depthScale'],
    ['depth-offset', 'depthOffset'],
    ['stride', 'stride'],
    ['thickness', 'thickness'],
    ['max-jump', 'maxDepthJump']
  ]) {
    if (opt[flag] !== undefined) options[property] = opt[flag] === true ? NaN : Number(opt[flag]);
  }
  if (extension === '.json' && opt.invalid !== undefined) options.invalid = Number(opt.invalid);
  if (opt.image) {
    if (opt.image === true) throw new Error('--image needs the path to an aligned PNG');
    options.image = colorImage(opt.image);
  }
  if (opt['alpha-mask']) options.alphaMask = true;

  const model = kit.KIT.depth.fromMap(options);
  const field = model.field({ cells: Number(opt.cells ?? 64) });
  const world = model.world({ spread: Number(opt.spread ?? 0.6), relight: opt.relight ? true : undefined });
  const view = R.render(world, {
    w: Number(opt.w ?? 720),
    h: Number(opt.h ?? 600),
    yaw: Number(opt.yaw ?? 0),
    pitch: Number(opt.pitch ?? 0),
    ortho: model.camera.type === 'orthographic' || !!opt.ortho,
    raw: !opt.palette
  });
  const frame = R.upscale(view, view.px);
  const dir = path.resolve(opt['out-dir'] || output);
  fs.mkdirSync(dir, { recursive: true });
  PNG.write(path.join(dir, 'preview.png'), frame.w, frame.h, frame.rgb);
  fs.writeFileSync(path.join(dir, 'mesh.obj'), kit.KIT.mesh.toObj(model.mesh));
  writeJSON(path.join(dir, 'sdf.json'), {
    format: 'ink-studio-sdf-grid-v1',
    origin: field.lo,
    spacing: field.h,
    dimensions: field.n,
    values: field.D
  });
  const { scaleAt, ...sourceCamera } = model.camera;
  writeJSON(path.join(dir, 'splats.json'), {
    format: 'ink-studio-splats-v1',
    stride: 16,
    source: { width: options.width, height: options.height, camera: sourceCamera },
    ...world
  });
  console.log('Depth import wrote ' + model.count + ' splats, a closed mesh and an SDF grid to ' + dir);
};
