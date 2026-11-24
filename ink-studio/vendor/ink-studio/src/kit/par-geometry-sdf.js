/* Signed fields for native sculpt shapes, CSG, meshing and orthogonal sections. */
(function (K) {
  const P = K.procedural, A = P.sceneGraph, T = P.transforms;
  const { integer, range, vector, bounds, pixels, color, sliceAxes } = P.sceneGraphSupport;

  function field(sample, extent) {
    const box = P.data.freeze(bounds(extent));
    return Object.freeze(Object.assign(sample, { bounds: box }));
  }

  function extent(source, override) {
    return bounds(override ?? source?.bounds ?? (source?.lo && { min: source.lo, max: source.hi }));
  }

  function sampler(source, time = 0) {
    if (!P.graphTypes.validator('field')(source) || !Number.isFinite(time))
      throw new TypeError('Signed distance sampling needs a field and finite time');
    return (x, y, z) => {
      const result = typeof source === 'function' ? source(x, y, z, time) : source.sample(x, y, z, time);
      const scalar = typeof result === 'number' ? result : result?.value;
      if (!Number.isFinite(scalar)) throw new RangeError('Signed distance sample must be finite');
      return scalar;
    };
  }

  function shape(kind, { center = [0, 0, 0], radius = .7, half = [.6, .6, .6], round = 0,
    major = .68, minor = .19, length = 1, rotation = [0, 0, 0] } = {}) {
    if (!vector(center, 3) || !vector(rotation, 3)) throw new RangeError('SDF shape needs a finite center and rotation');
    const S = makeSculpt(makeBuilder(1, [0, 0xffffff])), held = { hold: true };
    const positive = n => range(n, .0001, 1e4);
    let dimensions, sd;
    if (kind === 'sphere' && positive(radius)) {
      dimensions = [radius, radius, radius];
      sd = S.ball([0, 0, 0], radius, null, held).sd;
    } else if (kind === 'box' && vector(half, 3) && half.every(positive) && range(round, 0, Math.min(...half))) {
      dimensions = half.slice();
      sd = S.box([0, 0, 0], half, null, { ...held, rd: round }).sd;
    } else if (kind === 'torus' && positive(major) && positive(minor) && minor < major) {
      dimensions = [major + minor, minor, major + minor];
      sd = S.torus([0, 0, 0], major, minor, null, held).sd;
    } else if (kind === 'capsule' && positive(length) && positive(radius)) {
      dimensions = [radius, length / 2 + radius, radius];
      // A capsule is the distance to a centered segment minus its radius.
      sd = (x, y, z) => Math.hypot(x, Math.max(0, Math.abs(y) - length / 2), z) - radius;
    } else throw new RangeError('Invalid sphere, rounded box, torus or capsule dimensions');
    const b = { min: dimensions.map(n => -n * 1.002), max: dimensions.map(n => n * 1.002) };
    return transformSDF(field(sd, b), { position: center, rotation });
  }

  function transformSDF(source, { bounds: explicitBounds, ...options } = {}) {
    const pose = T.local(options), scale = T.distanceScale(pose), inverse = K.M.inv(pose.R), domain = extent(source, explicitBounds);
    if (!P.graphTypes.validator('field')(source)) throw new TypeError('Transform needs a signed field');
    const evaluate = typeof source === 'function' ? source : source.sample.bind(source);
    return field((x, y, z, time) => {
      const a = x - pose.t[0], b = y - pose.t[1], c = z - pose.t[2];
      const value = evaluate(inverse[0] * a + inverse[1] * b + inverse[2] * c,
        inverse[3] * a + inverse[4] * b + inverse[5] * c, inverse[6] * a + inverse[7] * b + inverse[8] * c, time);
      return (typeof value === 'number' ? value : value?.value) * scale;
    }, T.bounds(pose, domain));
  }

  function combine(sources, { operation = 'union' } = {}) {
    if (!Array.isArray(sources) || !integer(sources.length, operation === 'subtract' ? 2 : 1, 32) ||
        !['union', 'intersection', 'subtract'].includes(operation)) throw new RangeError('Invalid signed-field combination');
    const boxes = sources.map(source => extent(source));
    const fold = operation === 'union' ? Math.min : Math.max;
    const bound = boxes[0];
    if (operation !== 'subtract') for (const box of boxes.slice(1)) for (let i = 0; i < 3; i++) {
      bound.min[i] = fold(bound.min[i], box.min[i]);
      bound.max[i] = -fold(-bound.max[i], -box.max[i]);
    }
    const evaluations = sources.map(source => typeof source === 'function' ? source : source.sample.bind(source));
    return field((x, y, z, time) => {
      let result;
      for (const evaluate of evaluations) {
        const sample = evaluate(x, y, z, time), value = typeof sample === 'number' ? sample : sample?.value;
        result = result === undefined ? value : fold(result, operation === 'subtract' ? -value : value);
      }
      return result;
    }, bound);
  }

  function sdfMesh(source, { bounds: explicitBounds, time = 0, color: tint = '#b7bccb', ...options } = {}) {
    return K.sdf.toMesh(sampler(source, time), { ...options, bounds: extent(source, explicitBounds), color: color(tint) });
  }

  function slices(source, { width = 32, height = 32, count = 20, axis = 'z', bounds: explicitBounds, time = 0,
    level = 0, color: tint = '#b7bccb' } = {}) {
    const size = pixels(width, height, 131072);
    if (!integer(count, 1, 256) || size * count > 131072 || !Object.hasOwn(sliceAxes, axis) || !Number.isFinite(level))
      throw new RangeError('Invalid signed-field slice count, axis or level');
    const domain = extent(source, explicitBounds), sample = sampler(source, time);
    const center = domain.min.map((n, i) => (n + domain.max[i]) / 2);
    const [a, b, c] = sliceAxes[axis](domain.max.map((n, i) => n - domain.min[i])).map(Math.abs);
    const pixelSize = [a / width, b / height], spacing = c / count;
    const rgb = color(tint).map(n => Math.round(n * 255)), pixel = [...rgb, 255];
    const value = Array.from({ length: count }, (_, z) => {
      const data = new Uint8Array(size * 4);
      for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p++) {
        const point = sliceAxes[axis]([(x + .5 - width / 2) * pixelSize[0], (height / 2 - y - .5) * pixelSize[1],
          (z + .5 - count / 2) * spacing]).map((n, i) => n + center[i]);
        if (sample(...point) <= level) data.set(pixel, p * 4);
      }
      return { width, height, data, channels: 4 };
    });
    return { value, layout: { axis, pixelSize, spacing, center } };
  }

  function boundSDF(source, domain) {
    return field((x, y, z, time) => {
      const result = typeof source === 'function' ? source(x, y, z, time) : source.sample(x, y, z, time);
      return typeof result === 'number' ? result : result?.value;
    }, domain);
  }

  Object.assign(A, { shape, boundSDF, transformSDF, combineSDF: combine, sdfMesh, sdfSlices: slices });
  Object.assign(P.sceneGraphSupport, { sdfExtent: extent, sdfSampler: sampler, boundedSDF: field });
})(KIT);
