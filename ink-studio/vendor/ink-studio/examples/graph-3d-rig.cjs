// Build the editable Relay Foundry graph and render it through the CLI.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT } = ink.load();
const { raster: R, drawing2d: D } = KIT.procedural;
const PNG = require('../cli/png.js');

const dir = path.resolve(process.argv[2] || 'graph-3d-review');
fs.mkdirSync(dir, { recursive: true });
const nodes = {}, outputs = {}, exportsSpec = {};
const n = (node, port) => ({ node, ...(port && { port }) });
function op(id, type, inputs) {
  nodes[id] = { op: type, inputs };
  return n(id);
}
const record = (id, inputs) => op(id, 'data.record', inputs);
function array(id, rows) {
  const entries = Object.fromEntries(rows.map((source, i) => ['item' + i, source]));
  return op(id, 'data.collect', { source: record(id + 'Entries', entries), keys: Object.keys(entries) });
}
function show(id, link, format = 'png') {
  outputs[id] = link;
  exportsSpec[id] = { output: id, format };
}
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const draw = (width, height, commands) => D.render({ width, height, edges: 'hard', commands });
const raster = (id, width, height, commands) => op(id, 'draw.render', { width, height, edges: 'hard', commands });
const write = (name, { width, height, data }) =>
  fs.writeFileSync(path.join(dir, name + '.png'), PNG.encode(width, height, data, 4));

const size = 56, badgePixels = [];
const finishes = {
  brass: [205, 128, 63, 255], light: [247, 190, 112, 255], gold: [231, 159, 80, 255],
  copper: [135, 72, 60, 255], dark: [83, 53, 60, 255], jade: [55, 142, 132, 255], highlight: [109, 200, 161, 255],
  midnight: [34, 65, 80, 255]
};
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = x + .5 - size / 2, dy = y + .5 - size / 2, theta = Math.atan2(dy, dx);
  const radius = Math.hypot(dx, dy), tooth = Math.cos(theta * 12);
  const rim = tooth > .33 ? 26.6 : 23.8;
  const rivet = [0, 1, 2, 3].some(i => {
    const a = Math.PI * (.25 + i * .5);
    return Math.hypot(dx - 17.2 * Math.cos(a), dy - 17.2 * Math.sin(a)) < 2.9;
  });
  let shade = 'brass';
  if (radius > rim || radius < 7.7 || rivet) {
    badgePixels.push(0, 0, 0, 0);
    continue;
  }
  if (radius > rim - 1.6 || radius < 9.3) shade = dy < -dx * .4 ? 'light' : 'copper';
  else if (radius > 20.8) shade = tooth > .33 ? 'gold' : 'brass';
  else if (radius > 19.3) shade = 'dark';
  else if (radius < 12.7) shade = 'gold';
  else if (Math.cos(theta * 4) > .76) shade = dy < 6 ? 'highlight' : 'jade';
  else shade = radius > 17.1 ? 'jade' : 'midnight';
  badgePixels.push(...finishes[shade]);
}
const badge = { width: size, height: size, channels: 4, data: badgePixels };
const badgeNode = op('badge', 'data.typed', { value: badge });
nodes.badge.type = 'raster';
const extrude = op('badgePlate', 'geo.extrudeImage', {
  source: badgeNode, options: { pixelSize: .045, depth: .37, edgeColor: '#805263' }
});
show('source-badge', badgeNode);
show('badge-mesh', extrude, 'json');

const shape = (id, kind, options) => op(id, 'sdf.shape', { kind, options });
const block = shape('block', 'box', { half: [.91, .9, .35], round: .245 });
const ring = shape('ring', 'torus', { major: .59, minor: .155, center: [0, .03, .27], rotation: [Math.PI / 2, 0, 0] });
const union = op('embossed', 'sdf.combine', { sources: array('addRelief', [block, ring]) });
const hole = shape('coreBore', 'capsule', { radius: .42, length: 1.6, center: [0, .03, 0], rotation: [Math.PI / 2, 0, 0] });
const gouges = [[-.83, .79], [.83, .79], [-.83, -.79], [.83, -.79]].map(([x, y], i) =>
  shape('notch' + i, 'sphere', { center: [x, y, .35], radius: .31 }));
