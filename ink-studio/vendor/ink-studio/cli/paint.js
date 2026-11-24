const fs = require('node:fs'),
  path = require('node:path');
module.exports = function paintCLI(pos, opt, kit) {
  const [action, file] = pos;
  if (!['mix', 'ramp', 'table', 'swatches'].includes(action) || !file)
    throw Error('paint mix|ramp|table|swatches needs a JSON file');
  const definition = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')),
    api = kit.KIT.paint;
  const book = definition.swatches && api.book(definition.swatches),
    resolve = value => (typeof value === 'string' && book?.names.includes(value) ? book.get(value) : api.swatch(value));
  let report;
  if (action === 'mix') {
    const entries = definition.mix;
    if (!Array.isArray(entries)) throw Error('paint mix needs a mix array');
    let paint = api.mix(
      entries.map(v => ({ paint: resolve(v.paint), weight: v.weight ?? 1 })),
      { name: definition.name ?? 'Mixture' }
    );
    if (definition.tint !== undefined) paint = api.tint(paint, definition.tint);
    if (definition.shade !== undefined) paint = api.shade(paint, definition.shade);
    report = { paint: paint.snapshot(), rgb: paint.rgb, hex: paint.hex, diagnostics: paint.diagnostics };
  } else if (action === 'ramp') {
    if (!Array.isArray(definition.stops)) throw Error('paint ramp needs gradient stops');
    const gradient = api.gradient({
      stops: definition.stops.map(v => ({ at: v.at, paint: resolve(v.paint) })),
      interpolation: definition.interpolation ?? 'linear'
    });
    report = api.bakeRamp(gradient, { steps: opt.steps === undefined ? 256 : Number(opt.steps) }).snapshot();
  } else if (action === 'table') {
    if (!Array.isArray(definition.paints)) throw Error('paint table needs a paints array');
    const table = api.bakeTable({
      paints: definition.paints.map(resolve),
      size: opt.size === undefined ? (definition.size ?? 17) : Number(opt.size)
    });
    report = opt.lut ? table.asLUT() : table.snapshot();
  } else report = (book ?? api.book(definition)).snapshot();
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const output = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json);
  } else process.stdout.write(json);
};
