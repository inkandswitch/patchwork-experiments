/* Inspect resolved bindings against a baked scene and its query snapshot. */
(function (K) {
  const W = K.world;
  const active = value => value !== undefined && value !== false;
  const rgbLayer = type => ['colorCurve', 'colorLut', 'colorStack', 'projected'].includes(type);
  const swatch = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const paletteReference = value => typeof value === 'number' || typeof value === 'string' && !swatch(value);
  const paletteSwatches = policy => [...(policy?.palette ?? []), ...PixelLook.reserveEntries(policy?.reserved ?? []).map(row => row.color),
    ...(Array.isArray(policy?.dither?.pairs) ? policy.dither.pairs.flatMap(rule => rule?.colors ?? []) : [])];
  const lutInfo = lut => {
    const { data, ...info } = ColorLUT.normalize(lut);
    return { ...info, rows: data.length / 3 };
  };
  const stackInfo = stack => ({
    ...stack, steps: stack.steps.map(step => step.type === 'lut' ? { ...step, lut: lutInfo(step.lut) } : step),
    ...(stack.baked && { baked: { ...stack.baked, source: stack.baked.source.name } })
  });
  function maskInfo(mask) {
    if (!mask || typeof mask === 'function') return typeof mask === 'function' ? { type: 'sampler' } : mask ?? null;
    const { raster, ...info } = mask;
    return raster ? { ...info, raster: { width: raster.width, height: raster.height, frames: raster.frames?.length ?? 1 } } : info;
  }

  function dependencies(definition) {
    const rows = [], seen = new Set();
    function add(type, id, detail = {}) {
      const key = JSON.stringify([type, id, detail]);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ type, ...(id !== undefined && { id }), ...detail });
      }
    }
    const { assetId, driver, mask, stack, palette, remap, field, source } = definition;
    if (assetId) add('asset', assetId);
    const regions = palette?.dither?.regions;
    for (const shape of [mask, ...(Array.isArray(regions) ? regions.map(region => region?.mask) : [])]) {
      if (shape?.type === 'query') add('query', shape.field);
      if (shape?.type === 'field') add('field', shape.field, { channel: shape.channel });
      if (shape?.type === 'texture') add('texture');
    }
    if (field) add('field', field);
    if (source?.field) add(source.channel ? 'field' : 'query', source.field, source.channel ? { channel: source.channel } : {});
    for (const input of [driver?.inputs.strength, ...Object.values(driver?.inputs.params ?? {})]) {
      if (input) add(input.source, input.port ?? input.field);
    }
    for (const item of [remap, ...(stack?.steps ?? []).map(step => step.remap)]) if (item) {
      for (const value of [...(item.protect ?? []), ...(item.rules ?? []).map(rule => rule.from)]) add('swatch', value);
      for (const { to } of item.rules ?? []) if (typeof to === 'string' && !swatch(to)) add('swatch', to);
    }
    if (palette?.palette === undefined && (palette?.dither || palette?.reserved)) add('scene-palette');
    for (const value of paletteSwatches(palette))
      if (paletteReference(value)) add('swatch', value);
    return rows;
  }

  function definitionInfo(definition, params) {
    const { assetId, stack, lut, palette, mask, driver, type, source, remap, curves, tone, lightingRamp } = definition;
    return { ...(assetId && { asset: assetId }), ...(stack && { stack: stackInfo(stack) }),
      ...(lut && { lut: lutInfo(lut) }), ...(palette && { palette }), mask: maskInfo(mask),
      ...(type && { type }), ...(source && { source }), ...(remap && { remap }),
      ...(curves && { curves }), ...(tone && { tone }),
      ...(lightingRamp && { lightingRamp }),
      ...(params && { parameters: params }), ...(driver && { inputs: driver.inputs }), dependencies: dependencies(definition) };
  }

  function scene(world, index, media, query, time, { renderer = 'headless', definitions = false } = {}) {
    if (!['headless', 'webgl'].includes(renderer)) throw new TypeError('Renderer must be headless or webgl');
    const look = world.look ?? {}, issues = [], rules = [];
    const clock = world.lookSnapshot?.time ?? time;
    const lookInputs = LookInputs.session(clock, () => world.lookSnapshot?.query ?? world.surfaceEffects?.query ?? query);
    const context = { palette: world.pal, roles: world.paletteRoles, blueNoise: K.procedural.materials.blueNoise,
      context: world.surfaceEffects, lookInputs };
    const groups = index.groups(undefined, { includeUnnamed: true });
    const waterNames = new Set(world.water?.count && typeof world.water.mapColors === 'function'
      ? world.water.media?.map(row => row.id) : []);
    const mediaGroups = media.map(target => ({ target, count: 1 }));
    const waterGroup = ({ target }) => target.kind === 'medium' && waterNames.has(target.medium);

    function issue(path, code, message) { issues.push({ path, code, message }); }
    function check(path, compile) {
      try { return compile(); }
      catch (error) { issue(path, 'invalid-look', error.message); }
    }
    function unsupported(path, message) {
      issue(path, 'unsupported-renderer', renderer + ' ' + message);
    }
    function rulesAt(path, list, limit, add) {
      if (!active(list)) return;
      if (!Array.isArray(list) || list.length > limit) {
        issue(path, 'invalid-look', 'Expected up to ' + limit + ' rules');
        return;
      }
      list.forEach((rule, i) => add(path + '[' + i + ']', rule));
    }

    function add(path, stage, authored, eligible, { mode = 'scene', explicit = false, surface, selector } = {}) {
      check(path, () => {
        const select = selector ?? (authored.select === undefined ? null : TargetSelectors.prepare(authored.select));
        const resolved = authored.driver && LookInputs.resolve(authored.driver, lookInputs);
        const definition = resolved ? { ...authored, stack: resolved.stack, palette: resolved.palette, mask: resolved.mask } : authored;
        const matched = select ? eligible.filter(row => TargetSelectors.matches(select, row.target)) : eligible;
        if (select && !matched.length) issue(path, 'unresolved-selector', 'No render target matches ' + JSON.stringify(select));
        if (renderer === 'webgl') {
          if (explicit) unsupported(path, 'does not evaluate explicit ' + stage + ' stages');
          else if (mode === 'surface') unsupported(path, 'does not evaluate surface look layers');
          else if (['world', 'object'].includes(definition.palette?.dither?.space))
            unsupported(path, 'uses screen space for palette dither');
          else if (definition.palette?.dither?.regions?.length)
            unsupported(path, 'uses base palette dither settings without regional tuning');
          else if (definition.mask && !ContributionRules.supportsMask(definition.mask))
            unsupported(path, 'evaluates axis masks and planar raster masks');
          else if (matched.some(row => (mode === 'optics' || row.target.kind === 'medium') && !waterGroup(row)))
            unsupported(path, 'only applies medium look bindings to native water');
        }
        if (mode === 'target' && definition.mask && matched.some(row => row.target.kind === 'medium'))
          issue(path, 'unsupported-binding', 'Medium palette rules need a uniform binding');
        rules.push({ path, stage, mode, ...(surface !== undefined && { surfaceSlot: surface }),
          select, ...definitionInfo(definition), ...(resolved && { sampledInputs: { strength: resolved.strength, params: resolved.params } }),
          ...(authored.order !== undefined && { order: authored.order }), ...(authored.weight !== undefined && { weight: authored.weight }),
          ...(definitions && { definition }),
          matchedTargets: matched.map(({ target, count }) => ({ ...target, count })) });
      });
    }
    function staged(path, entries, eligible, surface, localContext = context) {
      rulesAt(path, entries, 64, (at, rule) => {
        if (check(at, () => RenderStages.prepare([rule], localContext)))
          add(at, rule.stage, rule, eligible, { explicit: true, surface });
      });
    }

    if (look.coverageAware !== undefined && typeof look.coverageAware !== 'boolean')
      issue('look.coverageAware', 'invalid-look', 'coverageAware must be a boolean');
    for (const [key, compile, describe] of [
      ['tone', value => PixelLook.prepareTone(value, context.blueNoise), tone => ({ tone })],
      ['paletteRemap', value => PixelLook.prepareRemap(value, world.pal, world.paletteRoles), remap => ({ remap })],
      ['colorCurves', value => ColorCurves.prepare(value), curves => ({ curves })],
      ['colorLut', value => ColorLUT.prepare(value), lut => ({ lut })],
      ['colorStack', value => PixelLook.prepareColorStack(value, world.pal, world.paletteRoles),
        stack => ({ stack, assetId: look.colorStackAssetId })]
    ]) {
      if (active(look[key]) && check('look.' + key, () => compile(look[key]))) {
        const path = 'look.' + key;
        add(path, 'palette', describe(look[key]), groups);
      }
    }
    const constraints = look.paletteConstraints;
    if (active(constraints)) {
      if (!constraints || Object.getPrototypeOf(constraints) !== Object.prototype ||
          Object.keys(constraints).some(key => !['default', 'targets'].includes(key))) {
        issue('look.paletteConstraints', 'invalid-look', 'Palette constraints accept default and targets');
      } else {
        if (constraints.default !== undefined && check('look.paletteConstraints.default',
          () => PixelLook.prepareLookPolicy(constraints.default, context))) {
          const { stack, mask, assetId, ...palette } = constraints.default;
          add('look.paletteConstraints.default', 'palette', { stack, mask, assetId, palette }, groups);
        }
        rulesAt('look.paletteConstraints.targets', constraints.targets, 63, (path, rule) => {
          const plan = check(path, () => PixelLook.preparePaletteConstraints({ targets: [rule] }, context));
          if (!plan) return;
          const { select, object, material, stack, mask, assetId, ...palette } = rule;
          const eligible = groups.concat(mediaGroups.filter(row => row.target.mediumKind !== 'reflection'));
          add(path, 'palette', { stack, mask, assetId, palette }, eligible, { mode: 'target', selector: plan.rules[0].select });
        });
      }
    }
    staged('look.renderStages', look.renderStages, groups);
    const opticalGroups = mediaGroups.concat(groups.filter(row => TargetSelectors.isGlass(world, row.first)));
    rulesAt('look.optics', look.optics, 32, (path, rule) => {
      if (check(path, () => RenderStages.optics([rule], context)))
        add(path, 'optics', rule, opticalGroups, { mode: 'optics' });
    });

    const bySurface = new Map();
    for (const row of groups) {
      const slot = world.surfaceData?.[row.first * SurfaceLook.STRIDE];
      if (slot) {
        if (!bySurface.has(slot)) bySurface.set(slot, []);
        bySurface.get(slot).push(row);
      }
    }
    for (const [i, { settings }] of (world.surfaces ?? []).entries()) {
      const surface = i + 1, eligible = bySurface.get(surface) ?? [];
      const base = 'surfaces[' + i + ']';
      const roles = check(base + '.paletteRoles', () => PixelLook.bindRoles(world.pal, world.paletteRoles, settings.paletteRoles));
      if (!roles) continue;
      staged(base + '.renderStages', settings.renderStages, eligible, surface, { ...context, roles });
      const layers = Object.entries(settings.layers ?? {}).filter(([id, layer]) => rgbLayer(layer?.type) ||
        (id === 'lookAssetRamp' && settings.lookAssetId && layer?.lightingRamp));
      if (!layers.length && settings.paletteConstraint === undefined) continue;
      check(base, () => SurfaceLook.prepare(settings, world.pal, undefined, world.surfaceEffects, {
        paletteRoles: world.paletteRoles, blueNoise: context.blueNoise
      }));
      for (const [id, layer] of layers) add(base + '.layers.' + id, 'lit',
        { ...layer, assetId: ['lookAsset','lookAssetRamp'].includes(id) ? settings.lookAssetId : undefined }, eligible, { mode: 'surface', surface });
      if (settings.paletteConstraint !== undefined) {
        const { stack, mask, assetId = settings.lookAssetId, ...palette } = settings.paletteConstraint;
        add(base + '.paletteConstraint', 'palette', { stack, mask, assetId, palette }, eligible, { mode: 'surface', surface });
      }
    }

    return { renderer, time: clock, ...(world.id !== undefined && { scene: { id: world.id, name: world.name } }),
      ...(world.lookSnapshot?.tick !== undefined && { tick: world.lookSnapshot.tick }),
      valid: !issues.length, rules, issues };
  }

  function standalone(definition, params, renderer, { externalPalette = false } = {}) {
    const { stack, stage, palette, mask } = definition;
    if (stack) {
      if (stage && stage !== 'palette' && stack.steps.some(step => step.type === 'paletteRemap'))
        throw new TypeError('Render stage stacks operate on RGB and require RGB color transforms');
      ColorStack.prepare(stack, {
        paletteRemap: (definition, color) => PixelLook.prepareRemap(definition, [], {}, color, { deferTargets: true })
      });
    }
    if (palette && !externalPalette) {
      if (palette.palette !== undefined &&
        (!Array.isArray(palette.palette) || palette.palette.length > 48 || Array.from(palette.palette).some(value =>
          !(typeof value === 'string' && value.trim() || Number.isSafeInteger(value) && value >= 0 ||
            Array.isArray(value) && value.length === 3 && Array.from(value).every(n => Number.isFinite(n) && n >= 0 && n <= 1)))))
        throw new TypeError('Invalid native palette swatches');
      if (palette.reserved !== undefined) PixelLook.reserveEntries(palette.reserved);
      const contextDependent = !palette.palette || paletteSwatches(palette).some(paletteReference);
      PixelLook.preparePalette(contextDependent ? { ...palette, palette: ['#000000'], reserved: [] } : palette,
        { blueNoise: K.procedural.materials.blueNoise, deferDitherColors: contextDependent, validateOnly: true });
    }
    SplatEffects.prepareMask(mask, undefined, { validateOnly: true });
    const issues = [];
    if (definition.lightingRamp && renderer === 'webgl')
      issues.push({ code: 'unsupported-renderer', message: 'webgl does not evaluate material lighting ramps' });
    else if (stage !== undefined && renderer === 'webgl')
      issues.push({ code: 'unsupported-renderer', message: 'webgl does not evaluate explicit ' + stage + ' stages' });
    else if (mask && renderer === 'webgl')
      issues.push({ code: 'unsupported-renderer', message: 'webgl does not evaluate spatial look masks' });
    else if (renderer === 'webgl' && ['world', 'object'].includes(palette?.dither?.space))
      issues.push({ code: 'unsupported-renderer', message: 'webgl uses screen space for palette dither' });
    else if (renderer === 'webgl' && palette?.dither?.regions?.length)
      issues.push({ code: 'unsupported-renderer', message: 'webgl uses base palette dither settings without regional tuning' });
    return { ...definitionInfo(definition, params), stage: stage ?? null, issues };
  }
  W.lookReport = Object.freeze({ scene, standalone });
})(KIT);