const field = op('sigilField', 'sdf.combine', {
  sources: array('drill', [union, hole, ...gouges]), options: { operation: 'subtract' }
});
const slices = op('sigilSlices', 'sdf.slices', {
  source: field, options: { width: 26, height: 26, count: 14, color: '#63b8aa' }
});
const voxels = op('sigilStack', 'geo.sliceStack', { slices, options: n('sigilSlices', 'layout') });
show('slice-mesh', voxels, 'json');

const sideView = op('detailCamera', 'scene.camera', { options: { dist: 3.9, yaw: -.38, pitch: .33, projection: 'orthographic' } });
const sun = op('sun', 'scene.light', { kind: 'sun', options: {
  direction: [-.6, .73, .5], ambient: .44, intensity: .76, shadows: true, mapSize: 192, bias: .023
} });
const lamp = op('copperLamp', 'scene.light', { kind: 'disk', options: {
  at: [-2.7, 3.5, 3], normal: [1, -1, -1], size: [2, 1.2], color: '#ffbb7a', radius: 6.4, intensity: 1.8,
  sampleGrid: 2, shadows: true, visible: false
} });
const fill = op('tealLamp', 'scene.light', { kind: 'point', options: {
  at: [3, 1.8, 2.05], color: '#74ecd3', radius: 5, intensity: 1.14, shadows: false
} });
const lights = array('lights', [sun, lamp, fill]);
const direct = op('direct', 'sdf.render', { source: field, camera: sideView, lights: array('directLights', [sun]), options: {
  width: 164, height: 112, color: '#5fb4a6', background: '#212c3f', shades: 12
} });
show('direct-sdf', direct);
const pass = (id, from, channel) => op(id, 'scene.pass', { frame: n(from.node, 'frame'), channel });
show('sdf-normal', pass('directNormals', direct, 'normal'));

const box = (id, center, half, color) => op(id, 'geo.box', { options: { center, half, color } });
const foot = (id, start, end, radius, color) => op(id, 'geo.tube', {
  start, end, options: { radius, sides: 14, color }
});
const place = (id, source, position, rotation) => op(id, 'geo.transform', { source, options: { position, rotation } });
const object = (id, source, options = {}) => op(id, 'scene.object', { source, options });
const badgeRotation = [0, .07, -.12];
const modelBadge = place('platePosition', extrude, [-1.47, 1.62, .09], badgeRotation);
const plateArt = op('plateArt', 'warp.surface', { source: badgeNode,
  mesh: place('texturePosition', n('badgePlate', 'front'), [-1.47, 1.62, .125], badgeRotation) });
const modelVoxels = place('stackPosition', voxels, [1.34, 1.45, .1], [0, -.12, 0]);
const platform = box('platform', [0, -.22, 0], [3.3, .18, 1.12], '#516280');
const baseTrim = box('platformTrim', [0, -.025, 0], [3.13, .055, 1.04], '#7b7180');
const benchLeft = foot('benchLeft', [-1.45, .02, .02], [-1.45, .57, .02], .65, '#683f5c');
const benchRight = foot('benchRight', [1.34, .02, .06], [1.34, .58, .06], .61, '#3e696b');
const inlay = box('inlay', [0, -.16, 1.126], [1.78, .038, .005], '#e5ad71');
const glowing = object('inlayObject', inlay, { resolution: .041, thickness: .012, emissive: true, cells: 30, material: 'copper-inlay' });
const objects = array('objects', [
  object('extruded-badge', modelBadge, { cells: 76, resolution: .041, material: 'stamped-brass' }),
  object('slice-built-sigil', modelVoxels, { cells: 76, resolution: .038, material: 'carved-jade' }),
  object('foundation', platform, { cells: 42 }), object('trim', baseTrim, { cells: 38, resolution: .086 }),
  object('brass-mount', benchLeft), object('jade-mount', benchRight), glowing
]);
const world = op('world', 'scene.world', { objects, options: record('worldOptions', { background: '#222b3e',
  surfaces: plateArt, look: { splatCoverage: 'continuous' }, style: { ambient: .42, sky: .21, sunStrength: .69 } }) });
