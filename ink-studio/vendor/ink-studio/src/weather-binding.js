/* Environment tracks drive both rendered weather and retained surface forcing. */
const WeatherBinding = (() => {
  const Front = typeof WeatherFront === 'undefined' ? require('./weather-front.js') : WeatherFront;
  const outside = { rain:0, snowfall:0, air:10, humidity:.44, windX:0, windZ:0, windGust:1, fogDensity:1, wetness:0, light:0 };
  const velocity = ({ windX, windZ }) =>
    windX === undefined && windZ === undefined ? undefined : [windX ?? 0, windZ ?? 0];
  const defaults = {
    rain: 'rain', snowfall: 'snowfall', air: 'airTemperature', humidity: 'humidity',
    windX: 'windX', windZ: 'windZ', windGust: 'windGust', fogDensity: 'fogDensity', wetness: 'surfaceWetness', light: 'daylight'
  };
  const ranges = {
    rain: [0,1000], snowfall: [0,1000], air: [-240,500], humidity: [0,1],
    windX: [-20,20], windZ: [-20,20], windGust: [0,3], fogDensity: [0,64], wetness: [0,1], light: [0,1]
  };
  function record(value, name) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError(name + ' must be an object');
    return value;
  }
  function number(value, min, max, name) {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new RangeError(name + ' must be in [' + min + ', ' + max + ']');
    return value;
  }

  function settings(value, override) {
    if (override === false || (override === undefined && (value === false || value === undefined))) return null;
    const read = raw => raw === undefined || raw === true || raw === false ? {} : record(raw, 'Weather binding');
    const base = read(value), edits = read(override);
    let surface = edits.surface === undefined ? base.surface : edits.surface;
    if (base.surface && edits.surface && typeof base.surface === 'object' && typeof edits.surface === 'object') {
      const original = record(base.surface, 'Weather surface'), modified = record(edits.surface, 'Weather surface');
      surface = { ...original, ...modified };
      if (original.standingWater && modified.standingWater && typeof original.standingWater === 'object' &&
          typeof modified.standingWater === 'object')
        surface.standingWater = { ...record(original.standingWater, 'Standing water'),
          ...record(modified.standingWater, 'Standing water') };
    }
    const { rainFull = 1, snowFull = 1, windDryingSpeed = 5, fogVolumes, fronts } = { ...base, ...edits };
    const channels = { ...base.channels, ...edits.channels };
    for (const raw of [base, edits]) {
      if (Object.keys(raw).some(key => !['channels', 'rainFull', 'snowFull', 'windDryingSpeed', 'fogVolumes', 'surface', 'fronts'].includes(key)))
        throw new RangeError('Unknown weather binding setting');
      if (raw.channels !== undefined) record(raw.channels, 'Weather channels');
    }
    for (const [key, channel] of Object.entries(channels)) {
      if (!Object.hasOwn(defaults, key) || (channel !== false && (typeof channel !== 'string' || !channel.trim())))
        throw new TypeError('Invalid weather channel binding for ' + key);
    }
    number(rainFull, 1e-6, 1000, 'Full visual rain rate');
    number(snowFull, 1e-6, 1000, 'Full visual snow rate');
    number(windDryingSpeed, 1e-6, 1000, 'Wind drying speed');
    if (fogVolumes !== undefined && (!Array.isArray(fogVolumes) ||
        !Array.from(fogVolumes).every(id => typeof id === 'string' && id.trim())))
      throw new TypeError('Weather fog volumes must be a list of volume IDs');
    let retained;
    if (surface !== undefined && surface !== false) {
      const { step = .125, forcing, ...options } = record(surface, 'Weather surface');
      number(step, .001, 3, 'Weather surface step');
      if (forcing !== undefined && typeof forcing !== 'function')
        throw new TypeError('Weather surface forcing must be a function');
      retained = { step, forcing, options };
    }
    return { channels, rainFull, snowFull, windDryingSpeed, fogVolumes: fogVolumes && new Set(fogVolumes), fronts: Front.compile(fronts), surface: retained };
  }

  function bind(environment, config, { profiles, createSurface, frontsEnabled = true } = {}) {
    if (!config) return null;
    if (!environment?.sample) throw new TypeError('Weather binding needs a sky environment');
    const pins = profiles === undefined ? undefined : Object.freeze({ ...profiles });
    const { channels, rainFull, snowFull, windDryingSpeed, fogVolumes, fronts, surface } = config;
    const keys = Object.keys(defaults);
    function read(parameters) {
      const signal = {};
      for (const key of keys) {
        const channel = channels[key] ?? defaults[key];
        if (channel === false) continue;
        if (Object.hasOwn(parameters, channel)) signal[key] = number(parameters[channel], ...ranges[key], 'Weather ' + channel);

      }
      return { ...signal, wind:velocity(signal) };
    }
    const uniform = time => read(environment.sample(time, pins));
    const authored = fronts.map(front => ({ ...front, target:read(environment.profile(front.profile)) }));
    const base = uniform(0);
    for (const [key, channel] of Object.entries(channels))
      if (channel !== false && base[key] === undefined && authored.every(front => front.target[key] === undefined))
        throw new RangeError('Missing weather channel ' + channel);
    const active = frontsEnabled ? authored : [];
    function spatial(time, signal = uniform(time)) {
      const layers = active.map(front => ({ front, weight:front.frame(time), target:front.target }));
      function value(key, x, z, fallback = signal[key]) {
        for (const { weight, target } of layers) {
          if (target[key] === undefined) continue;
          const amount = weight(x,z);
          if (amount) {
            const base = fallback ?? outside[key];
            fallback = base + (target[key] - base)*amount;
          }
        }
        return fallback;
      }
      function at(x,z, trace) {
        const local = { ...signal };
        for (const { front, weight, target } of layers) {
          const amount = weight(x,z);
          const changes = trace && Object.create(null);
          if (amount) for (const key of keys) if (target[key] !== undefined) {
            const base = local[key] ?? outside[key];
            local[key] = base + (target[key] - base)*amount;
            if (changes) changes[key] = {from:base,to:target[key],value:local[key]};
          }
          if (trace) trace.push({id:front.id,profile:front.profile,weight:amount,...front.inspect(time),channels:changes});
        }
        local.wind = velocity(local);
        return local;
      }
      return { at, value };
    }
    function sample(time, x, z) {
      if (!active.length || (x === undefined && z === undefined)) return uniform(time);
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Weather position must be a finite XZ pair');
      return spatial(time).at(x,z);
    }

    const forcingValues = ({ rain, snowfall, air, humidity, light, wind }) => ({
      rain, snowfall, air, humidity, light, wind:wind && Math.min(1, Math.hypot(...wind)/windDryingSpeed)
    });

    function forcing(local) {
      if (local !== undefined && typeof local !== 'function') throw new TypeError('Weather forcing must be a function');
      let lastTime, signal, values, region;
      return (x, z, time, state) => {
        if (time !== lastTime) {
          signal = uniform(time);
          region = active.length ? spatial(time,signal) : null;
          values = forcingValues(signal);
          lastTime = time;
        }
        const input = region ? region.at(x,z) : signal;
        const forced = region ? forcingValues(input) : values;
        return local ? { ...forced, ...local(x, z, time, state, input) } : forced;
      };
    }
    let solver, snapshot, tick = 0;
    const input = surface && forcing(surface.forcing);
    function surfaceAt(time) {
      if (!surface) return undefined;
      if (!Number.isFinite(time)) throw new RangeError('Weather time must be finite');
      // Anchor each integration to the same fixed ticks for sequential renders and random seeks.
      const target = Math.max(0, Math.floor(time / surface.step + 1e-9));
      if (!Number.isSafeInteger(target) || target - (target < tick ? 0 : tick) > 16384)
        throw new RangeError('Weather seek exceeds the surface integration budget');
      if (!solver || target < tick) {
        solver = createSurface(surface.options);
        snapshot = solver.snapshot();
        tick = 0;
      }
      while (tick < target) {
        snapshot = solver.step(surface.step, { forcing: input });
        tick++;
      }
      return snapshot;
    }
    function surfaceCheckpoint() {
      return solver && { tick, step:surface.step, state:solver.checkpoint() };
    }
    function restoreSurface(checkpoint) {
      const expectedTime = checkpoint?.tick * surface?.step;
      if (!surface || !Number.isSafeInteger(checkpoint?.tick) || checkpoint.tick < 0 ||
          checkpoint.step !== surface.step || !Number.isFinite(checkpoint.state?.time) ||
          Math.abs(checkpoint.state.time - expectedTime) > Math.max(1, expectedTime) * 1e-8)
        throw new TypeError('Invalid retained weather checkpoint');
      const restored = createSurface(surface.options);
      snapshot = restored.restore(checkpoint.state);
      tick = checkpoint.tick;
      solver = restored;
    }
    const fogFronts = active.filter(front => front.target.fogDensity !== undefined);
    const fogStep = fogFronts.length ? Math.min(...fogFronts.map(front => front.step)) : 0;
    const localWind = active.some(front => front.target.wind);
    const localGust = active.some(front => front.target.windGust !== undefined);
    const localWetness = active.some(front => front.target.wetness !== undefined);
    function frame(time, parameters, { retained = true } = {}) {
      const signal = parameters ? read(parameters) : uniform(time);
      const state = retained ? surfaceAt(time) : undefined;
      const region = active.length ? spatial(time,signal) : null;
      const history = region && new Map([[time,region]]);
      const at = t => {
        if (!history.has(t)) {
          if (history.size >= 512) history.delete(history.keys().next().value);
          history.set(t,spatial(t));
        }
        return history.get(t);
      };
      const rainGain = value => Math.min(1, (value ?? 0)/rainFull);
      const snowGain = value => Math.min(1, (value ?? 0)/snowFull);
      const wetness = signal.wetness;
      return { ...signal, rainGain:rainGain(signal.rain), snowGain:snowGain(signal.snowfall),
        rainAt: (t,x,z) => rainGain(region && Number.isFinite(x) && Number.isFinite(z)
          ? at(t).value('rain',x,z) : uniform(t).rain),
        rainHere: region && ((x,z) => rainGain(region.value('rain',x,z))),
        snowHere: region && ((x,z) => snowGain(region.value('snowfall',x,z))),
        windAt: signal.wind && (t => uniform(t).wind),
        gustAt: signal.windGust !== undefined ? (t => uniform(t).windGust) : undefined,
        gustHere: localGust ? (t,x,z) => at(t).value('windGust',x,z) ?? 1 : undefined,
        windHere: localWind ? (t,x,z,fallback) => {
          const field = at(t);
          return [field.value('windX',x,z, fallback[0]),field.value('windZ',x,z, fallback[1])];
        } : undefined,
        fogGain(volume) {
          if (fogVolumes && !fogVolumes.has(volume.id)) return 1;
          if (fogStep) return { step:fogStep, sample:(x,z) => region.value('fogDensity',x,z) ?? 1 };
          return signal.fogDensity ?? 1;
        },
        surface: state || wetness !== undefined || localWetness ? (x, z) => {
          const point = state?.sample(x, z);
          if (state && !point) return null;
          const local = localWetness ? region.value('wetness',x,z) : wetness;
          if (local === undefined) return point;
          return { ...point, wetness: Math.max(local, point?.wetness ?? 0) };
        } : undefined };
    }
    function inspect(time,x,z,parameters) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('Weather position must be a finite XZ pair');
      const global = parameters ? read(parameters) : uniform(time), fronts = [];
      const local = spatial(time,global).at(x,z,fronts);
      return { channels:{...defaults,...channels}, global, local, frontsEnabled,
        fronts, rainGain:Math.min(1,(local.rain ?? 0)/rainFull), snowGain:Math.min(1,(local.snowfall ?? 0)/snowFull) };
    }
    return Object.freeze({ sample, forcing, frame, surfaceAt, surfaceCheckpoint, restoreSurface, inspect });
  }

  return Object.freeze({ settings, bind });
})();
if (typeof module !== 'undefined') module.exports = WeatherBinding;
