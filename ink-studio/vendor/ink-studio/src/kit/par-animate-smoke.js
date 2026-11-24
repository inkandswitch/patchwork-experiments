/* Native staggered-grid smoke with authored inlets and density output. */
(function (K) {
  const P = K.procedural;
  const { kinds, int, range, size, vector, raster, obstacles, disc, clamp, color } = P.rasterSimSupport;
  kinds.smoke = options => {
    const dims = size(options, 16384), { width, height } = dims, { closed } = obstacles(options, dims);
    const { emitters = [{ at: [width / 2, height * .8], radius: 6, density: 8, velocity: [0, -46] }],
      buoyancy = 7, wind = [0, 0], viscosity = .024, diffusion = .055, dissipation = .43,
      pressureIterations = 10, palette = ['#534957', '#88717e', '#b7a0a0', '#d7c1aa', '#f0d8ac'], opacity = .88,
      alphaScale = .92 } = options;
    const rgb = Array.isArray(palette) && int(palette.length, 1, 32) && palette.map(color);
    if (!rgb || !vector(wind, 2) || !range(buoyancy, -500, 500) || ![viscosity, diffusion, dissipation].every(n => range(n, 0, 10)) ||
        !int(pressureIterations, 2, 80) || !range(opacity, 0, 1) || !range(alphaScale, .001, 100) ||
        !Array.isArray(emitters) || emitters.length > 24)
      throw new RangeError('Invalid smoke inlets, flow, pressure or palette settings');
    const inlets = Array.from(emitters, row => {
      const { at, radius = 6, density = 8, velocity = [0, -44], start = 0, end = 1e6 } = row;
      if (!vector(at, 2) || !range(radius, .01, 256) || !range(density, 0, 1000) || !vector(velocity, 2) ||
          !range(start, 0, 1e6) || !range(end, start, 1e6)) throw new RangeError('Invalid smoke inlet');
      return { at, radius, density, velocity, start, end };
    });
    const fluid = P.motion.stableFluid({ ...dims, cell: 1, mask: (_x, _y, i) => !closed[i],
      pressureIterations, diffusionIterations: 4, maxTracing: 20, maxDt: .04, maxDensity: 20, maxSpeed: 160 });
    function step(tick, dt) {
      const time = (tick - 1) * dt, active = inlets.filter(row => time >= row.start && time < row.end);
      fluid.step(dt, {
        force(x, y, _time, { density }) {
          let a = wind[0] * density, b = (wind[1] - buoyancy) * density;
          for (const row of active) {
            const weight = disc(row, x, y);
            a += row.velocity[0] * weight;
            b += row.velocity[1] * weight;
          }
          return [a, b];
        },
        source(x, y) {
          let sum = 0;
          for (const row of active) sum += row.density * disc(row, x, y);
          return sum;
        },
        viscosity, diffusion, dissipation
      });
    }
    return { work: width * height * (48 + pressureIterations * 4) * 2, step, capture: fluid.exportState, restore: fluid.importState,
      frame() {
        const { density } = fluid.snapshot(), data = new Uint8Array(density.length * 4);
        let mass = 0;
        for (let i = 0; i < density.length; i++) {
          const amount = -Math.expm1(-density[i] * alphaScale);
          mass += density[i];
          if (amount < .016) continue;
          const level = Math.min(rgb.length - 1, Math.floor(amount * rgb.length));
          data.set(rgb[level], i * 4);
          data[i * 4 + 3] = Math.round(clamp(amount * opacity) * 255);
        }
        return { value: raster(dims, data, 4), field: raster(dims, density), mass };
      }
    };
  };
})(KIT);
