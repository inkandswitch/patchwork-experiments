/* 3D RGB lookup tables in red-fastest .cube order. */
const ColorLUT = (() => {
  let spaces;
  try { spaces = ColorSpace; } catch { spaces = require('./color-space.js'); }
  const format = 'ink-studio/lut', version = 1;
  const canonical = new WeakMap(), compiled = new WeakMap();
  const keys = ['format', 'version', 'size', 'title', 'domainMin', 'domainMax', 'domainPolicy', 'interpolation', 'color', 'data'];
  const triples = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
  const sizeOK = n => Number.isSafeInteger(n) && n >= 2 && n <= 256;
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  const immutable = value => !value || typeof value !== 'object' ||
    Object.isFrozen(value) && Object.values(value).every(immutable);

  function normalize(definition, owned = false) {
    if (canonical.has(definition)) return canonical.get(definition);
    if (!definition || Object.getPrototypeOf(definition) !== Object.prototype ||
        Object.keys(definition).some(key => !keys.includes(key)))
      throw new TypeError('Expected an Ink Studio 3D LUT object');
    const { size, title, domainMin = [0, 0, 0], domainMax = [1, 1, 1],
      domainPolicy, interpolation = 'tetrahedral', data } = definition;
    if ((definition.format !== undefined && definition.format !== format) ||
        (definition.version !== undefined && definition.version !== version))
      throw new TypeError('Unsupported Ink Studio LUT format or version');
    if (!sizeOK(size)) throw new RangeError('3D LUT size must be an integer from 2 to 256');
    if (title !== undefined && typeof title !== 'string') throw new TypeError('A LUT title must be text');
    if (!['tetrahedral', 'trilinear'].includes(interpolation))
      throw new RangeError('LUT interpolation must be tetrahedral or trilinear');
    if (domainPolicy !== undefined && !['clamp', 'error', 'extrapolate'].includes(domainPolicy))
      throw new RangeError('LUT domain policy needs clamp, error or extrapolate');
    const color = spaces.settings(definition.color);
    if (!triples(domainMin) || !triples(domainMax) ||
        domainMax.some((hi, i) => hi <= domainMin[i] || !Number.isFinite(hi - domainMin[i])))
      throw new RangeError('LUT domains need three finite, increasing input ranges');
    if (!(Array.isArray(data) || ArrayBuffer.isView(data)) || data.length !== size ** 3 * 3)
      throw new RangeError('A 3D LUT needs exactly ' + size ** 3 + ' RGB rows');
    for (const value of data) if (!Number.isFinite(value)) throw new TypeError('LUT table entries must be finite numbers');
    const immutableData = Array.isArray(data) && Object.isFrozen(data);
    const saved = Object.freeze({ format, version, size, ...(title !== undefined && { title }), interpolation,
      domainMin: Object.freeze(domainMin.slice()), domainMax: Object.freeze(domainMax.slice()),
      ...(domainPolicy !== undefined && { domainPolicy }), ...(color && { color }),
      data: Object.freeze(owned || immutableData ? data : Array.from(data)) });
    canonical.set(saved, saved);
    if (immutableData && Object.isFrozen(definition) && immutable(definition.color) &&
        (definition.domainMin === undefined || Object.isFrozen(domainMin)) &&
        (definition.domainMax === undefined || Object.isFrozen(domainMax)))
      canonical.set(definition, saved);
    return saved;
  }

  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  function parseCube(text, { color, domainPolicy } = {}) {
    if (typeof text !== 'string') throw new TypeError('Expected .cube text');
    const seen = new Set(), data = [], definition = { data, color, domainPolicy };
    const lines = /([^\r\n]*)(?:\r\n|\r|\n|$)/g;
    let row, lineNo = 0;
    function fail(message) { throw new Error('.cube line ' + lineNo + ' — ' + message); }
    function numbers(input, count) {
      if (input.length !== count || input.some(value => !decimal.test(value) || !Number.isFinite(Number(value))))
        fail('Expected ' + count + ' finite decimal values');
      return input.map(Number);
    }
    while ((row = lines.exec(text))?.[0]) {
      lineNo++;
      const authored = row[1].trim(), line = authored.split('#', 1)[0].trim();
      if (!line) continue;
      const [key, ...args] = line.split(/\s+/);
      if (decimal.test(key)) {
        if (!definition.size) fail('Declare LUT_3D_SIZE before RGB rows');
        if (data.length >= definition.size ** 3 * 3) fail('Too many RGB rows for LUT_3D_SIZE');
        data.push(...numbers([key, ...args], 3));
        continue;
      }
      if (data.length || seen.has(key)) fail('Repeated or misplaced header ' + key);
      seen.add(key);
      switch (key) {
        case 'TITLE': {
          const title = /^TITLE\s+"([^"]*)"\s*(?:#.*)?$/.exec(authored);
          if (!title) fail('TITLE needs a quoted string');
          definition.title = title[1];
          break;
        }
        case 'LUT_3D_SIZE': {
          const [n] = numbers(args, 1);
          if (!/^\d+$/.test(args[0]) || !sizeOK(n)) fail('3D LUT size must be an integer from 2 to 256');
          definition.size = n;
          break;
        }
        case 'DOMAIN_MIN':
        case 'DOMAIN_MAX':
          if (seen.has('LUT_3D_INPUT_RANGE')) fail('Use either DOMAIN_MIN/MAX or LUT_3D_INPUT_RANGE');
          definition[key === 'DOMAIN_MIN' ? 'domainMin' : 'domainMax'] = numbers(args, 3);
          break;
        case 'LUT_3D_INPUT_RANGE': {
          if (definition.domainMin || definition.domainMax) fail('Use either DOMAIN_MIN/MAX or LUT_3D_INPUT_RANGE');
          const [lo, hi] = numbers(args, 2);
          definition.domainMin = [lo, lo, lo];
          definition.domainMax = [hi, hi, hi];
          break;
        }
        case 'LUT_1D_SIZE':
        case 'LUT_1D_INPUT_RANGE':
          fail('Import a standalone 3D LUT. This file includes a 1D table');
          break;
        default: fail('Unknown header or RGB row ' + key);
      }
    }
    if (!definition.size) throw new Error('.cube is missing LUT_3D_SIZE');
    return normalize(definition, true);
  }

  function prepare(input) {
    const definition = normalize(input);
    if (compiled.has(definition)) return compiled.get(definition);
    const { size, domainMin, domainMax, domainPolicy = 'clamp', data, interpolation } = definition;
    const sr = 3, sg = size * sr, sb = size * sg, corner = sr + sg + sb;
    const extent = size - 1, span = domainMax.map((hi, i) => hi - domainMin[i]);
    const cell = value => Math.max(0, Math.min(extent - 1, Math.floor(value)));
    function axis(value, i) {
      if (!Number.isFinite(value)) throw new RangeError('LUT input must have three finite RGB components');
      const lo = domainMin[i], hi = domainMax[i];
      if (domainPolicy !== 'extrapolate') {
        const tolerance = 16 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi));
        if (domainPolicy === 'error' && (value < lo - tolerance || value > hi + tolerance))
          throw new RangeError('RGB component is outside the LUT domain on channel ' + i);
        if (value <= lo) return 0;
        if (value >= hi) return extent;
      }
      const cell = (value - lo) / span[i] * extent;
      if (!Number.isFinite(cell)) throw new RangeError('LUT input overflows its numeric domain on channel ' + i);
      return cell;
    }

    function sample(rgb, out = [0, 0, 0]) {
      const x = axis(rgb?.[0], 0), y = axis(rgb?.[1], 1), z = axis(rgb?.[2], 2);
      const r = cell(x), g = cell(y), b = cell(z);
      const start = r * sr + g * sg + b * sb;
      let fx = x - r, fy = y - g, fz = z - b;
      if (interpolation === 'trilinear') {
        for (let channel = 0; channel < 3; channel++) {
          const at = start + channel;
          const lo = lerp(lerp(data[at], data[at + sr], fx), lerp(data[at + sg], data[at + sr + sg], fx), fy);
          const hi = lerp(lerp(data[at + sb], data[at + sb + sr], fx), lerp(data[at + sb + sg], data[at + corner], fx), fy);
          out[channel] = lerp(lo, hi, fz);
        }
      } else {
        // Sort the fractional coordinates and their strides to pick one tetrahedron.
        let first = sr, second = sg;
        if (fx < fy) { [fx, fy] = [fy, fx]; [first, second] = [second, first]; }
        if (fy < fz) { [fy, fz] = [fz, fy]; second = sb; }
        if (fx < fy) { [fx, fy] = [fy, fx]; [first, second] = [second, first]; }
        for (let channel = 0; channel < 3; channel++) {
          const at = start + channel;
          out[channel] = (1 - fx) * data[at] + (fx - fy) * data[at + first] +
            (fy - fz) * data[at + first + second] + fz * data[at + corner];
        }
      }
      return out;
    }

    const plan = Object.freeze({ definition, sample, apply: spaces.wrap(sample, definition.color) });
    compiled.set(definition, plan);
    return plan;
  }

  return Object.freeze({ normalize: definition => normalize(definition), parseCube, prepare });
})();
if (typeof module !== 'undefined') module.exports = ColorLUT;
