/* Deterministic looping particle samples. Realization is supplied by the caller. */
(function (K) {
  const A = K.procedural,
    V = K.V,
    vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  function validate(raw) {
    const p = Object.assign(
      {
        count: 20,
        size: 0.09,
        height: 2,
        speed: 0.45,
        growth: 2.4,
        spread: 0.04,
        opacity: 0.8,
        seed: 1,
        direction: [0, 1, 0],
        drift: [0.25, 0, 0],
        windborne: false
      },
      raw
    );
    if (
      !p ||
      typeof p.id !== 'string' ||
      !p.id ||
      !vector(p.p) ||
      !vector(p.direction) ||
      !Number.isFinite(V.len(p.direction)) ||
      V.len(p.direction) < 1e-8 ||
      !vector(p.drift) ||
      typeof p.windborne !== 'boolean' ||
      p.drift.some(v => Math.abs(v) > 2048) ||
      !vector(p.color) ||
      p.color.some(v => v < 0 || v > 1) ||
      !Number.isInteger(p.count) ||
      p.count < 1 ||
      p.count > 128 ||
      !Number.isFinite(p.size) ||
      p.size < 0.01 ||
      p.size > 64 ||
      !Number.isFinite(p.height) ||
      p.height < 0.1 ||
      p.height > 2048 ||
      !Number.isFinite(p.speed) ||
      p.speed < 0.05 ||
      p.speed > 128 ||
      !Number.isFinite(p.growth) ||
      p.growth < 0 ||
      p.growth > 6 ||
      !Number.isFinite(p.spread) ||
      p.spread < 0 ||
      p.spread > 128 ||
      !Number.isFinite(p.opacity) ||
      p.opacity < 0.05 ||
      p.opacity > 3 ||
      !Number.isSafeInteger(p.seed)
    )
      throw new Error('Invalid visual particle emitter');
    return A.data.freeze(A.data.clone(p));
  }
  A.emitters = {
    compile(raw) {
      const parameters = validate(raw);
      const { p, seed, spread, count, size, speed, height, growth, opacity, drift, windborne } = parameters;
      const axis = V.norm(parameters.direction);
      const side = V.norm(V.cross(axis, Math.abs(axis[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0]));
      const cross = V.cross(side, axis);
      const period = height / speed;
      const bases = Array.from({ length: count }, (_, index) => {
        const angle = K.hash(seed, index, 1) * Math.PI * 2;
        const radius = Math.sqrt(K.hash(seed, index, 2)) * spread;
        return {
          p: V.mad(V.mad(p, side, Math.cos(angle) * radius), cross, Math.sin(angle) * radius),
          phase: K.hash(seed, index, 3),
          size: size * (0.8 + K.hash(seed, index, 4) * 0.4)
        };
      });
      function sample(index, time, wind) {
        if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(time)) {
          throw new Error('Emitter sampling needs an item index and finite time');
        }
        const base = bases[index],
          phase = ((((time % period) / period + base.phase) % 1) + 1) % 1;
        const t = Math.min(1, phase / 0.1),
          fade = t * t * (3 - 2 * t);
        const point = V.mad(V.mad(base.p, axis, phase * height), drift, Math.sin(phase * 7 + base.phase * 50) * phase);
        if (wind) {
          point[0] += wind[0] * phase * period;
          point[2] += wind[1] * phase * period;
        }
        return {
          p: point,
          size: base.size * (0.6 + phase * growth),
          opacity: opacity * (1 - phase) * fade
        };
      }
      return Object.freeze({
        parameters,
        period,
        sample: (index, time, options) => sample(index, time, windborne && options?.wind && A.airflow.frame(options.wind).velocity),
        samples(time, options) {
          const wind = windborne && options?.wind && A.airflow.frame(options.wind).velocity;
          return bases.map((_, index) => sample(index, time, wind));
        }
      });
    }
  };
})(KIT);
