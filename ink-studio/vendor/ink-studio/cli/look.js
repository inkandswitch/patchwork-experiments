const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const ColorLUT = require('../src/color-lut.js');
const ColorStack = require('../src/color-stack.js');
const ColorSpace = require('../src/color-space.js');
const PixelLook = require('../src/pixel-look.js');
const lutIO = require('./lut.js');
const Palette = require('./look-palette.js');

const formats = ['json', 'cube', 'gpl', 'pal', 'hex'];
const isPalette = format => ['gpl', 'pal', 'hex'].includes(format);
const extension = file => path.extname(file).slice(1).toLowerCase();
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const pretty = value => JSON.stringify(value, null, 2) + '\n';
const note = (report, code, message) => report.losses.push({ code, message });
const swatches = rows => rows.map(({ color }) => Palette.hex(color));
const normalized = color => Palette.unpack(color).map(n => n / 255);
const packFormat = 'ink-studio/asset-pack', bundleFormat = 'ink-studio/asset-bundle';

function fallbackName(file) {
  const name = path.basename(file, path.extname(file)).normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (/^[a-z]/.test(name) ? name : 'look' + (name ? '-' + name : '')).slice(0, 48);
}

function read(file, packs, colorOptions) {
  const format = extension(file), fallback = fallbackName(file);
  if (!formats.includes(format)) throw new TypeError('Expected a .cube, .json, .gpl, .pal or .hex look file');
  function fromLUT(lut, source) {
    const label = lut.title?.trim() || fallback;
    return { source, fallback, label, stack: { name: label, steps: [{ type: 'lut', lut }] } };
  }
  if (format === 'cube') return fromLUT(lutIO.read(file, colorOptions), 'cube');
  const text = fs.readFileSync(file, 'utf8');
  if (isPalette(format)) {
    const paletteFile = Palette.parse(text, format), label = paletteFile.title || fallback;
    return { source: format, fallback, label, paletteFile, palette: { palette: swatches(paletteFile.rows) } };
  }
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (value?.format === packFormat || value?.format === bundleFormat) {
    const native = value.format === packFormat ? packs.manifest(value) : packs.bundle(packs.merge([], value).packs);
    return { source: value.format === packFormat ? 'asset-pack' : 'asset-bundle', native };
  }
  if (value?.format === 'ink-studio/lut' || record(value) && Object.hasOwn(value, 'size') && Object.hasOwn(value, 'data'))
    return fromLUT(lutIO.read(file, colorOptions), 'native-lut');
  if (record(value) && Object.hasOwn(value, 'steps')) {
    const stack = ColorStack.normalize(value);
    return { source: 'native-stack', fallback, label: stack.name, stack };
  }
  if (Array.isArray(value)) {
    const { entries, rounded } = Palette.colors(value, { packedNumbers: true });
    return { source: 'native-swatches', fallback, label: fallback, rounded,
      palette: { palette: entries.map(Palette.hex) } };
  }
  if (record(value) && Object.keys(value).length && (value.palette === undefined || Array.isArray(value.palette)) &&
      Object.keys(value).every(key => ['palette', 'reserved', 'dither', 'source', 'match'].includes(key)))
    return { source: 'native-palette', fallback, label: fallback, palette: value };
  throw new TypeError('JSON needs a LUT, color stack, palette, asset pack or asset bundle');
}

