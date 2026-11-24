/* Fixed-step exchange between pigment particles and a staggered fluid grid. */
(function (K) {
  const P = K.procedural, M = P.motion;
  const number = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const pair = p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const record = p => p != null && [Object.prototype, null].includes(Object.getPrototypeOf(p));
  const check = (ok, why) => { if (!ok) throw new RangeError('Field–particle coupling: ' + why); };
  const clamp = (v, speed) => Math.max(-speed, Math.min(speed, v));
  const mix = (a, b, f) => a + (b - a) * f;
  const change = (rate, dt) => -Math.expm1(-rate * dt);

  function coupledFluid(options = {}) {
    const { dt = .04, drag = 7, windDrag = 1, release = 2.5, feedback = 1, maxSpeed = 12,
      particles = [], maxParticles = 16384, maxCouplingWork = 8000000 } = options;
    check(number(dt, 1e-5, 1) && [drag, windDrag, release, feedback].every(v => number(v, 0, 1e4)) &&
      number(maxSpeed, 1e-4, 1e5) && integer(maxParticles, 1, 65536) &&
      integer(maxCouplingWork, 1, 64000000), 'invalid tick, exchange controls, or work limits');
    const domain = M.gridDomain(options), { width, height, size, dx, dz, bounds, open, inside, trace, distribute } = domain;
    const fluid = M.stableFluid({ ...options, maxDt: dt, mask: (_x, _z, i) => open[i] });
    let water = fluid.snapshot(), members = [], tick = 0, nextId = 0, stepping = false;
    const names = water.dyes, areaTime = dx * dz * dt, saved = new WeakMap();
    check(!names.includes('density') && !names.includes('velocity'), 'density and velocity are reserved channel names');
    const channels = Object.freeze(['density', 'velocity', ...names]);
    const available = () => check(!stepping, 'cannot edit during a step');

    function spawn(list) {
      available();
      check(Array.isArray(list) && members.length + list.length <= maxParticles &&
        nextId + list.length <= Number.MAX_SAFE_INTEGER && Array.from(list).every(record), 'invalid or excessive particle list');
      const added = list.map(({ at, velocity = [0, 0], mass = .01, density = 0, dyes = {}, lifetime = Infinity }, i) => {
        check(pair(at) && inside(...at) && pair(velocity) && velocity.every(v => Math.abs(v) <= maxSpeed) &&
          number(mass, 0, 1e4) && number(density, 0, 1e6) &&
          (lifetime === Infinity || number(lifetime, 1e-5, 1e6)) && record(dyes) &&
          Object.entries(dyes).every(([key, v]) => names.includes(key) && number(v, 0, 1e6)),
          'particles need an open position and bounded velocity, payload, mass, and lifetime');
        return { id: nextId + i, at: at.slice(), velocity: velocity.slice(), mass, density,
          dyes: names.map(name => Object.hasOwn(dyes, name) ? dyes[name] : 0), lifetime, age: 0 };
      });
      members = members.concat(added);
      nextId += added.length;
      return Object.freeze(added.map(p => p.id));
    }

    function frame() {
      const snapshot = water, time = tick * dt;
      const checkChannel = channel => check(channels.includes(channel), 'unknown field channel ' + channel);
      function sample(channel, x, z) {
        checkChannel(channel);
        if (channel === 'velocity') return snapshot.sampleVelocity(x, z);
        if (channel === 'density') return snapshot.sample(x, z)?.density ?? null;
        return snapshot.sampleDye(channel, x, z);
      }
      function source(channel = 'density', { bounds: box, project, toWorld, units = null } = {}) {
        checkChannel(channel);
        const velocity = channel === 'velocity';
        check((project === undefined || typeof project === 'function' && box) &&
          (toWorld === undefined || velocity && typeof toWorld === 'function'), 'invalid field projection');
        const world = box ?? { min: [bounds.min[0], 0, bounds.min[1]], max: [bounds.max[0], 0, bounds.max[1]] };
        return K.fieldViews.source({ type: velocity ? toWorld ? 'vec3' : 'vec2' : 'number', bounds: world, units,
          sample(x, y, z) {
            const point = [x, y, z], local = project ? project(point) : [x, z];
            if (!pair(local)) return null;
            const value = sample(channel, ...local);
            return toWorld && value !== null ? toWorld(value, point) : value;
          } });
      }
      const particles = P.data.freeze(members.map(({ id, at, velocity, mass, age, density, dyes }) => ({
        id, at: at.slice(), velocity: velocity.slice(), mass, age, density,
        dyes: Object.fromEntries(names.map((name, i) => [name, dyes[i]]))
      })));
      const state = Object.freeze({ ...snapshot, density: snapshot.density.slice(), vx: snapshot.vx.slice(),
        vz: snapshot.vz.slice(), divergence: snapshot.divergence.slice(), time });
      return Object.freeze({ tick, time, particles, fluid: state, sample, source });
    }

    function step(count = 1, { wind, force, source, dyeSource, viscosity, diffusion, dissipation } = {}) {
      available();
      check(integer(count, 0, 300) && tick + count <= 1e8 &&
        [wind, force, source, dyeSource].every(fn => fn === undefined || typeof fn === 'function') &&
        [viscosity, diffusion, dissipation].every(v => v === undefined || number(v, 0, 1e8)),
        'invalid tick count or field inputs');
      if (!count) return frame();
      const backup = fluid.checkpoint();
      let current = members, field = water, work = count * size;
      stepping = true;
      try {
        for (let k = 0; k < count; k++) {
          const clock = (tick + k) * dt, surviving = [];
          const fx = new Float64Array(size), fz = new Float64Array(size), density = new Float64Array(size);
          const pigments = names.length ? new Array(size) : null;
          let push = false, releaseDensity = false, releaseDye = false;
          check(work <= maxCouplingWork, 'step exceeds its work budget');
          for (const p of current) {
            const elapsed = Math.min(dt, p.lifetime - p.age), [x, z] = p.at;
            let [u, v] = p.velocity;
            if (wind) {
              const gust = wind(x, z, clock);
              check(pair(gust), 'wind must return a finite XZ velocity');
              const gain = change(windDrag, elapsed);
              u = mix(u, clamp(gust[0], maxSpeed), gain);
              v = mix(v, clamp(gust[1], maxSpeed), gain);
            }
            const local = field.sampleVelocity(x, z), gain = change(drag, elapsed);
            const vx = mix(u, clamp(local[0], maxSpeed), gain), vz = mix(v, clamp(local[1], maxSpeed), gain);
            const travel = Math.abs(vx * elapsed / dx) + Math.abs(vz * elapsed / dz);
            work += Math.min(width + height, Math.ceil(travel)) + 1;
            check(work <= maxCouplingWork, 'step exceeds its work budget');
            const room = trace(x, z, x + vx * elapsed, z + vz * elapsed);
            const ax = vx * elapsed * room, az = vz * elapsed * room;
            const falloff = change(release, elapsed);
            const dm = p.density * falloff, dye = p.dyes.map(v => v * falloff);
            const mx = (u - vx) * p.mass * feedback, mz = (v - vz) * p.mass * feedback;
            if (dm || mx || mz || dye.some(Boolean)) {
              const samples = Math.max(1, Math.ceil(2 * Math.hypot(ax / dx, az / dz)));
              work += samples * (4 + 4 * names.length);
              check(work <= maxCouplingWork, 'step exceeds its work budget');
              const scale = 1 / (samples * areaTime);
              if (mx || mz) push = true;
              if (dm) releaseDensity = true;
              for (let s = 0; s < samples; s++) {
                const f = (s + .5) / samples;
                distribute(x + f * ax, z + f * az, (i, weight) => {
                  const w = weight * scale;
                  fx[i] += mx * w;
                  fz[i] += mz * w;
                  density[i] += dm * w;
                  for (let j = 0; j < names.length; j++) {
                    if (!dye[j]) continue;
                    releaseDye = true;
                    const row = pigments[i] ?? (pigments[i] = Object.create(null)), name = names[j];
                    row[name] = (row[name] ?? 0) + dye[j] * w;
                  }
                });
              }
            }
            if (elapsed < p.lifetime - p.age)
              surviving.push({ ...p, at: [x + ax, z + az], velocity: room === 1 ? [vx, vz] : [0, 0],
                age: p.age + elapsed, density: p.density - dm, dyes: p.dyes.map((n, i) => n - dye[i]) });
          }
          field = fluid.step(dt, {
            viscosity, diffusion, dissipation,
            force: push || force ? (x, z, _t, value) => {
              const applied = force ? force(x, z, clock, value) : [0, 0];
              check(pair(applied), 'force must return a finite XZ acceleration');
              return [applied[0] + fx[value.index], applied[1] + fz[value.index]];
            } : undefined,
            source: releaseDensity || source ? (x, z, _t, value) => {
              const rate = source ? source(x, z, clock, value) : 0;
              check(number(rate, -1e7, 1e7), 'density source must return a finite rate');
              return rate + density[value.index];
            } : undefined,
            dyeSource: releaseDye || dyeSource ? (x, z, _t, value) => {
              const written = pigments?.[value.index], applied = dyeSource?.(x, z, clock, value);
              if (applied == null) return written;
              check(record(applied), 'dye source must return a channel map');
              if (!written) return applied;
              check(Object.entries(applied).every(([name, rate]) => names.includes(name) && number(rate,-1e7,1e7)),
                'dye source must return known, finite channel rates');
              const sum = { ...applied };
              for (const [name, rate] of Object.entries(written))
                sum[name] = Object.hasOwn(sum, name) ? sum[name] + rate : rate;
              return sum;
            } : undefined
          });
          current = surviving;
        }
        members = current;
        water = field;
        tick += count;
      } catch (error) {
        fluid.restore(backup);
        throw error;
      } finally {
        stepping = false;
      }
      return frame();
    }

    function checkpoint() {
      available();
      const token = Object.freeze({ tick });
      saved.set(token, { fluid: fluid.checkpoint(), members, water, tick, nextId });
      return token;
    }
    function restore(token) {
      available();
      const state = saved.get(token);
      check(state, 'checkpoint belongs to a different simulation');
      fluid.restore(state.fluid);
      ({ members, water, tick, nextId } = state);
    }
    spawn(particles);
    const initial = checkpoint();
    return Object.freeze({ width, height, bounds, dt, channels, mask: () => open.slice(), spawn, step, frame,
      checkpoint, restore, reset: () => restore(initial) });
  }

  M.coupledFluid = coupledFluid;
})(KIT);
