// Render the Storm Relay graph and a sheet of its source generators.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const { KIT, makeBuilder, makeSculpt } = ink.load();
const { generator: G, raster: R, drawing2d: D } = KIT.procedural;
const PNG = require('../cli/png.js');

const dir = path.resolve(process.argv[2] || 'procedural-review');
fs.mkdirSync(dir, { recursive: true });
const W = 436, H = 168, PW = 140, PH = 66;
const nodes = {}, outputs = {}, exportsSpec = {};
const link = (node, port) => ({ node, ...(port && { port }) });
const op = (id, type, inputs) => {
  nodes[id] = { op: type, inputs };
  return link(id);
};
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const render = (width, height, commands) => D.render({ width, height, edges: 'hard', commands });
const draw = (id, width, height, commands) => op(id, 'draw.render', { width, height, edges: 'hard', commands });
const image = (id, commands) => draw(id, W, H, commands);
const record = (id, inputs) => op(id, 'data.record', inputs);
function array(id, values) {
  const entries = Object.fromEntries(values.map((source, i) => ['item' + i, source]));
  return op(id, 'data.collect', { source: record(id + 'Entries', entries), keys: Object.keys(entries) });
}
function combine(id, sources) {
  const layers = sources.map((source, i) => record(id + 'Layer' + i, { source }));
  return op(id, 'raster.stack', { width: W, height: H, layers: array(id + 'Layers', layers) });
}
function expose(id, source, format = 'png') {
  outputs[id] = source;
  exportsSpec[id] = { output: id, format };
}
function grade(id, source, stops, range, interpolation = 'linear') {
  return op(id, 'color.gradient', { source, ramp: { stops, interpolation }, options: { channel: 0, range } });
}
const paint = (id, source, options) => op(id, 'proc.sample', { source, options });
const seed = 508;

const sky = image('sky', [
  ...['#141829', '#1a2035', '#24283e', '#342f49', '#473b53', '#5d4b5d', '#796064', '#a17e73'].map((fill, i) =>
    rect(0, i * 13, W, i === 7 ? H : 13, fill)),
  ellipse(83, 24, 72, 72, '#654d60'), ellipse(91, 27, 58, 58, '#b18a83'),
  ellipse(98, 31, 48, 48, '#f5c79c'), ellipse(104, 36, 33, 33, '#ffdab0'),
  rect(93, 67, 58, 2, '#b98d84'), rect(104, 72, 50, 2, '#8c6874'),
  ...[[15, 17], [34, 27], [56, 12], [73, 23], [157, 23], [188, 34], [206, 11], [254, 26], [285, 15],
    [319, 13], [345, 25], [376, 18], [409, 34], [426, 10]].map(([x, y], i) => rect(x, y, i % 4 ? 1 : 2, 1, '#aa8892'))
]);

const ridge = G.noise({ type: 'periodic', axes: ['x', 'y'], period: [W, null, null], scale: 42 }, { seed });
function contour(at, h, offset) {
  return Array.from({ length: W + 1 }, (_, x) => [x, Math.round(at + h * ridge(x, offset, 0) +
    5 * Math.cos(2 * Math.PI * x / W * 3 + offset))]);
}
function mass(points, fill) {
  return poly([...points, [W, H], [0, H]], fill);
}
const farLine = contour(92, 23, 31), nearLine = contour(116, 21, 4);
const far = image('distantRidge', [
  mass(farLine, '#535469'), mass(farLine.map(([x, y]) => [x, y + 4]), '#41475c'),
  mass(farLine.map(([x, y]) => [x, Math.max(y + 7, 104)]), '#3d485a'),
  rect(0, 102, W, 2, '#93768255'), rect(0, 109, W, 1, '#c3988744')
]);
const near = image('nearRidge', [
  mass(nearLine, '#304753'), mass(nearLine.map(([x, y]) => [x, y + 4]), '#273d4c'),
  ...Array.from({ length: 55 }, (_, i) => {
    const x = (i * 37 + 7) % W, y = nearLine[x][1], r = 1 + i % 3;
    return poly([[x - r, y + 6], [x, y - r * 2], [x + r, y + 6]], i % 2 ? '#293f4b' : '#324956');
  }),
  rect(0, 138, W, 30, '#273b48'), rect(0, 146, W, 1, '#465865'), rect(0, 163, W, 2, '#465769')
]);

