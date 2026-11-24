/* CLI one-shot capture and project import. Graph evaluation consumes local snapshots. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { inspectPxc, maxPxcBytes } = require('./pxc.js');
const { createGraphHost } = require('./graph-host.js');
const { createGraphProject } = require('./graph-project.js');

const commands = Object.freeze({
  capture: ['out', 'adapters', 'json'],
  'inspect-pxc': ['out', 'json'],
  'import-pxc': ['out', 'adapters', 'using', 'json']
});
const hash = raw => createHash('sha256').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function adapters(file, settings) {
  if (file === undefined) return settings;
  if (typeof file !== 'string' || !file.trim()) throw new TypeError('--adapters needs a local Node module');
  const adapterFile = path.resolve(file);
  const imported = await import(pathToFileURL(adapterFile).href);
  return { ...settings, adapterFile, adapters: imported.default ?? imported };
}

function distinct(file, sources) {
  const existing = fs.statSync(file, { throwIfNoEntry: false });
  if (!existing) return;
  if (!existing.isFile() || sources.some(source => {
    const stat = fs.statSync(source);
    return existing.ino === stat.ino && existing.dev === stat.dev;
  })) throw new Error('Host output must be a file separate from its inputs');
}

function readPxc(file) {
  if (fs.statSync(file).size > maxPxcBytes) throw new RangeError('PXC file exceeds the import budget');
  return fs.readFileSync(file);
}

function readValue(file, type) {
  if (type === 'audio') return WAV.read(file);
  if (type === 'raster') {
    const { w, h, data, max } = PNG.raster(file);
    return { width: w, height: h, data: max === 255 ? data : Uint8Array.from(data, n => Math.round(n * 255 / max)) };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function encodeValue(value, type) {
  if (type === 'audio') return WAV.encode(value, { encoding: 'float64' });
  if (type === 'raster') return PNG.encode(value.width, value.height, value.data, 4);
  return json(value);
}

async function execute(pos, opt, settings) {
  const [mode, source] = pos;
  if (pos.length !== 2 || Object.entries(opt).some(([key, value]) => !commands[mode].includes(key) ||
      (key === 'json' ? value !== true : typeof value !== 'string' || !value.trim())) ||
      mode === 'import-pxc' && opt.out === undefined)
    throw new TypeError('Use graph capture|inspect-pxc|import-pxc <file> with the corresponding output and adapter options');
  const file = path.resolve(source), output = opt.out && path.resolve(opt.out);
  settings = await adapters(opt.adapters, settings);
  const sources = [file, ...(settings.adapterFile ? [settings.adapterFile] : [])];
  if (output) distinct(output, sources);

  if (mode === 'inspect-pxc') {
    const { report } = inspectPxc(readPxc(file));
    if (output) files.json(output, report);
    return report;
  }

  const host = createGraphHost(settings.adapters, { kit: settings.kit });
  if (mode === 'import-pxc') {
    const data = readPxc(file);
    const { project, report } = await host.importPxc(data, { using: opt.using, file });
    const graph = createGraphProject(project, { ...settings, baseDir: path.dirname(output) });
    distinct(output, [...sources, ...graph.sourceFiles()]);
    files.json(output, project);
    return { ...report, kind: 'import-pxc', output, sourceHash: hash(data), projectHash: graph.validate().projectHash };
  }

  const request = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { kind, direction, adapter, type, file: input } = host.request(request);
  if (direction === 'read' && !output) throw new TypeError('A capture read needs --out for the local snapshot');
  const inputFile = input && path.resolve(path.dirname(file), input);
  if (output && inputFile) distinct(output, [inputFile]);
  const value = await host.exchange(request, { ...(inputFile && { value: readValue(inputFile, type) }) });
  const encoded = encodeValue(value, direction === 'read' ? type : 'json');
  if (output) files.write(output, encoded);
  return { format: 'ink-studio/host-receipt', version: 1, kind, adapter, direction, type,
    bytes: encoded.length, sha256: hash(encoded), ...(output && { output }) };
}

module.exports = { commands, adapters, execute };
