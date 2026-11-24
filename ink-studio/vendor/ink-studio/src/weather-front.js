/* A moving XZ profile influence with a feathered edge. */
const WeatherFront = (() => {
  const mix = (a,b,u) => a + (b-a)*u;
  const smooth = u => u*u*(3-2*u);
  const easing = { linear:u => u, smooth, hold:() => 0 };
  const point = (p,name) => {
    if (!Array.isArray(p) || p.length !== 2 || !Array.from(p).every(Number.isFinite))
      throw new TypeError(name + ' must be a finite XZ pair');
    return p.slice();
  };
  function compile(list = []) {
    if (!Array.isArray(list)) throw new TypeError('Weather fronts must be an array');
    const ids = new Set();
    return Array.from(list, raw => {
      if (!raw || ![Object.prototype,null].includes(Object.getPrototypeOf(raw)))
        throw new TypeError('Weather front must be an object');
      const { id, profile, radius, feather = .4, route, loop = false } = raw;
      if (typeof id !== 'string' || !id.trim() || ids.has(id) || typeof profile !== 'string' || !profile.trim() ||
          !Number.isFinite(feather) || feather < 0 || feather > 1 || !Array.isArray(route) || !route.length ||
          typeof loop !== 'boolean')
        throw new TypeError('Weather front needs a unique ID, profile, feather and timed route');
      ids.add(id);
      const reach = point(typeof radius === 'number' ? [radius,radius] : radius, 'Weather front radius');
      if (reach.some(n => n <= 0)) throw new RangeError('Weather front radii must be positive');
      const keys = Array.from(route, (key,i) => {
        const { at, xz, ease = 'linear' } = key ?? {};
        if (!Number.isFinite(at) || (i && (!(at > route[i-1]?.at) || !Number.isFinite(at - route[i-1].at))) ||
            !Object.hasOwn(easing,ease))
          throw new RangeError('Weather front route needs increasing finite times and valid easing');
        return { at, xz:point(xz,'Weather front waypoint'), ease:easing[ease], easing:ease };
      });
      const first = keys[0], last = keys.at(-1), duration = last.at - first.at;
      if (loop && (!(duration > 0 && Number.isFinite(duration)) || first.xz.some((n,i) => n !== last.xz[i])))
        throw new RangeError('A looping weather front needs a timed route with matching endpoints');
      const waypoint = ({at,xz}) => ({at,xz:xz.slice()});
      function center(seconds, trace) {
        const t = loop ? first.at + (((seconds - first.at) % duration) + duration) % duration : seconds;
        if (trace) Object.assign(trace,{routeTime:t,loop});
        if (t <= first.at || t >= last.at) {
          const key = t <= first.at ? first : last;
          if (trace) Object.assign(trace,{keys:[waypoint(key)],weight:0});
          return key.xz.slice();
        }
        let lo = 0, hi = keys.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >>> 1;
          if (keys[mid].at <= t) lo = mid;
          else hi = mid;
        }
        const a = keys[lo], b = keys[hi], progress = (t-a.at)/(b.at-a.at), u = a.ease(progress);
        if (trace) Object.assign(trace,{keys:[waypoint(a),waypoint(b)],ease:a.easing,progress,weight:u});
        return [mix(a.xz[0],b.xz[0],u),mix(a.xz[1],b.xz[1],u)];
      }
      function influence(cx,cz,x,z) {
        const u = (x-cx)/reach[0], v = (z-cz)/reach[1], radius2 = u*u + v*v;
        if (radius2 >= 1) return 0;
        return feather ? smooth(Math.min(1,(1-Math.sqrt(radius2))/feather)) : 1;
      }
      function frame(seconds) {
        const [cx,cz] = center(seconds);
        return (x,z) => influence(cx,cz,x,z);
      }
      function inspect(seconds) {
        const route = {}, at = center(seconds,route);
        return {center:at,radius:reach.slice(),feather,route};
      }
      return { id, profile, frame, inspect, step:Math.max(.001,Math.min(...reach)*Math.max(.1,feather)*.4) };
    });
  }
  return Object.freeze({ compile });
})();
if (typeof module !== 'undefined') module.exports = WeatherFront;
