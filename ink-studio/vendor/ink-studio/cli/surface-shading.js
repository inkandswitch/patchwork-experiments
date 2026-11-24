// Bind the common shader to the software renderer's camera and splat buffers.
const SurfaceLook = require('../src/surface-look.js');
const LightSchedule = require('../src/light-schedule.js');
const { unpack } = require('../src/render-stages.js');
const linear = require('../src/color-space.js').prepare('srgb', 'srgb-linear');

function surfaceShading(world, options, camera) {
  if (options.surface === false || !world.surfaceData || !world.surfaces?.length) return null;
  const { data, surfaceData } = world;
  const stageBase = world.anim?.base;
  const rest = stageBase instanceof Float32Array && stageBase.length >= data.length ? stageBase : world.rest || data;
  const rig = world.anim?.rig;
  const rigFrames = new Map();
  const projected = i => materials[surfaceData[i * STRIDE] - 1]?.projected;
  const local = i => localMaterials?.[surfaceData[i * STRIDE] - 1];
  const thin = i => materials[surfaceData[i * STRIDE] - 1]?.thin;
  const bevel = i => materials[surfaceData[i * STRIDE] - 1]?.bevelDistance;

  function rigFrame(i) {
    const part = rig?.bid[i];
    if (!part || rig.free?.[i] || !(projected(i) || bevel(i) || local(i) || thin(i))) return null;
    if (!rigFrames.has(part)) {
      const { M } = require('../index.js').load().KIT;
      const matrix = rig.M.subarray(part * 12, part * 12 + 9);
      if (Math.abs(M.det(matrix)) < 1e-8) return null;
      const inverse = M.inv(matrix);
      rigFrames.set(part, { matrix, inverse, normal: M.tr(inverse), apply: M.app });
    }
    return rigFrames.get(part);
  }
  const { eye, forward, parallel, footprint, time, reflection, localReflection, sky, skyReflectionSource, blueNoise } = camera;
  const { STRIDE } = SurfaceLook;
  const liveLight = camera.sun ?? (world.surfaceLight === undefined ? undefined :
    SurfaceLook.prepareLightTrack(world.surfaceLight)(time));
  const ramps = options.raw ? null : SurfaceLook.lightRamps(options.surfaceLightRamps ?? world.look?.surfaceLightRamps);
  const materials = world.surfaces.map(({ settings, light, bevelDistance }) => {
    const material = SurfaceLook.prepare(SurfaceLook.withLightRamps(settings, ramps), world.pal, liveLight ?? light, world.surfaceEffects,
      { colorCurves: options.colorCurves !== false, colorLut: options.colorLut !== false, colorStack: options.colorStack !== false,
        paletteConstraints: options.paletteConstraints !== false && (options.lookMasks !== false || !settings.paletteConstraint?.mask),
        skipMasks: options.lookMasks === false, transmission: options.transmission !== false, detailKits:options.surfaceDetailKits!==false,
        paletteRoles: world.paletteRoles, blueNoise, onPaletteClip: camera.onPaletteClip,
        ditherSpaceOverride:options.ditherSpaceOverride });
    if (bevelDistance && material.needsDistance) material.bevelDistance = bevelDistance;
    return material;
  });
  const lamps = materials.some(material => material.thinLocal) ?
    (camera.transmissionLamps?.() ?? []).map(light => ({ ...light, tint: linear(light.color) })) : [];
  const ids = new Map(), albedos = new Map();
  const palettes = [], constraints = [];
  const paletteSlots = options.paletteUsageSelection && [];
  for (const material of materials) {
    const slots = paletteSlots && [];
    for (const layer of material.layers) {
      const { effect } = layer;
      const palette = effect?.paletteAt?.(time) ?? effect?.palette;
      if (!palette || SurfaceLook.basePaint(layer)) continue;
      palettes.push(palette);
      ids.set(palette, palettes.length);
      if (slots) slots.push(palettes.length);
    }
    if (material.paletteConstraint) {
      const policy = material.paletteConstraint;
      policy.scope = 'surface';
      policy.assetId ??= material.settings.lookAssetId;
      constraints[palettes.length] = policy;
      ids.set(policy.swatches, palettes.push(policy.swatches));
      if (slots) slots.push(palettes.length);
    }
    if (paletteSlots) paletteSlots.push(slots);
  }
  const planarMaterials = materials.map(
    material =>
      reflection && material.layers.some(layer => layer.type === 'planarReflection' && reflection.has(layer.plane))
  );
  const localMaterials = localReflection && materials.map(material => material.layers.some(layer =>
    layer.type === 'localReflection' && localReflection.has(layer.probe)));
  const skyMaterials = sky && materials.map(material => material.layers.some(layer =>
    layer.type === 'reflection' && (skyReflectionSource ?? layer.source) === 'scene'));
  const environment = i => Boolean(skyMaterials?.[surfaceData[i * STRIDE] - 1]);
  const sample = {
    position: [0, 0, 0],
    worldPosition: [0, 0, 0],
    normal: [0, 0, 0],
    view: [0, 0, 0],
    footprint,
    stableDetail: camera.detail,
    time,
    waterTime: camera.waterTime,
    waterWind: camera.waterWind,
    weather: camera.weather,
    rain: camera.rain,
    visibility: 1,
    skyView: [0, 0, 0], skyOverlay: camera.skyOverlay, skyReflectionSource
  };
  const rgb = [0, 0, 0];
  const kitExposure = channel=>camera.exposure?.[channel]?.(...sample.worldPosition) ?? 1;
  const result = [0, 0, 0, 1, 0];
  const rotation = i => {
    const offset = i * 16;
    return Math.round(data[offset + 11]) % 16 === 5 ? time * data[offset + 13] : 0;
  };
  const has = i => surfaceData[i * STRIDE] > 0;

  function normalAt(i, normal) {
    const angle = rotation(i);
    if (!angle) return normal;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return [c * normal[0] + s * normal[2], normal[1], c * normal[2] - s * normal[0]];
  }

  function planar(i) {
    return !!planarMaterials[surfaceData[i * STRIDE] - 1];
  }

  function surfaceNormal(i) {
    const offset = i * STRIDE;
    const normal = [surfaceData[offset + 1], surfaceData[offset + 2], surfaceData[offset + 3]];
    const frame = rigFrame(i);
    return normalAt(i, frame ? frame.apply(frame.normal, normal) : normal);
  }

  const sampleSky = sky && ((direction, out) => sky(direction, out, sample.worldPosition));
  const sampleLocal = localReflection && ((layer, ray, axis) =>
    localReflection(layer.probe, sample.worldPosition, ray, layer.roughness, axis));
  function shade(i, x, y, z, centerX, centerY, centerZ, r, g, b, sx, sy, visit, reflected, paintedAlbedo, stagePaint) {
    const offset = i * STRIDE;
    const { position, normal, view } = sample;
    const prepared = materials[surfaceData[offset] - 1];
    const dab = i * 16;
    const dx = x - centerX,
      dz = z - centerZ;
    const angle = rotation(i);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const source = prepared.projected || prepared.bevelDistance || local(i) || prepared.thin ? rest : data;
    const frame = rigFrame(i);
    const ox = c * dx - s * dz, oy = y - centerY, oz = s * dx + c * dz;
    if (frame) {
      const offsetFromCenter = frame.apply(frame.inverse, [ox, oy, oz]);
      for (let k = 0; k < 3; k++) position[k] = source[dab + k] + offsetFromCenter[k];
    } else {
      position[0] = source[dab] + ox;
      position[1] = source[dab + 1] + oy;
      position[2] = source[dab + 2] + oz;
    }
    sample.worldPosition[0] = x;
    sample.worldPosition[1] = y;
    sample.worldPosition[2] = z;
    sample.exposure = prepared.kitExposure ? kitExposure : undefined;
    if (prepared.settings.rainRipple) {
      const slope = camera.rain?.normal(prepared.settings.rainRipple, sample.worldPosition, footprint);
      const local = slope && [c * slope[0] - s * slope[2], slope[1], s * slope[0] + c * slope[2]];
      sample.rainSlope = local && frame ? frame.apply(frame.inverse, local) : local;
    } else sample.rainSlope = undefined;
    if (prepared.depth) sample.depth = (eye[0] - x) * forward[0] + (eye[1] - y) * forward[1] + (eye[2] - z) * forward[2];
    normal[0] = surfaceData[offset + 1];
    normal[1] = surfaceData[offset + 2];
    normal[2] = surfaceData[offset + 3];
    sample.skyAccess = camera.exposure?.light?.(x,y,z) ?? 1;
    sample.visibility = camera.sunVisibility?.(i, x, y, z) ?? surfaceData[offset + 4] * (camera.cloudShadow?.(x, y, z) ?? 1) * sample.skyAccess;
    const tx = surfaceData[offset + 5],
      ty = surfaceData[offset + 6],
      tz = surfaceData[offset + 7];
    sample.tangent = tx || ty || tz ? [tx, ty, tz] : undefined;
    const vx = parallel ? parallel[0] : eye[0] - x;
    const vz = parallel ? parallel[2] : eye[2] - z;
    view[0] = c * vx - s * vz;
    view[1] = parallel ? parallel[1] : eye[1] - y;
    view[2] = s * vx + c * vz;
    if (prepared.bevelDistance || prepared.hasKits || camera.detail?.texture || camera.detail?.specular) {
      const depth = camera.orthographic ? 1 :
        (eye[0]-x)*forward[0]+(eye[1]-y)*forward[1]+(eye[2]-z)*forward[2];
      sample.artFootprint = Math.max(1e-6, depth) / camera.pixelsPerUnit;
    }
    sample.bevelDistance = prepared.bevelDistance;
    if (camera.detail?.texture || camera.detail?.specular) {
      const worldNormal = surfaceNormal(i);
      const normalLength = Math.hypot(...worldNormal) || 1, viewLength = Math.hypot(vx, view[1], vz) || 1;
      const facing = Math.abs(worldNormal[0]*vx+worldNormal[1]*view[1]+worldNormal[2]*vz)/(normalLength*viewLength);
      sample.detailFootprint = sample.artFootprint / Math.max(.12, facing);
    }
    sample.sky = environment(i) ? sampleSky : undefined;
    sample.localReflection = local(i) ? sampleLocal : undefined;
    if (sample.sky || sample.localReflection || prepared.thin) {
      sample.skyView[0] = vx;
      sample.skyView[1] = view[1];
      sample.skyView[2] = vz;
      // Finish normals are evaluated in the material frame. Reflect in world space.
      sample.skyNormal = angle || frame ? n => {
        const local = frame ? frame.apply(frame.normal, n) : n;
        return [c * local[0] + s * local[2], local[1], c * local[2] - s * local[0]];
      } : undefined;
      sample.reflectionTangent = angle || frame ? tangent => {
        const direction = frame ? frame.apply(frame.matrix, tangent) : tangent;
        return [c * direction[0] + s * direction[2], direction[1], c * direction[2] - s * direction[0]];
      } : undefined;
    } else {
      sample.skyNormal = undefined;
      sample.reflectionTangent = undefined;
    }
    const [lx, ly, lz] = prepared.sun;
    sample.lightDirection = angle ? [c * lx - s * lz, ly, s * lx + c * lz] : undefined;
    if (frame) {
      const localView = frame.apply(frame.inverse, view);
      for (let k = 0; k < 3; k++) view[k] = localView[k];
      const ray = frame.apply(frame.inverse, sample.lightDirection || prepared.sun);
      const length = Math.hypot(...ray);
      sample.lightDirection = ray.map(x => x / length);
    }
    sample.reflection =
      planar(i) && sx !== undefined
        ? (layer, n, original) => {
            const dx = n[0] - original[0],
              dz = n[2] - original[2];
            return reflection(layer, sx, sy, c * dx + s * dz, n[1] - original[1], c * dz - s * dx);
          }
        : undefined;
    sample.transmissionSun = prepared.thin ? {
      direction: prepared.sun,
      intensity: camera.sunIntensity ?? 1,
      visibility: bias => {
        const toward = sample.skyNormal ? sample.skyNormal(normal) : normal;
        return camera.transmissionSunVisibility?.(i, sample.worldPosition, prepared.sun, toward, bias) ?? sample.visibility;
      }
    } : undefined;
    let incident;
    sample.transmissionLights = prepared.thinLocal && lamps.length ? () => {
      if (incident) return incident;
      incident = [];
      for (const light of lamps) {
        const intensity = LightSchedule.contribution(light, x, y, z);
        if (!intensity) continue;
        const offset = [light.p[0] - x, light.p[1] - y, light.p[2] - z];
        const distance = Math.hypot(...offset);
        if (distance <= 1e-8) continue;
        const direction = offset.map(value => value / distance);
        incident.push({ direction, intensity, color: light.tint,
          visibility: bias => camera.transmissionOccluded?.(sample.worldPosition, direction, distance, bias) ? 0 : 1 });
      }
      return incident;
    } : undefined;
    if (prepared.paintsBase) {
      const reference = world.materialAlbedo?.[i];
      if (reference && !paintedAlbedo && !albedos.has(reference)) albedos.set(reference,unpack(reference-1));
      sample.albedo = paintedAlbedo ?? albedos.get(reference);
    } else sample.albedo = undefined;
    rgb[0] = r;
    rgb[1] = g;
    rgb[2] = b;
    SurfaceLook.shade(prepared, sample, rgb, result, undefined, visit, camera.onSurfaceClip, reflected, stagePaint);
    if (ids.size) result[5] = ids.get(result[5]) || 0;
    return result;
  }

  return {
    has, normalAt, surfaceNormal, planar, environment, shade, palettes, constraints, paletteSlots,
    projected, bevel, local, thin, paintsBase: i => materials[surfaceData[i * STRIDE] - 1]?.paintsBase,
    finishBeforeFog: i => materials[surfaceData[i * STRIDE] - 1]?.finishBeforeFog,
    reveals: i => materials[surfaceData[i * STRIDE] - 1]?.reveals
  };
}

module.exports = surfaceShading;