const layered = array('depthLayers', [record('skyLayer', { source: sky, factor: 0 }),
  record('farLayer', { source: far, factor: [.26, 0], repeat: 'x' }),
  record('nearLayer', { source: near, factor: [.71, 0], repeat: 'x' })]);
const camera = { keys: [[0, -10], [1.25, 27], [2.5, -10]].map(([time, x]) => ({ time, value: [x, 0] })), mode: 'vector' };
const background = op('background', 'proc.parallax', {
  layers: layered, options: record('cameraOptions', { width: W, height: H, camera })
});
const horizon = op('horizon', 'proc.horizon', { bands: array('worldBands', [
  record('farBand', { id: 'distant', source: far, radius: 64, height: [-8, 8], repeat: 2 }),
  record('nearBand', { id: 'near', source: near, radius: 34, height: [-4, 4], repeat: 2 })
]) });

const cable = (id, start, end, sag, stroke) => op(id, 'proc.cable', {
  start: [start[0], -start[1], 0], end: [end[0], -end[1], 0],
  options: { width: W, height: H, origin: [0, 0], pixelsPerUnit: 1, sag, stroke }
});
const wireA = cable('westWire', [51, 54], [243, 76], 19, '#24253b');
const wireB = cable('eastWire', [315, 66], [406, 48], 22, '#24253b');
const wireC = cable('spareWire', [51, 61], [243, 84], 26, '#343449');

const grove = [11, 29, 75, 104, 368, 422].map((x, i) =>
  op('tree' + i, 'proc.tree', { options: { width: W, height: H, origin: [x, 140 + i % 3 * 3],
    trunk: .8 + .21 * (i % 3), pixelsPerUnit: 21 + (i % 4) * 3, levels: 4, species: i === 1 ? 'bare' : 'pine',
    foliage: i === 4 ? '#325252' : '#27474a', bark: '#273643' } }));
const plume = op('smoke', 'proc.plume', { options: { width: W, height: H, origin: [292, 48], pixelsPerUnit: 21,
  socket: { p: [0, 0, 0], dir: [.78, .55, 0] }, life: { start: -2.7, rate: 13 },
  motion: { speed: 1.6, spread: .23 }, style: { color: '#b09caa', density: 2.1, size: .3 } } });

