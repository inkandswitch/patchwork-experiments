// Generate original pixel-art inputs, run the CLI graph, and assemble a review board.
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {KIT} = require('..').load();
const PNG = require('../cli/png.js');
const {font} = require('../src/target-inspection.js');
const R = KIT.procedural.raster;

const directory = path.resolve(process.argv[2] || 'raster-composition-review');
const width = 106, height = 60;
const transparent = [0, 0, 0, 0];
const swatches = new Map();
function rgb(hex) {
  if (!swatches.has(hex)) swatches.set(hex, [...[16, 8, 0].map(shift => (hex >> shift) & 255), 255]);
  return swatches.get(hex);
}
function surface(w, h, sample) {
  const result = R.canvas({width: w, height: h});
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const value = sample(x, y);
    result.data.set(typeof value === 'number' ? rgb(value) : value, (y * w + x) * 4);
  }
  return result;
}
function gray(sample) {
  return surface(width, height, (x, y) => {
    const n = Math.round(Math.max(0, Math.min(255, sample(x, y))));
    return [n, n, n, 255];
  });
}
const noise = (x, y) => ((Math.imul(x + 101, 3266489917) ^ Math.imul(y + 29, 668265263)) >>> 10) % 101 / 101;
const band = (v, colors) => colors[Math.max(0, Math.min(colors.length - 1, Math.floor(v * colors.length)))];

function ring(angle, colors) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return surface(width, height, (x, y) => {
    const u = (x - 52.5) * c + (y - 29.5) * s, v = (y - 29.5) * c - (x - 52.5) * s;
    const d = Math.hypot(u / 41, v / 15);
    if (d < .75 || d > 1.12) return transparent;
    if (d > 1.06 || d < .8) return colors[0];
    const shine = .68 - v / 46 + .12 * Math.cos(u / 5) + .08 * noise(x, y);
    return band(shine, colors.slice(1));
  });
}
const starfield = surface(width, height, (x, y) => {
  const grid = noise(x, y);
  if (grid > .989 && noise(y * 2, x + 31) > .7) return 0x5b6b85;
  if ((x + 1) % 16 === 0 && (y + 5) % 16 === 0) return 0x32465a;
  return y > 34 ? 0x101925 : 0x172333;
});

function rockLevel(x, y) {
  const row = Math.floor(y / 11), u = (x + row % 2 * 9) % 18, v = y % 11;
  const joint = Math.min(u + .2, 18 - u, v + .3, 11 - v);
  return Math.min(1, joint * .33) * (.62 + .32 * noise(Math.floor((x + row % 2 * 9) / 18), row)) + .08 * noise(x, y);
}
const rockRamp = [0x281e31, 0x403444, 0x53475a, 0x706476, 0x8f8193, 0xb1a1a4];
const mossRamp = [0x243932, 0x354831, 0x636539, 0x8d8b46, 0xa8a05b, 0xd0bb78];
const mossLevel = (x, y) => .23 + .23 * Math.sin(x * .067 + y * .08) ** 2 + .17 * noise(x, y);
const rock = surface(width, height, (x, y) => band(rockLevel(x, y) + .035 * Math.sin((x + y) * .52), rockRamp));
const moss = surface(width, height, (x, y) => band(mossLevel(x, y) + .18 + .17 * noise(y, x), mossRamp));

const beacon = surface(width, height, (x, y) => {
  const sea = y >= 40, glow = Math.hypot((x - 44) * .82, y - 25);
  if (sea) {
    if (y === 40 || noise(y * 5, x % 19) > .83 && (x + y * 2) % 17 < 11)
      return band(1 - glow / 80, [0x153043, 0x265066, 0x437084]);
    if (y > 44 && x > 25 && x < 56 && noise(Math.floor(x / 6), y) > .7) return 0x73556a;
    return y % 5 === 3 ? 0x192e45 : 0x172737;
  }
  if (x >= 33 && x < 49 && y >= 34 && y <= 42) return y > 38 ? 0x221c30 : 0x363148;
  if (x > 37 && x < 46 && y >= 20 && y < 36) {
    if (y < 26) return x < 40 || x === 44 ? 0x241d32 : (x === 41 ? 0xffd08a : 0xdb8a67);
    return x < 41 ? 0x74617b : 0x3d3954;
  }
  if (y >= 16 && y < 20 && Math.abs(x - 41.5) <= (y - 15) * 1.55) return y === 19 ? 0x997081 : 0x5c455f;
  if (y > 33 && Math.sin(x * .09) - Math.cos(x * .18) < (y - 35) / 4) return 0x34334b;
  if (noise(x, y) > .983 && y < 22) return 0x786c82;
  return band(y / 41, [0x192138, 0x262744, 0x3f3550, 0x60465b, 0x79536c]);
});
const lightMask = gray((x, y) => 140 * Math.exp(-Math.hypot((x - 42) * .8, y - 23) / 6.2) +
  (x > 43 ? 78 * Math.exp(-Math.abs(y - 22 - (x - 43) * .10) / (1 + (x - 43) * .045)) : 0));

