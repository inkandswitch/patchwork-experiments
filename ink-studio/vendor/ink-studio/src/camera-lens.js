/* Shared lens and subject-plane composition math for script, Node and ESM hosts. */
const CameraLens = (() => {
  const defaultFov = (38 * Math.PI) / 180,
    defaultSensorHeight = 24;
  const finite = Number.isFinite;
  const check = (ok, message) => {
    if (!ok) throw new RangeError('Camera lens: ' + message);
  };
  const fovOK = fov => finite(fov) && fov > 0 && fov < Math.PI;
  function fieldOfView(focalLength, sensorHeight = defaultSensorHeight) {
    check(
      finite(focalLength) && focalLength > 0 && finite(sensorHeight) && sensorHeight > 0,
      'focal length and sensor height must be positive millimeters'
    );
    const fov = 2 * Math.atan(sensorHeight / 2 / focalLength);
    check(fovOK(fov), 'lens must have a representable vertical field of view');
    return fov;
  }
  function focalLength(fov, sensorHeight = defaultSensorHeight) {
    check(fovOK(fov) && finite(sensorHeight) && sensorHeight > 0, 'invalid field of view or sensor height');
    const mm = sensorHeight / 2 / Math.tan(fov / 2);
    check(finite(mm) && mm > 0, 'lens must have a representable focal length');
    return mm;
  }
  function resolve(base = {}, override = {}) {
    const sensorHeight = override.sensorHeight ?? base.sensorHeight ?? defaultSensorHeight;
    check(finite(sensorHeight) && sensorHeight > 0, 'sensor height must be positive millimeters');
    if (override.fov !== undefined && override.focalLength !== undefined)
      check(
        Math.abs(override.fov - fieldOfView(override.focalLength, sensorHeight)) < 1e-10,
        'choose field of view or focal length'
      );
    const sourceFov =
      base.fov ?? (base.focalLength !== undefined ? fieldOfView(base.focalLength, base.sensorHeight) : defaultFov);
    let fov = override.fov ?? sourceFov;
    if (override.focalLength !== undefined) fov = fieldOfView(override.focalLength, sensorHeight);
    else if (override.sensorHeight !== undefined && override.fov === undefined)
      fov = fieldOfView(focalLength(sourceFov, base.sensorHeight), sensorHeight);
    check(fovOK(fov), 'vertical field of view must be in (0, pi)');
    const focusDistance = override.focusDistance ?? base.focusDistance;
    check(
      focusDistance === undefined || (finite(focusDistance) && focusDistance > 0),
      'focus distance must be positive'
    );
    return {
      fov,
      sensorHeight,
      focalLength: focalLength(fov, sensorHeight),
      ...(focusDistance !== undefined && { focusDistance })
    };
  }
  function view(base = {}, ...layers) {
    let out = { target: [0, 0, 0], dist: 12, yaw: 0, pitch: 0, ...base, ...resolve(base) };
    for (const layer of layers)
      if (layer) {
        const lens = resolve(out, layer);
        out = { ...out, ...layer, ...lens };
        if (layer.projection !== undefined && layer.ortho === undefined)
          out.ortho = layer.projection === 'orthographic';
      }
    if (out.ortho === undefined) out.ortho = out.projection === 'orthographic';
    check(
      Array.isArray(out.target) &&
        out.target.length === 3 &&
        out.target.every(finite) &&
        [out.yaw, out.pitch, out.dist].every(finite) &&
        out.dist > 0,
      'finite target, orbit and positive distance required'
    );
    out.target = out.target.slice();
    if (out.composition !== undefined) out.composition = composition(out.composition).slice();
    return out;
  }
  function composition(at) {
    check(
      Array.isArray(at) && at.length === 2 && at.every(x => finite(x) && x >= 0 && x <= 1),
      'composition is a normalized screen point [u,v]'
    );
    return at;
  }
  function target(camera, aspect) {
    check(finite(aspect) && aspect > 0, 'aspect must be positive');
    if (!camera.composition) return camera.target;
    const [u, v] = composition(camera.composition),
      h = camera.dist * Math.tan(camera.fov / 2),
      sy = Math.sin(camera.yaw),
      cy = Math.cos(camera.yaw),
      sp = Math.sin(camera.pitch),
      cp = Math.cos(camera.pitch),
      right = [cy, 0, -sy],
      up = [-sp * sy, cp, -sp * cy],
      x = (0.5 - u) * 2 * h * aspect,
      y = (v - 0.5) * 2 * h;
    return camera.target.map((n, i) => n + right[i] * x + up[i] * y);
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function pose(value) {
    const valid = v => Array.isArray(v) && v.length === 3 && v.every(finite);
    check(
      value && [value.eye, value.right, value.up, value.back].every(valid),
      'pose requires a finite eye and camera axes'
    );
    const axes = [value.right, value.up, value.back];
    check(
      axes.every(axis => Math.abs(dot(axis, axis) - 1) < 1e-4) &&
        Math.abs(dot(axes[0], axes[1])) < 1e-4 &&
        Math.abs(dot(axes[0], axes[2])) < 1e-4 &&
        Math.abs(dot(axes[1], axes[2])) < 1e-4 &&
        dot(cross(axes[0], axes[1]), axes[2]) > 0.9999,
      'pose axes must be right-handed and orthonormal'
    );
    return Object.fromEntries(['eye', 'right', 'up', 'back'].map(key => [key, value[key].slice()]));
  }
  function fromView(v) {
    check(v && v.length === 16 && Array.from(v).every(finite), 'view matrix must be finite');
    return pose({
      eye: [
        -(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]),
        -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]),
        -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14])
      ],
      right: [v[0], v[4], v[8]],
      up: [v[1], v[5], v[9]],
      back: [v[2], v[6], v[10]]
    });
  }
  function matrix(value) {
    const { eye, right, up, back } = pose(value);
    return [
      right[0],
      up[0],
      back[0],
      0,
      right[1],
      up[1],
      back[1],
      0,
      right[2],
      up[2],
      back[2],
      0,
      -dot(right, eye),
      -dot(up, eye),
      -dot(back, eye),
      1
    ];
  }
  function listenerPose(value, setback = 0) {
    check(finite(setback), 'camera setback must be finite');
    const out = pose(value);
    out.eye = out.eye.map((n, i) => n - out.back[i] * setback);
    return out;
  }
  function applyMotion(value, motion, { setback = 0 } = {}) {
    const original = listenerPose(value, setback),
      translation = motion.translation ?? [0, 0, 0],
      rotation = motion.rotation ?? [0, 0, 0];
    check(
      [translation, rotation].every(v => Array.isArray(v) && v.length === 3 && v.every(finite)),
      'camera motion requires finite world translation and rotation vectors'
    );
    const radians = Math.hypot(...rotation);
    check(finite(radians), 'rotation magnitude must be finite');
    const axis = radians ? rotation.map(v => v / radians) : [0, 0, 1],
      c = Math.cos(radians),
      s = Math.sin(radians);
    function turn(v) {
      const sideways = cross(axis, v),
        parallel = dot(axis, v) * (1 - c);
      return v.map((n, i) => n * c + sideways[i] * s + axis[i] * parallel);
    }
    const back = turn(original.back);
    return {
      eye: original.eye.map((n, i) => n + translation[i] + back[i] * setback),
      right: turn(original.right),
      up: turn(original.up),
      back
    };
  }
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  function constrain(camera, limits) {
    if (!limits) return camera;
    let { yaw, pitch, dist } = camera;
    if (limits.yaw && limits.yaw[1] - limits.yaw[0] < 2 * Math.PI) {
      const middle = (limits.yaw[0] + limits.yaw[1]) / 2, offset = yaw - middle;
      const wrapped = middle + Math.atan2(Math.sin(offset), Math.cos(offset));
      yaw += clamp(wrapped, ...limits.yaw) - wrapped;
    }
    if (limits.pitch) pitch = clamp(pitch, ...limits.pitch);
    if (limits.distance) dist = clamp(dist, ...limits.distance);
    return { ...camera, yaw, pitch, dist };
  }

  function orbitPose(yaw, pitch, distance, at) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw), cp = Math.cos(pitch), sign = cp < 0 ? -1 : 1;
    const back = [cp * sin, Math.sin(pitch), cp * cos], right = [sign * cos, 0, -sign * sin];
    return { eye: at.map((n, i) => n + distance * back[i]), right, up: cross(back, right), back };
  }

  function snapView(view, pixelsPerUnit, anchor) {
    const result = view.slice();
    for (let row = 0; row < 2; row++) {
      const position = anchor[0] * view[row] + anchor[1] * view[4 + row] + anchor[2] * view[8 + row] + view[12 + row];
      result[row + 12] += Math.round(position * pixelsPerUnit) / pixelsPerUnit - position;
    }
    return result;
  }
  function artView(sample, height, authored, override, grid = 1) {
    const read = value => value === true ? { snap: true } : value || {};
    const { snap, anchor = [0, 0, 0] } = { ...read(authored), ...read(override) };
    if (!sample.ortho || !snap || override === false) return sample.view;
    check(Array.isArray(anchor) && anchor.length === 3 && Array.from(anchor).every(finite),
      'snap anchor must be finite XYZ');
    return snapView(sample.view, height / (2 * sample.tangent * sample.dist * grid), anchor);
  }

  function frame(world, options, width, height, { orbit, impulse, probe = false } = {}) {
    check([width, height].every(value => finite(value) && value > 0), 'viewport must be positive');
    const cameraTime = options.cameraTime ?? (options.timeDomains ?? world.timeDomains)?.read('camera').sampleTime ??
      options.time ?? options.t ?? world.lookSnapshot?.time;
    const time = cameraTime ?? 0;
    const authored = world.cameraRig?.sample(time, { shot: options.cameraShot }).camera;
    const base = view(world.cam, authored, probe ? undefined : options.camera);
    const keys = probe ? ['fov'] : ['fov', 'focalLength', 'sensorHeight', 'focusDistance'];
    const lens = resolve(base, Object.fromEntries(keys.filter(key => options[key] !== undefined).map(key => [key, options[key]])));
    const lensScale = options.lensScale ?? 1, zoom = options.zoom ?? 1;
    check(finite(lensScale) && lensScale > 0 && finite(zoom) && zoom > 0, 'lens scale and zoom must be positive');
    const tangent = Math.tan(lens.fov / 2) / lensScale, aspect = width / height;
    const ortho = options.ortho ?? (options.projection === undefined ? base.ortho : options.projection === 'orthographic');
    const animation = options.lockCamera ? undefined : world.anim;
    const dist0 = options.dist ?? base.dist / zoom;
    const { yaw, pitch, dist } = constrain({ yaw: options.yaw ?? base.yaw, pitch: options.pitch ?? base.pitch,
      dist: dist0 / (animation?.zoom || 1) }, orbit);
    check([yaw, pitch, dist].every(finite) && dist > 0, 'finite orbit and positive distance required');
    const output = options.target && Object.hasOwn(options.target, 'framebuffer');
    const at = !output && options.target != null ? options.target : base.target;
    check((Array.isArray(at) || ArrayBuffer.isView(at)) && at.length === 3 && Array.from(at).every(finite),
      'target must be finite XYZ');
    const composed = target({ target: Array.from(at), yaw, pitch, dist, fov: 2 * Math.atan(tangent),
      composition: options.composition ?? base.composition }, aspect);
    const framed = composed.map((n, i) => n + (animation?.kick?.[i] ?? 0));
    const radius = world.radius ?? 14, setback = ortho && !authored && !base.pose ? 2 * radius + 4 : 0;
    const distance = dist + setback;
    let pose = base.pose ?? orbitPose(yaw, pitch, distance, framed);
    const motion = !probe && impulse?.(world, { ...options, cameraTime }, listenerPose(pose, setback));
    if (motion && (motion.translation.some(Boolean) || motion.rotation.some(Boolean))) pose = applyMotion(pose, motion, { setback });
    return { base, lens, time, motion: motion || null, pose, view: matrix(pose), framed, yaw, pitch, dist, dist0, distance, radius,
      setback, aspect, tangent, ortho, clipNear: Math.max(.4, .15 * dist), clipFar: 400 };
  }

  function rays(view, eye, W, H, focal, ortho) {
    const origin = eye.slice(),
      direction = [0, 0, 0];
    const ray = { origin, direction, axial: 1 };
    return (x, y) => {
      const u = (x - W / 2) / focal,
        v = (y - H / 2) / focal;
      ray.axial = ortho ? 1 : 1 / Math.hypot(u, v, 1);
      for (let i = 0; i < 3; i++) {
        const j = i * 4;
        const offset = u * view[j] + v * view[j + 1];
        origin[i] = eye[i] + (ortho ? offset : 0);
        direction[i] = ortho ? -view[j + 2] : (offset - view[j + 2]) * ray.axial;
      }
      return ray;
    };
  }
  return Object.freeze({
    rays,
    defaultFov,
    defaultSensorHeight,
    fieldOfView,
    focalLength,
    resolve,
    view,
    composition,
    target,
    pose,
    fromView,
    matrix,
    listenerPose,
    applyMotion,
    constrain,
    orbitPose,
    frame,
    snapView,
    artView
  });
})();
if (typeof module !== 'undefined') module.exports = CameraLens;
else globalThis[Symbol.for('ink-studio.camera-lens')] = CameraLens;
