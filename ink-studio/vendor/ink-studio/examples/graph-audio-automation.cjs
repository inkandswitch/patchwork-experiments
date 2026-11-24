// Render an original stereo cue and a replayed control take through the audio graph.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deflateSync } = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');
const { raster: R, drawing2d: D } = ink.load().KIT.procedural;
const folder = path.resolve(process.argv[2] || 'spectral-relay');
fs.mkdirSync(folder, { recursive: true });
const cli = path.join(__dirname, '../cli/ink-studio.js');
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n');
const run = (...args) => {
  const result = spawnSync(process.execPath, [cli, 'graph', ...args], { cwd: folder, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || result.stdout);
  return JSON.parse(result.stdout);
};

const sampleRate = 24000, fps = 24, duration = 4, frames = fps * duration;
const beat = .5, tau = Math.PI * 2, notes = [0, 7, 3, 10, 5, 12, 3, 7];
const base = [82.41, 82.41, 98, 98, 73.42, 73.42, 65.41, 65.41];
const samples = new Float64Array(sampleRate * duration * 2);
const envelope = (t, attack, decay) => (1 - Math.exp(-t / attack)) * Math.exp(-t / decay);
let noise = 84919, previousNoise = 0;
for (let i = 0; i < samples.length / 2; i++) {
  const t = i / sampleRate, j = Math.min(7, Math.floor(t / beat)), phase = t - j * beat;
  const offbeat = phase % .25, lift = j % 2 ? 7 : 0, root = base[j], melody = 392 * 2 ** ((notes[j] + (phase < .25 ? 0 : lift)) / 12);
  noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
  const white = noise / 2147483648 - 1, tick = (white - previousNoise) * envelope(offbeat, .001, .023);
  previousNoise = white;
  const thump = Math.sin(tau * (43 * phase + 2.7 * (1 - Math.exp(-phase * 18)))) * envelope(phase, .004, .105);
  const bass = (.82 * Math.sin(tau * root * phase) + .18 * Math.sin(tau * root * 2 * phase)) * envelope(phase, .014, .31);
  const bell = (.58 * Math.sin(tau * melody * offbeat) + .23 * Math.sin(tau * melody * 2.01 * offbeat) +
    .19 * Math.sin(tau * melody * 3.0 * offbeat)) * envelope(offbeat, .005, .125);
  const wash = Math.sin(tau * (root * 4 * t + .028 * Math.sin(tau * t))) * .074;
  const tail = Math.min(1, t / .03, (duration - t) / .09);
  samples[i * 2] = tail * (.32 * bass + .28 * thump + .22 * bell + wash + .028 * tick);
  samples[i * 2 + 1] = tail * (.23 * bass + .20 * thump + .34 * bell - wash * .5 + .044 * tick);
}
fs.writeFileSync(path.join(folder, 'relay.wav'), ink.encodeWav({ sampleRate, channels: 2, samples }, { encoding: 'pcm24' }));

// A synthetic controller adapter supplies a reproducible captured take.
const initial = { 'desk:fader': -.48, 'desk:mode': 'copper', 'desk:hold': false };
const events = [
  { time: .35, channel: 'desk:cue', kind: 'pulse', value: 'charge' },
  { time: .58, channel: 'desk:fader', value: .38 },
  { time: 1.10, channel: 'desk:fader', value: .72 },
  { time: 1.20, channel: 'desk:mode', value: 'mint' },
  { time: 1.50, channel: 'desk:cue', kind: 'pulse', value: 'switch' },
  { time: 1.96, channel: 'desk:hold', value: true },
  { time: 2.22, channel: 'desk:hold', value: false },
  { time: 2.34, channel: 'desk:fader', value: -.05 },
  { time: 2.70, channel: 'desk:mode', value: 'copper' },
  { time: 2.92, channel: 'desk:cue', kind: 'pulse', value: 'charge' },
  { time: 3.12, channel: 'desk:fader', value: .46 },
  { time: 3.68, channel: 'desk:fader', value: -.48 }
];
fs.writeFileSync(path.join(folder, 'demo-host.cjs'), 'module.exports = { devices: { console: { read() { return ' +
  JSON.stringify({ initial, events }) + '; } } } };\n');
save('capture.json', { format: 'ink-studio/host-request', version: 1, kind: 'device', adapter: 'console', type: 'inputs' });
save('capture-receipt.json', { ...run('capture', 'capture.json', '--adapters', 'demo-host.cjs', '--out', 'controls.json'),
  output: 'controls.json' });
const take = JSON.parse(fs.readFileSync(path.join(folder, 'controls.json'), 'utf8'));

const link = (node, port) => ({ node, ...(port && { port }) });
const bands = { bass: [40, 180], tone: [300, 950], air: [1200, 11500] };
const fft = { size: 2048, window: 'hann', bands };
const project = { format: 'ink-studio/graph-project', version: 1, seed: 29, time: 1.5,
  assets: { cue: { format: 'wav', file: 'relay.wav' }, take: { format: 'inputs', file: 'controls.json' } },
  nodes: {
    source: { op: 'audioAsset', inputs: { name: 'cue' } },
    recording: { op: 'inputAsset', inputs: { name: 'take' } },
    control: { op: 'input.replay', inputs: { source: link('recording'), options: { fps } } },
    action: { op: 'input.actions', inputs: { state: link('control'), context: 'desk',
      contexts: { desk: { intensity: ['desk:fader'], latch: ['desk:hold'] } } } },
    metrics: { op: 'audio.analyze', inputs: { source: link('source'), options: { fps } } },
    window: { op: 'audio.window', inputs: { source: link('source'), options: { fps } } },
    spectrum: { op: 'audio.fft', inputs: { source: link('source'), options: { fps, ...fft } } },
    bins: { op: 'raster.crop', inputs: { source: link('spectrum', 'spectrum'), options: { x: 0, y: 0, width: 256, height: 2 } } },
    colors: { op: 'color.gradient', inputs: { source: link('bins'),
      ramp: ['#1c2641', '#4f4973', '#7ab5a5', '#f1a985', '#fff0b5'], options: { channel: 0, range: [0, .21] } } },
    texture: { op: 'raster.resize', inputs: { source: link('colors'), options: { width: 384, height: 32 } } },
    tape: { op: 'audio.series', inputs: { source: link('source'), options: { fps, count: frames, fft } } },
    drawInputs: { op: 'data.record', inputs: { metrics: link('metrics'), rms: link('metrics', 'rms'),
      spectrum: link('spectrum', 'spectrum'), bins: link('spectrum'), bands: link('spectrum', 'bands'),
      controls: link('control'), actions: link('action'), pulses: link('control', 'pulses') } }
  },
  outputs: { audio: link('source'), audioFrame: link('window'), tape: link('tape'), texture: link('texture'),
    action: link('action'), pulses: link('control', 'pulses'), info: link('metrics'), frame: link('drawInputs') },
  exports: { cue: { output: 'audio', format: 'wav', encoding: 'pcm24' }, sample: { output: 'audioFrame', format: 'wav' },
    analysis: { output: 'tape', format: 'json' }, spectrum: { output: 'texture', format: 'png' } },
  assertions: [
    { id: 'frame', output: 'info', path: ['frame'], op: 'eq', value: 36 },
    { id: 'knownCue', output: 'pulses', path: [0, 'value'], op: 'eq', value: 'switch' },
    { id: 'fader', output: 'action', path: ['intensity'], op: 'eq', value: .72 }
  ]
};
save('spectral-relay.json', project);
const graphReport = run('run', 'spectral-relay.json', '--out', 'graph');
if (!graphReport.passed) throw new Error('Spectral Relay assertions failed');
const session = ink.readGraphProject(path.join(folder, 'spectral-relay.json'));
const analysis = JSON.parse(fs.readFileSync(path.join(folder, 'graph/artifacts/analysis.json'), 'utf8'));

const W = 494, H = 350, center = [171, 159];
const navy = '#171f34', lineBlue = '#435274', moon = '#e8d1a7', mint = '#86cdb7', copper = '#efa786', quiet = '#99adbd';
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill, stroke, width) => ({ type: 'ellipse', rect: [x, y, w, h], fill, stroke, width });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (text, x, y, color, scale = 1) => ({ type: 'text', text, at: [x, y], color, scale });
const unit = n => Math.max(0, Math.min(1, n));
const radial = (radius, angle) => [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
const ring = (radius, stroke) => ellipse(center[0] - radius, center[1] - radius, radius * 2, radius * 2, false, stroke, 1);
const diamond = (x, y, w, h, fill) => poly([[x, y - h], [x + w, y], [x, y + h], [x - w, y]], fill);
const draw = commands => D.render({ width: W, height: H, commands, edges: 'hard' });
const background = draw([
  rect(0, 0, W, H, navy), rect(16, 12, 14, 2, copper), text('INK STUDIO / AUDIO GRAPH', 36, 8, mint),
  text('SPECTRAL RELAY', 14, 24, moon, 3), text('STEREO ANALYSIS + RECORDED CONTROL REPLAY', 15, 51, quiet),
  rect(14, 65, 311, 183, '#25314e'), rect(14, 65, 311, 1, lineBlue),
  { type: 'grid', origin: [15.5, 66.5], step: [13, 13], counts: [24, 14], width: 1, color: '#46516b68' },
  poly([[15, 235], [48, 214], [111, 226], [173, 207], [234, 228], [325, 211], [325, 247], [15, 247]], '#29324e'),
  poly([[16, 239], [49, 224], [108, 232], [173, 214], [234, 233], [325, 220], [325, 247], [15, 247]], '#303652'),
  ...Array.from({ length: 31 }, (_, i) => rect(20 + ((i * 53 + 4) % 299), 78 + ((i * 43 + 9) % 139), i % 5 ? 1 : 2, 1, '#6c749a')),
  ellipse(111, 99, 120, 120, '#25314d'), ring(81, '#4d5876'), ring(69, '#3a4667'), ring(49, '#516085'), ring(38, '#62708b'),
  line([[90, 159], [252, 159]], '#495677'), line([[171, 78], [171, 240]], '#495677'),
  text('LEFT', 22, 74, copper), text('RIGHT', 287, 232, mint),
  rect(333, 65, 147, 183, '#242e48'), rect(333, 65, 147, 1, lineBlue),
  text('FRAME ANALYSIS', 342, 73, mint), text('BASS', 342, 91, quiet), text('TONE', 342, 113, quiet), text('AIR', 342, 135, quiet),
  rect(342, 159, 128, 1, lineBlue), text('RECORDED INPUT', 342, 169, mint), text('FADER', 342, 188, quiet),
  text('LATCH', 342, 206, quiet), text('CUE', 342, 225, quiet),
  text('STEREO WAVEFORM / 24 FPS', 15, 258, mint), rect(14, 269, 466, 66, '#242e48'),
  line([[17, 290], [475, 290]], '#465677'), line([[17, 312], [475, 312]], '#465677'),
  ...[0, 1, 2, 3, 4].map(s => rect(18 + 114 * s, 270, 1, 61, '#495571')),
  text('L', 18, 272, copper), text('R', 18, 319, mint)
]);
const waveformCommands = [];
for (let x = 0; x < 450; x++) {
  const a = Math.floor(x * duration * sampleRate / 450), z = Math.floor((x + 1) * duration * sampleRate / 450);
  for (let ch = 0; ch < 2; ch++) {
    let low = 0, high = 0;
    for (let i = a; i < z; i++) {
      const s = samples[i * 2 + ch];
      low = Math.min(low, s);
      high = Math.max(high, s);
    }
    waveformCommands.push(rect(23 + x, (ch ? 312 : 290) - Math.round(high * 20), 1,
      Math.max(1, Math.round((high - low) * 20)), ch ? '#6fa99e' : '#c38b86'));
  }
}
for (const { time, kind } of take.events) if (kind === 'pulse')
  waveformCommands.push(diamond(23 + time / duration * 449, 326, 2.5, 3, moon));
const waveform = draw(waveformCommands);

function painting(state, time) {
  const commands = [], row = state.metrics.frame, fader = (1 + state.actions.intensity) / 2;
  const highlight = state.controls['desk:mode'] === 'mint' ? mint : copper, latch = state.actions.latch > 0;
  const { width, data } = state.spectrum, binHz = state.bins.binHz;
  for (let ch = 0; ch < 2; ch++) for (let j = 0; j < 34; j++) {
    const low = 55 * 2 ** (j / 5), high = 55 * 2 ** ((j + 1) / 5);
    const a = Math.max(1, Math.ceil(low / binHz)), b = Math.min(width, Math.max(a + 1, Math.ceil(high / binHz)));
    let strength = 0;
    for (let k = a; k < b; k++) strength = Math.max(strength, data[ch * width + k]);
    const extent = 2 + Math.sqrt(unit(strength * 3)) * (19 + fader * 12);
    const angle = (j / 33 * .92 + .54 - ch) * Math.PI;
    const start = radial(51, angle), end = radial(51 + extent, angle);
    commands.push(line([start, end], ch === 0 ? (strength > .035 ? copper : '#805f77') :
      strength > .035 ? mint : '#4c758c', extent > 12 ? 2 : 1));
  }
  for (let tick = 0; tick < 12; tick++) {
    const angle = tau * tick / 12;
    commands.push(line([radial(86, angle), radial(tick % 3 ? 88 : 92, angle)], tick % 3 ? '#6f7890' : moon));
  }
  const core = 13 + 14 * Math.sqrt(state.rms);
  commands.push(diamond(...center, core * 1.3, core * 1.75, '#424763'),
    diamond(...center, core, core * 1.42, highlight),
    diamond(center[0] - 2, center[1] - 2, core * .66, core, latch ? '#fff0c5' : moon),
    diamond(...center, 4, 7, '#faf0ce'));
  const latest = take.events.filter(e => e.kind === 'pulse' && e.time <= time + 1e-9).at(-1);
  if (latest && time - latest.time < .25) {
    const r = 33 + (time - latest.time) * 53;
    for (let i = 0; i < 8; i++) {
      const [x, y] = radial(r + i % 2 * 3, i * Math.PI / 4);
      commands.push(diamond(x, y, 1.8, 3, moon));
    }
  }
  for (const [i, key] of ['bass', 'tone', 'air'].entries()) {
    const y = 100 + i * 22, power = state.bands[key];
    commands.push(rect(342, y, 128, 7, '#39455f'),
      rect(342, y, Math.round(Math.sqrt(unit(power * 2)) * 127), 7, i % 2 ? mint : copper),
      text(power.toFixed(3), 439, y - 9, moon));
  }
  commands.push(rect(406, 190, 64, 3, '#4f5a77'), rect(405 + Math.round(fader * 63), 187, 3, 8, highlight),
    text(latch ? 'ON' : 'OFF', 425, 205, latch ? moon : quiet),
    text(latest?.value.toUpperCase() ?? 'READY', 408, 224, highlight),
    rect(23 + (row / frames) * 449, 270, 1, 64, '#fff1c8'),
    text(String(row + 1).padStart(2, '0') + ' / ' + frames, 422, 258, moon));
  return R.stack({ width: W, height: H, layers: [{ source: background }, { source: waveform }, { source: draw(commands) }] }).value;
}
function write(name, art) {
  fs.writeFileSync(path.join(folder, name), PNG.encode(art.width, art.height, art.data, 4));
}
const state = time => session.inspect({ output: 'frame' }, { time }).value;
const image = painting(state(1.5), 1.5);
write('spectral-relay-review.png', R.resize(image, { width: W * 2, height: H * 2 }));

const animation = analysis.map(({ frame }) => {
  const time = frame / fps, { data } = painting(state(time), time), rgb = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) rgb.set(data.subarray(p * 4, p * 4 + 3), p * 3);
  return { w: W, h: H, rgb };
});
PNG.animate(path.join(folder, 'spectral-relay-motion.png'), animation, fps);

// A synthetic PXCX fixture demonstrates the native saved-preview bridge.
const stamp = R.crop(image, { x: 137, y: 125, width: 68, height: 68 });
const preview = { format: 6, width: stamp.width, height: stamp.height, buffer: deflateSync(stamp.data).toString('base64') };
const container = Buffer.alloc(8);
container.write('PXCX');
container.writeUInt32LE(8, 4);
fs.writeFileSync(path.join(folder, 'fixture.pxc'), Buffer.concat([container,
  deflateSync(JSON.stringify({ version: 1, versions: 'Synthetic Ink demo fixture', preview: JSON.stringify(preview) }) + '\0')]));
save('pxc-report.json', { ...run('import-pxc', 'fixture.pxc', '--out', 'imported-preview.json'), output: 'imported-preview.json' });
run('run', 'imported-preview.json', '--out', 'pxc-review');
const imported = PNG.raster(path.join(folder, 'pxc-review/artifacts/image.png'));
if (!Buffer.from(imported.data).equals(Buffer.from(stamp.data))) throw new Error('PXC preview changed imported pixels');
process.stdout.write(folder + '\n');
