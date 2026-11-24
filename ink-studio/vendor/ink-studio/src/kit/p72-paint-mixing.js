/* Spectral opaque-paint mixing. Math and data are computed locally; no imported mixer. */
(function (K) {
  const C = K.procedural.materials.perceptual,
    freeze = K.procedural.data.freeze,
    clone = K.procedural.data.clone;
  const check = (v, m) => {
    if (!v) throw new TypeError('Paint: ' + m);
  };
  const record = v =>
    v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const arrayLike = v => Array.isArray(v) || (ArrayBuffer.isView(v) && typeof v.length === 'number');
  const fields = (v, keys) => record(v) && Object.keys(v).every(k => keys.includes(k));
  const finite = Number.isFinite,
    clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const id = v =>
    typeof v === 'string' && v.length > 0 && v.length <= 128 && !['__proto__', 'prototype', 'constructor'].includes(v);
  const bands = freeze(Array.from({ length: 36 }, (_, i) => 380 + i * 10)),
    N = bands.length,
    EPS = 1e-6;
  const linear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const encoded = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
  const gaussian = (l, center, left, right) => Math.exp(-0.5 * ((l - center) * (l < center ? left : right)) ** 2);
  // Wyman, Sloan & Shirley (2013), Eq. 4. White-balanced Planck 6504 K reference.
  const observer = bands.map(l => [
    0.362 * gaussian(l, 442, 0.0624, 0.0374) +
      1.056 * gaussian(l, 599.8, 0.0264, 0.0323) -
      0.065 * gaussian(l, 501.1, 0.049, 0.0382),
    0.821 * gaussian(l, 568.8, 0.0213, 0.0247) + 0.286 * gaussian(l, 530.9, 0.0613, 0.0322),
    1.217 * gaussian(l, 437, 0.0845, 0.0278) + 0.681 * gaussian(l, 459, 0.0385, 0.0725)
  ]);
  const light = bands.map(l => 1 / (l ** 5 * Math.expm1(1.438776877e7 / (l * 6504)))),
    white = [0.95047, 1, 1.08883],
    totals = [0, 0, 0];
  observer.forEach((p, i) => p.forEach((v, k) => (totals[k] += v * light[i])));
  const xyzToRgb = [
    [3.2404542, -1.5371385, -0.4985314],
    [-0.969266, 1.8760108, 0.041556],
    [0.0556434, -0.2040259, 1.0572252]
  ];
  const response = observer.map((p, i) =>
    xyzToRgb.map(row => row.reduce((sum, v, k) => sum + (v * p[k] * light[i] * white[k]) / totals[k], 0))
  );
  const project = R => [0, 1, 2].map(k => R.reduce((sum, v, i) => sum + v * response[i][k], 0));
  function display(R) {
    const raw = project(R).map(encoded),
      rgb = C.gamut(C.lab(raw));
    return { rgb, hex: C.toHex(rgb), gamutMapped: raw.some((v, i) => Math.abs(v - rgb[i]) > 1e-5) };
  }
  const ratio = R => ((1 - R) * (1 - R)) / (2 * R);
  function reflect(k, s) {
    if (s === 0) return 0;
    const q = k / s;
    // Rationalized inverse avoids cancellation at high absorption.
    return 1 / (1 + q + Math.sqrt(q) * Math.sqrt(q + 2));
  }
  const fits = new Map(),
    paints = new WeakSet(),
    gradients = new WeakSet();
  function fit(rgb) {
    const key = rgb.join(',');
    if (fits.has(key)) return fits.get(key);
    const target = rgb.map(linear),
      R = new Float64Array(N).fill(target.reduce((s, v) => s + v, 0) / 3),
      next = new Float64Array(N);
    for (let t = 0; t < 1400; t++) {
      const got = project(R),
        delta = got.map((v, i) => v - target[i]);
      for (let i = 0; i < N; i++)
        next[i] = clamp(
          R[i] -
            2 *
              (response[i].reduce((s, v, k) => s + v * delta[k], 0) +
                0.00012 * (2 * R[i] - R[Math.max(0, i - 1)] - R[Math.min(N - 1, i + 1)])),
          EPS,
          1 - EPS
        );
      R.set(next);
    }
    const result = Array.from(R);
    if (fits.size >= 256) fits.delete(fits.keys().next().value);
    fits.set(key, result);
    return result;
  }
  function values(value, wavelengths, label, limit = Infinity) {
    const source = typeof value === 'number' ? Array(wavelengths?.length ?? N).fill(value) : value;
    check(
      arrayLike(source) &&
        source.length === (wavelengths?.length ?? N) &&
        Array.from(source).every(v => finite(v) && v >= 0 && v <= limit),
      'invalid ' + label + ' spectrum'
    );
    if (!wavelengths) return Array.from(source);
    let at = 0;
    return bands.map(l => {
      while (at + 1 < wavelengths.length && wavelengths[at + 1] < l) at++;
      const a = wavelengths[at],
        b = wavelengths[Math.min(at + 1, wavelengths.length - 1)];
      return a === b ? source[at] : source[at] + ((source[at + 1] - source[at]) * (l - a)) / (b - a);
    });
  }
  function result(absorption, scattering, { name = 'Mixture', source = 'spectral', requestedRGB } = {}) {
    check(
      absorption.every(
        (v, i) => finite(v) && v >= 0 && finite(scattering[i]) && scattering[i] >= 0 && v + scattering[i] > 0
      ),
      'mixture coefficients must be finite and have positive extinction'
    );
    const R = absorption.map((k, i) => reflect(k, scattering[i])),
      color = display(R);
    const diagnostics = {
      source,
      observer: 'analytic-cie1931/white-balanced-6504K',
      gamutMapped: color.gamutMapped,
      ...(requestedRGB && {
        requestedRGB: requestedRGB.slice(),
        maxRGBError: Math.max(...color.rgb.map((v, i) => Math.abs(v - requestedRGB[i])))
      })
    };
    const api = freeze({
      name,
      rgb: color.rgb,
      hex: color.hex,
      reflectance: R,
      absorption: absorption.slice(),
      scattering: scattering.slice(),
      diagnostics,
      snapshot: () => ({ name, absorption: absorption.slice(), scattering: scattering.slice() })
    });
    paints.add(api);
    return api;
  }
  const definitions = freeze({
    white: { name: 'Titanium-style white', reflectance: 0.96, scattering: 4 },
    black: { name: 'Carbon-style black', reflectance: 0.004, scattering: 0.08 },
    blue: { name: 'Blue', color: '#2d55a6' },
    yellow: { name: 'Lemon yellow', color: '#f2d02e' },
    red: { name: 'Warm red', color: '#ce4935' },
    magenta: { name: 'Magenta', color: '#ae3c86' },
    cyan: { name: 'Cyan', color: '#218d9e' },
    green: { name: 'Green', color: '#34845a' },
    ochre: { name: 'Ochre', color: '#bc8b3f' }
  });
  function swatch(input) {
    if (paints.has(input)) return input;
    if (typeof input === 'string' || typeof input === 'number' || arrayLike(input))
      input = { color: ArrayBuffer.isView(input) ? Array.from(input) : input };
    check(
      fields(input, ['name', 'preset', 'color', 'reflectance', 'absorption', 'scattering', 'wavelengths', 'strength']),
      'invalid swatch definition'
    );
    if (input.preset !== undefined) {
      check(id(input.preset) && Object.hasOwn(definitions, input.preset), 'unknown preset');
      const { preset, ...rest } = input;
      input = { ...definitions[preset], ...rest };
    }
    const { name = 'Paint', strength = 1, wavelengths } = input;
    check(id(name) && finite(strength) && strength > 0 && strength <= 1e6, 'invalid paint name or strength');
    if (wavelengths)
      check(
        arrayLike(wavelengths) &&
          wavelengths.length >= 2 &&
          wavelengths.length <= 512 &&
          Array.from(wavelengths).every((v, i) => finite(v) && (!i || v > wavelengths[i - 1])) &&
          wavelengths[0] <= bands[0] &&
          wavelengths.at(-1) >= bands.at(-1),
        'wavelengths must increase and cover 380–730 nm'
      );
    const sources = ['color', 'reflectance', 'absorption'].filter(k => Object.hasOwn(input, k));
    check(sources.length === 1, 'a swatch needs exactly one color, reflectance or absorption source');
    const S = values(input.scattering ?? 1, wavelengths, 'scattering').map(v => v * strength);
    let A, requestedRGB, source;
    if (sources[0] === 'absorption') {
      A = values(input.absorption, wavelengths, 'absorption').map(v => v * strength);
      source = 'spectral-coefficients';
    } else {
      let R;
      if (sources[0] === 'color') {
        check(!wavelengths, 'RGB estimates use the native wavelength grid');
        requestedRGB = C.parse(ArrayBuffer.isView(input.color) ? Array.from(input.color) : input.color);
        check(
          Array.from(requestedRGB).every(v => finite(v) && v >= 0 && v <= 1),
          'invalid RGB color'
        );
        R = fit(requestedRGB);
        source = 'estimated-rgb';
      } else {
        R = values(input.reflectance, wavelengths, 'reflectance', 1);
        source = 'spectral-reflectance';
      }
      A = R.map((v, i) => ratio(Math.max(EPS, v)) * S[i]);
    }
    check(
      A.every((v, i) => finite(v) && finite(S[i]) && v + S[i] > 0),
      'each wavelength needs positive finite absorption or scattering'
    );
    return result(A, S, { name, source, requestedRGB });
  }
  const preset = (name, options = {}) => {
    check(fields(options, ['name', 'strength', 'scattering']), 'invalid preset options');
    return swatch({ preset: name, ...options });
  };
  function normalized(weights) {
    check(
      arrayLike(weights) && weights.length >= 1 && weights.length <= 64 && weights.every(v => finite(v) && v >= 0),
      'weights must be finite and nonnegative'
    );
    const max = Math.max(...weights);
    check(max > 0, 'a mixture needs positive total weight');
    const scaled = Array.from(weights, v => v / max),
      sum = scaled.reduce((s, v) => s + v, 0);
    return scaled.map(v => v / sum);
  }
  function mix(entries, options = {}) {
    check(
      Array.isArray(entries) && entries.length >= 1 && entries.length <= 64 && fields(options, ['name']),
      'mix needs 1–64 paints'
    );
    const components = entries.map(v =>
      fields(v, ['paint', 'weight']) && Object.hasOwn(v, 'paint')
        ? { paint: swatch(v.paint), weight: v.weight ?? 1 }
        : { paint: swatch(v), weight: 1 }
    );
    const weights = normalized(components.map(v => v.weight)),
      A = Array(N).fill(0),
      S = Array(N).fill(0);
    components.forEach(({ paint }, i) => {
      for (let j = 0; j < N; j++) {
        A[j] += paint.absorption[j] * weights[i];
        S[j] += paint.scattering[j] * weights[i];
      }
    });
    check(options.name === undefined || id(options.name), 'invalid mixture name');
    return result(A, S, { name: options.name ?? 'Mixture', source: 'mixture' });
  }
  function amount(v) {
    check(finite(v) && v >= 0 && v <= 1, 'tint/shade amount must be 0–1');
    return v;
  }
  const tint = (paint, t, white = preset('white')) =>
    mix([
      { paint, weight: 1 - amount(t) },
      { paint: white, weight: t }
    ]);
  const shade = (paint, t, black = preset('black')) =>
    mix([
      { paint, weight: 1 - amount(t) },
      { paint: black, weight: t }
    ]);
  function book(input) {
    check(
      record(input) &&
        Object.keys(input).length >= 1 &&
        Object.keys(input).length <= 256 &&
        Object.keys(input).every(id),
      'book needs 1–256 named swatches'
    );
    const ready = new Map(),
      pending = new Set();
    const resolve = v => (typeof v === 'string' && Object.hasOwn(input, v) ? get(v) : swatch(v));
    function get(name) {
      check(id(name) && Object.hasOwn(input, name), 'unknown book swatch: ' + name);
      if (ready.has(name)) return ready.get(name);
      check(!pending.has(name), 'cyclic swatch recipe: ' + name);
      pending.add(name);
      const def = input[name];
      let paint;
      if (fields(def, ['mix']) && Array.isArray(def.mix)) {
        check(def.mix.length >= 1 && def.mix.length <= 64, 'invalid named mixture');
        paint = mix(
          def.mix.map(v => {
            check(fields(v, ['paint', 'weight']) && Object.hasOwn(v, 'paint'), 'invalid recipe component');
            return { paint: resolve(v.paint), weight: v.weight ?? 1 };
          }),
          { name }
        );
      } else paint = resolve(def);
      pending.delete(name);
      ready.set(name, paint);
      return paint;
    }
    Object.keys(input).forEach(get);
    return freeze({
      names: Object.keys(input),
      get,
      mix: entries =>
        mix(
          entries.map(v =>
            fields(v, ['paint', 'weight']) && Object.hasOwn(v, 'paint')
              ? { paint: resolve(v.paint), weight: v.weight ?? 1 }
              : resolve(v)
          )
        ),
      snapshot: () => Object.fromEntries([...ready].map(([n, p]) => [n, p.snapshot()]))
    });
  }
  function gradient(definition) {
    if (gradients.has(definition)) return definition;
    check(fields(definition, ['stops', 'interpolation', 'steps']), 'invalid paint gradient');
    const { stops, interpolation = 'linear', steps = 17 } = definition;
    check(
      Array.isArray(stops) &&
        stops.length >= 2 &&
        stops.length <= 64 &&
        ColorCurves.modes.includes(interpolation) &&
        Number.isSafeInteger(steps) &&
        steps >= 2 &&
        steps <= 4096,
      'invalid gradient settings'
    );
    const points = stops.map((v, i) => {
      check(
        fields(v, ['at', 'paint']) && finite(v.at) && v.at >= 0 && v.at <= 1 && (!i || v.at > stops[i - 1].at),
        'gradient stops must strictly increase'
      );
      return { at: v.at, paint: swatch(v.paint) };
    });
    check(points[0].at === 0 && points.at(-1).at === 1, 'gradient must cover 0–1');
    const sample = t => {
      check(finite(t), 'gradient coordinate must be finite');
      t = clamp(t);
      const high = ColorCurves.segmentIndex(points, t),
        b = points[high];
      if (!high || t === b.at) return b.paint;
      const a = points[high - 1],
        w = ColorCurves.weight(interpolation, (t - a.at) / (b.at - a.at));
      return w === 0
        ? a.paint
        : w === 1
          ? b.paint
          : mix([
              { paint: a.paint, weight: 1 - w },
              { paint: b.paint, weight: w }
            ]);
    };
    const previews = Array.from({ length: steps }, (_, i) => sample(i / (steps - 1)));
    const api = freeze({
      rgb: previews.map(p => p.rgb),
      hex: previews.map(p => p.hex),
      sample,
      snapshot: () => ({ steps, interpolation, stops: points.map(p => ({ at: p.at, paint: p.paint.snapshot() })) })
    });
    gradients.add(api);
    return api;
  }
  function rampAPI(rgb) {
    const steps = rgb.length;
    return freeze({
      rgb,
      hex: rgb.map(C.toHex),
      sample(t, out = [0, 0, 0]) {
        check(finite(t), 'ramp coordinate must be finite');
        check(out && out.length >= 3, 'output needs three components');
        const x = clamp(t) * (steps - 1),
          a = Math.floor(x),
          b = Math.min(steps - 1, a + 1);
        for (let k = 0; k < 3; k++) out[k] = rgb[a][k] + (rgb[b][k] - rgb[a][k]) * (x - a);
        return out;
      },
      snapshot: () => ({ format: 'ink-studio/paint-ramp', version: 1, rgb: rgb.map(v => v.slice()) })
    });
  }
  function bakeRamp(input, options = {}) {
    check(fields(options, ['steps']), 'invalid ramp settings');
    const { steps = 256 } = options;
    check(Number.isSafeInteger(steps) && steps >= 2 && steps <= 4096, 'ramp size must be 2–4096');
    const source = gradient(input);
    return rampAPI(Array.from({ length: steps }, (_, i) => source.sample(i / (steps - 1)).rgb.slice()));
  }
  function restoreRamp(definition) {
    check(
      fields(definition, ['format', 'version', 'rgb']) &&
        definition.format === 'ink-studio/paint-ramp' &&
        definition.version === 1,
      'invalid paint ramp format'
    );
    const { rgb } = definition;
    check(
      Array.isArray(rgb) &&
        rgb.length >= 2 &&
        rgb.length <= 4096 &&
        Array.from(rgb).every(
          c => Array.isArray(c) && c.length === 3 && Array.from(c).every(v => finite(v) && v >= 0 && v <= 1)
        ),
      'invalid paint ramp data'
    );
    return rampAPI(rgb.map(c => c.slice()));
  }
  // Conditional concentrations map the mixture simplex onto a cube without contaminating zero-paint edges.
  function coordinates(weights) {
    const w = normalized(weights),
      out = [];
    let remaining = 1;
    for (let i = 0; i < w.length - 1; i++) {
      out.push(remaining > 1e-12 ? clamp(w[i] / remaining) : 0);
      remaining = Math.max(0, remaining - w[i]);
    }
    return out;
  }
  function tableWeights(coords) {
    let rest = 1;
    const out = coords.map(v => {
      const w = rest * v;
      rest *= 1 - v;
      return w;
    });
    out.push(rest);
    return out;
  }
  function tableAPI(size, dimensions, data, names) {
    const at = (coords, out = [0, 0, 0]) => {
      check(out && out.length >= 3, 'output needs three components');
      const p = coords.map(v => clamp(v) * (size - 1)),
        a = p.map(Math.floor),
        f = p.map((v, i) => v - a[i]);
      out.fill(0);
      for (let corner = 0; corner < 1 << dimensions; corner++) {
        let index = 0,
          stride = 1,
          w = 1;
        for (let k = 0; k < dimensions; k++) {
          const up = (corner >> k) & 1;
          index += Math.min(size - 1, a[k] + up) * stride;
          stride *= size;
          w *= up ? f[k] : 1 - f[k];
        }
        for (let c = 0; c < 3; c++) out[c] += data[index * 3 + c] * w;
      }
      return out;
    };
    return freeze({
      size,
      dimensions,
      data,
      names,
      coordinates(weights) {
        check(arrayLike(weights) && weights.length === dimensions + 1, 'wrong paint count');
        return coordinates(weights);
      },
      sample(weights, out) {
        check(arrayLike(weights) && weights.length === dimensions + 1, 'wrong paint count');
        return at(coordinates(weights), out);
      },
      rgba() {
        const rgba = new Uint8Array((data.length / 3) * 4);
        for (let p = 0; p < data.length / 3; p++) {
          for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round(data[p * 3 + c] * 255);
          rgba[p * 4 + 3] = 255;
        }
        return { width: size, height: dimensions > 1 ? size : 1, depth: dimensions > 2 ? size : 1, data: rgba };
      },
      asLUT() {
        const cube = [];
        for (let b = 0; b < size; b++)
          for (let g = 0; g < size; g++)
            for (let r = 0; r < size; r++) cube.push(...at([r, g, b].slice(0, dimensions).map(v => v / (size - 1))));
        return {
          format: 'ink-studio/lut',
          version: 1,
          title: 'Pigment mixture coordinates',
          size,
          interpolation: 'trilinear',
          data: cube
        };
      },
      snapshot: () => ({
        format: 'ink-studio/paint-table',
        version: 1,
        size,
        dimensions,
        names: names.slice(),
        data: data.slice()
      })
    });
  }
  function bakeTable(definition = {}) {
    check(fields(definition, ['paints', 'size']), 'invalid table settings');
    const { paints: inputs, size = 17 } = definition;
    check(
      Array.isArray(inputs) &&
        inputs.length >= 2 &&
        inputs.length <= 4 &&
        Number.isSafeInteger(size) &&
        size >= 2 &&
        size <= 33,
      'table needs 2–4 paints and size 2–33'
    );
    const pigments = inputs.map(swatch),
      dimensions = pigments.length - 1,
      data = [];
    for (let index = 0; index < size ** dimensions; index++) {
      let q = index;
      const coords = [];
      for (let k = 0; k < dimensions; k++) {
        coords.push((q % size) / (size - 1));
        q = Math.floor(q / size);
      }
      const weights = tableWeights(coords);
      data.push(...mix(pigments.map((paint, i) => ({ paint, weight: weights[i] }))).rgb);
    }
    return tableAPI(
      size,
      dimensions,
      data,
      pigments.map(p => p.name)
    );
  }
  function restoreTable(definition) {
    check(
      fields(definition, ['format', 'version', 'size', 'dimensions', 'names', 'data']) &&
        definition.format === 'ink-studio/paint-table' &&
        definition.version === 1,
      'invalid paint table format'
    );
    const { size, dimensions, names, data } = definition;
    check(
      Number.isSafeInteger(size) &&
        size >= 2 &&
        size <= 33 &&
        Number.isSafeInteger(dimensions) &&
        dimensions >= 1 &&
        dimensions <= 3 &&
        Array.isArray(names) &&
        names.length === dimensions + 1 &&
        names.every(id) &&
        Array.isArray(data) &&
        data.length === size ** dimensions * 3 &&
        Array.from(data).every(v => finite(v) && v >= 0 && v <= 1),
      'invalid paint table data'
    );
    return tableAPI(size, dimensions, data.slice(), names.slice());
  }
  const glsl = `
vec3 inkPaintCoordinates(vec4 amounts) {
  vec4 w=max(amounts,vec4(0.0)); float scale=max(max(w.x,w.y),max(w.z,w.w));
  if(scale<=0.0)return vec3(0.0);w/=scale;w/=dot(w,vec4(1.0));
  return clamp(vec3(w.x,1.0-w.x>1e-7?w.y/(1.0-w.x):0.0,1.0-w.x-w.y>1e-7?w.z/(1.0-w.x-w.y):0.0),0.0,1.0);
}
vec3 inkPaintTable(highp sampler3D image,vec4 amounts) {
  vec3 size=vec3(textureSize(image,0)),uv=(inkPaintCoordinates(amounts)*(size-1.0)+0.5)/size;
  return texture(image,uv).rgb;
}`;
  K.paint = Object.freeze({
    wavelengths: bands,
    presets: freeze(Object.keys(definitions)),
    swatch,
    preset,
    mix,
    tint,
    shade,
    book,
    gradient,
    bakeRamp,
    restoreRamp,
    bakeTable,
    restoreTable,
    coordinates,
    glsl
  });
})(KIT);
