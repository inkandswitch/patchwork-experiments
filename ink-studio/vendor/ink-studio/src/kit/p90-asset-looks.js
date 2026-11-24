/* Resolve portable look templates at their use site. */
(function (K) {
  const A = K.authoring, { clone, freeze } = A.data;
  const assetId = /^[a-z][a-z0-9-]{0,47}\/[a-z][a-z0-9-]{0,47}$/;
  const parameter = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const swatch = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ||
    Array.isArray(value) && value.length === 3 && Array.from(value).every(fraction);
  const stageRuleFields = ['asset', 'select', 'mask', 'stage', 'paletteStage', 'order', 'weight'];
  const hasBlend = value => value?.order !== undefined || value?.weight !== undefined || Boolean(value?.driver);
  const active = bound => bound && (bound.strength || bound.driver?.inputs.strength !== undefined);
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

  const { substitute } = LookInputs;

  function validateRamp(ramp,id) {
    if (!Array.isArray(ramp?.stops) || !Array.from(ramp.stops).every(row=>
      Array.isArray(row) && row.length===2 && swatch(row[1])))
      throw Error('A portable lighting ramp needs explicit hex or RGB stops');
    SurfaceLook.lightRamps({ [id]: { diffuse:ramp } });
  }

  function definition(value, packId) {
    if (!fields(value, ['id', 'label', 'params', 'stack', 'palette', 'lightingRamp', 'mask', 'stage', 'paletteStage', 'order', 'weight']) || typeof value.id !== 'string' ||
        !assetId.test(value.id) || !value.id.startsWith(packId + '/') ||
        typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100 ||
        (value.stack === undefined && value.palette === undefined && value.lightingRamp === undefined))
      throw Error('A look needs a namespaced ID, label and color stack, palette or lighting ramp');
    const { id, label, params = {}, stack, palette, lightingRamp, mask, stage, paletteStage, order, weight } = value;
    RenderStages.blend(value);
    if (stage !== undefined) RenderStages.stage(stage);
    if (paletteStage !== undefined) RenderStages.stage(paletteStage);
    if ((stage === 'palette' || paletteStage !== undefined) && palette === undefined) throw Error('A palette stage needs a look palette');
    if (!record(params) || Object.keys(params).length > 64 || !Object.keys(params).every(name => parameter.test(name)))
      throw Error('Look parameters need named JSON defaults');
    if (stack !== undefined) {
      const resolved = substitute(stack, params);
      if (!record(resolved)) throw Error('A look color stack must be an object');
      ColorStack.normalize(resolved);
    }
    if (palette !== undefined) {
      const policy = substitute(palette,params);
      if (!fields(policy,['palette','reserved','dither','match'])) throw Error('A look palette needs palette constraint settings');
      if (policy.match !== undefined) PixelLook.preparePalette({palette:['#000000'],match:policy.match});
    }
    if (lightingRamp !== undefined) validateRamp(substitute(lightingRamp, params),id);
    SplatEffects.prepareMask(substitute(mask, params), undefined, { validateOnly: true });
    return freeze({ id, label: label.trim(), params, ...(stack !== undefined && { stack }),
      ...(palette !== undefined && { palette }), ...(lightingRamp !== undefined && { lightingRamp }),
      ...(mask !== undefined && { mask }), ...(stage && { stage }), ...(paletteStage && { paletteStage }),
      ...(order !== undefined && { order }), ...(weight !== undefined && { weight }) });
  }

  function bind(binding, catalog) {
    if (binding === undefined || binding === false) return null;
    const value = typeof binding === 'string' ? { asset: binding } : binding;
    if (!fields(value, ['asset', 'revision', 'strength', 'palette', 'params', 'mask', 'stage', 'paletteStage', 'order', 'weight', 'inputs']) || typeof value.asset !== 'string' ||
        !assetId.test(value.asset) || (value.revision !== undefined &&
          (!Number.isSafeInteger(value.revision) || value.revision < 1)))
      throw Error('Expected a look asset ID and optional positive pack revision');
    const entry = catalog?.getLook(value.asset);
    if (!entry) throw Error('Unknown look asset: ' + value.asset);
    const { look, revision } = entry;
    if (value.revision !== undefined && revision !== value.revision)
      throw Error('Look asset ' + value.asset + ' requires pack revision ' + value.revision + ', installed ' + revision);
    const { strength = 1, params = {}, palette, stage = look.stage, paletteStage = look.paletteStage, order = look.order, weight = look.weight, inputs } = value;
    RenderStages.blend({ order, weight });
    if (stage !== undefined) RenderStages.stage(stage);
    if (paletteStage !== undefined) RenderStages.stage(paletteStage);
    if (!fraction(strength) || !record(params) || (palette !== undefined && palette !== false && !Array.isArray(palette)))
      throw Error('Look overrides need strength in [0, 1], a palette swatch list or false, and named parameters');
    if (look.lightingRamp && inputs !== undefined) throw Error('Material lighting ramp assets use static look parameters');
    for (const [name, item] of Object.entries(params)) {
      if (!Object.hasOwn(look.params, name)) throw Error('Unknown look parameter: ' + name);
      if (type(item) !== type(look.params[name])) throw Error('Look parameter ' + name + ' must be ' + type(look.params[name]));
    }
    const values = { ...look.params, ...clone(params) };
    if (inputs !== undefined) LookInputs.validate(inputs, values);
    const driver = inputs === undefined ? undefined : {
      inputs: clone(inputs), values, strength, stack: look.stack, palette: palette === false ? false : look.palette,
      ...(palette !== undefined && palette !== false && { swatches: clone(palette) }),
      mask: look.mask, maskOverride: value.mask === undefined ? undefined : clone(value.mask)
    };
    const stack = look.stack === undefined ? undefined : ColorStack.normalize(substitute(look.stack, values));
    const policy = palette !== false && (look.palette !== undefined || palette !== undefined)
      ? { ...substitute(look.palette, values), ...(palette !== undefined && { palette: clone(palette) }) } : undefined;
    const mask = value.mask === undefined ? substitute(look.mask, values) : clone(value.mask);
    const lightingRamp = substitute(look.lightingRamp, values);
    if (lightingRamp !== undefined) validateRamp(lightingRamp,look.id);
    SplatEffects.prepareMask(mask, undefined, { validateOnly: true });
    if ((stage === 'palette' || value.paletteStage !== undefined) && !policy) throw Error('A palette stage needs a look palette');
    return freeze({ id: look.id, revision, strength, ...(stage && { stage }), ...(policy && paletteStage && { paletteStage }), ...(driver && { driver }),
      ...(order !== undefined && { order }), ...(weight !== undefined && { weight }),
      ...(stack && { stack: { ...stack, amount: strength * (stack.amount ?? 1) } }),
      ...(policy && { palette: policy }), ...(lightingRamp && { lightingRamp }), ...(mask && { mask }) });
  }

  function override(base, changes) {
    if (changes === undefined) return base;
    if (typeof changes === 'string' || changes === false || base === undefined || base === false) return changes;
    if (!record(changes)) throw Error('Expected a look binding override');
    const prior = typeof base === 'string' ? { asset: base } : base;
    if (changes.asset !== undefined && changes.asset !== prior.asset) return changes;
    return { ...prior, ...changes, ...(changes.params !== undefined && record(changes.params) &&
      { params: { ...prior.params, ...changes.params } }),
      ...(record(changes.inputs) && { inputs: { ...prior.inputs, ...changes.inputs,
        ...(record(changes.inputs.params) && { params: { ...prior.inputs?.params, ...changes.inputs.params } }) } }) };
  }

  function stageRules(bound, select, fallback) {
    if (!active(bound)) return [];
    const { id, stack, palette, mask, order, weight, driver, paletteStage, stage = hasBlend(bound) || paletteStage ? 'lit' : fallback } = bound;
    if (stage === undefined) return [];
    const scope = { assetId: id, ...(driver && { driver }), ...(select && { select }), ...(mask && { mask }),
      ...(order !== undefined && { order }), ...(weight !== undefined && { weight }) };
    const rules = [];
    if (stage !== 'palette' && stack) rules.push({ ...scope, stage, stack });
    if (palette) rules.push({ ...scope, stage: paletteStage ?? 'palette', palette });
    return rules;
  }

  function ruleBinding(rule, catalog, requireSelector) {
    if (!fields(rule, stageRuleFields) || !Object.hasOwn(rule, 'asset'))
      throw Error('A look asset rule needs an asset and optional stage, selector, mask, order or weight');
    const { asset, select, ...changes } = rule;
    const selector = requireSelector || select !== undefined ? TargetSelectors.prepare(select) : undefined;
    RenderStages.blend(changes);
    if (changes.stage !== undefined) RenderStages.stage(changes.stage);
    return { target: bind(asset && override(asset, changes), catalog), select: selector };
  }

  function requireSceneLook(bound) {
    if (active(bound) && bound.lightingRamp && !bound.stack && !bound.palette)
      throw Error('Bind lighting ramp ' + bound.id + ' to a material lookAsset');
  }

  function opticalRules(entries, catalog) {
    if (!Array.isArray(entries)) return entries;
    return Array.from(entries).flatMap(rule => {
      if (!rule || !Object.hasOwn(rule, 'asset')) return [rule];
      if (!fields(rule, ['asset', 'select', 'order', 'weight']) || !rule.select)
        throw Error('An optical binding needs an asset and selector, and optional order or weight');
      const { target, select } = ruleBinding(rule, catalog, true);
      if (!active(target)) return [];
      requireSceneLook(target);
      const { id, mask, stack, palette, order, weight, driver } = target;
      if (mask) throw Error('Optical look coefficients need a uniform binding; set mask to false on the asset binding');
      return [{ select, assetId: id, ...(driver && { driver }), ...(stack && { stack }), ...(palette && { palette }),
        ...(order !== undefined && { order }), ...(weight !== undefined && { weight }) }];
    });
  }

  function scene(look, catalog) {
    if (!look) return look;
    const { asset, targets = [], renderStages, optics, ...inline } = look, bound = bind(asset, catalog);
    requireSceneLook(bound);
    if (renderStages !== undefined && renderStages !== false && !Array.isArray(renderStages))
      throw Error('Expected a list of render stage rules');
    const usesStages = Array.isArray(renderStages) && renderStages.some(rule => rule && Object.hasOwn(rule, 'asset'));
    const usesOptics = Array.isArray(optics) && optics.some(rule => rule && Object.hasOwn(rule, 'asset'));
    if (!usesStages && !usesOptics && !Object.hasOwn(look, 'asset') && !Object.hasOwn(look, 'targets')) return look;
    if (inline.paletteConstraints !== undefined && inline.paletteConstraints !== false && !record(inline.paletteConstraints))
      throw Error('Scene palette constraints must be an object or false');
    if (!Array.isArray(targets) || targets.length > 63) throw Error('Expected up to 63 look targets');
    const rules = [], boundStages = stageRules(bound);
    const staged = Array.from(renderStages || []).flatMap(rule => {
      if (!rule || !Object.hasOwn(rule, 'asset')) return [rule];
      const { target, select } = ruleBinding(rule, catalog, false);
      requireSceneLook(target);
      return stageRules(target, select, 'lit');
    }).concat(boundStages);
    for (const rule of targets) {
      const { target, select } = ruleBinding(rule, catalog, true);
      requireSceneLook(target);
      if (target?.stage || target?.paletteStage || hasBlend(target)) staged.push(...stageRules(target, select));
      else if (target?.strength && (target.stack || target.palette))
        rules.push({ ...target.palette, select, stack: target.stack, assetId: target.id, ...(target.mask && { mask: target.mask }) });
    }
    const constraints = inline.paletteConstraints;
    const fallback = bound?.strength && !boundStages.length && (bound.palette || bound.mask) && !Object.hasOwn(constraints || {}, 'default')
      ? { default: bound.mask ? { ...bound.palette, stack: bound.stack, mask: bound.mask, assetId: bound.id } :
        { ...bound.palette, ...(bound.stack && { source: 'graded' }), assetId: bound.id } } : {};
    return {
      ...(bound?.strength && bound.stack && !boundStages.length && !bound.mask && {
        colorStack: bound.stack, ...(inline.colorStack === undefined && { colorStackAssetId: bound.id })
      }),
      ...inline,
      ...(optics !== undefined && { optics: opticalRules(optics, catalog) }),
      ...((staged.length || renderStages !== undefined) && { renderStages: renderStages === false && !staged.length ? false : staged }),
      ...(constraints !== false && (rules.length || fallback.default) && {
        paletteConstraints: { ...constraints, ...fallback, ...(rules.length && { targets: [...(constraints?.targets ?? []), ...rules] }) }
      })
    };
  }

  function material(base, binding, catalog) {
    const bound = bind(binding, catalog);
    if (!active(bound)) return base;
    const staged = stageRules(bound);
    const lighting = bound.lightingRamp && {lookAssetRamp:{
      type:'diffuse', strength:bound.strength, lightingRamp:bound.lightingRamp, ...(bound.mask && {mask:bound.mask})
    }};
    if (staged.length) return SurfaceLook.material(base, {
      lookAssetId: bound.id,
      ...(lighting && {layers:lighting}),
      renderStages: [...(base?.surface?.renderStages || []), ...staged]
    });
    return SurfaceLook.material(base, {
      lookAssetId: bound.id,
      ...((lighting || bound.stack && !bound.mask) && { layers: { ...lighting,
        ...(bound.stack && !bound.mask && { lookAsset: { type: 'colorStack', stack: bound.stack } })
      } }),
      ...(bound.mask && (bound.stack || bound.palette) ? { paletteConstraint: { ...bound.palette, ...(bound.stack && { stack: bound.stack }), mask: bound.mask } } :
        bound.palette && { paletteConstraint: bound.palette })
    });
  }

  function extractedPalette(value) {
    if (Array.isArray(value)) return value;
    if (!fields(value, ['reference','indices']) || !['rgb','indexed'].includes(value.reference?.source) ||
        !Array.isArray(value.reference.swatches)) throw Error('Use explicit swatches or a palette extraction report');
    const rows = value.reference.swatches;
    const indices = value.indices ?? rows.flatMap((row,i)=>(row?.includedPixels ?? row?.pixels)>0 ? [i] : []);
    if (!Array.isArray(indices) || !Array.from(indices).every(i=>Number.isSafeInteger(i) && i>=0 && i<rows.length) ||
        new Set(indices).size !== indices.length) throw Error('Reference swatch indices must be distinct report indices');
    return indices.map(i=>rows[i].color);
  }

  function approvedRamp(value) {
    if (fields(value,['approved','role']) && Object.hasOwn(value,'approved')) {
      const { approved, role } = value;
      const settings = typeof role === 'string' && approved?.ramps && Object.hasOwn(approved.ramps,role) && approved.ramps[role];
      const indices = settings && approved.roles?.[settings.role];
      if (!Array.isArray(approved?.palette) || !Array.isArray(indices) || !Array.isArray(settings.positions) ||
          settings.positions.length !== indices.length ||
          !Array.from(indices).every(i=>Number.isSafeInteger(i) && i>=0 && i<approved.palette.length))
        throw Error('Choose a named lighting ramp from approved lighting roles');
      const stops = indices.map((index,i)=>{
        const color = approved.palette[index];
        return [settings.positions[i], Number.isSafeInteger(color) && color>=0 && color<=0xffffff ?
          '#'+color.toString(16).padStart(6,'0') : color];
      });
      return {stops,...(settings.interpolation !== undefined && {interpolation:settings.interpolation})};
    }
    if (fields(value,['review','interpolation']) && Object.hasOwn(value,'review')) {
      if (!Array.isArray(value.review?.stops)) throw Error('Expected an authored ramp review');
      return {stops:Array.from(value.review.stops,row=>[row?.position,row?.color]),
        ...(value.interpolation !== undefined && {interpolation:value.interpolation})};
    }
    return value;
  }

  function approvedDither(value) {
    if (!record(value)) throw Error('Dither findings need authored dither settings');
    const { review, approved, ...dither } = value;
    if (review === undefined && approved === undefined)
      return { ...(dither.pairs && {strength:1}), ...dither };
    if (dither.pairs !== undefined || !Array.isArray(review?.pairs) || !Array.isArray(approved) || !approved.length)
      throw Error('Choose reviewed dither pairs by explicit index');
    const used = new Set();
    const pairs = Array.from(approved).flatMap(choice=>{
      const row = Number.isSafeInteger(choice) ? {index:choice} : choice;
      if (!fields(row,['index','lightness']) || !Number.isSafeInteger(row.index) || row.index<0 || used.has(row.index))
        throw Error('Approved dither pair indices must be distinct');
      const pair = review.pairs.find(entry=>entry?.index===row.index);
      if (pair?.status !== 'reviewed' || !Array.isArray(pair.colors)) throw Error('Choose a measured dither pair to approve');
      used.add(row.index);
      const ranges = row.lightness !== undefined ? [row.lightness] : pair.lightnessRanges ?? [null];
      if (!Array.isArray(ranges) || !ranges.length) throw Error('Expected reviewed dither lightness ranges');
      return (ranges.includes(null) ? [null] : ranges).map(lightness=>
        ({colors:pair.colors,...(lightness !== null && {lightness})}));
    });
    return {pattern:review.pattern,...(review.seed !== undefined && {seed:review.seed}),
      ...(review.scale !== undefined && review.scale !== 1 && {scale:review.scale}),strength:1,...dither,pairs};
  }

  function paletteFinding(value, previous) {
    if (!fields(value,['id','label','ramp','palette','reserved','dither','match']) ||
        typeof value.id !== 'string' || !assetId.test(value.id) ||
        !['ramp','palette','reserved','dither','match'].some(key=>value[key] !== undefined))
      throw Error('A palette finding needs a namespaced ID and approved ramp or palette settings');
    const { id, label = previous?.label, ramp, palette, reserved, dither, match } = value;
    const next = { ...previous, id, label };
    if (ramp !== undefined) next.lightingRamp = approvedRamp(ramp);
    if ([palette,reserved,dither,match].some(value=>value !== undefined)) {
      const policy = { ...previous?.palette,
        ...(palette !== undefined && {palette:extractedPalette(palette)}),
        ...(reserved !== undefined && {reserved}),
        ...(dither !== undefined && {dither:approvedDither(dither)}),
        ...(match !== undefined && {match}) };
      const resolved = substitute(policy, previous?.params ?? {});
      if (resolved.palette !== undefined && (!Array.isArray(resolved.palette) || !resolved.palette.length))
        throw Error('An approved palette needs at least one swatch');
      if (resolved.dither?.pairs?.length && !resolved.palette)
        throw Error('Save dither pairs with the palette they can mix');
      const reservedColors = PixelLook.reserveEntries(resolved.reserved ?? []).map(row=>row.color);
      if (![...resolved.palette ?? [],...reservedColors].every(swatch))
        throw Error('Approved palettes and accents use concrete hex swatches or RGB triples');
      const packed = new Set(reservedColors.map(value=>typeof value === 'string' ? parseInt(value.slice(1),16) :
        value.reduce((color,n)=>color*256+Math.round(n*255),0)));
      let fallback = 0;
      while (packed.has(fallback)) fallback++;
      PixelLook.preparePalette({ palette:['#'+fallback.toString(16).padStart(6,'0')],...resolved },
        {blueNoise:K.procedural.materials.blueNoise,validateOnly:true});
      next.palette = policy;
    }
    return definition(clone(next),id.split('/')[0]);
  }

  A.looks = Object.freeze({ definition, bind, override, scene, material, paletteFinding });
})(KIT);
