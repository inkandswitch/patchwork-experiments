// An authored world-space light track. Sampling is independent of playback history.
const Lightning = (() => {
  const brand = Symbol.for('ink-studio.lightning');
  const channel = (rgb, i) => (rgb >> (16 - i * 8) & 255) / 255;
  const clamp = value => Math.min(1, value);
  function finite(value, label, low = -Infinity, high = Infinity, includeLow = true) {
    if (!Number.isFinite(value) || (includeLow ? value < low : value <= low) || value >= high)
      throw new RangeError('Lightning ' + label + ' is out of range');
    return value;
  }

  function compile(source) {
    if (source?.[brand]) return source;
    if (!source || !Array.isArray(source.events)) throw new TypeError('Lightning needs an events array');
    const { events, cues = [] } = source;
    if (!Array.isArray(cues)) throw new TypeError('Lightning cues must be an array');
    const times = new Map();
    for (const cue of cues) {
      const [time, id] = Array.isArray(cue) ? cue : [cue?.time, cue?.id];
      if (cue?.enabled === false || typeof id !== 'string' || !Number.isFinite(time)) continue;
      const matches = times.get(id) ?? [];
      matches.push(time);
      times.set(id, matches);
    }
    const ids = new Set();
    const flashes = events.map(event => {
      if (!event || typeof event.id !== 'string' || !event.id.trim() || ids.has(event.id))
        throw new TypeError('Lightning needs unique event ids');
      const { id, cue, at, color = '#cfe6ff' } = event;
      ids.add(id);
      if (!Array.isArray(at) || at.length !== 3 || !Array.from(at).every(Number.isFinite))
        throw new TypeError('Lightning ' + id + ' needs a finite [x,y,z] position');
      let time = event.time;
      if (cue !== undefined) {
        if (time !== undefined) throw new TypeError('Lightning ' + id + ' must use either time or cue');
        if (typeof cue !== 'string' || !cue.trim()) throw new TypeError('Lightning ' + id + ' needs a cue id');
        const matches = times.get(cue);
        if (!matches?.length) throw new RangeError('Unknown lightning cue: ' + cue);
        if (matches.length !== 1) throw new RangeError('Ambiguous lightning cue: ' + cue);
        time = matches[0];
      }
      time = finite(time, id + ' time');
      const duration = finite(event.duration ?? .35, id + ' duration', 0, Infinity, false);
      const end = time + duration;
      if (!Number.isFinite(end) || end <= time) throw new RangeError('Lightning ' + id + ' duration cannot be resolved at its start time');
      const radius = finite(event.radius ?? 18, id + ' radius', 0, Infinity, false);
      const falloff = finite(event.falloff ?? 2, id + ' falloff', 0, Infinity, false);
      const intensity = finite(event.intensity ?? 2.5, id + ' intensity', 0);
      const attack = finite(event.attack ?? .08, id + ' attack', 0, 1);
      if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))
        throw new TypeError('Lightning ' + id + ' needs a #rrggbb color');
      const site = Object.freeze(at.slice());
      const marker = Object.freeze({ id, type: 'lightning', time, duration, at: site, ...(cue === undefined ? {} : { cue }) });
      const rgb = parseInt(color.slice(1), 16);
      const tint = [0, 1, 2].map(i => channel(rgb, i));
      return { marker, end, radius, falloff, intensity, attack, tint };
    }).sort((a, b) => a.marker.time - b.marker.time);
    const markers = Object.freeze(flashes.map(flash => flash.marker));

    function eventsBetween(from, to) {
      finite(from, 'cue range start');
      finite(to, 'cue range end');
      return markers.filter(event => event.time > from && event.time <= to);
    }

    function frame(time) {
      finite(time, 'sample time');
      const active = [];
      let step = Infinity;
      for (const flash of flashes) {
        if (flash.marker.time > time) break;
        if (time >= flash.end || !flash.intensity) continue;
        const phase = (time - flash.marker.time) / flash.marker.duration;
        const rise = flash.attack > 0 ? phase / flash.attack : 0;
        const envelope = phase < flash.attack ? rise * rise * (3 - 2 * rise) : ((1 - phase) / (1 - flash.attack)) ** 2;
        if (envelope > 0) {
          active.push({ ...flash, energy: envelope * flash.intensity });
          step = Math.min(step, flash.radius / 6);
        }
      }
      if (!active.length) return null;

      function light(x, y, z, normal) {
        let rgb;
        for (const flash of active) {
          const [fx, fy, fz] = flash.marker.at;
          const dx = fx - x, dy = fy - y, dz = fz - z, distance = Math.hypot(dx, dy, dz);
          if (distance >= flash.radius) continue;
          const facing = normal && distance > 0
            ? .12 + .88 * Math.max(0, (dx * normal[0] + dy * normal[1] + dz * normal[2]) / distance) : 1;
          const gain = flash.energy * (1 - distance / flash.radius) ** flash.falloff * facing;
          rgb ??= [0, 0, 0];
          for (let c = 0; c < 3; c++) rgb[c] += flash.tint[c] * gain;
        }
        return rgb;
      }

      function sky(origin, direction, out) {
        const [ox, oy, oz] = origin, [dx, dy, dz] = direction;
        for (const flash of active) {
          const [x, y, z] = flash.marker.at;
          const ax = x - ox, ay = y - oy, az = z - oz;
          const along = ax * dx + ay * dy + az * dz;
          if (along <= 0) continue;
          // The halo covers less sky from further away. Reflection rays query the same source.
          const distance = Math.hypot(ax - along * dx, ay - along * dy, az - along * dz);
          if (distance >= flash.radius) continue;
          const gain = .38 * flash.energy * flash.radius / (flash.radius + along) *
            (1 - distance / flash.radius) ** flash.falloff;
          for (let c = 0; c < 3; c++) out[c] = clamp(out[c] + flash.tint[c] * gain);
        }
        return out;
      }

      return { light, sky, step };
    }
    return Object.freeze({ [brand]: true, markers, eventsBetween, frame });
  }

  function settings(authored, override) {
    const source = override === true ? authored : override ?? authored;
    return !source ? null : compile(source);
  }

  return Object.freeze({ compile, settings, shade: (value, light) => clamp(value + (.08 + .92 * value) * light) });
})();
if (typeof module !== 'undefined') module.exports = Lightning;
