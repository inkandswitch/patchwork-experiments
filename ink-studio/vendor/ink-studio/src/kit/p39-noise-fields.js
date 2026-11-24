/* Seeded simplex and periodic gradient lattices, with analytic derivatives. */
(function (K) {
  const P = K.procedural,
    PI2 = 2 * Math.PI;
  const dimensionsOK = dimension => Number.isSafeInteger(dimension) && dimension >= 2 && dimension <= 4,
    wrap = (i, period) => period ? ((i % period) + period) % period : i;
  const gradients2 = Array.from({ length: 8 }, (_, i) => [Math.cos(i * PI2 / 8), Math.sin(i * PI2 / 8)]);
  function gradientsWithZeros(n, zeros) {
    const result = [];
    for (let zero = 0; zero < n; zero++) {
      for (let signs = 0; signs < 1 << (n - zeros); signs++) {
        let bit = 0;
        const g = [];
        for (let axis = 0; axis < n; axis++) {
          const live = (axis - zero + n) % n >= zeros;
          g.push(live ? ((signs & (1 << bit++)) ? 1 : -1) / Math.sqrt(n - zeros) : 0);
        }
        result.push(g);
      }
    }
    return result;
  }
  const gradients = [null, null, gradients2, gradientsWithZeros(3, 1), gradientsWithZeros(4, 1)];

  function hash(seed, coordinates) {
    let h = seed | 0;
    for (const coordinate of coordinates) {
      h = Math.imul(h ^ (coordinate | 0), 0x9e3779b1);
      h ^= h >>> 16;
    }
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function options(dimension, seed) {
    if (!dimensionsOK(dimension) || !Number.isSafeInteger(seed) || Math.abs(seed) > 4294967295)
      throw new Error('Noise needs two to four dimensions and a 32-bit seed');
    const gradientsForDimension = gradients[dimension],
      salt = hash(seed, [dimension, 0x52ac72b9]);
    return coordinates => gradientsForDimension[hash(salt, coordinates) % gradientsForDimension.length];
  }
  function coordinates(point, dimension) {
    if (point.length !== dimension || point.some(n => !Number.isFinite(n) || Math.abs(n) > 1e12))
      throw new Error('Noise needs finite coordinates matching its dimension');
  }
  function api(dimension, compute) {
    return Object.freeze({
      dimension,
      value(...p) {
        coordinates(p, dimension);
        return compute(p);
      },
      sample(...p) {
        coordinates(p, dimension);
        const derivative = new Array(dimension).fill(0),
          value = compute(p, derivative);
        return { value, gradient: derivative };
      },
      gradient(...p) {
        coordinates(p, dimension);
        const derivative = new Array(dimension).fill(0);
        compute(p, derivative);
        return derivative;
      }
    });
  }

  function simplex({ dimension = 3, seed = 0 } = {}) {
    const gradient = options(dimension, seed),
      skew = (Math.sqrt(dimension + 1) - 1) / dimension,
      unskew = (1 - 1 / Math.sqrt(dimension + 1)) / dimension,
      amplitude = [0, 0, 88, 111, 126][dimension];
    return api(dimension, (p, derivative) => {
      const offset = p.reduce((sum, v) => sum + v, 0) * skew,
        cell = p.map(v => Math.floor(v + offset)),
        shift = cell.reduce((sum, v) => sum + v, 0) * unskew,
        first = p.map((v, i) => v - cell[i] + shift),
        order = first.map((_, i) => i).sort((a, b) => first[b] - first[a] || a - b),
        corner = new Array(dimension).fill(0),
        lattice = new Array(dimension),
        relative = new Array(dimension);
      let value = 0;
      for (let k = 0; k <= dimension; k++) {
        if (k) corner[order[k - 1]] = 1;
        let envelope = 0.5;
        for (let i = 0; i < dimension; i++) {
          relative[i] = first[i] - corner[i] + k * unskew;
          envelope -= relative[i] * relative[i];
          lattice[i] = cell[i] + corner[i];
        }
        if (envelope <= 0) continue;
        const grad = gradient(lattice);
        let dot = 0;
        for (let i = 0; i < dimension; i++) dot += grad[i] * relative[i];
        const e3 = envelope ** 3, e4 = e3 * envelope;
        value += e4 * dot;
        if (derivative)
          for (let i = 0; i < dimension; i++)
            derivative[i] += e4 * grad[i] - 8 * e3 * dot * relative[i];
      }
      if (derivative)
        for (let i = 0; i < dimension; i++) derivative[i] *= amplitude;
      return value * amplitude;
    });
  }

  function periodic({ dimension = 3, seed = 0, periods } = {}) {
    const gradient = options(dimension, seed),
      repeat = periods === undefined ? new Array(dimension).fill(null) : periods;
    if (
      !Array.isArray(repeat) || repeat.length !== dimension ||
      repeat.some(n => n !== null && (!Number.isSafeInteger(n) || n < 1 || n > 1000000000))
    ) throw new Error('Periodic lattice needs positive integer periods or null per axis');
    const axisPeriods = repeat.slice();
    return api(dimension, (p, derivative) => {
      const cell = p.map(Math.floor),
        relative = p.map((v, i) => v - cell[i]),
        fade = relative.map(t => t * t * t * (t * (6 * t - 15) + 10)),
        slope = derivative && relative.map(t => 30 * t * t * (t - 1) ** 2);
      let value = 0;
      for (let corner = 0; corner < 1 << dimension; corner++) {
        const side = relative.map((_, axis) => (corner >>> axis) & 1),
          g = gradient(cell.map((v, axis) => wrap(v + side[axis], axisPeriods[axis]))),
          blend = fade.map((f, axis) => side[axis] ? f : 1 - f);
        let dot = 0, weight = 1;
        for (let i = 0; i < dimension; i++) {
          dot += g[i] * (relative[i] - side[i]);
          weight *= blend[i];
        }
        value += dot * weight;
        if (derivative) {
          for (let axis = 0; axis < dimension; axis++) {
            let dw = slope[axis] * (side[axis] ? 1 : -1);
            for (let i = 0; i < dimension; i++) if (i !== axis) dw *= blend[i];
            derivative[axis] += g[axis] * weight + dot * dw;
          }
        }
      }
      return value;
    });
  }

  P.fields = { simplex, periodic };
})(KIT);
