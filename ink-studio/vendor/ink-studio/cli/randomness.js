const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('randomness needs a recipe JSON file');
  const spec = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
  const record = (v, keys) =>
    v && Object.getPrototypeOf(v) === Object.prototype && Object.keys(v).every(k => keys.includes(k));
  if (!record(spec, ['seed', 'limits', 'streams']) || !Array.isArray(spec.streams) || spec.streams.length > 256)
    throw new TypeError('Invalid randomness recipe');
  const root = K.random.create(spec.seed === undefined ? 0 : spec.seed, spec.limits);
  const streams = spec.streams.map(item => {
    if (
      !record(item, ['path', 'keys', 'count', 'distribution']) ||
      !Array.isArray(item.path) ||
      (item.keys !== undefined && item.count !== undefined)
    )
      throw new TypeError('A random recipe stream needs a path and keys or count');
    const s = root.stream(...item.path),
      d = K.random.distribution(item.distribution);
    const count = Number(opt.samples ?? item.count ?? 16);
    let values;
    if (item.keys !== undefined) {
      if (!Array.isArray(item.keys) || item.keys.length > 4096)
        throw new RangeError('Random recipe keys exceed sample budget');
      values = item.keys.map(key => ({ key, value: s.sample(key, d) }));
    } else {
      if (!Number.isInteger(count) || count < 0 || count > 4096)
        throw new RangeError('Random recipe samples must be in [0,4096]');
      values = s.batch(count, d);
    }
    return { path: s.path, seed32: s.seed32, distribution: d.spec, cursor: s.cursor, values };
  });
  const report = { algorithm: root.algorithm, seed: root.seed, streams, checkpoint: root.snapshot() },
    text = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log('wrote ' + out);
  } else process.stdout.write(text);
};
