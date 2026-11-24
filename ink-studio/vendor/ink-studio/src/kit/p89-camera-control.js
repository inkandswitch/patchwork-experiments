/* Eventful free-camera control around the seekable authored camera sampler. No DOM ownership. */
(function (K) {
  const finite = Number.isFinite,
    check = (ok, message) => {
      if (!ok) throw new RangeError('Camera control: ' + message);
    },
    angle = n => Math.atan2(Math.sin(n), Math.cos(n)),
    smooth = t => t * t * t * (t * (t * 6 - 15) + 10),
    clamp = K.clamp;
  K.cameraControl = (source, { handoff = 0.65, damping = 12, limits } = {}) => {
    check(
      (typeof source === 'function' || typeof source?.sample === 'function') &&
        finite(handoff) &&
        handoff >= 0 &&
        handoff <= 60 &&
        finite(damping) &&
        damping >= 0 &&
        damping <= 1000,
      'invalid sampler or tuning'
    );
    limits = K.cameraStaging.orbit(limits, 0.41);
    const clone = K.procedural.data.clone,
      freeze = K.procedural.data.freeze,
      sample = time => {
        const frame = typeof source === 'function' ? source(time) : source.sample(time);
        return { camera: CameraLens.view(frame.camera ?? frame), shot: frame.shot ?? null };
      };
    let current,
      prior,
      goal,
      free,
      transition,
      mode = 'rig',
      at = 0,
      velocity;
    function constrain(c) {
      return K.cameraStaging.constrain(
        { ...c, pitch: clamp(c.pitch, -Math.PI / 2, Math.PI / 2), dist: clamp(c.dist, 0.41, 1e6) },
        limits
      );
    }
    function seed() {
      if (!current) {
        const frame = sample(at);
        current = { ...frame, time: at, mode, weight: 0 };
      }
      return current.camera;
    }
    function begin(to, duration) {
      check(finite(duration) && duration >= 0 && duration <= 60, 'handoff duration must be in [0,60]');
      const camera = seed();
      if (to === 'free') {
        goal = clone(camera);
        free = clone(camera);
      }
      transition = { to, duration, elapsed: 0, from: clone(camera), velocity: velocity && clone(velocity) };
      mode = duration ? (to === 'free' ? 'toFree' : 'toRig') : to;
      current = { ...current, mode };
      if (!duration) {
        transition = null;
        current = to === 'rig' ? { ...sample(at), time: at, mode, weight: 0 } : { ...current, mode, weight: 1 };
      }
      return api;
    }
    function extrapolate(t) {
      const c = transition.from,
        v = transition.velocity;
      if (!v) return c;
      return {
        ...c,
        target: c.target.map((n, i) => n + v.target[i] * t),
        yaw: c.yaw + v.yaw * t,
        pitch: c.pitch + v.pitch * t,
        dist: c.dist * Math.exp(clamp(v.dist * t, -20, 20)),
        fov: 2 * Math.atan(Math.tan(c.fov / 2) * Math.exp(clamp(v.lens * t, -20, 20)))
      };
    }
    function update(dt, time = at + dt) {
      check(finite(dt) && dt >= 0 && dt <= 60 && finite(time) && time >= 0, 'update needs finite nonnegative seconds');
      const scripted = sample(time);
      if (!current) {
        current = { ...scripted, time, mode, weight: 0 };
        at = time;
      }
      if (time < at) velocity = null;
      let camera = scripted.camera,
        weight = 0;
      if (mode !== 'rig') {
        if (mode === 'free' || mode === 'toFree') {
          const amount = damping === 0 ? 1 : -Math.expm1(-damping * dt);
          free = constrain(K.cameraRig.blend(free, goal, amount));
          camera = free;
          weight = 1;
        }
        if (transition) {
          transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
          const u = transition.duration ? transition.elapsed / transition.duration : 1,
            w = clamp(smooth(u), 0, 1),
            from = extrapolate(transition.elapsed);
          camera = K.cameraRig.blend(from, transition.to === 'free' ? free : scripted.camera, w);
          weight = transition.to === 'free' ? w : 1 - w;
          if (u === 1) {
            mode = transition.to;
            transition = null;
          }
        }
      }
      camera = CameraLens.view(camera);
      prior = current;
      current = { camera, time, mode, weight, shot: scripted.shot };
      at = time;
      if (dt > 0) {
        const a = prior.camera,
          b = camera;
        velocity = {
          target: b.target.map((n, i) => (n - a.target[i]) / dt),
          yaw: angle(b.yaw - a.yaw) / dt,
          pitch: (b.pitch - a.pitch) / dt,
          dist: Math.log(b.dist / a.dist) / dt,
          lens: Math.log(Math.tan(b.fov / 2) / Math.tan(a.fov / 2)) / dt
        };
      }
      return read();
    }
    function input(delta = {}) {
      check(
        delta &&
          Object.getPrototypeOf(delta) === Object.prototype &&
          Object.keys(delta).every(key =>
            [
              'yaw',
              'pitch',
              'pan',
              'dolly',
              'fov',
              'focalLength',
              'sensorHeight',
              'focusDistance',
              'composition'
            ].includes(key)
          ),
        'unknown input field'
      );
      const { yaw = 0, pitch = 0, dolly = 0, pan = [0, 0] } = delta;
      check(
        [yaw, pitch, dolly].every(finite) &&
          Math.abs(dolly) <= 20 &&
          Array.isArray(pan) &&
          pan.length === 2 &&
          pan.every(finite),
        'invalid orbit, pan or dolly input'
      );
      // Validate the complete edit before taking control or changing the goal.
      const base = mode === 'free' || mode === 'toFree' ? goal : seed(),
        lens = CameraLens.resolve(base, delta);
      if (delta.composition !== undefined) CameraLens.composition(delta.composition);
      if (mode !== 'free' && mode !== 'toFree') begin('free', handoff);
      const right = [Math.cos(goal.yaw), 0, -Math.sin(goal.yaw)],
        up = [
          -Math.sin(goal.pitch) * Math.sin(goal.yaw),
          Math.cos(goal.pitch),
          -Math.sin(goal.pitch) * Math.cos(goal.yaw)
        ];
      goal = constrain({
        ...goal,
        ...lens,
        yaw: goal.yaw + yaw,
        pitch: goal.pitch + pitch,
        dist: goal.dist * Math.exp(dolly),
        target: goal.target.map((n, i) => n + right[i] * pan[0] + up[i] * pan[1]),
        ...(delta.composition && { composition: delta.composition.slice() })
      });
      return api;
    }
    function read() {
      seed();
      return freeze(clone(current));
    }
    const api = Object.freeze({
      update,
      input,
      read,
      take: ({ duration = handoff } = {}) => begin('free', duration),
      release: ({ duration = handoff } = {}) => begin('rig', duration)
    });
    return api;
  };
})(KIT);
