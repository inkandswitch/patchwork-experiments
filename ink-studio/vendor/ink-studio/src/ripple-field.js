/* Renderer-independent travelling ripple fields. */
const RippleField = (() => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const length = v => Math.hypot(...v);
  const point = (value, name) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
      throw new TypeError(name + ' must be a finite XYZ vector');
    return value.slice();
  };
  function unit(value, name) {
    const v = point(value, name),
      size = length(v);
    if (!(size > 1e-9)) throw new RangeError(name + ' must be nonzero');
    return v.map(n => n / size);
  }
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => {
    const t = clamp(n);
    return t * t * (3 - 2 * t);
  };
  const positive = (n, name) => {
    if (!(Number.isFinite(n) && n > 0)) throw new RangeError(name + ' must be positive');
    return n;
  };
  const nonnegative = (n, name) => {
    if (!(Number.isFinite(n) && n >= 0)) throw new RangeError(name + ' must be nonnegative');
    return n;
  };

  const cardinal = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axisVector = (v, fallback) => (typeof v === 'string' && Object.hasOwn(cardinal, v) ? cardinal[v] : (v ?? fallback));
  function dropOf({ at, start = 0, repeat, strength = 1 }) {
    if (!Number.isFinite(start) || !Number.isFinite(strength))
      throw new TypeError('Ripple start and strength must be finite');
    if (repeat !== undefined) positive(repeat, 'Ripple repeat');
    return { at: point(at, 'Ripple source'), start, repeat, strength };
  }

  function wavefront(drop, time, speed) {
    const age = time - (drop.start ?? 0);
    return age < 0 ? -1 : speed * (drop.repeat ? age % drop.repeat : age);
  }

  function ringFactor(radius, front, scale, width, damping) {
    const travel = radius - front;
    if (radius < 1e-8 || Math.abs(travel) >= width) return 0;
    return (
      Math.sin((2 * Math.PI * travel) / scale) *
      (1 - smooth((Math.abs(travel) / width - 0.2) / 0.8)) *
      smooth(front / (scale * 0.25)) *
      Math.exp(-damping * radius)
    ) / radius;
  }

  function ringSampler(drops, { along, across, amplitude, scale, speed, width, damping }) {
    return function sample(position, time = 0, footprint = 0, out = [0, 0, 0]) {
      const amp = amplitude * (1 - smooth((footprint / scale - 0.35) / 0.5));
      let dx = 0,
        dz = 0;
      if (amp) {
        const x = dot(position, along), y = dot(position, across);
        for (const drop of drops()) {
          const front = wavefront(drop, time, speed);
          if (front < 0) continue;
          const u = x - dot(drop.at, along), v = y - dot(drop.at, across);
          const k = ringFactor(Math.hypot(u, v), front, scale, width, damping) * (drop.strength ?? 1);
          dx += u * k;
          dz += v * k;
        }
      }
      for (let i = 0; i < 3; i++) out[i] = amp * (along[i] * dx + across[i] * dz);
      return out;
    };
  }
  function field({
    axis,
    cross,
    amplitude = 0.3,
    scale = 0.3,
    speed = 1,
    width = scale * 2.5,
    damping = 0.3,
    drops = [],
    capacity = 64
  } = {}) {
    const along = unit(axisVector(axis, cardinal.x), 'Ripple axis');
    const across = unit(axisVector(cross, cardinal.z), 'Ripple cross axis');
    if (Math.abs(dot(along, across)) > 1e-5) throw new RangeError('Ripple axes must be perpendicular');
    nonnegative(amplitude, 'Ripple amplitude');
    nonnegative(damping, 'Ripple damping');
    positive(scale, 'Ripple wavelength');
    positive(speed, 'Ripple speed');
    positive(width, 'Ripple packet width');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw new RangeError('Ripple capacity must be 1–64');
    if (!Array.isArray(drops) || drops.length > capacity) throw new TypeError('Ripple drops exceed the field capacity');
    const active = new Map();
    let serial = 0;
    function add(drop) {
      if (active.size >= capacity) throw new RangeError('A ripple field can have up to ' + capacity + ' sources');
      const id = ++serial;
      active.set(id, dropOf(drop));
      return id;
    }
    drops.forEach(add);
    const sample = ringSampler(() => active.values(), { along, across, amplitude, scale, speed, width, damping });
    function prune(time, reach) {
      if (!Number.isFinite(time)) throw new TypeError('Ripple time must be finite');
      nonnegative(reach, 'Ripple reach');
      let removed = 0;
      for (const [id, drop] of active) {
        if (!drop.repeat && (time - drop.start) * speed > reach + width) {
          active.delete(id);
          removed++;
        }
      }
      return removed;
    }
    const axes = Object.freeze([...along, ...across]);
    const shape = Object.freeze([amplitude, scale, width, damping]);
    function frame(time, storage = new Float32Array(active.size * 4)) {
      if (!Number.isFinite(time)) throw new TypeError('Ripple time must be finite');
      if (!amplitude || !active.size) return { axes, shape, drops: storage, count: 0 };
      let count = 0;
      for (const drop of active.values()) {
        const front = wavefront(drop, time, speed);
        if (front <= 0 || !drop.strength) continue;
        const offset = count * 4;
        if (offset + 4 > storage.length) throw new RangeError('Ripple frame storage is too small');
        storage[offset] = dot(drop.at, along);
        storage[offset + 1] = dot(drop.at, across);
        storage[offset + 2] = front;
        storage[offset + 3] = drop.strength;
        count++;
      }
      return { axes, shape, drops: storage, count };
    }
    return {
      add,
      remove: id => active.delete(id),
      clear: () => active.clear(),
      prune,
      frame,
      get size() { return active.size; },
      sample,
      normal: { type: 'rings', sample }
    };
  }


  function sampleFrame(frame, [x, y, z], footprint = 0, out = [0, 0, 0]) {
    const { axes, shape, drops, count } = frame;
    const [ux, uy, uz, vx, vy, vz] = axes;
    const [amplitude, scale, width, damping] = shape;
    const amp = amplitude * (1 - smooth((footprint / scale - 0.35) / 0.5));
    let du = 0, dv = 0;
    if (amp) {
      const u = x * ux + y * uy + z * uz, v = x * vx + y * vy + z * vz;
      for (let i = 0; i < count * 4; i += 4) {
        const a = u - drops[i], b = v - drops[i + 1];
        const k = ringFactor(Math.hypot(a, b), drops[i + 2], scale, width, damping) * drops[i + 3];
        du += a * k;
        dv += b * k;
      }
    }
    out[0] = amp * (ux * du + vx * dv);
    out[1] = amp * (uy * du + vy * dv);
    out[2] = amp * (uz * du + vz * dv);
    return out;
  }

  // A frame stores each moving front once. Backends sum this kernel in tangent coordinates.
  const glsl = `
vec2 inkRippleSlope(vec2 position, vec4 drop, vec4 shape, float footprint) {
  vec2 offset = position - drop.xy;
  float radius = length(offset), travel = radius - drop.z;
  if (radius < 1e-8 || abs(travel) >= shape.z) return vec2(0.0);
  float amplitude = shape.x * (1.0 - smoothstep(0.35, 0.85, footprint / shape.y));
  float envelope = (1.0 - smoothstep(0.2, 1.0, abs(travel) / shape.z))
    * smoothstep(0.0, shape.y * 0.25, drop.z) * exp(-shape.w * radius);
  return offset * (amplitude * drop.w * sin(6.283185307179586 * travel / shape.y) * envelope / radius);
}`;

  return { field, ringSampler, sampleFrame, glsl };
})();
if (typeof module !== 'undefined') module.exports = RippleField;
