const fs = require('node:fs');

function install(catalog, installed, file) {
  if (file === undefined) return installed;
  if (typeof file !== 'string') throw new TypeError('Use --asset-pack with a pack or bundle JSON file');
  return catalog.merge(installed ?? [], fs.readFileSync(file, 'utf8')).packs;
}

module.exports = { install };
