// Build the Tideworks graph and verify a replay in a separate CLI process.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const { raster: R } = ink.load().KIT.procedural;
const dir = path.resolve(process.argv[2] || 'tideworks-review');
fs.mkdirSync(dir, { recursive: true });
const W = 128, H = 82, BW = 554, BH = 292, time = 1.48;
const nodes = {}, outputs = {}, exportsSpec = {};
const link = (node, port) => ({ node, ...(port && { port }) });
const add = (id, op, inputs) => {
  nodes[id] = { op, inputs };
  return link(id);
};
const record = (id, inputs) => add(id, 'data.record', inputs);
const art = (id, width, height, commands) => add(id, 'draw.render', { width, height, edges: 'hard', commands });
function array(id, rows) {
  const entries = Object.fromEntries(rows.map((source, i) => ['item' + i, source]));
  return add(id, 'data.collect', { source: record(id + 'Entries', entries), keys: Object.keys(entries) });
}
function visible(id, output, format = 'png') {
  outputs[id] = output;
  exportsSpec[id] = { output: id, format };
}
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const label = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const dim = { width: W, height: H };
const clock = { dt: 1 / 36, maxTicks: 384 };
const sand = '#e0ae76', pearl = '#eed8a3', slate = '#394758', muted = '#a1b4ba', aqua = '#85c8b4', copper = '#996459';
const horizon = (floor, fill = '#2e3c4d') => [
  rect(0, floor, W, H - floor, fill), rect(0, floor, W, 1, '#667282'),
  ...Array.from({ length: 11 }, (_, i) => rect((23 * i + 5) % W, floor + 3 + i % 3, 4 + i % 5, 1, '#465363'))
];
function chambers(id, base, extra = []) {
  return art(id, W, H, [
    rect(0, 0, W, H, base),
    { type: 'grid', origin: [.5, .5], step: [12, 12], counts: [11, 7], width: 1, color: '#45506639' },
    ...extra
  ]);
}
function solver(id, kind, settings, override = {}) {
  const recipe = add(id + 'Recipe', 'sim.define', {
    kind, settings, clock: { ...clock, ...override }
  });
  return add(id, 'sim.run', { recipe, options: { every: 10, cache: 6 } });
}

const particleWalls = [[0, 73, W, 9], [56, 43, 19, 2], [109, 56, 19, 3]];
const sparks = {
  ...dim, walls: particleWalls, gravity: [0, 72], bounce: .51, drag: .15,
  emitters: [{ at: [38, 62], radius: 4, rate: 68, velocity: [35, -87], spread: 35,
    life: [.48, 1.13], size: .85, trail: .049, colors: ['#f4a36e', '#f0c580', '#fee5a1', '#da735b'] },
  { at: [43, 64], radius: 3, rate: 19, velocity: [-10, -61], spread: 31,
    life: [.58, .94], size: .75, trail: .033, colors: ['#d97a60', '#ffc283'] }]
};
nodes.spark = { op: 'anim.retime', group: 'forge', inputs: { timing: { range: [0, 3.3], delay: .18 } } };
const spark = link('spark');
const sparkBack = chambers('sparkBack', '#262939', [
  ellipse(8, 50, 60, 30, '#4e3342'), ellipse(19, 57, 40, 19, '#66424b'),
  ...particleWalls.map(wall => rect(...wall, '#584951')),
  rect(56, 42, 19, 1, '#977969'), rect(109, 55, 19, 1, '#977969'),
  rect(26, 63, 27, 3, '#e28a62'), rect(28, 61, 24, 2, '#e3a274'), rect(25, 66, 30, 5, '#453842'),
  rect(29, 71, 23, 3, '#72525a'), rect(30, 64, 17, 1, '#ffd488'),
  ...Array.from({ length: 8 }, (_, i) => rect(8 + 13 * i, 77, 5 + i % 2, 1, '#8b615c'))
]);

const clothBack = chambers('clothBack', '#253c49', [
  ellipse(82, 9, 24, 24, '#384e59'), ellipse(89, 12, 16, 16, '#455967'),
  poly([[0, 64], [23, 58], [54, 69], [80, 57], [128, 62], [128, 82], [0, 82]], '#2f4c52'),
  ...horizon(74, '#283e4a'), rect(10, 13, 4, 64, '#657280'), rect(11, 14, 1, 60, '#b19380'),
  rect(8, 12, 9, 2, '#b69676'), rect(7, 76, 12, 3, '#576675'),
  rect(14, 15, 79, 2, '#725e61'), rect(14, 15, 79, 1, '#b29480')
]);
const cloth = solver('cloth', 'cloth', { ...dim, columns: 15, rows: 11, at: [16, 17, 0], u: [73, 0, 1],
  v: [0, 45, -.4], pin: 'top', stripeEvery: 4, air: .005, wind: [30, -6, 24], gust: 20, gravity: [0, 69, 0],
  projection: [.58, -.21], palette: ['#31536b', '#3d7180', '#51a092', '#80ba9a', '#b8c995', '#e5cc95'] });

