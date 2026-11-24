const fs = require('node:fs');
const path = require('node:path');
const ColorStack = require('../src/color-stack.js');
const Palette = require('./look-palette.js');

const idPart = /^[a-z][a-z0-9-]{0,47}$/;
const rgb = color => Palette.unpack(color).map(n => n / 255);

function validateOptions(file, opt) {
  const keys = ['format', 'look', 'params', 'as', 'id', 'swatches', 'roles', 'size',
    'domain-min', 'domain-max', 'out', 'report', 'exact', 'max-error'];
  for (const [key, value] of Object.entries(opt))
    if (!keys.includes(key) || (key === 'exact' ? value !== true : typeof value !== 'string'))
      throw new TypeError('Invalid option --' + key + ' for look bake');
  if (opt.out && !/\.json$/i.test(opt.out)) throw new TypeError('A baked look bundle needs a .json output');
  const inputs = [file, opt.swatches, opt.roles].filter(Boolean).map(name => path.resolve(name));
  if (opt.out && inputs.includes(path.resolve(opt.out))) throw new TypeError('--out needs a separate path');
  if (opt.report && (inputs.includes(path.resolve(opt.report)) || opt.out && path.resolve(opt.report) === path.resolve(opt.out)))
    throw new TypeError('--report needs a separate path');
  if (opt['max-error'] !== undefined && (!opt['max-error'].trim() ||
      !Number.isFinite(Number(opt['max-error'])) || Number(opt['max-error']) < 0))
    throw new TypeError('--max-error needs a nonnegative finite number');
}

function paletteBake(stack, reference, compile) {
  const palette = reference.rows.map(row => row.color), roles = reference.roles;
  if (!palette.length || palette.length > 48) throw new RangeError('A palette bake needs 1 to 48 ordered reference swatches');
  if (roles !== undefined && (!roles || Object.getPrototypeOf(roles) !== Object.prototype ||
      !Object.values(roles).every(ramp => Array.isArray(ramp) && ramp.length && ramp.every(i =>
        Number.isSafeInteger(i) && i >= 0 && i < palette.length))))
    throw new TypeError('--roles needs a JSON map from roles to reference swatch indices');

  const plan = compile(stack, reference), protect = [], rules = [], outputs = [];
  for (const [index, packed] of palette.entries()) {
    const input = rgb(packed), output = plan.sample(input, undefined, index);
    outputs.push(output);
    if (plan.protects(index)) protect.push(index);
    else if (output.some((n, i) => n !== input[i])) rules.push({ from: index, to: output });
  }
  const step = { type: 'paletteRemap', remap: { rules, protect }, color: {} };
  const table = compile({ name: stack.name, steps: [step] }, reference);
  let maxChannelError = 0, rmse = 0;
  const scale = Math.sqrt(palette.length * 3);
  for (const [index, packed] of palette.entries()) {
    const result = table.sample(rgb(packed), undefined, index);
    for (let i = 0; i < 3; i++) {
      const error = Math.abs(result[i] - outputs[index][i]);
      maxChannelError = Math.max(maxChannelError, error);
      rmse = Math.hypot(rmse, error / scale);
    }
  }
  if (!Number.isFinite(rmse)) throw new RangeError('The sampled palette error exceeds the numeric range');
  return { step, context: { palette, ...(roles && { roles }) },
    error: { mode: maxChannelError === 0 ? 'exact' : 'sampled', kind: 'palette-swatches', samples: palette.length,
      maxChannelError, rmse, space: 'srgb' } };
}

function lutBake(stack, options, sampleCube, standaloneLUT) {
  const original = standaloneLUT(stack);
  const existing = original && (options.size === undefined || Number(options.size) === original.size) &&
    options['domain-min'] === undefined && options['domain-max'] === undefined;
  if (existing) return { step: { type: 'lut', lut: original }, error: {
    mode: 'exact', kind: 'rgb-grid', size: original.size, samples: original.size ** 3,
    domainMin: original.domainMin, domainMax: original.domainMax, space: 'srgb', maxChannelError: 0, rmse: 0
  } };
  const report = { losses: [] };
  const lut = sampleCube(stack, options, report, original);
  const { count, ...metrics } = report.samples;
  return { step: { type: 'lut', lut }, error: { mode: 'sampled', ...metrics, samples: count } };
}

