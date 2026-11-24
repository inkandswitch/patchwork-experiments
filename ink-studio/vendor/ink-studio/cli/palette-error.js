const Color = require('../src/color-space.js');

const heatRamp = [
  [0, [18, 23, 38]], [.25, [46, 108, 166]], [.5, [69, 212, 197]],
  [.75, [255, 199, 74]], [1, [255, 66, 76]]
];
const swatch = value => '#' + value.toString(16).padStart(6, '0');
const packed = (rgb, i) => rgb[i] * 65536 + rgb[i + 1] * 256 + rgb[i + 2];
const byteRaster = (data, length) =>
  (data instanceof Uint8Array || data instanceof Uint8ClampedArray) && data.length === length;
const isHot = (value, threshold) => value > 0 && value >= threshold;

function summary() {
  return { pixels:0, changedPixels:0, highErrorPixels:0, sum:0, squares:0, max:0, peak:-1 };
}

function accumulate(row, pixel, error, hot) {
  row.pixels++;
  if (error > 0) row.changedPixels++;
  if (hot) row.highErrorPixels++;
  row.sum += error;
  row.squares += error * error;
  if (error > row.max) {
    row.max = error;
    row.peak = pixel;
  }
}

function format(row, worst) {
  const { pixels, changedPixels, highErrorPixels, max } = row;
  return { pixels, changedPixels, highErrorPixels, highErrorShare:pixels ? highErrorPixels / pixels : 0,
    meanError:pixels ? row.sum / pixels : 0, rmsError:pixels ? Math.sqrt(row.squares / pixels) : 0,
    maxError:max, worstPixel:worst(row.peak) };
}

function heatColors(tableSize = 256) {
  const table = new Uint8Array(tableSize * 3);
  for (let i = 0; i < tableSize; i++) {
    const u = i / (tableSize - 1);
    const end = Math.max(1, heatRamp.findIndex(([point]) => point >= u));
    const [a, low] = heatRamp[end - 1], [b, high] = heatRamp[end];
    for (let k = 0; k < 3; k++) table[i * 3 + k] = Math.round(low[k] + (high[k] - low[k]) * (u - a) / (b - a));
  }
  return table;
}
const heat = heatColors();

function hotRegions(errors, ids, w, h, threshold, limit, count, names, worst) {
  if (!count || !limit) return [];
  const visited = new Uint8Array(errors.length), queue = new Uint32Array(count);
  const regions = [];
  const rank = (a,b) => b.sum - a.sum || b.max - a.max || a.seed - b.seed;
  for (let seed = 0; seed < errors.length; seed++) {
    if (visited[seed] || !isHot(errors[seed], threshold)) continue;
    const id = ids?.[seed] ?? 0;
    let head = 0, tail = 0, left = w, right = -1, top = h, bottom = -1;
    const area = { seed, id, sum:0, max:0, peak:seed };
    function enqueue(p) {
      if (visited[p] || (ids?.[p] ?? 0) !== id || !isHot(errors[p], threshold)) return;
      visited[p] = 1;
      queue[tail++] = p;
    }
    enqueue(seed);
    while (head < tail) {
      const p = queue[head++], x = p % w, y = Math.floor(p / w), delta = errors[p];
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      area.sum += delta;
      if (delta > area.max) { area.max = delta; area.peak = p; }
      if (x > 0) enqueue(p - 1);
      if (x + 1 < w) enqueue(p + 1);
      if (y > 0) enqueue(p - w);
      if (y + 1 < h) enqueue(p + w);
    }
    if (regions.length === limit && rank(area, regions[limit - 1]) >= 0) continue;
    area.pixels = tail;
    area.bounds = { x:left,y:top,width:right-left+1,height:bottom-top+1 };
    regions.push(area);
    regions.sort(rank);
    if (regions.length > limit) regions.pop();
  }
  return regions.map(row=>({ materialId:row.id, material:names?.[row.id] ?? null, pixels:row.pixels,
    bounds:row.bounds, meanError:row.sum / row.pixels, maxError:row.max, worstPixel:worst(row.peak) }));
}

