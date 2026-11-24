/* Authored cloth regions, bounded fixed-step review, and portable pose bakes. */
(function (K) {
  const format = 'ink-cloth-bake-v1';
  const roles = Object.freeze(['pin', 'free', 'protected']);
  const budget = 8_000_000;
  const finite = values => {
    if (!Array.isArray(values) && !ArrayBuffer.isView(values)) return false;
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i]) || !Number.isFinite(Math.fround(values[i]))) return false;
    }
    return Number.isSafeInteger(values.length);
  };
  const integer = (value, lo, hi) => Number.isInteger(value) && value >= lo && value <= hi;
  const point = (points, i) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];

  function mask(input, count) {
    if (!Array.isArray(input) || input.length !== count || Array.from(input).some(role => !roles.includes(role)))
      throw new TypeError('Cloth needs a pin, free, or protected region at every grid point');
    return Object.freeze(input.slice());
  }

  function sample(frames, fps, time) {
    if (!Number.isFinite(time)) throw new TypeError('Cloth sample time must be finite');
    const frame = K.clamp(time * fps, 0, frames.length - 1);
    const i = Math.floor(frame), f = frame - i;
    const result = Float32Array.from(frames[i]);
    if (f > 1e-9) for (let j = 0; j < result.length; j++) result[j] = K.mix(result[j], frames[i + 1][j], f);
    return result;
  }

  function clip(payload) {
    const { nu, nv, fps, frames, regions, sourceTime = 0 } = payload || {};
    if (payload?.format !== format || !integer(nu, 2, 96) || !integer(nv, 2, 96) ||
        !integer(fps, 30, 120) || !Array.isArray(frames) || !frames.length ||
        frames.length * nu * nv * 3 > budget || !Number.isFinite(sourceTime) || sourceTime < 0)
      throw new TypeError('Invalid cloth bake or sample budget');
    const points = nu * nv, names = mask(regions, points);
    const poses = Array.from(frames, frame => {
      if (frame?.length !== points * 3 || !finite(frame)) throw new TypeError('Invalid cloth bake frame');
      return Float32Array.from(frame);
    });
    return Object.freeze({ nu, nv, fps, regions: names, sourceTime, duration: (poses.length - 1) / fps,
      sample: time => sample(poses, fps, time),
      toJSON: () => ({ format, nu, nv, fps, sourceTime, regions: names.slice(), frames: poses.map(pose => Array.from(pose)) })
    });
  }

  function create(panel, { regions, fps = 60, maxSeconds = 8, minimum = 0.6, quietFor = 0.45, speed = 0.04 } = {}) {
    const { nu, nv } = panel ?? {}, points = nu * nv;
    const limit = Math.floor(maxSeconds * fps);
    if (!integer(nu, 2, 96) || !integer(nv, 2, 96) || typeof panel.makeProxy !== 'function' ||
        !integer(fps, 30, 120) || !Number.isFinite(maxSeconds) || maxSeconds < 1 || maxSeconds > 30 ||
        !Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(quietFor) || quietFor <= 0 ||
        minimum + quietFor > maxSeconds || !Number.isFinite(speed) || speed <= 0 ||
        (limit + 1) * points * 3 > budget)
      throw new TypeError('Cloth review needs a panel and a bounded settle policy');
    let rolesByPoint = mask(regions ?? Array.from({ length: points }, (_, i) => i < nu ? 'pin' : 'free'), points);
    let run;
    function state() {
      return Object.freeze({ phase: run?.phase ?? 'idle', time: (run?.tick ?? 0) / fps,
        quiet: (run?.quiet ?? 0) / fps, maxSpeed: run?.maxSpeed ?? 0, frames: run?.frames.length ?? 0 });
    }
    function setRegions(input) {
      const next = mask(input, points);
      if (next.every((role, i) => role === rolesByPoint[i])) return rolesByPoint;
      rolesByPoint = next;
      run = undefined;
      return rolesByPoint;
    }
    function start(positions, { sourceTime = 0, pinAt, wind, sdf, spheres, gravity, damp, substeps } = {}) {
      if (positions?.length !== points * 3 || !finite(positions) || !Number.isFinite(sourceTime) || sourceTime < 0 ||
          [pinAt, wind, sdf].some(fn => fn !== undefined && typeof fn !== 'function') ||
          (gravity !== undefined && (gravity.length !== 3 || !finite(gravity))) ||
          (damp !== undefined && (!Number.isFinite(damp) || damp < 0)) ||
          (substeps !== undefined && !integer(substeps, 1, 32)) ||
          (spheres !== undefined && (!Array.isArray(spheres) || Array.from(spheres).some(sphere =>
            sphere?.c?.length !== 3 || !finite(sphere.c) || !Number.isFinite(sphere.r) || sphere.r < 0))))
        throw new TypeError('Cloth preview needs a finite current pose and valid solver inputs');
      const before = Float32Array.from(positions), roles = rolesByPoint;
      const sim = panel.makeProxy({
        pins: (i, j) => roles[j * nu + i] !== 'free',
        pinAt(i, j, rest, time) {
          const index = j * nu + i, captured = point(before, index);
          if (roles[index] !== 'pin' || !pinAt) return captured;
          const at = pinAt(index, captured, time);
          if (at?.length !== 3 || !finite(at)) throw new TypeError('Cloth pin target must be finite XYZ');
          return at;
        },
        ...(wind && { wind }), ...(sdf && { sdf }),
        ...(spheres && { spheres: spheres.map(sphere => ({ c: Array.from(sphere.c), r: sphere.r })) }),
        ...(gravity && { gravity: Array.from(gravity) }),
        ...(damp !== undefined && { damp }), ...(substeps !== undefined && { substeps })
      });
      sim.resetPose(before);
      run = { before, sourceTime, sim, tick: 0, quiet: 0, maxSpeed: 0, frames: [before], phase: 'running' };
      return state();
    }
    function advance(time) {
      if (!Number.isFinite(time) || time < 0 || !run) throw new TypeError('Start a preview before advancing its time');
      const end = Math.floor(Math.min(time, maxSeconds) * fps + 1e-8);
      while (run.phase === 'running' && run.tick < Math.min(end, limit)) {
        const tick = run.tick + 1, elapsed = tick / fps;
        const previous = run.frames.at(-1);
        let current;
        try {
          run.sim.step(1 / fps, elapsed);
          current = run.sim.X.slice(0, points * 3);
          if (!finite(current)) throw new Error('Cloth simulation produced a non-finite pose');
        } catch (error) {
          run.phase = 'failed';
          throw error;
        }
        let maximum = 0;
        for (let i = 0; i < current.length; i += 3)
          maximum = Math.max(maximum, Math.hypot(current[i] - previous[i],
            current[i + 1] - previous[i + 1], current[i + 2] - previous[i + 2]) * fps);
        run.tick = tick;
        run.maxSpeed = maximum;
        run.frames.push(current);
        run.quiet = elapsed >= minimum && maximum <= speed ? run.quiet + 1 : 0;
        if (run.quiet >= Math.ceil(quietFor * fps)) run.phase = 'settled';
        else if (tick === limit) run.phase = 'unsettled';
      }
      return state();
    }
    function at(time, { before = false } = {}) {
      if (!run || !Number.isFinite(time)) throw new TypeError('Start a cloth preview before sampling it');
      return before ? Float32Array.from(run.before) : sample(run.frames, fps, time);
    }
    function bake() {
      if (run?.phase === 'baked') return run.bake;
      if (run?.phase !== 'settled') throw new Error('Cloth must settle before it can be baked');
      const take = clip({ format, nu, nv, fps, regions: rolesByPoint, sourceTime: run.sourceTime, frames: run.frames });
      run.bake = take;
      run.phase = 'baked';
      return take;
    }
    return Object.freeze({ nu, nv, fps, state, regions: () => rolesByPoint, setRegions, start, advance, sample: at, bake,
      discard() { run = undefined; return state(); }
    });
  }

  K.cloth.review = Object.freeze({ create, clip, roles });
})(KIT);