module.exports = function bake({ file, options, source, authoring, select, native, compile, sampleCube, standaloneLUT, readReference }) {
  validateOptions(file, options);
  const { assetPacks } = authoring;
  const authored = select(source, options, authoring);
  if (!authored.stack || authored.stage === 'palette') throw new TypeError('Select a look with an active color stack');
  if (authored.stack.baked) throw new TypeError('Select the editable source look for a new bake');
  if (authored.stack.steps.some(step => step.enabled !== false && step.amount !== 0 && step.type === 'curves' &&
      step.curves?.ramp?.stops?.some(([, color]) => typeof color === 'number')))
    throw new TypeError('Use hex or RGB ramp stops for baking. Numeric stops can resolve to different colors in a scene.');
  const staged = authored.stage !== undefined || authored.order !== undefined || authored.weight !== undefined;
  const gridOptions = ['size', 'domain-min', 'domain-max'].some(key => options[key] !== undefined);
  const requested = options.format ?? 'auto';
  if (!['auto', 'palette', 'lut'].includes(requested)) throw new TypeError('--format needs auto, palette or lut');
  const format = requested === 'auto' ? options.swatches && !staged && !gridOptions ? 'palette' : 'lut' : requested;
  if (format === 'palette' && (!options.swatches || staged || gridOptions))
    throw new TypeError('A palette bake needs --swatches and an unstaged look');
  if (format === 'lut' && options.roles) throw new TypeError('--roles applies to palette baking');
  if (format === 'lut' && (authored.stack.amount ?? 1) > 0 && authored.stack.steps.some(step =>
    step.type === 'paletteRemap' && step.enabled !== false && step.amount !== 0))
    throw new TypeError('Indexed remaps need a palette bake with --swatches');

  const sourceNotes = { losses: [] };
  const original = native(source, options.id === undefined ? {} : { id: options.id }, assetPacks, sourceNotes);
  const packs = original.packs ?? [original], sourceId = authored.id ?? original.looks[0].id;
  const [packId, lookId] = sourceId.split('/');
  const compiled = options.as ?? packId.slice(0, 42) + '-baked/' + lookId;
  const [compiledPack, compiledLook, extra] = compiled.split('/');
  if (!idPart.test(compiledPack) || !idPart.test(compiledLook ?? '') || extra !== undefined ||
      packs.some(pack => pack.id === compiledPack))
    throw new TypeError('--as needs a pack/look ID in a new pack namespace');

  const reference = format === 'palette' && readReference(options.swatches, assetPacks);
  if (reference && options.roles) reference.roles = JSON.parse(fs.readFileSync(options.roles, 'utf8'));
  const { step, context, error } = reference ? paletteBake(authored.stack, reference, compile) :
    lutBake(authored.stack, options, sampleCube, standaloneLUT);
  const label = authored.label.slice(0, 93) + ' (bake)';
  const { palette, lightingRamp, mask, stage, order, weight } = authored;
  const stack = ColorStack.normalize({ name: label, steps: [step],
    baked: { source: authored.stack, ...context, error } });
  const compiledManifest = assetPacks.manifest({ format: 'ink-studio/asset-pack', version: 1, revision: 1,
    id: compiledPack, title: label, looks: [{ id: compiled, label, stack,
      ...(palette && { palette }), ...(lightingRamp && { lightingRamp }), ...(mask !== undefined && { mask }),
      ...(stage !== undefined && { stage }), ...(order !== undefined && { order }), ...(weight !== undefined && { weight }) }] });
  return {
    bundle: assetPacks.bundle([...packs, compiledManifest]),
    report: { source: sourceId, compiled, format, error, fallback: 'editable-stack',
      ...(options.params !== undefined && { parameters: JSON.parse(options.params) }),
      ...(context && { reference: { palette: context.palette.map(Palette.hex), ...(context.roles && { roles: context.roles }) } }),
      ...sourceNotes }
  };
};
