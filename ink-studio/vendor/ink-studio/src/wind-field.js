/* Shared open-air gusts and geometry-driven shelter. */
const WindField = (() => {
  const air = typeof Airflow === 'undefined' ? require('./airflow.js') : Airflow;
  const calm = Object.freeze([0,0]);
  const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
  const smooth = n => n*n*(3-2*n);
  const record = (value,name) => {
    if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
      throw new TypeError(name + ' must be an object');
    return value;
  };
  const number = (n,a,b,name) => {
    if (!Number.isFinite(n) || n < a || n > b) throw new RangeError(name + ' is out of range');
    return n;
  };
  function settings(authored, override) {
    if (override === false || (override === undefined && (authored === false || authored === undefined))) return null;
    const read = value => value === undefined || typeof value === 'boolean' ? {} : record(value,'Wind field');
    const base = read(authored), edits = read(override), merged = { ...base, ...edits };
    for (const key of ['gust','shelter'])
      if (base[key] && edits[key] && typeof base[key] === 'object' && typeof edits[key] === 'object')
        merged[key] = { ...record(base[key],key), ...record(edits[key],key) };
    if (Object.keys(merged).some(key => !['velocity','gust','shelter','clouds'].includes(key)))
      throw new RangeError('Unknown wind field setting');
    const { velocity, gust, shelter, clouds = 1 } = merged;
    const fallback = velocity === undefined ? undefined : air.frame(velocity).velocity;
    if (clouds !== false) number(clouds,0,20,'Cloud wind scale');
    const authoredGust = gust === undefined || gust === false ? {} : record(gust,'Wind gust');
    const { amplitude=0, period=3, phase=0 } = authoredGust;
    number(amplitude,0,1,'Gust amplitude');
    number(period,.01,1e6,'Gust period');
    number(phase,-1e6,1e6,'Gust phase');
    let cover = null;
    if (shelter !== false && shelter !== undefined) {
      const { occluder, reach=7, strength=.85, spread=.18, spacing=.28 } = record(shelter,'Wind shelter');
      if (typeof occluder !== 'function') throw new TypeError('Wind shelter needs a geometry occluder');
      number(reach,.01,1000,'Shelter reach');
      number(strength,0,1,'Shelter strength');
      number(spread,0,100,'Shelter spread');
      number(spacing,.01,100,'Shelter spacing');
      if (strength) cover = { occluder, reach, strength, spread, spacing };
    }
    return { fallback, amplitude, period, phase, cover, clouds };
  }

  function create(config, { ambient = () => config.fallback ?? calm, local, gust, localGust, exposure } = {}) {
    if ([ambient,local,gust,localGust].some(source => source !== undefined && typeof source !== 'function'))
      throw new TypeError('Wind sources must be functions');
    const { amplitude, period, phase, cover } = config;
    const cells = new Map(), timeline = new Map();
    let lastTime, current;
    function at(time) {
      if (!Number.isFinite(time)) throw new TypeError('Wind time must be finite');
      if (lastTime !== time) {
        if (!timeline.has(time)) {
          if (timeline.size >= 512) timeline.delete(timeline.keys().next().value);
          timeline.set(time,{
            open:air.frame(ambient(time) ?? config.fallback ?? calm).velocity,
            gust:number(gust?.(time) ?? 1,0,3,'Profile wind gust'),
            wave:1 + amplitude * Math.sin(time * Math.PI * 2 / period + phase)
          });
        }
        current = timeline.get(time);
        lastTime = time;
      }
      return current;
    }
    function open(time=0) {
      const state = at(time);
      return state.open.map(n => clamp(n*state.gust*state.wave,-20,20));
    }
    function shelter(x,y,z,vx,vz) {
      if (!cover || Math.hypot(vx,vz) < 1e-6) return 1;
      const { occluder, reach, strength, spread, spacing } = cover;
      const ix = Math.round(x/spacing), iy = Math.round(y/spacing), iz = Math.round(z/spacing);
      const sector = Math.round(Math.atan2(vz,vx) * 36 / Math.PI);
      const key = ix + '/' + iy + '/' + iz + '/' + sector;
      if (cells.has(key)) return cells.get(key);
      const angle = sector * Math.PI / 36, dx = -Math.cos(angle), dz = -Math.sin(angle);
      const direction = [dx,0,dz];
      function blockage(offset) {
        const px = ix*spacing - dz*offset, py = iy*spacing, pz = iz*spacing + dx*offset;
        let hit;
        if (typeof occluder.hitDistance === 'function') hit = occluder.hitDistance(px,py,pz,direction,reach);
        else {
          if (!occluder(px,py,pz,direction,reach)) return 0;
          let lo = 0, hi = reach;
          for (let i=0;i<3;i++) {
            const mid = (lo+hi)*.5;
            if (occluder(px,py,pz,direction,mid)) hi = mid;
            else lo = mid;
          }
          hit = (lo+hi)*.5;
        }
        return Number.isFinite(hit) ? 1-smooth(clamp(hit/reach,0,1)) : 0;
      }
      const center = blockage(0);
      const blocked = spread ? .5*center + .25*(blockage(-spread)+blockage(spread)) : center;
      const gain = 1 - strength*blocked;
      if (cells.size >= 65536) cells.clear();
      cells.set(key,gain);
      return gain;
    }
    function unmasked(x,y,z,time=0,trace) {
      if (![x,y,z].every(Number.isFinite)) throw new TypeError('Wind position must be finite XYZ');
      const state = at(time);
      const candidate = local?.(time,x,z,state.open);
      const [xWind,zWind] = candidate == null ? state.open : air.frame(candidate).velocity;
      const gustStrength = localGust ? number(localGust(time,x,z) ?? state.gust,0,3,'Local wind gust') : state.gust;
      const multiplier = gustStrength*state.wave;
      const vx = clamp(xWind*multiplier,-20,20), vz = clamp(zWind*multiplier,-20,20);
      const gain = shelter(x,y,z,vx,vz);
      if (trace) Object.assign(trace,{ambient:state.open.slice(),regional:[xWind,zWind],gust:gustStrength,wave:state.wave,shelterGain:gain});
      return [vx*gain,vz*gain];
    }
    const attenuate = (velocity,x,y,z,trace) => {
      const scale = exposure?.wind?.(x,y,z) ?? 1;
      if (trace) trace.exposureGain = scale;
      return scale === 1 ? velocity : [velocity[0]*scale,velocity[1]*scale];
    };
    function sample(x,y,z,time=0) {
      return attenuate(unmasked(x,y,z,time),x,y,z);
    }
    function inspect(x,y,z,time) {
      const trace = {};
      const velocity = attenuate(unmasked(x,y,z,time,trace),x,y,z,trace);
      return { ...trace,velocity };
    }
    function integrate(from,to,velocity) {
      if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(to-from))
        throw new RangeError('Wind travel needs finite times');
      if (to === from) return [0,0];
      const steps = Math.max(1,Math.min(256,Math.ceil(Math.abs(to-from)*16)));
      const dt = (to-from)/steps;
      let x=0,z=0;
      for (let i=0;i<steps;i++) {
        const v = velocity(from+(i+.5)*dt);
        x += v[0]*dt;
        z += v[1]*dt;
      }
      return [x,z];
    }
    function travel(x,y,z,from,to) {
      return integrate(from,to,time => sample(x,y,z,time));
    }
    function frame(time) {
      const offsets = new Map();
      const spacing = cover?.spacing ?? .35;
      const windOffset = cover || local || localGust ? (x,y,z) => {
        const ix = Math.round(x/spacing), iy = Math.round(y/spacing), iz = Math.round(z/spacing);
        const key = ix + '/' + iy + '/' + iz;
        if (!offsets.has(key)) offsets.set(key,integrate(0,time,t => unmasked(ix*spacing,iy*spacing,iz*spacing,t)));
        return offsets.get(key);
      } : (() => {
        const shift = integrate(0,time,open);
        return () => shift;
      })();
      return { windOffset: exposure?.wind ? (x,y,z) => attenuate(windOffset(x,y,z),x,y,z) : windOffset };
    }
    return Object.freeze({ open, sample, inspect, travel, frame,
      cloudTravel:(from,to) => integrate(from,to,open),
      xyz(x,y,z,time) { const [vx,vz] = sample(x,y,z,time); return [vx,0,vz]; }
    });
  }

  return Object.freeze({ settings, create });
})();
if (typeof module !== 'undefined') module.exports = WindField;