outputs.nativeWorld = world;
const view = op('heroCamera', 'scene.camera', { options: record('animatedCamera', {
  target: [0, .99, 0], dist: 7.5, focalLength: 40, pitch: .2,
  yaw: { keys: [[0, -.28], [1.2, .43], [2.4, -.28]].map(([time, value]) => ({ time, value })) }
}) });
const hero = op('hero', 'scene.render', { source: world, camera: view, lights, channels: ['depth', 'normal', 'objectId', 'emission'],
  options: { width: 426, height: 168 } });
show('foundry-beauty', hero);
show('foundry-depth', pass('depth', hero, 'depth'));
show('foundry-normal', pass('normal', hero, 'normal'));
show('foundry-ids', pass('identity', hero, 'objectId'));
show('foundry-emission', pass('emission', hero, 'emission'));
show('camera-sample', n('hero', 'report'), 'json');
show('slice-layout', n('sigilSlices', 'layout'), 'json');

const SW = 128, SH = 88;
const sprite = raster('kite', SW, SH, [
  poly([[63, 8], [73, 15], [79, 28], [96, 31], [114, 43], [123, 59], [112, 57], [100, 55], [84, 50], [74, 51],
    [72, 62], [68, 70], [68, 78], [65, 85], [59, 83], [58, 75], [54, 69], [54, 61], [50, 51],
    [39, 51], [24, 56], [5, 60], [12, 44], [31, 32], [49, 28], [54, 16]], '#152743'),
  poly([[53, 30], [42, 33], [26, 37], [13, 47], [8, 56], [23, 52], [39, 46], [55, 45]], '#417278'),
  poly([[74, 29], [88, 33], [104, 38], [115, 47], [119, 56], [102, 51], [87, 47], [73, 46]], '#397277'),
  poly([[51, 32], [38, 35], [25, 41], [17, 49], [39, 41], [52, 41]], '#7ac0ae'),
  poly([[75, 32], [88, 35], [105, 42], [114, 49], [87, 41], [75, 41]], '#66aa9f'),
  line([[16, 51], [35, 45], [47, 44]], '#da9f72'), line([[113, 51], [94, 45], [81, 44]], '#da9f72'),
  poly([[58, 58], [70, 59], [66, 72], [67, 78], [64, 83], [61, 80], [61, 72], [57, 66]], '#547883'),
  poly([[60, 66], [65, 66], [65, 75], [66, 79], [64, 82], [62, 78]], '#92b8ac'),
  poly([[63, 11], [70, 16], [76, 30], [75, 47], [69, 60], [59, 60], [53, 50], [51, 33], [54, 20]], '#246472'),
  poly([[62, 13], [67, 15], [71, 27], [71, 40], [65, 51], [60, 50], [56, 39], [56, 24]], '#6ea5a0'),
  poly([[62, 20], [66, 20], [69, 29], [66, 40], [60, 40], [58, 29]], '#a5d1b6'),
  ellipse(54, 31, 20, 10, '#1b3d58'), ellipse(58, 34, 12, 4, '#ffb575'),
  rect(63, 34, 3, 3, '#ffffb5'), rect(61, 48, 5, 6, '#efb483'), rect(62, 55, 3, 4, '#d48c71'),
  rect(18, 49, 3, 2, '#f9c68e'), rect(108, 49, 3, 2, '#f9c68e')
]);
const bones = [{ id: 'hull', pivot: [64, 36], tip: [64, 55] }, { id: 'port', parent: 'hull', pivot: [53, 36], tip: [11, 53] },
  { id: 'starboard', parent: 'hull', pivot: [75, 36], tip: [117, 53] }, { id: 'tail', parent: 'hull', pivot: [64, 55], tip: [64, 73] },
  { id: 'tailTip', parent: 'tail', pivot: [64, 73], tip: [64, 84] }];
