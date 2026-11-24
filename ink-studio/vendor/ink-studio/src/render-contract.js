/* Cross-backend inputs for a sampled render. Backends keep their own raster passes. */
const RenderContract = (() => {
  const art = typeof ArtDirection === 'undefined' ? require('./art-direction.js') : ArtDirection;
  const lenses = typeof CameraLens === 'undefined' ? require('./camera-lens.js') : CameraLens;
  const impulses = typeof CameraImpulses === 'undefined' ? require('./camera-impulses.js') : CameraImpulses;
  const staging = typeof CameraStaging === 'undefined' ? require('./camera-staging.js') : CameraStaging;
  const pixels = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const stages = typeof RenderStages === 'undefined' ? require('./render-stages.js') : RenderStages;
  const inputs = typeof LookInputs === 'undefined' ? require('./look-inputs.js') : LookInputs;

  function options(world, frame = {}, bindClocks) {
    let out = { ...frame, time: frame.time ?? frame.t };
    const clocks = out.timeDomains ?? world.timeDomains;
    if (clocks) {
      if (bindClocks) out = bindClocks(world, out);
      else if (typeof clocks.frame === 'function') out = clocks.frame(out);
      else throw new TypeError('Expected a live render clock set');
    }
    const time = out.time ?? world.lookSnapshot?.time;
    if (![time ?? 0, out.cameraTime ?? 0, out.skyTime ?? 0, out.interfaceTime ?? 0].every(Number.isFinite))
      throw new RangeError('Render frame sample times must be finite');
    return { ...out, time, t: time };
  }

  function clock(world, frame) {
    const look = world.look ?? {};
    const time = frame.time ?? frame.t ?? world.lookSnapshot?.time ?? 0, skyTime = frame.skyTime ?? time;
    const direction = art.prepare(look.artDirection, frame.artDirection);
    const stepped = frame.stepAnimation === true && look.pixel && !direction?.sceneCadence;
    const scene = stepped ? Math.floor(time * 10 + 1e-8) / 10 : art.time(direction, time);
    return { time, skyTime, direction, cameraTime: frame.cameraTime ?? time, interfaceTime: frame.interfaceTime ?? time,
      simulationTime: frame.simulationTime ?? null, ...art.motion(direction, time, skyTime, scene) };
  }

  const palette = pixels.framePalette;

  function stagePlan(world, frame, time, { query, lookInputs, ...settings } = {}) {
    if (frame.raw || frame.renderStages === false) return null;
    return stages.plan(world, { ...settings, sceneRules: frame.renderStages,
      lookInputs: frame.lookInputSession ?? lookInputs ?? inputs.session(time, () =>
        world.lookSnapshot?.query ?? world.surfaceEffects?.query ?? query?.()) });
  }

  function stageRules(world, frame) {
    if (frame.raw || frame.renderStages === false) return [];
    return [...((frame.renderStages ?? world.look?.renderStages) || []),
      ...(world.surfaces?.flatMap(({ settings }) => settings.renderStages || []) ?? [])];
  }
  function hasSurfacePaint(world, frame) {
    return !frame.raw && frame.renderStages !== false && world.surfaces?.some(({ settings }) =>
      Object.values(settings.layers ?? {}).some(layer => layer?.stage === 'material'));
  }
  function compatibility(world, frame = {}) {
    const look = world.look ?? {};
    const rules = stageRules(world, frame);
    const issues = [];
    if (!frame.raw && world.pal?.length > 64) issues.push('palette-limit');
    if (!rules.length && !hasSurfacePaint(world, frame)) return issues;
    if (rules.some(rule => rule.stage === 'frame' || rule.stage === 'palette')) issues.push('post-stage');
    if (rules.some(rule => rule.mask || rule.driver?.inputs?.mask)) issues.push('spatial-stage-mask');
    if (world.pix || world.fine || world.materialPixelStyles) issues.push('textured-splat-color');
    if (world.spriteAtlases?.length || world.spriteSurfaces ||
        (frame.scalePreviews !== false && world.scalePreviews?.length) || world.surfaces?.some(({ settings }) => Object.keys(settings.layers ?? {}).length))
      issues.push('surface-finish');
    if (world.opticalSplats || frame.water !== false && world.water?.count ||
        frame.paintCorrections !== false && world.paintCorrections || (frame.coverageAware ?? look.coverageAware) ||
        (frame.paletteConstraints ?? look.paletteConstraints) || look.optics?.length)
      issues.push('contribution-color');
    if ((frame.relighting ?? world.relighting) || (frame.liveSun ?? world.liveSun) || world.areaLights?.length ||
        world.bounceProbes || world.anim?.lamps?.length || world.emissiveFinishes?.length)
      issues.push('live-lighting');
    return issues;
  }

  function requirePortable(world, frame) {
    const issues = compatibility(world, frame);
    if (issues.length) throw new Error('Frame is outside the shared rendering contract: ' + issues.join(', '));
  }

  function materialData(plan, world, source) {
    let data;
    for (let i = 0; i < world.count; i++) {
      const { material, lit } = plan.at(i);
      if (!material && !lit) continue;
      const q = i * 16 + 7, color = Math.round(source[q]);
      const baked = [color & 255, color >> 8 & 255, color >> 16 & 255].map(n => n / 255);
      const reference = world.materialAlbedo?.[i];
      const painted = material ? stages.material(material, baked, reference ? reference - 1 : undefined) : baked;
      const shaded = lit ? stages.apply(lit, painted) : painted;
      const [r, g, b] = shaded.map(n => Math.max(0, Math.min(255, Math.round(n * 255))));
      const packed = r + 256 * g + 65536 * b;
      if (packed === color) continue;
      data ??= source.slice(0, world.count * 16);
      data[q] = packed;
    }
    return data ?? source;
  }

  function describe(world, frame = {}, bindClocks) {
    frame = options(world, frame, bindClocks);
    const { direction, ...clocks } = clock(world, frame);
    const width = frame.width ?? frame.w ?? 900, height = frame.height ?? frame.h ?? 620;
    const camera = lenses.frame(world, frame, width, height,
      { orbit: staging.prepare(frame.cameraStaging ?? world.look?.cameraStaging)?.orbit, impulse: impulses.frame });
    const { time, ortho, tangent, clipNear, clipFar, setback } = camera;
    const view = lenses.artView(camera, Math.ceil(height / (frame.px ?? 1)), world.look?.stable, frame.stable);
    const pose = view === camera.view ? camera.pose : lenses.fromView(view);
    const { grade, toneDefinition } = palette(world, frame, { grading: !frame.raw, tone: !frame.raw });
    const stageNames = new Set(stageRules(world, frame).map(rule => rule.stage));
    if (hasSurfacePaint(world, frame)) stageNames.add('material');
    const paletteMode = frame.raw ? 'raw' : stageNames.size ? 'stages' : toneDefinition ? 'tone' : 'palette';
    return { version: 1, width, height, clocks, camera: { pose, time, ortho, tangent, clipNear, clipFar, setback },
      paletteMode, palette: !frame.raw && grade ? pixels.gradePalette(grade) : world.pal?.slice(),
      stages: [...stageNames], issues: compatibility(world, frame) };
  }
  return Object.freeze({ options, clock, palette, stagePlan, compatibility, requirePortable, materialData, describe,
    hasStages: (world, frame) => stageRules(world, frame).length > 0 || hasSurfacePaint(world, frame) });
})();
if (typeof module !== 'undefined') module.exports = RenderContract;
