const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('material-controls needs a descriptor or material JSON file');
  const input = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')),
    palette = opt.palette && JSON.parse(fs.readFileSync(path.resolve(opt.palette), 'utf8')),
    report = K.material.inspect(input, { palette }),
    json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log('wrote ' + out);
  } else process.stdout.write(json);
};
