/* Complex dynamics and independent scalar channels for procedural materials. */
(function (K) {
  const P = K.procedural,
    TAU = 2 * Math.PI,
    defaultRoots = [[1, 0], [-0.5, Math.sqrt(3) / 2], [-0.5, -Math.sqrt(3) / 2]],
    coordinate = value => Number.isFinite(value) && Math.abs(value) <= 1e12;

  function pair(value) {
    if (!Array.isArray(value) || value.length !== 2 || !coordinate(value[0]) || !coordinate(value[1]))
      throw new RangeError('Expected a finite complex pair within ±1e12');
    return value.slice();
  }

  function trapDistance({ type = 'point', center = [0, 0], radius = 1, angle = 0, distance }) {
    if (type === 'custom' && typeof distance === 'function') return distance;
    const [x, y] = pair(center);
    if (type === 'point') return (re, im) => Math.hypot(re - x, im - y);
    if (type === 'circle' && coordinate(radius) && radius > 0)
      return (re, im) => Math.abs(Math.hypot(re - x, im - y) - radius);
    if ((type === 'line' || type === 'cross') && Number.isFinite(angle)) {
      const c = Math.cos(angle), s = Math.sin(angle);
      const across = (re, im) => Math.abs(c * (im - y) - s * (re - x));
      if (type === 'line') return across;
      return (re, im) => Math.min(across(re, im), Math.abs(c * (re - x) + s * (im - y)));
    }
    throw new RangeError('Expected a point, circle, line, cross, or custom orbit trap');
  }

  function compile({ family = 'mandelbrot', constant = [-0.8, 0.156], roots = defaultRoots,
    iterations = 64, escapeRadius, tolerance = 1e-7, includeInitial = family !== 'mandelbrot', traps = []
  } = {}) {
    if (!['mandelbrot', 'julia', 'newton'].includes(family) ||
      !Number.isInteger(iterations) || iterations < 1 || iterations > 1024 ||
      typeof includeInitial !== 'boolean')
      throw new RangeError('Expected a complex family and 1–1024 iterations');
    const julia = family === 'julia', newton = family === 'newton',
      [cr, ci] = julia ? pair(constant) : [0, 0],
      safeRadius = (1 + Math.sqrt(1 + 4 * Math.hypot(cr, ci))) / 2,
      radius = escapeRadius ?? Math.max(4, safeRadius),
      trapIds = new Set();
    if (!newton && (!coordinate(radius) || radius < Math.max(2, safeRadius)))
      throw new RangeError('Escape radius is below the quadratic escape bound or above 1e12');
    if (newton) {
      if (!Array.isArray(roots) || roots.length < 2 || roots.length > 12 ||
        !Number.isFinite(tolerance) || tolerance < 1e-15 || tolerance >= 1)
        throw new RangeError('Newton requires 2–12 roots and a tolerance in [1e-15, 1)');
      roots = Array.from(roots, pair);
      if (roots.some(([re, im], i) => roots.slice(0, i).some(([r, j]) => Math.hypot(re - r, im - j) <= 2 * tolerance)))
        throw new RangeError('Newton roots must be separated by more than twice the tolerance');
    }
    if (!Array.isArray(traps) || traps.length > 16) throw new RangeError('Expected at most 16 orbit traps');
    const targets = Array.from(traps, (trap, i) => {
      const id = trap?.id ?? String(i);
      if (!trap || typeof id !== 'string' || !id || trapIds.has(id))
        throw new RangeError('Orbit traps require unique nonempty string IDs');
      trapIds.add(id);
      return { id, distance: trapDistance(trap) };
    });

    function check(re, im) {
      if (!coordinate(re) || !coordinate(im)) throw new RangeError('Expected finite complex coordinates within ±1e12');
    }

    function sample(re, im) {
      check(re, im);
      let x = julia || newton ? re : 0, y = julia || newton ? im : 0,
        n = 0, status = 'limit', escapeTime = null, basinId = null;
      const closest = new Array(targets.length).fill(null);
      function visit() {
        for (let i = 0; i < targets.length; i++) {
          const value = targets[i].distance(x, y);
          if (value === null) continue;
          if (!Number.isFinite(value)) throw new RangeError('Orbit trap must return a finite distance or null');
          const distance = Math.abs(value);
          if (closest[i] === null || distance < closest[i]) closest[i] = distance;
        }
      }

      if (includeInitial) visit();
      if (newton) {
        for (;;) {
          let nearest = Infinity, root = 0;
          for (let i = 0; i < roots.length; i++) {
            const distance = Math.hypot(x - roots[i][0], y - roots[i][1]);
            if (distance < nearest) { nearest = distance; root = i; }
          }
          if (nearest <= tolerance) { basinId = root; status = 'converged'; break; }
          if (n === iterations) break;

          // Scale P'/P = Σ 1/(z - root) by the nearest distance before taking its reciprocal.
          let a = 0, b = 0, weightSum = 0;
          for (const [r, j] of roots) {
            const dx = x - r, dy = y - j, distance = Math.hypot(dx, dy), weight = nearest / distance;
            a += (dx / distance) * weight;
            b -= (dy / distance) * weight;
            weightSum += weight;
          }
          const magnitude = Math.hypot(a, b);
          if (magnitude <= 8 * Number.EPSILON * weightSum) { status = 'singular'; break; }
          const step = nearest / magnitude, nextX = x - (a / magnitude) * step, nextY = y + (b / magnitude) * step;
          if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) { status = 'singular'; break; }
          x = nextX;
          y = nextY;
          n++;
          visit();
        }
      } else {
        const a = julia ? cr : re, b = julia ? ci : im, radiusSquared = radius * radius;
        let squared = x * x + y * y;
        while (n < iterations && squared <= radiusSquared) {
          const nextX = x * x - y * y + a;
          y = 2 * x * y + b;
          x = nextX;
          n++;
          visit();
          squared = x * x + y * y;
        }
        if (squared > radiusSquared) {
          status = 'escaped';
          escapeTime = Math.max(0, n - Math.log2(Math.log(squared) / (2 * Math.log(radius))));
        }
      }
      const trap = Object.fromEntries(targets.map(({ id }, i) => [id, closest[i]]));
      return { status, iterations: n, escapeTime, basinId, trap };
    }

    function domain(re, im) {
      check(re, im);
      let x = re * re - im * im + (julia ? cr : re), y = 2 * re * im + (julia ? ci : im);
      if (newton) {
        x = 1;
        y = 0;
        for (const [r, j] of roots) {
          const a = re - r, b = im - j, nextX = x * a - y * b;
          y = x * b + y * a;
          x = nextX;
        }
      }
      const magnitude = Math.hypot(x, y);
      if (!magnitude) return { value: [x, y], phase: null, logMagnitude: null, rgb: 0 };
      const phase = Math.atan2(y, x), logMagnitude = Math.log2(magnitude);
      const hue = (((phase / TAU) % 1 + 1) % 1) * 6,
        light = 0.64 - 0.20 * Math.cos(TAU * (logMagnitude % 1)),
        channel = offset => {
          const k = (hue + offset) % 6;
          return Math.round(255 * light * (1 - 0.78 * Math.max(0, Math.min(k, 4 - k, 1))));
        };
      return { value: [x, y], phase, logMagnitude, rgb: (channel(5) << 16) | (channel(3) << 8) | channel(1) };
    }

    function field(channel, id) {
      if (channel === 'trap' && trapIds.has(id)) return (re, im) => sample(re, im).trap[id];
      if (['escapeTime', 'basinId', 'iterations'].includes(channel)) return (re, im) => sample(re, im)[channel];
      if (['phase', 'logMagnitude'].includes(channel)) return (re, im) => domain(re, im)[channel];
      throw new RangeError('Unknown complex field channel or trap ID');
    }
    function outputs({ bounds = { min: [-2, -2], max: [2, 2] } } = {}) {
      const traps = new Map(targets.map(({ id }) => ['trap:' + id, id]));
      const angle = { units: 'rad', range: [-Math.PI, Math.PI] };
      const channels = { status: { type: 'category' }, iterations: { range: [0, iterations] },
        escapeTime: {}, basinId: { type: 'category' }, phase: angle, logMagnitude: {}, rgb: { type: 'rgb' },
        ...Object.fromEntries(Array.from(traps.keys(), name => [name, {}])) };
      return K.fieldOutputs.create({
        bounds: { min: pair(bounds.min), max: pair(bounds.max) },
        channels,
        sample(re, im) {
          const orbit = sample(re, im), { phase, logMagnitude, rgb } = domain(re, im);
          return { ...orbit, phase, logMagnitude, rgb,
            ...Object.fromEntries(Array.from(traps, ([name, id]) => [name, orbit.trap[id]])) };
        },
        sampleChannel(name, re, im) {
          if (['phase', 'logMagnitude', 'rgb'].includes(name)) return domain(re, im)[name];
          const orbit = sample(re, im);
          return traps.has(name) ? orbit.trap[traps.get(name)] : orbit[name];
        }
      });
    }
    return Object.freeze({ family, sample, domain, field, outputs });
  }

  P.complexPlane = Object.freeze({ compile });
})(KIT);
