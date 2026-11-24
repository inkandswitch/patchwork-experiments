const SceneOptics = require('../src/scene-optics.js');
const CloudField = require('../src/cloud-field.js');
const ArtDirection = require('../src/art-direction.js');
const { airTransmission } = require('../src/sky-environment.js');
const { rays: cameraRays } = require('../src/camera-lens.js');

function surfacePoint(ray, normal, x, y, z, axialDepth, radius) {
  const { origin, direction, axial } = ray;
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  if (Math.abs(facing) < 1e-7) return [x, y, z];
  const distance = (normal[0] * (x - origin[0]) + normal[1] * (y - origin[1]) + normal[2] * (z - origin[2])) / facing;
  if (distance < 0 || Math.abs(distance * axial - axialDepth) > radius) return [x, y, z];
  return origin.map((n, i) => n + distance * direction[i]);
}

function reflectionSampler(planes, render, view, eye, scale, { quality, width, height } = {}) {
  const definitions = new Map(),
    captures = new Map();
  for (const value of planes) {
    const plane = SceneOptics.plane(value);
    if (definitions.has(plane.id)) throw new RangeError('Duplicate reflection plane ' + plane.id);
    if (SceneOptics.planeDistance(plane, ...eye) > plane.bias) definitions.set(plane.id, plane);
    else definitions.set(plane.id, null);
  }
  const levels = quality?.captures && require('../src/pass-quality.js').reflectionPlan(quality,
    [...definitions.values()].filter(Boolean).map(plane => plane.id));
  for (const [id, factor] of levels ?? []) if (!factor) definitions.set(id, null);
  const rgb = [0, 0, 0],
    reflected = { rgb, coverage: 0 };
  function sample(layer, x, y, dx, dy, dz, background) {
    const plane = definitions.get(layer.plane);
    if (!plane) return null;
    const factor = levels?.get(plane.id) ?? 1;
    if (!captures.has(plane.id)) captures.set(plane.id, render(plane, factor));
    const frame = captures.get(plane.id);
    const distortion = (layer.distortion ?? 5) * scale;
    x += distortion * (view[0] * dx + view[4] * dy + view[8] * dz);
    y += distortion * (view[1] * dx + view[5] * dy + view[9] * dz);
    const blur = (layer.blur ?? 0) * scale;
    let red = 0,
      green = 0,
      blue = 0,
      alpha = 0;
    const sx = factor === 1 ? 1 : frame.w / width, sy = factor === 1 ? 1 : frame.h / height;
    function tap(tx, ty, weight) {
      tx = Math.floor(tx * sx);
      ty = Math.floor(ty * sy);
      if (tx < 0 || tx >= frame.w || ty < 0 || ty >= frame.h) return;
      const p = ty * frame.w + tx,
        j = p * 3;
      red += frame.rgb[j] * weight;
      green += frame.rgb[j + 1] * weight;
      blue += frame.rgb[j + 2] * weight;
      alpha += frame.coverage[p] * weight;
    }
    tap(x, y, blur ? 0.4 : 1);
    if (blur) {
      tap(x - blur, y, 0.15);
      tap(x + blur, y, 0.15);
      tap(x, y - blur, 0.15);
      tap(x, y + blur, 0.15);
    }
    if (background) {
      rgb[0]=red+background[0]*(1-alpha);
      rgb[1]=green+background[1]*(1-alpha);
      rgb[2]=blue+background[2]*(1-alpha);
      reflected.coverage=1;
      return reflected;
    }
    if (alpha <= 1e-6) return null;
    rgb[0] = Math.min(1, red / alpha);
    rgb[1] = Math.min(1, green / alpha);
    rgb[2] = Math.min(1, blue / alpha);
    reflected.coverage = alpha;
    return reflected;
  }
  sample.has = id => !!definitions.get(id);
  return sample;
}