const unit = n => Math.max(0, Math.min(1, n));
const segments = [24, 18], weights = [];
for (let y = 0; y <= segments[1]; y++) for (let x = 0; x <= segments[0]; x++) {
  const u = x / segments[0] * SW, v = y / segments[1] * SH;
  const port = unit((51 - u) / 10), starboard = unit((u - 77) / 10);
  const tail = unit((v - 54) / 11) * (1 - port - starboard);
  const tip = unit((v - 69) / 10);
  weights.push({ hull: 1 - port - starboard - tail, port, starboard, tail: tail * (1 - tip), tailTip: tail * tip });
}
const bind = op('kiteBind', 'rig.bindSprite', { source: sprite, bones, options: { segments, weights } });
const wave = (values, field = 'angle') => values.map((value, i) => ({ time: i * .6, [field]: value }));
const pose = op('kitePose', 'rig.pose', { tracks: {
  hull: wave([[0, 2], [0, -1], [0, 1], [0, -1], [0, 2]], 'translate'),
  port: wave([-.24, .25, .16, -.29, -.24]), starboard: wave([.24, -.26, -.12, .28, .24]),
  tail: wave([-.19, .12, .3, -.05, -.19]), tailTip: wave([-.13, .26, .13, -.28, -.13])
} });
const skin = op('skinnedKite', 'rig.skinSprite', { source: sprite, bind, pose });
show('sprite-rest', sprite);
show('sprite-posed', skin);
show('sprite-bind', bind, 'json');
show('sprite-joints', n('skinnedKite', 'joints'), 'json');
outputs.sdfReport = n('direct', 'report');

const project = { format: 'ink-studio/graph-project', version: 1, seed: 385, time: 1.13,
  nodes, outputs, exports: exportsSpec, assertions: [
    { id: 'cameraCrop', output: 'foundry-beauty', path: ['width'], op: 'eq', value: 426 },
    { id: 'nativeSdfHits', output: 'sdfReport', path: ['hits'], op: 'min', value: 800 },
    { id: 'rigWidth', output: 'sprite-posed', path: ['width'], op: 'eq', value: SW }
  ] };
const file = path.join(dir, 'relay-foundry.json');
fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
const run = spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'graph', 'run', file, '--out', path.join(dir, 'graph')],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || run.stdout);

