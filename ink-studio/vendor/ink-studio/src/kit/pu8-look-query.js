/* Query the same palette plan used by the renderers without rendering a viewport. */
(function (K) {
  const W = K.world, { check } = W.data;
  const rgb = packed => [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
  const hex = packed => '#' + packed.toString(16).padStart(6, '0');
  const artPixel = pixel => Array.isArray(pixel) && pixel.length === 2 && pixel.every(Number.isSafeInteger);
  const active = value => value !== undefined && value !== false;
  W.lookQuery = function (visual, time = 0) {
    let world, index, media, plan, stages, optics, lookInputs;
    const blueNoise = K.procedural.materials.blueNoise, surfacePalettes = new Map(), surfaces = new Map();
    function setup() {
      if (world) return;
      world = visual();
      index = TargetSelectors.index(world);
      media = TargetSelectors.media(world);
    }
    function context() {
      lookInputs ??= LookInputs.session(world.lookSnapshot?.time ?? time, () =>
        world.lookSnapshot?.query ?? world.surfaceEffects?.query ?? W.query.fromScene(world, time));
      return { palette: world.pal, roles: world.paletteRoles, blueNoise, context: world.surfaceEffects, lookInputs };
    }
    function paletteSample(coverageAware) {
      const options = context(), look = world.look ?? {};
      plan ??= PixelLook.preparePaletteConstraints(look.paletteConstraints, options) ?? false;
      const { paletteRemap, colorCurves, colorLut, colorStack, tone } = look;
      const tonePlan = coverageAware ? null : PixelLook.prepareTone(tone, blueNoise);
      const scene = Array.from(world.pal, rgb), grade = !tonePlan &&
        (PixelLook.colorGrade(world.pal, world.paletteRoles, world.anim?.grade, paletteRemap, colorCurves, colorLut, colorStack) ||
        world.anim?.grade);
      const palette = tonePlan?.palette ?? (grade ? PixelLook.gradePalette(grade) : world.pal);
      function global(input, pixel) {
        return palette[tonePlan ? PixelLook.toneIndex(tonePlan, ...input, ...pixel) : PixelLook.nearest(input, scene, false)];
      }
      function sceneLooks(applied) {
        return (tonePlan ? [['tone', tone]] : [['colorCurves', colorCurves], ['colorLut', colorLut],
          ['colorStack', colorStack], ['paletteRemap', paletteRemap]]).filter(([, value]) => active(value))
          .map(([kind, value]) => ({ stage: 'palette', kind, asset: kind === 'colorStack' ? look.colorStackAssetId ?? null : null,
            ...(value?.name && { stack: value.name }), maskWeight: 1, applied }));
      }
      return function resolve({ target, first }, input, sample, pixel, base, projected) {
        const id = plan && plan.match(target), rule = id && plan.rules.find(rule => rule.slot === id);
        const binding = first === undefined ? undefined : world.surfaceData?.[first * SurfaceLook.STRIDE];
        const surface = world.surfaces?.[binding - 1]?.settings;
        if (surface?.paletteConstraint && !surfacePalettes.has(binding))
          surfacePalettes.set(binding, PixelLook.prepareLookPolicy(surface.paletteConstraint, { ...options,
            roles: PixelLook.bindRoles(options.palette, options.roles, surface.paletteRoles) }));
        const underlying = surfacePalettes.get(binding), fallback = plan && plan.palettes[plan.defaultSlot - 1];
        const policy = id ? plan.palettes[id - 1] : target.kind === 'splat' && !projected && (underlying || fallback);
        const useDither = target.kind === 'splat';
        const packedFor = local => local.packed[PixelLook.paletteIndex(local, input, ...pixel, { scene, grade, useDither, placement: { pixel, sample } })];
        const rowPalette = policy ? policy.packed : projected ? projected.map(color => pack(color)) :
          !coverageAware && target.kind === 'splat' ? palette : null;
        let packed = input && (policy ? packedFor(policy) : projected ? rowPalette[PixelLook.nearest(input, projected, false)] :
          rowPalette && global(input, pixel));
        const selectedSwatch = Number.isInteger(packed) ? hex(packed) : null;
        let sampled = input && (packed == null || packed === false ? input.slice() : rgb(packed));
        const spatial = policy?.mask;
        const amount = spatial && sample ? spatial(sample) : null;
        let dryPolicy, dryGlobal = false;
        if (sampled && spatial && (coverageAware || amount !== null)) {
          const under = underlying && !underlying.mask ? underlying : fallback;
          const dryPacked = under && !under.mask ? packedFor(under) : coverageAware ? null : global(input, pixel);
          const dry = base ?? (dryPacked == null ? input : rgb(dryPacked)), weight = amount ?? 0;
          if (!base && weight < 1) {
            dryPolicy = under && !under.mask ? under : null;
            dryGlobal = !dryPolicy && dryPacked != null;
          }
          sampled = sampled.map((color, i) => dry[i] * (1 - weight) + color * weight);
          if (weight !== 1) packed = weight === 0 && !base ? dryPacked : null;
        }
        const describe = (kind, local, select) => ({ stage: 'palette', kind, select: select ?? null,
          asset: local.assetId ?? null, ...(local.stackName && { stack: local.stackName }),
          ...(local.matchId && { match: local.match }),
          maskWeight: local.mask ? sample ? local === policy ? amount : local.mask(sample) : null : 1,
          ...(local === policy && selectedSwatch && { selectedSwatch }),
          applied: local === dryPolicy || local === policy && Boolean(input && (!local.mask || amount > 0)) });
        const usesSceneGrade = local => local?.source === 'graded' && !local.grade;
        const looks = sceneLooks(Boolean(input && (dryGlobal || !policy && !projected && !coverageAware ||
          usesSceneGrade(dryPolicy) || usesSceneGrade(policy) && (!spatial || amount > 0))));
        if (fallback && target.kind === 'splat') looks.push(describe('scene-palette', fallback));
        if (underlying) looks.push(describe('surface-palette', underlying));
        for (const entry of plan?.rules ?? []) if (TargetSelectors.matches(entry.select, target))
          looks.push(describe('target-palette', plan.palettes[entry.slot - 1], entry.select));
        const asset = policy?.assetId ?? (id ? null : surface?.lookAssetId ?? null);
        return { asset, rule: rule?.select ?? null, palette: rowPalette && Array.from(rowPalette), looks,
          ...(spatial && { maskWeight: amount }), ...(sampled && { rgb: sampled, swatch: Number.isInteger(packed) ? hex(packed) : null }) };
      };
    }
    const pack = color => color.reduce((n, value) => n * 256 + Math.round(Math.max(0, Math.min(1, value)) * 255), 0);
    function groups(selector) {
      setup();
      return index.groups(selector).concat(media.filter(row => !selector || TargetSelectors.matches(selector, row))
        .map(target => ({ target, count: 1 })));
    }
    function select(spec) {
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      return K.procedural.data.freeze(groups(selector).map(({ target, count }) => ({ ...target, count })));
    }
    function provenance(spec, { limit = 256 } = {}) {
      check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 4096, 'Expected a bounded provenance result limit');
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      setup();
      const rows = index.groups(selector);
      if (!rows.length) return W.query.missing('no splat provenance matches the selector', 'missing');
      return W.query.ok({ matched: rows.length, targets: rows.slice(0, limit).map(({ target, count }) => ({
        ...target, count, surfaceId: target.surface ?? null, materialId: target.material ?? null
      })) });
    }
    function output(spec, args = {}) {
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      const { rgb: input, at, rest, base, stage, pixel = [0, 0], limit = 256 } = args;
      if (stage !== undefined && stage !== 'optics') RenderStages.stage(stage);
      check(input === undefined || Array.isArray(input) && input.length === 3 && input.every(n => Number.isFinite(n) && n >= 0 && n <= 1),
        'A look sample needs normalized RGB');
      check((at === undefined || W.data.vector(at)) && (rest === undefined || W.data.vector(rest)),
        'A look mask sample needs a finite world point or rest point');
      check(base === undefined || W.data.vector(base) && base.every(n => n >= 0 && n <= 1), 'A look sample base needs normalized RGB');
      check(artPixel(pixel) &&
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 4096, 'Expected an integer art pixel and a bounded result limit');
      const selected = groups(selector);
      if (!selected.length) return W.query.missing('no render target matches the selector','missing');
      const options = context();
      if (stage === 'optics') {
        optics ??= RenderStages.optics(world.look?.optics, options) ?? false;
        return W.query.ok({ matched: selected.length, targets: selected.slice(0, limit).map(({ target, count }) => {
          const rules = optics ? optics.matching(target) : [];
          const transform = rules.length && optics.transform(target);
          return { target, count, material: target.material ?? null, optics: rules.map(rule => RenderStages.describe(rule)),
            ...(input && { input, rgb: transform ? transform(input) : input.slice(), swatch: null }) };
        }) });
      }
      stages ??= RenderStages.plan(world, options) ?? false;
      if (stages) {
        const sample = at || rest ? { position: rest, worldPosition: at, time } : null;
        const rows = selected.slice(0, limit).map(({ target, count, first }) => {
          const rules = first === undefined ? {} : stages.at(first);
          const evaluated = stage && input ? RenderStages.trace(rules[stage], input, sample, pixel) : null;
          const stagesForTarget = Object.fromEntries(RenderStages.names.filter(name => rules[name]).map(name =>
            [name, evaluated && stage === name ? evaluated.contributions : rules[name].map(rule => RenderStages.describe(rule, sample))]));
          const swatch = evaluated?.contributions.filter(rule=>rule.applied).at(-1)?.palette ? hex(pack(evaluated.rgb)) : null;
          return { target, count, material: target.material ?? null, stages: stagesForTarget,
            ...(evaluated && { input, rgb: evaluated.rgb, swatch }) };
        });
        return W.query.ok({ matched: selected.length, targets: rows });
      }
      const resolve = paletteSample(world.look?.coverageAware === true);
      const sample = at || rest ? { position: rest, worldPosition: at, time } : null;
      const rows = selected.slice(0, limit).map(group => ({ target: group.target, count: group.count,
        material: group.target.material ?? null, ...(input && { input }), ...resolve(group, input, sample, pixel, base) }));
      return W.query.ok({ matched: selected.length, targets: rows });
    }
    function sample(spec, args = {}) {
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      const { at, radius = Infinity, splat, pixel = [0, 0] } = args;
      check(at === undefined || W.data.vector(at), 'A scene look sample needs a finite XYZ point');
      check((args.radius === undefined || Number.isFinite(radius) && radius >= 0 && at) && artPixel(pixel),
        'A scene look sample needs integer art pixels and a nonnegative radius around a point');
      check(splat === undefined || Number.isSafeInteger(splat) && splat >= 0, 'Expected a nonnegative splat index');
      setup();
      let picked, distance = radius;
      const { data, count } = world;
      const end = Math.min(splat === undefined ? count : splat + 1, count);
      for (let i = splat ?? 0; i < end; i++) {
        const q = i * 16;
        if (!(data[q + 3] > 0)) continue;
        const target = index.row(i);
        if (selector && !TargetSelectors.matches(selector, target)) continue;
        const d = at ? Math.hypot(at[0] - data[q], at[1] - data[q + 1], at[2] - data[q + 2]) : 0;
        if (d > distance || (picked && d === distance)) continue;
        picked = { target, first: i };
        distance = d;
        if (!d) break;
      }
      if (!picked) return W.query.missing('no live splat matches the sample location and selector', 'missing');
      const { target, first } = picked, q = first * 16, surfaceOffset = first * SurfaceLook.STRIDE;
      const packed = Math.round(data[q + 7]);
      const baked = [packed & 255, packed >> 8 & 255, packed >> 16 & 255].map(n => n / 255);
      const albedo = world.materialAlbedo?.[first];
      const worldPosition = Array.from(data.subarray(q, q + 3));
      const rest = world.rest ?? (world.anim?.base instanceof Float32Array ? world.anim.base : data);
      const position = Array.from(rest.subarray(q, q + 3));
      const normalOffset = first * 3, normals = world.renderMetadata?.normals;
      const surface = world.surfaceData, slot = surface?.[surfaceOffset];
      const normal = slot ? Array.from(surface.subarray(surfaceOffset + 1, surfaceOffset + 4)) :
        normals ? Array.from(normals.subarray(normalOffset, normalOffset + 3)) : null;
      const site = { position, worldPosition, normal, time: world.lookSnapshot?.time ?? time };
      const options = context(), look = world.look ?? {};
      stages ??= RenderStages.plan(world, options) ?? false;
      optics ??= RenderStages.optics(look.optics, options) ?? false;
      const rules = stages ? stages.at(first) : {};
      const coverageAware = look.coverageAware ?? Boolean(optics || world.reflections?.length &&
        (look.paletteConstraints?.targets?.length || world.surfaces?.some(({ settings }) => settings.paletteConstraint)));
      const looks = [];
      let color = baked, swatch = null, projected;
      const material = [], paintedAlbedo = rules.material && slot ? [] : undefined;
      if (rules.material) {
        color = RenderStages.material(rules.material, color, albedo ? albedo - 1 : undefined, site, material, undefined, paintedAlbedo);
        looks.push(...material.map(rule => ({ stage: 'material', maskWeight: 1, ...rule })));
      }
      if (slot) {
        const { settings, light } = world.surfaces[slot - 1];
        if (!surfaces.has(slot)) {
          const liveLight = world.surfaceLight === undefined ? light : SurfaceLook.prepareLightTrack(world.surfaceLight)(site.time);
          surfaces.set(slot, SurfaceLook.prepare(settings, world.pal, liveLight, world.surfaceEffects, {
            paletteRoles: world.paletteRoles, blueNoise, paletteConstraints: false
          }));
        }
        const { target: center, yaw, pitch, dist } = world.cam ?? {};
        const view = center ? K.V.sub(K.V.add(center,
          [dist * Math.cos(pitch) * Math.sin(yaw), dist * Math.sin(pitch), dist * Math.cos(pitch) * Math.cos(yaw)]), worldPosition) : [0, 1, 0];
        const tangent = Array.from(surface.subarray(surfaceOffset + 5, surfaceOffset + 8));
        const layers = [], prepared = surfaces.get(slot);
        const reflectsScene = prepared.layers.some(layer =>
          layer.type === 'reflection' && (world.skyReflections ?? layer.source) === 'scene');
        const environment = reflectsScene && world.skyEnvironment && SkyEnvironment.compile(world.skyEnvironment).frame(site.time).sky;
        const celestial = reflectsScene && CelestialTracks.settings(world.celestialTracks)?.frame(site.time);
        const sky = reflectsScene && SkyEnvironment.withCelestials(environment, celestial, celestial && [
          (world.pal[0] >> 16 & 255) / 255, (world.pal[0] >> 8 & 255) / 255, (world.pal[0] & 255) / 255
        ]);
        const shaded = SurfaceLook.shade(prepared, { ...site, normal, view, ...(tangent.some(Boolean) && { tangent }),
          ...(sky && { sky: (direction, output) => SkyEnvironment.shade(sky, direction, output), skyReflectionSource: world.skyReflections }),
          albedo: paintedAlbedo ?? (albedo ? RenderStages.unpack(albedo-1) : undefined),
          depth: Math.hypot(...view),
          visibility: surface[surfaceOffset + 4] }, color, [0, 0, 0, 1, 0, undefined], layers);
        color = shaded.slice(0, 3);
        projected = shaded[5];
        looks.push(...layers.map(rule => ({ stage: 'lit', ...rule,
          asset: rule.layer === 'lookAsset' ? settings.lookAssetId ?? null : null })));
      }
      if (coverageAware || !stages && !optics) {
        const result = paletteSample(coverageAware)(picked, color, site, pixel, undefined, projected);
        looks.push(...result.looks);
        color = result.rgb;
        swatch = result.swatch;
      }
      function applyStage(stage, entries, coordinates = pixel) {
        if (!entries?.length) return;
        const trace = RenderStages.trace(entries, color, site, coordinates);
        looks.push(...trace.contributions.map(rule => ({ stage, maskWeight: 1, ...rule })));
        const final = stage === 'optics' ? trace.rgb.map(n => Math.max(0, Math.min(1, n))) : trace.rgb;
        if (trace.contributions.filter(rule=>rule.applied).at(-1)?.palette) swatch = hex(pack(final));
        else if (final.some((value, i) => value !== color[i])) swatch = null;
        color = final;
      }
      applyStage('lit', rules.lit, null);
      if (optics && TargetSelectors.isGlass(world, first)) applyStage('optics', optics.matching(target), null);
      applyStage('frame', rules.frame);
      applyStage('palette', rules.palette);
      return W.query.ok({ kind: 'splat', splat: first, time: site.time, target, material: target.material ?? null,
        surface: target.surface ?? null, position: worldPosition, rest: position, ...(at && { distance }), pixel,
        input: baked, ...(albedo && { albedo: rgb(albedo - 1) }), looks, rgb: color, swatch });
    }
    function inspect(options, query) {
      setup();
      return W.lookReport.scene(world, index, media, query, time, options);
    }
    return { select, output, provenance, inspect, sample };
  };
})(KIT);
