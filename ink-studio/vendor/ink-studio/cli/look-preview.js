const fs = require('node:fs');
const path = require('node:path');
const ArtPasses = require('../src/art-passes.js');
const Palette = require('./pass-preview.js');
const PNG = require('./png.js');
const R = require('./render.js');
const { registry } = require('./look-pass.js');

const lookKeys = ['tone', 'paletteRemap', 'colorCurves', 'colorLut', 'colorStack', 'colorStackAssetId',
  'paletteConstraints', 'renderStages', 'optics', 'coverageAware'];
const colorLayer = layer => ['colorCurve', 'colorLut', 'colorStack', 'projected'].includes(layer?.type);

function replaceSceneLook(base) {
  return Object.fromEntries(Object.entries(base ?? {}).filter(([key]) => !lookKeys.includes(key)));
}

function withAlbedo(build) {
  const prior = globalThis.INK_LOOK_ALBEDO;
  globalThis.INK_LOOK_ALBEDO = true;
  try { return build(); }
  finally { globalThis.INK_LOOK_ALBEDO = prior; }
}

function applyDefinition(world, definition, looks, catalog) {
  if (!definition || Object.getPrototypeOf(definition) !== Object.prototype)
    throw new TypeError('A look override needs a scene look object');
  const patched = looks.scene(Object.hasOwn(definition, 'steps') ? { colorStack: definition } : definition, catalog);
  const base = definition.asset !== undefined ? replaceSceneLook(world.look) : { ...world.look };
  if (Object.hasOwn(patched, 'colorStack')) delete base.colorStackAssetId;
  world.look = { ...base, ...patched };
}

function applyBinding(world, asset, select, looks, catalog) {
  const base = world.look ?? {};
  if (select === undefined) {
    world.look = { ...replaceSceneLook(base), ...looks.scene({ asset }, catalog) };
    return;
  }
  const scoped = looks.scene({ targets: [{ select, asset }] }, catalog);
  const constraints = scoped.paletteConstraints;
  const staged = base.renderStages?.length || world.surfaces?.some(surface => surface.settings.renderStages?.length);
  world.look = { ...base,
    ...(constraints && staged && { coverageAware: true }),
    ...(scoped.renderStages?.length && { renderStages: [...(base.renderStages || []), ...scoped.renderStages] }),
    ...(constraints && { paletteConstraints: { ...base.paletteConstraints,
      targets: [...(base.paletteConstraints?.targets ?? []), ...constraints.targets]
    } })
  };
}

function assets(world, opt, kit) {
  const { assetPacks } = kit.KIT.authoring;
  const packs = world.lookPreviewPacks ??
    require('./asset-pack.js').install(assetPacks, world.assetPacks, opt['asset-pack']);
  return packs?.length ? assetPacks.create({ packs }) : undefined;
}

function override(world, opt, kit) {
  const value = opt.look;
  const extras = ['look-select', 'look-params', 'look-strength'];
  if (value === undefined) {
    if (extras.some(key => opt[key] !== undefined)) throw new TypeError('Look binding options need --look pack/look');
    return world;
  }
  if (typeof value !== 'string') throw new TypeError('--look needs an asset ID, JSON file or off');
  const file = /\.json$/i.test(value);
  if (value === 'off' || file) for (const key of extras) if (opt[key] !== undefined)
    throw new TypeError('--' + key + ' applies to an asset ID');
  if (value === 'off') {
    const surfaces = world.surfaces?.map(({ settings, ...surface }) => {
      const { renderStages, paletteConstraint, layers, ...other } = settings;
      return { ...surface, settings: { ...other, ...(layers && {
        layers: Object.fromEntries(Object.entries(layers).filter(([id, layer]) =>
          !colorLayer(layer) && (id !== 'lookAssetRamp' || !settings.lookAssetId)))
      }) } };
    });
    world.look = replaceSceneLook(world.look);
    if (surfaces) world.surfaces = surfaces;
    return world;
  }
  const { looks } = kit.KIT.authoring, catalog = assets(world, opt, kit);
  const parse = key => opt[key] === undefined ? undefined : JSON.parse(opt[key]);
  if (file) {
    applyDefinition(world, JSON.parse(fs.readFileSync(value, 'utf8')), looks, catalog);
  } else {
    const select = parse('look-select'), params = parse('look-params');
    const strength = opt['look-strength'] === undefined ? undefined :
      typeof opt['look-strength'] === 'string' && opt['look-strength'].trim() ? Number(opt['look-strength']) : NaN;
    const asset = { asset: value, ...(params !== undefined && { params }), ...(strength !== undefined && { strength }) };
    applyBinding(world, asset, select, looks, catalog);
  }
  return world;
}

