const { performance } = require('node:perf_hooks');
const frameBudget = require('../src/frame-budget.js');
const PassQuality = require('../src/pass-quality.js');
// Draws a world without a browser: motion kinds, projection of each splat's covariance to a screen ellipse,
// blending from far to near, low-resolution sampling, dithering and palette quantization.
const FOV = (38 * Math.PI) / 180;
const PixelLook = require('../src/pixel-look.js');
const RenderStages = require('../src/render-stages.js');
const LookInputs = require('../src/look-inputs.js');
const TargetSelectors = require('../src/target-selectors.js');
const { createArtPasses, sampleFrames, selectVisibleSubjects } = require('./art-passes.js');
const ArtPasses = require('../src/art-passes.js');
const { createEnvironmentPasses } = require('./environment-passes.js');
const ArtInk = require('../src/art-ink.js');
const ArtDirection = require('../src/art-direction.js');
const SilhouetteProtection = require('../src/silhouette-protection.js');
const SubjectFocus = require('./subject-focus.js');
const DetailBudgets = require('../src/detail-budgets.js');
const ShadowArt = require('../src/shadow-art.js');
const ContactShadows = require('../src/contact-shadows.js');
const ContactDepth = require('./contact-shadows.js');
const RenderGraph = require('../src/render-graph.js');
const runGraph = require('./render-graph.js');
const FrameComposite = require('../src/frame-composite.js');
const CameraStaging = require('../src/camera-staging.js');
const CameraLens = require('../src/camera-lens.js');
const RenderContract = require('../src/render-contract.js');
const CameraImpulses = require('../src/camera-impulses.js');
const SplatOrder = require('../src/splat-order.js');
const Cutaway = require('../src/cutaway.js');
const { blendLayers } = require('./translucent-layers.js');
const OpticalMaterials = require('../src/optical-materials.js');
const SplatRelighting = require('../src/splat-relighting.js');
const MaterialPixelStyle = require('../src/material-pixel-style.js');
const EffectPalettes = require('../src/effect-palettes.js');
const ArtEffects = require('../src/art-effects.js');
const ArtStability = require('../src/art-stability.js');
const { ditherFootprint } = require('./dither-footprint.js');
const StableDetail = require('../src/stable-detail.js');
const EdgeFilter = require('../src/edge-filter.js');
const SdfAssist = require('../src/sdf-assist.js');
const SdfRaster = require('./sdf-assist.js');
const { footprint, exportOffsets, sampledDepth } = require('./splat-sampling.js');
const { createMaskResolve, applyMasks } = require('./look-mask-resolve.js');
const PalettePixel = require('./palette-pixel.js');
const PaletteComposition = require('./palette-composition.js');
const PaletteUsage = require('./palette-usage.js');
const { createLookPass } = require('./look-pass.js');
const { createAudit } = require('./render-audit.js');
const { contributionLook, contributionLayers } = require('./look-contributions.js');
const blueNoiseTiles = new WeakMap();
function blueNoise(world, { seed }) {
  if (!blueNoiseTiles.has(world)) blueNoiseTiles.set(world, new Map());
  const tiles = blueNoiseTiles.get(world);
  if (!tiles.has(seed)) {
    const { KIT } = require('../index.js').load();
    if (tiles.size >= 65) tiles.delete(tiles.keys().next().value);
    tiles.set(seed, KIT.procedural.materials.blueNoise({ seed }));
  }
  return tiles.get(seed);
}
const SampleCoverage = require('../src/sample-coverage.js');
const ContributionRules = require('../src/contribution-rules.js');
const Airflow = require('../src/airflow.js');
const LightSchedule = require('../src/light-schedule.js');
const LiveSun = require('./live-sun.js');
const ProbeLighting = require('./bounce-probes.js');
const AreaLights = require('../src/area-lights.js');
const EmissiveFinishes = require('../src/emissive-finishes.js');
const AreaRaster = require('./area-lights.js');
const surfaceShading = require('./surface-shading.js');
const SceneOptics = require('../src/scene-optics.js');
const AtmosphereDepthBands = require('../src/atmosphere-depth-bands.js');
const SkyEnvironment = require('../src/sky-environment.js');
const HorizonBands = require('../src/horizon-bands.js');
const CloudField = require('../src/cloud-field.js');
const Lightning = require('../src/lightning.js');
const { resolveEnvironment, resolveWind, resolveLighting, atmosphereSources } = require('./environment.js');
const WindField = require('../src/wind-field.js');
const Precipitation = require('./precipitation.js');
const RainImpacts = require('./rain-impacts.js');
const AtlasSprites = require('../src/atlas-sprites.js');
const AtlasRaster = require('./atlas-sprites.js');
const SurfaceRaster = require('./sprite-surfaces.js');
let SplatFields, AtmosphereEmitters;
const ReflectionProbes = require('../src/reflection-probes.js');
const { cameraRays, surfacePoint, reflectionSampler, atmosphereQuality, mediaSampler, applyAtmosphere } = require('./scene-optics.js');
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x),
  sstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
function viewMatrix(yaw, pitch, dist, T) {
  return CameraLens.matrix(CameraLens.orbitPose(yaw, pitch, dist, T));
}
// o: t (seconds), yaw, pitch, dist, target, w, h (the size of the stage in screen pixels), zoom (1 = the diorama's own distance), raw (skip the palette)
const edgeCoverageThreshold = .03;
const afterimageRows = Symbol('afterimage rows');
const reconstructionSource = Symbol('reconstruction source');
const captureCamera = Symbol('rendered camera');
const sampledPresentation = Symbol('sampled presentation');
const scopedGlowPass = Symbol('emissive glow pass');
const subjectFocusPass = Symbol('subject focus pass');
const probeCamera = Symbol('reflection probe camera');
const probeCaptures = Symbol('reflection probe captures');

function cameraCapture(options, receive) {
  return { [captureCamera](camera) {
    receive(camera);
    options?.[captureCamera]?.(camera);
  } };
}

function render(world, o, preparedPalettes) {
  o = RenderContract.options(world, o, (w, frame) => require('../index.js').load().KIT.timeDomains.frame(w, frame));
  if (o.strictContract) RenderContract.requirePortable(world, o);
  if (o?.cameraGuides && !o.samples && !o.captureCoverage) {
    const staging = o.cameraStaging ?? world.look?.cameraStaging;
    return CameraStaging.overlay(render(world, { ...o, cameraGuides: false, cameraStaging: staging || true }, preparedPalettes));
  }
  const reconstruction = o?.reconstruction ?? world.look?.reconstruction;
  if (reconstruction !== undefined && reconstruction !== false && !o?.[reconstructionSource]) {
    const source = world, time = o?.t ?? world.lookSnapshot?.time ?? 0;
    world = require('../index.js').load().KIT.reconstruction.frame(world, time, reconstruction);
    o = { ...o, [reconstructionSource]: source };
  }
  if (world.reflectionProbes?.length && o?.surface !== false && o?.reflections !== false &&
      o?.reflectionProbes !== false && !o?.[probeCaptures])
    o = { ...o, [probeCaptures]: new Map() };
  if (o?.afterimageHistory && !o[afterimageRows] && !o.samples && !o.captureCoverage) {
    const definition = o.afterimages ?? world.look?.afterimages;
    if (o.resetAfterimages || definition === false || definition === undefined) o.afterimageHistory.clear();
    if (definition !== false && definition !== undefined) {
      const rules = require('../index.js').load().KIT.afterimages.prepare(definition);
      const time = o.t ?? world.lookSnapshot?.time ?? 0;
      const direction = ArtDirection.prepare(world.look?.artDirection, o.artDirection);
      o = { ...o, [afterimageRows]: o.afterimageHistory.frame(world, time, rules, {
        source: o[reconstructionSource] ?? world, poseTime: ArtDirection.time(direction, time), withdrawal: o.sampleWithdrawal ?? world.sampleWithdrawal ?? 0
      }) };
    }
  }
  if (!o?.[sampledPresentation] && world.timeline && !o?.samples && !o?.captureCoverage) {
    const time = o?.t ?? world.lookSnapshot?.time ?? 0;
    const presentation = require('../index.js').load().KIT.presentationTimeline.sample(world, o?.interfaceTime ?? time, o);
    o = { ...o, ...presentation, [sampledPresentation]: true };
  }
  const inspection = o?.inspection ?? world.look?.inspection;
  if (inspection !== undefined && inspection !== false && !o?.samples && !o?.captureCoverage) {
    const start = o?.renderStats ? performance.now() : 0;
    const api = require('../index.js').load().KIT.inspection, settings = api.prepare(inspection);
    const requested = ArtPasses.select(o?.passes); let camera;
    const base = render(world, { ...o, inspection: false, passes: [...new Set([...requested, 'depth'])],
      ...cameraCapture(o, view => { camera = view; }) }, preparedPalettes);
    const plan = api.plan(settings, { world, time: o?.interfaceTime ?? o?.t ?? world.lookSnapshot?.time ?? 0,
      sceneTime: o?.t ?? world.lookSnapshot?.time ?? 0,
      width: base.w, height: base.h, camera, focus: o?.inspectionFocus });
    const passes = base.passes, range = camera.depthRange;
    const depthAt = (u,v) => {
      const x = Math.min(passes.w - 1, Math.floor(u * passes.w)), y = Math.min(passes.h - 1, Math.floor(v * passes.h));
      return (passes.depth[y * passes.w + x] - range[0]) / (range[1] - range[0]);
    };
    const result = api.compose(base, plan, settings, depthAt);
    if (requested.length) result.passes = ArtPasses.subset(passes, requested);
    else delete result.passes;
    if (result.renderStats) result.renderStats.frameMs = performance.now() - start;
    return result;
  }
  const graph = o?.samples || o?.captureCoverage ? null : RenderGraph.prepare(o?.renderGraph ?? world.look?.renderGraph);
  if (graph?.passes.length) {
    RenderGraph.resources(graph, o.w ?? o.width ?? 900, o.h ?? o.height ?? 620);
    const start = o?.renderStats ? performance.now() : 0;
    const requested = ArtPasses.select(o?.passes);
    const diagnostic = graph.needsOwner || graph.needsDepth;
    const passes = diagnostic ? [...new Set([...requested, ...(graph.needsOwner ? ['splatId'] : []),
      ...(graph.needsDepth ? ['depth'] : [])])] : o?.passes;
    let camera;
    const base = render(world, { ...o, renderGraph: false, renderHistory: undefined, passes,
      ...(graph.needsCamera && cameraCapture(o, view => { camera ??= view; })) }, preparedPalettes);
    const time = o?.interfaceTime ?? o?.t ?? world.lookSnapshot?.time ?? 0;
    const kit = require('../index.js').load().KIT;
    const frame = { ...base, ...runGraph(graph, base, world, time, kit.poly2.text, camera, (spec,ctx) => kit.annotations.anchor(spec,{ ...ctx,sceneTime:o?.t }), { ...o, renderHistoryKey: o?.renderHistoryKey ?? o?.[reconstructionSource] }) };
    if (base.passes && diagnostic) {
      if (requested.length) frame.passes = ArtPasses.subset(base.passes, requested);
      else delete frame.passes;
    }
    if (frame.renderStats) frame.renderStats.frameMs = performance.now() - start;
    return frame;
  }
  if (!o?.samples && !o?.captureCoverage) o?.renderHistory?.clear();
  const definition = o?.composite ?? world.look?.composite;
  if (definition !== undefined && definition !== false && !o?.samples && !o?.captureCoverage) {
    const start = o?.renderStats ? performance.now() : 0;
    const plan = FrameComposite.prepare(definition, o?.w || 900, o?.h || 620, o?.px ?? world.look?.pixelSize ?? 1);
    let camera;
    const api = require('../index.js').load().KIT.frameComposite;
    const time = o?.interfaceTime ?? o?.t ?? world.lookSnapshot?.time ?? 0;
    let layers = !plan.needsCamera && api.layers(plan, world, time, undefined, undefined, o?.t);
    const base = render(world, { ...o, composite: false, w: plan.world.w, h: plan.world.h, px: 1,
      ...(plan.needsCamera && cameraCapture(o, view => { camera ??= view; })) }, preparedPalettes);
    layers ||= api.layers(plan, world, time, camera, undefined, o?.t);
    const frame = { ...base, ...FrameComposite.compose(base, layers, plan.w, plan.h, plan.world.filter),
      px: 1, worldSize: [base.w, base.h] };
    if (frame.renderStats) frame.renderStats.frameMs = performance.now() - start;
    return frame;
  }
  if (!o?.renderStats) return renderFrame(world, o, preparedPalettes);
  const start = performance.now();
  const counters = {
    rasterPasses:0, reflectionProbeFaces:0, fragments:0, translucentFragments:0, peakDeferredFragments:0, deferredFlushes:0,
    planarCaptures:0, planarPixels:0, reflectionProbePixels:0, splatRows:0, omittedBackgroundRows:0, omittedParticleRows:0,
    volume:{ traces:0, boundsTests:0, boundsCacheHits:0, mediaQueries:0, mediaCacheHits:0, fullFogCacheHits:0, emptyFogIntervals:0, raySamples:0,
      analyticSegments:0, marchSteps:0, densitySamples:0, skipTests:0, skippedSteps:0, cloudTraces:0, cloudSamples:0 }
  };
  const frame = renderFrame(world, { ...o, renderStats:false, counters }, preparedPalettes);
  frame.renderStats = { ...counters, frameMs:performance.now()-start };
  return frame;
}

