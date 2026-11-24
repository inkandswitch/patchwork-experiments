const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const Assets = require('./asset-files.js');
const FrameComposite = require('../src/frame-composite.js');

const format = 'ink-studio/visual-sweep', pinFormat = 'ink-studio/sweep-pin';
const maxRuns = 48, maxFrames = 120, maxPixels = 64e6;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const finiteTime = n => Number.isFinite(n) && n >= 0;
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
function check(condition, message) {
  if (!condition) throw new RangeError(message);
}
function outputPath(opt, extra = []) {
  check(Object.keys(opt).every(key => ['out', ...extra].includes(key)) && typeof opt.out === 'string' && opt.out.length,
    'Visual sweeps need --out and use settings from their plan');
  return path.resolve(opt.out);
}

function visual(raw, { kit, mode, start = 0 }) {
  check(fields(raw, ['width', 'height', 'pixelSize', 'columns', 'at', 'clip', 'title']), 'Invalid visual sweep settings');
  const { width = 240, height = 144, pixelSize = 2, columns = 3, clip, title } = raw;
  const sim = mode === 'sim';
  check(integer(width, 64, 1024) && integer(height, 32, 1024) && integer(pixelSize, 1, 16) &&
    width % pixelSize === 0 && height % pixelSize === 0 && integer(columns, 1, 8) &&
    (title === undefined || typeof title === 'string' && title.length <= 120),
    'Invalid sweep dimensions, pixel size, columns or title');
  let times = [], fps;
  if (clip !== undefined) {
    check(fields(clip, sim ? ['from', 'to', 'every', 'fps'] : ['from', 'to', 'fps']),
      'Invalid sweep clip settings');
    const { from = start, to, every = 1 } = clip;
    fps = clip.fps ?? 12;
    check(integer(fps, 1, 120) && finiteTime(from) && finiteTime(to) && from >= start && to > from,
      'A sweep clip needs an increasing range and an integer frame rate');
    if (sim) times = kit.world.observations.schedule({ from, to, every });
    else {
      const count = Math.max(2, Math.round((to - from) * fps));
      check(count <= maxFrames && from + (count - 1) / fps <= to + 1e-9,
        'Sweep clip must fit 2–120 frames inside its time range');
      times = Array.from({ length: count }, (_, i) => from + i / fps);
    }
    check(times.length <= maxFrames, 'A sweep clip supports at most 120 frames');
  }
  const at = raw.at ?? times[0] ?? start;
  check(finiteTime(at) && at >= start && (!sim || Number.isSafeInteger(at)),
    'The sweep poster must be at a valid time or tick at or after the start');
  const ordered = [...new Set([...times, at])].sort((a, b) => a - b);
  return { width, height, pixelSize, columns, title, at, clip, fps, times, ordered };
}

function sizeOf(visual, count) {
  const columns = Math.min(visual.columns, count), tileWidth = Math.max(168, visual.width) + 18;
  const tileHeight = visual.height + 56, width = 18 + columns * tileWidth;
  const height = 54 + Math.ceil(count / columns) * tileHeight;
  check(width <= 8192 && height <= 8192 && width * height * (visual.times.length + 1) <= maxPixels,
    'Visual sweep exceeds its contact sheet pixel budget');
  return { width, height, columns, tileWidth, tileHeight };
}

