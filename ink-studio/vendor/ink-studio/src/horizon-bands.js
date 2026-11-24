/* Distant RGBA artwork on concentric world-space cylinders. */
const HorizonBands = (() => {
  const compiled = Symbol.for('ink-studio.horizon-bands');
  const rad = Math.PI / 180, turn = 2 * Math.PI;
  const white = [1, 1, 1];
  function mod(value, period) {
    const remainder = value % period;
    return remainder < 0 ? remainder + period : remainder;
  }
  const record = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(name + ' needs an object');
    return value;
  };
  function number(value, min, max, name) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(name + ' is out of range');
    return value;
  }
  function vector(value, size, name) {
    if (!Array.isArray(value) || value.length !== size || Array.from(value).some(n => !Number.isFinite(n) || Math.abs(n) > 1e7))
      throw new TypeError(name + ' needs ' + size + ' finite numbers within world bounds');
    return value.slice();
  }
  function range(value, min, max, length, name) {
    const [start, end] = vector(value, 2, name);
    if (start < min || end > max || end <= start || end - start > length)
      throw new RangeError(name + ' needs increasing bounds within ' + min + ' to ' + max + ' and a span of at most ' + length);
    return [start, end - start];
  }
  const radians = values => values.map(n => n * rad);
  function image(source, readImage, name) {
    const { width, height, pixels } = record(typeof source === 'string' && readImage ? readImage(source) : source, name);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || width * height > 4194304)
      throw new RangeError(name + ' dimensions exceed the pixel budget or are invalid');
    if (!(Array.isArray(pixels) || pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) ||
        pixels.length !== width * height * 4) throw new TypeError(name + ' needs width × height RGBA bytes');
    if (Array.isArray(pixels)) for (const byte of pixels)
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError(name + ' has an invalid RGBA byte');
    return { width, height, pixels: Array.isArray(pixels) ? Uint8Array.from(pixels) : pixels };
  }
  function channel(value, name) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) throw new TypeError(name + ' needs a channel name');
    return value;
  }
  const smooth = t => t * t * (3 - 2 * t);
  function weight(at, span, fade) {
    if (at < 0 || at > span) return 0;
    return fade ? smooth(Math.min(1, Math.min(at, span - at) / fade)) : 1;
  }

  function compile(source, { readImage } = {}) {
    if (source === undefined || source === false) return null;
    if (source?.[compiled]) return source;
    const { origin = [0, 0, 0], camera, bands } = record(source, 'Horizon bands');
    const [ox, oy, oz] = vector(origin, 3, 'Horizon origin');
    const { yaw, pitch, distance, fade = {} } = record(camera, 'Horizon camera');
    const [yawStart, yawSpan] = radians(range(yaw, -360, 720, 360, 'Camera yaw'));
    const [pitchStart, pitchSpan] = radians(range(pitch, -90, 90, 180, 'Camera pitch'));
    const [distStart, distSpan] = distance === undefined ? [0, Infinity] : range(distance, 0, 1e7, 1e7, 'Camera distance');
    const fades = record(fade, 'Horizon camera fade');
    const yawFade = number(fades.yaw ?? 0, 0, yawSpan / (2 * rad), 'Camera yaw fade') * rad;
    const pitchFade = number(fades.pitch ?? 0, 0, pitchSpan / (2 * rad), 'Camera pitch fade') * rad;
    const distFade = number(fades.distance ?? 0, 0, distance === undefined ? 0 : distSpan / 2, 'Camera distance fade');

    if (!Array.isArray(bands) || !bands.length || bands.length > 16) throw new TypeError('Horizon needs 1 to 16 bands');
    const ids = new Set();
    let totalPixels = 0;
    const layers = Array.from(bands, value => {
      const { id, image: art, radius, height, azimuth = [0, 360], repeat = 1, opacity = 1, gain, tint } =
        record(value, 'Horizon band');
      if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new TypeError('Horizon bands need unique names');
      ids.add(id);
      const bitmap = image(art, readImage, id + ' image');
      totalPixels += bitmap.width * bitmap.height;
      if (totalPixels > 8388608) throw new RangeError('Horizon images exceed the total pixel budget');
      const [bottom, span] = range(height, -1e7, 1e7, 2e7, id + ' height');
      const [start, arc] = radians(range(azimuth, -360, 720, 360, id + ' azimuth'));
      if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 128) throw new RangeError(id + ' repeat needs 1 to 128 tiles');
      return { bitmap, radius: number(radius, .001, 1e7, id + ' radius'), bottom, span, start, arc, repeat,
        opacity: number(opacity, 0, 1, id + ' opacity'), gain: channel(gain, id + ' gain'), tint: channel(tint, id + ' tint') };
    }).sort((a, b) => b.radius - a.radius);

    function frame({ eye, yaw, pitch, distance, parameters }) {
      const cameraWeight = (yawSpan >= turn ? 1 : weight(mod(yaw - yawStart, turn), yawSpan, yawFade)) *
        weight(pitch - pitchStart, pitchSpan, pitchFade) * weight(distance - distStart, distSpan, distFade);
      if (!cameraWeight) return null;
      const ex = eye[0] - ox, ey = eye[1] - oy, ez = eye[2] - oz;
      const eyeRadius = Math.hypot(ex, ez);
      const active = [];
      for (const layer of layers) {
        if (eyeRadius >= layer.radius) continue;
        const gain = !parameters || layer.gain === undefined ? 1 : parameters[layer.gain];
        const tint = !parameters || layer.tint === undefined ? white : parameters[layer.tint];
        if (!Number.isFinite(gain) || gain < 0) throw new TypeError('Missing or invalid horizon gain channel ' + layer.gain);
        if (!Array.isArray(tint) || tint.length !== 3 || Array.from(tint).some(n => !Number.isFinite(n) || n < 0 || n > 1))
          throw new TypeError('Missing or invalid horizon tint channel ' + layer.tint);
        const rim = smooth(Math.min(1, (1 - eyeRadius / layer.radius) * 10));
        const opacity = cameraWeight * rim * Math.min(1, layer.opacity * gain);
        if (opacity) active.push({ ...layer, opacity, tint, inside: (layer.radius + eyeRadius) * (layer.radius - eyeRadius) });
      }
      if (!active.length) return null;

      return function paint(ray, out) {
        const [dx, dy, dz] = ray;
        const horizontal = dx * dx + dz * dz;
        if (horizontal <= 1e-12) return out;
        const projection = ex * dx + ez * dz;
        for (const { bitmap, bottom, span, start, arc, repeat, opacity, tint, inside } of active) {
          const root = Math.sqrt(projection * projection + horizontal * inside);
          const hit = projection > 0 ? inside / (root + projection) : (root - projection) / horizontal;
          const v = (ey + dy * hit - bottom) / span;
          if (v <= 0 || v > 1) continue;
          const angle = mod(Math.atan2(ex + dx * hit, ez + dz * hit) - start, turn);
          if (angle >= arc) continue;
          const u = mod(angle / arc * repeat, 1);
          const x = Math.min(bitmap.width - 1, Math.floor(u * bitmap.width));
          const y = Math.min(bitmap.height - 1, Math.floor((1 - v) * bitmap.height));
          const offset = (y * bitmap.width + x) * 4;
          const alpha = opacity * bitmap.pixels[offset + 3] / 255;
          for (let c = 0; c < 3; c++) out[c] += (bitmap.pixels[offset + c] / 255 * tint[c] - out[c]) * alpha;
        }
        return out;
      };
    }
    return Object.freeze({ [compiled]: true, frame });
  }

  function prepare(authored, override) {
    return compile(override === true || override === undefined ? authored : override);
  }
  return { compile, prepare };
})();
if (typeof module === 'object' && module.exports) module.exports = HorizonBands;