function mast(x, y, h) {
  return [rect(x - 2, y, 4, h, '#1b2432'), rect(x - 1, y + 4, 1, h - 6, '#5c5968'),
    rect(x - 10, y + 2, 21, 3, '#232b39'), rect(x - 8, y - 1, 3, 3, '#c3a89c'), rect(x + 6, y - 1, 3, 3, '#a18d86'),
    rect(x - 5, y + h - 5, 10, 5, '#313244')];
}
const cabin = image('cabin', [
  poly([[0, 144], [67, 142], [135, 148], [185, 142], [224, 143], [249, 137], [333, 136],
    [359, 145], [419, 140], [436, 146], [436, 168], [0, 168]], '#182b35'),
  ...mast(51, 51, 91), ...mast(405, 44, 96),
  poly([[12, 160], [84, 153], [172, 155], [239, 144], [341, 142], [430, 150], [436, 168], [0, 168]], '#222e3b'),
  poly([[125, 168], [239, 143], [342, 142], [390, 149], [324, 153], [253, 168]], '#504557'),
  line([[125, 168], [239, 143], [342, 142], [390, 149]], '#826472'),
  rect(231, 134, 105, 8, '#22273b'), rect(224, 141, 118, 3, '#766272'),
  rect(242, 79, 80, 55, '#39334a'), rect(247, 78, 40, 56, '#675056'), rect(289, 80, 33, 54, '#564354'),
  ...Array.from({ length: 14 }, (_, i) => rect(247 + i * 5, 81, 1, 52, '#242a41')),
  rect(245, 124, 74, 3, '#aa7565'), rect(244, 131, 83, 3, '#92646a'),
  poly([[230, 81], [249, 56], [304, 55], [332, 81]], '#21263b'),
  poly([[231, 77], [250, 58], [301, 57], [322, 77]], '#65566b'),
  poly([[251, 59], [300, 58], [312, 70], [239, 72]], '#756372'),
  line([[231, 77], [322, 77], [332, 81]], '#ae8787', 1), rect(232, 81, 96, 3, '#2b2a40'),
  rect(288, 44, 9, 18, '#362e49'), rect(290, 46, 3, 14, '#98695f'), rect(285, 43, 14, 3, '#a68a89'),
  rect(251, 88, 27, 26, '#262a42'), rect(254, 90, 21, 21, '#c7735c'), rect(256, 92, 17, 18, '#ffbb76'),
  rect(258, 93, 13, 12, '#ffde9e'), rect(264, 90, 2, 22, '#80566a'), rect(254, 102, 21, 2, '#80566a'),
  rect(249, 113, 31, 2, '#bf8b78'), rect(294, 91, 17, 33, '#292b40'), rect(298, 94, 10, 14, '#b76d62'),
  rect(300, 95, 6, 12, '#f8be82'), rect(297, 109, 11, 13, '#655064'), rect(306, 114, 2, 2, '#db9b75'),
  rect(276, 121, 5, 5, '#eeb476'), rect(273, 123, 11, 2, '#e6a872'), rect(272, 126, 13, 3, '#705b62'),
  ...Array.from({ length: 22 }, (_, i) => {
    const x = (i * 53 + 5) % W, y = 154 + (i * 17) % 14;
    return rect(x, y, 2 + i % 9, 1, i % 5 ? '#495567' : '#7b6572');
  })
]);
const shelter = image('rainMask', [rect(0, 0, W, H, '#ffffff'),
  poly([[231, 81], [250, 57], [302, 57], [329, 82], [325, 142], [235, 142]], '#000000')]);
const drizzle = op('rain', 'proc.rain', { options: record('rainOptions', { width: W, height: H, count: 428, speed: 156,
  wind: -47, length: 5.1, fill: '#b6cad8', opacity: .42, mask: shelter }) });
const fire = op('sparks', 'proc.sparks', { options: { width: W, height: H, origin: [279, 124], start: -1,
  rate: 35, angle: -1.38, spread: 1.12, speed: [21, 47], gravity: 19, size: .9 } });
const scene = combine('scene', [background, wireA, wireB, wireC, ...grove, plume, cabin, drizzle, fire]);
expose('scene', scene);
expose('smokeEmitter', link('smoke', 'recipe'), 'json');
expose('worldHorizon', horizon, 'json');
expose('westSpan', link('westWire', 'path'), 'json');
expose('treeBranches', link('tree0', 'branches'), 'json');
expose('treeLeaves', link('tree0', 'leaves'), 'json');

const worldKnot = op('terrainNoise', 'proc.noise', { definition: { type: 'fbm', octaves: 4, gain: .53,
  source: { type: 'periodic', axes: ['x', 'y'], period: [PW, PH, null], scale: 31 } } });
const noise = grade('contouredNoise', paint('noisePlane', worldKnot, { width: PW, height: PH, u: [PW, 0, 0], v: [0, PH, 0] }),
  [[0, '#231e39'], [.25, '#303955'], [.38, '#43687a'], [.48, '#658e89'], [.53, '#8cb09c'],
    [.59, '#c4c393'], [.65, '#f4d39b'], [.84, '#ffe2b1'], [1, '#fff1c4']], [-.48, .48], 'step');