function renderFrame(world, o, preparedPalettes) {
  o = o || {};
  const counters = o.counters;
  if (counters) counters.rasterPasses++;
  const lensScale = o.lensScale ?? 1;
  if (!Number.isFinite(lensScale) || lensScale <= 0) throw new RangeError('Lens scale must be finite and positive');
  const look = world.look || {};
  const cutaway = Cutaway.prepare(o.cutaway ?? look.cutaway);
  const detailBudget = !o.raw && DetailBudgets.prepare(look.detailBudgets);
  const motion = RenderContract.clock(world, o), { direction, time: sceneTime, scene: t } = motion;
  const protection = SilhouetteProtection.prepare(look.silhouetteProtection,o.silhouetteProtection);
  const passQuality = PassQuality.prepare(o.passQuality ?? look.passQuality);
  const subject = protection?.bind(world);
  const viewStaging = o[probeCamera] ? null : CameraStaging.prepare(o.cameraStaging ?? look.cameraStaging);
  const framing = o.samples || o.captureCoverage || o.reflectionPlane ? null : viewStaging;
  const focusBands = o.depthOfField === false ? [] : framing?.depthOfField ?? [];
  const hasFocus = focusBands.some(band => band.radius > 0);
  const cw = o.w ?? o.width ?? 900, ch = o.h ?? o.height ?? 620;
  const camera = CameraLens.frame(world, o, cw, ch, { orbit: viewStaging?.orbit, impulse: CameraImpulses.frame, probe: !!o[probeCamera] });
  const { lens: { fov, sensorHeight }, tangent, ortho, dist, dist0, yaw, pitch, framed: T, base: c,
    setback: depthOffset, radius: R } = camera;
  const an = world.anim || {};
  const audit = o.lookAudit === true ? createAudit() : o.lookAudit;
  const onPaletteClip = audit && ((scope, i, r, g, b) => audit.palette(scope, world.pal[i], r, g, b));
  const transparent = !!o.transparent && !o.captureCoverage;
  const integrateFootprint = o.splatFilter === 'footprint';
  const edgeStrengthAt = !o.captureCoverage && EdgeFilter.prepare(o.edgeFilter ?? look.edgeFilter)?.bind(world);
  const stableDetail = StableDetail.prepare(o.stableDetail ?? look.stableDetail);
  const coverageMode = ContributionRules.coverageMode(o.splatCoverage ?? look.splatCoverage);
  const contactSettings = ContactShadows.prepare(o.contactShadows ?? look.contactShadows);
  const orderMode = o.splatOrder ?? look.splatOrder ?? 'center';
  const sdfSettings = SdfAssist.prepare(o.sdfAssist ?? look.sdfAssist);
  const areaLights = AreaLights.prepare(o.areaLights === true ? world.areaLights : o.areaLights ?? world.areaLights,{time:t});
  const probeView = o[probeCamera];
  const useSdf = sdfSettings && world.renderSdfs?.length && !o.reflectionPlane?.select && !probeView?.allow;
  const transparency = SplatOrder.transparency(o.stableTransparency ?? look.stableTransparency);
  const blendDepth = transparency?.mode === 'blend' ? transparency.depthTolerance : 0;
  const sortedSurfaces = orderMode === 'surface' || blendDepth > 0;
  const fragmentBudget = o.fragmentBudget ?? 500000;
  if (!['center', 'surface'].includes(orderMode) ||
      ((sortedSurfaces || useSdf || areaLights.length) && (!Number.isSafeInteger(fragmentBudget) || fragmentBudget < 1 || fragmentBudget > 2e6)))
    throw new RangeError('Invalid splat order or fragment budget');
  const probe = typeof o.fragmentProbe === 'function' ? o.fragmentProbe : null;
  const styled = !o.raw && !o.samples && !o.captureCoverage;
  const captureQuantization = styled && o.captureQuantization === true;
  const captureStages = styled && o.captureColorStages === true;
  const lookInputs = !o.raw && (o.lookInputSession ?? LookInputs.session(t, () =>
    world.lookSnapshot?.query ?? world.surfaceEffects?.query ?? require('../index.js').load().KIT.world.query.fromScene(world, t)));
  const lookOptions = { palette: world.pal, roles: world.paletteRoles, context: world.surfaceEffects, lookInputs,
    ditherSpaceOverride:o.ditherSpaceOverride,
    blueNoise: settings => blueNoise(world, settings), skipMasks: o.lookMasks === false };
  const stages = RenderContract.stagePlan(world, o, t, lookOptions);
  const optics = o.raw ? null : RenderStages.optics(look.optics, lookOptions);
  const useLocalReflections = o.surface !== false && o.reflections !== false && o.reflectionProbes !== false;
  const scopedReflection = (world.reflections?.length || (useLocalReflections && world.reflectionProbes?.length)) && (look.paletteConstraints?.targets?.length ||
    world.surfaces?.some(({ settings }) => settings.paletteConstraint));
  const coverageAware = !o.raw && (o.coverageAware ?? look.coverageAware ?? Boolean(optics || scopedReflection)) === true;
  const retainContributions = coverageAware || Boolean(stages || optics);
  const legacyLook = styled && !retainContributions;
  const effectPaletteSettings = styled ? EffectPalettes.prepare(
    o.effectPalettes === true ? look.effectPalettes : o.effectPalettes ?? look.effectPalettes, world.pal, world.paletteRoles
  ) : !o.raw && !o.captureCoverage ? o.effectPaletteCapture : null;
  const ink = styled ? ArtInk.prepare(o.ink ?? look.ink, world.pal) : null;
  const emissive = EmissiveFinishes.bind(EmissiveFinishes.prepare(
    o.emissiveFinishes ?? world.emissiveFinishes, world.pal), world);
  const effects = styled ? ArtEffects.prepare(o.artEffects ?? look.effects, world.pal) : null;
  const trackGlow = o[scopedGlowPass] || styled &&
    emissive?.profiles.some(profile => profile.glow?.strength || profile.glow !== undefined && effects?.halo);
  const stable = ArtStability.prepare(look.stable, o.stable, o.ditherSpaceOverride);
  const specializedResolve = legacyLook && stable && stable.resolve !== 'native';
  const anchoring = !o.raw && !o.captureCoverage && !!stable?.anchorSpaces.size;
  const paletteRules = legacyLook || coverageAware ? PixelLook.preparePaletteConstraints(o.paletteConstraints ?? look.paletteConstraints, {
    palette: world.pal, roles: world.paletteRoles, blueNoise: settings => blueNoise(world, settings),
    context: world.surfaceEffects, skipMasks: o.lookMasks === false, skipMaskedStacks: o.colorStack === false, onPaletteClip,
    ditherSpaceOverride:o.ditherSpaceOverride
  }) : preparedPalettes;
  const requestedPasses = ArtPasses.select(o.passes);
  const passSelection = new Set(requestedPasses);
  if (captureStages) passSelection.add('splatId');
  const readabilitySelectors = !o.samples && !o.captureCoverage && o.readabilitySelectors;
  if (readabilitySelectors) passSelection.add('splatId');
  const paletteDiagnostic = passSelection.has('paletteOwner');
  if (paletteDiagnostic && !o.raw) passSelection.add('materialId');
  let lookPass;
  if (framing?.subjects.length) passSelection.add('splatId');
  if (hasFocus) passSelection.add('depth');
  if (styled && stages?.owner) passSelection.add('splatId');
  if (styled && stages?.postMask) {
    for (const channel of ['position', 'objectPosition', 'normal']) passSelection.add(channel);
  }
  if (trackGlow) for (const channel of ['depth','emissionDepth']) passSelection.add(channel);
  if (effects) for (const channel of ArtEffects.channels) passSelection.add(channel);
  if (effects?.smear && o.artHistory) passSelection.add('emissionMotion');
  if (ink) for (const channel of ArtInk.channels) passSelection.add(channel);
  if (effectPaletteSettings) {
    for (const channel of ['coverage', 'depth']) passSelection.add(channel);
    if (effectPaletteSettings.ramps.has('emission')) passSelection.add('emission');
    if (effectPaletteSettings.objects.size) passSelection.add('objectId');
    if (effectPaletteSettings.materials.size) passSelection.add('materialId');
    if (effectPaletteSettings.ramps.has('bounce') || effectPaletteSettings.ramps.has('shadow'))
      for (const channel of ['normal','position','splatId']) passSelection.add(channel);
  }
  const anchorSpaces = new Set(anchoring ? stable.anchorSpaces : []);
  function addAnchorSpace(space) {
    if (space === 'world' || space === 'object') anchorSpaces.add(space);
  }
  let ditherRegions = styled && stages?.ditherRegions, ditherFade = styled && stages?.ditherFade;
  if (!o.raw && !o.captureCoverage) {
    if (styled) for (const space of stages?.anchorSpaces ?? []) addAnchorSpace(space);
    for (const policy of paletteRules?.palettes ?? []) {
      addAnchorSpace(policy.anchor?.dither);
      ditherRegions ||= policy.tuning?.regions.length > 0;
      ditherFade ||= Boolean(policy.tuning?.fade);
    }
    if (o.surface !== false && o.paletteConstraints !== false && (!stages || coverageAware)) {
      for (const { settings } of world.surfaces ?? []) {
        const tuning = settings.paletteConstraint?.dither;
        addAnchorSpace(tuning?.space);
        ditherRegions ||= o.lookMasks !== false && tuning?.regions?.length > 0;
        ditherFade ||= Boolean(tuning?.fade);
      }
    }
  }
  const spatialFade = ditherFade && anchorSpaces.size > 0;
  if (anchorSpaces.size || ditherRegions) {
    passSelection.add('depth');
    if (anchorSpaces.has('world') || ditherRegions || spatialFade) passSelection.add('position');
    if (anchorSpaces.has('object') || ditherRegions) passSelection.add('objectPosition');
    if (ditherRegions) passSelection.add('normal');
    if (anchoring && stable.rules.some(rule => rule.object !== undefined)) passSelection.add('objectId');
    if (anchoring && stable.rules.some(rule => rule.material !== undefined)) passSelection.add('materialId');
  }
  if (specializedResolve || (legacyLook && stable?.protect.size)) {
    for (const channel of ['objectId', 'materialId', 'emission', 'protected']) passSelection.add(channel);
  }
  const finishLook = (frame, passes, fog, effectSignals, source, paletteState, paletteInventory, beforePalette, paintStage) => {
    const legacyAlpha = captureStages && legacyLook ? frame.alpha?.slice() : undefined;
    function capture(graded, stage) {
      frame.quantization = { w:frame.w,h:frame.h,px:frame.px,stage,graded,resolved:frame.rgb.slice(),
        ...(frame.alpha && {alpha:frame.alpha.slice()}) };
    }
    if (captureQuantization && legacyLook) capture(beforePalette, 'legacy');
    if (ink) frame = ArtInk.apply(frame, passes, ink, world.pal, fog, { world, depthOffset, inspect:paletteTrace });
    if (effects) frame = ArtEffects.apply(frame, passes, effects, t, {
      history: o.artHistory, world: o[reconstructionSource] ?? world, palette: world.pal, motionReference: frame.motionReference,
      haloSource: passes.scopedEmission && (p => emissive.profiles[passes.scopedEmission.slots[p]-1]?.glow === undefined)
    });
    if (styled && trackGlow && passes.scopedEmission && emissive.profiles.some(profile => profile.glow?.strength)) {
      frame = ArtEffects.paletteUse(EmissiveFinishes.applyGlow(frame, passes, emissive.profiles), world.pal);
    }
    const ditherAt = anchoring ? (x,y) => ArtStability.ditherCoordinates(stable, passes, y*frame.w+x, x, y) : undefined;
    const basePalette = (paletteState || paletteInventory || o.captureScenePalette) &&
      (tone?.palette ?? evaluatedPalette ?? (!o.raw && grade ? PixelLook.gradePalette(grade) : world.pal));
    const ownership = paletteState?.capture?.view(frame,passes,{ ...paletteState,stable,time:t,
      base:basePalette,composited:retainContributions });
    if (effectSignals) {
      frame = EffectPalettes.apply(frame, passes, effectSignals, source, world.pal, o.captureEffectPalettes, ditherAt, ownership, paletteTrace);
      if (audit) for (const ramp of effectSignals.rules.ramps.values()) audit.addPalette(ramp.packed);
    }
    if (hasFocus) frame = CameraStaging.focus(frame, passes.depth, focusBands, depthOffset,
      styled && !stages && (!o.colored || !!tone));
    const litStage = captureStages ? legacyLook ? beforePalette : frame.rgb.slice() : undefined;
    const frameGrade = captureStages && stages?.post ? new Uint8Array(frame.rgb.length) : undefined;
    const graded = captureQuantization && !legacyLook && stages?.post ? new Uint8Array(frame.rgb.length) : undefined;
    if (styled && stages?.post) {
      const visit = ownership ? p => {
        const post = lookPass?.post(p);
        return (rule,mask,amount) => {
          if (rule.palette) ownership.stage(p,rule);
          post?.(rule,mask,amount);
        };
      } : lookPass?.post;
      RenderStages.finish(frame, stages, passes, t, visit, audit, ditherAt, stable, graded, paletteTrace, frameGrade);
      if (effectSignals) frame = ArtEffects.paletteUse(frame,world.pal);
    }
    if (captureQuantization && !legacyLook) capture(graded ?? frame.rgb.slice(), 'frame');
    if (captureStages) {
      const {w,h,alpha}=frame, base={w,h,rgb:new Uint8Array(w*h*3),alpha:new Uint8Array(w*h)};
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        const p=y*w+x, packed=paintStage[(h-1-y)*w+x]-1;
        if (packed<0 || alpha?.[p]===0) continue;
        base.rgb[p*3]=packed>>16;
        base.rgb[p*3+1]=(packed>>8)&255;
        base.rgb[p*3+2]=packed&255;
        base.alpha[p]=255;
      }
      frame.colorStages={base,lit:{w,h,rgb:litStage,alpha:legacyLook ? legacyAlpha : alpha},
        graded:legacyLook ? null : {w,h,rgb:frameGrade??litStage,alpha},
        final:{w,h,rgb:frame.rgb.slice(),alpha}};
    }
    if (paletteTrace) frame.palettePixel = paletteTrace.finish(frame,passes);
    if (readabilitySelectors) frame.readabilityMask = selectVisibleSubjects(world,passes.splatId,readabilitySelectors);
    ownership?.finish();
    if (paletteDiagnostic && !passes?.paletteOwner)
      passes = { ...passes,w:frame.w,h:frame.h,paletteOwner:new Uint32Array(frame.w*frame.h),paletteOwners:[null] };
    if (framing) frame.cameraStaging = {
      ...CameraStaging.inspect(framing, world, { w: frame.w, h: frame.h, splatId: passes?.splatId }),
      camera: { yaw, pitch, distance: dist, target: Array.from(T), orthographic: ortho, fov: 2*Math.atan(tangent),
        ...(sensorHeight !== undefined && { sensorHeight, focalLength: sensorHeight / (2*tangent) }) },
      focusPixels: frame.focusPixels ?? 0
    };
    if (audit) {
      frame.lookAudit = audit.report();
    }
    if (paletteInventory) {
      const { declared,baseSlots,usesBase,full } = paletteInventory;
      if (usesBase || (tone && baseSlots.size)) for (const color of basePalette) declared.add(color);
      else for (const slot of baseSlots) declared.add(basePalette[slot]);
      if (full) {
        for (const ramp of ink?.ramps.values() ?? []) for (const color of ramp) declared.add(color);
        if (ink) for (const style of [ink.base,...ink.styles.values(),...ink.scoped.map(row=>row.patch)]) {
          for (const color of style.ramp ?? []) declared.add(color);
          for (const key of ['silhouette','crease','boundary']) {
            const line = style[key];
            for (const color of [line?.color,line?.highlight,line?.shadow]) if (color !== undefined) declared.add(color);
          }
        }
        for (const layer of [effects?.halo,effects?.emitter,effects?.reflection,effects?.trail,effects?.smear,...(effects?.cycles ?? [])])
          for (const color of layer?.colors ?? []) declared.add(color);
      }
      frame.paletteInventory = { base:basePalette, colors:[...declared].filter(Number.isInteger) };
    }
    if (o.captureScenePalette) frame.scenePalette = legacyLook && !tone ? basePalette : null;
    if (!o.captureMotion) delete frame.motionReference;
    if (requestedPasses.length) frame.passes = ArtPasses.subset(passes, requestedPasses);
    return frame;
  };
  if (look.pixelSize !== undefined && (!Number.isSafeInteger(look.pixelSize) || look.pixelSize < 1))
    throw new RangeError('look.pixelSize must be a positive integer');
  const tone = legacyLook ? PixelLook.prepareTone(o.tone ?? look.tone, settings => blueNoise(world, settings)) : null;
  const { colorGrade, grade } = RenderContract.palette(world, o, { grading: (legacyLook || coverageAware) && !tone, tone: false,
    onClip: onPaletteClip && ((i, r, g, b) => onPaletteClip({
      assetId: o.colorStack === undefined ? look.colorStackAssetId : undefined, stack: (o.colorStack ?? look.colorStack)?.name
    }, i, r, g, b)) });
  const evaluatedPalette = colorGrade ? PixelLook.gradePalette(grade) : undefined;
  if (audit) {
    if (legacyLook) audit.addPalette(tone?.palette || evaluatedPalette || (grade ? PixelLook.gradePalette(grade) : world.pal));
    audit.addPalette(stages?.palettes);
    audit.addPalette(optics?.palettes);
  }
  const globalPaletteMark = passSelection.has('target') && (tone || grade) ?
    { assetId: look.colorStackAssetId, stackName: tone ? 'Tone' : (o.colorStack ?? look.colorStack)?.name } : null;
  const rel = c.dist / dist0,
    rho = (world.detail ?? 12) * Math.pow(rel, rel > 1 ? 0.5 : 0.25),
    preferred = look.pixelSize || clamp(Math.round(ch / (2 * tangent * rho * dist0)), 1, 18),
    px = o.px || frameBudget.artScale(cw, ch, preferred, o.raw || o.samples || o.captureCoverage ? null : look.pixelBudget),
    W = Math.ceil(cw / px),
    H = Math.ceil(ch / px);
  const paletteTrace = o.palettePixel && !o.raw && !o.captureCoverage && (!o.samples || o.worked) ?
    PalettePixel.create(o.palettePixel,W,H) : undefined;
  if (paletteTrace && legacyLook) paletteTrace.colors = tone?.palette ?? evaluatedPalette ??
    (grade ? PixelLook.gradePalette(grade) : world.pal);
  if (!o.samples && !o.captureCoverage) o.shotFrame?.({
    time:sceneTime, skyTime:ArtDirection.time(direction,o.skyTime ?? sceneTime,'environment'), camera:{ target:Array.from(T), yaw, pitch, distance:dist, lensScale, orthographic:ortho, ...(fov !== FOV && { fov }) },
    art:{ width:W, height:H, pixelSize:px }
  });
  const historyFrames = effects?.smear && o.artHistory ? o.artHistory.previous(t, W, H, o[reconstructionSource] ?? world) : [];
  const motionFrame = historyFrames[Math.max(0, historyFrames.length - (effects?.smear?.frames || 1))];
  const motionFrom = o.motionFrom ?? motionFrame?.motionReference;
  const captureMotion = !!o.captureMotion || passSelection.has('motion') || passSelection.has('emissionMotion');
  const focus = !o.captureCoverage && protection?.focus && (o[subjectFocusPass] !== undefined ? o[subjectFocusPass] :
    SubjectFocus.frame(protection.focus,renderFrame(world,{
      ...o, [subjectFocusPass]:false, px, samples:true, worked:false, artInkActive:!!ink || o.artInkActive,
      passes:['depth','emission',...(protection.focus.detail < 1 ? ['objectId','materialId'] : [])],
      captureSilhouetteProtection:true, captureMotion:false, lookAudit:false, fragmentProbe:undefined, pick:undefined,
      reflections:false, atmosphere:false, precipitation:false, rainImpacts:false, captureFog:false, volumeHistory:null,
      [captureCamera]:undefined
    })));
  if (legacyLook && (specializedResolve || (o.colored && !tone))) {
    const native = render(world, Object.assign({}, o, { colored: false, samples: true, worked: true, px, passes: [...passSelection], [scopedGlowPass]: trackGlow, artInkActive: !!ink,
      [subjectFocusPass]:focus,
      captureMotion, motionFrom, maskGrade: !tone && grade, reflectionTint: effects?.reflection,
      previewPalette: globalPaletteMark, lookAudit: audit,
      effectPaletteCapture: effectPaletteSettings,
      captureFog: o.captureFog || ink?.ramps.has('fog'), resolveDetailCleanup: !!detailBudget?.affectsCleanup }), paletteRules);
    const samples = render(
      world,
      Object.assign({}, o, {
        colored: false,
        samples: true,
        lookMasks: false,
        pick: undefined,
        px: px / 2,
        w: W * px,
        h: H * px,
        reflectionScale: 2,
        artGridScale: 2,
        volumeHistory: null,
        artInkActive: !!ink,
        [subjectFocusPass]:focus,
        captureMotion: false, motionFrom: undefined, effectPaletteCapture: null, reflectionTint: effects?.reflection,
        passes: specializedResolve ? ['coverage'] : false,
        lookAudit: false
      })
    );
    const basePalette = tone?.palette || world.pal;
    const palette = basePalette.map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);
    const local = native.localAt && {
      at: native.localAt, palettes: native.localPalettes,
      constraints: native.localConstraints,
      scene: palette, grade: !tone && grade,
      placement: (x, y) => ArtStability.placement(stable, native.passes, y * W + x, x, y, t),
      output: PixelLook.outputPalettes(evaluatedPalette || basePalette, native.localPalettes)
    };
    const amount = (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither;
    const img = specializedResolve ? ArtStability.resolve(native, samples, stable, palette, PixelLook, amount,
      { local, tone, grade: !tone && grade, inspect:paletteTrace }) :
      PixelLook.resolve(Object.assign(samples, {
        palette, local, contour: !ink, grade, interiorColor: native.color, dither: amount, inspect:paletteTrace,
        ditherAt: anchoring ? (x, y) => ArtStability.ditherCoordinates(stable, native.passes, (H - 1 - y) * W + x, x, y) : null,
        localDitherAt: (rule, x, y) => ArtStability.ditherCoordinates(null, native.passes, (H - 1 - y) * W + x, x, H - 1 - y, rule)
      }));
    native.cleanDetail?.(img.rgb, !!(o.clean || (look.clean && !tone?.preserveDots)));
    applyMasks(img.rgb, native.masked);
    if (paletteTrace) paletteTrace.steps.push(...native.paletteMaskChoices);
    const reference = captureQuantization || captureStages ? new Uint8Array(img.rgb.length) : undefined;
    if (reference) for (let y = 0; y < H; y++) {
      reference.set(native.color.subarray(y*W*3, (y+1)*W*3), (H-1-y)*W*3);
    }
    return finishLook(Object.assign(img, { px, drawn: samples.drawn },
      evaluatedPalette && !local && { palette: evaluatedPalette },
      !specializedResolve && native.detail && { detail: native.detail },
      native.motionReference && { motionReference: native.motionReference },
      native.silhouetteMask && { silhouetteMask:native.silhouetteMask },
      native.alpha && { alpha: native.alpha },
      (native.orderFallback || samples.orderFallback) && { orderFallback: true },
      native.volumeStats && { volumeStats: native.volumeStats },
      o.captureFog && native.fog && { fog: native.fog }), native.passes, native.fog, native.effectSignals, native.color,
      native.paletteState,native.paletteInventory,reference,native.paintStage);
  }
  const paintStage = o.captureColorStages===true && !o.raw && !o.captureCoverage &&
    (!o.samples || o.worked) && o[subjectFocusPass]!==false ? new Uint32Array(W*H) : undefined;
  function baseReference(i) {
    const packed = world.materialAlbedo?.[i];
    return packed ? RenderStages.unpack(packed-1) : undefined;
  }
  function paintColor(rgb) {
    return rgb ? rgb.reduce((color,n)=>color*256+Math.round(clamp(n,0,1)*255),0)+1 : 0;
  }
  lookPass = createLookPass(W, H, passSelection, o.lookPassRegistry);
  /* Legacy orthographic views back the eye away. Authored rigs keep their rail or orbit position. */
  const oh = dist * tangent,
    eyeD = camera.distance,
    reflectionPlane = o.reflectionPlane,
    focal = ortho ? H / 2 / oh : H / 2 / tangent,
    cameraView = probeView?.matrix ?? camera.view,
    view = CameraLens.artView(probeView ? { ...camera, view: cameraView } : camera, H, stable, undefined, o.artGridScale || 1),
    V = reflectionPlane ? SceneOptics.reflectedView(view, reflectionPlane) : view,
    near = probeView?.near ?? camera.clipNear,
    tp = 1 / tangent,
    asp = W / H,
    baseCount = world.count;
  if(!o.reflectionPlane&&!probeView)o.cameraFrame?.({time:camera.time,pose:CameraLens.fromView(V),motion:camera.motion});
  if (!o.reflectionPlane && !probeView) o[captureCamera]?.({view: V, tangent: ortho ? oh : tangent, aspect: asp, ortho,
    clipNear: near, clipFar: 400, distance: eyeD, setback: eyeD - dist, depthRange: [eyeD - R, eyeD + R],
    eye: [-(V[0]*V[12]+V[1]*V[13]+V[2]*V[14]), -(V[4]*V[12]+V[5]*V[13]+V[6]*V[14]), -(V[8]*V[12]+V[9]*V[13]+V[10]*V[14])]});
  const hex = i => {
      const h = world.pal[i];
      return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    },
    bg = o.captureCoverage || transparent || tone ? [0, 0, 0] : hex(0),
    fog = hex(world.fog.c),
    limx = (1.3 * 0.5 * W) / focal,
    limy = (1.3 * 0.5 * H) / focal;
  const eye = [
    -(V[0] * V[12] + V[1] * V[13] + V[2] * V[14]),
    -(V[4] * V[12] + V[5] * V[13] + V[6] * V[14]),
    -(V[8] * V[12] + V[9] * V[13] + V[10] * V[14])
  ];
  const nominalEye = ortho ? eye.map((value, i) => value - depthOffset * V[2 + i * 4]) : eye;
  const paintView = { direction: [V[2], V[6], V[10]], ...(ortho ? {} : { eye }) };
  const paint = o.paintCorrections === false ? null : world.paintCorrections;
  const climate = resolveEnvironment(world,o,sceneTime,direction);
  const { skyTime,environment,weather,exposure,cutouts } = climate;
  const effectRules = EffectPalettes.activate(effectPaletteSettings, environment?.parameters);
  const windState = resolveWind(world,o,climate);
  const { windConfig,flow,wind,localWind,airAt,windAt } = windState;
  const windResponse = direction?.windResponse;
  const gustTime = (channel, sampled) => direction?.cadence[channel] === undefined ? skyTime : o.skyTime ?? sampled;
  const windGain = (amount, time, x, y, z) => {
    const { flex } = airAt(x,y,z,time);
    return amount * Math.hypot(flex[0],flex[1]);
  };
  const relative = SplatRelighting.frame(world, o, climate);
  const lightingOptions = (o.relighting ?? world.relighting) ? { ...o, liveSun: false } : o;
  const { celestial,sun,flash,clouds } = resolveLighting(world,lightingOptions,climate,windState,direction);
  const transparencySource = o[reconstructionSource]?.data ?? world.data;
  const shadowFootprint = 2 * dist * tangent * (o.artGridScale || 1) / H;
  const captureWorld = world;
  if (!sun && o.shadowArt !== false) world = ShadowArt.frame(world, shadowFootprint);
  const travel = (at, birth, time) => {
    const age = time - birth;
    return flow ? flow.travel(...at, skyTime - age, skyTime) : airAt(...at).velocity.map(v => v * age);
  };
  const splatSource = o.splatFields === true ? world.splatFields : o.splatFields ?? world.splatFields;
  const fields = splatSource && (SplatFields ??= require('../index.js').load().KIT.splatFields).compile(splatSource);
  const emitterSource = o.atmosphereEmitters === true ? world.atmosphereEmitters : o.atmosphereEmitters ?? world.atmosphereEmitters;
  const emitters = emitterSource ? (AtmosphereEmitters ??= require('../index.js').load().KIT.atmosphere.emitters).compile(emitterSource) : null;
  const emitted = emitters && emitters.frame(t, {
    volumes: o.atmosphere !== false, travel,
    socket(target, birth) {
      if (target.entity === undefined) return an.atmosphereSocket?.(target,birth);
      return world.atmospherePose ? world.atmospherePose(target,birth) : AtmosphereEmitters.entityPose(world.lookSnapshot?.query,target);
    }
  });
  const splatCount = fields?.count ?? 0, emittedCount = emitted?.count ?? 0;
  const afterimages = o[afterimageRows];
  const afterimageStart = baseCount + splatCount + emittedCount;
  const N = afterimageStart + (afterimages?.length ?? 0) / 16;
  const birthIds = N > baseCount && captureMotion ? new Float64Array(N) : undefined;
  // The CLI normally supplies posed data. A Node host can pass its active
  // bone matrices directly when using the same afterimage history.
  const baseData = afterimages && !world.rest && an.bones ?
    require('../index.js').load().KIT.bones.posed({ ...world, posedBuf: undefined }) : world.data;
  let d = baseData;
  if (N > baseCount) {
    d = new Float32Array(N * 16);
    d.set(baseData.subarray(0, baseCount * 16));
    if (splatCount) fields.write(d, baseCount, t, { birthIds, travel });
    if (emittedCount) emitted.write(d, baseCount + splatCount, birthIds);
    if (afterimages?.length) d.set(afterimages, afterimageStart * 16);
  }
  if (paint) {
    if (d === world.data) d = d.slice(0, baseCount * 16);
    paint.paint(d, world.pal, paintView);
  }
  const qualityRows = PassQuality.planRows(world, passQuality, { data: d, count: N, particleStart: baseCount, protection });
  if (counters) {
    counters.splatRows += qualityRows?.submitted ?? N;
    counters.omittedBackgroundRows += qualityRows?.backgroundSkipped ?? 0;
    counters.omittedParticleRows += qualityRows?.particlesSkipped ?? 0;
  }
  const mediumLook = medium => optics?.transform(medium) ?? PixelLook.mediumTransform(paletteRules, medium);
  const colorForVolume = volume => mediumLook(TargetSelectors.medium(volume.id, volume.mediumKind ?? volume.type, volume.tags));
  const depthBands = o.atmosphere === false ? [] : AtmosphereDepthBands.settings(
    world.atmosphereDepthBands,o.atmosphereDepthBands,world.pal);
  const bandVolumes = depthBands.length ? require('../index.js').load().KIT.atmosphere.depthBands.frame(depthBands,
    {origin:nominalEye,forward:[-V[2],-V[6],-V[10]]},{time:skyTime,seed:world.seed}) : [];
  const volumes = SceneOptics.prepareVolumes([...atmosphereSources(world,o),...bandVolumes], world.pal, colorForVolume, weather?.fogGain, skyTime);
  if (emitted?.volumes.length) volumes.push(...SceneOptics.prepareVolumes(emitted.volumes, world.pal, colorForVolume, undefined, skyTime));
  const sourceWater = o.water !== false && world.water?.count && world.water.raySegments ? world.water : null;
  const water = sourceWater && (optics || paletteRules) ?
    sourceWater.mapColors((id, kind) => mediumLook(TargetSelectors.medium(id, kind))) : sourceWater;
  const glassIndex = optics && TargetSelectors.index(world);
  const glassLooks = glassIndex && new Map();
  const centers = captureMotion ? new Float32Array(N * 2).fill(NaN) : null;
  const motionReference = centers && { w: W, h: H, centers, ...(birthIds && { birthIds, baseCount, splatSource, emitterSource }) };
  const art = createArtPasses([...passSelection].filter(name => name !== 'target' && name !== 'mask' && name !== 'paletteOwner' &&
    !ArtPasses.environment.includes(name)), W, H, trackGlow && emissive?.slots);
  const environmentPasses = createEnvironmentPasses(passSelection, W, H, world);
  const skyPass = environmentPasses?.passes.sky, fogPass = environmentPasses?.passes.fogTransmittance;
  const reflectPass = environmentPasses?.passes.reflections;
  const centerReflection = reflectPass && new Float64Array(3), fragmentReflection = reflectPass && new Float64Array(3);
  const rayAt = cameraRays(V, eye, W, H, focal, ortho);
  const baseSky = SkyEnvironment.withCelestials(environment?.sky, celestial, celestial && hex(0));
  const sky = baseSky && direction?.bands ? { ...baseSky, bands:direction.bands } : baseSky;
  const aerial = o.atmosphere !== false && !o.captureCoverage ?
    SkyEnvironment.aerial(world.aerialPerspective, o.aerialPerspective, environment?.parameters) : null;
  const cloudShadow = clouds?.shadow;
  const spriteAtlases=AtlasSprites.placements(world.spriteAtlases,o.spriteAtlases);
  const planeClip = reflectionPlane && (p=>SceneOptics.planeDistance(reflectionPlane,...p)>reflectionPlane.bias);
  const cutoffDepth = eyeD-dist;
  const sectionAt = cutaway && (p => Cutaway.margin(cutaway,...p,
    -(V[2]*p[0]+V[6]*p[1]+V[10]*p[2]+V[14])-cutoffDepth));
  const geometryClip = sectionAt ? (p => (!planeClip || planeClip(p)) && sectionAt(p)>=0) : planeClip;
  let spriteSurfaces = world.spriteSurfaces;
  if (world.scalePreviews && o.scalePreviews !== false && o.spriteSurfaces !== false) {
    const grid = o.artGridScale || 1;
    const api = require('../index.js').load().KIT.procedural.lod.preview;
    const report = !reflectionPlane && !probeView && (!o.samples || o.worked) ? o.scalePreviewFrame : undefined;
    const active = api.surfaces(world.scalePreviews, {
      view: V, width: W / grid, height: H / grid, focal: focal / grid, ortho: Boolean(ortho), near, far: camera.clipFar
    }, report).filter(Boolean);
    if (active.length) spriteSurfaces = [spriteSurfaces, ...active];
  }
  const surfaceFragments = o.spriteSurfaces === false ? [] :
    SurfaceRaster.rasterize(spriteSurfaces, { V, W, H, focal, ortho, near, clip: geometryClip });
  const sdf = useSdf ? SdfRaster.rasterize(world,d,sdfSettings,{w:W,h:H,rayAt,near,clip:geometryClip}) : null;
  for (const sample of sdf?.samples ?? []) surfaceFragments.push(sample);
  const emitterHits = areaLights.length && AreaRaster.rasterize(areaLights, { w:W, h:H, rayAt, near, capture:!!(reflectionPlane || probeView), clip:geometryClip });
  if (emitterHits) for (const hit of emitterHits) if (hit) surfaceFragments.push(hit);
  const surfaceDepth=surfaceFragments.length?new Float32Array(W*H).fill(Infinity):null;
  for(const sample of surfaceFragments)surfaceDepth[sample.p]=Math.min(surfaceDepth[sample.p],sample.z);
  const sprites=AtlasRaster.rasterize(spriteAtlases,{
    eye,V,W,H,focal,ortho,near,rayAt,time:t,override:o.spriteAtlasMode,sun,
    objectDither: anchorSpaces.has('object'),
    subject: protection?.match,
    visibility:(position)=>(cloudShadow?.(...position)??1)*(exposure?.light?.(...position)??1),
    clip:geometryClip
  });
  for(const sample of surfaceFragments)if(!sample.sdf)sprites.push(sample);
  sprites.sort((a,b)=>b.z-a.z);
  const cloudView = clouds?.view?.(nominalEye, ortho ? [V[2],V[6],V[10]] : null);
  const axialDepth = volumes.length || water || aerial || cloudView ? new Float32Array(W * H).fill(Infinity) : null;
  const fogScales = protection?.affectsFog && axialDepth ? new Float64Array(W*H).fill(1) : null;
  const silhouetteMask = protection && o.captureSilhouetteProtection ? new Uint16Array(W*H) : null;
  function subjectPixel(pixel, rule) {
    if (fogScales) fogScales[pixel] = rule?.fogScale ?? 1;
    if (silhouetteMask) silhouetteMask[(H-1-Math.floor(pixel/W))*W+pixel%W] = rule?.slot ?? 0;
  }
  // The bands use the nominal eye and sky rays. The foreground still uses its original camera and depth.
  const horizonArt = (!transparent || skyPass) && !o.captureCoverage &&
    HorizonBands.prepare(look.horizonBands, o.horizonBands)?.frame({ eye:nominalEye, yaw, pitch, distance:dist, parameters:environment?.parameters });
  const backdropClouds = clouds?.visible && !cloudView;
  const skyBase = backdropClouds && !sky ? hex(0) : bg;
  const skyOverlay = (flash || cloudView) && !sky && !backdropClouds;
  const opticalSky = sky || clouds?.visible || flash;
  const reflectionSky = SkyEnvironment.forReflection(sky);
  const skySample = (opticalSky || horizonArt) && ((direction, out, origin, reflection, cloudSignal) => {
    if (sky) SkyEnvironment.shade(reflection ? reflectionSky : sky, direction, out);
    else for (let c = 0; c < 3; c++) out[c] = skyBase[c];
    if (horizonArt && !reflection) horizonArt(direction, out);
    if (origin) {
      flash?.sky(origin, direction, out);
      if (!cloudView || reflection) clouds?.paint(origin, direction, out, flash?.light, cloudSignal, counters?.volume);
    }
    return out;
  });
  const showSky = (sky || backdropClouds || flash || horizonArt) && !transparent && !o.captureCoverage;
  const captureSky = skyPass && skySample;
  const skyRay = showSky || captureSky || aerial && ortho && sky ?
    cameraRays(V, eye, W, H, ortho ? H * .5 / Math.tan((sky?.orthoFov ?? Math.PI / 3) * .5) : focal, false) : null;
  const skyRayAt = pixel => skyRay(pixel % W + .5, Math.floor(pixel / W) + .5);
  const skyDirection = pixel => skyRayAt(pixel).direction;
  const skyColor = (showSky || captureSky) && [0, 0, 0];
  const trackMedia = effectRules && ['fog', 'clouds', 'sky'].some(kind => effectRules.ramps.has(kind));
  const backdropCloud = trackMedia && showSky && backdropClouds ? new Float32Array(W * H) : null;
  const cloudSignal = backdropCloud && [0];
  // Orthographic geometry uses an artificial camera setback. Measure aerial distance from the nominal eye.
  const air = aerial && { ...aerial, start: aerial.start + eyeD - dist,
    color: sky ? (pixel, direction) => SkyEnvironment.scattering(sky, ortho ? skyDirection(pixel) : direction) : () => hex(0) };
  const skyReflectionSource = o.skyReflections ?? world.skyReflections;
  if (skyReflectionSource !== undefined && !['scene', 'material'].includes(skyReflectionSource))
    throw new RangeError('Sky reflections source must be scene or material');
  const horizon = Math.max(eyeD + 2 * R, cloudView?.horizon(eye) ?? 0,
    ...depthBands.filter(band=>band.density>0).map(band=>band.depth[1]+depthOffset));
  const volumeLighting = o.volumeLighting ?? world.volumeLighting ?? (areaLights.length?{}:undefined);
  let localLighting;
  const lightCasters=areaLights.some(l=>l.shadows)?AreaLights.staticSources(world,d):[];
  const volumeSource=volumeLighting&&!volumeLighting.shadow&&lightCasters.length?{...volumeLighting,shadow:(x,y,z,direction,distance)=>AreaLights.occludes(lightCasters,[x,y,z],direction,distance)}:volumeLighting;
  const prepareVolumeLight = () => volumeSource ? (localLighting ??= SceneOptics.lighting(volumeSource, world.pal,
    { time: t, localLights: o.volumeLocalLights, localShadows: o.volumeLocalShadows, celestialSun: celestial?.sun,areaLights })) : undefined;
  const daylight = o.lightDaylight ?? o.environment?.daylight ?? an.daylight ?? 1;
  const dusk = LightSchedule.gain(daylight);
  const lampEye = eye;
  const lamps = LightSchedule.select(world.lights || [], lampEye, { daylight, duskOnly: true });
  const rainConfig = RainImpacts.settings(world.rainImpacts, o.rainImpacts);
  const rainWeather = motion.rain === skyTime ? weather : climate.binding?.frame(motion.rain, undefined, { retained: false });
  const precipitation = Precipitation.frame(world, o.precipitation, {
    time: motion.rain, wind: windAt?.(motion.rain) ?? wind.velocity, windAt, weather: rainWeather, localWind, impacts: rainConfig, exposure,
    lamps: world.precipitationRanges?.length ? LightSchedule.select(world.lights || [], lampEye, { daylight }) : [],
    localLighting: prepareVolumeLight
  });
  const rain = RainImpacts.frame(rainConfig, precipitation?.contacts, motion.rain);
  const volumeWind = !windConfig && world.volumeWind && !o.wind && !weather?.wind && !an.wind
    ? Airflow.frame(world.volumeWind).velocity : null;
  const volumeFlow = volumes.some(v => v.type === 'field' || v.depthBand?.wind) && (volumeWind && exposure?.wind
    ? WindField.create(WindField.settings(true), { ambient:() => volumeWind, exposure }) : flow)?.frame(skyTime);
  const waterWind = windResponse?.water && ((x,y,z) => windGain(windResponse.water,gustTime('water', motion.water),x,y,z));
  const atmosphereOptions = () => {
    const quality = atmosphereQuality({ ...world.volumeQuality, ...o.volumeQuality });
    quality.wind = volumeWind ?? wind.velocity;
    if (volumeFlow) quality.windOffset = volumeFlow.windOffset;
    const media = volumes.some(volume => volume.type === 'field'||volume.lit) ? prepareVolumeLight() : undefined;
    return { ...quality, time: t, depthOffset, waterTime: motion.water, waterWind, cloudShadow, flash, media, exposure, cutouts, cloud:cloudView, effectCoverage: trackMedia,
      cloudStart:cloudView && eyeD-dist, fogTransmittance:!!fogPass, bands:direction?.bands, counters:counters?.volume };
  };
  const geometrySample = probe || sortedSurfaces || sdf || emitterHits || aerial || cloudShadow || flash || cloudView ? sampleFrames(world, t) : null;
  const captured = o.captureCoverage || transparent ? new Float32Array(W * H) : null;
  // The reflected pass uses the same projection and reads only the plane's front side.
  const reflectionTint = effects?.reflection || o.reflectionTint;
  const reflection =
    o.surface !== false && o.reflections !== false && world.reflections?.length
      ? reflectionSampler(
          world.reflections,
          (plane, factor) => {
            const capture = render(world, {
              ...o,
              ...(factor < 1 && { w: Math.max(1, Math.round(W * factor)), h: Math.max(1, Math.round(H * factor)), px: 1 }),
              samples: false,
              colored: false,
              worked: false,
              pick: undefined,
              lookInputSession: lookInputs,
              reflectionPlane: plane,
              captureCoverage: true,
              passes: reflectionTint ? ['emission'] : false,
              reflectionTint,
              captureMotion: false,
              fragmentProbe: undefined,
              lookAudit: false,
              atmosphere: false,
              water: false,
              reflections: false,
              edges: false
            });
            if (counters) {
              counters.planarCaptures++;
              counters.planarPixels += capture.w * capture.h;
            }
            return capture;
          },
          V,
          eye,
          o.reflectionScale ?? 1,
          { quality: passQuality, width: W, height: H }
        )
      : null;
  let definitions = useLocalReflections ? ReflectionProbes.prepare(world.reflectionProbes) : [];
  const probeLevels = PassQuality.reflectionPlan(passQuality, definitions.map(probe => probe.id));
  if (probeLevels) definitions = definitions.filter(probe => probeLevels.get(probe.id)).map(probe => {
    const factor = probeLevels.get(probe.id);
    return factor === 1 ? probe : { ...probe, size: Math.max(4, 2 ** Math.floor(Math.log2(probe.size * factor))) };
  });
  const probeFilters = definitions.length && new Map();
  const localReflection = definitions.length ? ReflectionProbes.sampler(definitions, (probe, face) => {
    if (!probeFilters.has(probe.id)) probeFilters.set(probe.id, ShadowArt.bind({ cast:probe.capture }, captureWorld,'cast'));
    if (counters) {
      counters.reflectionProbeFaces++;
      counters.reflectionProbePixels += probe.size ** 2;
    }
    return render(captureWorld, {
      ...o, [probeCamera]:{ matrix:ReflectionProbes.view(probe.at,face), near:probe.near, allow:probeFilters.get(probe.id) },
      target:probe.at, dist:1, yaw:0, pitch:0, fov:Math.PI/2, lensScale:1, lockCamera:true, ortho:false,
      w:probe.size, h:probe.size, px:1, artGridScale:1, raw:false, samples:false, worked:false, colored:false,
      captureCoverage:true, lookInputSession:lookInputs, pick:undefined, passes:false, lookAudit:false,
      fragmentProbe:undefined, captureMotion:false, cutaway:false, reflectionPlane:undefined,
      atmosphere:false, water:false, reflections:false, edges:false, transparencyHistory:undefined
    });
  }, o[probeCaptures]) : null;
  let live, transmissionOccluder;
  function transmissionOccluded(point, direction, distance, bias) {
    if (!world.renderSdfs?.length || distance <= bias) return false;
    if (transmissionOccluder === undefined) transmissionOccluder = AreaRaster.sceneOccluder(world, d, AL);
    return transmissionOccluder?.(point.map((value, axis) => value + direction[axis] * bias), direction, distance - bias);
  }
  const sunGains = sun && [0, 0, 0];
  const surface = surfaceShading(world, stages && !coverageAware ? { ...o, paletteConstraints: false } : o, {
    eye,
    forward: [V[2], V[6], V[10]],
    reflection, localReflection,
    sky: opticalSky && ((direction, out, origin) => {
      if (!skyOverlay) return skySample(direction,out,origin,true);
      flash?.sky(origin,direction,out);
      cloudView && clouds.paint(origin,direction,out,flash?.light,undefined,counters?.volume);
      return out;
    }),
    skyOverlay: Boolean(skyOverlay),
    skyReflectionSource,
    parallel: ortho ? [V[2], V[6], V[10]] : null,
    footprint: (dist * 2) / (tp * H),
    detail: stableDetail, pixelsPerUnit: focal / (o.artGridScale || 1), orthographic: ortho,
    time: t, waterTime: motion.water, waterWind,
    sun: sun?.direction, sunIntensity: sun?.intensity,
    transmissionLamps: () => LightSchedule.select(world.lights || [], lampEye, { daylight }),
    transmissionOccluded,
    transmissionSunVisibility(i, point, direction, normal, bias) {
      if (live) return live.transmissionVisibility(i, point, normal, bias);
      if (transmissionOccluded(point, direction, world.radius * 4, bias)) return 0;
      const [x, y, z] = point;
      return (cloudShadow?.(x, y, z) ?? 1) * (exposure?.light?.(x, y, z) ?? 1);
    },
    cloudShadow,
    exposure,
    weather: weather?.surface,
    rain,
    sunVisibility: sun && ((i, x, y, z) => live?.visibility(i, x, y, z)),
    blueNoise: settings => blueNoise(world, settings), onPaletteClip,
    onSurfaceClip: audit && ((r, g, b) => audit.sample('surface', r, g, b))
  });
  const surfaceGlint = surface ? new Uint8Array(W * H) : null;
  const focusPixel = SubjectFocus.raster(focus,W,H);
  const fallingCoverage = focus && focus.settings.detail < 1 ? new Float32Array(W*H) : null;
  const layerPalettes = surface?.palettes ?? [];
  const localConstraints = paletteRules
    ? Object.assign(Array(layerPalettes.length).fill(undefined), surface?.constraints).concat(paletteRules.palettes)
    : surface?.constraints;
  const localPalettes = paletteRules ? layerPalettes.concat(paletteRules.palettes.map(policy => policy.swatches)) : layerPalettes;
  if (audit && !o.raw) audit.addPalette(PixelLook.outputPalettes([], localPalettes).packed);
  const localAt = localPalettes.length && !o.raw && !retainContributions ? new Uint32Array(W * H) : null;
  const targetSlots = paletteRules?.slots(world);
  const paletteInventory = o.paletteUsageSelection && !o.captureCoverage && (!o.samples || o.worked) &&
    PaletteUsage.inventory(world,o.paletteUsageSelection,{surface,paletteRules,targetSlots,stages,optics,effects:effectPaletteSettings});
  const defaultSlot = paletteRules?.defaultSlot || 0;
  const overlay = localAt && localConstraints?.some(policy => policy?.mask) &&
    { slots: new Uint32Array(W * H), owners: new Uint32Array(W * H) };
  const fallbackSlot = defaultSlot ? layerPalettes.length + defaultSlot : 0;
  const contribution = coverageAware && localPalettes.length ? contributionLook(localPalettes, localConstraints, targetSlots,
    layerPalettes.length, fallbackSlot, Array.from(world.pal, (_, i) => hex(i)), grade) : null;
  const composedEffects = effectRules && [...effectRules.ramps.values()].some(ramp=>ramp.combine);
  const lightingEffects = effectRules && (effectRules.ramps.has('shadow') || effectRules.ramps.has('bounce'));
  const paletteCapture = !o.raw && (paletteDiagnostic || composedEffects) && PaletteComposition.capture(
    W,H,localPalettes,localConstraints,Array.from(world.pal,(_,i)=>hex(i)),!tone && grade,
    {diagnostic:paletteDiagnostic,lit:composedEffects && lightingEffects});
  const paletteClaim = (paletteCapture || paletteTrace) ? (p,i,layer,r,g,b,steps) => {
    if (p === paletteTrace?.bottom) return [selectSlot(i,layer),r,g,b,steps?.slice() ?? []];
    if (paletteCapture) return [selectSlot(i,layer),r,g,b];
  } : undefined;
  const paletteOutlines = paletteCapture && new Uint8Array(W*H);
  const unmasked = slot => localConstraints?.[slot - 1]?.mask ? 0 : slot;
  function selectSlot(i,layer) {
    const target = targetSlots?.[i];
    return target ? layerPalettes.length + target : layer || fallbackSlot;
  }
  function localSlot(i, layer, pixel) {
    const slot = selectSlot(i,layer);
    if (!overlay) return slot;
    const masked = slot && !unmasked(slot);
    overlay.slots[pixel] = masked ? slot : 0;
    if (!masked) return slot;
    overlay.owners[pixel] = i;
    return unmasked(layer) || unmasked(fallbackSlot) || 0;
  }
  const hasEffectInk = N > baseCount || world.effectParticles?.length || world.surfaces?.some(({ settings }) =>
    Object.values(settings.layers || {}).some(layer => layer?.type === 'projected'));
  const detail = hasEffectInk ? new Uint8Array(W * H) : null;
  // where each splat is at this moment, and what it looks like
  const X = new Float32Array(N),
    Y = new Float32Array(N),
    Z = new Float32Array(N),
    AL = new Float32Array(N),
    SC = new Float32Array(N),
    depth = new Float32Array(N),
    add = new Float32Array(N),
    wet = new Float32Array(N);
  const sampleWithdrawal = SampleCoverage.amount(o.sampleWithdrawal ?? world.sampleWithdrawal ?? 0);
  for (let i = 0, q = 0; i < N; i++, q += 16) {
    if (qualityRows && !qualityRows.keep[i]) continue;
    let x = d[q],
      y = d[q + 1],
      z = d[q + 2],
      al = d[q + 3],
      sc = 1;
    const kraw = Math.round(d[q + 11]),
      kind = kraw % 16,
      ph = d[q + 12],
      sp = d[q + 13],
      rg = d[q + 14],
      ex = d[q + 15];
    if (o[subjectFocusPass] === false && (kind === 2 || kind === 15)) continue;
    if (!SampleCoverage.visible(kraw, sampleWithdrawal)) al = 0;
    if (precipitation?.rows[i]) {
      const pose = precipitation.pose?.(i, x, y, z, kind, ph, sp, rg, ex, al);
      if (pose) [x, y, z, al] = pose;
      else al = 0;
    } else if (kind === 1) al *= 0.62 + 0.38 * Math.sin(motion.emissive * sp + ph);
    else if (kind === 2) {
      const profileRain = kraw & Airflow.packedFlag;
      const f = ((profileRain ? motion.rain : motion.falling) * sp) / rg + ph,
        pr = f - Math.floor(f);
      y -= pr * rg;
      al *= 1 - pr * pr;
      if (profileRain) {
        const { velocity } = airAt(x,y,z,motion.rain);
        const age = pr * rg / Math.max(sp, 1e-5);
        x += velocity[0] * age;
        z += velocity[1] * age;
        al *= rainWeather?.rainHere ? rainWeather.rainHere(x,z) : rainWeather?.rainGain ?? 0;
      }
      if (exposure?.rain) {
        al *= exposure.rain(x,y,z);
        if (al && exposure.rainBlocked?.([d[q],d[q+1],d[q+2]],[x,y,z])) al = 0;
      }
      sc *= 1 + pr * ex;
    } else if (kind === 3) {
      const f = (t * sp) / rg + ph,
        pr = f - Math.floor(f);
      y += pr * rg;
      x += Math.sin(pr * 7 + ph * 50) * 0.25 * pr;
      if (kraw & Airflow.packedFlag) {
        const age = pr * rg / Math.max(sp, 0.00001);
        const shift = flow ? flow.travel(d[q],d[q+1],d[q+2],skyTime-age,skyTime) : airAt(x,y,z).velocity.map(v => v*age);
        x += shift[0];
        z += shift[1];
      }
      al *= (1 - pr) * sstep(0, 0.1, pr);
      sc *= 0.6 + pr * ex;
    } else if (kind === 4) add[i] = 0.3 * sstep(0.75, 1, Math.sin(motion.water * sp + ph));
    else if (kind === 5) {
      const a = t * sp,
        cs = Math.cos(a),
        sn = Math.sin(a),
        nx = cs * x + sn * z;
      z = -sn * x + cs * z;
      x = nx;
    } else if (kind === 6) y += Math.sin(t * sp + ph) * rg;
    else if (kind === 7 && ex !== LightSchedule.emissionMarker) al *= 0.82 + 0.18 * Math.sin(motion.emissive * sp + ph);
    else if (kind === 8) {
      const f = 0.2 + 0.8 * Math.abs(Math.sin(t * sp + ph));
      x = rg + (x - rg) * f;
      z = ex + (z - ex) * f;
      y += 0.14 * Math.sin(t * sp * 0.31 + ph);
    } else if (kind === 9) {
      const k = 1 + rg * Math.sin(t * sp + ph - y * ex);
      x *= k;
      z *= k;
    } else if (kind === 15) {
      // flutter down: a leaf or a flake, swinging as it falls
      const snow = direction?.cadence.rain !== undefined && world.fallingSnowRanges?.some(({ first,end }) => first <= i && i < end);
      const f = ((snow ? motion.falling : motion.foliage) * sp) / rg + ph,
        pr = f - Math.floor(f);
      y -= pr * rg;
      x += Math.sin(pr * 11 + ph * 40) * ex;
      z += Math.cos(pr * 7 + ph * 23) * ex * 0.6;
      al *= sstep(0, 0.05, pr) * (1 - sstep(0.92, 1, pr));
    } else if (kind === 14) {
      const hg = Math.max(0, y - ex);
      x += rg * hg * Math.sin(motion.foliage * sp + ph);
      z += rg * 0.6 * hg * Math.sin(motion.foliage * sp * 0.73 + ph * 1.7);
    } else if (kind === 11) {
      const channel = Airflow.isCloth(kraw) ? 'cloth' : 'foliage';
      const bendTime = motion[channel];
      if (kraw & Airflow.packedFlag) {
        const displacement = Airflow.bend(bendTime, ph, sp, rg);
        const { flex } = airAt(x,y,z,gustTime(channel,bendTime));
        x += flex[0] * displacement;
        z += flex[1] * displacement;
      } else {
        const x0 = x;
        x += rg * Math.sin(bendTime * sp + y * 1.3 + z * 0.9 + ph);
        y += rg * 0.6 * Math.sin(bendTime * sp * 1.3 + x0 * 1.1 + ph);
      }
    }
    if (windResponse?.emissive && (kraw & 32) && (kind === 1 || kind === 7 && ex !== LightSchedule.emissionMarker))
      al *= 1 - windGain(windResponse.emissive,gustTime('emissive',motion.emissive),x,y,z);
    if (kraw & 512) {
      // born: not there till its time, then it grows to its size (as the page does it)
      const gw = world.grow || {};
      let gt = t * (gw.rate || 1);
      if (gw.loop > 0) gt -= Math.floor(gt / gw.loop) * gw.loop;
      const gs = Math.min(1, Math.max(0, (gt - ex) / (gw.fade || 0.5)));
      if (gs <= 0) al = 0;
      sc *= gs * (2 - gs);
    } else if (kraw & 1024) wet[i] = Math.min(1, Math.max(0, (t * ((world.grow || {}).rate || 1) - ex) / 2));
    X[i] = x;
    Y[i] = y;
    Z[i] = z;
    AL[i] = al;
    SC[i] = sc;
    depth[i] = V[2] * x + V[6] * y + V[10] * z + V[14];
  }
  const probes = ProbeLighting.create(world,o.bounceProbes,baseSky,sun,o[reconstructionSource]);
  function receivesDiffuse(i) {
    return i >= 0 && i < baseCount && AL[i] >= 1 && !(Math.round(d[i*16+11]) & (16 | 32 | 64 | 128 | 256 | 2048 | 32768)) &&
      !world.opticalSplats?.[i*OpticalMaterials.STRIDE+3] && !surface?.reveals(i) &&
      ContributionRules.materialCoverage(world.materialPixelStyles?.[i*4] ?? 0,coverageMode) !== ContributionRules.softCoverage;
  }
  const probeReceiver = i => probes && receivesDiffuse(i) && probes.receives(i);
  if (sun) {
    const frames = sampleFrames(world, t), normals = [];
    const normalAt = i => normals[i] ?? (normals[i] = frames(i).normal ?? false);
    live = LiveSun.create(sun, world, { x: X, y: Y, z: Z, alpha: AL, scale: SC }, normalAt, cloudShadow, exposure?.light,
      { shadowArt: o.shadowArt, footprint: shadowFootprint,
        probes: probes && ((i,x,y,z,n) => n && probeReceiver(i) ? probes.sample([x,y,z],n) : null) });
  }
  const contact = contactSettings && ContactDepth.create(contactSettings, world, d, { x:X, y:Y, z:Z, alpha:AL, scale:SC },
    sampleFrames(world, t), coverageMode, rayAt, surface?.reveals);
  const optical = world.opticalSplats && OpticalMaterials.frame(world, { view: V, eye, ortho },
    sampleFrames(world, t), { x: X, y: Y, z: Z });
  const spillLights = o.areaLights === false ? [] : EmissiveFinishes.spillLights(emissive, { x:X, y:Y, z:Z, alpha:AL });
  const spotLighting = Array.isArray(volumeLighting?.spots) && volumeLighting.spots.some(light => light?.surfaceIntensity !== undefined)
    ? prepareVolumeLight() : undefined;
  const directLight = (areaLights.length || spillLights.length || spotLighting?.surfaceSpots.length) &&
    AreaRaster.createLighting([...areaLights,...spillLights],world,d,AL,{ spots:spotLighting?.surfaceSpots, shadow:spotLighting?.shadow });
  const diffuseFrames = (directLight || probes) && sampleFrames(world,t), diffuseNormals = [];
  function diffuseNormal(i) {
    return diffuseNormals[i] ?? (diffuseNormals[i] = receivesDiffuse(i) && diffuseFrames(i).normal || false);
  }
  function probeAlbedo(i) {
    const packed = world.materialAlbedo?.[i];
    if (!packed) return;
    const color=packed-1;
    return [color>>16,(color>>8)&255,color&255].map(n=>n/255);
  }
  const relight = relative && SplatRelighting.rows(world, relative, sampleFrames(world, t), { x: X, y: Y, z: Z, alpha: AL });
  let mn = Infinity;
  for (let i = 0; i < N; i++) if ((!qualityRows || qualityRows.keep[i]) && (i < baseCount || AL[i] > 0) && depth[i] < mn) mn = depth[i];
  const mediumHorizon = aerial ? Math.max(horizon, -mn + R) : horizon;
  const backRows = blendDepth && world.back?.length ? new Set(world.back) : null;
  if (world.back) for (let j = 0; j < world.back.length; j++) depth[world.back[j]] = mn;
  const order = new Uint32Array(qualityRows?.submitted ?? N);
  for (let i = 0, j = 0; i < N; i++) if (!qualityRows || qualityRows.keep[i]) order[j++] = i;
  order.sort((a, b) => depth[a] - depth[b]);
  if (transparency && !blendDepth) {
    const { depthTolerance: tolerance } = transparency;
    const depthAt = i => depth[i];
    const back = world.back?.length ? new Set(world.back) : null;
    const transparentAt = i => SplatOrder.isTransparent(d, i, AL[i], optical?.[i * OpticalMaterials.STRIDE + 3], back);
    // Keep atlas sprites as depth barriers in the center-order path.
    let spriteSpans;
    if (sprites.length) {
      spriteSpans = new Uint32Array(N);
      let next = 0;
      for (const i of order) {
        while (next < sprites.length && sprites[next].z >= -depth[i]) next++;
        spriteSpans[i] = next;
      }
    }
    const sameSpan = spriteSpans ? (a, b) => spriteSpans[a] === spriteSpans[b] : undefined;
    const history = !reflectionPlane && o.transparencyHistory;
    if (history) {
      if (o.resetTransparency) history.reset();
      history.sort(order, { data: transparencySource, view: V, time: sceneTime, tolerance, depthAt, transparentAt,
        sameSpan });
    } else SplatOrder.stabilize(order, tolerance, depthAt, transparentAt, undefined, sameSpan);
  }
  const mediaOptions = (water || aerial || cloudView || blendDepth && volumes.length) && atmosphereOptions();
  const hazeCoverage = effectRules?.ramps.get('fog')?.geometry && world.fog.max > 0 && new Float32Array(W * H);
  const rayMedia = mediaOptions && mediaSampler(volumes, water, rayAt, W, mediumHorizon, {
    ...mediaOptions, reflection, reflectionBackground: bg, waterTransition: blendDepth
  }, air);
  const retainLayers = retainContributions || Boolean(rayMedia);
  const col = new Float32Array(W * H * 3),
    dep = new Float32Array(W * H),
    gls = new Float32Array(W * H);
  const skyCloud = skyPass && cloudView && [0, 0, 0, 1];
  for (let i = 0; i < W * H; i++) {
    const sampled = (showSky || captureSky) ? skySample(skyDirection(i), skyColor, nominalEye, false, cloudSignal) : null;
    const background = showSky ? sampled : bg;
    if (skyPass) {
      const q = environmentPasses.top(i) * 3, color = sampled ?? hex(0);
      if (skyCloud) {
        const { origin, direction, axial } = rayAt(i % W + .5, Math.floor(i / W) + .5);
        cloudView.trace(origin, direction, Math.max(0,eyeD-dist), horizon/axial, skyCloud, counters?.volume);
        for (let c = 0; c < 3; c++) skyPass[q + c] = skyCloud[c] + skyCloud[3] * color[c];
      } else skyPass.set(color,q);
    }
    if (backdropCloud) backdropCloud[i] = cloudSignal[0];
    const backdrop = rayMedia ? rayMedia.shade(i, horizon, background, false) : background;
    col[i * 3] = backdrop[0];
    col[i * 3 + 1] = backdrop[1];
    col[i * 3 + 2] = backdrop[2];
    if (captured && rayMedia) captured[i] = rayMedia.opacity();
    dep[i] = 1;
  }
  let drawn = 0;
  // colour per pixel (look.pixel): which dab is in front at each pixel, to be coloured afterwards from where the pixel lands on it
  let PIX =
      (o.pixel || (world.look && world.look.pixel)) && !o.raw && world.pix && world.pix.length >= baseCount * 8
        ? world.pix
        : null;
  if(PIX){
    let copy=false;
    for(let i=0;i<baseCount;i++)if(Math.round(d[i*16+11])&32768){if(!copy){PIX=PIX.slice();copy=true;}PIX[i*8]=0;}
  }
  const win = PIX ? new Int32Array(W * H).fill(-1) : null;
  const materialStyles = o.raw ? null : world.materialPixelStyles;
  const artScale = o.artGridScale || 1;
  // Keep later translucent coats when the opaque receiver is recoloured per pixel.
  let surfaceOverlay = null;
  const bend = world.refract === undefined ? 6 : world.refract;
  const patternFlashes = flash && PIX ? new Map() : null;
  let contributions = retainLayers && PIX ? contributionLayers(col, captured, W, H, true, bend) : null;
  // The legacy pattern redraw otherwise replaces the composited edge with opaque paint.
  const edgePatterns = !retainLayers && edgeStrengthAt && PIX ? contributionLayers(col, captured, W, H, true, 0) : null;
  const edgePixels = !o.raw && edgeStrengthAt ? new Float32Array(W * H) : null;
  const stageMasks = stages?.surfaceMask || contribution &&
    localConstraints?.some(policy => policy?.mask || policy?.tuning?.regions.length);
  const anchoredContributions = contribution && (anchoring ||
    localConstraints?.some(policy => policy?.anchor && policy.anchor.dither !== 'screen'));
  const stagedFrames = stageMasks || anchoredContributions ? sampleFrames(world, t) : null;
  const maskFrames = stagedFrames && new Map();
  function stageFrame(i) {
    if (i >= baseCount) return { normal: null };
    if (!maskFrames.has(i)) maskFrames.set(i, stagedFrames(i));
    return maskFrames.get(i);
  }
  function stageSample(i, point, p) {
    if (i >= baseCount) return { position: point, worldPosition: point, normal: null, time: t };
    const { rest, normal, localOffset } = stageFrame(i);
    const offset = localOffset(point[0] - X[i], point[1] - Y[i], point[2] - Z[i]);
    return { position: Array.from(rest, (n, k) => n + offset[k]), worldPosition: point, normal, time: t,
      ...(spatialFade && p !== undefined && { footprint: space => ditherFootprint(rayAt, p % W + .5,
        Math.floor(p / W) + .5, point, normal, artScale, space === 'object' ? localOffset : undefined) }) };
  }
  const renderMeta = world.renderMetadata;
  function fragmentRule(i) {
    if (!anchoring) return null;
    const rule = stable.rules.length ? ArtStability.matching(stable, renderMeta?.objects?.[renderMeta.objectIds?.[i]],
      renderMeta?.materials?.[renderMeta.materialIds?.[i]]) : stable;
    return rule.dither === 'screen' ? null : rule;
  }
  function stagedMaterial(i, rules, rgb, sample, paintedAlbedo, inspect) {
    const reference = world.materialAlbedo?.[i];
    return RenderStages.material(rules, rgb, reference ? reference - 1 : undefined,
      sample, undefined, lookPass?.stage, paintedAlbedo, inspect);
  }
  let pixed = null,
    sprM = null;
  const defaultFine = o.fine || !!look.fine;
  const defaultCleanup = !!(o.clean || (look.clean && !tone?.preserveDots));
  const needsCleanupFlags = (styled || o.resolveDetailCleanup) && detailBudget?.affectsCleanup &&
    (defaultCleanup || detailBudget.enablesCleanup);
  const budgetAt = (needsCleanupFlags || detailBudget?.fineOn || detailBudget?.fineOff) ? detailBudget.bind(world) : null;
  const cleanupFlags = needsCleanupFlags && Uint8Array.from({length:baseCount}, (_, i) => DetailBudgets.flags(budgetAt(i)));
  const pixelBudgets = cleanupFlags && cleanupFlags.some(Boolean) ? new Uint8Array(W * H) : null;
  const FN =
      (defaultFine || detailBudget?.fineOn) && world.fine && world.fine.length >= baseCount * 12 ? world.fine : null,
    FPAL = FN ? world.pal.map((h, i) => hex(i)) : null;
  let deferred = sortedSurfaces || sdf || emitterHits ? new Map() : null, deferredCount = 0, orderFallback = false;
  function countDeferred() {
    if (blendDepth && deferredCount >= fragmentBudget)
      throw new RangeError('Layered transparency exceeded the fragment budget. Raise it or reduce the art resolution.');
    deferredCount++;
    if (counters) counters.peakDeferredFragments = Math.max(counters.peakDeferredFragments, deferredCount);
  }
  const foreground = direction?.foreground;
  const contrastColor = (foreground || protection) && [0,0,0];
  const targetFog = (amount, rule) => rule && rule.fogScale !== 1 ? clamp(amount*rule.fogScale,0,1) : amount;
  function subjectColor(rule, r, g, b) {
    return ArtDirection.gradeContrast(r,g,b,rule.contrast-1,rule.pivot,contrastColor);
  }
  const foregroundDepth = z => z - (eyeD-dist);
  function composite(p, i, z, dn, a, pr, pg, pb, wd, emits, highlight, paletteId, detailParticle, projected, coat, glass, mark,
    opticalDepth = z, sprite, haze = 0, rule, reflected, filteredEdge = false, refraction = 1, sectionEdge = false, claim, baseColor) {
    if (surfaceDepth && (!sprite?.surface || sdf) && opticalDepth > surfaceDepth[p]+1e-5) return;
    if (focus?.rain || fallingCoverage) {
      const kind = i < 0 ? 0 : Math.round(d[i*16+11])%16;
      if (kind === 2 && focus.rain) {
        a *= focus.rain[focusPixel(p)];
        if (a < .004) return;
      }
      if (fallingCoverage) fallingCoverage[p] = (kind === 2 || kind === 15 ? a : 0)+fallingCoverage[p]*(1-a);
    }
    const p3 = p * 3, ia = 1 - a;
    if (counters) {
      counters.fragments++;
      if (!wd && a < 1) counters.translucentFragments++;
    }
    if (foreground && wd && (i < 0 ? !sprite?.emission : !(d[i*16+11] & 32)))
      [pr,pg,pb] = foreground(foregroundDepth(opticalDepth),pr,pg,pb,contrastColor);
    if (rule && rule.contrast !== 1 && (i < 0 ? !sprite?.emission : !(d[i*16+11] & 32)))
      [pr,pg,pb] = subjectColor(rule,pr,pg,pb);
    environmentPasses?.fragment?.(p, i, a, pr, pg, pb, reflected, wd && a > .5);
    if (rayMedia) [pr, pg, pb] = rayMedia.shade(p, opticalDepth, [pr, pg, pb], true, rule?.fogScale);
    if (retainLayers && glass && bend && !contributions) contributions = contributionLayers(col, captured, W, H, false, bend);
    if (contributions) contributions.before(p, pr, pg, pb, a, wd && a > .5, glass && !wd, dn, refraction);
    edgePatterns?.before(p, pr, pg, pb, a, wd && a > .5, false, dn);
    if (edgePixels) {
      const through = !filteredEdge && wd && a > .5 ? 0 : ia;
      edgePixels[p] = edgePixels[p] * through + (filteredEdge ? a : 0);
    }
    col[p3] = pr * a + col[p3] * ia;
    col[p3 + 1] = pg * a + col[p3 + 1] * ia;
    col[p3 + 2] = pb * a + col[p3 + 2] * ia;
    if (captured) captured[p] = a + captured[p] * ia;
    if (hazeCoverage) hazeCoverage[p] = haze*a + hazeCoverage[p]*ia;
    const owned = art?.fragment(p, i, a, wd, z, emits, pr, pg, pb, sprite);
    if (owned && paintStage) paintStage[p] = baseColor ?? 0;
    if (owned && paletteCapture) paletteCapture.claim(p,claim?.[0] ?? selectSlot(i,paletteId),claim);
    if (owned && p === paletteTrace?.bottom) paletteTrace.fragment = claim?.[4] ?? [];
    if (lookPass) {
      const redraw = !sectionEdge && PIX?.[i * 8] && wd && a > .5 && !surface?.reveals(i);
      lookPass.fragment(p, a, redraw ? undefined : mark);
    }
    if (surfaceGlint && a > 0.5) surfaceGlint[p] = highlight > 0.22 || detailParticle;
    if (localAt && a > 0.5) localAt[p] = localSlot(i, paletteId, p);
    if (detail) {
      const q = (H - 1 - Math.floor(p / W)) * W + p % W;
      if (a > 0.5) detail[q] = 0;
      if (a > 0.24 && (detailParticle || (projected && highlight > 0.22))) detail[q] = 1;
    }
    if (surfaceOverlay) {
      const j = p * 4;
      if (wd && a > 0.5) surfaceOverlay.fill(0, j, j + 4);
      else if (!wd && (coat || surfaceOverlay[j + 3])) {
        surfaceOverlay[j] = pr * a + surfaceOverlay[j] * ia;
        surfaceOverlay[j + 1] = pg * a + surfaceOverlay[j + 1] * ia;
        surfaceOverlay[j + 2] = pb * a + surfaceOverlay[j + 2] * ia;
        surfaceOverlay[j + 3] = a + surfaceOverlay[j + 3] * ia;
      }
    }
    if (wd) {
      dep[p] = dn * a + dep[p] * ia;
      gls[p] *= ia;
      if (a > 0.5) {
        if (pixelBudgets) pixelBudgets[p] = (cleanupFlags[i] ?? 0) | DetailBudgets.OWNED;
        if (win) win[p] = sectionEdge || surface?.reveals(i) ? -1 : i;
        if (axialDepth) axialDepth[p] = opticalDepth;
        if (fogScales || silhouetteMask) subjectPixel(p,rule);
      }
    } else if (glass) gls[p] = Math.min(1, gls[p] + a * 0.5);
    else if (win && !retainLayers && !coat && a > 0.5) win[p] = -1;
  }

  let spriteIndex=0;
  const normalizedDepth=z=>clamp((z-(eyeD-R))/(2*R),0,1);
  function spriteSample(sprite) {
    const {z,alpha,position,protection} = sprite, i = sprite.sdf ? sprite.row.i : -1;
    const rule = i<0 ? protection : subject?.(i);
    const dn=normalizedDepth(z), fogMix=world.fog.max>0&&world.fog.start<1 ?
      targetFog(sstep(world.fog.start,1,dn)*world.fog.max*(exposure?.fog?.(...position)??1),rule) : 0;
    let color=sprite.color, highlight=0, paletteId=0, reflected, claim, stageBase;
    if (i>=0) {
      const packed=d[i*16+7];
      color=live?.albedo(i) ?? [(packed&255)/255, (packed>>8&255)/255, (packed>>16)/255];
      const staged=stages && stages.at(i);
      const sample=(staged?.material || staged?.lit) && (stageMasks ? stageSample(i,position,sprite.p) : undefined);
      const reference = paintStage && baseReference(i);
      const paintedAlbedo = staged?.material && (surface?.paintsBase(i) || reference) ? [] : undefined;
      const choices = sprite.p === paletteTrace?.bottom ? [] : undefined;
      if (staged?.material) color=stagedMaterial(i,staged.material,color,sample,paintedAlbedo,
        choices && paletteTrace.forStage(choices));
      stageBase = reference && (paintedAlbedo?.slice() ?? reference);
      if (live?.normal(i)) {
        live.gains(i,...position,sunGains);
        color=color.map((v,k)=>v*sunGains[k]);
      }
      if (directLight && diffuseNormal(i)) color = directLight(sprite.p, position, sprite.normal, color);
      if (!live?.normal(i) && probeReceiver(i))
        color = probes.shade(position,sprite.normal,color,undefined,0,probeAlbedo(i));
      if (surface?.has(i) && !PIX?.[i*8]) {
        const value=surface.shade(i,...position,X[i],Y[i],Z[i],...color,sprite.p%W+.5,Math.floor(sprite.p/W)+.5,
          undefined,fragmentReflection,paintedAlbedo,stageBase);
        color=value.slice(0,3);
        highlight=value[4]; paletteId=value[5];
        reflected=fragmentReflection?.slice();
      }
      const receiver = contact?.at(i);
      if (receiver) {
        const gain = contact.sample(receiver, sprite.p, position, sprite.normal);
        color = color.map(value => value*gain);
      }
      claim = paletteClaim?.(sprite.p,i,paletteId,color[0],color[1],color[2],choices);
      if (contribution?.applies(i, paletteId)) {
        const anchor = fragmentRule(i);
        const site = sample ?? (contribution.needsSample(i, paletteId, anchor) ? stageSample(i, position, sprite.p) : undefined);
        color = contribution.shade(i, paletteId, color, sprite.p % W, H - 1 - Math.floor(sprite.p / W),
          site, highlight <= .22, undefined, anchor, claim);
      }
      if (staged?.lit) color=RenderStages.apply(staged.lit,color,sample,undefined,claim?.[4] && paletteTrace.forStage(claim[4]));
    }
    if(i<0&&sprite.surface&&!sprite.emission&&directLight&&sprite.normal)color=directLight(sprite.p,position,sprite.normal,color);
    const ink = cutaway?.edge ? Cutaway.edgeWeight(cutaway.edge,sectionAt(position)) : 0;
    const rgb=color.map((value,c)=>{
      const shaded=value+(fog[c]-value)*fogMix;
      return ink ? shaded+(cutaway.edge.color[c]-shaded)*ink : shaded;
    });
    return [i,z,dn,alpha,...rgb,!sprite.effect&&alpha>=.5,false,highlight,paletteId,false,false,
      Boolean(sprite.effect)||alpha<.5,false,undefined,z,sprite,fogMix,
      rule,reflected,false,1,ink>0,claim,paintStage && paintColor(stageBase)];
  }
  function playSprites(through,queued) {
    while (spriteIndex<sprites.length && sprites[spriteIndex].z>=through) {
      const sprite=sprites[spriteIndex++], sample=spriteSample(sprite);
      if (deferred && (queued || sdf?.hits[sprite.p] || emitterHits?.[sprite.p])) {
        if (blendDepth) countDeferred();
        if (!deferred.has(sprite.p)) deferred.set(sprite.p,[]);
        deferred.get(sprite.p).push({ sort:sprite.z,index:spriteIndex-sprites.length-1,center:sprite.z,sample });
      } else composite(sprite.p,...sample);
    }
  }
  function playFragments(sort,through=-Infinity) {
    if (sprites.length) playSprites(through,sortedSurfaces);
    if (counters && deferred.size) counters.deferredFlushes++;
    for (const [p, layers] of deferred) {
      if (sort) {
        layers.sort((a, b) => b.sort - a.sort || a.index - b.index);
        if (blendDepth) blendLayers(layers, blendDepth);
        else if (transparency) SplatOrder.stabilize(layers, transparency.depthTolerance, entry => -entry.sort,
          entry => entry.transparent, entry => entry.index);
      } else if (sprites.length || sdf) {
        layers.sort((a,b)=>b.center-a.center || a.index-b.index);
        if (transparency) SplatOrder.stabilize(layers, transparency.depthTolerance, entry => -entry.center,
          entry => entry.transparent, entry => entry.index);
      }
      for (const entry of layers) {
        const args = entry.sample;
        if (!sort) {
          args[1] = entry.center;
          args[2] = clamp((entry.center - (eyeD - R)) / (2 * R), 0, 1);
        }
        if (blendDepth && entry.transparent) {
          args[3] = entry.opacity;
          args[22] = entry.refraction;
        }
        composite(p, ...args);
      }
    }
    deferred = null;
  }
  // Carriers are below the original color fragments at the same traced depth.
  for (const sample of sdf?.samples ?? []) {
    if (sample.z > surfaceDepth[sample.p]+1e-5) continue;
    if (blendDepth) countDeferred();
    deferred.set(sample.p,[{sort:sample.z,center:sample.z,index:-1e9,transparent:false,sample:spriteSample(sample)}]);
  }
  for (let n = 0; n < order.length; n++) {
    const i = order[n];
    if ((!sortedSurfaces || !deferred) && spriteIndex<sprites.length) playSprites(-depth[i],false);
    const q = i * 16,
      al = AL[i],
      x = X[i],
      y = Y[i],
      z = Z[i];
    const opt = i * OpticalMaterials.STRIDE, opticalActive = optical?.[opt + 3];
    if (al <= 0 || y < -30 || opticalActive && !optical[opt]) continue;
    if (probeView?.allow && (i >= baseCount || !probeView.allow(i))) continue;
    if (
      reflectionPlane &&
      (SceneOptics.planeDistance(reflectionPlane, x, y, z) <= reflectionPlane.bias ||
        (reflectionPlane.select && !reflectionPlane.select(i, x, y, z, world)))
    )
      continue;
    const cx = V[0] * x + V[4] * y + V[8] * z + V[12],
      cy = V[1] * x + V[5] * y + V[9] * z + V[13],
      cz = V[2] * x + V[6] * y + V[10] * z + V[14];
    if (cz > -near) continue;
    const kraw = Math.round(d[q + 11]),
      kind = kraw % 16,
      flags = Math.floor(kraw / 16),
      s2 = SC[i] * SC[i],
      pk = d[q + 7];
    const fieldParticle = i >= baseCount;
    const edgeStrength = edgeStrengthAt && !fieldParticle && !kind && !(kraw & (32 | 64 | 256 | 2048 | 32768)) &&
      !opticalActive && !(paint && d[q + 14] === paint.marker) ? edgeStrengthAt(i) : 0;
    const footprintMargin = integrateFootprint ? .25 : edgeStrength > 0 ? exportOffsets.at(-1) : 0;
    const jStyle = i * 4, packedEdge = world.materialPixelStyles?.[jStyle] || 0;
    const edgeStyle = o.raw ? 0 : ContributionRules.materialEdge(packedEdge);
    const mode = ContributionRules.materialCoverage(packedEdge, coverageMode);
    const softCoverage = o.soft || mode === ContributionRules.softCoverage;
    const continuousCoverage = !softCoverage && !fieldParticle &&
      ContributionRules.continuous(mode, al, kraw, opticalActive || surface?.reveals(i));
    const filterVariance = continuousCoverage ? ContributionRules.continuousVariance * artScale * artScale : .15;
    const styleKey = (kraw & 32768) ? 0 : materialStyles?.[jStyle + 1] || 0;
    const staged = stages ? stages.at(fieldParticle ? -1 : i) : null;
    lookPass?.begin();
    const materialSample = staged?.material?.some(rule => rule.mask) ? stageSample(i, [x, y, z]) : undefined;
    const litMask = staged?.lit?.some(rule => rule.mask);
    const litNormal = litMask ? stageFrame(i).normal : null;
    const liveNormal = live?.normal(i), liveAlbedo = liveNormal && live.albedo(i);
    const lightSlot = i * 4, relit = relight?.[lightSlot + 3];
    let r = liveAlbedo ? liveAlbedo[0] : (pk % 256) / 255,
      g = liveAlbedo ? liveAlbedo[1] : (Math.floor(pk / 256) % 256) / 255,
      b = liveAlbedo ? liveAlbedo[2] : Math.floor(pk / 65536) / 255;
    const reference = paintStage && baseReference(i);
    const paintedAlbedo = staged?.material && (surface?.paintsBase(i) || reference) ? [] : undefined;
    const centerChoices = paletteTrace && staged?.material?.some(rule=>rule.palette) ? [] : undefined;
    if (staged?.material) [r, g, b] = stagedMaterial(i, staged.material, [r, g, b], materialSample,
      paintedAlbedo,centerChoices && paletteTrace.forStage(centerChoices));
    const stageBase = reference && (paintedAlbedo?.slice() ?? reference);
    r += add[i];
    g += add[i];
    b += add[i];
    if (precipitation?.rows[i] && precipitation.lighting) {
      const [lr, lg, lb] = precipitation.lighting(x, y, z);
      r += lr;
      g += lg;
      b += lb;
    }
    if (wet[i]) {
      // wet: darker, and a little bluer, as the page does it
      r *= 1 - 0.42 * wet[i];
      g *= 1 - 0.38 * wet[i];
      b *= 1 - 0.3 * wet[i];
    }
    const core = emissive?.profiles[emissive.slots[i]-1]?.core;
    if (core) [r,g,b] = EmissiveFinishes.coreRgb(core, r,g,b);
    const hasSurface = surface?.has(i);
    const emits = art && (flags & 2) !== 0 && !world.renderMetadata?.muteEmission?.[i];
    const automatic = kind === LightSchedule.emissionKind && d[q + 15] === LightSchedule.emissionMarker;
    const sourceScale = automatic ? LightSchedule.emissionScale(dusk) : 1;
    const scheduled = lamps.length && !(flags & 22) && al >= 1 ? LightSchedule.transfer(lamps, x, y, z) : null;
    const dn = clamp((-cz - (eyeD - R)) / (2 * R), 0, 1);
    const iz = -1 / cz,
      tx = clamp(cx * iz, -limx, limx) / iz,
      ty = clamp(cy * iz, -limy, limy) / iz,
      j00 = ortho ? focal : focal * iz,
      j02 = ortho ? 0 : focal * tx * iz * iz,
      j12 = ortho ? 0 : focal * ty * iz * iz;
    const a0 = j00 * V[0] + j02 * V[2],
      a1 = j00 * V[4] + j02 * V[6],
      a2 = j00 * V[8] + j02 * V[10],
      b0 = j00 * V[1] + j12 * V[2],
      b1 = j00 * V[5] + j12 * V[6],
      b2 = j00 * V[9] + j12 * V[10];
    let c00 = d[q + 4] * s2,
      c01 = d[q + 5] * s2,
      c02 = d[q + 6] * s2,
      c11 = d[q + 8] * s2,
      c12 = d[q + 9] * s2,
      c22 = d[q + 10] * s2;
    if (kind === 2 && (precipitation?.rows[i] || (kraw & Airflow.packedFlag))) {
      // Profile and world precipitation rain are baked vertical. Rebuild its axial covariance along the current flow.
      const [wx, wz] = airAt(x,y,z,motion.rain).velocity, speed = d[q + 13];
      const length = Math.hypot(wx, speed, wz);
      const ax = wx / length, ay = -speed / length, az = wz / length;
      const cross = c00, stretch = c11 - cross;
      c00 = cross + stretch * ax * ax;
      c01 = stretch * ax * ay;
      c02 = stretch * ax * az;
      c11 = cross + stretch * ay * ay;
      c12 = stretch * ay * az;
      c22 = cross + stretch * az * az;
    }
    const u0 = c00 * a0 + c01 * a1 + c02 * a2,
      u1 = c01 * a0 + c11 * a1 + c12 * a2,
      u2 = c02 * a0 + c12 * a1 + c22 * a2,
      w0 = c00 * b0 + c01 * b1 + c02 * b2,
      w1 = c01 * b0 + c11 * b1 + c12 * b2,
      w2 = c02 * b0 + c12 * b1 + c22 * b2;
    const geometryDetail = stableDetail?.geometry && !fieldParticle && !opticalActive && StableDetail.strokeEligible(kraw) &&
      !(paint && d[q + 14] === paint.marker) && !world.effectParticles?.some(({first,count}) => i>=first && i<first+count);
    const projectedA = a0 * u0 + a1 * u1 + a2 * u2, projectedC = b0 * w0 + b1 * w1 + b2 * w2;
    const A = projectedA + filterVariance,
      Bq = b0 * u0 + b1 * u1 + b2 * u2,
      C = projectedC + filterVariance,
      det = A * C - Bq * Bq;
    if (det <= 0) continue;
    const geometryWeight = geometryDetail ? StableDetail.weight(stableDetail.geometry,
      StableDetail.geometryPixels(projectedA,Bq,projectedC,artScale)) : 1;
    if (!geometryWeight) continue;
    const k0 = C / det,
      k1 = -Bq / det,
      k2 = A / det,
      ex = Math.min(3 * Math.sqrt(A) + footprintMargin, 2048),
      ey = Math.min(3 * Math.sqrt(C) + footprintMargin, 2048);
    let cutDx, cutDy, cutReach;
    if (cutaway) {
      // Condition the splat's axial depth on its screen position before testing the world-space boundary.
      const bx=V[2], by=V[6], bz=V[10], ga=-(bx*u0+by*u1+bz*u2), gb=-(bx*w0+by*w1+bz*w2);
      const pure=projectedA*projectedC-Bq*Bq;
      const [q0,q1,q2]=pure>1e-8*Math.max(1,projectedA*projectedC) ?
        [projectedC/pure,-Bq/pure,projectedA/pure] : [k0,k1,k2];
      cutDx=q0*ga+q1*gb;
      cutDy=q1*ga+q2*gb;
      cutReach=3*Math.sqrt(Math.max(0,bx*(c00*bx+c01*by+c02*bz)+by*(c01*bx+c11*by+c12*bz)+bz*(c02*bx+c12*by+c22*bz)));
    }
    let sx = ortho ? ((cx / (oh * asp)) * 0.5 + 0.5) * W : ((((tp / asp) * cx) / -cz) * 0.5 + 0.5) * W,
      sy = ortho ? ((cy / oh) * 0.5 + 0.5) * H : (((tp * cy) / -cz) * 0.5 + 0.5) * H;
    if (kind === 1) {
      sx = Math.floor(sx) + 0.5;
      sy = Math.floor(sy) + 0.5;
    }
    if (centers) {
      centers[i * 2] = sx;
      centers[i * 2 + 1] = H - sy;
    }
    if (sx + ex < 0 || sx - ex > W || sy + ey < 0 || sy - ey > H) continue;
    let coverage = 1,
      glint = 0,
      centerPalette = 0;
    const planar = surface?.planar(i), localProbeReflection = surface?.local(i);
    const pixelSurface = !opticalActive && PIX?.[i * 8] && !surface?.reveals(i) && (!planar || (al >= 1 && !(flags & 1)));
    const projected = surface?.projected(i);
    const reflectedSky = !skyOverlay && surface?.environment(i);
    const fragmentSurface = !pixelSurface && (planar || localProbeReflection || projected || surface?.bevel(i) || surface?.thin(i) || reflectedSky || liveNormal && hasSurface);
    const ditherRule = contribution && fragmentRule(i);
    const detailParticle = fieldParticle || world.effectParticles?.some(({ first, count }) => i >= first && i < first + count);
    const centered = hasSurface && !pixelSurface && !fragmentSurface;
    if (centered) {
      [r, g, b, coverage, glint, centerPalette] = surface.shade(i, x, y, z, x, y, z, r, g, b, undefined, undefined,
        lookPass?.surface, centerReflection, paintedAlbedo, stageBase);
    }
    const splatFlash = flash && !(flags & 6) ? flash.light(x, y, z, liveNormal || (!fieldParticle ? geometrySample(i).normal : null)) : null;
    if (pixelSurface && splatFlash) patternFlashes.set(i, splatFlash);
    const coverGain = !liveNormal && !(flags & 6) && exposure?.light ?
      .24 + .76 * exposure.light(x,y,z) : 1;
    const rule = subject?.(i);
    const contactReceiver = contact?.at(i);
    const directReceiver = directLight && diffuseNormal(i);
    const localProbe = !liveNormal && probeReceiver(i) && diffuseNormal(i);
    const localAlbedo = localProbe && probeAlbedo(i);
    const fogMix = !(flags & 2) && world.fog.max > 0 && world.fog.start < 1
      ? targetFog(sstep(world.fog.start,1,dn)*world.fog.max*(exposure?.fog?.(x,y,z)??1),rule) : 0;
    const reflectInRaster = (planar || localProbeReflection || reflectedSky) && !pixelSurface;
    const finishBeforeFog = reflectInRaster || !pixelSurface && surface?.finishBeforeFog(i);
    const normal = fragmentSurface ? surface.surfaceNormal(i) : null;
    const centerFog = !opticalActive && !finishBeforeFog && !staged?.lit && !liveNormal && !splatFlash && !relit && coverGain === 1;
    if (fogMix && centerFog) {
      r += (fog[0] - r) * fogMix;
      g += (fog[1] - g) * fogMix;
      b += (fog[2] - b) * fogMix;
    }
    const solid = al >= 1,
      writesDepth = !opticalActive && solid && coverage === 1 && !(flags & 1) && mode !== ContributionRules.softCoverage,
      glass = (flags & 16) !== 0,
      x0 = Math.max(0, Math.floor(sx - ex)),
      x1 = Math.min(W - 1, Math.ceil(sx + ex)),
      y0 = Math.max(0, Math.floor(sy - ey)),
      y1 = Math.min(H - 1, Math.ceil(sy + ey));
    let glassLook;
    if (glass && glassIndex) {
      const target = glassIndex.row(i);
      if (!glassLooks.has(target)) glassLooks.set(target, optics.transform(target));
      glassLook = glassLooks.get(target);
    }
    const correction = paint && d[q + 14] === paint.marker;
    const coat = !retainLayers && PIX && (opticalActive || correction || fieldParticle ||
      hasSurface && (!writesDepth || reflectInRaster || surface.reveals(i)));
    if (coat && !surfaceOverlay) surfaceOverlay = new Float32Array(W * H * 4);
    if (audit && (r > 1 || g > 1 || b > 1)) audit.sample('splat', Math.max(0, r), Math.max(0, g), Math.max(0, b));
    r = Math.min(r, 1);
    g = Math.min(g, 1);
    b = Math.min(b, 1);
    drawn++;
    /* inked detail: a dab that carries a tile, and is still the colour it was baked, takes each pixel's colour from the tile, at the
       place on the surface the pixel looks at (the two half-axes of the tile, carried to the screen, and that turned inside out) */
    let fi = -1,
      i00 = 0,
      i01 = 0,
      i10 = 0,
      i11 = 0,
      fineWeight = 1;
    if (!(kraw & 32768) && !liveNormal && FN && FN[i * 12 + 11] && (budgetAt?.(i)?.fine ?? defaultFine) &&
        FN[i * 12 + 7] === pk && !add[i] && kind !== 5 && kind !== 12 && kind !== 13) {
      const f = i * 12,
        sc = SC[i],
        m00 = (a0 * FN[f + 4] + a1 * FN[f + 5] + a2 * FN[f + 6]) * sc,
        m01 = (a0 * FN[f + 8] + a1 * FN[f + 9] + a2 * FN[f + 10]) * sc,
        m10 = (b0 * FN[f + 4] + b1 * FN[f + 5] + b2 * FN[f + 6]) * sc,
        m11 = (b0 * FN[f + 8] + b1 * FN[f + 9] + b2 * FN[f + 10]) * sc,
        dt = m00 * m11 - m01 * m10;
      if (Math.abs(dt) > 1e-4 * (Math.abs(m00 * m11) + Math.abs(m01 * m10) + 1e-9)) {
        fineWeight = stableDetail?.texture ? StableDetail.weight(stableDetail.texture,
          StableDetail.texturePixels(m00,m10,m01,m11,artScale)) : 1;
        if (fineWeight) fi = f;
        i00 = m11 / dt;
        i01 = -m01 / dt;
        i10 = -m10 / dt;
        i11 = m00 / dt;
      }
    }
    const bakedCloud = cloudShadow && !liveNormal && !(flags & 6);
    const lowStyle = materialStyles?.[jStyle + 2], highStyle = materialStyles?.[jStyle + 3];
    const shadeMode = styleKey & 7;
    const shadeFraction = (styleKey - Math.floor(styleKey)) * 2;
    const shadeRaster = (fi < 0 || fineWeight < 1) && (styleKey & MaterialPixelStyle.PAIR) && !pixelSurface &&
      !liveNormal && !staged?.material && !add[i] && !wet[i] && pk === (shadeFraction >= .5 ? highStyle : lowStyle);
    const wantsDepth = probe || deferred || aerial || cloudView || sdf;
    const probeNormal = !fieldParticle && (wantsDepth || bakedCloud) ? geometrySample(i).normal : null;
    const probeCenter = wantsDepth && [x, y, z];
    const probeReach = wantsDepth ? 3 * Math.sqrt(c00 + c11 + c22) : 0;
    const centerMark = lookPass && { ...lookPass.mark };
    for (let iy = y0; iy <= y1; iy++) {
      const dy = iy + 0.5 - sy;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix + 0.5 - sx,
          pw = -0.5 * (k0 * dx * dx + k2 * dy * dy) - k1 * dx * dy;
        const centerAlpha = ContributionRules.alpha(pw, al, solid && !softCoverage, edgeStyle, continuousCoverage);
        let a = centerAlpha;
        if (integrateFootprint) a = footprint(dx, dy, k0, k1, k2, al, solid && !softCoverage, edgeStyle, continuousCoverage);
        else if (edgeStrength > 0) {
          const average = footprint(dx, dy, k0, k1, k2, al, solid && !softCoverage, edgeStyle, continuousCoverage, exportOffsets);
          a += (average - a) * edgeStrength;
        }
        const filteredEdge = edgeStrength > 0 && Math.abs(a - centerAlpha) >= edgeCoverageThreshold;
        a *= geometryWeight;
        if (a < ContributionRules.minimum) continue;
        const p = iy*W+ix, sdfRow = sdf?.rows[i], sdfHit = sdf?.hits[p];
        const preciseDepth = sdfHit || emitterHits?.[p];
        const exact = sdfRow && sdf.fragment(sdfRow,p,rayAt(ix+.5,iy+.5),-cz);
        if (exact === false || exact && pixelSurface && PIX[exact.row.i*8]) continue;
        let sectionZ, sectionTint = 0;
        if (cutaway) {
          sectionZ = exact?.z ?? -cz+clamp(cutDx*dx+cutDy*dy,-cutReach,cutReach);
          if (sectionZ < near) continue;
          let margin;
          if (exact) margin = Cutaway.margin(cutaway,...exact.position,sectionZ-cutoffDepth);
          else {
            const { origin, direction, axial } = rayAt(ix+.5,iy+.5);
            const reach = sectionZ/axial;
            margin=Cutaway.margin(cutaway,
              origin[0]+reach*direction[0],origin[1]+reach*direction[1],origin[2]+reach*direction[2],
              sectionZ-cutoffDepth);
          }
          if (margin < 0) continue;
          sectionTint = Cutaway.edgeWeight(cutaway.edge,margin);
        }
        lookPass?.begin(centerMark);
        let pr = r,
          pg = g,
          pb = b,
          alpha = coverage,
          highlight = glint,
          paletteId = centerPalette;
        if (shadeRaster) {
          const shade = shadeFraction > MaterialPixelStyle.thresholds(shadeMode,
            Math.floor(ix / artScale), Math.floor(iy / artScale)) ? highStyle : lowStyle;
          if (shade !== pk) {
            const visibility = finishBeforeFog || staged?.lit || splatFlash || relit || coverGain < 1 ? 1 : 1 - fogMix;
            const gain = visibility / 255;
            pr += ((shade & 255) - (pk & 255)) * gain;
            pg += ((shade >> 8 & 255) - (pk >> 8 & 255)) * gain;
            pb += ((shade >> 16) - (pk >> 16)) * gain;
          }
        }
        let materialChoices = centerChoices;
        if (fi >= 0) {
          const u = clamp(Math.floor((i00 * dx + i01 * dy) * 2 + 2), 0, 3),
            v = clamp(Math.floor((i10 * dx + i11 * dy) * 2 + 2), 0, 3),
            c = FPAL[Math.floor(FN[fi + v] / (u === 0 ? 1 : u === 1 ? 64 : u === 2 ? 4096 : 262144)) % 64];
          if (c) {
            if (centerChoices && p === paletteTrace.bottom && !world.materialAlbedo?.[i]) materialChoices = [];
            const tile = staged?.material ? stagedMaterial(i, staged.material, c, materialSample,undefined,
              materialChoices !== centerChoices ? paletteTrace.forStage(materialChoices) : undefined) : c;
            const tileFog = !finishBeforeFog && !staged?.lit && !splatFlash && !relit && coverGain === 1 ? fogMix : 0;
            pr = (tile[0] + (fog[0] - tile[0]) * tileFog) * fineWeight + pr * (1 - fineWeight);
            pg = (tile[1] + (fog[1] - tile[1]) * tileFog) * fineWeight + pg * (1 - fineWeight);
            pb = (tile[2] + (fog[2] - tile[2]) * tileFog) * fineWeight + pb * (1 - fineWeight);
          }
        }
        if (liveNormal) {
          const point = exact?.position ?? surfacePoint(rayAt(ix + .5, iy + .5), liveNormal, x, y, z, -cz, R);
          live.gains(i, ...point, sunGains);
          pr *= sunGains[0];
          pg *= sunGains[1];
          pb *= sunGains[2];
        }
        if (coverGain < 1) {
          pr *= coverGain;
          pg *= coverGain;
          pb *= coverGain;
        }
        if (automatic || scheduled) {
          const exposure = scheduled?.gain ?? sourceScale;
          const tint = scheduled?.color;
          pr = Math.min(1, pr * exposure + (tint?.[0] ?? 0));
          pg = Math.min(1, pg * exposure + (tint?.[1] ?? 0));
          pb = Math.min(1, pb * exposure + (tint?.[2] ?? 0));
        }
        let hit, reflected = centered ? centerReflection : undefined, samplePaint=stageBase;
        if (fragmentSurface) {
          hit = exact?.position ?? surfacePoint(rayAt(ix + 0.5, iy + 0.5), normal, x, y, z, -cz, R);
          if (stageBase && surface.paintsBase(i)) samplePaint=stageBase.slice();
          [pr, pg, pb, alpha, highlight, paletteId] = surface.shade(i, ...hit, x, y, z, pr, pg, pb, ix + 0.5, iy + 0.5,
            lookPass?.surface, fragmentReflection, paintedAlbedo, samplePaint);
          reflected = fragmentReflection;
        }
        if (relit) {
          pr = Math.min(1, pr * relight[lightSlot]);
          pg = Math.min(1, pg * relight[lightSlot + 1]);
          pb = Math.min(1, pb * relight[lightSlot + 2]);
        }
        if (contactReceiver) {
          const gain = contact.pixel(contactReceiver, p, ix + .5, iy + .5, -cz, exact);
          const bakedFog = centerFog ? fogMix : 0;
          pr -= Math.max(0, pr - fog[0]*bakedFog)*(1 - gain);
          pg -= Math.max(0, pg - fog[1]*bakedFog)*(1 - gain);
          pb -= Math.max(0, pb - fog[2]*bakedFog)*(1 - gain);
        }
        if (directReceiver || localProbe) {
          const n = exact?.normal ?? (directReceiver || localProbe);
          const point = exact?.position ?? surfacePoint(rayAt(ix+.5,iy+.5),n,x,y,z,-cz,3*Math.sqrt(c00+c11+c22));
          if (directReceiver) [pr,pg,pb] = directLight(p,point,n,[pr,pg,pb],fog,centerFog ? fogMix : 0);
          if (localProbe) [pr,pg,pb] = probes.shade(point,n,[pr,pg,pb],fog,centerFog ? fogMix : 0,localAlbedo);
        }
        const scoped = contribution?.applies(i, paletteId);
        if (opticalActive) {
          const scatter = optical[opt + 1], reflection = optical[opt + 2], tint = optical[opt + 4] >= 0;
          pr = (tint ? optical[opt + 4] : pr) * scatter + optical[opt + 8] * reflection;
          pg = (tint ? optical[opt + 5] : pg) * scatter + optical[opt + 9] * reflection;
          pb = (tint ? optical[opt + 6] : pb) * scatter + optical[opt + 10] * reflection;
          a *= optical[opt];
        }
        const claim = paletteClaim?.(p,i,paletteId,pr,pg,pb,materialChoices);
        if (staged?.lit || scoped || glassLook) {
          let sample;
          if (litMask || (scoped && contribution.needsSample(i, paletteId, ditherRule))) {
            const sampleNormal = litNormal ?? stageFrame(i).normal;
            const point = hit ?? (sampleNormal ?
              surfacePoint(rayAt(ix + .5, iy + .5), sampleNormal, x, y, z, -cz, R) : [x, y, z]);
            sample = stageSample(i, point, p);
          }
          let rgb = [pr, pg, pb];
          if (scoped) {
            rgb = contribution.shade(i, paletteId, rgb, ix, H - 1 - iy, sample, highlight <= .22,
              lookPass?.palette, ditherRule, claim);
          }
          const traceStage = claim?.[4] && paletteTrace.forStage(claim[4]);
          if (staged?.lit) rgb = RenderStages.apply(staged.lit, rgb, sample, lookPass?.stage, traceStage);
          [pr, pg, pb] = glassLook ? glassLook(rgb, lookPass?.optics, traceStage) : rgb;
        }
        if (bakedCloud) {
          const point = hit ?? (probeNormal ?
            surfacePoint(rayAt(ix + .5, iy + .5), probeNormal, x, y, z, -cz, R) : [x, y, z]);
          const gain = CloudField.dim(cloudShadow(...point));
          pr *= gain;
          pg *= gain;
          pb *= gain;
          if (claim) for (let c=1;c<=3;c++) claim[c] *= gain;
        }
        if (splatFlash) {
          pr = Lightning.shade(pr, splatFlash[0]);
          pg = Lightning.shade(pg, splatFlash[1]);
          pb = Lightning.shade(pb, splatFlash[2]);
        }
        if (opticalActive || staged?.lit || (fragmentSurface && finishBeforeFog) || liveNormal || splatFlash || relit || coverGain < 1) {
          pr += (fog[0] - pr) * fogMix;
          pg += (fog[1] - pg) * fogMix;
          pb += (fog[2] - pb) * fogMix;
        }
        if (sectionTint) {
          const [rr,gg,bb]=cutaway.edge.color;
          pr+=(rr-pr)*sectionTint;
          pg+=(gg-pg)*sectionTint;
          pb+=(bb-pb)*sectionTint;
        }
        a *= alpha;
        if (a < 0.004) continue;
        const wd = writesDepth && alpha === 1 && !exact;
        const surfaceZ = sectionZ ?? exact?.z ?? (wantsDepth ?
          sampledDepth(rayAt(ix + .5, iy + .5), probeNormal, probeCenter, -cz, probeReach) : -cz);
        if (preciseDepth && surfaceDepth && surfaceZ>surfaceDepth[p]+1e-5) continue;
        if (probe) probe(p, i, -cz, surfaceZ, pr, pg, pb, a);
        if (!blendDepth && deferred && deferredCount >= fragmentBudget) {
          playFragments(false,-cz);
          orderFallback = true;
        }
        const opticalDepth = cutaway || blendDepth || aerial || cloudView || preciseDepth ? surfaceZ : undefined;
        if (deferred && (sortedSurfaces || preciseDepth)) {
          const entry = { sort: (flags & 4 || blendDepth && backRows?.has(i)) ? Infinity : surfaceZ, index: n, center: exact?.z ?? -cz,
            transparent: !wd && !exact && !(flags & 4) && !(blendDepth && backRows?.has(i)), opacity: a,
            pane: blendDepth && glass && bend ? renderMeta?.objectIds?.[i] || -pk - 1 : 0,
            sample: [i, surfaceZ, normalizedDepth(surfaceZ), a, pr, pg, pb,
              wd, emits, highlight, paletteId, detailParticle, projected, coat, glass, lookPass && { ...lookPass.mark },
              opticalDepth, undefined, fogMix, rule, reflected?.slice(), filteredEdge, 1, sectionTint>0, claim,
              paintStage && paintColor(samplePaint)] };
          countDeferred();
          if (!deferred.has(p)) deferred.set(p, []);
          deferred.get(p).push(entry);
        } else composite(p, i, sectionZ ?? exact?.z ?? -cz, sectionZ !== undefined || exact ? normalizedDepth(surfaceZ) : dn,
          a, pr, pg, pb, wd, emits, highlight, paletteId, detailParticle, projected, coat, glass, lookPass?.mark, opticalDepth,
          undefined, fogMix, rule, reflected, filteredEdge, 1, sectionTint>0, claim, paintStage && paintColor(samplePaint));
      }
    }
  }
  if (deferred) playFragments(true);
  else if (spriteIndex<sprites.length) playSprites(-Infinity,false);
  /* colour per pixel. Each pixel's line of sight is met with the plane of the dab in front there (the way its surface truly faces),
     and the pixel is coloured at that exact place: by its pattern, if it has one, or by its ramp. How lit it is is the mean over the
     pixels round it that lie on the same ramp and surface, so the edges between bands are drawn by the pixels, not by the dabs */
  if (PIX) {
    const PT = world.pixTex || [],
      RP = world.ramps || [],
      R00 = V[0],
      R01 = V[4],
      R02 = V[8],
      R10 = V[1],
      R11 = V[5],
      R12 = V[9],
      R20 = V[2],
      R21 = V[6],
      R22 = V[10],
      ex = -(R00 * V[12] + R10 * V[13] + R20 * V[14]),
      ey = -(R01 * V[12] + R11 * V[13] + R21 * V[14]),
      ez = -(R02 * V[12] + R12 * V[13] + R22 * V[14]),
      lit = new Float32Array(W * H),
      PALC = world.pal.map((h, k) => hex(k)),
      VW = world.pixView,
      shaper = o.lightShape === undefined ? !!(world.look && world.look.pixel) : !!o.lightShape;
    // (patterns drawn as little upright pictures need to know where the picture is looked at from, and which pixel is asked about)
    if (VW)
      Object.assign(VW, {
        on: true,
        t,
        R: [R00, R01, R02, R10, R11, R12, R20, R21, R22],
        e: [ex, ey, ez],
        tp,
        ortho,
        oh,
        asp,
        W,
        H
      });
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        if (i < 0 || !PIX[i * 8]) continue;
        /* the light, smoothed over the same surface round the pixel: three by three; with the light shaper (o.lightShape, on for
           pixel-art dioramas, as on the page) also over seven by seven, only where the surface faces much the same way, so light and
           shade fall in a few big shapes with smooth edges. Near the edge of a surface the big window is cut in half and its mean
           would pull a lit rim toward the middle (shading that follows the outline): there the three by three is kept */
        let sum = 0,
          cnt = 0,
          s7 = 0,
          c7 = 0;
        const rad = shaper ? 3 : 1;
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            const X2 = x + dx,
              Y2 = y + dy;
            if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            if (cutaway) {
              const {origin,direction,axial}=rayAt(X2+.5,Y2+.5), reach=-cz/axial;
              if (Cutaway.margin(cutaway,origin[0]+reach*direction[0],origin[1]+reach*direction[1],
                origin[2]+reach*direction[2],-cz-cutoffDepth)<0) continue;
            }
            const q = Y2 * W + X2,
              j = win[q];
            if (j < 0 || PIX[j * 8] !== PIX[i * 8]) continue;
            const dd = Math.abs(dep[q] - dep[p]);
            if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && dd <= 0.01) {
              sum += PIX[j * 8 + 1];
              cnt++;
            }
            if (
              shaper &&
              ((dx + dy) & 1) === 0 && // (the wide window every other pixel, a checkerboard, as on the page)
              dd <= 0.03 &&
              PIX[i * 8 + 3] * PIX[j * 8 + 3] + PIX[i * 8 + 4] * PIX[j * 8 + 4] + PIX[i * 8 + 5] * PIX[j * 8 + 5] >= 0.8
            ) {
              s7 += PIX[j * 8 + 1];
              c7++;
            }
          }
        lit[p] = sum / cnt;
        if (shaper && c7) {
          const k = Math.min(1, Math.max(0, (c7 / 25 - 0.5) / 0.35)),
            sm = k * k * (3 - 2 * k);
          lit[p] += (s7 / c7 - lit[p]) * sm;
        }
      }
    pixed = new Uint8Array(W * H);
    const bounceTints = live?.hasBounce && new Float32Array(W * H * 3);
    const HX = new Float32Array(W * H),
      HY = new Float32Array(W * H),
      HZ = new Float32Array(W * H);
    const key = new Float64Array(W * H).fill(NaN),
      cB = new Int16Array(W * H).fill(-1),
      cBelow = new Int16Array(W * H),
      cAbove = new Int16Array(W * H),
      cLeft = new Int16Array(W * H),
      CELL = world.pixCell || { body: 0, below: 0, above: 0, left: 0 };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        if (i < 0 || !PIX[i * 8]) continue;
        const f = i * 8,
          ramp = RP[PIX[f] - 1];
        let nx = PIX[f + 3], ny = PIX[f + 4], nz = PIX[f + 5];
        if (surface?.has(i)) [nx, ny, nz] = surface.normalAt(i, [nx, ny, nz]);
        const vx = (((x + 0.5) / W) * 2 - 1) * (ortho ? oh * asp : asp / tp),
          vy = (((y + 0.5) / H) * 2 - 1) * (ortho ? oh : 1 / tp),
          // (orthographic: each ray starts at its own point on the picture's plane, and all run straight ahead)
          ox0 = ortho ? ex + R00 * vx + R10 * vy : ex,
          oy0 = ortho ? ey + R01 * vx + R11 * vy : ey,
          oz0 = ortho ? ez + R02 * vx + R12 * vy : ez,
          dxw = ortho ? -R20 : R00 * vx + R10 * vy - R20,
          dyw = ortho ? -R21 : R01 * vx + R11 * vy - R21,
          dzw = ortho ? -R22 : R02 * vx + R12 * vy - R22,
          den = nx * dxw + ny * dyw + nz * dzw,
          sd = Math.abs(den) > 1e-6 ? (nx * (X[i] - ox0) + ny * (Y[i] - oy0) + nz * (Z[i] - oz0)) / den : 0,
          exact = sdf?.hits[p]?.row.i===i ? sdf.hits[p].position : null,
          px = exact ? exact[0] : sd ? ox0 + dxw * sd : X[i],
          py = exact ? exact[1] : sd ? oy0 + dyw * sd : Y[i],
          pz = exact ? exact[2] : sd ? oz0 + dzw * sd : Z[i],
          pat = PIX[f + 2],
          ev = pat ? PT[pat - 1] : null,
          /* (how big a screen pixel is, for the patterns' detail: one for the whole picture, from the camera's distance alone, as on the
             page; from each surface's slant it would differ from pixel to pixel and change as the view turns, and details flicker) */
          fp = (dist * 2) / (tp * H);
        if (VW) ((VW.x = x), (VW.y = y));
        HX[p] = px;
        HY[p] = py;
        HZ[p] = pz;
        if (live?.normal(i)) {
          if (bounceTints) {
            lit[p] = live.rampLevel(i, px, py, pz, sunGains);
            bounceTints.set(sunGains, p * 3);
          } else lit[p] = live.level(i, px, py, pz);
        }
        const styleKey = materialStyles?.[i * 4 + 1];
        if (styleKey) lit[p] = MaterialPixelStyle.pixelShade(lit[p], styleKey,
          Math.floor(x / artScale), Math.floor(y / artScale), ramp?.length || 1);
        if (ev && ev.cell) {
          key[p] = ev.cell(
            px,
            py,
            pz,
            ny,
            lit[p],
            nx,
            nz,
            null,
            fp,
            ramp,
            world.pixUnfold ? world.pixUnfold(PIX[f + 6], PIX[f + 7]) : null
          );
          cB[p] = CELL.body;
          cBelow[p] = CELL.below;
          cAbove[p] = CELL.above;
          cLeft[p] = CELL.left;
        } else
          cB[p] = ev
            ? ev.tex(
                px,
                py,
                pz,
                ny,
                lit[p],
                nx,
                nz,
                null,
                fp,
                ramp,
                world.pixUnfold ? world.pixUnfold(PIX[f + 6], PIX[f + 7]) : null
              )
            : ramp
              ? ramp[clamp(Math.floor(lit[p] * ramp.length), 0, ramp.length - 1)]
              : -1;
      }
    if (VW) VW.on = false;
    // a pixel at the edge of its cell takes that edge's colour: lower edge first, then the side, then the upper edge
    const kAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NaN : key[y * W + x]),
      differs = (k, q) => q === q && q !== k;
    /* outlines (look.outline), as on the page: a pixel at the edge of a thing, where it meets another material, the background, or
       something well behind it, and is the nearer of the two, takes a darker step of its own ramp (two by default), so each thing is
       ringed in its own darker colour and a lit edge in a softer one. A material with line: false (clouds, water) has none */
    const OLo = ink || o.artInkActive ? null : look.outline,
      OL = OLo ? (OLo === true ? {} : OLo) : null,
      olK = OL && OL.k !== undefined ? OL.k : 2,
      olEps = OL ? (OL.eps === undefined ? 0.6 : OL.eps) / (world.detail || 12) / (2 * R) : 0,
      olGap = OL ? (OL.gap === undefined ? 0.3 : OL.gap) / (2 * R) : 0,
      OFF = world.rampOff || [],
      N4 = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
      ];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        let ci = cB[p];
        if (ci < 0) continue;
        const k = key[p];
        if (k === k) {
          if (differs(k, kAt(x, y - 1))) ci = cBelow[p];
          else if (differs(k, kAt(x - 1, y))) ci = cLeft[p];
          else if (differs(k, kAt(x, y + 1))) ci = cAbove[p];
        }
        if (OL) {
          const rid = PIX[i * 8];
          if (!OFF[rid - 1]) {
            let edge = false,
              sky = false;
            for (const [dx, dy] of N4) {
              const X2 = x + dx,
                Y2 = y + dy;
              if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            if (cutaway) {
              const {origin,direction,axial}=rayAt(X2+.5,Y2+.5), reach=-cz/axial;
              if (Cutaway.margin(cutaway,origin[0]+reach*direction[0],origin[1]+reach*direction[1],
                origin[2]+reach*direction[2],-cz-cutoffDepth)<0) continue;
            }
              const q = Y2 * W + X2,
                dd = dep[q] - dep[p];
              if (dd <= olEps) continue;
              const j = win[q];
              if (j < 0 || PIX[j * 8] !== rid || dd > olGap) {
                edge = true;
                sky = dep[q] >= 0.995;
                break;
              }
            }
            /* (and a crease: where its own surface turns sharply, as the edge of a block of stone or a crate, the lit side of the turn
                takes a step lighter and the other a step darker, a bevel two pixels wide. Not in leaves or grass) */
            let crease = 0;
            const pk = PIX[i * 8 + 2] ? (world.pats[PIX[i * 8 + 2] - 1] || {}).kind : null;
            if (!edge && OL.crease !== false && pk !== 'leaves' && pk !== 'turf')
              for (const [dx, dy] of N4) {
                const X2 = x + dx,
                  Y2 = y + dy;
                if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            if (cutaway) {
              const {origin,direction,axial}=rayAt(X2+.5,Y2+.5), reach=-cz/axial;
              if (Cutaway.margin(cutaway,origin[0]+reach*direction[0],origin[1]+reach*direction[1],
                origin[2]+reach*direction[2],-cz-cutoffDepth)<0) continue;
            }
                const q = Y2 * W + X2,
                  j = win[q];
                if (j < 0 || PIX[j * 8] !== rid || Math.abs(dep[q] - dep[p]) > olGap) continue;
                if (
                  PIX[i * 8 + 3] * PIX[j * 8 + 3] + PIX[i * 8 + 4] * PIX[j * 8 + 4] + PIX[i * 8 + 5] * PIX[j * 8 + 5] >
                  0.7
                )
                  continue;
                crease = PIX[i * 8 + 1] >= PIX[j * 8 + 1] ? 1 : -1;
                break;
              }
            if (edge || crease) {
              const ramp = RP[rid - 1],
                b = ramp.indexOf(ci);
              /* (a rim in the light takes a softer line than one in shade, or none against another thing, as on the page: so the outline
                 does not darken a shape all round, whichever way it faces, which is pillow shading) */
              const k2 = b * 2 >= ramp.length ? (sky ? 1 : 0) : olK;
              if (b >= 0) ci = ramp[Math.max(0, Math.min(ramp.length - 1, edge ? b - k2 : b + crease))];
            }
          }
          pixed[p] = 1;
        }
        if (!PALC[ci]) continue;
        const fieldParticle = i >= baseCount;
    const staged = stages ? stages.at(fieldParticle ? -1 : i) : null;
        lookPass?.begin();
        const masked = staged?.material?.some(rule => rule.mask) || staged?.lit?.some(rule => rule.mask);
        const sample = masked ? stageSample(i, [HX[p], HY[p], HZ[p]], p) : undefined;
        const reference = paintStage && baseReference(i);
        const paintedAlbedo = staged?.material && (surface?.paintsBase(i) || reference) ? [] : undefined;
        const choices = p === paletteTrace?.bottom ? [] : undefined;
        let base = staged?.material ? stagedMaterial(i, staged.material, PALC[ci], sample, paintedAlbedo,
          choices && paletteTrace.forStage(choices)) : PALC[ci];
        const stageBase = reference && (paintedAlbedo?.slice() ?? reference);
        if (exposure?.light && !live?.normal(i) && !(Math.round(d[i*16+11]) & (32 | 64))) {
          const gain = .24 + .76 * exposure.light(HX[p],HY[p],HZ[p]);
          if (gain < 1) base = base.map(value => value * gain);
        }
        if (bounceTints && live.normal(i)) base = base.map((value, channel) => value * bounceTints[p * 3 + channel]);
        const receiverNormal = (directLight || !live?.normal(i) && probeReceiver(i)) && diffuseNormal(i);
        if (receiverNormal) {
          const exact = sdf?.hits[p], point = exact?.position ?? [HX[p],HY[p],HZ[p]], n = exact?.normal ?? receiverNormal;
          if (directLight) base = directLight(p,point,n,base);
          if (!live?.normal(i) && probeReceiver(i)) base = probes.shade(point,n,base,undefined,0,probeAlbedo(i));
        }
        const finishedSurface = surface?.has(i);
        const c = finishedSurface ? surface.shade(i, HX[p], HY[p], HZ[p], X[i], Y[i], Z[i], ...base, x + 0.5, y + 0.5,
          lookPass?.surface, fragmentReflection,undefined,stageBase) : base;
        if (paintStage) paintStage[p]=paintColor(stageBase);
        if (finishedSurface && reflectPass) environmentPasses.pattern(p,fragmentReflection);
        let rgb = c;
        const lightSlot = i * 4;
        if (relight?.[lightSlot + 3]) rgb = c.slice(0, 3).map((value, channel) =>
          Math.min(1, value * relight[lightSlot + channel]));
        const receiver = contact?.at(i);
        if (receiver) {
          const point = [HX[p], HY[p], HZ[p]], exact = sdf?.hits[p];
          const gain = exact ? contact.sample(receiver, p, exact.position, exact.normal) : contact.sample(receiver, p, point);
          if (gain < 1) rgb = rgb.slice(0, 3).map(value => value*gain);
        }
        const claim = paletteClaim?.(p,i,c[5],rgb[0],rgb[1],rgb[2],choices);
        if (contribution?.applies(i, c[5])) {
          const rule = fragmentRule(i);
          const site = sample ?? (contribution.needsSample(i, c[5], rule) ?
            stageSample(i, [HX[p], HY[p], HZ[p]], p) : undefined);
          rgb = contribution.shade(i, c[5], rgb, x, H - 1 - y, site, !(c[4] > .22), lookPass?.palette, rule, claim);
        }
        let lit = staged?.lit ? RenderStages.apply(staged.lit, rgb, sample, lookPass?.stage,
          claim?.[4] && paletteTrace.forStage(claim[4])) : rgb;
        if (cloudShadow && !live?.normal(i) && !(Math.round(d[i * 16 + 11]) & (32 | 64))) {
          const gain = CloudField.dim(cloudShadow(HX[p], HY[p], HZ[p]));
          lit = [lit[0] * gain, lit[1] * gain, lit[2] * gain];
          if (claim) for (let c=1;c<=3;c++) claim[c] *= gain;
        }
        const patternFlash = patternFlashes?.get(i);
        if (patternFlash) lit = lit.slice(0, 3).map((value, c) => Lightning.shade(value, patternFlash[c]));
        if (foreground && !(d[i*16+11] & 32))
          lit = foreground(foregroundDepth(eyeD-R+dep[p]*2*R),lit[0],lit[1],lit[2],contrastColor);
        if (lookPass) lookPass.fragment(p, retainLayers ? contributions.weight(p) : 1 - (surfaceOverlay?.[p * 4 + 3] || 0),
          lookPass.mark, true);
        const protectionRule = subject?.(i);
        if (protectionRule && protectionRule.contrast !== 1 && !(d[i*16+11] & 32))
          lit = subjectColor(protectionRule,lit[0],lit[1],lit[2]);
        const kf = world.fog.max > 0 && world.fog.start < 1
          ? targetFog(sstep(world.fog.start,1,dep[p])*world.fog.max*(exposure?.fog?.(HX[p],HY[p],HZ[p])??1),protectionRule) : 0;
        if (surfaceGlint) surfaceGlint[p] = c[4] > 0.22;
        if (claim) paletteCapture?.claim(p,claim[0],claim);
        if (claim?.[4]) paletteTrace.fragment = claim[4];
        if (retainLayers) {
          if (localAt) localAt[p] = localSlot(i, c[5], p);
          const shaded = [0, 1, 2].map(channel => lit[channel] + (fog[channel] - lit[channel]) * kf);
          contributions.replacePattern(p, rayMedia ? rayMedia.shade(p, axialDepth[p], shaded, true, protectionRule?.fogScale) : shaded);
          if (detail && surface?.projected(i) && c[4] > 0.22) detail[(H - 1 - y) * W + x] = 1;
          continue;
        }
        if ((surfaceOverlay?.[p * 4 + 3] || 0) < 0.5) {
          if (localAt) localAt[p] = localSlot(i, c[5], p);
          if (detail && surface?.projected(i) && c[4] > 0.22) detail[(H - 1 - y) * W + x] = 1;
        }
        if (edgePatterns && edgePixels[p] >= edgeCoverageThreshold && edgeStrengthAt(i)) {
          edgePatterns.replacePattern(p, lit.slice(0, 3).map((value, k) => value + (fog[k] - value) * kf));
          continue;
        }
        col[p * 3] = lit[0] + (fog[0] - lit[0]) * kf;
        col[p * 3 + 1] = lit[1] + (fog[1] - lit[1]) * kf;
        col[p * 3 + 2] = lit[2] + (fog[2] - lit[2]) * kf;
        if (captured) {
          const coat = surfaceOverlay?.[p * 4 + 3] || 0;
          const baseAlpha = (captured[p] - coat) / Math.max(1e-6, 1 - coat);
          for (let channel = 0; channel < 3; channel++) col[p * 3 + channel] *= clamp(baseAlpha, 0, 1);
        }
        if (surfaceOverlay) {
          const j = p * 4,
            through = 1 - surfaceOverlay[j + 3];
          for (let channel = 0; channel < 3; channel++) {
            col[p * 3 + channel] = surfaceOverlay[j + channel] + col[p * 3 + channel] * through;
          }
        }
      }
    // (o.pick: where on the surface each pixel lies, for the paint-over tool; rows from the bottom, as everything here)
    if (o.pick) Object.assign(o.pick, { W, H, X: HX, Y: HY, Z: HZ, win, PIX, dep, camera: paintView });
    /* edge sprites (K.pixel.edge; o.edges, on by default), as on the page: little pixel pictures stood on points pinned to the
       surface (K.pixel.anchors; the world's pixAnchors), each moving with the dab it stands on, turned the way its surface faces
       on the screen (up, to a side, down), and shown only past the edge of that surface: over the background, over something well
       behind, or over anything that is not its own surface; never over what is nearer. So as the view turns, a sprite whose point
       goes round behind an edge sinks behind it a pixel at a time. Where two cover a pixel the nearer wins */
    const AN = o.edges !== false && world.pixAnchors ? world.pixAnchors(world) : null;
    if (AN && AN.n) {
      const EP = (world.pats || []).map(pt => pt && pt.edge),
        OLe = (world.look || {}).outline,
        eGap = (OLe && OLe !== true && OLe.gap !== undefined ? OLe.gap : 0.3) / (2 * R),
        fpe = (dist * 2) / (tp * H),
        keep = Math.min(1, (0.25 * (1 / (world.detail || 12))) / fpe),
        tol = 3 * fpe + 0.02,
        OD = [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0, -1]
        ],
        TD = [
          [1, 0],
          [0, -1],
          [0, 1],
          [1, 0]
        ],
        A = AN.data,
        sprD = new Float32Array(W * H).fill(9),
        sprC = new Int16Array(W * H).fill(-1),
        sprOwner = art || foreground || subject || relight ? new Int32Array(W * H) : null;
      for (let a = 0; a < AN.n; a++) {
        const q0 = a * 12,
          ed = EP[A[q0 + 8]];
        if (!ed || A[q0 + 7] >= keep * (ed.share === undefined ? 0.7 : ed.share)) continue;
        const i = A[q0 + 3];
        if(Math.round(d[i*16+11])&32768)continue;
        const ax = A[q0] + X[i] - d[i * 16],
          ay = A[q0 + 1] + Y[i] - d[i * 16 + 1],
          az = A[q0 + 2] + Z[i] - d[i * 16 + 2],
          nx = A[q0 + 4],
          ny = A[q0 + 5],
          nz = A[q0 + 6],
          cx = V[0] * ax + V[4] * ay + V[8] * az + V[12],
          cy = V[1] * ax + V[5] * ay + V[9] * az + V[13],
          cz = V[2] * ax + V[6] * ay + V[10] * az + V[14];
        if (cz > -near) continue;
        const sx = ortho ? ((cx / (oh * asp)) * 0.5 + 0.5) * W : ((((tp / asp) * cx) / -cz) * 0.5 + 0.5) * W,
          sy = ortho ? ((cy / oh) * 0.5 + 0.5) * H : (((tp * cy) / -cz) * 0.5 + 0.5) * H,
          px1 = Math.floor(sx),
          py1 = Math.floor(sy);
        if (px1 < -8 || py1 < -8 || px1 > W + 8 || py1 > H + 8) continue;
        // which way the surface faces on the screen; one that faces the eye has no way out, and stands nothing
        const vx = V[0] * nx + V[4] * ny + V[8] * nz,
          vy = V[1] * nx + V[5] * ny + V[9] * nz,
          vz = V[2] * nx + V[6] * ny + V[10] * nz,
          cl = Math.hypot(cx, cy, cz),
          facing = ortho ? -vz : (vx * cx + vy * cy + vz * cz) / cl;
        if (Math.abs(facing) > 0.95) continue;
        let dx = ortho ? vx : -vx * cz + cx * vz,
          dy = ortho ? vy : -vy * cz + cy * vz;
        const dl = Math.hypot(dx, dy);
        if (dl < 1e-12) continue;
        dx /= dl;
        dy /= dl;
        const cat = dy > 0.38 ? 0 : dy < -0.38 ? 3 : dx > 0 ? 1 : 2,
          list = cat === 0 ? ed.up : cat === 3 ? ed.down : ed.side;
        if (!list.length) continue;
        const sp = list[Math.min(list.length - 1, Math.floor(A[q0 + 11] * list.length))],
          ramp = RP[A[q0 + 9]],
          b = clamp(Math.floor(A[q0 + 10] * ramp.length), 0, ramp.length - 1),
          dA = (-cz - (eyeD - R)) / (2 * R),
          [odx, ody] = OD[cat],
          [tdx, tdy] = TD[cat];
        for (let r = 0; r < sp.h; r++)
          for (let c = 0; c < sp.w; c++) {
            const v = sp.cells[r * sp.w + c];
            if (!v) continue;
            const ou = r + 1 - sp.sink,
              al = c - sp.ax,
              X2 = px1 + odx * ou + tdx * al,
              Y2 = py1 + ody * ou + tdy * al;
            if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            if (cutaway) {
              const {origin,direction,axial}=rayAt(X2+.5,Y2+.5), reach=-cz/axial;
              if (Cutaway.margin(cutaway,origin[0]+reach*direction[0],origin[1]+reach*direction[1],
                origin[2]+reach*direction[2],-cz-cutoffDepth)<0) continue;
            }
            const q = Y2 * W + X2,
              dp = dep[q];
            if (dA >= sprD[q]) continue;
            let show;
            if (dp >= 0.995) show = true;
            else if (dp < dA - 0.008)
              show = false; // (something nearer stands here)
            else if (r < sp.sink)
              show = true; // (the root rows lie over the thing itself)
            else {
              const j = win[q];
              show =
                j < 0 || !PIX[j * 8]
                  ? dp - dA > eGap
                  : Math.abs((HX[q] - ax) * nx + (HY[q] - ay) * ny + (HZ[q] - az) * nz) > tol;
            }
            if (!show) continue;
            sprD[q] = dA;
            if (sprOwner) sprOwner[q] = i;
            sprC[q] = v >= 100 ? v - 100 : ramp[clamp(b + v - 8, 0, ramp.length - 1)];
          }
      }
      sprM = new Uint8Array(W * H);
      for (let q = 0; q < W * H; q++) {
        if (sprC[q] < 0 || !PALC[sprC[q]]) continue;
        const depth = eyeD - R + sprD[q] * 2 * R;
        let c = PALC[sprC[q]];
        const lightSlot = sprOwner?.[q] * 4;
        if (relight?.[lightSlot + 3]) c = c.map((value, channel) => Math.min(1, value * relight[lightSlot + channel]));
        if (cloudShadow) {
          const { origin, direction, axial } = rayAt(q % W + .5, Math.floor(q / W) + .5);
          const distance = depth / axial;
          const gain = CloudField.dim(cloudShadow(origin[0] + direction[0] * distance,
            origin[1] + direction[1] * distance, origin[2] + direction[2] * distance));
          c = c.map(value => value * gain);
        }
        if (foreground && !(d[sprOwner?.[q]*16+11] & 32))
          c = foreground(foregroundDepth(depth),c[0],c[1],c[2],contrastColor);
        const rule = subject?.(sprOwner[q]);
        if (rule && rule.contrast !== 1 && !(d[sprOwner[q]*16+11] & 32))
          c = subjectColor(rule,c[0],c[1],c[2]);
        if (rayMedia) c = rayMedia.shade(q, depth, c, true, rule?.fogScale);
        if (fogScales || silhouetteMask) subjectPixel(q,rule);
        col[q * 3] = c[0];
        col[q * 3 + 1] = c[1];
        col[q * 3 + 2] = c[2];
        if (transparent) captured[q] = 1;
        if (edgePixels) edgePixels[q] = 0;
        if (axialDepth) axialDepth[q] = eyeD - R + sprD[q] * 2 * R;
        if (art) art.sprite(q, sprOwner[q], eyeD - R + sprD[q] * 2 * R);
        if (paintStage) paintStage[q]=paintColor(baseReference(sprOwner[q]));
        if (q === paletteTrace?.bottom) paletteTrace.fragment = [];
        if (counters) counters.fragments++;
        environmentPasses?.fragment?.(q, -1, 1, 0, 0, 0);
        if (hazeCoverage) hazeCoverage[q] = 0;
        lookPass?.fragment(q, 1);
        if (localAt) localAt[q] = 0;
        paletteCapture?.claim(q,0);
        if (overlay) overlay.slots[q] = 0;
        if (detail) detail[(H - 1 - Math.floor(q / W)) * W + q % W] = 0;
        dep[q] = sprD[q]; // (so the clean-up sees it as part of the thing, and leaves it as drawn)
        pixed[q] = 1;
        sprM[q] = 1;
      }
    }
  }
  contributions?.refract(gls, dep, blendDepth > 0);
  let atmosphere, volumeStats = mediaOptions?.stats ? rayMedia.stats : undefined;
  const captureFog = ink?.ramps.has('fog') || o.captureFog;
  const effectMedia = trackMedia && axialDepth && new Float32Array(W * H * 3);
  if (rayMedia && (captureFog || effectMedia || fogPass)) {
    const fog = captureFog && new Float32Array(W * H);
    for (let p = 0; p < W*H; p++) {
      const depth = axialDepth[p], covered = Number.isFinite(depth);
      rayMedia.shade(p, covered ? depth : horizon, bg, covered, fogScales?.[p]);
      const q = (H - 1 - Math.floor(p / W)) * W + p % W;
      if (fog) fog[q] = rayMedia.opacity();
      if (fogPass) fogPass[q] = rayMedia.fogThrough();
      if (effectMedia) rayMedia.contributions(effectMedia, q * 3);
    }
    atmosphere = { fog };
  } else if (axialDepth && !rayMedia) {
    const quality = atmosphereOptions();
    atmosphere = applyAtmosphere(volumes, col, axialDepth, rayAt, W, H, horizon, quality, t, quality.media,
      captureFog || effectMedia || transparent || fogPass, o.volumeHistory,
      o.volumeHistory && [W, H, focal, ortho, o.volumeLocalLights, o.volumeLocalShadows, ...V].join('/'), fogScales);
    if (effectMedia) for (let p = 0; p < W*H; p++) {
      effectMedia[p*3] = atmosphere.fog[p];
      effectMedia[p*3+2] = 1-atmosphere.fog[p];
    }
    if (fogPass) for (let p = 0; p < W*H; p++) fogPass[p] = 1 - atmosphere.fog[p];
    if (quality.stats) volumeStats = atmosphere.stats;
  }
  const effectSignals = effectRules && { rules: effectRules, sky: showSky && !!sky, backdropCloud, media: effectMedia, haze: hazeCoverage };
  let passes = art?.finalize(world, t, { x: X, y: Y, z: Z, rayAt, span: R,
    detail, sprM, surfaceGlint, centers, motionFrom:o.surfaceMotionFrom ?? motionFrom,
    emissionMotionFrom:motionFrom, motionReference, ditherPixelStep: spatialFade ? artScale : 0 });
  if (lightingEffects) effectSignals.lightAt = (p,bottom)=>PaletteComposition.lighting(passes,bottom,p,{
    live,sun,contact,probes,probeReceiver,cloudShadow,cloudsReceive:i=>!(Math.round(d[i*16+11]) & (32 | 64))
  });
  if (o[subjectFocusPass] === false) return { passes, silhouetteMask };
  if (o.captureCoverage) {
    if (reflectionTint && passes?.emission) ArtEffects.tintReflection(col, captured, passes.emission, W, H, reflectionTint, t);
    const reflectionLook = reflectionPlane && optics?.transform(TargetSelectors.medium(reflectionPlane.id, 'reflection', reflectionPlane.tags));
    if (reflectionLook) for (let p = 0; p < captured.length; p++) {
      const coverage = captured[p];
      if (coverage <= 1e-6) continue;
      const q = p * 3;
      const rgb = reflectionLook([col[q] / coverage, col[q + 1] / coverage, col[q + 2] / coverage]);
      for (let channel = 0; channel < 3; channel++) col[q + channel] = rgb[channel] * coverage;
    }
    return { w: W, h: H, rgb: col, coverage: captured };
  }
  const alpha = transparent ? new Uint8Array(W * H) : null;
  if (alpha) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, q = (H - 1 - y) * W + x;
      const fog = rayMedia ? 0 : atmosphere?.fog?.[q] || 0;
      const a = fog + (1 - fog) * captured[p];
      alpha[q] = Math.round(clamp(a, 0, 1) * 255);
      if (a > 1e-6) for (let c = 0; c < 3; c++) col[p * 3 + c] /= a;
    }
  }
  SubjectFocus.grade(col,W,H,focus,focusPixel,fallingCoverage);
  const masks = overlay && createMaskResolve(world, { w: W, h: H, time: t, x: X, y: Y, z: Z, depth, rayAt, span: R, ditherPixelStep: artScale },
    overlay, localConstraints, o.maskGrade ?? (!tone && grade), lookPass?.local,paletteTrace);
  const paletteState = paletteCapture && { capture:paletteCapture,mask:masks?.output,maskedSlots:overlay?.slots,
    outlined:paletteOutlines,resolved:retainContributions ? undefined : localAt };
  if (environmentPasses) passes = { w:W, h:H, ...passes, ...environmentPasses.passes };
  if (lookPass) passes = lookPass.finish(passes);
  if (o.samples) {
    // (the picture the contour look takes its insides from is worked on first, as the page does: glass bends it, contact shade darkens it)
    let c2 = col;
    if (o.worked) {
      const aoK = world.ao ? (world.ao.k === undefined ? 0.5 : world.ao.k) : 0,
        aoR = world.ao ? (world.ao.range || 0.6) / (2 * R) : 1,
        at = (x, y) => clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1),
        TAPS = [2, 0, -2, 0, 0, 2, 0, -2, 1, 1, -1, 1, 1, -1, -1, -1];
      c2 = new Float32Array(col.length);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const p = y * W + x,
            gx = gls[at(x + 1, y)] - gls[at(x - 1, y)],
            gy = gls[at(x, y + 1)] - gls[at(x, y - 1)];
          let q = p;
          if (!retainLayers && gls[p] + Math.abs(gx) + Math.abs(gy) > 0) q = at(x + Math.round(gx * bend), y + Math.round(gy * bend));
          let k = 1;
          if (aoK > 0) {
            let occ = 0;
            for (let i = 0; i < 16; i += 2) {
              const dd = (dep[p] - dep[at(x + TAPS[i], y + TAPS[i + 1])]) / aoR;
              if (dd > 0.08 && dd < 3) occ += Math.min(1, dd);
            }
            k = 1 - aoK * Math.min(1, occ / 4);
          }
          c2[p * 3] = col[q * 3] * k;
          c2[p * 3 + 1] = col[q * 3 + 1] * k;
          c2[p * 3 + 2] = col[q * 3 + 2] * k;
        }
    }
    if (masks || lookPass && (localAt || o.previewPalette)) for (let p = 0; p < W * H; p++) {
      const policy = localConstraints?.[(localAt?.[p] || 0) - 1];
      if (lookPass && o.previewPalette && (!localAt?.[p] || policy?.source === 'graded')) lookPass.local(p, o.previewPalette);
      if (lookPass && policy) lookPass.local(p, policy);
      if (!masks) continue;
      if (!overlay.slots[p]) continue;
      const q = p * 3, x = p % W, y = H - 1 - Math.floor(p / W);
      const [dx, dy] = anchoring ? ArtStability.ditherCoordinates(stable, passes, y * W + x, x, y) : [x, y];
      masks.record(p, c2[q], c2[q + 1], c2[q + 2], dx, dy, fragmentRule(overlay.owners[p]));
    }
    if (audit) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      audit.pixel('interior', (H - 1 - y) * W + x, c2[i], c2[i + 1], c2[i + 2]);
    }
    return {
      w: W, h: H, color: Uint8Array.from(c2, v => Math.round(clamp(v, 0, 1) * 255)), depth: dep, drawn,
      ...(o.resolveDetailCleanup && pixelBudgets && { cleanDetail: cleanPixels }),
      ...(localAt && { localAt, localPalettes, localConstraints }), ...(detail && { detail }), ...(passes && { passes }), ...(motionReference && { motionReference }),
      ...(paletteState && {paletteState}),
      ...(paintStage && {paintStage}),
      ...(paletteInventory && {paletteInventory}),
      ...(masks && { masked: masks.output }),
      ...(paletteTrace && { paletteMaskChoices:paletteTrace.mask }),
      ...(atmosphere?.fog && { fog: atmosphere.fog }), ...(silhouetteMask && {silhouetteMask}), ...(effectSignals && { effectSignals }), ...(volumeStats && { volumeStats }), ...(alpha && { alpha }), ...(orderFallback && { orderFallback })
    };
  }
  // the second pass: an outline where the picture steps back sharply, a little ordered noise, then the nearest colour of the palette
  const effectColor = effectSignals && new Uint8Array(W * H * 3);
  const beforePalette = (captureQuantization || captureStages) && legacyLook ? new Uint8Array(W * H * 3) : undefined;
  const out = new Uint8Array(W * H * 3),
    np = world.pal.length,
    pal = [];
  for (let i = 0; i < np; i++) pal.push(hex(i));
  const outlineIndex = world.outline?.c ?? 0,
    exactLine = colorGrade && Number.isInteger(outlineIndex) && outlineIndex >= 0 && outlineIndex < np,
    edge = world.outline && world.outline.edge ? world.outline.edge / (2 * R) : 0,
    line = hex(world.outline ? world.outline.c : 0),
    dith = (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither,
    localOutput = localAt && PixelLook.outputPalettes(tone?.palette || evaluatedPalette || world.pal, localPalettes),
    local = localAt && { constraints: localConstraints, palettes: localPalettes, output: localOutput, scene: pal, grade: !tone && grade,
      placement: (x, y) => ArtStability.placement(stable, passes, y * W + x, x, y, t) },
    use = new Uint32Array(retainContributions ? 0 : localOutput?.packed.length ?? (tone ? tone.palette.length : np)),
    ln = look.lines ? (look.lines === true ? {} : look.lines) : null,
    lines = !ink && !!ln,
    lineGap = ln ? (ln.gap || 0.3) / (2 * R) : 1,
    lineK = ln && ln.k !== undefined ? ln.k : 0.55,
    lineLit = ln && ln.lit !== undefined ? ln.lit : 1.15;
  const D = (x, y) => dep[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)],
    G = (x, y) => gls[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  // (as in the page: glass bends what is behind it, by how its own thickness changes across the picture; and, where a diorama asks for it,
  //  a pixel with nearer things close round it is shaded, so that what moves still sits in its own shadow)
  const aoK = world.ao ? (world.ao.k === undefined ? 0.5 : world.ao.k) : 0,
    aoR = world.ao ? (world.ao.range || 0.6) / (2 * R) : 1,
    AOT = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1]
    ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let r = col[p * 3],
        g = col[p * 3 + 1],
        b = col[p * 3 + 2];
      const yo = H - 1 - y,
        q = (yo * W + x) * 3;
      if (!o.raw && !retainLayers) {
        const gx = G(x + 1, y) - G(x - 1, y),
          gy = G(x, y + 1) - G(x, y - 1);
        if (gls[p] + Math.abs(gx) + Math.abs(gy) > 0) {
          const p2 = (clamp(y + Math.round(gy * bend), 0, H - 1) * W + clamp(x + Math.round(gx * bend), 0, W - 1)) * 3;
          r = col[p2];
          g = col[p2 + 1];
          b = col[p2 + 2];
        }
      }
      if (aoK > 0 && !o.raw) {
        const dc0 = dep[p];
        let occ = 0;
        for (const tq of AOT) {
          const dd = (dc0 - D(x + tq[0], y + tq[1])) / aoR;
          if (dd > 0.08 && dd < 3) occ += Math.min(1, dd);
        }
        const k = 1 - aoK * Math.min(1, occ / 4);
        r *= k;
        g *= k;
        b *= k;
      }
      if (o.raw) {
        if (audit) audit.pixel('composite', q / 3, r, g, b);
        out[q] = Math.round(clamp(r, 0, 1) * 255);
        out[q + 1] = Math.round(clamp(g, 0, 1) * 255);
        out[q + 2] = Math.round(clamp(b, 0, 1) * 255);
        continue;
      }
      const dc = dep[p],
        dm = dc - Math.max(2 * dc - D(x - 1, y) - D(x + 1, y), 2 * dc - D(x, y + 1) - D(x, y - 1));
      // part lines (look.lines), as on the page: the near side of a break in depth, darker, or lighter toward the light
      // (not where an outline was already worked out per pixel)
      const filteredEdge = edgePixels?.[p] >= edgeCoverageThreshold;
      if (!filteredEdge && lines && !(pixed && pixed[p])) {
        const dl = D(x - 1, y),
          dr = D(x + 1, y),
          du = D(x, y + 1),
          dd = D(x, y - 1),
          sx = dl + dr - 2 * dc,
          sy = du + dd - 2 * dc;
        if (Math.max(sx, sy) > lineGap) {
          const k = (sx >= sy ? dl > dr : du > dd) ? lineLit : lineK;
          r *= k;
          g *= k;
          b *= k;
        }
      }
      const outlined = !filteredEdge && !ink && edge > 0 && dc - dm > edge;
      if (outlined) {
        if (paletteOutlines) paletteOutlines[p] = 1;
        r = line[0];
        g = line[1];
        b = line[2];
      }
      if (effectColor) {
        const at = p*3;
        effectColor[at] = Math.round(clamp(r, 0, 1) * 255);
        effectColor[at+1] = Math.round(clamp(g, 0, 1) * 255);
        effectColor[at+2] = Math.round(clamp(b, 0, 1) * 255);
      }
      if (retainContributions) {
        if (audit) audit.pixel('composite', q / 3, r, g, b);
        out[q] = Math.round(clamp(r, 0, 1) * 255);
        out[q + 1] = Math.round(clamp(g, 0, 1) * 255);
        out[q + 2] = Math.round(clamp(b, 0, 1) * 255);
        continue;
      }
      if (beforePalette) {
        beforePalette[q] = Math.round(clamp(r, 0, 1) * 255);
        beforePalette[q + 1] = Math.round(clamp(g, 0, 1) * 255);
        beforePalette[q + 2] = Math.round(clamp(b, 0, 1) * 255);
      }
      const localId = outlined ? 0 : localAt?.[p];
      const trace = paletteTrace?.pixel === q / 3 ? {} : undefined;
      const input = trace ? [r,g,b] : undefined;
      const localCoordinates = tone || localId || masks;
      const screenY = localCoordinates ? yo : y;
      const [ditherX, ditherY] = anchoring ?
        ArtStability.ditherCoordinates(stable, passes, yo*W+x, x, screenY) : [x,screenY];
      if (lookPass && globalPaletteMark && (!localId || localConstraints?.[localId - 1]?.source === 'graded'))
        lookPass.local(p, globalPaletteMark);
      if (lookPass && localId && localConstraints?.[localId - 1]) lookPass.local(p, localConstraints[localId - 1]);
      if (masks && !outlined) masks.record(p, r, g, b, ditherX, ditherY, fragmentRule(overlay.owners[p]));
      if (tone || localId) {
        const anchor = localId && localConstraints?.[localId - 1]?.anchor;
        const [dx, dy] = anchor ? ArtStability.ditherCoordinates(null, passes, yo * W + x, x, yo, anchor) : [ditherX, ditherY];
        const index = localId ? PixelLook.localIndex(local, localId, [r, g, b], dx, dy, !surfaceGlint?.[p], x, yo, trace) :
          PixelLook.toneIndex(tone, r, g, b, dx, dy, trace);
        if (trace) {
          if (localId) paletteTrace.local(local,localId,input,trace);
          else paletteTrace.scene(input,paletteTrace.colors,index,trace.method ?? 'tone',trace);
        }
        const color = (localOutput?.packed || tone.palette)[index];
        use[index]++;
        out[q] = color >> 16;
        out[q + 1] = (color >> 8) & 255;
        out[q + 2] = color & 255;
        continue;
      }
      if (!outlined && !surfaceGlint?.[p]) {
        const [dx,dy] = masks && screenY !== y ? (anchoring ?
          ArtStability.ditherCoordinates(stable, passes, yo*W+x, x, y) : [x,y]) : [ditherX,ditherY];
        const th = PixelLook.bayerRank(dx, dy) - 0.5;
        if (trace && dith) trace.dither = {mode:'ordered-bias',pattern:'bayer',coordinates:[dx,dy],
          rank:th+.5,strength:dith,bias:th*dith};
        r = clamp(r + th * dith, 0, 1);
        g = clamp(g + th * dith, 0, 1);
        b = clamp(b + th * dith, 0, 1);
      }
      let bd = 1e9,
        bi = 0;
      if (exactLine && outlined) bi = outlineIndex;
      else for (let i = 0; i < np; i++) {
        const e = pal[i],
          dr = r - e[0],
          dg = g - e[1],
          db = b - e[2],
          dd = dr * dr * 0.3 + dg * dg * 0.55 + db * db * 0.15;
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      use[bi]++;
      if (trace) paletteTrace.scene(input,paletteTrace.colors,bi,outlined ? 'outline' : undefined,trace);
      const h = world.pal[bi];
      if (grade) {
        out[q] = Math.round(grade[bi * 3] * 255);
        out[q + 1] = Math.round(grade[bi * 3 + 1] * 255);
        out[q + 2] = Math.round(grade[bi * 3 + 2] * 255);
      } else {
        out[q] = (h >> 16) & 255;
        out[q + 1] = (h >> 8) & 255;
        out[q + 2] = h & 255;
      }
    }
  /* pixel clean-up (an option, or a diorama's look.clean), as on the page: a speck (a pixel with no like neighbour of the eight round
     it, or one of a pair that has no other) takes the colour most of its eight neighbours share, if at least three share it, they are
     on the same surface, and it is not much brighter or darker than they are (a glint, an eye or a flower is kept). */
  if ((defaultCleanup || pixelBudgets) && !o.raw) cleanPixels(out);
  function cleanPixels(out, globalCleanup = defaultCleanup) {
    const src = out.slice(),
      keep = look.clean && look.clean.keep !== undefined ? look.clean.keep : 0.3,
      at = (x, y) => (clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 3,
      same = (a, b) => src[a] === src[b] && src[a + 1] === src[b + 1] && src[a + 2] === src[b + 2],
      lum = a => (src[a] * 0.3 + src[a + 1] * 0.55 + src[a + 2] * 0.15) / 255,
      atDepth = a => {
        const i = a / 3;
        return (H - 1 - Math.floor(i / W)) * W + (i % W);
      },
      depA = a => dep[atDepth(a)],
      N8 = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ];
    const likes = (x, y, q) => {
      let n = 0,
        one = null;
      for (const [dx, dy] of N8)
        if (same(q, at(x + dx, y + dy))) {
          n++;
          one = [x + dx, y + dy];
        }
      return [n, one];
    };
    const empty = (x, y) => depA(at(x, y)) >= 0.995,
      N4 = N8.slice(0, 4),
      lineClean = o.lineClean === undefined ? !!(world.look && world.look.pixel) : !!o.lineClean;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = at(x, y);
        const pixel = (H - 1 - y) * W + x;
        const flags = pixelBudgets?.[pixel] ?? 0;
        if (pixelBudgets && !DetailBudgets.cleans(flags, globalCleanup)) continue;
        if (localConstraints?.[(localAt?.[pixel] || 0) - 1] || (alpha && alpha[q / 3] < 128) || sprM?.[pixel] ||
            edgePixels?.[pixel] >= edgeCoverageThreshold || surfaceGlint?.[pixel] || detail?.[q / 3] || ArtStability.protectedPixel(stable, passes, q / 3)) continue;
        // outlines, as on the page: a notch is filled from what is round it, a bump against the background taken off
        const e0 = empty(x, y),
          en = N4.filter(([dx, dy]) => empty(x + dx, y + dy)).length;
        if (pixelBudgets) {
          if ((e0 || !(flags & DetailBudgets.OWNED)) &&
              N4.some(([dx, dy]) => DetailBudgets.protects(pixelBudgets[atDepth(at(x + dx, y + dy))]))) continue;
          if (!e0 && en > 0 && DetailBudgets.protects(flags)) continue;
        }
        if (e0 && en <= 1) {
          let kb = 0,
            best = -1;
          for (const [dx, dy] of N4) {
            if (empty(x + dx, y + dy)) continue;
            const a = at(x + dx, y + dy);
            let k = 0;
            for (const [ex, ey] of N4) if (same(a, at(x + ex, y + ey))) k++;
            if (k > kb) ((kb = k), (best = a));
          }
          if (best >= 0) {
            out[q] = src[best];
            out[q + 1] = src[best + 1];
            out[q + 2] = src[best + 2];
            continue;
          }
        }
        if (!e0 && en >= 3) {
          const [dx, dy] = N4.find(([ex, ey]) => empty(x + ex, y + ey)),
            a = at(x + dx, y + dy);
          out[q] = src[a];
          out[q + 1] = src[a + 1];
          out[q + 2] = src[a + 2];
          continue;
        }
        /* the line cleaner (an option, on for pixel-art dioramas, as on the page): a one-pixel kink in a straight edge between two
           colours taken off, and on a dark line one pixel thick the double at the inside corner of a step given the colour beside it */
        if (lineClean) {
          let to = -1;
          for (const [dx, dy] of N8.slice(0, 4)) {
            const ex = dy,
              ey = dx,
              X = at(x + dx, y + dy);
            if (same(X, q) || !same(at(x + ex, y + ey), X) || !same(at(x - ex, y - ey), X)) continue;
            if (
              same(at(x - dx, y - dy), q) &&
              same(at(x - dx + ex, y - dy + ey), q) &&
              same(at(x - dx - ex, y - dy - ey), q)
            ) {
              to = X;
              break;
            }
          }
          if (to < 0) {
            const lum = a => src[a] * 0.3 + src[a + 1] * 0.55 + src[a + 2] * 0.15,
              l0 = lum(q);
            for (const [gx, gy] of N8.slice(4)) {
              if (
                !same(at(x + gx, y), q) ||
                !same(at(x, y + gy), q) ||
                same(at(x + gx, y + gy), q) ||
                same(at(x - gx, y), q) ||
                same(at(x, y - gy), q)
              )
                continue;
              const goH = same(at(x + 2 * gx, y), q) || same(at(x + 2 * gx, y - gy), q),
                goV = same(at(x, y + 2 * gy), q) || same(at(x - gx, y + 2 * gy), q),
                a = at(x - gx, y),
                b = at(x, y - gy);
              if (goH && goV && lum(a) > l0 + 15 && lum(b) > l0 + 15) {
                to = same(a, b) ? a : at(x - gx, y - gy);
                break;
              }
            }
          }
          if (to >= 0) {
            out[q] = src[to];
            out[q + 1] = src[to + 1];
            out[q + 2] = src[to + 2];
            continue;
          }
        }
        const [n, one] = likes(x, y, q);
        if (!(n === 0 || (n === 1 && likes(one[0], one[1], q)[0] === 1))) continue;
        const nb = N8.map(([dx, dy]) => at(x + dx, y + dy));
        let kb = 0,
          best = -1;
        for (const a of nb) {
          if (same(a, q)) continue;
          let k = 0;
          for (const b of nb) if (same(a, b)) k++;
          if (k > kb) ((kb = k), (best = a));
        }
        if (kb < 3 || Math.abs(depA(q) - depA(best)) > 0.03 || Math.abs(lum(q) - lum(best)) >= keep) continue;
        out[q] = src[best];
        out[q + 1] = src[best + 1];
        out[q + 2] = src[best + 2];
      }
  }
  applyMasks(out, masks?.output);
  if (paletteTrace) paletteTrace.steps.push(...paletteTrace.mask);
  return finishLook({
    w: W, h: H, px, rgb: out, drawn, use,
    ...((localOutput || tone || evaluatedPalette) && { palette: localOutput?.packed || tone?.palette || evaluatedPalette }),
    ...(detail && { detail }), ...(motionReference && { motionReference }),
    ...(volumeStats && { volumeStats }), ...(silhouetteMask && {silhouetteMask}), ...(o.captureFog && atmosphere?.fog && { fog: atmosphere.fog }),
    ...(alpha && { alpha }), ...(orderFallback && { orderFallback })
  }, passes, atmosphere?.fog, effectSignals, effectColor, paletteState,paletteInventory,beforePalette,paintStage);
}
function pixelIndex(w, h, sourceW, sourceH) {
  if (w === sourceW && h === sourceH) return (x, y) => y * w + x;
  const columns = Int32Array.from({ length: w }, (_, x) => Math.floor((x + .5) * sourceW / w));
  const rows = Int32Array.from({ length: h }, (_, y) => Math.floor((y + .5) * sourceH / h) * sourceW);
  return (x, y) => rows[y] + columns[x];
}

