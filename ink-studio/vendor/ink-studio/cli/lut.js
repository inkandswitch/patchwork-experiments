const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ColorLUT = require('../src/color-lut.js');

function read(file, { color, domainPolicy } = {}) {
  if (typeof file !== 'string' || !/\.(cube|json)$/i.test(file))
    throw new TypeError('Expected a .cube or .json LUT file');
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  if (/\.cube$/i.test(file)) return ColorLUT.parseCube(text, { color, domainPolicy });
  const saved = ColorLUT.normalize(JSON.parse(text.replace(/^\uFEFF/, '')));
  if (color === undefined && domainPolicy === undefined) return saved;
  const next = color && Object.fromEntries(['input', 'output'].map(name => [name, { ...saved.color?.[name], ...color[name] }]));
  return ColorLUT.normalize({ ...saved, color: next ?? saved.color, domainPolicy: domainPolicy ?? saved.domainPolicy });
}

function importOptions(options) {
  const color = {};
  for (const endpoint of ['input', 'output']) {
    const space = options[endpoint + '-space'], range = options[endpoint + '-range'];
    const outOfRange = options[endpoint + '-out-of-range'];
    if (space === undefined && range === undefined && outOfRange === undefined) continue;
    color[endpoint] = {
      ...(space !== undefined && { space }),
      ...(range !== undefined && {
        range: String(range).split(',').map(part => part.trim() ? Number(part) : NaN)
      }),
      ...(outOfRange !== undefined && { outOfRange })
    };
  }
  return { color: Object.keys(color).length ? color : undefined, domainPolicy: options['domain-policy'] };
}

function write(file, definition) {
  const target = path.resolve(file), temporary = target + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(definition) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function override(value) {
  return value === undefined ? undefined : value === 'off' ? false : read(value);
}

module.exports = { read, write, override, importOptions };
