// Shared colored stencils for surface and volume lights. Texels store linear transmission.
const LightCookies = (() => {
  const cache = new WeakMap(), geometricKey = Symbol.for('ink-studio.geometric-light-cookie'),
    radians = Math.PI / 180;
  const check = (ok, s) => {
    if (!ok) throw new RangeError('Light cookie: ' + s);
  };
  const clamp = n => Math.max(0, Math.min(1, n));
  const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = v => {
    check(vector(v) && Math.hypot(...v) > 1e-8, 'orientation needs nonzero XYZ vectors');
    return v.map(n => n / Math.hypot(...v));
  };
  function raster(raw) {
    check(raw && typeof raw === 'object' && !Array.isArray(raw), 'expected a raster');
    const { width, height, mask, rgb, rgba, filter = 'nearest' } = raw;
    check(
      Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0 &&
        width * height <= 1048576 &&
        ['nearest', 'linear'].includes(filter),
      'invalid bounded dimensions or filter'
    );
    check([mask, rgb, rgba].filter(v => v !== undefined).length === 1, 'supply one mask, RGB or RGBA byte raster');
    const input = mask ?? rgb ?? rgba,
      channels = mask ? 1 : rgb ? 3 : 4;
    check(
      (Array.isArray(input) || ArrayBuffer.isView(input)) && input.length === width * height * channels,
      'incorrect byte raster length'
    );
    for (const b of input) check(Number.isInteger(b) && b >= 0 && b <= 255, 'raster needs bytes');
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const a = channels === 4 ? input[i * 4 + 3] / 255 : 1;
      for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(input[i * channels + (channels === 1 ? 0 : k)] * a);
      data[i * 4 + 3] = 255;
    }
    return Object.freeze({ width, height, data, filter });
  }
  function prepare(raw, time = 0) {
    if (raw?.[geometricKey]) raw = raw[geometricKey].frame(time);
    const previous = cache.get(raw);
    if (previous?.revision === (raw.revision ?? 0)) return previous.image;
    const result = raster(raw);
    cache.set(raw, { revision: raw.revision ?? 0, image: result });
    return result;
  }
  function sample(image, u, v, out = [0, 0, 0]) {
    out.fill(0);
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return out;
    const { width: w, height: h, data, filter } = image;
    if (filter === 'nearest') {
      const p = (Math.floor(v * h) * w + Math.floor(u * w)) * 4;
      for (let k = 0; k < 3; k++) out[k] = data[p + k] / 255;
      return out;
    }
    const x = u * w - 0.5,
      y = v * h - 0.5,
      ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const p = (Math.max(0, Math.min(h - 1, iy + j)) * w + Math.max(0, Math.min(w - 1, ix + i))) * 4,
          weight = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
        for (let k = 0; k < 3; k++) out[k] += (data[p + k] / 255) * weight;
      }
    return out;
  }
  function projection(raw, direction, outer, time = 0, evaluate = v => (typeof v === 'function' ? v(time) : v)) {
    const image = prepare(raw, time),
      normal = unit(direction),
      up = unit(raw.up ?? (Math.abs(normal[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0])),
      right = unit(cross(normal, up)),
      vertical = cross(right, normal);
    const roll = evaluate(raw.roll ?? 0),
      angle = raw.angle ?? Math.min(outer, 89.9),
      offset = evaluate(raw.offset ?? [0, 0]),
      repeat = raw.repeat ?? [1, 1];
    check(
      Number.isFinite(roll) &&
        Number.isFinite(angle) &&
        angle >= 0.01 &&
        angle < 90 &&
        Array.isArray(offset) &&
        offset.length === 2 &&
        offset.every(Number.isFinite) &&
        Array.isArray(repeat) &&
        repeat.length === 2 &&
        repeat.every(n => Number.isFinite(n) && n > 0),
      'invalid angle, roll or UV transform'
    );
    const s = Math.sin(roll * radians),
      c = Math.cos(roll * radians),
      scale = 0.5 / Math.tan(angle * radians);
    const u = right.map((n, i) => ((n * c + vertical[i] * s) * scale * image.height) / image.width),
      v = vertical.map((n, i) => (right[i] * s - n * c) * scale);
    return {
      image,
      animated: !!raw[geometricKey],
      u,
      v,
      wrap: !!raw.wrap,
      offset: offset.slice(),
      repeat: repeat.slice(),
      sample(toLight, forward, out = [0, 0, 0]) {
        if (forward <= 0) {
          out.fill(0);
          return out;
        }
        let x = 0.5 - dot(toLight, u) / forward,
          y = 0.5 - dot(toLight, v) / forward;
        if (x < 0 || x >= 1 || y < 0 || y >= 1) {
          out.fill(0);
          return out;
        }
        x = (x - 0.5) * repeat[0] + 0.5 + offset[0];
        y = (y - 0.5) * repeat[1] + 0.5 + offset[1];
        if (raw.wrap) {
          x = ((x % 1) + 1) % 1;
          y = ((y % 1) + 1) % 1;
        }
        return sample(image, x, y, out);
      }
    };
  }
  function pattern({
    width = 64,
    height = 64,
    pattern = 'stripes',
    color = '#ffffff',
    background = '#000000',
    frequency = 6,
    thickness = 0.4,
    phase = 0,
    colors,
    ...projection
  } = {}) {
    check(
      Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0 &&
        width * height <= 1048576 &&
        Number.isFinite(frequency) &&
        frequency > 0 &&
        Number.isFinite(thickness) &&
        thickness > 0 &&
        thickness < 1 &&
        Number.isFinite(phase),
      'invalid pattern dimensions or parameters'
    );
    const parse = s => {
      check(typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s), 'colors need #rrggbb');
      return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
    };
    const ink = parse(color),
      paper = parse(background),
      palette = colors?.map(parse),
      rgba = new Uint8Array(width * height * 4);
    check(['stripes', 'checker', 'rings', 'rosette', 'window', 'stainedGlass'].includes(pattern), 'unknown pattern');
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width,
          v = (y + 0.5) / height,
          xx = u - 0.5,
          yy = v - 0.5,
          r = Math.hypot(xx, yy),
          a = Math.atan2(yy, xx),
          fract = n => n - Math.floor(n);
        let on,
          index = 0;
        if (pattern === 'stripes') on = fract(u * frequency + phase) < thickness;
        if (pattern === 'checker') on = (Math.floor(u * frequency + phase) + Math.floor(v * frequency)) % 2 === 0;
        if (pattern === 'rings') on = fract(r * frequency * 2 + phase) < thickness;
        if (pattern === 'rosette')
          on = r < 0.46 && r > 0.1 && Math.abs(Math.sin((a * frequency) / 2 + r * 3 + phase)) < thickness;
        if (pattern === 'window' || pattern === 'stainedGlass') {
          const cx = fract(u * frequency),
            cy = fract(v * Math.max(1, frequency * 0.7));
          on =
            cx > thickness * 0.12 &&
            cx < 1 - thickness * 0.12 &&
            cy > thickness * 0.12 &&
            cy < 1 - thickness * 0.12 &&
            r < 0.66;
          index =
            (Math.floor(u * frequency) + 3 * Math.floor(v * Math.max(1, frequency * 0.7))) % (palette?.length ?? 1);
        }
        const rgb = on ? (palette?.[index] ?? ink) : paper;
        rgba.set([...rgb, 255], (y * width + x) * 4);
      }
    const result = { ...projection, width, height, rgba };
    Object.defineProperty(result, 'toJSON', {
      value: () => ({ ...projection, width, height, rgba: Array.from(rgba) })
    });
    return result;
  }
  function geometric({ width = 128, height = 128, angle = 24, focus = 5, lens, samples, exposure, blur, incident,
    filter = 'linear', period, ...projection } = {}) {
    const G = typeof GeometricCaustics !== 'undefined' ? GeometricCaustics : require('./geometric-caustics.js');
    check(['nearest','linear'].includes(filter) && (period === undefined || Number.isFinite(period) && period > 0),
      'invalid geometric filter or period');
    const bake = G.compile({width,height,angle,focus,lens,samples,exposure,blur,incident});
    let lastTime, lastFrame;
    const settings = { ...projection,width,height,angle,filter };
    function frame(time = 0) {
      check(Number.isFinite(time),'geometric cookies need a finite time');
      const t = period === undefined ? time : ((time%period)+period)%period;
      if (lastFrame && t===lastTime) return lastFrame;
      const rgb = bake(t);
      lastFrame = Object.freeze({ ...settings,rgb,toJSON:()=>({ ...settings,rgb:Array.from(rgb) }) });
      lastTime = t;
      return lastFrame;
    }
    const generator = Object.freeze({ frame,invalidate() { lastFrame=undefined; } });
    return Object.freeze({ ...settings,frame,toJSON:()=>frame().toJSON(),[geometricKey]:generator });
  }
  return Object.freeze({ prepare, sample, projection, pattern, geometric, invalidate(raw) {
    if (raw?.[geometricKey]) raw[geometricKey].invalidate();
    else cache.delete(raw);
  } });
})();
if (typeof module !== 'undefined') module.exports = LightCookies;