function atmosphereQuality(value = {}) {
  const { scale = 1, depthTolerance = .22, steps = 64, stepScale = 1, samples = 1, jitter = 'off',
    skip = true, cacheBounds = true, seed = 0, stats = false } = value;
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 4 ||
      !Number.isFinite(depthTolerance) || depthTolerance < 0 ||
      !Number.isSafeInteger(steps) || steps < 4 || steps > 256 ||
      !Number.isFinite(stepScale) || stepScale < .25 || stepScale > 8 ||
      !Number.isSafeInteger(samples) || samples < 1 || samples > 4 || !['off', 'blue-noise', 'spatiotemporal'].includes(jitter) ||
      !Number.isSafeInteger(seed) || typeof skip !== 'boolean' || typeof cacheBounds !== 'boolean' || typeof stats !== 'boolean')
    throw new RangeError('Invalid atmosphere quality options');
  return { scale, depthTolerance, maxSteps: steps, stepScale, samples, jitter, skip, cacheBounds, seed, stats };
}

const noiseTiles = new Map();
function volumeNoise(seed) {
  if (!noiseTiles.has(seed)) {
    if (noiseTiles.size >= 8) noiseTiles.delete(noiseTiles.keys().next().value);
    const { KIT } = require('../index.js').load();
    noiseTiles.set(seed, KIT.procedural.materials.blueNoise({ seed }));
  }
  return noiseTiles.get(seed);
}

const OpticalMaterials = require('../src/optical-materials.js');

function traceMedia(volumes, segments, origin, direction, stop, result, sample, options, aerial) {
  result.fill(0, 0, 3);
  result.fill(1, 3, 6);
  const trackCoverage = result.length > 6;
  if (trackCoverage) result.fill(0, 6);
  const trackFog = result.length > 8;
  if (trackFog) result[8] = 1;
  let cursor = 0, dryDistance = 0, aerialThrough = 1;
  const remaining = () => (result[3] + result[4] + result[5])/3;
  function composite(slot) {
    if (trackCoverage) result[slot] += remaining() * (1-sample[3]);
    for (let channel = 0; channel < 3; channel++) {
      result[channel] += result[channel + 3] * sample[channel];
      result[channel + 3] *= sample[3];
    }
  }
  function air(end) {
    if (end <= cursor) return;
    const bounds = options?.rayBounds, counters = options?.counters;
    if (volumes.length && (!bounds || bounds.near < end && bounds.far > cursor)) {
      // Samples past the exit see the same full volume, even when cloud, water,
      // or aerial perspective needs a new calculation at the fragment depth.
      const cache = cursor === 0 && end >= bounds?.far ? options.fullFog : null;
      const cached = cache?.[options.sampleIndex];
      if (cached && cached.scale === options.fogScale) {
        for (let c=0;c<4;c++) sample[c] = cached.values[c];
        if (counters) counters.fullFogCacheHits++;
      } else {
        SceneOptics.trace(volumes, origin, direction, end, sample, { ...options, start: cursor });
        if (options?.bands) ArtDirection.remapOpacity(sample, options.bands);
        if (cache) cache[options.sampleIndex] = { scale:options.fogScale, values:sample.slice() };
      }
      composite(6);
      if (trackFog) result[8] *= sample[3];
    } else if (volumes.length && counters) counters.emptyFogIntervals++;
    if (options?.cloud) {
      options.cloud.trace(origin,direction,Math.max(cursor,options.cloudStart ?? 0),end,sample,options.counters);
      composite(7);
    }
    if (!aerial || end <= aerial.start || aerialThrough === 0) return;
    const from = Math.max(cursor, aerial.start);
    dryDistance += options?.exposure?.fogDistance?.(origin,direction,from,end) ?? end-from;
    const raw = airTransmission(aerial, dryDistance * (options?.fogScale ?? 1));
    const through = options?.bands ? 1-options.bands(1-raw) : raw, ratio = through / aerialThrough;
    if (trackCoverage) result[6] += remaining() * (1-ratio);
    for (let channel = 0; channel < 3; channel++) {
      result[channel] += result[channel + 3] * (1 - ratio) * aerial.color[channel];
      result[channel + 3] *= ratio;
    }
    if (trackFog) result[8] *= ratio;
    aerialThrough = through;
  }
  function waterSurface(style, t, surface) {
    const atSurface=Math.abs(origin[1]+t*direction[1]-surface)<=1e-6;
    let reflection = style.reflection && !style.optical && atSurface ?
      style.surface*(.16+.84*(1-Math.abs(direction[1]))**3) :
      OpticalMaterials.waterReflection(style, origin[1], direction[1], t, surface);
    if (options?.waterTransition && reflection) {
      const phase = Math.min(1, (stop - t) * (options.axial ?? 1) / options.waterTransition);
      reflection *= phase * phase * (3 - 2 * phase);
    }
    if (!reflection) return;
    let reflected;
    if (style.reflection && options?.reflection) {
      const x = origin[0] + direction[0]*t, z = origin[2] + direction[2]*t, time = options.waterTime ?? options.time ?? 0;
      const flow=options.reflectionCurrent?.(x,surface-1e-5,z)?.current;
      const px=x-(flow?.[0]??0)*time*.25,pz=z-(flow?.[2]??0)*time*.25;
      const swell = 1 + (options.waterWind?.(x,surface,z) ?? 0);
      const dx = swell * Math.sin(px*3.1 + pz*1.9 + time*2), dz = swell * Math.sin(-px*1.7 + pz*4.4 - time*1.6);
      reflected = options.reflection(style.reflection, options.reflectionX, options.reflectionY, dx, 0, dz, options.reflectionBackground);
    }
    for (let channel = 0; channel < 3; channel++) {
      result[channel] += result[channel + 3] * reflection * style.surfaceColor[channel] * (reflected?.rgb[channel] ?? 1);
      result[channel + 3] *= 1 - reflection;
    }
  }
  for (const [start, exit, style, surface] of segments) {
    if (start >= stop) break;
    const end = Math.min(stop, exit);
    air(start);
    if (direction[1] < 0) waterSurface(style, start, surface);
    const midpoint = (start + end) * .5;
    const depth = surface - origin[1] - midpoint * direction[1];
    const visibility = options?.cloudShadow?.(origin[0] + midpoint * direction[0], surface,
      origin[2] + midpoint * direction[2]) ?? 1;
    const gain = CloudField.dim(visibility);
    const u = Math.max(0, Math.min(1, (depth - style.depthRange[0]) / (style.depthRange[1] - style.depthRange[0])));
    const deep = u * u * (3 - 2 * u);
    for (let channel = 0; channel < 3; channel++) {
      const loss = -Math.expm1(-style.extinction[channel] * (end - start));
      const tint = style.tint[channel] + (style.deepTint[channel] - style.tint[channel]) * deep;
      result[channel] += result[channel + 3] * loss * tint * gain;
      result[channel + 3] *= 1 - loss;
    }
    if (direction[1] > 0 && end < stop) waterSurface(style, end, surface);
    cursor = end;
  }
  air(stop);
  return result;
}