function native(source, options, packs, report) {
  if (source.native) {
    if (options.id !== undefined || options.label !== undefined)
      throw new TypeError('An existing pack or bundle already has its IDs and labels');
    return source.native;
  }
  const id = options.id ?? source.fallback + '/' + source.fallback;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}\/[a-z][a-z0-9-]{0,47}$/.test(id))
    throw new TypeError('--id needs a namespaced pack/look ID');
  const label = options.label ?? source.label.slice(0, 100);
  if (options.label === undefined && source.label.length > 100)
    note(report, 'label-length', 'The native look label was shortened to 100 characters.');
  if (source.paletteFile?.rows.some(row => row.label) || source.paletteFile?.columns !== undefined)
    note(report, 'palette-presentation', 'Native looks store swatches and a look label. Per-swatch labels and palette columns were omitted.');
  if (source.rounded) note(report, 'palette-rounding', source.rounded + ' swatches were rounded to 8-bit RGB.');
  let palette = source.palette;
  if (palette) {
    if (palette.palette && (!palette.palette.length || palette.palette.length > 48))
      throw new RangeError('A native look needs 1 to 48 palette swatches');
    if (palette.reserved !== undefined && (!Array.isArray(palette.reserved) || palette.reserved.length > 48))
      throw new RangeError('A native look supports up to 48 reserved swatches');
    if (palette.source !== undefined) {
      const { source: selection, ...policy } = palette;
      if (!['lit', 'graded'].includes(selection)) throw new TypeError('Invalid native palette source');
      if (selection === 'graded') note(report, 'palette-source', 'The legacy graded source selection was omitted from the native look.');
      palette = policy;
    }
  }
  return packs.manifest({ format: packFormat, version: 1, revision: 1, id: id.split('/')[0], title: label,
    looks: [{ id, label, ...(source.stack && { stack: source.stack }), ...(palette && { palette }) }] });
}

function select(source, options, authoring, report) {
  if (!source.native) {
    if (options.look !== undefined || options.params !== undefined)
      throw new TypeError('--look and --params apply to named looks in a native pack or bundle');
    return source;
  }
  const catalog = authoring.assetPacks.create({ packs: source.native.packs ?? [source.native] });
  const id = options.look ?? (catalog.looks.length === 1 ? catalog.looks[0].look.id : undefined);
  if (!id) throw new TypeError('Select one named look with --look pack/look');
  const entry = catalog.getLook(id);
  if (!entry) throw new Error('Unknown look asset: ' + id);
  const params = options.params === undefined ? undefined : JSON.parse(options.params);
  const bound = authoring.looks.bind({ asset: id, ...(params !== undefined && { params }) }, catalog);
  const { look } = entry;
  if (report) {
    report.look = id;
    if (Object.keys(look.params).length) note(report, 'parameterized', 'The look was evaluated with its selected parameter values.');
    for (const key of ['stage', 'mask', 'order', 'weight']) if (bound[key] !== undefined)
      note(report, 'look-' + key, 'The external format omits the look ' + key + '.');
    if (bound.lightingRamp) note(report, 'material-lighting-ramp', 'The external format omits the material lighting ramp.');
  }
  return { ...bound, label: look.label };
}

const unitMin = [0, 0, 0], unitMax = [1, 1, 1];
const workingColor = ColorSpace.settings({});
const explicitIdentity = color => color === undefined || JSON.stringify(ColorSpace.settings(color)) === JSON.stringify(workingColor);

function standaloneLUT(stack) {
  const active = stack.steps.filter(step => step.enabled !== false && step.amount !== 0);
  if (active.length !== 1 || active[0].type !== 'lut' || (active[0].amount ?? 1) !== 1 || (stack.amount ?? 1) !== 1) return null;
  const { lut, color } = active[0];
  const definition = ColorLUT.normalize(lut);
  return explicitIdentity(color ?? definition.color) ? definition : null;
}

function copiesTable(definition, options) {
  return definition && definition.interpolation === 'tetrahedral' && (definition.domainPolicy ?? 'clamp') === 'clamp' &&
    (options.size === undefined || Number(options.size) === definition.size) &&
    options['domain-min'] === undefined && options['domain-max'] === undefined;
}

function compile(stack, reference, missingSwatches = 'A .cube has no palette indices. Export this look to a palette using --swatches.') {
  const steps = stack.amount === 0 ? [] : stack.steps.filter(step => step.enabled !== false && step.amount !== 0);
  if (!reference && steps.some(step => step.type === 'paletteRemap'))
    throw new TypeError(missingSwatches);
  const palette = reference?.rows.map(row => row.color);
  return ColorStack.prepare({ ...stack, steps }, palette ? {
    palette, roles: reference.roles,
    paletteRemap: (definition, color) => PixelLook.prepareRemap(definition, palette, reference.roles, color)
  } : {});
}