expose('noise', noise);
const satin = op('weft', 'proc.pattern', { options: { kind: 'chevrons', size: [15, 9], fill: .28, angle: .14 } });
const pattern = grade('dyedWeft', paint('weftPlane', satin, { width: PW, height: PH, u: [PW, 0, 0], v: [0, PH, 0] }),
  [[0, '#42506d'], [1, '#ea9e85']], [0, 1]);
expose('pattern', pattern);

const edgeNames = ['north', 'east', 'south', 'west'], defs = [], tileArt = {};
const endpoints = [[6, 0], [12, 6], [6, 12], [0, 6]];
for (let i = 0; i < 16; i++) {
  const id = 't' + i, sockets = Object.fromEntries(edgeNames.map((side, bit) => [side, i >> bit & 1]));
  defs.push({ id, sockets });
  const commands = [rect(0, 0, 12, 12, '#25464d'), rect(1, 1, 10, 10, i % 2 ? '#31535a' : '#2e4c54')];
  for (const [bit, endpoint] of endpoints.entries()) {
    if (i >> bit & 1) {
      commands.push(line([[6, 6], endpoint], '#648478', 3));
      commands.push(line([[6, 6], endpoint], '#9caa83', 1));
    }
  }
  commands.push(ellipse(4, 4, 4, 4, i ? '#f4bd84' : '#588075'), rect(5, 5, 1, 1, '#ffdcb0'));
  tileArt[id] = draw(id, 12, 12, commands);
}
const tiles = op('tileLayout', 'proc.tiles', { definitions: defs, options: { width: 12, height: 6, mode: 'wang', labels: [0, 1] } });
const tileImage = op('tiles', 'proc.tileImage', { layout: tiles, images: record('tileArt', tileArt) });
expose('tiles', op('tileCrop', 'raster.crop', { source: tileImage, options: { x: 1, y: 3, width: PW, height: PH } }));
expose('tileLayout', tiles, 'json');

const RW = 70, RH = 33;
const patches = [[13, 12], [32, 20], [58, 14]], spots = [];
for (const [x, y] of patches) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
  if (Math.hypot(dx, dy) <= 3) spots.push((y + dy) * RW + x + dx);
const morph = op('morphogenesis', 'proc.reaction', {
  steps: 1100, options: { width: RW, height: RH, spots, wrap: true, feed: .036, kill: .060 }
});
const reagent = grade('reagent', morph, [[0, '#242841'], [.13, '#403858'], [.31, '#775370'], [.49, '#bd744e'],
  [.66, '#dda26f'], [.8, '#f8cb8c'], [1, '#ffe4b2']], [0, .39], 'step');
expose('reaction', op('reactionScale', 'raster.resize', { source: reagent, options: { width: PW, height: PH } }));

const scatter = op('blueNoise', 'proc.scatter', { options: { bounds: { min: [4, 4], max: [PW - 4, PH - 4] }, radius: 6.7 } });
expose('scatterPoints', scatter, 'json');
const survey = op('isoline', 'proc.path', { points: [[-12, 16], [21, 22], [48, 55], [80, 18], [105, 16], [148, 47]],
  options: { steps: 16, samples: 44 } });
expose('surveyPath', survey, 'json');

const project = { format: 'ink-studio/graph-project', version: 1, seed, time: 1.22, nodes, outputs, exports: exportsSpec,
  assertions: [
    { id: 'artWidth', output: 'scene', path: ['width'], op: 'eq', value: W },
    { id: 'completeTiles', output: 'tileLayout', path: ['status'], op: 'eq', value: 'ok' },
    { id: 'spanStart', output: 'westSpan', path: [0, 0], op: 'eq', value: 51 }
  ] };
