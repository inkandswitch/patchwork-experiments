/* Native world mechanics applied to a small XY raster stage. */
(function (K) {
  const P = K.procedural, V = K.V, M = K.M;
  const { kinds, size, int, range, vector, color, draw, line } = P.rasterSimSupport;
  kinds.rigid = (options, recipe) => {
    const dims = size(options, 262144), { width, height } = dims;
    const { bodies = [{ id: 'block', at: [width * .5, height * .25], size: [12, 10], spin: 2 }],
      impulses = [], ground = height - 5, gravity = 105, units = .04, drag = .06, contactIterations = 10 } = options;
    if (!Array.isArray(bodies) || !int(bodies.length, 1, 64) || !Array.isArray(impulses) || impulses.length > 256 ||
        !range(ground, 0, height) || !range(gravity, 0, 5000) || !range(units, .001, 10) ||
        !range(drag, 0, 10) || !int(contactIterations, 1, 24))
      throw new RangeError('Invalid raster mechanics geometry, gravity or budget');
    const appearance = new Map();
    const position = ([x, y]) => [x * units, (height - y) * units, 0];
    const velocity = ([x, y]) => [x * units, -y * units, 0];
    const screen = ([x, y]) => [x / units, height - y / units];
    const config = { ground: (height - ground) * units, gravity: [0, -gravity * units, 0], drag,
      contactIterations, continuous: true, bodies: {} };
    for (const row of Array.from(bodies).sort((a, b) => a?.id < b?.id ? -1 : a?.id > b?.id ? 1 : 0)) {
      const { id, at, size, depth = 30, velocity: initial = [0, 0], spin = 0, mass = 1, fixed = false,
        fill = '#d89b6d', rim = '#f6c386', material } = row;
      if (!K.world.data.id(id) || appearance.has(id) || !vector(at, 2) || !vector(initial, 2) || !vector(size, 2) ||
          size.some(n => !range(n * units * .5, .01, 1e4)) ||
          !range(depth * units * .5, .01, 1e4) || !range(spin, -80, 80) || !range(mass, .001, 1e5) ||
          typeof fixed !== 'boolean')
        throw new RangeError('Invalid raster rigid body');
      color(fill);
      color(rim);
      appearance.set(id, { fill, rim });
      config.bodies[id] = { position: position(at), half: [...size, depth].map(n => n * units * .5),
        velocity: velocity(initial), angular: [0, 0, -spin], mass, fixed, ...(material && { material }) };
    }
    const commands = Array.from(impulses, ({ tick, body, linear = [0, 0], spin = 0 }) => {
      if (!int(tick, 1, recipe.maxTicks) || !appearance.has(body) || !vector(linear, 2) || !range(spin, -1000, 1000))
        throw new RangeError('Invalid timed raster impulse');
      return { tick, action: 'rig/impulse', args: { body, linear: velocity(linear), angular: [0, 0, -spin] } };
    });
    const world = { format: 'ink-studio/world', id: 'raster-mechanics', seed: recipe.seed, dt: recipe.dt,
      systems: { rig: { kind: 'mechanics', config } }, commands };
    let run = K.world.runtime.create(world);
    return {
      work: bodies.length ** 2 * contactIterations * 6,
      step: () => run.step(), capture: () => run.checkpoint(),
      restore(saved, tick) {
        if (tick !== undefined && saved?.tick !== tick) throw new RangeError('Rigid checkpoint tick does not match');
        run = K.world.runtime.create(world, { checkpoint: saved });
      },
      frame() {
        const shapes = [], points = [];
        for (const body of Object.values(run.view().states.rig.bodies)) {
          const { id, half, position, rotation, velocity, fixed } = body, { fill, rim } = appearance.get(id);
          const polygon = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
            screen(V.add(position, M.app(rotation, [u * half[0], v * half[1], 0]))));
          shapes.push({ type: 'polygon', points: polygon, fill });
          shapes.push(line(polygon.slice(1), rim));
          points.push({ id, point: screen(position), velocity: [velocity[0] / units, -velocity[1] / units],
            angle: Math.atan2(-rotation[3], rotation[0]), fixed });
        }
        return { value: draw(dims, shapes), points, bodies: points.length };
      }
    };
  };
})(KIT);