function readReference(file, packs) {
  const input = read(file, packs);
  if (input.paletteFile) return input.paletteFile;
  if (!input.palette?.palette || input.stack) throw new TypeError('--swatches needs an external palette or a native swatch list');
  const { entries } = Palette.colors(input.palette.palette);
  return { rows: entries.map(color => ({ color })) };
}

function point(value, fallback) {
  if (value === undefined) return fallback;
  const rgb = String(value).split(',').map(token => token.trim() ? Number(token) : NaN);
  if (rgb.length !== 3 || !rgb.every(Number.isFinite)) throw new TypeError('A .cube domain needs three finite comma-separated values');
  return rgb;
}

function sampleCube(stack, options, report, original) {
  const size = Number(options.size ?? 33);
  if (!Number.isSafeInteger(size) || size < 2 || size > 65) throw new RangeError('Sampled .cube size must be an integer from 2 to 65');
  const domainMin = point(options['domain-min'], original?.domainMin ?? unitMin);
  const domainMax = point(options['domain-max'], original?.domainMax ?? unitMax);
  const span = domainMax.map((max, i) => max - domainMin[i]);
  if (span.some(n => !Number.isFinite(n) || n <= 0)) throw new RangeError('A .cube domain needs increasing finite bounds');
  const plan = compile(stack), input = [0, 0, 0], output = [0, 0, 0], data = new Array(size ** 3 * 3);
  const steps = size - 1;
  const at = (r, g, b) => {
    input[0] = r === steps ? domainMax[0] : domainMin[0] + span[0] * (r / steps);
    input[1] = g === steps ? domainMax[1] : domainMin[1] + span[1] * (g / steps);
    input[2] = b === steps ? domainMax[2] : domainMin[2] + span[2] * (b / steps);
  };
  let offset = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    at(r, g, b);
    plan.sample(input, output);
    for (const value of output) data[offset++] = value;
  }
  const cube = ColorLUT.normalize({ size, domainMin, domainMax, title: stack.name, data }, true);
  const table = ColorLUT.prepare(cube), estimated = [0, 0, 0];
  const midpointChecks = steps ** 3, scale = Math.sqrt(midpointChecks * 3);
  let rmse = 0, maxChannelError = 0;
  for (let b = 0; b < steps; b++) for (let g = 0; g < steps; g++) for (let r = 0; r < steps; r++) {
    at(r + .5, g + .5, b + .5);
    plan.sample(input, output);
    table.sample(input, estimated);
    for (let i = 0; i < 3; i++) {
      const error = Math.abs(output[i] - estimated[i]);
      maxChannelError = Math.max(maxChannelError, error);
      rmse = Math.hypot(rmse, error / scale);
    }
  }
  if (!Number.isFinite(rmse)) throw new RangeError('The sampled .cube error exceeds the numeric range');
  report.samples = { kind: 'rgb-grid', size, count: size ** 3, domainMin, domainMax, space: 'srgb',
    midpointChecks, maxChannelError, rmse };
  note(report, 'sampled-transform', 'The RGB transfer was baked to normalized sRGB samples. Interpolation between samples is approximate.');
  return cube;
}

