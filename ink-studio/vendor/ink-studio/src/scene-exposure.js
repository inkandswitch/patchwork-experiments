// World-space shelter shared by precipitation, outdoor lighting, fog and airflow.
const SceneExposure = (() => {
  const optics = typeof SceneOptics === 'undefined' ? require('./scene-optics.js') : SceneOptics;
  const brand = Symbol.for('ink-studio.scene-exposure');
  const channelDefaults = { rain:0, fog:.12, light:.25, wind:.08 };
  const number = (value, low, high, name) => {
    if (!Number.isFinite(value) || value < low || value > high) throw new RangeError(name + ' is out of range');
    return value;
  };
  const box = (zone, origin, direction, start, end, inset = 0) => {
    const range = [start, end];
    for (let axis = 0; axis < 3; axis++) {
      const low = zone.min[axis] + inset, high = zone.max[axis] - inset;
      if (!(low < high)) return null;
      if (Math.abs(direction[axis]) < 1e-10) {
        if (origin[axis] < low || origin[axis] > high) return null;
      } else if (!optics.slab(range, origin[axis], direction[axis], low, high)) return null;
    }
    return range;
  };

  function compile(value) {
    if (value?.[brand]) return value;
    if (!Array.isArray(value?.zones)) throw new TypeError('Scene exposure needs a zones array');
    const zones = Array.from(value.zones, (zone,index) => {
      const { min, max, fade = 1 } = zone ?? {};
      if (![min,max].every(p => Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isFinite)) ||
          min.some((n,i) => n >= max[i] || !Number.isFinite(max[i] - n)))
        throw new RangeError('Exposure zones need finite XYZ bounds with positive extent');
      number(fade, 0, Infinity, 'Exposure fade');
      return { index, id:typeof zone.id === 'string' ? zone.id : null, min:min.slice(), max:max.slice(), fade, ...Object.fromEntries(Object.entries(channelDefaults)
        .map(([key, fallback]) => [key, number(zone[key] ?? fallback, 0, 1, 'Exposure ' + key)])) };
    });
    const channels = {};
    function zoneGain(zone,key,x,y,z) {
      const {min,max,fade} = zone;
      const edge = Math.min(x-min[0],max[0]-x,y-min[1],max[1]-y,z-min[2],max[2]-z);
      if (edge < 0) return null;
      const u = key === 'rain' || !fade ? 1 : Math.min(1, edge / fade);
      return 1-(1-zone[key])*(u*u*(3-2*u));
    }
    const get = (key, candidates) => (x,y,z) => {
      let gain = 1;
      for (const zone of candidates) gain = Math.min(gain,zoneGain(zone,key,x,y,z) ?? 1);
      return gain;
    };
    const fogZones = zones.filter(zone => zone.fog < 1), dryZones = zones.filter(zone => zone.rain === 0);
    for (const key of Object.keys(channelDefaults)) {
      const candidates = key === 'fog' ? fogZones : zones.filter(zone => zone[key] < 1);
      if (candidates.length) channels[key] = get(key, candidates);
    }
    const rainBlocked = dryZones.length ? (from, to) => {
      const direction = to.map((n,i) => n-from[i]);
      return dryZones.some(zone => box(zone, from, direction, 0, 1));
    } : null;

    function fogDistance(origin, direction, start, end) {
      if (end <= start) return 0;
      const cuts = [];
      for (const zone of fogZones) {
        const outer = box(zone, origin, direction, start, end);
        if (!outer) continue;
        cuts.push(...outer);
        if (zone.fade) {
          const core = box(zone, origin, direction, outer[0], outer[1], zone.fade);
          if (core) cuts.push(...core);
        }
      }
      if (!cuts.length) return end-start;
      cuts.push(start, end);
      cuts.sort((a,b) => a-b);
      let distance = 0;
      for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i-1], length = cuts[i] - lo;
        if (!length) continue;
        // Sample within each boundary span, including narrow sheltered cores.
        for (let j = 0; j < 4; j++) {
          const t = lo + length * (j+.5)/4;
          distance += length/4 * channels.fog(origin[0]+direction[0]*t, origin[1]+direction[1]*t, origin[2]+direction[2]*t);
        }
      }
      return distance;
    }

    function sample(x,y,z) {
      return Object.fromEntries(Object.keys(channelDefaults).map(key => [key, channels[key]?.(x,y,z) ?? 1]));
    }
    function inspect(x,y,z) {
      const local = zones.flatMap(zone => {
        const gains = Object.fromEntries(Object.keys(channelDefaults).map(key=>[key,zoneGain(zone,key,x,y,z)]));
        return gains.rain === null ? [] : [{index:zone.index,id:zone.id,min:zone.min.slice(),max:zone.max.slice(),fade:zone.fade,gains}];
      });
      return { gains:sample(x,y,z),zones:local };
    }
    return Object.freeze({ [brand]:true, ...channels, sample, inspect, rainBlocked,
      fogDistance: channels.fog ? fogDistance : null });
  }

  function settings(authored, override) {
    const source = override === true ? authored : override ?? authored;
    return !source ? null : compile(source);
  }

  return Object.freeze({ compile, settings });
})();
if (typeof module !== 'undefined') module.exports = SceneExposure;
