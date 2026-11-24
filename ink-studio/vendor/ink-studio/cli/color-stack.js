const fs = require('node:fs');
const ColorStack = require('../src/color-stack.js');

function override(value) {
  if (value === undefined) return undefined;
  if (value === 'off') return false;
  if (typeof value !== 'string' || !/\.json$/i.test(value))
    throw new TypeError('Expected a JSON color stack file or off');
  return ColorStack.normalize(JSON.parse(fs.readFileSync(value, 'utf8')));
}

module.exports = { override };
