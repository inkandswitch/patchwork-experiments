const fs = require('node:fs');
const path = require('node:path');

function embed(api, definition, owner, dependency) {
  if (definition === undefined) return undefined;
  const dir = path.dirname(path.resolve(owner));
  return api.embed(definition, file => {
    if (path.isAbsolute(file) || /^[a-z][a-z\d+.-]*:/i.test(file))
      throw new TypeError('Dataset files need paths relative to the scene: ' + file);
    const source = path.resolve(dir, file), stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new RangeError('Expected a dataset text file up to 16 MiB: ' + file);
    dependency?.(source);
    return fs.readFileSync(source, 'utf8');
  });
}

module.exports = { embed };
