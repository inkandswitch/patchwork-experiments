const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('math-fields needs a coordinate mapping JSON file');
  const definition = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')),
    math = K.procedural.mathFields;
  let report;
  if (opt.integrate !== undefined) {
    const sim = math.integrator(definition);
    report = { kind: 'integration', budget: sim.budget, state: sim.advance(Number(opt.integrate)) };
  } else {
    const mapping = math.mapping(definition),
      point = String(opt.point ?? '1,0.5,0')
        .split(',')
        .map(Number),
      time = Number(opt.time ?? 0);
    if (point.length !== 3) throw new Error('--point needs x,y,z');
    report = { kind: 'coordinateMap', cost: mapping.cost, spec: mapping.spec, sample: mapping.sample(...point, time) };
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log('wrote ' + out);
  } else process.stdout.write(json);
};
