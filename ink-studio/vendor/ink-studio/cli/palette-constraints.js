const fs = require('node:fs');

function override(value) {
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (typeof value !== 'string') throw new TypeError('Use --palette-constraints file.json or off');
  return JSON.parse(fs.readFileSync(value, 'utf8'));
}

module.exports = { override };