const file = path.join(dir, 'storm-relay.json');
fs.writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
const run = spawnSync(process.execPath, [path.join(__dirname, '../cli/ink-studio.js'), 'graph', 'run', file, '--out', path.join(dir, 'graph')],
  { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || run.stdout);

const session = ink.readGraphProject(file);
const art = session.run().outputs;
const scatterImage = render(PW, PH, [rect(0, 0, PW, PH, '#28334b'),
  ...art.scatterPoints.map(([x, y], i) => ellipse(x - 1.5, y - 1.5, 3, 3, i % 7 ? '#7ca39b' : '#ffd69e'))]);
const pathImage = render(PW, PH, [rect(0, 0, PW, PH, '#302d46'), line(art.surveyPath.points, '#c48171', 3),
  ...art.surveyPath.points.map(([x, y], i) => ellipse(x - 1.3, y - 1.3, 2.6, 2.6, i % 4 ? '#eab489' : '#ffe6b9'))]);

function write(name, { width, height, data }) {
  fs.writeFileSync(path.join(dir, name + '.png'), PNG.encode(width, height, data, 4));
}
const BW = 464, BH = 447;
const title = '#f9d9aa', muted = '#adc2c0';
const captions = [
  ['PERIODIC NOISE', 'Seamless fBm contours', art.noise],
  ['SOCKET TILES', 'World-stable Wang tiles', art.tiles],
  ['PATTERN FIELD', 'Angled chevron weave', art.pattern],
  ['REACTION-DIFFUSION', 'Gray-Scott growth', art.reaction],
  ['SCATTER', 'Seeded Poisson spacing', scatterImage],
  ['CURVE SAMPLING', 'Equal-distance marks', pathImage]
];
const boardCommands = [
  rect(0, 0, BW, BH, '#141d2a'), rect(14, 12, 14, 2, '#d9a579'),
  label('INK STUDIO / PROCEDURAL GRAPH', 34, 8, '#87bdb1'),
  label('STORM RELAY', 14, 23, title, 3),
  label('Layered ridges, rain, smoke, sparks, trees and sagging cables', 15, 50, muted),
  rect(13, 64, W + 2, H + 2, '#526173'), rect(14, 243, W, 1, '#526173'),
  label('GENERATOR OUTPUTS', 14, 249, '#87bdb1'), label('NATIVE PIXELS', 371, 249, '#87bdb1')
];
const artLayers = [{ source: art.scene, x: 14, y: 65 }];
for (const [i, [name, note, source]] of captions.entries()) {
  const x = 14 + i % 3 * 148, y = 264 + Math.floor(i / 3) * 88;
  boardCommands.push(label(name, x, y, title), label(note, x, y + 77, muted));
  artLayers.push({ source, x, y: y + 9 });
}
const board = R.stack({ width: BW, height: BH, layers: [{ source: render(BW, BH, boardCommands) }, ...artLayers] }).value;
write('procedural-generation', R.resize(board, { width: BW * 2, height: BH * 2 }));
write('storm-relay', art.scene);

function render3d() {
  const B = makeBuilder(seed, [
    0x1b2433, 0x293544, 0x495365, 0x736170, 0x8e777f, 0xa68c8a, 0x60495a, 0x9d6e6f, 0xbd8b77,
    0x2c4a49, 0x497267, 0x78a08c, 0xc28565, 0xffb671, 0xffe4a2
  ]);
  const S = KIT.sculpt(makeSculpt(B));
  S.sun = KIT.V.norm([-.55, .81, .32]);
  S.amb = .39; S.sky = .2; S.sunK = .62;
  S.pixel = true; S.pixelSize(72);
  const rock = { r: [0, 1, 2, 3] }, roof = { r: [0, 2, 3, 4, 5] }, wall = { r: [0, 6, 7, 8] },
    foliage = { r: [1, 9, 10, 11] }, lamp = { r: [12, 13, 14], em: true };
  S.rock([-.35, -.64, .02], [6.2, .94, 2.3], rock, { res: .14 });
  S.box([.46, .25, 0], [1.46, .21, .94], rock, { res: .079, rd: .10 });
  S.box([.46, 1.13, 0], [1.26, .78, .81], wall, { res: .075, rd: .075 });
  for (let i = 0; i < 13; i++) S.box([-.71 + .195 * i, 1.10, .82], [.018, .71, .02], rock, { res: .06, rd: .012 });
  for (const side of [-1, 1]) S.box([.46 + side * .66, 2.13, 0], [.82, .095, .99], roof,
    { res: .079, rd: .06, ax: B.frame(0, 0, side * -.31) });
  S.box([.83, 2.38, -.32], [.13, .34, .13], wall, { res: .057, rd: .038 });
  S.box([.83, 2.73, -.32], [.18, .045, .17], roof, { res: .057, rd: .023 });
  for (const x of [-.35, .26, 1.16]) {
    S.box([x, 1.26, .854], [.218, .26, .039], rock, { res: .06, rd: .025 });
    S.box([x, 1.26, .904], [.153, .199, .025], lamp, { res: .05, rd: .03 });
    S.box([x, 1.26, .938], [.018, .205, .014], wall, { res: .056, rd: .012 });
  }
  const wire = art.westSpan.map(([x, y, z]) => [(x - 260) * .026, (152 + y) * .026, .35 + z]);
  const [poleX, poleY, poleZ] = wire[0];
  S.tube([[poleX, .22, poleZ], [poleX, poleY + .12, poleZ]], .085, .055, rock, { res: .071 });
  S.box([poleX, poleY + .045, poleZ], [.26, .055, .065], roof, { res: .065, rd: .02 });
  S.tube(wire, .023, .023, rock, { res: .048 });
  for (const [dx, dz, gain] of [[-3.7, -.64, .86], [2.86, -.8, .9], [3.92, -.57, .76]]) {
    for (const { pts, r0, r1 } of art.treeBranches) {
      const branch = pts.map(([x, y, z]) => [dx + x * gain, .29 + y * gain, dz + z * gain]);
      S.tube(branch, r0 * gain, r1 * gain, rock, { res: .064 });
    }
    for (const [x, y, z] of art.treeLeaves) S.ball([dx + x * gain, .29 + y * gain, dz + z * gain],
      [.19, .12, .16], foliage, { res: .082 });
  }
  S.bake();
  const atmosphereEmitters = { ...art.smokeEmitter, sockets: { source: { ...art.smokeEmitter.sockets.source, p: [.83, 2.78, -.32] } } };
  const world = B.finish({ radius: 64, dither: 0, cam: { target: [0, 1.54, 0], dist: 9.8, yaw: .27, pitch: .12 },
    skyEnvironment: { defaults: { zenith: '#253149', horizon: '#b68383', ground: '#31394a', sunStrength: 0 } },
    atmosphereEmitters, look: { horizonBands: art.worldHorizon } });
  const frame = ink.render(world, { w: 468, h: 228, px: 1, t: 1.22, raw: true, transparent: false });
  const data = new Uint8Array(frame.w * frame.h * 4);
  for (let i = 0; i < frame.w * frame.h; i++) data.set([
    frame.rgb[i * 3], frame.rgb[i * 3 + 1], frame.rgb[i * 3 + 2], 255
  ], i * 4);
  return { width: frame.w, height: frame.h, data };
}
write('storm-relay-3d', render3d());

const fps = 12;
const frames = Array.from({ length: 30 }, (_, i) => {
  const { value } = session.inspect({ output: 'scene' }, { time: i / fps });
  const rgb = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) rgb.set(value.data.subarray(p * 4, p * 4 + 3), p * 3);
  return { w: W, h: H, rgb };
});
PNG.animate(path.join(dir, 'storm-relay-motion.png'), frames, fps);
process.stdout.write(dir + '\n');
