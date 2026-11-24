const fs = require('node:fs'),
  path = require('node:path');
module.exports = function curveCLI(pos, opt, kit) {
  if (!pos[0]) throw Error('curve needs a curve-family JSON file');
  const definition = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
  const curve = definition.points
    ? kit.KIT.curve.interpolate(definition.points, definition.options ?? {})
    : kit.KIT.curve.create(definition);
  const report = {
    definition: curve.snapshot(),
    closed: curve.closed,
    length: curve.length,
    properties: curve.properties,
    sampling: curve.sampling,
    parameters: curve.parameters,
    points: curve.points,
    ...(curve.generation !== undefined && { generation: curve.generation, segments: curve.segments, cells: curve.cells })
  };
  if (opt.distance !== undefined) report.sample = curve.at(Number(opt.distance));
  if (opt.closest !== undefined) report.closest = curve.closest(String(opt.closest).split(',').map(Number));
  if (opt.curvature !== undefined) report.curvature = curve.curvature(Number(opt.curvature));
  if (opt.text !== undefined) report.drawing = kit.KIT.curve.text(curve, String(opt.text), { fit: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
  } else process.stdout.write(json);
};