const strandBack = chambers('strandBack', '#202f47', [
  ellipse(42, 18, 53, 53, '#2b425b'), ellipse(55, 26, 27, 27, '#384f63'),
  rect(6, 9, 42, 4, '#775d66'), rect(7, 10, 40, 1, '#bd9077'),
  rect(5, 4, 4, 16, '#6d6679'), rect(116, 5, 5, 19, '#6d6679'), rect(109, 17, 15, 3, '#b68877'),
  ...[24, 30, 36].map(x => rect(x, 11, 2, 5, '#e2bd80')),
  ...Array.from({ length: 8 }, (_, i) => ellipse(61 + i * 7, 63 + ((i * 13) % 13), 1, 1, '#78979a'))
]);
const strands = [0, 1, 2, 3, 4].map(i => Array.from({ length: 17 }, (_, j) => {
  const u = j / 16;
  return [12 + i * 5 + u * (100 - i * 3), 14 + i * 1.6 + Math.sin(u * Math.PI) * (25 + i * 3), i * 2.3];
}));
const strand = solver('strand', 'strand', { ...dim, strands,
  pins: strands.flatMap((row, i) => {
    const end = row.at(-1);
    return [i * 17, { index: i * 17 + 16, keys: [
      { time: 0, value: end }, { time: .9, value: [end[0] - 5, end[1] + 12, end[2] + 4] },
      { time: 2.2, value: end }
    ] }];
  }),
  wind: [28, -2, 19], gust: 29, fade: 1.34, widthPx: 1.8, gravity: [0, 103, 0], projection: [.36, -.27],
  palette: ['#b28a7c', '#f1c988', '#e3a381', '#77b8a6', '#80aabe'], pinColor: '#f4d08b' });

const smokeWalls = [[10, 29, 47, 4], [78, 29, 50, 4], [47, 65, 36, 17]];
const smokeBack = chambers('smokeBack', '#2e3044', [
  ellipse(16, 15, 96, 52, '#3a3a53'), rect(16, 28, 41, 2, '#93777d'), rect(78, 28, 48, 2, '#93777d'),
  ...smokeWalls.map(wall => rect(...wall, '#634f61')),
  rect(43, 63, 44, 5, '#a16f6c'), rect(50, 63, 29, 2, '#c29376'),
  rect(49, 74, 32, 3, '#956e72'), rect(56, 67, 18, 1, '#eab781')
]);
const smoke = solver('smoke', 'smoke', { ...dim, walls: smokeWalls, buoyancy: 29, wind: [12, 0],
  emitters: [{ at: [63, 60], radius: 8.5, density: 17, velocity: [9, -145] }],
  viscosity: .016, diffusion: .047, dissipation: .30, pressureIterations: 10, alphaScale: 1.1,
  palette: ['#685d77', '#917a87', '#b3898a', '#d4a494', '#ebbb99', '#f7d4a2'] });

const ramps = [
  [[10, 14], [31, 14], [59, 37], [59, 42], [53, 43]],
  [[82, 13], [111, 13], [77, 43], [70, 42], [70, 37]]
];
const mask = art('hopperMask', W, H, [
  ...ramps.map(points => poly(points, '#ffffff')), rect(0, 74, W, 8, '#ffffff'), rect(6, 62, 25, 2, '#ffffff')
]);
const grainBack = chambers('grainBack', '#2d3443', [
  ...horizon(74, '#584451'),
  rect(7, 13, 106, 2, '#b68c72'), rect(11, 14, 4, 21, '#725968'), rect(108, 14, 3, 21, '#725968'),
  ...ramps.map(points => poly(points, '#6b525b')),
  line([[12, 15], [30, 15], [58, 37]], '#bf8d73'), line([[82, 14], [108, 14], [73, 39]], '#bf8d73'),
  rect(6, 62, 25, 2, '#77535c'), rect(6, 61, 25, 1, '#ac7768'),
  rect(55, 3, 15, 4, '#80606a'), rect(57, 5, 11, 1, '#dcaf7f')
]);
const grain = solver('grain', 'grain', record('grainOptions', { ...dim, mask, steps: 2,
  emitters: [{ at: [63, 7], rate: 420, radius: 7.5, start: .1, end: 2.1 }],
  palette: ['#955d4f', '#b77955', '#ce9460', '#e4b16f', '#f6c880', '#f9dc99']
}));