function small(value) {
  return typeof value === 'number' ? String(Number(value.toPrecision(6))) :
    typeof value === 'string' ? value : JSON.stringify(value);
}
function sheet(kit, visual, tiles, title, anchor) {
  const { width, height, columns, tileWidth, tileHeight } = sizeOf(visual, tiles.length);
  const draw = [], positions = [];
  const text = (value, x, y, size, color = '#eff3f5') => draw.push({ type: 'text', text: value, at: [x, y], size, color });
  const rect = (x, y, w, h, color) => draw.push({ type: 'rect', rect: [x, y, w, h], color });
  function fit(s, pixels) {
    const count = Math.max(6, Math.floor(pixels / 5.9));
    return s.length <= count ? s : s.slice(0, count - 3) + '...';
  }
  text(fit(title, width - 36), width / 2, 19, width < 420 ? 13 : 17);
  text(tiles.length + (tiles.length === 1 ? ' case' : ' cases') +
    (visual.fps ? '   /   ' + visual.fps + ' FPS, ' + visual.times.length + ' frames' : ''),
  width / 2, 40, 10, '#a6b7c2');
  const equal = kit.world.data.equal;
  tiles.forEach((tile, i) => {
    const x = 9 + (i % columns) * tileWidth, y = 53 + Math.floor(i / columns) * tileHeight;
    const middle = x + tileWidth / 2, left = Math.floor(middle - visual.width / 2), top = y + 25;
    const pinned = anchor && tile.seed === anchor.seed && tile.case === anchor.case && equal(tile.parameters, anchor.parameters);
    rect(x + 4, y + 2, tileWidth - 8, tileHeight - 9, pinned ? '#385149' : '#263442');
    rect(x + 6, y + 4, tileWidth - 12, tileHeight - 13, '#121e2b');
    text(fit(String(i + 1).padStart(2, '0') + '  /  seed ' + tile.seed + (pinned ? '  /  PIN' : ''), tileWidth - 18),
      middle, y + 15, 10, pinned ? '#b8f2ca' : '#dce6ec');
    const parts = Object.entries(tile.parameters).map(([key,value]) => key + '=' + small(value));
    text(fit(parts.length ? parts.join('   ') : tile.case, tileWidth - 18), middle, top + visual.height + 11, 10, '#abbec9');
    positions.push({ left, top });
  });
  const plan = kit.frameComposite.prepare({ layers: [{ draw }] }, width, height, 1);
  const paper = FrameComposite.compose({ w:1,h:1,rgb:Uint8Array.of(11,18,27) },
    kit.frameComposite.layers(plan, {}, 0), width, height, 'nearest');
  return at => {
    const rgb = paper.rgb.slice();
    for (const [i, tile] of tiles.entries()) {
      const { left, top } = positions[i], frame = tile.frames.get(at);
      for (let row = 0; row < visual.height; row++)
        rgb.set(frame.rgb.subarray(row * visual.width * 3, (row + 1) * visual.width * 3),
          ((top + row) * width + left) * 3);
    }
    return { w: width, h: height, rgb };
  };
}

