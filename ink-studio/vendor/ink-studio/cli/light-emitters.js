const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('light-emitters needs an emitter JSON file');
  const input = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')),
    time = Number(opt.at ?? 0),
    report = { time, emitters: K.lightEmitters.report(Array.isArray(input) ? input : input.areaLights, { time }) },
    json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log('wrote ' + out);
  } else process.stdout.write(json);
};
