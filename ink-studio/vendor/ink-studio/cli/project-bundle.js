const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { write } = require('./asset-files.js');

const textFile = /\.(?:json|geojson|gltf|obj|mtl|csv|tsv|txt|cube|svg)$/i;
const studio = () => require('../index.js');
const api = () => studio().load().KIT.authoring.projectBundles;
const inside = (root, file) => {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep))
    throw new Error('Project references must stay inside the project root: ' + file);
  return relative.split(path.sep).join('/');
};

function packProject(scene, { out, root, revision = 1, assetPack, paint, attachments } = {}) {
  if (typeof scene !== 'string' || !/\.json$/i.test(scene) || typeof out !== 'string' || !/\.json$/i.test(out))
    throw new TypeError('Project packing needs a JSON scene and a .json output file');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new RangeError('Choose a positive project revision');
  const input = path.resolve(scene), projectRoot = path.resolve(root ?? path.dirname(input));
  const actualRoot = fs.realpathSync(projectRoot), entry = inside(projectRoot, input);
  const kit = studio().load().KIT, bundles = kit.authoring.projectBundles, records = new Map(), sources = new Set();
  let size = 0;
  function save(name, record, length) {
    size += length;
    if (size > bundles.maxBytes || records.size >= bundles.maxFiles) throw new RangeError('Project exceeds the file size or entry budget');
    records.set(name, record);
    return record;
  }
  function physical(file) {
    inside(projectRoot, file);
    const location = fs.realpathSync(file);
    inside(actualRoot, location);
    sources.add(location);
    return location;
  }
  function get(name) {
    if (records.has(name)) return records.get(name);
    const file = path.join(projectRoot, name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) return undefined;
    const location = physical(file);
    if (stat.size > bundles.maxBytes - size) throw new RangeError('Project exceeds the file size budget');
    const data = fs.readFileSync(location);
    const decoded = textFile.test(name) ? data.toString('utf8') : undefined;
    const text = decoded !== undefined && Buffer.from(decoded).equals(data);
    return save(name, { encoding: text ? 'utf8' : 'base64', data: text ? decoded : data.toString('base64') }, data.length);
  }
  function jsonFile(file) {
    if (typeof file !== 'string' || !file.trim()) throw new TypeError('Expected a project JSON dependency filename');
    const name = inside(projectRoot, path.resolve(file));
    const record = get(name);
    if (!record) throw new Error('Missing project file: ' + name);
    return JSON.parse(record.encoding === 'utf8' ? record.data : Buffer.from(record.data, 'base64').toString('utf8'));
  }
  let spec = jsonFile(input);
  if (spec?.format === bundles.format) throw new TypeError('Pack a source JSON diorama or save edits with withScene()');
  const refs = {};
  if (attachments !== undefined) {
    const mapping = jsonFile(attachments);
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new TypeError('Project attachments need a named file map');
    const owner = inside(projectRoot, path.resolve(attachments));
    for (const [id, ref] of Object.entries(mapping))
      Object.defineProperty(refs, id, { value: bundles.resolvePath(owner, ref), enumerable: true });
  }
  if (assetPack !== undefined) spec = { ...spec, assetPacks: kit.authoring.assetPacks.merge(spec.assetPacks ?? [], jsonFile(assetPack)).packs };
  if (paint !== undefined) spec = { ...spec, finish: { ...spec.finish, paint: jsonFile(paint) } };
  if (assetPack !== undefined || paint !== undefined) {
    const record = records.get(entry);
    size -= Buffer.byteLength(record.data, record.encoding);
    records.delete(entry);
    const data = JSON.stringify(spec, null, 2) + '\n';
    save(entry, { encoding: 'utf8', data }, Buffer.byteLength(data));
  }
  const { atlasPaths } = bundles.collect(entry, get, refs), atlases = {};
  for (const name of atlasPaths) {
    const source = studio().readSpriteAtlas(path.join(projectRoot, name)).snapshot();
    atlases[name] = bundles.mapAtlasImages(source, data => Buffer.from(data).toString('base64'));
  }
  const file = path.resolve(out), prior = fs.statSync(file, { throwIfNoEntry: false });
  if (prior && sources.has(fs.realpathSync(file))) throw new Error('Choose a project output separate from its inputs');
  const project = bundles.open({ format: bundles.format, version: bundles.version,
    project: { id: spec.id, revision }, toolkit: { version: studio().version,
      sourceHash: createHash('sha256').update(studio().bundle()).digest('hex') },
    entry, files: Object.fromEntries([...records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    attachments: refs, atlases });
  return writeProjectBundle(project, { out: file });
}

function readProjectBundle(file) {
  const bundles = api();
  if (fs.statSync(file).size > bundles.maxBytes * 2) throw new RangeError('Project bundle exceeds the JSON size budget');
  return bundles.open(fs.readFileSync(file, 'utf8'));
}

function writeProjectBundle(source, { out } = {}) {
  if (typeof out !== 'string' || !/\.json$/i.test(out)) throw new TypeError('Choose a project .json output filename');
  const bundles = api(), project = typeof source?.snapshot === 'function' ? source : bundles.open(source);
  const data = JSON.stringify(project.snapshot(), null, 2) + '\n', file = path.resolve(out);
  if (Buffer.byteLength(data) > bundles.maxBytes * 2) throw new RangeError('Project bundle exceeds the JSON size budget');
  write(file, data);
  return { file, project };
}

module.exports = { packProject, readProjectBundle, writeProjectBundle };
