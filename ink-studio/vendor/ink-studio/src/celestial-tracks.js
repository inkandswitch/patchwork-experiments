/* Seekable angular disks and eclipse masks, in the same coordinates as the sky. */
const CelestialTracks = (() => {
  const compiled = Symbol.for('ink-studio.celestial-tracks');
  const pi = Math.PI, tau = 2 * pi;
  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
  const mod = (v, period) => (v % period + period) % period;
  const mix = (a, b, t) => a + (b - a) * t;
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const smooth = t => t * t * (3 - 2 * t);
  const eases = { linear: t => t, smooth, hold: () => 0 };
  const radii = { star: .003, sun: .026, moon: .039, eclipse: .026 };
  const colors = { star: '#fff4e5', sun: '#ffe5bd', moon: '#e4edff' };
  const distances = { star: 1000, sun: 100, moon: 10 };
  const number = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(name + ' is out of range');
    return v;
  };
  const object = (value, label) => {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError(label + ' needs an object');
    return value;
  };
  const color = value => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Celestial color needs #rrggbb');
    return Object.freeze([1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
  };
  const direction = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];

  function motion(raw, base) {
    const { keys, period, azimuthMode = 'shortest' } = raw;
    if (!Array.isArray(keys) || !keys.length || keys.length > 2048)
      throw new TypeError('A celestial track needs 1 to 2048 keys');
    if (azimuthMode !== 'shortest' && azimuthMode !== 'unwrapped')
      throw new TypeError('Celestial azimuth mode needs shortest or unwrapped');
    const entries = Array.from(keys, (entry, i) => {
      object(entry, 'Celestial key');
      const at = number(entry.at, -1e9, 1e9, 'Celestial key time');
      if (i && at <= keys[i - 1].at) throw new RangeError('Celestial key times must increase');
      const ease = entry.ease ?? 'smooth';
      if (!Object.hasOwn(eases, ease)) throw new TypeError('Celestial ease needs linear, smooth or hold');
      return {
        at, easing:ease, ease: eases[ease],
        azimuth: number(entry.azimuth, -1e6, 1e6, 'Celestial azimuth'),
        elevation: number(entry.elevation, -pi / 2, pi / 2, 'Celestial elevation'),
        radius: number(entry.radius ?? base.radius, .00005, pi / 3, 'Celestial radius'),
        opacity: number(entry.opacity ?? base.opacity, 0, 1, 'Celestial opacity'),
        phase: number(entry.phase ?? base.phase, -1, 1, 'Lunar phase')
      };
    });
    const first = entries[0];
    if (period !== undefined) {
      number(period, .001, 1e9, 'Celestial period');
      const end = first.at + period, last = entries.at(-1);
      if (last.at > end) throw new RangeError('Celestial keys must fit within their period');
      if (last.at < end) entries.push({ ...first, at: end });
    }
    const key = ({ease,easing,...value}) => ({...value,ease:easing});
    return (seconds, trace) => {
      const t = period === undefined ? seconds : first.at + mod(seconds - first.at, period);
      let lo = 0, hi = entries.length - 1;
      if (trace) Object.assign(trace,{trackTime:t,period,azimuthMode});
      if (t <= first.at || t >= entries[hi].at) {
        const held = t <= first.at ? first : entries[hi];
        if (trace) Object.assign(trace,{keys:[key(held)],weight:0});
        return held;
      }
      while (hi - lo > 1) {
        const mid = (lo + hi) >>> 1;
        if (t < entries[mid].at) hi = mid;
        else lo = mid;
      }
      const a = entries[lo], b = entries[hi], progress = (t-a.at)/(b.at-a.at), w = a.ease(progress);
      if (trace) Object.assign(trace,{keys:[key(a),key(b)],progress,weight:w});
      const difference = b.azimuth - a.azimuth;
      const span = azimuthMode === 'unwrapped' ? difference : mod(difference + pi, tau) - pi;
      return { azimuth: a.azimuth + span * w, elevation: mix(a.elevation, b.elevation, w),
        radius: mix(a.radius, b.radius, w), opacity: mix(a.opacity, b.opacity, w), phase: mix(a.phase, b.phase, w) };
    };
  }

  function body(raw) {
    const { id, kind, target, start = -Infinity, end = Infinity } = object(raw, 'Celestial body');
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('A celestial body needs an ID');
    if (!Object.hasOwn(radii, kind)) throw new TypeError('Celestial kind needs sun, moon, star or eclipse');
    if (start !== -Infinity) number(start, -1e9, 1e9, 'Celestial start');
    if (end !== Infinity) number(end, -1e9, 1e9, 'Celestial end');
    if (end <= start) throw new RangeError('Celestial end must follow its start');
    const radius = number(raw.radius ?? radii[kind], .00005, pi / 3, 'Celestial radius');
    const opacity = number(raw.opacity ?? 1, 0, 1, 'Celestial opacity');
    const phase = number(raw.phase ?? 1, -1, 1, 'Lunar phase');
    const softness = number(raw.softness ?? .06, 0, 1, 'Celestial softness');
    const roll = number(raw.roll ?? 0, -1e6, 1e6, 'Lunar roll');
    const darkOpacity = number(raw.darkOpacity ?? .92, 0, 1, 'Lunar dark opacity');
    const distance = number(raw.distance ?? distances[kind] ?? 0, 0, 1e9, 'Celestial distance');
    const glow = number(raw.glow ?? 0, 0, 1, 'Celestial glow');
    const glowRadius = raw.glowRadius === undefined ? undefined : number(raw.glowRadius, .00005, pi / 2, 'Celestial glow radius');
    const tint = kind === 'eclipse' ? null : color(raw.color ?? colors[kind]);
    const dark = kind === 'moon' ? color(raw.darkColor ?? '#141b31') : null;
    const sample = motion(raw, { radius, opacity, phase });

    function frame(seconds, trace) {
      const sampled = sample(seconds,trace);
      const { azimuth: az, elevation: el, radius, phase } = sampled;
      const axis = Object.freeze(direction(az, el));
      const opacity = seconds >= start && seconds < end ? sampled.opacity : 0;
      const edge = Math.cos(radius), core = Math.cos(radius * (1 - softness));
      const haloEdge = Math.cos(glowRadius ?? Math.min(radius * 2.8, pi / 2));
      const right = [Math.cos(az), 0, -Math.sin(az)];
      const up = direction(az, el + pi / 2);
      const sinRadius = Math.sin(radius), angle = (1 - Math.abs(phase)) * pi;
      const lx = Math.cos(roll) * Math.sin(angle) * Math.sign(phase);
      const ly = Math.sin(roll) * Math.sin(angle) * Math.sign(phase);
      const lz = Math.cos(angle);
      return {
        pose: Object.freeze({ id, kind, target, direction: axis, radius, opacity, phase }),
        direction: axis, radius, opacity, color: tint,
        area(rayDot) {
          if (rayDot < edge) return 0;
          return core === edge ? 1 : smooth(clamp((rayDot - edge) / (core - edge)));
        },
        halo(rayDot) {
          return glow && rayDot > haloEdge ? opacity * glow * smooth((rayDot - haloEdge) / (1 - haloEdge)) : 0;
        },
        paint(ray, alpha, out) {
          if (kind !== 'moon') {
            for (let i = 0; i < 3; i++) out[i] = mix(out[i], tint[i], alpha);
            return;
          }
          const x = dot(ray, right) / sinRadius, y = dot(ray, up) / sinRadius;
          const z = Math.sqrt(Math.max(0, 1 - x*x - y*y));
          const illumination = phase === 0 ? 0 : Math.abs(phase) === 1 ? 1 : smooth(clamp((lx*x + ly*y + lz*z) * 40 + .5));
          const a = alpha * mix(darkOpacity, 1, illumination);
          for (let i = 0; i < 3; i++) out[i] = mix(out[i], mix(dark[i], tint[i], illumination), a);
        }
      };
    }
    return { id, kind, target, distance, frame };
  }

  function aboveHorizon(sun) {
    const height = clamp(Math.asin(clamp(sun.direction[1], -1, 1)) / sun.radius, -1, 1);
    return .5 + (Math.asin(height) + height * Math.sqrt(1 - height * height)) / pi;
  }

  // For directional lighting, approximate apparent coverage on the small-angle disk plane.
  function coverage(source, mask) {
    const a = source.radius, b = mask.radius, d = Math.acos(clamp(dot(source.direction, mask.direction), -1, 1));
    if (d >= a + b) return 0;
    if (d <= Math.abs(a - b)) return (Math.min(a, b) / a) ** 2;
    const x = (d*d + a*a - b*b) / (2*d), y = d - x;
    const area = a*a * Math.acos(clamp(x / a, -1, 1)) + b*b * Math.acos(clamp(y / b, -1, 1)) -
      d * Math.sqrt(Math.max(0, a*a - x*x));
    return clamp(area / (pi * a*a));
  }

  function compile(value) {
    if (value?.[compiled]) return value;
    const { bodies, primarySun } = object(value, 'Celestial tracks');
    if (!Array.isArray(bodies) || bodies.length > 1024) throw new TypeError('Celestial tracks need a bodies array of at most 1024');
    const tracks = Array.from(bodies, body), byId = new Map(tracks.map(track => [track.id, track]));
    if (byId.size !== tracks.length) throw new TypeError('Celestial body IDs must be unique');
    if (primarySun !== undefined && byId.get(primarySun)?.kind !== 'sun')
      throw new TypeError('Celestial primarySun must name a sun');
    for (const { kind, target } of tracks) {
      const targetKind = byId.get(target)?.kind;
      if (kind === 'eclipse' && targetKind !== 'sun' && targetKind !== 'moon')
        throw new TypeError('A celestial eclipse needs the ID of a target sun or moon');
    }
    const ordered = tracks.filter(track => track.kind !== 'eclipse').sort((a, b) => b.distance - a.distance);
    const replacesSun = ordered.some(track => track.kind === 'sun');

    function frame(seconds, inspect = false) {
      number(seconds, -1e12, 1e12, 'Celestial time');
      const report = inspect && [];
      const states = new Map(tracks.map(track => {
        const keys = inspect && {};
        const item = track.frame(seconds,keys);
        if (report) report.push({...item.pose,...keys});
        return [track.id,item];
      }));
      const masks = new Map();
      for (const { kind, id, target } of tracks) {
        if (kind !== 'eclipse') continue;
        const mask = states.get(id);
        if (!mask.opacity) continue;
        if (!masks.has(target)) masks.set(target, []);
        masks.get(target).push(mask);
      }
      const layers = ordered.map(track => ({ item: states.get(track.id), eclipses: masks.get(track.id) }))
        .filter(({ item }) => item.opacity);
      const primary = states.get(primarySun);
      const sun = primary && Object.freeze({ direction: primary.direction, color: primary.color,
        gain: (masks.get(primarySun) ?? []).reduce(
          (gain, mask) => gain * (1 - mask.opacity * coverage(primary, mask)), primary.opacity * aboveHorizon(primary)) });
      function shade(ray, out = [0, 0, 0]) {
        if (ray[1] < 0) return out;
        for (const { item, eclipses } of layers) {
          const angle = dot(ray, item.direction), halo = item.halo(angle);
          if (halo) for (let i = 0; i < 3; i++) out[i] = mix(out[i], item.color[i], halo);
          let alpha = item.opacity * item.area(angle);
          if (alpha && eclipses) for (const mask of eclipses) alpha *= 1 - mask.opacity * mask.area(dot(ray, mask.direction));
          if (alpha) item.paint(ray, alpha, out);
        }
        return out;
      }
      return Object.freeze({ replacesSun, sun, visible: layers.length > 0, body: id => states.get(id)?.pose, shade,
        ...(report && {tracks:report,primarySun}) });
    }
    return Object.freeze({ [compiled]: true, frame });
  }

  function settings(authored, override) {
    const source = override === true ? authored : override ?? authored;
    return source == null || source === false ? null : compile(source);
  }
  return Object.freeze({ compile, settings });
})();
if (typeof module !== 'undefined') module.exports = CelestialTracks;