function measureQuantizationError(capture, { passes, threshold = .06, heatmapMax = .20, regionLimit = 20 } = {}) {
  const { w, h, graded, resolved, alpha, px, stage } = capture ?? {};
  const size = w * h;
  if (!Number.isSafeInteger(w) || w < 1 || !Number.isSafeInteger(h) || h < 1 || size > 2 ** 24 ||
      !byteRaster(graded, size * 3) || !byteRaster(resolved, size * 3) || alpha != null && !byteRaster(alpha, size))
    throw new TypeError('Palette error needs aligned graded and resolved RGB8 rasters and optional shared alpha');
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(heatmapMax) || heatmapMax <= 0 ||
      !Number.isSafeInteger(regionLimit) || regionLimit < 0 || regionLimit > 100)
    throw new RangeError('Palette error needs a nonnegative threshold, positive heatmap maximum and 0–100 regions');
  const ids = passes?.materialId, names = passes?.materials;
  if (passes && (passes.w !== w || passes.h !== h || !(ids instanceof Uint32Array) || ids.length !== size))
    throw new TypeError('Palette error needs a materialId pass on the same art grid');

  const colors = new Map();
  function lab(key) {
    if (colors.has(key)) return colors.get(key);
    const result = Color.toOKLab([(key >> 16) / 255, (key >> 8 & 255) / 255, (key & 255) / 255]);
    if (colors.size < 8192) colors.set(key, result);
    return result;
  }
  const errors = new Float32Array(size), rgb = new Uint8Array(size * 3);
  const overall = summary(), materials = new Map();
  let transparentPixels = 0;
  for (let p = 0; p < size; p++) {
    if (alpha?.[p] === 0) { transparentPixels++; continue; }
    const i = p * 3, id = ids?.[p] ?? 0, a = packed(graded,i), b = packed(resolved,i);
    if (a !== b) {
      const A = lab(a), B = lab(b);
      errors[p] = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    }
    const error = errors[p], hot = isHot(error, threshold);
    if (!materials.has(id)) materials.set(id, summary());
    accumulate(overall, p, error, hot);
    accumulate(materials.get(id), p, error, hot);
    const shade = 3 * Math.round(255 * Math.min(1, error / heatmapMax));
    for (let k = 0; k < 3; k++) rgb[i + k] = heat[shade + k];
  }
  function worst(p) {
    return p < 0 ? null : { x:p%w, y:Math.floor(p/w), error:errors[p],
      graded:swatch(packed(graded, p*3)), resolved:swatch(packed(resolved, p*3)) };
  }
  const byMaterial = [...materials].map(([id,row])=>({
    id, material:names?.[id] ?? null, ...format(row, worst)
  })).sort((a,b)=>b.highErrorPixels-a.highErrorPixels || b.meanError-a.meanError || a.id-b.id);
  return {
    heatmap:{ w,h,rgb,alpha }, errors,
    report:{ width:w, height:h, pixelSize:px ?? 1, stage:stage ?? null, metric:'oklab-distance',
      threshold, heatmapMax, legend:heatRamp.map(([u,rgb])=>({error:u*heatmapMax,swatch:swatch(packed(rgb,0))})),
      transparentPixels, ...format(overall, worst), materials:byMaterial,
      regions:hotRegions(errors, ids, w, h, threshold, regionLimit, overall.highErrorPixels, names, worst) }
  };
}

function reviewQuantizationError(world, { threshold, heatmapMax, regionLimit, ...view } = {}) {
  if (view.raw) throw new RangeError('Palette error review needs a palette-enabled render');
  const time = view.time ?? view.t ?? world.lookSnapshot?.time ?? 0;
  if (!Number.isFinite(time)) throw new RangeError('Palette error review time must be finite');
  const frame = require('./render.js').render(world, { ...view, t:time, captureQuantization:true,
    samples:false, captureCoverage:false, cameraGuides:false, inspection:false, renderGraph:false,
    passes:['materialId'] });
  const { quantization, passes } = frame;
  const result = measureQuantizationError(quantization, { passes, threshold, heatmapMax, regionLimit });
  result.report.scene = world.id ?? null;
  result.report.time = time;
  const { w, h, alpha } = quantization;
  return { ...result, graded:{w,h,alpha,rgb:quantization.graded}, resolved:{w,h,alpha,rgb:quantization.resolved} };
}

module.exports = { measureQuantizationError, reviewQuantizationError };
