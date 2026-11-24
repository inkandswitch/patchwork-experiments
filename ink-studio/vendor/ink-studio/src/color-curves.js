/* Numeric transfer curves and RGB ramps shared by scene and surface looks. */
const ColorCurves = (() => {
  let spaces;
  try { spaces = ColorSpace; } catch { spaces = require('./color-space.js'); }
  const modes = ['step', 'linear', 'smooth'];
  const channels = ['red', 'green', 'blue'];
  const unit = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const clamp = n => Math.max(0, Math.min(1, n));
  const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const luminance = rgb => .30 * rgb[0] + .55 * rgb[1] + .15 * rgb[2];
  const mix = (a, b, t) => a * (1 - t) + b * t;

  function segmentIndex(stops, value) {
    let low = 0, high = stops.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (stops[mid].at < value) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function weight(mode, t) {
    return mode === 'step' ? 0 : mode === 'smooth' ? t * t * (3 - 2 * t) : t;
  }

  function sampler(definition, convert, blend, normalized = false) {
    if (!object(definition) || Object.keys(definition).some(key => !['stops', 'interpolation'].includes(key)))
      throw new TypeError('A color ramp or curve needs stops and optional interpolation');
    const { stops, interpolation = 'linear' } = definition;
    if (!modes.includes(interpolation) || !Array.isArray(stops) || stops.length < 2 || stops.length > 256)
      throw new RangeError('Use 2–256 stops and step, linear or smooth interpolation');
    const points = Array.from(stops, (row, i) => {
      if (!Array.isArray(row) || row.length !== 2 || !Number.isFinite(row[0]) ||
          (normalized && !unit(row[0])) ||
          (i && (!(row[0] > stops[i - 1][0]) || !Number.isFinite(row[0] - stops[i - 1][0]))))
        throw new RangeError('Curve stop coordinates must be finite and strictly increasing');
      return { at: row[0], value: convert(row[1]) };
    });
    return (value, out) => {
      if (!Number.isFinite(value)) throw new RangeError('Curve input must be finite');
      const high = segmentIndex(points, value), b = points[high];
      if (!high || value >= b.at) return blend(b.value, b.value, 0, out);
      const a = points[high - 1];
      return blend(a.value, b.value, weight(interpolation, (value - a.at) / (b.at - a.at)), out);
    };
  }

  function scalar(definition, normalized = false) {
    return sampler(definition, value => {
      if (!(normalized ? unit(value) : Number.isFinite(value)))
        throw new RangeError(normalized ? 'RGB curve outputs must be in [0, 1]' : 'Curve outputs must be finite');
      return value;
    }, mix, normalized);
  }

  function color(input) {
    if (Array.isArray(input) && input.length === 3 && Array.from(input).every(unit)) return input.slice();
    const packed = typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? parseInt(input.slice(1), 16) : input;
    if (!Number.isSafeInteger(packed) || packed < 0 || packed > 0xffffff)
      throw new TypeError('Ramp colors need #rrggbb, packed RGB or a normalized RGB triple');
    return [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
  }

  function ramp(definition, resolveColor = color, extended = false) {
    return sampler(definition, value => {
      const rgb = value === undefined ? null : resolveColor(value);
      if (!rgb || rgb.length !== 3 || !Array.from(rgb).every(extended ? Number.isFinite : unit))
        throw new RangeError(extended ? 'Ramp stops need finite RGB colors' : 'Ramp stops need finite RGB colors in [0, 1]');
      return Array.from(rgb);
    }, (a, b, t, out = [0, 0, 0]) => {
      for (let i = 0; i < 3; i++) out[i] = mix(a[i], b[i], t);
      return out;
    });
  }

  function prepare(definition, resolveColor = color, override) {
    if (definition === undefined || definition === false) return null;
    if (!object(definition) || Object.keys(definition).some(key => !['ramp', 'channels', 'color'].includes(key)))
      throw new TypeError('A color transfer needs a ramp or RGB channel curves');
    const contract = spaces.settings(override === undefined ? definition.color : override);
    const declaredOutput = contract && { ...contract.output, outOfRange: 'preserve' };
    const encodeStop = contract && spaces.prepare(undefined, declaredOutput);
    const passthrough = contract && spaces.prepare(contract.input, declaredOutput);
    const resolveStop = contract ? value => Array.isArray(value) ? value : encodeStop(resolveColor(value)) : resolveColor;
    const tone = definition.ramp === undefined ? null : ramp(definition.ramp, resolveStop, Boolean(contract));
    const settings = definition.channels ?? {};
    if (!object(settings) || Object.keys(settings).some(key => !channels.includes(key)))
      throw new TypeError('Use red, green or blue RGB curves');
    const rgb = channels.map(name => Object.hasOwn(settings, name) ? scalar(settings[name], !contract) : null);
    if (!tone && !rgb.some(Boolean)) throw new TypeError('A color transfer needs a ramp or RGB channel curves');
    const transfer = (input, out = [0, 0, 0], value = luminance(input)) => {
      if (tone) tone(value, out);
      else if (passthrough) passthrough(input, out);
      else for (let i = 0; i < 3; i++) out[i] = clamp(input[i]);
      for (let i = 0; i < 3; i++) if (rgb[i]) out[i] = rgb[i](contract && !tone ? input[i] : out[i]);
      return out;
    };
    return spaces.wrap(transfer, contract);
  }

  return Object.freeze({ color, scalar, ramp, prepare, luminance, segmentIndex, weight, modes: Object.freeze(modes) });
})();
if (typeof module !== 'undefined') module.exports = ColorCurves;
