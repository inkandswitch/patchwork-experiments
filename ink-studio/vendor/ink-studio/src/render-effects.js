/* Bounded screen effects. RGBA work packets preserve the original full-resolution frame. */
const RenderEffects = (() => {
  const types = ['bloom', 'halation', 'outline', 'chromatic', 'blocks', 'pixelSort'];
  const fields = {
    bloom: ['radius', 'threshold', 'intensity', 'tint'],
    halation: ['radius', 'threshold', 'intensity', 'tint', 'inner'],
    outline: ['width', 'color', 'side', 'relativeDepth'],
    chromatic: ['offset', 'radial', 'center'],
    blocks: ['blockSize', 'offset', 'probability', 'rate', 'seed'],
    pixelSort: ['span', 'axis', 'threshold', 'descending']
  };
  const clamp = n => Math.max(0, Math.min(1, n));
  const plain = v => v && Object.getPrototypeOf(v) === Object.prototype;
  function record(v, keys, name) {
    if (!plain(v) || Object.keys(v).some(k => !keys.includes(k))) throw new TypeError('Invalid ' + name);
  }
  function number(v, lo, hi, name) {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(name + ' outside [' + lo + ', ' + hi + ']');
    return v;
  }
  function pair(v, lo, hi, name) {
    if (!Array.isArray(v) || v.length !== 2) throw new TypeError('Expected XY ' + name);
    return Array.from(v, n => number(n, lo, hi, name));
  }
  function flag(v, name) {
    if (typeof v !== 'boolean') throw new TypeError(name + ' must be boolean');
    return v;
  }
  function rgb(v) {
    if (!Array.isArray(v) || v.length !== 3) throw new TypeError('Expected RGB bytes');
    return Array.from(v, n => number(n, 0, 255, 'RGB'));
  }
  function depth(value) {
    if (value === undefined) return;
    record(value, ['near', 'far', 'feather', 'invert', 'background'], 'effect depth mask');
    const near = number(value.near ?? 0, 0, 1e9, 'near'),
      far = number(value.far ?? 1e9, 0, 1e9, 'far');
    if (near >= far) throw new RangeError('Depth near must precede far');
    return {
      near,
      far,
      feather: number(value.feather ?? 0, 0, 1e9, 'depth feather'),
      invert: flag(value.invert ?? false, 'depth invert'),
      background: flag(value.background ?? false, 'background')
    };
  }
  function budget(value = {}, effect = false) {
    record(value, ['scale', 'maxPixels', 'maxSamples', 'filter'], 'effect budget');
    const scale = number(value.scale ?? 1, 1e-6, 1, 'effect scale');
    const maxPixels = number(value.maxPixels ?? (effect ? 65536 : 8388608), 1, 33554432, 'maxPixels');
    const maxSamples = number(value.maxSamples ?? 24, 1, 64, 'maxSamples');
    if (!Number.isInteger(maxPixels) || !Number.isInteger(maxSamples))
      throw new RangeError('Pixel and sample budgets must be integers');
    const filter = value.filter ?? 'linear';
    if (!['linear', 'nearest'].includes(filter)) throw new TypeError('Invalid budget filter');
    return { scale, maxPixels, maxSamples, filter };
  }
  function settings(pass) {
    const type = pass.type,
      glow = type === 'bloom' || type === 'halation',
      shape = type === 'outline';
    const out = {
      effect: true,
      budget: budget(
        {
          maxPixels: shape || type === 'chromatic' ? 1048576 : 65536,
          filter: type === 'blocks' || type === 'pixelSort' ? 'nearest' : 'linear',
          ...pass.budget
        },
        true
      ),
      depth: depth(pass.depth),
      maskMode: pass.maskMode ?? (glow || shape ? 'source' : 'both'),
      depthThreshold: number(pass.depthThreshold ?? 0.25, 0, 1e9, 'depthThreshold'),
      protectObjects: flag(pass.protectObjects ?? !glow, 'protectObjects')
    };
    if (!['source', 'output', 'both'].includes(out.maskMode)) throw new TypeError('Invalid effect maskMode');
    if (glow)
      Object.assign(out, {
        radius: number(pass.radius ?? (glow && type === 'halation' ? 9 : 16), 0.1, 512, 'radius'),
        threshold: number(pass.threshold ?? 0.65, 0, 0.9999, 'threshold'),
        intensity: number(pass.intensity ?? 0.6, 0, 8, 'intensity'),
        tint: rgb(pass.tint ?? (type === 'halation' ? [255, 88, 35] : [255, 255, 255])),
        inner: number(pass.inner ?? 0.35, 0, 0.95, 'inner')
      });
    if (shape) {
      const side = pass.side ?? 'inner';
      if (!['inner', 'outer', 'both'].includes(side)) throw new TypeError('Invalid outline side');
      Object.assign(out, {
        width: number(pass.width ?? 1, 0.1, 32, 'outline width'),
        color: rgb(pass.color ?? [18, 28, 39]),
        side,
        relativeDepth: number(pass.relativeDepth ?? 0.01, 0, 1, 'relativeDepth')
      });
    }
    if (type === 'chromatic')
      Object.assign(out, {
        offset: pair(pass.offset ?? [0.7, 0], -8, 8, 'chromatic offset'),
        radial: number(pass.radial ?? 0, -8, 8, 'radial separation'),
        center: pair(pass.center ?? [0.5, 0.5], 0, 1, 'center')
      });
    if (type === 'blocks') {
      const seed = number(pass.seed ?? 1, 0, 4294967295, 'block seed');
      if (!Number.isInteger(seed)) throw new RangeError('Block seed must be an unsigned integer');
      const blockSize = pair(pass.blockSize ?? [48, 16], 1, 4096, 'blockSize');
      Object.assign(out, {
        blockSize,
        offset: pair(pass.offset ?? [16, 0], -512, 512, 'block offset'),
        probability: number(pass.probability ?? 0.08, 0, 1, 'block probability'),
        rate: number(pass.rate ?? 5, 0, 120, 'block rate'),
        seed
      });
    }
    if (type === 'pixelSort') {
      const span = number(pass.span ?? 12, 2, 32, 'sort span'),
        axis = pass.axis ?? 'x',
        threshold = pair(pass.threshold ?? [0.15, 1], 0, 1, 'sort threshold');
      if (!Number.isInteger(span) || !['x', 'y'].includes(axis) || threshold[0] > threshold[1])
        throw new TypeError('Invalid pixel sorting run');
      Object.assign(out, { span, axis, threshold, descending: flag(pass.descending ?? false, 'descending') });
    }
    return out;
  }
  function depthWeight(mask, z) {
    if (!mask) return 1;
    // Background is an explicit opt-in, independent of inversion of the finite interval.
    if (!Number.isFinite(z)) return +mask.background;
    const edge = Math.min(z - mask.near, mask.far - z);
    const w = mask.feather ? clamp(edge / mask.feather) : +(edge >= 0);
    return mask.invert ? 1 - w : w;
  }
  function hash(x) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  const linear = x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const display = x => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
  const luminance = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / Math.max(1e-9, c[3]);

  function render(node, input, w, h, layout, { weight, depth, group, time = 0 }) {
    const { width: W, height: H, samples } = layout,
      packet = new Uint8Array(W * H * 4),
      glow = ['bloom', 'halation'].includes(node.type);
    const sourceMask = node.maskMode !== 'output',
      outputMask = node.maskMode !== 'source';
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const read = (x, y) => {
      const q = (Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)))) * 4;
      return [input[q] / 255, input[q + 1] / 255, input[q + 2] / 255, input[q + 3] / 255];
    };
    const same = (x, y, sx, sy, emission = false) => {
      if (!inside(sx, sy)) return false;
      const a = depth(x, y),
        b = depth(sx, sy),
        as = !Number.isFinite(a),
        bs = !Number.isFinite(b);
      if (emission) return as || (!bs && b <= a + node.depthThreshold);
      return (
        as === bs &&
        (as || Math.abs(a - b) <= node.depthThreshold) &&
        (!node.protectObjects || group(x, y) === group(sx, sy))
      );
    };
    const eligible = (x, y, x0, y0) => {
      if (!same(x0, y0, x, y) || (sourceMask && weight(x, y) <= 0)) return false;
      const c = read(x, y),
        l = luminance(c);
      return c[3] > 0 && l >= node.threshold[0] && l <= node.threshold[1];
    };
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = ((i + 0.5) * w) / W,
          y = ((j + 0.5) * h) / H,
          q = (j * W + i) * 4,
          base = read(x, y);
        let result = base.slice(),
          coverage = 0;
        if (glow) {
          result = [0, 0, 0, 0];
          for (let k = 0; k < samples; k++) {
            const t = (k + 0.5) / samples,
              r = node.radius * Math.sqrt(node.type === 'halation' ? node.inner ** 2 + t * (1 - node.inner ** 2) : t);
            const a = k * 2.39996323,
              sx = x + r * Math.cos(a),
              sy = y + r * Math.sin(a);
            if (!same(x, y, sx, sy, true)) continue;
            const c = read(sx, sy),
              bright = Math.max(c[0], c[1], c[2]) / Math.max(c[3], 1e-9);
            const amount =
              clamp((bright - node.threshold) / (1 - node.threshold)) *
              (sourceMask ? weight(sx, sy) : 1) *
              (node.type === 'bloom' ? Math.exp(-2 * t) : 1);
            for (let ch = 0; ch < 3; ch++)
              result[ch] += (linear(c[ch] / Math.max(c[3], 1e-9)) * c[3] * amount * node.tint[ch]) / 255 / samples;
          }
          for (let ch = 0; ch < 3; ch++) result[ch] *= node.intensity * (node.type === 'bloom' ? 2.35 : 1);
        } else if (node.type === 'outline') {
          const z = depth(x, y),
            g = group(x, y);
          for (let k = 0; k < Math.min(8, samples); k++) {
            const a = (k * Math.PI * 2) / Math.min(8, samples),
              sx = x + Math.cos(a) * node.width,
              sy = y + Math.sin(a) * node.width;
            if (!inside(sx, sy)) continue;
            const nz = depth(sx, sy),
              ng = group(sx, sy),
              near = z < nz,
              far = nz < z;
            const boundary =
              Number.isFinite(z) !== Number.isFinite(nz) ||
              (Number.isFinite(z) &&
                Number.isFinite(nz) &&
                Math.abs(z - nz) > Math.max(node.depthThreshold, Math.min(z, nz) * node.relativeDepth)) ||
              (node.protectObjects && g !== ng);
            if (!boundary) continue;
            if (node.side !== 'outer' && Number.isFinite(z) && (near || (g !== ng && !far)))
              coverage = Math.max(coverage, sourceMask ? weight(x, y) : 1);
            if (node.side !== 'inner' && Number.isFinite(nz) && (far || (g !== ng && !near)))
              coverage = Math.max(coverage, sourceMask ? weight(sx, sy) : 1);
          }
          result = node.color.map(c => c / 255).concat(coverage);
        } else if (node.type === 'chromatic') {
          const ox = node.offset[0] + (x / w - node.center[0]) * node.radial,
            oy = node.offset[1] + (y / h - node.center[1]) * node.radial;
          for (const [ch, sign] of [
            [0, 1],
            [2, -1]
          ]) {
            const sx = x + ox * sign,
              sy = y + oy * sign;
            if (same(x, y, sx, sy) && (!sourceMask || weight(sx, sy) > 0)) result[ch] = read(sx, sy)[ch];
          }
        } else if (node.type === 'blocks') {
          const bx = Math.floor(x / node.blockSize[0]),
            by = Math.floor(y / node.blockSize[1]),
            tick = Math.floor(time * node.rate);
          const key = hash(
            (Math.imul(bx, 73856093) ^ Math.imul(by, 19349663) ^ Math.imul(tick, 83492791) ^ node.seed) >>> 0
          );
          if ((key >>> 8) / 16777216 < node.probability) {
            const sign = key & 1 ? 1 : -1,
              sx = x + node.offset[0] * sign,
              sy = y + node.offset[1] * sign;
            if (same(x, y, sx, sy) && (!sourceMask || weight(sx, sy) > 0)) result = read(sx, sy);
          }
        } else {
          const horizontal = node.axis === 'x',
            site = horizontal ? i : j,
            extent = horizontal ? W : H;
          const span = Math.min(node.span, samples),
            start = Math.floor(site / span) * span;
          const at = n => (horizontal ? [((n + 0.5) * w) / W, y] : [x, ((n + 0.5) * h) / H]);
          if (eligible(x, y, x, y)) {
            let left = site,
              right = site;
            while (left > start && eligible(...at(left - 1), ...at(left))) left--;
            while (right + 1 < Math.min(start + span, extent) && eligible(...at(right + 1), ...at(right))) right++;
            const colors = [];
            for (let n = left; n <= right; n++) colors.push(read(...at(n)));
            colors.sort((a, b) => (luminance(a) - luminance(b)) * (node.descending ? -1 : 1));
            result = colors[site - left];
          }
        }
        if (glow) {
          for (let c = 0; c < 3; c++) packet[q + c] = Math.round(clamp(result[c]) * 255);
          packet[q + 3] = 255;
        } else if (node.type === 'outline')
          for (let c = 0; c < 4; c++) packet[q + c] = Math.round(clamp(result[c]) * 255);
        else {
          const gate = sourceMask ? weight(x, y) : 1;
          for (let c = 0; c < 3; c++) packet[q + c] = Math.round(128 + (result[c] - base[c]) * gate * 127);
          packet[q + 3] = 255;
        }
      }
    // Bilinear only within compatible depth/owner neighborhoods, so low-resolution
    // work does not reintroduce foreground bleed during reconstruction.
    const output = input.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const xx = x + 0.5,
          yy = y + 0.5,
          q = (y * w + x) * 4;
        const amount = node.opacity * (outputMask ? weight(xx, yy) : 1);
        if (!amount) continue;
        const u = (xx * W) / w - 0.5,
          v = (yy * H) / h - 0.5,
          ix = Math.floor(u),
          iy = Math.floor(v),
          sum = [0, 0, 0, 0];
        let norm = 0;
        const smooth = node.budget.filter === 'linear';
        for (let k = 0; k < (smooth ? 4 : 1); k++) {
          const px = Math.max(0, Math.min(W - 1, smooth ? ix + (k % 2) : Math.floor(u + 0.5)));
          const py = Math.max(0, Math.min(H - 1, smooth ? iy + Math.floor(k / 2) : Math.floor(v + 0.5)));
          const sx = ((px + 0.5) * w) / W,
            sy = ((py + 0.5) * h) / H;
          if (!same(xx, yy, sx, sy, glow || (node.type === 'outline' && node.side !== 'inner'))) continue;
          const a = smooth ? (k % 2 ? u - ix : 1 - u + ix) * (k >= 2 ? v - iy : 1 - v + iy) : 1;
          norm += a;
          for (let c = 0; c < 4; c++) sum[c] += (packet[(py * W + px) * 4 + c] / 255) * a;
        }
        if (norm <= 0) continue;
        for (let c = 0; c < 4; c++) sum[c] /= norm;
        const alpha = input[q + 3] / 255;
        for (let c = 0; c < 3; c++) {
          const original = input[q + c] / 255;
          const value = glow
            ? display(linear(original / Math.max(alpha, 1e-9)) + sum[c] * amount) * alpha
            : node.type === 'outline'
              ? original * (1 - sum[3] * amount) + sum[c] * alpha * sum[3] * amount
              : original + ((sum[c] * 255 - 128) / 127) * amount;
          output[q + c] = Math.round(Math.max(0, Math.min(alpha, value)) * 255);
        }
      }
    return output;
  }
  return Object.freeze({ types, fields, settings, budget, depth, depthWeight, hash, render });
})();
if (typeof module !== 'undefined') module.exports = RenderEffects;