function checkDirectory(directory) {
  if (fs.existsSync(directory))
    check(fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length === 0,
      'Choose a new or empty sweep output directory');
}
function publish(directory, write) {
  checkDirectory(directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(directory), '.ink-sweep-'));
  try {
    write(temporary);
    fs.renameSync(temporary, directory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function finish({ kit, directory, recipe, visual, tiles, numeric, name, anchor }) {
  const { ordered, times, fps, at, width, height } = visual;
  for (const tile of tiles)
    check(ordered.every(time => {
      const frame = tile.frames.get(time);
      return frame?.w === width && frame.h === height && frame.rgb.length === width * height * 3;
    }), 'Sweep renderer did not produce a matching tile at every sample');
  const draw = sheet(kit, visual, tiles, visual.title || name, anchor);
  const sheetFiles = { image: 'sheet.png', ...(fps && { clip: 'sheet.apng' }) };
  const result = {
    format, version: 1, recipe, ...(anchor && { anchor }), sheet: sheetFiles,
    samples: { units: recipe.mode === 'sim' ? 'ticks' : 'seconds', poster: at, ...(fps && { frames: times, fps }) },
    tiles: tiles.map(({ frames, ...tile }, i) => {
      const file = 'cases/' + String(i + 1).padStart(3, '0');
      return { ...tile, tile: i + 1, image: file + '.png', ...(fps && { clip: file + '.apng' }) };
    })
  };
  publish(directory, temp => {
    fs.mkdirSync(path.join(temp, 'cases'));
    function still(file, { w, h, rgb }) { PNG.write(path.join(temp, file), w, h, rgb); }
    function clip(file, frame) {
      fs.writeFileSync(path.join(temp,file), PNG.encodeAnimation(times.map(t => PNG.packFrame(frame(t))), fps));
    }
    still(sheetFiles.image, draw(at));
    if (fps) clip(sheetFiles.clip, draw);
    result.tiles.forEach(({ image, clip: movie }, i) => {
      const frames = tiles[i].frames;
      still(image, frames.get(at));
      if (movie) clip(movie, time => frames.get(time));
    });
    Assets.json(path.join(temp, 'report.json'), numeric ? { ...numeric, visual: result } : result);
  });
  return { directory, cases: tiles.length, poster: path.join(directory, sheetFiles.image),
    ...(fps && { clip: path.join(directory, sheetFiles.clip) }), report: path.join(directory, 'report.json') };
}

function canonicalVisual(plan, settings) {
  const { width, height, columns, pixelSize, at } = settings;
  return { ...plan, visual: { ...plan.visual, width, height, columns, pixelSize, at } };
}
function runScene({ kit, source, plan, directory, loadScene, renderCase, anchor }) {
  check(fields(plan, ['controls', 'visual', 'seeds', 'parameters', 'cases']) && record(plan.controls ?? {}),
    'Scene sweep plans use controls, seeds, parameters, cases and visual settings');
  checkDirectory(directory);
  const settings = visual(plan.visual, { kit, mode: 'scene' });
  const { seeds, groups, runCount } = kit.world.observations.matrix(plan, { scene: true, limit: maxRuns });
  sizeOf(settings, runCount);
  const scene = loadScene(source);
  const actualSeeds = seeds ?? [scene.seed ?? 0];
  check(actualSeeds.every(Number.isSafeInteger), 'Sweep seeds need distinct safe integers');
  const tiles = [];
  for (const group of groups) {
    const controls = kit.world.apply({ ...plan.controls, ...group.controls }, group.edits, { validate: value => value }).world;
    for (const seed of actualSeeds) {
      const id = group.id + '@' + seed;
      try {
        const frames = renderCase(source, { seed, controls }, settings);
        tiles.push({ id, case: group.case, seed, parameters: group.parameters, frames });
      } catch (error) { throw Error('Sweep run ' + id + ': ' + error.message, { cause: error }); }
    }
  }
  const recipe = { mode: 'scene', source, plan: canonicalVisual(plan, settings) };
  return finish({ kit, directory, recipe, visual: settings, tiles, name: scene.name ?? scene.id, anchor });
}

function runSimulation({ kit, source, plan, directory, input, workerPool, runtime, renderFrame, anchor }) {
  checkDirectory(directory);
  const { visual: raw, ...numericPlan } = plan;
  const settings = visual(raw, { kit, mode: 'sim', start: input.tick ?? 0 });
  const prepared = kit.world.observations.prepare(numericPlan, { visual: true, limit: maxRuns });
  sizeOf(settings, prepared.runCount);
  const tiles = new Map();
  const numeric = prepared.run(input, {
    runtime: { workerPool }, capture: { ticks: settings.ordered, frame(view, query, sample) {
      const { tick, dt, ...tile } = sample;
      if (!tiles.has(tile.id)) tiles.set(tile.id, { ...tile, frames: new Map() });
      tiles.get(tile.id).frames.set(tick, renderFrame(view, query, settings, tile.id, tick, tick * dt));
    } }
  });
  const recipe = { mode: 'sim', source, runtime, plan: canonicalVisual(plan, settings) };
  return finish({ kit, directory, recipe, visual: settings, tiles: [...tiles.values()], numeric, name: numeric.world, anchor });
}

function pin(report, selection) {
  const result = report.visual ?? report;
  check(result.format === format && result.version === 1 && Array.isArray(result.tiles) &&
    record(result.recipe) && record(result.recipe.plan), 'Expected a visual sweep report');
  const tile = result.tiles.find(row => row.id === selection || String(row.tile) === selection);
  check(tile, 'No visual sweep tile matches ' + selection);
  const { recipe } = result, { plan } = recipe;
  const choice = (plan.cases ?? [{ id: 'base' }]).find(row => row.id === tile.case);
  check(choice && Number.isSafeInteger(tile.seed), 'The sweep report is missing its selected case or seed');
  const parameters = Object.fromEntries(Object.entries(plan.parameters ?? {}).map(([name, parameter]) => {
    check(Object.hasOwn(tile.parameters, name), 'The sweep report is missing parameter ' + name);
    return [name, { ...parameter, values: [tile.parameters[name]] }];
  }));
  const anchor = { id: tile.id, case: tile.case, seed: tile.seed, parameters: tile.parameters };
  return { format: pinFormat, version: 1, anchor, recipe: {
    ...recipe, plan: { ...plan, seeds: [tile.seed], cases: [choice], parameters }
  } };
}

function loadPin(file, nearby) {
  const pin = read(file);
  check(pin?.format === pinFormat && pin.version === 1 && record(pin.anchor) && record(pin.recipe) &&
    ['sim', 'scene'].includes(pin.recipe.mode) && typeof pin.recipe.source === 'string' &&
    record(pin.recipe.plan) && record(pin.recipe.plan.parameters), 'Expected a saved sweep pin');
  if (nearby === undefined) return pin;
  const offsets = read(nearby);
  check(record(offsets) && Object.keys(offsets).length, 'Nearby sweeps need named parameter offsets');
  const { parameters } = pin.recipe.plan;
  for (const [name, shifts] of Object.entries(offsets)) {
    const base = Object.hasOwn(parameters, name) ? parameters[name]?.values?.[0] : undefined;
    check(Number.isFinite(base) && Array.isArray(shifts) && shifts.length > 0 && shifts.length <= maxRuns &&
      shifts.every(delta => Number.isFinite(delta) && Number.isFinite(base + delta)),
      'Nearby offsets need a pinned numeric parameter and finite values for ' + name);
    parameters[name].values = [...new Set([...shifts, 0].sort((a,b) => a-b).map(delta => delta === 0 ? base : base + delta))];
  }
  return pin;
}

function sourcePath(id) {
  return /\.(?:js|json|obj|gltf|glb)$/i.test(id) || id.includes('/') ? path.resolve(id) : id;
}

module.exports = { read, outputPath, runScene, runSimulation, pin, loadPin, sourcePath };