function mediaSampler(volumes, water, rayAt, width, horizon, options, aerial) {
  const size = options.fogTransmittance ? 9 : options.effectCoverage ? 8 : 6;
  const rays = [], sample = [0, 0, 0, 1], result = new Float64Array(size);
  const fields = volumes.some(volume => volume.type === 'field' || volume.densityField || volume.depthBand?.sample || volume.paletteField) ||
    (options.media?.paletteLocals && volumes.some(volume => volume.lit));
  const tile = fields && options.jitter !== 'off' ? volumeNoise(options.seed) : null;
  const samples = fields ? options.samples : 1;
  const query = { ...options, reflectionCurrent:water?.mediumAt, jitter: .5 };
  let opacity = 0, fogCoverage = 0, cloudCoverage = 0, fogThrough = 1;
  const stats = { rays: 0, fallbackRays: 0, depthSamples: 0 };
  function shade(pixel, depth, rgb, geometry = true, fogScale = 1) {
    if (options.counters) options.counters.mediaQueries++;
    let ray = rays[pixel];
    if (!ray) {
      const x = pixel % width, y = Math.floor(pixel / width);
      const { origin, direction, axial } = rayAt(x + .5, y + .5);
      stats.rays++;
      ray = rays[pixel] = { origin: origin.slice(), direction: direction.slice(), axial,
        segments: water ? water.raySegments(origin, direction, horizon / axial) : [],
        bounds:options.cacheBounds !== false && volumes.length
          ? SceneOptics.rayBounds(volumes,origin,direction,horizon/axial,options.counters) : undefined,
        phase: tile ? (tile.ranks[y % tile.height * tile.width + x % tile.width] + .5) / tile.ranks.length : .5,
        values: new Float64Array(size) };
      if (ray.bounds?.ranges.length) ray.fullFog = [];
    }
    query.reflectionX = pixel % width + .5;
    query.reflectionY = Math.floor(pixel / width) + .5;
    const stop = Math.min(horizon, depth) / ray.axial;
    const useAerial = geometry && aerial && Number.isFinite(depth) && stop > aerial.start;
    fogCoverage = cloudCoverage = 0;
    fogThrough = 1;
    if (!useAerial && !ray.segments.length && !volumes.length && !options.cloud) {
      opacity = 0;
      return rgb;
    }
    if (useAerial && !ray.aerial) {
      ray.aerial = { ...aerial, color: aerial.color(pixel, ray.direction) };
    }
    if (useAerial && !ray.segments.length && !volumes.length && !options.cloud) {
      const raw = airTransmission(aerial, (stop-aerial.start)*fogScale);
      const remaining = options.bands ? 1-options.bands(1-raw) : raw;
      opacity = fogCoverage = 1 - remaining;
      fogThrough = remaining;
      return [0, 1, 2].map(i => remaining * rgb[i] + opacity * ray.aerial.color[i]);
    }
    const { values } = ray;
    const mode = Boolean(useAerial);
    if (stop !== ray.stop || mode !== ray.useAerial || fogScale !== ray.fogScale) {
      ray.stop = stop;
      ray.useAerial = mode;
      ray.fogScale = fogScale;
      query.fogScale = fogScale;
      query.axial = ray.axial;
      query.rayBounds = ray.bounds;
      query.fullFog = ray.fullFog;
      values.fill(0);
      for (let i = 0; i < samples; i++) {
        query.jitter = (i + ray.phase) / samples;
        query.sampleIndex = i;
        stats.depthSamples++;
        if (options.counters) options.counters.raySamples++;
        traceMedia(volumes, ray.segments, ray.origin, ray.direction, stop, result, sample, query, mode ? ray.aerial : null);
        for (let c = 0; c < size; c++) values[c] += result[c] / samples;
      }
    } else if (options.counters) options.counters.mediaCacheHits++;
    opacity = 1 - (values[3] + values[4] + values[5]) / 3;
    if (size > 6) {
      fogCoverage = values[6];
      cloudCoverage = values[7];
    }
    if (size > 8) fogThrough = values[8];
    return [0, 1, 2].map(i => values[i] + values[i + 3] * rgb[i]);
  }
  function contributions(out, p) {
    out[p] = fogCoverage;
    out[p+1] = cloudCoverage;
    out[p+2] = 1-opacity;
  }
  return { shade, opacity: () => opacity, fogThrough: () => fogThrough, contributions, stats };
}