const rigidBack = chambers('rigidBack', '#2a3c4c', [
  ...horizon(73), rect(3, 9, 23, 10, '#4a5662'), label('DROP', 5, 10, '#d3b387'),
  rect(7, 22, 65, 1, '#72778355'), rect(6, 20, 2, 4, copper), rect(71, 20, 2, 4, copper),
  ...Array.from({ length: 6 }, (_, i) => poly([[90 + i * 6, 74], [93 + i * 6, 74], [91 + i * 6, 77], [88 + i * 6, 77]], '#8c7060'))
]);
const rigid = solver('rigid', 'rigid', { ...dim, ground: 73, gravity: 105, contactIterations: 14,
  bodies: [
    { id: 'base', at: [62, 69], size: [36, 8], fixed: true, fill: '#696576', rim: '#a5928c' },
    { id: 'amber', at: [36, 16], size: [19, 13], spin: .65, velocity: [11, 0], fill: '#d19369', rim: '#f4c781' },
    { id: 'cobalt', at: [69, 15], size: [14, 19], spin: -.95, velocity: [4, 4], fill: '#518998', rim: '#87cbb0' },
    { id: 'oxide', at: [91, 14], size: [16, 10], spin: 1.25, velocity: [-8, 0], fill: '#af6868', rim: '#e3a38c' },
    { id: 'slate', at: [93, 33], size: [11, 12], spin: .15, fill: '#788aa7', rim: '#b5bfc1' }
  ], impulses: [{ tick: 42, body: 'amber', linear: [46, -59], spin: .05 }]
});

const waterWalls = [[0, 71, W, 11], [67, 58, 7, 13], [112, 63, 16, 8]];
const waterBack = chambers('waterBack', '#22394d', [
  ellipse(72, 9, 39, 39, '#2f485b'), ellipse(82, 14, 23, 23, '#355468'),
  ...waterWalls.map(wall => rect(...wall, '#435465')),
  rect(0, 71, W, 1, '#82918f'), rect(67, 57, 7, 2, '#b0a18c'), rect(112, 62, 16, 2, '#b0a18c'),
  rect(54, 26, 1, 31, '#45647355'), rect(79, 28, 1, 30, '#45647355'),
  ...[24, 36, 48, 60].map(y => rect(116, y, 7, 1, '#79969a'))
]);
const flip = solver('flip', 'flip', { ...dim, walls: waterWalls,
  fill: [[6, 12, 44, 43]], particlesPerCell: 4, pressureIterations: 20, gravity: [0, 103],
  velocity: [22, -3], flip: .87, surface: .19, palette: ['#184d6e', '#267b90', '#339d9f', '#66beb4', '#aadfce', '#edf3ce']
});

const feedbackBack = chambers('feedbackBack', '#252944', [
  ellipse(28, 8, 73, 65, '#2f3453'), ellipse(37, 12, 59, 56, '#34395a'),
  line([[8, 18], [8, 8], [18, 8]], '#a397a3'), line([[109, 74], [119, 74], [119, 64]], '#a397a3'),
  rect(64, 10, 1, 63, '#a3a4ab55'), rect(16, 41, 96, 1, '#a3a4ab55'),
  ellipse(62, 39, 5, 5, '#b5b5bb')
]);
const trailFrames = Array.from({ length: 24 }, (_, i) => {
  const t = i / 24 * Math.PI * 2;
  const x = 64 + Math.cos(2 * t) * 38, y = 40 + Math.sin(3 * t) * 22, tint = i < 12 ? '#ffb788' : '#94e3ca';
  return art('lightTrace' + i, W, H, [
    ellipse(x - 5, y - 5, 10, 10, tint + '55'), ellipse(x - 3, y - 3, 6, 6, tint + 'bd'),
    poly([[x - 4, y], [x, y - 4], [x + 4, y], [x, y + 4]], tint),
    ellipse(x - 1, y - 1, 2, 2, '#fff0ce')
  ]);
});
const feedback = add('feedback', 'anim.feedback', { frames: array('trail', trailFrames), options: {
  dt: 1 / 48, fps: 12, mode: 'loop', halfLife: .57, warp: { velocity: [8, -5], rotation: .4, zoom: 1.045, wave: [6, 5], rate: .2 },
  filter: 'linear', every: 10, cache: 6
}});

