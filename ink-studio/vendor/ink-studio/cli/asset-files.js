const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PNG = require('./png.js');

function write(file, bytes) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = fs.mkdtempSync(path.join(directory, '.ink-asset-'));
  try {
    const staged = path.join(temp, 'asset');
    fs.writeFileSync(staged, bytes);
    fs.renameSync(staged, file);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function json(file, document) {
  write(file, JSON.stringify(document, null, 2) + '\n');
}

function image(directory, width, height, rgba) {
  const bytes = PNG.encode(width, height, rgba, 4);
  const name = createHash('sha256').update(bytes).digest('hex') + '.png';
  const relative = 'images/' + name, file = path.join(directory, relative);
  if (!fs.existsSync(file)) write(file, bytes);
  return relative;
}

module.exports = { write, json, image };