const bindingKeys = new Set(['asset', 'revision', 'strength', 'params', 'palette', 'mask', 'stage', 'paletteStage', 'order', 'weight', 'inputs', 'select']);

function editPalette(world, { palette, select }, kit) {
  const settings = Array.isArray(palette) ? { palette } : palette;
  if (settings !== false && (!settings || Object.getPrototypeOf(settings) !== Object.prototype))
    throw new TypeError('A palette case needs swatches, palette settings or false');
  const selector = select === undefined ? undefined : kit.TargetSelectors.prepare(select);
  const equal = kit.KIT.world.data.equal;
  const base = world.look ?? {}, stages = base.renderStages || [];
  function replace(rows, matches, build) {
    const index = rows.findLastIndex(matches);
    if (index < 0) return settings === false ? rows : [...rows, build()];
    const next = rows.slice();
    if (settings === false) next.splice(index, 1);
    else next[index] = build(rows[index]);
    return next;
  }
  if (stages.length || world.surfaces?.some(row => row.settings.renderStages?.length)) {
    world.look = { ...base, renderStages: replace(stages, rule => rule.stage === 'palette' && equal(rule.select, selector),
      prior => {
        const driver = prior?.driver;
        return { stage: 'palette', ...prior, ...(selector && { select: selector }), palette: { ...prior?.palette, ...settings },
          ...(driver && { driver: { ...driver, palette: { ...driver.palette, ...settings },
            swatches: settings.palette ?? driver.swatches } }) };
      }) };
    return;
  }
  const policy = { ...base.paletteConstraints };
  if (selector) policy.targets = replace(policy.targets ?? [], rule => equal(rule.select, selector),
    prior => ({ ...prior, ...settings, select: selector }));
  else if (settings === false) delete policy.default;
  else policy.default = { ...policy.default, ...settings };
  world.look = { ...base, paletteConstraints: policy };
}

function variant(world, definition, kit, catalog, directory) {
  const preview = { ...world };
  if (definition === undefined) return preview;
  if (definition === false || definition === 'off') return override(preview, { look: 'off' }, kit);
  const { looks } = kit.KIT.authoring;
  if (typeof definition === 'string') {
    if (/\.json$/i.test(definition)) applyDefinition(preview,
      JSON.parse(fs.readFileSync(path.resolve(directory, definition), 'utf8')), looks, catalog);
    else applyBinding(preview, { asset: definition }, undefined, looks, catalog);
  } else if (definition && typeof definition.asset === 'string' && Object.keys(definition).every(key => bindingKeys.has(key))) {
    const { select, ...asset } = definition;
    applyBinding(preview, asset, select, looks, catalog);
  } else if (definition && Object.hasOwn(definition, 'palette') && Object.keys(definition).every(key => key === 'palette' || key === 'select')) {
    editPalette(preview, definition, kit);
  } else applyDefinition(preview, definition, looks, catalog);
  return preview;
}

function preview(opt) {
  if (opt.passes === undefined) return null;
  const channels = ArtPasses.select(opt.passes === true ? ['target', 'mask', 'materialId'] : String(opt.passes).split(','));
  if (channels.some(channel => ['position', 'objectPosition'].includes(channel)))
    throw new TypeError('Position passes need the floating-point Node render API');
  const frames = new Map(channels.map(channel => [channel, []]));
  const lookPassRegistry = registry();
  let first, last;
  return {
    settings: { passes: channels, lookPassRegistry },
    suffixes: [...channels.map(channel => '-'+channel+'.png'), '-passes.json'],
    capture(frame, scale) {
      first ??= { width: frame.w, height: frame.h, scale };
      last = frame.passes;
      for (const [channel, images] of frames)
        images.push(R.upscale(Palette.encode(frame, channel), scale));
    },
    write(output, { times, cols, fps } = {}) {
      const ext = path.extname(output);
      const base = ext ? output.slice(0, -ext.length) : output;
      const files = {};
      for (const [channel, images] of frames) {
        const file = base + '-' + channel + '.png';
        if (fps !== undefined) PNG.animate(file, images, fps);
        else {
          const image = cols !== undefined ? R.grid(images, cols, times.map(t => t + 's')) : images[0];
          PNG.write(file, image.w, image.h, image.rgb, image.alpha);
        }
        files[channel] = path.basename(file);
      }
      const file = base + '-passes.json';
      fs.writeFileSync(file, JSON.stringify({ ...first, rows: 'top-down', files,
        ...(times && { times }), ...(fps !== undefined && { fps }),
        ...Palette.labels(last), ...Palette.environmentEncoding(last)
      }, null, 2) + '\n');
      console.log('wrote', file);
    }
  };
}

module.exports = { override, preview, withAlbedo, assets, variant };
