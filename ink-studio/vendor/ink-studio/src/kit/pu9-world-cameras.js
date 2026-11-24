/* Headless follow rig with a vertical jump window and portal pose handoff. */
(function (K) {
  const W = K.world, V = K.V, { clone, freeze } = K.procedural.data;
  const finite = Number.isFinite, up = Object.freeze([0, 1, 0]);
  const xyz = v => W.data.vector(v) && Array.from(v).every(finite);
  const ease = (rate, dt) => -Math.expm1(-rate * dt);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const defaults = { distance: 5.5, yaw: 0, pitch: 0.24, maxPitch: 1.35, height: 0.28,
    followRate: 9, riseRate: 5, fallRate: 7, jumpRoom: 1.7, fallRoom: 0.35, airInfluence: 0.16,
    snapDistance: 15, collisionRadius: 0.13, armRate: 6 };

  function rotate(v, axis, radians) {
    return radians ? K.M.app(K.M.rot(axis, radians), v) : v;
  }
  function create({ tuning = {}, stable, localUp = false } = {}) {
    if (!W.data.record(tuning) || Object.keys(tuning).some(key => !Object.hasOwn(defaults, key)) ||
        stable !== undefined && typeof stable !== 'function'||typeof localUp!=='boolean') throw new TypeError('Invalid camera rig tuning');
    const t = Object.freeze({ ...defaults, ...tuning });
    if (Object.entries(t).some(([key, value]) => !finite(value) ||
        !['yaw', 'pitch', 'height'].includes(key) && value < 0) ||
        t.distance <= 0 || t.distance > 1000 || t.maxPitch <= 0 || t.maxPitch >= Math.PI / 2 ||
        Math.abs(t.pitch) > t.maxPitch || t.airInfluence > 1)
      throw new RangeError('Invalid camera arm, pitch or follow rates');
    const planted = stable ?? (actor => actor.mode === 'ground' || actor.mode === 'swim');
    const referenceOf=actor=>localUp&&xyz(actor?.up)?V.norm(actor.up):up;
    function target(actor, focus) {
      if (!xyz(actor?.position) || focus !== undefined && !xyz(focus))
        throw new TypeError('A follow camera needs a finite actor position or focus point');
      return focus ?? V.mad(actor.position,referenceOf(actor),t.height);
    }
    function arm(focus, back, desired, clearance) {
      if (!clearance) return desired;
      let distance = 0;
      for (let i = 0; i < 256 && distance < desired; i++) {
        const d = clearance(V.mad(focus, back, distance), t.collisionRadius);
        if (!finite(d) && d !== Infinity) throw new TypeError('Camera clearance must be signed distance or positive infinity');
        const room = d - t.collisionRadius;
        if (room <= 0.001) break;
        distance = Math.min(desired, distance + room);
      }
      return distance;
    }
    function snapshot(focus, level, right, back, reference, pitch, length) {
      return freeze({ focus, level, reference, pitch, arm: length,
        pose: { eye: V.mad(focus, back, length), target: focus, right, up: V.cross(back, right), back } });
    }
    function start(actor, { focus, clearance } = {}) {
      if (clearance !== undefined && typeof clearance !== 'function') throw new TypeError('Expected a camera clearance query');
      const point = target(actor, focus).slice(), c = Math.cos(t.pitch);
      const reference=referenceOf(actor), turn=W.gravity.turn(up,reference);
      const back = K.M.app(turn,[Math.sin(t.yaw) * c, Math.sin(t.pitch), Math.cos(t.yaw) * c]);
      const right = K.M.app(turn,[Math.cos(t.yaw), 0, -Math.sin(t.yaw)]);
      return snapshot(point,V.dot(point,reference),right,back,reference,t.pitch,arm(point,back,t.distance,clearance));
    }
    function step(state, actor, dt, { focus, yaw = 0, pitch = 0, clearance } = {}) {
      if (!finite(dt) || dt < 0 || !finite(yaw) || !finite(pitch) || clearance !== undefined && typeof clearance !== 'function')
        throw new RangeError('Camera steps need nonnegative seconds and finite orbit input');
      if (!state) return start(actor, { focus, clearance });
      const point = target(actor, focus), snap = t.snapDistance > 0 && V.dist(state.focus, point) > t.snapDistance;
      const settled = planted(actor);
      const reference=localUp?referenceOf(actor):state.reference, vertical=localUp?reference:up;
      const altitude=V.dot(point,vertical), prior=state.level+(localUp?V.dot(state.focus,V.sub(vertical,state.reference)):0);
      let goal=altitude;
      if(!settled)goal=prior+(goal>=prior?Math.max(0,goal-prior-t.jumpRoom):Math.min(0,goal-prior+t.fallRoom));
      const level=snap?altitude:prior+(goal-prior)*ease(goal>=prior?t.riseRate:t.fallRate,dt);
      const mixed=V.mad(state.focus,V.sub(point,state.focus),snap?1:ease(t.followRate,dt));
      const follow=V.mad(mixed,vertical,level+(settled?0:(altitude-level)*t.airInfluence)-V.dot(mixed,vertical));
      const turn=W.gravity.turn(state.reference,reference);
      const right = V.norm(rotate(K.M.app(turn,state.pose.right),reference,yaw));
      const elevation = clamp(state.pitch + pitch, -t.maxPitch, t.maxPitch);
      const back = V.norm(rotate(rotate(K.M.app(turn,state.pose.back),reference,yaw),right,state.pitch-elevation));
      const room = arm(follow, back, t.distance, clearance);
      const length = Math.min(room, snap ? room : state.arm + (room - state.arm) * ease(t.armRate, dt));
      return snapshot(follow,level,right,back,reference,elevation,length);
    }
    function handoff(state, { actor, camera, link } = {}) {
      const point = target(actor);
      if (!state) return start(actor);
      if (!camera) {
        const reference=localUp?referenceOf(actor):state.reference, turn=W.gravity.turn(state.reference,reference);
        return snapshot(point,V.dot(point,localUp?reference:up),K.M.app(turn,state.pose.right),K.M.app(turn,state.pose.back),
          reference,state.pitch,state.arm);
      }
      if (![camera.eye, camera.right, camera.up, camera.back].every(xyz) ||
          camera.target !== undefined && !xyz(camera.target)) throw new TypeError('Expected a mapped camera pose');
      const pose = freeze(clone(camera));
      const focus = pose.target ?? V.mad(pose.eye, pose.back, -state.arm);
      const reference = link?.opening ? link.opening.direction(state.reference) : state.reference;
      return freeze({ ...state, focus, level: V.dot(focus,localUp?reference:up), reference, arm: V.dist(pose.eye, focus), pose });
    }
    return Object.freeze({ start, step, handoff, tuning: t });
  }
  W.cameras = Object.freeze({ follow: create });
})(KIT);