function resize(img, w, h) {
  if (img.w === w && img.h === h) return img;
  const rgb = new Uint8Array(w * h * 3), alpha = img.alpha && new Uint8Array(w * h);
  const source = pixelIndex(w, h, img.w, img.h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const pixel = y * w + x, sample = source(x, y);
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = img.rgb[sample * 3 + channel];
    if (alpha) alpha[pixel] = img.alpha[sample];
  }
  return { w, h, rgb, ...(alpha && { alpha }) };
}

// make every art pixel k screen pixels wide, the way the page shows it
function upscale(img, k) {
  const W = img.w * k,
    H = img.h * k,
    out = new Uint8Array(W * H * 3), alpha = img.alpha && new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < W; x++) {
      const s = (sy * img.w + ((x / k) | 0)) * 3,
        q = (y * W + x) * 3;
      out[q] = img.rgb[s];
      out[q + 1] = img.rgb[s + 1];
      out[q + 2] = img.rgb[s + 2];
      if (alpha) alpha[q / 3] = img.alpha[s / 3];
    }
  }
  return { w: W, h: H, rgb: out, ...(alpha && {alpha}) };
}
// several pictures in a grid, each with a small label in its corner
const FONT = {
  0: '111101101101111',
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001001001001',
  8: '111101111101111',
  9: '111101111001111',
  '.': '000000000000010',
  '-': '000000111000000',
  s: '000111110011111',
  ' ': '000000000000000',
  y: '101101111001111',
  t: '010111010010011'
};
function label(img, x0, y0, text, k) {
  k = k || 2;
  for (let c = 0; c < text.length; c++) {
    const g = FONT[text[c]] || FONT[' '];
    for (let j = 0; j < 15; j++)
      if (g[j] === '1')
        for (let a = 0; a < k; a++)
          for (let b = 0; b < k; b++) {
            const x = x0 + (c * 4 + (j % 3)) * k + a,
              y = y0 + ((j / 3) | 0) * k + b;
            if (x >= 0 && x < img.w && y >= 0 && y < img.h) {
              const q = (y * img.w + x) * 3;
              img.rgb[q] = 255;
              img.rgb[q + 1] = 255;
              img.rgb[q + 2] = 255;
              if (img.alpha) img.alpha[q / 3] = 255;
            }
          }
  }
}
function grid(imgs, cols, labels) {
  const w = imgs[0].w,
    h = imgs[0].h,
    rows = Math.ceil(imgs.length / cols),
    out = { w: w * cols, h: h * rows, rgb: new Uint8Array(w * cols * h * rows * 3) };
  if (imgs.some(image => image.alpha)) out.alpha = new Uint8Array(out.w * out.h);
  imgs.forEach((im, n) => {
    const ox = (n % cols) * w,
      oy = ((n / cols) | 0) * h;
    for (let y = 0; y < h; y++) {
      const start = (oy + y) * out.w + ox;
      out.rgb.set(im.rgb.subarray(y * w * 3, (y + 1) * w * 3), start * 3);
      if (im.alpha) out.alpha.set(im.alpha.subarray(y * w, (y + 1) * w), start);
      else out.alpha?.fill(255, start, start + w);
    }
    if (labels) label(out, ox + 6, oy + 6, labels[n]);
  });
  return out;
}
module.exports = { render, resize, pixelIndex, upscale, grid, label, viewMatrix, FOV, cameraCapture };
