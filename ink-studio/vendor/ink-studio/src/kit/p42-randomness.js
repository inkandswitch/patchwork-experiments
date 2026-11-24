/* Named authoring streams, with coherent variation from the existing noise fields. */
(function (K) {
  const P = K.procedural;
  function spatial(stream, options = {}) {
    if (!Randomness.isStream(stream)) throw new TypeError('Randomness: spatial variation needs a named stream');
    const keys = ['dimension', 'scale', 'octaves', 'persistence', 'lacunarity', 'min', 'max'];
    if (
      !options ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(k => !keys.includes(k))
    )
      throw new TypeError('Randomness: invalid spatial variation');
    const { dimension = 3, octaves = 3, persistence = 0.5, lacunarity = 2, min = 0, max = 1 } = options;
    if (
      !Number.isInteger(dimension) ||
      dimension < 2 ||
      dimension > 4 ||
      !Number.isInteger(octaves) ||
      octaves < 1 ||
      octaves > 8 ||
      !Number.isFinite(persistence) ||
      persistence < 0 ||
      persistence > 1 ||
      !Number.isFinite(lacunarity) ||
      lacunarity < 1 ||
      lacunarity > 8 ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      Math.abs(min) > 1e9 ||
      Math.abs(max) > 1e9 ||
      min > max
    )
      throw new RangeError('Randomness: invalid coherent field controls');
    const scale = Array.isArray(options.scale) ? Array.from(options.scale) : Array(dimension).fill(options.scale ?? 1);
    if (scale.length !== dimension || scale.some(n => !Number.isFinite(n) || n < 1e-6 || n > 1e6))
      throw new RangeError('Randomness: field scale must match its dimension');
    const noise = Array.from({ length: octaves }, (_, i) =>
      P.fields.simplex({ dimension, seed: P.data.hash('random-field/' + i, stream.seed32) })
    );
    function run(point, jet) {
      if (point.length !== dimension || point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9))
        throw new RangeError('Randomness: invalid field coordinates');
      let value = 0,
        weight = 1,
        frequency = 1,
        total = 0;
      const gradient = jet ? Array(dimension).fill(0) : null;
      for (let i = 0; i < octaves; i++) {
        const p = point.map((v, j) => (v * frequency) / scale[j]);
        if (p.some(n => Math.abs(n) > 1e12))
          throw new RangeError('Randomness: field frequency exceeds coordinate budget');
        const s = jet ? noise[i].sample(...p) : { value: noise[i].value(...p) };
        value += s.value * weight;
        total += weight;
        if (jet) for (let j = 0; j < dimension; j++) gradient[j] += ((s.gradient[j] * frequency) / scale[j]) * weight;
        weight *= persistence;
        frequency *= lacunarity;
      }
      const u = Math.max(0, Math.min(1, 0.5 + (0.5 * value) / total)),
        result = min + (max - min) * u;
      if (!jet) return result;
      const slope = u > 0 && u < 1 ? (max - min) / 2 / total : 0;
      return { value: result, gradient: gradient.map(v => v * slope) };
    }
    const field = (...point) => run(point, false);
    field.sample = (...point) => run(point, true);
    field.gradient = (...point) => field.sample(...point).gradient;
    field.spec = P.data.freeze({
      stream: stream.path,
      seed32: stream.seed32,
      dimension,
      scale,
      octaves,
      persistence,
      lacunarity,
      min,
      max
    });
    field.cost = octaves;
    return Object.freeze(field);
  }
  const api = Object.freeze({
    create: Randomness.create,
    from: Randomness.from,
    distribution: Randomness.distribution,
    correlated: Randomness.correlated,
    isStream: Randomness.isStream,
    algorithm: Randomness.algorithm,
    spatial
  });
  P.random = api;
  K.random = api;
})(KIT);
