/* Golden-angle placement in physical surface area, with a fixed growth sequence. */
(function (K) {
  const P = K.procedural, V = K.V;
  const turn = (3 - Math.sqrt(5)) / 2, tau = 2 * Math.PI;
  const fract = n => n - Math.floor(n);
  const clamp = n => Math.max(0, Math.min(1, n));
  const count = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const vector = v => (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === 3 &&
    Array.from(v).every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
  function check(ok, message) {
    if (!ok) throw new RangeError('Surface phyllotaxis: ' + message);
  }
  function unit(v) {
    const length = Math.hypot(...v);
    return length > 0 ? v.map(n => n / length) : null;
  }
  function segment(cdf, progress) {
    const mass = cdf.at(-1);
    let lo = 0, hi = cdf.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] / mass <= progress) lo = mid;
      else hi = mid;
    }
    return [lo, clamp((progress * mass - cdf[lo]) / (cdf[hi] - cdf[lo]))];
  }

  function areaMap(read, [nx, ny], density, exactArea) {
    const grid = exactArea === undefined ? Array.from({ length: ny + 1 }, (_, y) =>
      Array.from({ length: nx + 1 }, (_, x) => read(x / nx, y / ny).point)) : null;
    const rows = [], marginal = [0];
    let area = 0;
    for (let y = 0; y < ny; y++) {
      const cdf = [0], weights = [];
      for (let x = 0; x < nx; x++) {
        let patchArea;
        if (grid) {
          const a = grid[y][x], b = grid[y][x + 1], c = grid[y + 1][x], d = grid[y + 1][x + 1];
          const cb = V.sub(c, b);
          patchArea = .5 * (V.len(V.cross(V.sub(a, b), cb)) + V.len(V.cross(cb, V.sub(d, b))));
        } else patchArea = exactArea / (nx * ny);
        const u = (x + .5) / nx, v = (y + .5) / ny;
        const weight = density ? density({ uv: [u, v], point: read(u, v).point }) : 1;
        check(Number.isFinite(weight) && weight >= 0 && weight <= 1e6, 'density must be in [0, 1000000]');
        cdf.push(cdf.at(-1) + patchArea * weight);
        weights.push(weight);
        area += patchArea;
      }
      rows.push({ cdf, weights });
      marginal.push(marginal.at(-1) + cdf.at(-1));
    }
    const mass = marginal.at(-1);
    check(mass > 0, 'the sampled chart has no positive weighted area');
    return { area: exactArea ?? area, mass, map(u, v) {
      const [y, fy] = segment(marginal, v);
      const { cdf, weights } = rows[y];
      const [x, fx] = segment(cdf, u);
      return { uv: [(x + fx) / nx, (y + fy) / ny], weight: weights[x] };
    } };
  }

  function compile(sample, { capacity, density, resolution = [64, 64], phase = 0, wrapU = false }, exactArea) {
    check(count(capacity, 1, 65536) && Number.isFinite(phase) && typeof wrapU === 'boolean' &&
      (density === undefined || typeof density === 'function') && Array.isArray(resolution) &&
      resolution.length === 2 && Array.from(resolution).every(n => count(n, 1, 256)),
    'expected capacity 1–65536, finite phase, optional density and resolution up to 256×256');
    function read(u, v) {
      const result = sample(u, v), point = result?.point ?? result, { normal, tangent } = result ?? {};
      check(vector(point) && [normal, tangent].every(dir => dir === undefined || vector(dir)),
        'a chart must return finite XYZ samples and directions');
      return { point: Array.from(point), normal: normal === undefined ? null : unit(Array.from(normal)),
        tangent: tangent === undefined ? null : unit(Array.from(tangent)) };
    }
    const carrier = exactArea !== undefined && density === undefined
      ? { area: exactArea, mass: exactArea, map: (u, v) => ({ uv: [u, v], weight: 1 }) }
      : areaMap(read, resolution, density, exactArea);
    const phaseTurns = (phase % tau) / tau, baseSpacing = Math.sqrt(carrier.mass / capacity);
    const side = wrapU ? fract : clamp, h = 1e-5;
    function at(id) {
      check(count(id, 0, capacity - 1), 'point ID is outside the layout');
      const { uv, weight } = carrier.map(fract(phaseTurns + id * turn), (id + .5) / capacity);
      const [u, v] = uv, sample = read(u, v);
      const across = sample.tangent ?? V.sub(read(side(u + h), v).point, read(side(u - h), v).point);
      const along = () => V.sub(read(u, clamp(v + h)).point, read(u, clamp(v - h)).point);
      const normal = sample.normal ?? unit(V.cross(across, along()));
      check(normal, 'the sampled surface has no valid normal');
      const inPlane = dir => unit(V.mad(dir, normal, -V.dot(dir, normal)));
      const tangent = inPlane(across) ?? inPlane(along());
      check(tangent, 'the sampled surface has no valid tangent');
      return P.data.freeze({ id, uv, point: sample.point, normal, tangent, bitangent: V.cross(normal, tangent),
        spacing: baseSpacing / Math.sqrt(weight) });
    }
    return Object.freeze({ capacity, area: carrier.area, at,
      points(visible = capacity) {
        check(count(visible, 0, capacity), 'visible count is outside the layout');
        return Object.freeze(Array.from({ length: visible }, (_, id) => at(id)));
      }
    });
  }

  function sphere({ center = [0, 0, 0], radius = 1, axis = [0, 1, 0], ...options } = {}) {
    check(vector(center) && vector(axis) && Number.isFinite(radius) && radius >= 1e-6 &&
      Array.from(center).every(n => Math.abs(n) + radius <= 1e6), 'sphere needs a finite center, axis and positive radius');
    const origin = Array.from(center), pole = unit(Array.from(axis));
    check(pole, 'sphere needs a nonzero axis');
    const reference = Math.abs(pole[0]) > .8 ? [0, 0, 1] : [1, 0, 0];
    const right = unit(V.mad(reference, pole, -V.dot(reference, pole))), around = V.cross(pole, right);
    return compile((u, v) => {
      const y = 1 - 2 * v, ring = 2 * Math.sqrt(v * (1 - v)), angle = u * tau;
      const normal = V.mad(V.mad(V.mul(pole, y), right, ring * Math.cos(angle)), around, ring * Math.sin(angle));
      return { point: V.mad(origin, normal, radius), normal,
        tangent: V.mad(V.mul(around, Math.cos(angle)), right, -Math.sin(angle)) };
    }, { ...options, wrapU: true }, 4 * Math.PI * radius * radius);
  }

  function surface(chart, options = {}) {
    check(typeof chart === 'function' || typeof chart?.sample === 'function', 'expected a UV sampling function or chart');
    return compile(typeof chart === 'function' ? chart : (u, v) => chart.sample(u, v), options);
  }
  P.sampling.phyllotaxis = Object.freeze({ sphere, surface, goldenAngle: tau * turn });
})(KIT);