function applyAtmosphere(volumes, col, depths, rayAt, W, H, horizon, quality, time, media, capture, history, viewKey, fogScales) {
  const light = [0, 0, 0, 1], sample = [0, 0, 0, 1];
  const fields = volumes.some(volume => volume.type === 'field' || volume.densityField || volume.depthBand?.sample || volume.paletteField) ||
    (media?.paletteLocals && volumes.some(volume => volume.lit));
  const query = { ...quality, time, media };
  // Reusing a density history would leave trails on animated lights and clear pockets.
  const transient = quality.flash || quality.cutouts?.fog || fogScales || volumes.some(volume => volume.paletteField);
  if (transient) history?.clear();
  const temporal = fields && !transient && !quality.cloudShadow && !volumes.some(v => v.densityField || v.depthBand?.sample) &&
    !media?.animatedLocals && quality.jitter === 'spatiotemporal' && history;
  const tile = fields && quality.jitter !== 'off' ? volumeNoise(quality.seed) : null;
  const accumulation = temporal ? new Float32Array(W * H * 4) : null;
  const frame = temporal ? Math.floor(time * 60) : 0;
  const phaseShift = (frame * .61803398875) % 1;
  const samples = fields ? quality.samples : 1;
  const stats = { rays: 0, fallbackRays: 0 };
  const fog = capture ? new Float32Array(W * H) : null;
  function solve(x, y, depth) {
    const { origin, direction, axial } = rayAt(x + .5, y + .5);
    query.axial = axial;
    if (fogScales) query.fogScale = fogScales[y*W+x];
    const stop = (Number.isFinite(depth) ? depth : horizon) / axial;
    const phase = tile ? ((tile.ranks[y % tile.height * tile.width + x % tile.width] + .5) / tile.ranks.length + phaseShift) % 1 : .5;
    light.fill(0);
    for (let i = 0; i < samples; i++) {
      query.jitter = (i + phase) / samples;
      SceneOptics.trace(volumes, origin, direction, stop, sample, query);
      for (let c = 0; c < 4; c++) light[c] += sample[c] / samples;
      stats.rays++;
      if (quality.counters) quality.counters.raySamples++;
    }
  }

  const { scale, depthTolerance } = quality, cw = Math.ceil(W / scale), ch = Math.ceil(H / scale);
  const low = scale > 1 ? new Float32Array(cw * ch * 4) : null;
  const lowDepth = low ? new Float32Array(cw * ch) : null;
  const lowFog = low && fogScales ? new Float64Array(cw*ch) : null;
  if (low) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const rx = Math.min(W - 1, x * scale + (scale >> 1)), ry = Math.min(H - 1, y * scale + (scale >> 1));
    const p = y * cw + x;
    lowDepth[p] = depths[ry * W + rx];
    if (lowFog) lowFog[p] = fogScales[ry*W+rx];
    solve(rx, ry, lowDepth[p]);
    low.set(light, p * 4);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 3;
    let weight = 0;
    if (low) {
      light.fill(0);
      const u = (x - (scale >> 1)) / scale, v = (y - (scale >> 1)) / scale;
      const ix = Math.floor(u), iy = Math.floor(v);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const bx = Math.max(0, Math.min(cw - 1, ix + dx)), by = Math.max(0, Math.min(ch - 1, iy + dy));
        const j = by * cw + bx, guide = lowDepth[j], depth = depths[i];
        const delta = guide === depth ? 0 : Math.abs(guide - depth);
        if (delta > depthTolerance || lowFog && lowFog[j] !== fogScales[i]) continue;
        const w = (1 - Math.abs(u - (ix + dx))) * (1 - Math.abs(v - (iy + dy))) / (1 + delta * 5);
        for (let c = 0; c < 4; c++) light[c] += low[j * 4 + c] * w;
        weight += w;
      }
    }
    if (weight) for (let c = 0; c < 4; c++) light[c] /= weight;
    else {
      solve(x, y, depths[i]);
      if (low) stats.fallbackRays += samples;
    }
    if (accumulation) accumulation.set(light, i * 4);
    else {
      if (quality.bands) ArtDirection.remapOpacity(light, quality.bands);
      for (let c = 0; c < 3; c++) col[p + c] = light[c] + light[3] * col[p + c];
      if (fog) fog[(H - 1 - y) * W + x] = 1 - light[3];
    }
  }
  if (accumulation) {
    history.filter(accumulation, depths, time, viewKey);
    for (let i = 0; i < W * H; i++) {
      const rgba = i*4;
      const opacity = 1-accumulation[rgba+3], styled = quality.bands ? quality.bands(opacity) : opacity;
      const gain = quality.bands && opacity > 0 ? styled/opacity : 1;
      const transmittance = quality.bands ? 1-styled : accumulation[rgba+3];
      for (let c = 0; c < 3; c++) col[i * 3 + c] = accumulation[rgba+c]*gain + transmittance * col[i * 3 + c];
      if (fog) fog[(H - 1 - Math.floor(i / W)) * W + i % W] = 1 - transmittance;
    }
  }
  return { fog, stats };
}

module.exports = { cameraRays, surfacePoint, reflectionSampler, atmosphereQuality, traceMedia, mediaSampler, applyAtmosphere };