const medallion = surface(30, 28, (x, y) => {
  const u = x - 14.5, v = y - 13.5, d = Math.hypot(u, v);
  if (d > 11.8) return transparent;
  if (d > 11) return 0x5c3848;
  if (d > 8) return band(.52 - (u + v) / 45 + .15 * noise(x, y), [0x985b51, 0xc58258, 0xeab673, 0xfce5a7]);
  const wave = v - 2 * Math.cos(u * .6);
  if (Math.abs(u) + Math.abs(v + 3) < 2.4) return 0xfce5a7;
  return band(.54 + wave / 21 + .08 * noise(x, y), [0x233e56, 0x2b6572, 0x4e9a93, 0x9dd3b2]);
});

const panel = surface(28, 26, (x, y) => {
  const u = Math.min(x - 2, 25 - x), v = Math.min(y - 2, 23 - y);
  if (u < 0 || v < 0 || u + v < 2) return transparent;
  if (u === 0 || v === 0) return 0x94595e;
  if (u === 1 || v === 1) return 0xe9b778;
  if (u + v < 8 && u > 1 && v > 1) return u === v ? 0xf9d59b : 0xb37a70;
  if (u === 4 || v === 4) return 0x6c4b63;
  return noise(Math.floor(x / 2), Math.floor(y / 2)) > .73 ? 0x473451 : 0x342841;
});

function sprite(w, h, kind, color) {
  return surface(w, h, (x, y) => {
    const u = (x + .5) / w * 2 - 1, v = (y + .5) / h * 2 - 1;
    const d = kind === 'kite' ? Math.abs(u) + Math.abs(v) * .8
      : kind === 'spire' ? Math.max(Math.abs(u) * 1.32, Math.abs(v) * .9 + Math.abs(u) * .36)
      : Math.hypot(u, v - Math.sin(u * 7) * .16);
    if (d > .82 || x === 0 || y === 0) return transparent;
    const sh = .55 - u * .32 - v * .25 + .13 * noise(x, y);
    return d > .72 ? color[0] : band(sh, color);
  });
}

const nodes = {}, assets = {}, outputs = {}, artifacts = {};
function op(name, kind, inputs) {
  nodes[name] = {op: kind, inputs};
  return {node: name};
}
function asset(name, raster) {
  const file = 'inputs/' + name + '.png';
  fs.writeFileSync(path.join(directory, file), PNG.encode(raster.width, raster.height, raster.data, 4));
  assets[name] = {format: 'png', file};
  return op(name, 'pngAsset', {name});
}
const record = (name, inputs) => op(name, 'data.record', inputs);
function collect(name, entries) {
  return op(name, 'data.collect', {source: record(name + 'Entries', entries), keys: Object.keys(entries)});
}
function expose(name, link, format = 'png') {
  outputs[name] = link;
  artifacts[name] = {output: name, format};
}
function channel(name, source) {
  return op(name, 'raster.channel', {source, options: {channel: 'r'}});
}
function layers(name, entries, operation, options = {}) {
  return op(name, operation, {width, height, layers: collect(name + 'Layers', entries), options});
}

fs.mkdirSync(path.join(directory, 'inputs'), {recursive: true});
const space = record('spaceLayer', {source: asset('stars', starfield), depth: 250});
const gold = record('goldLayer', {source: asset('gold', ring(.28, [0x713b5b, 0xa65365, 0xdd886d, 0xffc584, 0xffe1a4])),
  depth: channel('goldZ', asset('goldDepth', gray((x, y) => 136 + (x - 53) * 1.4 + (y - 30) * .28)))});