const session = ink.readGraphProject(file);
const art = session.run().outputs, BW = 456, BH = 534;
const gold = '#ffd9a0', muted = '#aac3c3', aqua = '#85c6b6';
const backdrop = [
  rect(0, 0, BW, BH, '#161e2d'), rect(15, 12, 13, 2, '#d29469'), text('INK STUDIO / 3D GRAPH', 34, 8, aqua),
  text('RELAY FOUNDRY', 15, 24, gold, 3), text('EXTRUDED SPRITE + SDF SLICE STACK IN ONE LIT SCENE', 15, 54, muted),
  rect(14, 67, 428, 170, '#506273'), rect(15, 245, 426, 1, '#506273'),
  text('COLOR SOURCE', 15, 254, aqua), text('DIRECT SDF RENDER', 155, 254, aqua), text('NATIVE RENDER PASSES', 310, 254, aqua),
  text('Alpha mask to solid', 15, 357, muted), text('Carved signed field', 155, 357, muted),
  text('Depth / normals / IDs', 310, 357, muted), rect(15, 376, 426, 1, '#506273'),
  text('SPRITE SKINNING', 15, 386, gold, 2), text('Rest mesh', 40, 507, muted), text('Animated pose', 183, 507, muted),
  text('Bone transforms', 328, 507, muted)
];
const contained = (source, x, y, width, height) => ({ source: R.resize(source, { width, height }), x, y });
const cut = image => R.crop(image, { x: 240, y: 33, width: 74, height: 135 });
const overlay = art['sprite-joints'], joints = Object.values(overlay);
const jointArt = draw(SW, SH, [
  rect(0, 0, SW, SH, '#24344a'),
  ...joints.map(({ pivot, tip }) => line([pivot, tip], '#85b5a2', 2)),
  ...joints.flatMap(({ pivot, tip }) => [pivot, tip].map(([x, y]) => ellipse(x - 2, y - 2, 4, 4, '#f0b677')))
]);
const badgeBack = draw(112, 84, [rect(0, 0, 112, 84, '#263148')]);
const rigBack = draw(SW, SH, [rect(0, 0, SW, SH, '#24344a')]);
const stack = (width, height, layers) => R.stack({ width, height, layers }).value;
const board = stack(BW, BH, [{ source: draw(BW, BH, backdrop) },
  { source: art['foundry-beauty'], x: 15, y: 68 }, { source: badgeBack, x: 15, y: 268 },
  { source: badge, x: 43, y: 282 }, contained(art['direct-sdf'], 155, 268, 132, 84),
  ...['depth', 'normal', 'ids'].map((name, i) => contained(cut(art['foundry-' + name]), 310 + i * 44, 268, 43, 84)),
  ...[15, 164, 313].map(x => ({ source: rigBack, x, y: 411 })),
  { source: art['sprite-rest'], x: 15, y: 411 },
  { source: art['sprite-posed'], x: 164, y: 411 },
  { source: jointArt, x: 313, y: 411 }
]);
write('relay-foundry-review', R.resize(board, { width: BW * 2, height: BH * 2 }));

const MW = 576, MH = 204;
const motionBack = draw(MW, MH, [
  rect(0, 0, MW, MH, '#151f2e'), text('RELAY FOUNDRY / NATIVE 3D ORBIT', 8, 8, aqua),
  text('RIGGED SPRITE', 446, 8, aqua), rect(7, 25, 428, 170, '#506273'),
  rect(447, 25, 121, 170, '#223348'), rect(447, 175, 121, 1, '#455972')
]);
// Evaluate the animated subgraph against one baked world.
const motionNodes = Object.fromEntries([
  'animatedCamera', 'heroCamera', 'sun', 'copperLamp', 'tealLamp', 'lightsEntries', 'lights',
  'kite', 'kiteBind', 'kitePose', 'skinnedKite'
].map(id => [id, nodes[id]]));
motionNodes.hero = { ...nodes.hero, inputs: { ...nodes.hero.inputs, source: { input: 'world' }, channels: [] } };
const motion = KIT.procedural.graph.create({ inputs: { world: 'world' }, nodes: motionNodes, outputs: {
  hero: n('hero'), sprite: n('skinnedKite')
} }, { operations: ink.graph3DOperations() });
const fps = 12;
const frames = Array.from({ length: 29 }, (_, i) => {
  const time = i * 2.4 / 29;
  const { outputs: frame } = motion.evaluate({ world: art.nativeWorld }, { time, seed: project.seed });
  const value = stack(MW, MH, [{ source: motionBack }, { source: frame.hero, x: 8, y: 26 },
    { source: frame.sprite, x: 444, y: 57 }]);
  const rgb = new Uint8Array(MW * MH * 3);
  for (let p = 0; p < MW * MH; p++) rgb.set(value.data.subarray(p * 4, p * 4 + 3), p * 3);
  return { w: MW, h: MH, rgb };
});
PNG.animate(path.join(dir, 'relay-foundry-motion.png'), frames, fps);
process.stdout.write(dir + '\n');