function* cubeRows(cube) {
  let chunk = (cube.title ? 'TITLE "' + cube.title.replace(/["\r\n]/g, ' ') + '"\n' : '') +
    'LUT_3D_SIZE ' + cube.size + '\nDOMAIN_MIN ' + cube.domainMin.join(' ') + '\nDOMAIN_MAX ' + cube.domainMax.join(' ') + '\n';
  for (let i = 0; i < cube.data.length; i += 3) {
    chunk += cube.data[i] + ' ' + cube.data[i + 1] + ' ' + cube.data[i + 2] + '\n';
    if (chunk.length > 65536) { yield chunk; chunk = ''; }
  }
  if (chunk) yield chunk;
}

function toCube(look, options, report) {
  if (!look.stack) throw new TypeError('A .cube needs a continuous RGB stack. Export a palette look as .gpl, .pal or .hex.');
  if (look.palette) note(report, 'omitted-palette', 'The .cube contains the color stack. Palette choices and dithering were omitted.');
  const original = standaloneLUT(look.stack);
  if (look.stack.baked) {
    report.baked = look.stack.baked.error;
    if (report.baked.mode !== 'exact')
      note(report, 'baked-source', 'The LUT approximates the editable source and the external format omits its outside-domain fallback.');
  }
  const cube = copiesTable(original, options) ? original : sampleCube(look.stack, options, report, original);
  if (cube.title && /["\r\n]/.test(cube.title)) note(report, 'cube-title', 'Unsupported title characters were replaced with spaces.');
  report.table = { size: cube.size, rows: cube.size ** 3, interpolation: 'reader-defined' };
  return cubeRows(cube);
}

function toPalette(look, options, format, readReference, report) {
  const reference = bakeReference(look.stack, options.swatches === undefined ? undefined : readReference(options.swatches));
  if (look.stack?.baked) report.baked = look.stack.baked.error;
  let file;
  if (look.stack && reference) {
    const plan = compile(look.stack, reference);
    let clipped = 0, rounded = 0;
    const rows = reference.rows.map((row, index) => {
      const entry = Palette.round(plan.sample(normalized(row.color), undefined, index));
      clipped += Number(entry.clipped);
      rounded += Number(entry.rounded);
      return { ...row, color: entry.color };
    });
    file = { rows, title: look.label, columns: reference.columns };
    report.samples = { kind: 'palette-swatches', count: rows.length, clipped, rounded };
    if (look.palette) note(report, 'omitted-palette', 'The stack was sampled on the reference swatches. The authored palette policy was omitted.');
    if (clipped || rounded) note(report, 'palette-precision', clipped + ' sampled swatches were clipped and ' + rounded + ' were rounded to 8-bit RGB.');
  } else if (look.paletteFile) file = look.paletteFile;
  else if (look.palette) {
    const { palette, reserved, dither, source, match } = look.palette;
    const ref = reference?.rows.map(row => row.color);
    if (palette === undefined && !ref) throw new TypeError('A scene-dependent palette needs --swatches');
    const { entries, rounded } = palette === undefined ? { entries: ref, rounded: 0 } : Palette.colors(palette, { reference: ref });
    const extra = reserved?.length ? Palette.colors(PixelLook.reserveEntries(reserved).map(row => row.color), { reference: ref }) : { entries: [], rounded: 0 };
    for (const color of extra.entries) if (!entries.includes(color)) entries.push(color);
    if (look.stack) note(report, 'omitted-stack', 'The file contains the authored palette. Use --swatches to sample the color stack.');
    if (reserved?.length || dither !== undefined || source === 'graded' || match && match !== 'rgb')
      note(report, 'omitted-palette-rules', 'The external file stores colors. Reservation, dithering, source and matching rules were omitted.');
    if (rounded + extra.rounded + (look.rounded ?? 0)) note(report, 'palette-rounding', 'Some swatches were rounded to 8-bit RGB.');
    file = { rows: entries.map(color => ({ color })), title: report.look ? look.label : undefined };
  } else throw new TypeError('A color stack needs --swatches with a reference palette for palette export');
  if (format !== 'gpl' && (file.title || file.columns !== undefined || file.rows.some(row => row.label)))
    note(report, 'palette-presentation', 'The external format omits the palette title, layout, or swatch labels.');
  if (format === 'gpl' && /[\r\n]/.test(file.title ?? '')) {
    file = { ...file, title: file.title.replace(/[\r\n]/g, ' ') };
    note(report, 'palette-presentation', 'Line breaks in the palette title were replaced with spaces.');
  }
  report.palette = { swatches: file.rows.length };
  return [Palette.print(file, format)];
}

function allowedOptions(mode, format, source, options) {
  const color = ['input-space', 'output-space', 'input-range', 'output-range',
    'input-out-of-range', 'output-out-of-range', 'domain-policy'];
  const keys = ['out', 'report', 'exact',
    ...(mode === 'import' ? ['id', 'label'] : ['format']),
    ...(format !== 'json' ? ['look', 'params'] : []),
    ...(format === 'cube' ? ['size', 'domain-min', 'domain-max'] : []),
    ...(isPalette(format) ? ['swatches'] : []),
    ...(['cube', 'native-lut'].includes(source) ? color : [])];
  for (const [name, value] of Object.entries(options))
    if (!keys.includes(name) || (name === 'exact' ? value !== true : typeof value !== 'string'))
      throw new TypeError('Invalid option --' + name + ' for this look conversion');
}

async function write(chunks, file) {
  if (!file) {
    for (const chunk of chunks) if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
    return;
  }
  const target = path.resolve(file), temporary = target + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    const fd = fs.openSync(temporary, 'wx');
    try {
      for (const chunk of chunks) fs.writeFileSync(fd, chunk);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function run(pos, options, authoring) {
  const [mode, file] = pos;
  if (pos.length !== 2 || !['import', 'export'].includes(mode))
    throw new TypeError('Usage: ink-studio look import <file> [--out pack.json] | look export <file> [--out file | --format json|cube|gpl|pal|hex]');
  if (options.out !== undefined && typeof options.out !== 'string') throw new TypeError('--out needs a path');
  const format = mode === 'import' ? 'json' : options.format ?? (options.out ? extension(options.out) : 'json');
  if (!formats.includes(format) || options.out && extension(options.out) !== format)
    throw new TypeError('The output extension must match json, cube, gpl, pal or hex');
  const input = read(file, authoring.assetPacks, lutIO.importOptions(options));
  allowedOptions(mode, format, input.source, options);
  if (options.report && [file, options.out, options.swatches].some(name => name && path.resolve(name) === path.resolve(options.report)))
    throw new TypeError('--report needs a separate path');
  const report = { source: input.source, target: format === 'json' ? (input.native?.packs ? 'asset-bundle' : 'asset-pack') : format, losses: [] };
  const reference = file => readReference(file, authoring.assetPacks);
  const output = format === 'json' ? [JSON.stringify(native(input, options, authoring.assetPacks, report)) + '\n'] : (() => {
    const look = select(input, options, authoring, report);
    return format === 'cube' ? toCube(look, options, report) : toPalette(look, options, format, reference, report);
  })();
  report.mode = report.samples ? 'sampled' : report.losses.length ? 'lossy' : 'exact';
  if (options.report) await write([pretty(report)], options.report);
  process.stderr.write('Look conversion: ' + report.mode + ' (' + report.source + ' → ' + report.target + ')\n');
  if (report.samples) process.stderr.write(JSON.stringify(report.samples) + '\n');
  if (report.table) process.stderr.write('  The .cube reader selects the interpolation method.\n');
  for (const item of report.losses) process.stderr.write('  ' + item.message + '\n');
  if (options.exact && report.mode !== 'exact') throw new Error('--exact rejected the conversion before writing the output');
  await write(output, options.out);
}

function isSource(file) {
  if (typeof file !== 'string') return false;
  const format = extension(file);
  if (format === 'cube' || isPalette(format)) return true;
  if (format !== 'json') return false;
  const input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (Array.isArray(input)) return input.length > 0 && input.every(value =>
    typeof value === 'number' || typeof value === 'string' || Array.isArray(value));
  return record(input) && ([packFormat, bundleFormat, 'ink-studio/lut'].includes(input.format) ||
    Object.hasOwn(input, 'size') && Object.hasOwn(input, 'data') || Object.hasOwn(input, 'steps') ||
    Object.keys(input).length > 0 && Object.keys(input).every(key => ['palette', 'reserved', 'dither', 'source', 'match'].includes(key)));
}

function inspectSource(file, options, kit) {
  const { assetPacks, looks } = kit.KIT.authoring, { standalone } = kit.KIT.world.lookReport;
  const renderer = options.renderer ?? 'headless';
  if (!['headless', 'webgl'].includes(renderer)) throw new TypeError('Renderer must be headless or webgl');
  const input = read(file, assetPacks), issues = [], rules = [];
  if (input.native) {
    const catalog = assetPacks.create({ packs: input.native.packs ?? [input.native] });
    for (const { look, revision } of catalog.looks) {
      if (options.look !== undefined && options.look !== look.id) continue;
      try {
        const binding = looks.bind(look.id, catalog);
        const { issues: checked, ...rule } = standalone({ ...binding, assetId: look.id }, look.params, renderer);
        for (const issue of checked) issues.push({ path: look.id, ...issue });
        rules.push({ label: look.label, revision, ...rule });
      } catch (error) {
        issues.push({ path: look.id, code: 'invalid-look', message: error.message });
      }
    }
    if (options.look !== undefined && !catalog.getLook(options.look))
      throw new Error('Unknown look asset: ' + options.look);
  } else {
    if (options.look !== undefined) throw new Error('--look selects an asset in a pack or bundle');
    const { issues: checked, ...rule } = standalone(input, undefined, renderer, { externalPalette: Boolean(input.paletteFile) });
    rules.push({ label: input.label, ...rule });
    issues.push(...checked.map(issue => ({ path: file, ...issue })));
  }
  return { source: input.source, renderer, valid: !issues.length, rules, issues };
}

function assertValid(report) {
  if (!report.valid) throw new Error(report.issues.map(({ path, message }) => path + ': ' + message).join('\n'));
  return report;
}

function report(output, options, source) {
  if (options.out !== undefined && typeof options.out !== 'string') throw new TypeError('--out needs a path');
  if (options.out && source !== undefined && path.resolve(options.out) === path.resolve(source)) throw new TypeError('--out needs a separate path');
  return write([pretty(output)], options.out);
}

function sample(file, options, kit) {
  const authoring = kit.KIT.authoring;
  const source = read(file, authoring.assetPacks);
  const look = select(source, options, authoring);
  if (look.lightingRamp && !look.stack && !look.palette)
    throw new TypeError('Sample a lighting ramp with a material lookAsset in a rendered scene');
  const reference = bakeReference(look.stack, options.swatches ? readReference(options.swatches, authoring.assetPacks) : undefined);
  return require('./look-sample.js')({ file, options, source: source.source, look, reference, kit, report, compile });
}

function bakeReference(stack, reference) {
  const baked = stack?.baked;
  if (!baked?.palette) return reference;
  if (!reference) return { rows: baked.palette.map(color => ({ color })), roles: baked.roles };
  if (reference.rows.length === baked.palette.length && reference.rows.every((row, i) => row.color === baked.palette[i]))
    return { ...reference, roles: baked.roles };
  return reference;
}

async function bake(file, options, kit) {
  const authoring = kit.KIT.authoring;
  const source = read(file, authoring.assetPacks);
  const result = require('./look-bake.js')({ file, options, source, authoring, select, native, compile,
    sampleCube, standaloneLUT, readReference });
  if (options.report) await write([pretty(result.report)], options.report);
  process.stderr.write('Look bake ' + result.report.compiled + ' (' + result.report.format + ')\n' +
    JSON.stringify(result.report.error) + '\n');
  if (options.exact && result.report.error.mode !== 'exact')
    throw new Error('--exact rejected the sampled look before writing the output');
  if (options['max-error'] !== undefined && result.report.error.maxChannelError > Number(options['max-error']))
    throw new Error('Measured channel error exceeds --max-error before writing the output');
  await write([JSON.stringify(result.bundle) + '\n'], options.out);
}

module.exports = { run, isSource, inspectSource, assertValid, report, sample, bake, write };