const jade = record('jadeLayer', {source: asset('jade', ring(-.32, [0x285263, 0x367b82, 0x59aa9b, 0xa3d3a7, 0xe1e7b9])),
  depth: channel('jadeZ', asset('jadeDepth', gray((x, y) => 136 - (x - 53) * 1.4)))});
expose('depthBase', layers('depthBase', {space, gold, jade}, 'raster.stack'));
expose('depthSorted', layers('depthSorted', {space, gold, jade}, 'raster.depth'));

const stone = asset('stone', rock), growth = asset('growth', moss);
expose('heightBase', op('heightBase', 'raster.blend', {background: stone, foreground: growth, options: {opacity: .52}}));
const stoneLayer = record('stoneLayer', {source: stone,
  height: channel('stoneH', asset('stoneHeight', gray((x, y) => rockLevel(x, y) * 255)))});
const mossLayer = record('mossLayer', {source: growth,
  height: channel('mossH', asset('mossHeight', gray((x, y) => mossLevel(x, y) * 255)))});
expose('heightBlend', layers('heightBlend', {stoneLayer, mossLayer}, 'raster.height', {softness: 31}));

const lighthouse = asset('lighthouse', beacon);
const light = op('light', 'raster.canvas', {width, height, color: [255, 176, 93]});
const gain = op('gain', 'raster.math', {a: channel('lightLuma', asset('lightMask', lightMask)), b: 1.8, op: 'multiply'});
const illumination = op('illumination', 'raster.mask', {source: light, mask: gain});
expose('beaconBase', lighthouse);
expose('beaconGlow', op('beaconGlow', 'raster.blend', {background: lighthouse, foreground: illumination, options: {mode: 'screen'}}));

const coin = asset('coin', medallion), panelSource = asset('panelSource', panel);
const minted = op('minted', 'raster.spriteStack', {source: coin,
  options: {shift: [.46, -1], count: 12, angle: .3, tint: [.43, .44, .59]}});
expose('coin', coin);
expose('spriteStack', minted);
const frame = op('frame', 'raster.crop', {source: panelSource, options: {x: 2, y: 2, width: 24, height: 22}});
expose('cornerTile', op('cornerTile', 'raster.resize', {source: frame, options: {width: 48, height: 44}}));
expose('nineSlice', op('nineSlice', 'raster.nineSlice', {source: frame,
  options: {width: 92, height: 44, insets: [5, 5, 5, 5], fill: 'repeat'}}));

const crop = op('lantern', 'raster.crop', {source: lighthouse, options: {x: 35, y: 15, width: 14, height: 22}});
const spriteMap = {
  token: coin, minted, lantern: crop, frame,
  buoy: asset('buoy', sprite(18, 27, 'spire', [0x833753, 0xd05769, 0xf0817c, 0xfad0a3])),
  shard: asset('shard', sprite(29, 19, 'kite', [0x345a74, 0x4c839b, 0x6fbbc6, 0xa3e7d1])),
  pearl: asset('pearl', sprite(17, 15, 'ball', [0x6d5481, 0xa578a5, 0xd59db8, 0xfbd4bc])),
  sail: asset('sail', sprite(23, 33, 'kite', [0x525080, 0x7360a2, 0x9c83bd, 0xf4bed1]))
};
const sheet = op('sheet', 'raster.pack', {sprites: collect('sprites', Object.fromEntries(Object.entries(spriteMap)
  .map(([id, source]) => [id, record(id + 'Sprite', {id, source})]))), options: {maxWidth: 106, trim: true, padding: 2, extrude: 1}});
expose('spriteSheet', sheet);
expose('spriteAtlas', {...sheet, port: 'atlas'}, 'atlas');

const project = path.join(directory, 'composition.json');
fs.writeFileSync(project, JSON.stringify({
  format: 'ink-studio/graph-project', version: 1, assets, nodes, outputs, exports: artifacts,
  assertions: [{id: 'spriteCount', output: 'spriteAtlas', path: ['metadata', 'frames', 'length'], op: 'eq', value: 8}]
}, null, 2) + '\n');
const graphOut = path.join(directory, 'graph');
const run = spawnSync(process.execPath,
  [path.join(__dirname, '../cli/ink-studio.js'), 'graph', 'run', project, '--out', graphOut],
  {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024});
if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || 'Raster graph failed');

