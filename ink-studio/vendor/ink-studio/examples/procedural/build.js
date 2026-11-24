// Build a portable gallery from the same plain-script bundle used in browsers.
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../..');

const output = path.resolve(process.argv[2] || 'dist/procedural-gallery.html');
const source = [
  lib.bundle(),
  ...['authoring-example.js', 'gallery.js'].map(name => fs.readFileSync(path.join(__dirname, name), 'utf8'))
].join('\n');
const template = fs.readFileSync(path.join(__dirname, 'gallery.html'), 'utf8');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  template.replace('/* BUNDLE */', () => source.replace(/<\/script/gi, '<\\/script'))
);
console.log(output);