const cards = [
  ['PARTICLES', 'Gravity + bounce', spark, sparkBack],
  ['CLOTH', 'Pinned XPBD sail', cloth, clothBack],
  ['STRANDS', 'Animated anchors', strand, strandBack],
  ['SMOKE', 'Projected grid flow', smoke, smokeBack],
  ['GRAIN', 'Gravity-fed hopper', grain, grainBack],
  ['RIGID BODIES', 'Contacts + impulse', rigid, rigidBack],
  ['PIC / FLIP', 'Free-surface flow', flip, waterBack],
  ['FEEDBACK', 'Warped light trails', feedback, feedbackBack]
];
const boardCommands = [
  rect(0, 0, BW, BH, '#172131'),
  label('INK STUDIO / ANIMATION AND SIMULATION GRAPH', 16, 8, aqua),
  label('TIDEWORKS', 15, 24, pearl, 3),
  label('EIGHT RASTER STUDIES WITH REPLAYABLE CHECKPOINTS', 16, 50, muted),
  rect(16, 65, BW - 32, 1, slate), label('FIXED-TICK PLAYBACK', 422, 47, sand)
];
const layers = [];
for (const [i, [name, note, effect, background]] of cards.entries()) {
  const x = 12 + i % 4 * 134, y = 80 + Math.floor(i / 4) * 110;
  boardCommands.push(rect(x - 1, y - 1, W + 2, H + 2, slate), label(name, x, y - 10, aqua), label(note, x, y + 84, muted));
  layers.push(record('card' + i + 'Back', { source: background, x, y }),
    record('card' + i + 'Effect', { source: effect, x, y }));
}
const paper = art('paper', BW, BH, boardCommands);
const board = add('board', 'raster.stack', { width: BW, height: BH,
  layers: array('boardLayers', [record('paperLayer', { source: paper }), ...layers]) });
visible('board', board);
for (const id of ['cloth', 'flip', 'feedback']) visible(id + '-save', link(id, 'checkpoint'), 'json');
for (const id of ['cloth', 'flip', 'smoke', 'grain', 'rigid', 'feedback']) visible(id, link(id));
visible('water-density', link('flip', 'field'), 'json');
outputs.pressure = link('flip', 'report');
outputs.forgeClock = link('spark', 'report');

const project = { format: 'ink-studio/graph-project', version: 1, time, seed: 386,
  groups: { forge: { nodes: {
    source: { op: 'sim.define', inputs: { kind: 'particles', settings: sparks, clock } },
    sample: { op: 'sim.run', inputs: { recipe: link('source') } }
  }, outputs: { value: link('sample'), report: link('sample', 'report') } } },
  nodes, outputs, exports: exportsSpec, assertions: [
    { id: 'liquidParticles', output: 'pressure', path: ['count'], op: 'eq', value: 7568 },
    { id: 'controlledClock', output: 'forgeClock', path: ['tick'], op: 'eq', value: 46 }
  ]
};
const cli = path.join(__dirname, '../cli/ink-studio.js');
function launch(name, spec, output) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
  const run = spawnSync(process.execPath, [cli, 'graph', 'run', file, '--out', path.join(dir, output)],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw new Error(run.stderr || run.error?.message || run.stdout);
  return file;
}
const file = launch('tideworks.json', project, 'graph');
const { w: width, h: height, data } = PNG.raster(path.join(dir, 'graph/artifacts/board.png'));
const still = R.resize({ width, height, data, channels: 4 }, { width: width * 2, height: height * 2 });
fs.writeFileSync(path.join(dir, 'tideworks-review.png'), PNG.encode(still.width, still.height, still.data, 4));

const fps = 12, session = ink.readGraphProject(file);
const frames = Array.from({ length: 31 }, (_, i) => {
  const { value } = session.inspect({ output: 'board' }, { time: .15 + i / fps });
  const rgb = new Uint8Array(BW * BH * 3);
  for (let p = 0; p < BW * BH; p++) rgb.set(value.data.subarray(p * 4, p * 4 + 3), p * 3);
  return { w: BW, h: BH, rgb };
});
PNG.animate(path.join(dir, 'tideworks-motion.png'), frames, fps);

const at = 2.31, replay = { format: project.format, version: 1, time: at, assets: {}, nodes: {}, outputs: {}, exports: {}, assertions: [] };
for (const id of ['cloth', 'flip', 'feedback']) {
  replay.assets[id] = { format: 'json', file: 'graph/artifacts/' + id + '-save.json' };
  replay.nodes[id + 'Save'] = { op: 'jsonAsset', inputs: { name: id } };
  replay.nodes[id] = { op: 'sim.run', inputs: { checkpoint: link(id + 'Save') } };
  replay.outputs[id] = link(id);
  replay.outputs[id + 'Report'] = link(id, 'report');
  replay.exports[id] = { output: id, format: 'png' };
  const expectedTick = Math.floor(time * (id === 'feedback' ? 48 : 36) + 1e-8);
  replay.assertions.push({ id: id + 'Restored', output: id + 'Report', path: ['from'], op: 'eq', value: expectedTick });
}
launch('resume-tideworks.json', replay, 'resumed');
for (const id of ['cloth', 'flip', 'feedback']) {
  const expected = session.inspect({ output: id }, { time: at }).artifacts[0].bytes;
  if (!expected.equals(fs.readFileSync(path.join(dir, 'resumed/artifacts/' + id + '.png'))))
    throw new Error('Resumed output differs from the original graph for ' + id);
}
process.stdout.write(dir + '\n');