const W = 1228, H = 1008;
const background = R.canvas({width: W, height: H, color: rgb(0x111723)});
const glyphs = font(KIT.ascii.atlas());
function rect(x, y, w, h, color) {
  for (let v = y; v < y + h; v++) for (let u = x; u < x + w; u++) background.data.set(rgb(color), (v * W + u) * 4);
}
function label(value, x, y, size, color) {
  Array.from(value).forEach((character, i) => {
    const data = glyphs.get(character);
    if (!data) return;
    for (let v = 0; v < 8; v++) for (let u = 0; u < 6; u++)
      if (data[v * 6 + u]) rect(x + (i * 6 + u) * size, y + v * size, size, size, color);
  });
}
function preview(name, x, y, scale, w, h) {
  const image = PNG.raster(path.join(graphOut, 'artifacts', name + '.png'));
  const raster = R.resize({width: image.w, height: image.h, data: image.data},
    {width: image.w * scale, height: image.h * scale});
  const ox = x + Math.floor((w - raster.width) / 2), oy = y + Math.floor((h - raster.height) / 2);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const a = u + x - ox, b = v + y - oy, off = (b * raster.width + a) * 4;
    const alpha = a >= 0 && a < raster.width && b >= 0 && b < raster.height ? raster.data[off + 3] / 255 : 0;
    const base = rgb((Math.floor(u / 12) + Math.floor(v / 12)) % 2 ? 0x192434 : 0x202f3e);
    const pixel = ((y + v) * W + x + u) * 4;
    for (let channel = 0; channel < 3; channel++)
      background.data[pixel + channel] = alpha ? Math.round(base[channel] * (1 - alpha) + raster.data[off + channel] * alpha) : base[channel];
  }
}
function card(x, y, tag, title, note, pictures) {
  rect(x, y, 568, 264, 0x1e293a);
  rect(x, y, 568, 1, 0x3b5262);
  rect(x + 18, y + 24, 9, 9, 0xe9ae77);
  label(tag, x + 35, y + 21, 2, 0xe9ae77);
  label(title, x + 18, y + 48, 2, 0xf8e8c6);
  pictures.forEach(([name, subtitle, scale, width], i) => {
    const left = x + 18 + (i ? 272 : 0);
    preview(name, left, y + 77, scale, width, 144);
    label(subtitle, left + 1, y + 228, 2, 0x9ec8ca);
  });
  label(note, x + 18, y + 249, 1, 0xaab7c5);
}

rect(36, 33, 32, 4, 0xf1b37d);
label('INK STUDIO / CLI GRAPH', 80, 27, 2, 0x8dd3cc);
label('RASTER COMPOSITION', 36, 61, 4, 0xf8e8c6);
label('Native pixel-art outputs from one versioned graph', 38, 107, 2, 0xaab7c5);
card(36, 148, '01', 'PER-PIXEL DEPTH', 'Intersecting rings trade foreground at the two crossings.', [
  ['depthBase', 'LAYER ORDER', 2, 260], ['depthSorted', 'DEPTH ORDER', 2, 260]
]);
card(624, 148, '02', 'HEIGHT BLEND', 'Moss settles between the raised stones.', [
  ['heightBase', 'OPACITY MIX', 2, 260], ['heightBlend', 'HEIGHT MAPS', 2, 260]
]);
card(36, 426, '03', 'MASK AND SCREEN', 'Channel gain drives a masked lantern beam.', [
  ['beaconBase', 'SOURCE', 2, 260], ['beaconGlow', 'SCREEN LIGHT', 2, 260]
]);
card(624, 426, '04', 'SPRITE STACK', 'Repeat and offset the rotated sprite to build thickness.', [
  ['coin', 'FLAT TILE', 4, 260], ['spriteStack', '12 SLICES', 3, 260]
]);
card(36, 704, '05', 'CROP AND NINE-SLICE', 'The edges and corners keep their original proportions.', [
  ['cornerTile', 'NEAREST RESIZE', 2, 260], ['nineSlice', 'REPEAT CENTER', 2, 260]
]);
card(624, 704, '06', 'PACKED SPRITE ATLAS', 'Eight frames, trimmed pivots, spacing and one-pixel extrusion.', [
  ['spriteSheet', 'RENDER-READY RGBA SHEET', 2, 532]
]);
rect(36, 986, 1156, 1, 0x3b5262);
label('INK STUDIO  /  RASTER GRAPH REVIEW', 36, 992, 1, 0x8da3b3);
const board = path.join(directory, 'raster-composition.png');
fs.writeFileSync(board, PNG.encode(W, H, background.data, 4));
console.log(board);
