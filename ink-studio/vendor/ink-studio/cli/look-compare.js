const path = require('node:path');
const R = require('./render.js');
const Preview = require('./look-preview.js');
const Palette = require('./look-palette.js');
const Targets = require('../src/target-selectors.js');
const { registry } = require('./look-pass.js');

function cases(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 2000)
    throw new TypeError('A look comparison needs 2 to 2000 cases');
  const ids = new Set();
  return rows.map((row, index) => {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype || Object.keys(row).some(key => key !== 'id' && key !== 'look'))
      throw new TypeError('Look case ' + (index + 1) + ' accepts id and look. Set camera and simulation inputs on the command.');
    const id = row.id ?? index;
    if (!(typeof id === 'string' && id.trim() || Number.isSafeInteger(id)) || ids.has(id))
      throw new TypeError('Look case IDs must be distinct names or integers');
    ids.add(id);
    return { id, look: row.look };
  });
}

function swatchUsage(frame) {
  const candidates = new Map(frame.lookAudit.swatches.map(color => [color, 0]));
  let otherPixels = 0;
  for (let i = 0; i < frame.rgb.length; i += 3) {
    const color = frame.rgb[i] * 65536 + frame.rgb[i + 1] * 256 + frame.rgb[i + 2];
    if (candidates.has(color)) candidates.set(color, candidates.get(color) + 1);
    else otherPixels++;
  }
  const used = [], unused = [];
  for (const [color, pixels] of candidates)
    if (pixels) used.push({ swatch: Palette.hex(color), pixels });
    else unused.push(Palette.hex(color));
  return { used, unused, otherPixels };
}

function stats() {
  return { pixels: 0, changedPixels: 0, sum: [0, 0, 0], absolute: 0, maxChannelDelta: 0 };
}
function update(row, r, g, b) {
  const peak = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  row.pixels++;
  row.changedPixels += Number(peak > 0);
  row.sum[0] += r;
  row.sum[1] += g;
  row.sum[2] += b;
  row.absolute += Math.abs(r) + Math.abs(g) + Math.abs(b);
  row.maxChannelDelta = Math.max(peak, row.maxChannelDelta);
}
function describe({ pixels, changedPixels, sum, absolute, maxChannelDelta }) {
  return { pixels, changedPixels, meanRGBDelta: sum.map(n => n / pixels),
    meanAbsoluteChannelDelta: absolute / (3 * pixels), maxChannelDelta };
}

function ownerGroups(world, frame) {
  const index = Targets.index(world), slots = new Map(), keys = new Map(), targets = [null];
  const group = (id) => {
    if (!id) return 0;
    if (!slots.has(id)) {
      const target = index.row(id - 1), key = JSON.stringify(target);
      if (!keys.has(key)) {
        keys.set(key, targets.length);
        targets.push(target);
      }
      slots.set(id, keys.get(key));
    }
    return slots.get(id);
  };
  return { targets, baseline: Uint32Array.from(frame.passes.splatId, group), group };
}

function difference(base, current, ownership) {
  const totals = stats(), targets = new Map(), bindings = new Map();
  const owners = current.passes.splatId, targetIds = current.passes.target, priorIds = base.passes.target;
  const row = (groups, id) => {
    if (!groups.has(id)) groups.set(id, stats());
    return groups.get(id);
  };
  for (let p = 0, i = 0; i < current.rgb.length; p++, i += 3) {
    const r = current.rgb[i] - base.rgb[i], g = current.rgb[i + 1] - base.rgb[i + 1], b = current.rgb[i + 2] - base.rgb[i + 2];
    update(totals, r, g, b);
    update(row(targets, owners[p] ? ownership.group(owners[p]) : ownership.baseline[p]), r, g, b);
    const binding = targetIds[p] || priorIds[p];
    if (binding) update(row(bindings, binding), r, g, b);
  }
  return { ...describe(totals),
    targets: [...targets].map(([id, group]) => ({ target: ownership.targets[id], ...describe(group) })),
    bindings: [...bindings].map(([id, group]) => ({ binding: current.passes.targets[id], ...describe(group) })) };
}

function compare(world, input, kit, settings, { opt = {}, file, images = false } = {}) {
  const variants = cases(input);
  const camera = { target: settings.target ?? world.cam.target, yaw: settings.yaw ?? world.cam.yaw,
    pitch: settings.pitch ?? world.cam.pitch, dist: settings.dist ?? world.cam.dist,
    zoom: settings.zoom ?? 1, ortho: Boolean(settings.ortho) };
  const t = settings.t ?? world.lookSnapshot?.time ?? 0, px = settings.px ?? 1;
  if (![settings.w, settings.h, px].every(n => Number.isSafeInteger(n) && n > 0))
    throw new TypeError('Look comparisons need positive integer dimensions and art-pixel size');
  const render = { ...settings, t, px, passes: ['splatId', 'target'], lookAudit: true, lookPassRegistry: registry() };
  const catalog = Preview.assets(world, opt, kit), directory = file ? path.dirname(path.resolve(file)) : process.cwd();
  const frames = [];
  let baseline, ownership;
  const results = variants.map(({ id, look }) => {
    const scene = Preview.variant(world, look, kit, catalog, directory);
    const frame = R.render(scene, { ...render, ...(look === false || look === 'off' ? { ignoreLookGrade: true } : {}) });
    const row = { id, clipping: frame.lookAudit.clipping, swatches: swatchUsage(frame) };
    if (!baseline) {
      baseline = frame;
      ownership = ownerGroups(world, frame);
    } else row.difference = difference(baseline, frame, ownership);
    if (images) frames.push({ w: frame.w, h: frame.h, rgb: frame.rgb });
    return row;
  });
  return { report: { scene: world.id ?? null, seed: world.seed, time: t,
    ...(world.lookSnapshot?.tick !== undefined && { tick: world.lookSnapshot.tick }),
    camera, width: baseline.w, height: baseline.h, baseline: variants[0].id, results }, frames };
}

module.exports = { compare };
