/* Camera-independent sky profiles and their directional radiance sampler. */
const SkyEnvironment = (() => {
  let color, paletteFields;
  try {
    color = ColorSpace;
    paletteFields = PaletteFields;
  } catch {
    color = require('./color-space.js');
    paletteFields = require('./palette-fields.js');
  }
  const palettes = typeof AtmospherePalette === 'undefined' ? require('./atmosphere-palette.js') : AtmospherePalette;
  const decode = color.prepare('srgb', 'srgb-linear'), encode = color.prepare('srgb-linear', 'srgb');
  const TAU = Math.PI * 2, transitionLimit = 2048;
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const mod = (n, period) => {
    const remainder = n % period;
    return remainder < 0 ? remainder + period : remainder;
  };
  const own = (value, key) => Object.hasOwn(value, key);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const record = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(name + ' needs an object');
    return value;
  };
  const list = (value, size, name) => {
    if (!Array.isArray(value) || value.length > size) throw new TypeError(name + ' needs an array of at most ' + size);
    return value;
  };
  const text = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' needs a name');
    return value;
  };
  const bounded = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(name + ' is out of range');
    return v;
  };
  const vector = (value, size, name) => {
    if (!Array.isArray(value) || value.length !== size || !Array.from(value).every(Number.isFinite))
      throw new TypeError(name + ' needs ' + size + ' finite numbers');
    return value.slice();
  };
  const rgb = value => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Expected #rrggbb');
    return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  };
  const direction = (azimuth, elevation) => [
    Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)
  ];
  const colorChannels = ['zenith', 'horizon', 'ground', 'sunColor', 'overcastColor'];
  const ranges = { daylight: [0, 1], sunAzimuth: [-1e6, 1e6], sunAltitude: [-Math.PI/2, Math.PI/2],
    sunSize: [.001, .3], sunStrength: [0, 8], overcast: [0, 1],
    aerialStart: [0, 1e6], aerialDensity: [0, 64], aerialContrast: [0, 1],
    cloudShadowStrength: [0, 1], cloudShadowSoftness: [0, 1000] };
  const base = Object.freeze({
    zenith: '#234a80', horizon: '#aec5cc', ground: '#263442', sunColor: '#ffe7be',
    sunAzimuth: 2.8, sunAltitude: .36, sunSize: .022, sunStrength: .6, orthoFov: 38
  });
  const easings = Object.freeze({ linear: t => t, smooth: t => t * t * (3 - 2 * t), hold: () => 0 });
  const compiled = Symbol.for('ink-studio.sky-environment');

  function parameters(value, name) {
    return Object.fromEntries(Object.entries(record(value, name)).map(([key, v]) => {
      if (typeof v === 'string' && !own(ranges, key)) return [key, decode(rgb(v))];
      if (colorChannels.includes(key)) throw new TypeError(key + ' needs a hex colour');
      const [lo, hi] = own(ranges, key) ? ranges[key] : [-1e6, 1e6];
      return [key, bounded(v, lo, hi, key)];
    }));
  }
  function compatible(a, b) {
    return Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every(key => own(b, key) && typeof a[key] === typeof b[key]);
  }
  function blendValue(key, a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    if (Array.isArray(a)) return a.map((channel,i) => mix(channel,b[i],t));
    const target = key === 'sunAzimuth' ? a + mod(b-a+Math.PI,TAU) - Math.PI : b;
    return mix(a,target,t);
  }
  function blend(a, b, t) {
    return Object.fromEntries(Object.entries(a).map(([key, value]) => [key,blendValue(key,value,b[key],t)]));
  }

  function previous(keys, seconds) {
    let low = 0, high = keys.length;
    while (low < high) {
      const mid = (low+high) >>> 1;
      if (keys[mid].at <= seconds) low = mid+1;
      else high = mid;
    }
    return keys[low-1];
  }

  function atTransition(key, segment, seconds) {
    if (seconds >= segment.end) return segment.to;
    const progress = clamp((seconds-segment.at)/segment.duration);
    return blendValue(key,segment.from,segment.to,segment.ease(progress));
  }
  function sequence(value, profiles, id) {
    const { keys, duration, loop = true } = record(value, 'Sequence ' + id);
    bounded(duration, Number.MIN_VALUE, 1e9, 'Sequence duration');
    if (typeof loop !== 'boolean') throw new TypeError('Sequence loop must be boolean');
    const entries = list(keys, 2048, 'Sequence keys').map((key, i) => {
      const { at, profile, ease = 'smooth' } = record(key, 'Sequence key');
      if (!Number.isFinite(at) || (i === 0 ? at !== 0 : at <= keys[i - 1].at) || at >= duration)
        throw new RangeError('Sequence keys must start at zero and increase before the duration');
      if (!profiles.has(profile) || !own(easings, ease)) throw new RangeError('Unknown profile or easing in ' + id);
      return { at, name:profile, profile: profiles.get(profile), ease: easings[ease], easing:ease };
    });
    if (!entries.length || entries.some(key => !compatible(key.profile, entries[0].profile)))
      throw new TypeError('Profiles in ' + id + ' must define the same parameter names and types');
    const start = entries[0].profile;
    if (loop) entries.push({ at: duration, name:entries[0].name, profile: start });
    function sample(seconds, trace) {
      const t = loop ? mod(seconds, duration) : clamp(seconds, 0, duration);
      let lo = 0, hi = entries.length - 1;
      if (trace) Object.assign(trace,{ sequenceTime:t,duration,loop });
      if (t >= entries[hi].at) {
        const key = entries[hi];
        if (trace) Object.assign(trace,{ keys:[{at:key.at,profile:key.name}],weight:0 });
        return key.profile;
      }
      while (hi - lo > 1) {
        const i = (lo + hi) >>> 1;
        if (t < entries[i].at) hi = i;
        else lo = i;
      }
      const a = entries[lo], b = entries[hi], progress = (t-a.at)/(b.at-a.at), weight = a.ease(progress);
      if (trace) Object.assign(trace,{keys:[{at:a.at,profile:a.name},{at:b.at,profile:b.name}],ease:a.easing,progress,weight});
      return blend(a.profile,b.profile,weight);
    }
    return { start, sample };
  }

  function compile(value = {}) {
    if (value?.[compiled] === true) return value;
    const { defaults = {}, profiles = {}, sequences = {}, tracks = [], sky = {}, transitions = [] } = record(value, 'Sky environment');
    const initial = parameters(defaults, 'Defaults');
    const looks = new Map(Object.entries(record(profiles, 'Profiles')).map(([id, params]) => [id, parameters(params, id)]));
    const clips = new Map(Object.entries(record(sequences, 'Sequences')).map(([id, clip]) => [id, sequence(clip, looks, id)]));
    const ids = new Set(), channelTypes = Object.assign(Object.create(null), initial);
    const schedule = list(tracks, 128, 'Tracks').map(value => {
      const { id, sequence: name, offset = 0, speed = 1 } = record(value, 'Track');
      text(id, 'Track ID');
      if (ids.has(id) || !clips.has(name)) throw new RangeError('Duplicate track or missing sequence: ' + id);
      ids.add(id);
      const clip = clips.get(name);
      for (const [key, channel] of Object.entries(clip.start)) {
        if (own(channelTypes, key) && typeof channelTypes[key] !== typeof channel)
          throw new TypeError(key + ' changes type across tracks');
        channelTypes[key] = channel;
      }
      return { id, name, clip, offset: bounded(offset, -1e9, 1e9, 'Track offset'), speed: bounded(speed, -1e6, 1e6, 'Track speed') };
    });
    function binding(name, type) {
      if (name === undefined) return;
      if (typeof name !== 'string' || !own(channelTypes, name) || typeof channelTypes[name] !== type)
        throw new TypeError('Missing ' + type + ' parameter ' + name);
      return name;
    }
    function gainBinding(name) {
      const key = binding(name, 'number');
      if (key !== undefined && [initial, ...looks.values()].some(p => own(p, key) && p[key] < 0))
        throw new RangeError('Gain parameter ' + key + ' must be nonnegative');
      return key;
    }
    const common = raw => ({ id: text(raw.id, 'Layer ID'), opacity: bounded(raw.opacity ?? 1, 0, 1, 'Layer opacity'),
      gain: gainBinding(raw.gain), tint: binding(raw.tint, 'object') });
    const layerIds = new Set();
    function unique(raw) {
      const layer = common(raw);
      if (layerIds.has(layer.id)) throw new RangeError('Duplicate environment layer: ' + layer.id);
      layerIds.add(layer.id);
      return layer;
    }
    function widths(raw, limit) {
      const size = vector(raw.size, 2, 'Layer size');
      return size.map(n => bounded(n, 1e-5, limit, 'Layer size'));
    }
    function skyRamp(value) {
      if (value === undefined || value === false) return;
      if (Object.keys(record(value, 'Sky palette ramp')).some(key => !['ramp','axis','domain','strength','gain'].includes(key)))
        throw new TypeError('Sky palette ramps need ramp, axis, domain, strength and gain controls');
      const { ramp, axis = 'elevation', strength = 1, gain } = value;
      if (axis !== 'elevation' && axis !== 'azimuth') throw new RangeError('Sky ramp axis must be elevation or azimuth');
      const limit = axis === 'elevation' ? Math.PI/2 : TAU;
      const [start, end] = vector(value.domain ?? [0,limit], 2, 'Sky ramp domain');
      bounded(start, axis === 'elevation' ? 0 : -1e6, axis === 'elevation' ? limit : 1e6, 'Sky ramp start');
      if (end <= start || (axis === 'elevation' ? end > limit : end > start + limit))
        throw new RangeError('Sky ramp domain must increase within one ' + axis + ' range');
      return { program: paletteFields.ramp(ramp), axis, start, span: end-start,
        strength: bounded(strength, 0, 1, 'Sky ramp strength'), gain: gainBinding(gain) };
    }
    let backdrop = null;
    if (sky !== false) {
      const { orthoFov = base.orthoFov, splats = [], paletteRamp, paletteField } = record(sky, 'Sky');
      let field;
      if (paletteField !== undefined && paletteField !== false) {
        const { reflections = true, gain, ...definition } = record(paletteField, 'Sky palette field');
        if (typeof reflections !== 'boolean') throw new TypeError('Sky palette field reflections must be a boolean');
        field = { ...palettes.compile(definition, palettes.skyDomains), reflections, gain: gainBinding(gain) };
      }
      backdrop = { orthoFov: bounded(orthoFov, 1, 160, 'Orthographic sky FOV'), paletteRamp: skyRamp(paletteRamp), field,
        splats: list(splats, 4096, 'Angular splats').map(raw => {
          record(raw, 'Angular splat');
          const [az, el] = vector(raw.at, 2, 'Splat azimuth and elevation');
          bounded(el, -Math.PI/2, Math.PI/2, 'Splat elevation');
          return { ...unique(raw), direction: direction(az, el),
            right: [Math.cos(az), 0, -Math.sin(az)], up: direction(az, el + Math.PI/2),
            size: widths(raw, .45), color: rgb(raw.color ?? '#ffffff') };
        }) };
    }
    const external = value => Array.isArray(value) ? encode(value) : value;
    const surface = values => Object.fromEntries(Object.entries(values).map(([key,value]) => [key,external(value)]));
    function trackSample(seconds, pins, trace) {
      const params = Object.assign(Object.create(null), initial);
      for (const { id, name, clip, offset, speed } of schedule) {
        const time = seconds * speed - offset;
        if (!Number.isFinite(time)) throw new RangeError('Track time is out of range');
        const pinned = pins.has(id), pin = pins.get(id);
        const row = trace && {id,sequence:name,speed,offset,trackTime:time,...(pinned && {pinnedProfile:pin})};
        const profile = pinned ? looks.get(pin) : clip.sample(time,row);
        if (!profile || pinned && !compatible(profile, clip.start))
          throw new RangeError('Incompatible profile ' + pin + ' for ' + id);
        Object.assign(params, profile);
        if (row) {
          row.values = surface(profile);
          trace.tracks.push(row);
          for (const key of Object.keys(profile)) trace.source[key] = {kind:'track',id};
        }
      }
      return params;
    }

    function transitionList(source) {
      return Object.freeze(Array.from(list(source,transitionLimit,'Sky transitions'), raw => {
        const { at, profile, duration, ease = 'smooth' } = record(raw,'Sky transition');
        if (Object.keys(raw).some(key => !['at','profile','duration','ease'].includes(key)))
          throw new TypeError('A sky transition needs at, profile, duration and optional ease');
        bounded(at,-1e9,1e9,'Sky transition time');
        bounded(duration,Number.MIN_VALUE,1e9,'Sky transition duration');
        if (!(at+duration > at)) throw new RangeError('Sky transition duration is too small at its start time');
        if (!['linear','smooth'].includes(ease)) throw new TypeError('Sky transition easing must be linear or smooth');
        const target = looks.get(text(profile,'Sky transition profile'));
        if (!target || !Object.keys(target).length) throw new RangeError('Unknown or empty sky transition profile ' + profile);
        for (const [key,value] of Object.entries(target)) {
          if (!own(channelTypes,key) || typeof value !== typeof channelTypes[key])
            throw new TypeError('Sky transition profile '+profile+' needs an initial '+typeof value+' value for '+key);
        }
        return Object.freeze({ at, profile, duration, ease });
      }).sort((a,b) => a.at-b.at));
    }

    function indexTransitions(events, pins) {
      const byChannel = new Map();
      for (const [index,event] of events.entries()) {
        const authored = trackSample(event.at,pins);
        for (const [key,to] of Object.entries(looks.get(event.profile))) {
          if (!byChannel.has(key)) byChannel.set(key,[]);
          const segments = byChannel.get(key), last = segments.at(-1);
          // Capture in the same linear-light space used by the track sampler.
          const from = last ? atTransition(key,last,event.at) : authored[key];
          segments.push({ index,at:event.at,end:event.at+event.duration,duration:event.duration,ease:easings[event.ease],from,to,previous:last });
        }
      }
      return byChannel;
    }

    function playback(events) {
      const indexed = new Map();
      function evaluate(seconds, overrides = {}, trace) {
        if (!Number.isFinite(seconds)) throw new TypeError('Sky time must be finite seconds');
        const pins = new Map(Object.entries(record(overrides, 'Profile overrides')));
        for (const id of pins.keys()) if (!ids.has(id)) throw new RangeError('Unknown profile track ' + id);
        const params = trackSample(seconds,pins,trace);
        if (events.length && seconds >= events[0].at) {
          const pinKey = pins.size ? JSON.stringify([...pins].sort(([a],[b]) => a.localeCompare(b))) : '';
          if (!indexed.has(pinKey)) {
            if (indexed.size >= 16) indexed.delete(indexed.keys().next().value);
            indexed.set(pinKey,indexTransitions(events,pins));
          }
          for (const [key,segments] of indexed.get(pinKey)) {
            const segment = previous(segments,seconds);
            if (!segment) continue;
            params[key] = atTransition(key,segment,seconds);
            if (trace) {
              const row = trace.transitions[segment.index];
              if (row) {
                let fromSource;
                if (segment.previous) fromSource = {kind:'transition',index:segment.previous.index};
                else {
                  let capture = trace.captures.get(segment.at);
                  if (!capture) {
                    capture = {tracks:[],source:Object.create(null)};
                    trackSample(segment.at,pins,capture);
                    trace.captures.set(segment.at,capture);
                  }
                  const prior = capture.source[key];
                  if (prior) {
                    const { values, ...track } = capture.tracks.find(item=>item.id===prior.id);
                    fromSource = {kind:'track',...track};
                  } else fromSource = {kind:'default'};
                }
                row.channels[key] = {from:external(segment.from),fromSource,to:external(segment.to),value:external(params[key])};
              }
              trace.source[key] = {kind:'transition',index:segment.index};
            }
          }
        }
        return surface(params);
      }

      function sample(seconds, overrides) { return evaluate(seconds,overrides); }
      function inspect(seconds, overrides) {
        const started = events.map((event,index) => {
          if (event.at > seconds) return null;
          const progress = seconds >= event.at+event.duration ? 1 : clamp((seconds-event.at)/event.duration);
          return { index,...event,progress,weight:easings[event.ease](progress),channels:Object.create(null) };
        });
        const trace = { defaults:surface(initial),tracks:[],transitions:started,source:Object.create(null),captures:new Map() };
        for (const key of Object.keys(initial)) trace.source[key] = {kind:'default'};
        const values = evaluate(seconds,overrides,trace);
        const { captures, ...report } = trace;
        return { ...report,transitions:started.filter(Boolean).map(row => ({ ...row,
          state:Object.keys(row.channels).length ? (row.progress === 1 ? 'holding' : 'blending') : 'superseded'
        })),values };
      }
      function frame(seconds, overrides) {
        return skyFrame(sample(seconds,overrides),seconds);
      }
      return Object.freeze({ [compiled]:true, sample, frame, inspect, profile, transitions:events,
        interrupt(event) { return playback(transitionList([...events,event])); },
        withTransitions(source) { return playback(transitionList(source === false ? [] : source)); }
      });
    }

    function skyFrame(parameters, seconds) {
      const p = Object.assign(Object.create(null), parameters);
      const sun = direction(mod(p.sunAzimuth ?? base.sunAzimuth, TAU), p.sunAltitude ?? base.sunAltitude);
      function style(layer) {
        const tint = layer.tint === undefined ? [1, 1, 1] : p[layer.tint];
        return { ...layer, opacity: clamp(layer.opacity * (layer.gain === undefined ? 1 : p[layer.gain])),
          color: layer.color.map((v, i) => v * tint[i]) };
      }
      const overcast = p.overcast ?? 0, veil = p.overcastColor ?? rgb('#788897');
      const sunStrength = (p.sunStrength ?? base.sunStrength) * (1 - overcast);
      const backdropColor = (key, weight) => (p[key] ?? rgb(base[key])).map((c, i) => mix(c, veil[i], overcast * weight));
      const ramp = backdrop?.paletteRamp;
      const rampStrength = ramp && clamp(ramp.strength * (ramp.gain === undefined ? 1 : p[ramp.gain] ?? 0) * (1-overcast));
      const field = backdrop?.field;
      const fieldStrength = field && clamp(field.strength * (field.gain === undefined ? 1 : p[field.gain] ?? 0));
      const sky = backdrop && {
        orthoFov: backdrop.orthoFov * Math.PI / 180, sun,
        zenith: backdropColor('zenith', .82), horizon: backdropColor('horizon', .68), ground: backdropColor('ground', .35),
        sunColor: p.sunColor ?? rgb(base.sunColor), sunStrength,
        sunEdge: Math.cos(p.sunSize ?? base.sunSize), sunCore: Math.cos(.86 * (p.sunSize ?? base.sunSize)),
        splats: backdrop.splats.map(style).filter(layer => layer.opacity > 0),
        ...(rampStrength > 0 && { paletteRamp: { axis:ramp.axis, start:ramp.start, span:ramp.span, gain:ramp.gain, strength: rampStrength,
          sample:(ramp.program.frame?.(seconds) ?? ramp.program).sample } }),
        ...(fieldStrength > 0 && { paletteField: { ...(field.frame?.(seconds) ?? field),
          gain:field.gain, reflections:field.reflections, strength:fieldStrength } })
      };
      return { parameters: p, sky };
    }
    function profile(id) {
      const value = looks.get(id);
      if (!value) throw new RangeError('Unknown sky profile ' + id);
      return Object.fromEntries(Object.entries(value).map(([key,v]) => [key, Array.isArray(v) ? encode(v) : v]));
    }

    return playback(transitionList(transitions));
  }

  function withCelestials(sky, celestial, background = [0, 0, 0]) {
    if (!celestial || (!celestial.visible && !celestial.replacesSun)) return sky;
    if (!sky && !celestial.visible) return sky;
    const backdrop = sky ?? { orthoFov: Math.PI / 3, sun: [0, 1, 0], sunStrength: 0, sunColor: background,
      sunEdge: 0, sunCore: 1, horizon: background, zenith: background, ground: background, splats: [] };
    if (!celestial.replacesSun) return { ...backdrop, celestial };
    const sun = celestial.sun;
    return { ...backdrop, celestial, sun: sun?.direction ?? backdrop.sun, sunColor: sun?.color ?? backdrop.sunColor,
      sunStrength: sun ? backdrop.sunStrength * sun.gain : 0 };
  }

  function aerial(authored, override, profile = {}) {
    const enabled = override ?? authored;
    if (enabled === false || enabled === undefined) return null;
    function settings(value) {
      if (value === true || value === false || value === undefined) return {};
      const result = record(value, 'Aerial perspective');
      if (Object.keys(result).some(key => !['start', 'density', 'contrast'].includes(key)))
        throw new TypeError('Aerial perspective needs start, density and contrast settings');
      return result;
    }
    const { start = profile.aerialStart ?? 8, density = profile.aerialDensity ?? .065,
      contrast = profile.aerialContrast ?? .15 } = { ...settings(authored), ...settings(override ?? undefined) };
    bounded(start, ...ranges.aerialStart, 'Aerial start distance');
    bounded(density, ...ranges.aerialDensity, 'Aerial density');
    bounded(contrast, ...ranges.aerialContrast, 'Aerial contrast');
    return density > 0 && contrast < 1 ? { start, density, contrast } : null;
  }

  const airTransmission = (settings, distance) =>
    settings.contrast + (1 - settings.contrast) * Math.exp(-settings.density * Math.max(0, distance));

  function atmosphere(sky, ray, output, diskVisible) {
    const height = ray[1], horizon = height > 0 ? sky.zenith : sky.ground;
    const gradient = height > 0 ? Math.sqrt(height) : clamp(-height * 3);
    const fade = sky.bands ? sky.bands(gradient) : gradient;
    const angle = dot(ray, sky.sun);
    const disk = diskVisible && !sky.celestial?.replacesSun && height >= 0 ? .92 * clamp((angle - sky.sunEdge) / (sky.sunCore - sky.sunEdge)) : 0;
    const glow = angle > 0 && height >= 0 ? .22 * Math.exp(-19 * (1 - angle)) : 0;
    const sunlight = clamp((disk + glow) * sky.sunStrength);
    const ramp = height >= 0 ? sky.paletteRamp : undefined;
    if (ramp) {
      const distance = ramp.axis === 'elevation' ? Math.asin(clamp(height)) - ramp.start :
        mod(Math.atan2(ray[0],ray[2]) - ramp.start,TAU);
      ramp.sample(distance/ramp.span,output);
    }
    for (let c = 0; c < 3; c++) {
      const base = mix(sky.horizon[c], horizon[c], fade);
      output[c] = ramp ? mix(base,output[c],ramp.strength) : base;
    }
    const field = sky.paletteField;
    if (field) {
      const value = field.source === 'elevation' ? Math.asin(clamp(height, -1, 1)) :
        field.source === 'azimuth' ? field.low + mod(Math.atan2(ray[0],ray[2]) - field.low,TAU) : sunlight;
      field.apply(value, output, output, field.strength);
    }
    for (let c = 0; c < 3; c++) output[c] = mix(output[c], sky.sunColor[c], sunlight);
    return output;
  }

  // The glow is scattered light. The solar disk and directional accents are background light sources.
  function scattering(sky, direction, output = [0, 0, 0]) {
    if (direction[1] >= 0) return atmosphere(sky, direction, output, false);
    // Distant surfaces below the horizon take the air colour along their azimuth.
    const span = Math.hypot(direction[0], direction[2]);
    const alongHorizon = span > 0 ? [direction[0] / span, 0, direction[2] / span] : [0, 0, 0];
    return atmosphere(sky, alongHorizon, output, false);
  }

  function forReflection(sky) {
    return sky?.paletteField?.reflections === false ? { ...sky, paletteField: undefined } : sky;
  }

  function shade(sky, ray, output = [0, 0, 0]) {
    atmosphere(sky, ray, output, true);
    for (const splat of sky.splats) {
      const forward = dot(ray, splat.direction);
      if (forward <= 0) continue;
      const x = dot(ray, splat.right) / (splat.size[0] * forward);
      if (Math.abs(x) > 3) continue;
      const y = dot(ray, splat.up) / (splat.size[1] * forward), radius = x*x + y*y;
      if (radius >= 9) continue;
      const alpha = splat.opacity * Math.exp(-radius / 2);
      for (let c = 0; c < 3; c++) output[c] = mix(output[c], splat.color[c], alpha);
    }
    return sky.celestial ? sky.celestial.shade(ray, output) : output;
  }
  return Object.freeze({ compile, shade, forReflection, aerial, airTransmission, scattering, withCelestials, transitionLimit });
})();
if (typeof module !== 'undefined') module.exports = SkyEnvironment;
