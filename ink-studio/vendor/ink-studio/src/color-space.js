/* D65 RGB conversions and numeric contracts for authored color operations. */
const ColorSpace = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const triple = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const modes = ['preserve', 'clamp', 'error'];
  const names = ['srgb', 'srgb-linear', 'display-p3', 'display-p3-linear'];
  const working = Object.freeze({ space: 'srgb' });

  // D65 matrices and extended sRGB transfer from the CSS Color 4 conversion reference.
  const srgbToXYZ = [[506752/1228815, 87881/245763, 12673/70218],
    [87098/409605, 175762/245763, 12673/175545], [7918/409605, 87881/737289, 1001167/1053270]];
  const xyzToSrgb = [[12831/3959, -329/214, -1974/3959],
    [-851781/878810, 1648619/878810, 36519/878810], [705/12673, -2585/12673, 705/667]];
  const p3ToXYZ = [[608311/1250200, 189793/714400, 198249/1000160],
    [35783/156275, 247089/357200, 198249/2500400], [0, 32229/714400, 5220557/5000800]];
  const xyzToP3 = [[446124/178915, -333277/357830, -72051/178915],
    [-14852/17905, 63121/35810, 423/17905], [11844/330415, -50337/660830, 316169/330415]];
  const multiply = (a, b) => a.map(row => [0, 1, 2].map(i => row[0]*b[0][i] + row[1]*b[1][i] + row[2]*b[2][i]));
  const toP3 = multiply(xyzToP3, srgbToXYZ), toSrgb = multiply(xyzToSrgb, p3ToXYZ);
  const decode = c => Math.abs(c) <= .04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + .055) / 1.055) ** 2.4;
  const encode = c => Math.abs(c) <= .0031308 ? 12.92 * c : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - .055);

  function toOKLab(input) {
    const [r,g,b] = input.map(decode),
      l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
      m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }

  function rgb([L,A,B], chroma = 1) {
    const a = A * chroma, b = B * chroma,
      l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
      m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
      s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  const inside = input => input.every(v => v >= -1e-8 && v <= 1 + 1e-8);
  function fromOKLab(p) {
    let result = rgb(p);
    if (!inside(result)) {
      let low = 0, high = 1;
      result = rgb(p, low);
      for (let i = 0; i < 19; i++) {
        const middle = (low + high) * 0.5, candidate = rgb(p,middle);
        if (inside(candidate)) {
          low = middle;
          result = candidate;
        } else high = middle;
      }
    }
    return result.map(v => Math.max(0, Math.min(1, encode(v))));
  }

  function descriptor(input = working) {
    const value = typeof input === 'string' ? { space: input } : input;
    if (!record(value) || Object.keys(value).some(key => !['space', 'range', 'outOfRange'].includes(key)))
      throw new TypeError('Expected a color space, range and outOfRange descriptor');
    const { space = 'srgb', range = [0, 1], outOfRange = 'preserve' } = value;
    if (!names.includes(space)) throw new RangeError('Unknown color space: ' + space);
    if (!modes.includes(outOfRange)) throw new RangeError('Color range policy needs preserve, clamp or error');
    let min, max;
    if (Array.isArray(range) && range.length === 2 && Array.from(range).every(Number.isFinite)) {
      min = [range[0], range[0], range[0]];
      max = [range[1], range[1], range[1]];
    } else if (record(range) && Object.keys(range).every(key => key === 'min' || key === 'max') &&
      triple(range.min) && triple(range.max)) {
      min = range.min.slice();
      max = range.max.slice();
    }
    if (!min || max.some((n, i) => n <= min[i] || !Number.isFinite(n - min[i])))
      throw new RangeError('Color ranges need finite, increasing bounds for each channel');
    return Object.freeze({ space, outOfRange,
      range: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }) });
  }

  function settings(value) {
    if (value === undefined) return undefined;
    if (!record(value) || Object.keys(value).some(key => key !== 'input' && key !== 'output'))
      throw new TypeError('A color transform contract needs input and output descriptors');
    return Object.freeze({ input: descriptor(value.input), output: descriptor(value.output) });
  }

  function bounded(value, min, max, policy) {
    if (!Number.isFinite(value)) throw new RangeError('Color conversion needs finite RGB components');
    if (policy === 'preserve' || (value >= min && value <= max)) return value;
    const tolerance = 16 * Number.EPSILON * Math.max(Math.abs(min), Math.abs(max));
    if (policy === 'error' && (value < min - tolerance || value > max + tolerance))
      throw new RangeError('RGB component ' + value + ' is outside [' + min + ', ' + max + ']');
    return Math.max(min, Math.min(max, value));
  }

  const bounds = channel => channel.range.max.map((max, i) => max - channel.range.min[i]);

  function prepare(from, to) {
    const a = descriptor(from), b = descriptor(to), inputSpan = bounds(a), outputSpan = bounds(b);
    const sourceP3 = a.space.startsWith('display-p3'), targetP3 = b.space.startsWith('display-p3');
    const changeSpace = a.space !== b.space;
    const matrix = sourceP3 === targetP3 ? null : targetP3 ? toP3 : toSrgb;
    const linearize = changeSpace && !a.space.endsWith('-linear'), compress = changeSpace && !b.space.endsWith('-linear');
    const sameRange = a.range.min.every((min, i) => min === b.range.min[i] && a.range.max[i] === b.range.max[i]);
    const rgb = [0, 0, 0];
    return (input, out = [0, 0, 0]) => {
      if (!changeSpace && sameRange) {
        for (let i = 0; i < 3; i++) {
          const lo = a.range.min[i], hi = a.range.max[i];
          out[i] = bounded(bounded(input[i], lo, hi, a.outOfRange), lo, hi, b.outOfRange);
        }
        return out;
      }
      for (let i = 0; i < 3; i++) {
        const n = bounded(input[i], a.range.min[i], a.range.max[i], a.outOfRange);
        const value = (n - a.range.min[i]) / inputSpan[i];
        rgb[i] = linearize ? decode(value) : value;
      }
      for (let i = 0; i < 3; i++) {
        const row = matrix?.[i];
        const value = row ? row[0]*rgb[0] + row[1]*rgb[1] + row[2]*rgb[2] : rgb[i];
        const encoded = b.range.min[i] + outputSpan[i] * (compress ? encode(value) : value);
        out[i] = bounded(encoded, b.range.min[i], b.range.max[i], b.outOfRange);
      }
      return out;
    };
  }

  function wrap(transfer, contract, { normalized = false } = {}) {
    const color = settings(contract);
    if (!color) return transfer;
    const enter = prepare(working, color.input), leave = prepare(color.output, working);
    const inputSpan = bounds(color.input), outputSpan = bounds(color.output);
    const input = [0, 0, 0], result = [0, 0, 0];
    return (rgb, out = [0, 0, 0], argument) => {
      enter(rgb, input);
      if (normalized) for (let i = 0; i < 3; i++) input[i] = (input[i] - color.input.range.min[i]) / inputSpan[i];
      transfer(input, result, argument);
      if (normalized) for (let i = 0; i < 3; i++) result[i] = result[i] * outputSpan[i] + color.output.range.min[i];
      return leave(result, out);
    };
  }

  return Object.freeze({ descriptor, settings, prepare, wrap, toOKLab, fromOKLab, convert: (rgb, from, to, out) => prepare(from, to)(rgb, out) });
})();
if (typeof module !== 'undefined') module.exports = ColorSpace;
