/* A headless animation state graph sampled on the caller's timeline. */
(function (K) {
  const P = K.procedural;
  const record = v => v && typeof v === 'object' && !Array.isArray(v);
  const comparisons = {
    eq: (a, b) => a === b, ne: (a, b) => a !== b,
    gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b
  };
  function create(spec) {
    const config = P.data.clone(spec);
    const { input = {}, triggers = [], states, initial, transitions = [] } = config;
    if (!record(input) || !record(states) || !Object.hasOwn(states, initial) ||
        !Array.isArray(triggers) || !triggers.every(v => typeof v === 'string') || !Array.isArray(transitions))
      throw new TypeError('Animation state graph needs a valid starting state and properties');
    const defaults = Object.fromEntries(Object.entries(input).map(([name, value]) => {
      if (typeof value !== 'boolean' && !Number.isFinite(value)) throw new TypeError('State input must be numeric or boolean: ' + name);
      return [name, value];
    }));
    const triggerNames = new Set(triggers);
    const animations = Object.fromEntries(Object.entries(states).map(([id, state]) => {
      if (!record(state) || !record(state.schema) || !Array.isArray(state.keys) || !state.keys.length ||
          (state.loop !== undefined && typeof state.loop !== 'boolean'))
        throw new TypeError('State must declare keyframe channels and frames: ' + id);
      const track = K.anim.keyframeTrack.create(state.schema, state.keys);
      const cues = Array.from(state.cues || [], value => {
        if (!Number.isFinite(value.time) || value.time < 0 || value.time > track.duration || typeof value.name !== 'string')
          throw new TypeError('State cue must have a name and a valid time');
        return value;
      }).sort((a, b) => a.time - b.time);
      return [id, { track, loop: !!state.loop, cues }];
    }));
    const rules = transitions.map(value => {
      const { from, to, trigger, after = 0, blend = 0, when = [] } = value;
      if ((from !== '*' && !Object.hasOwn(animations, from)) || !Object.hasOwn(animations, to) ||
          (trigger !== undefined && !triggerNames.has(trigger)) ||
          !Number.isFinite(after) || after < 0 || !Number.isFinite(blend) || blend < 0 || !Array.isArray(when))
        throw new RangeError('Invalid animation transition');
      const guards = when.map(({ property, op = 'eq', value }) => {
        if (!Object.hasOwn(defaults, property) || !Object.hasOwn(comparisons, op) || typeof defaults[property] !== typeof value)
          throw new TypeError('Invalid state transition condition');
        return values => comparisons[op](values[property], value);
      });
      return { from, to, trigger, after, blend, guards };
    });

    function instantiate() {
      let state = initial, entered = 0, clock = 0, previous = null, blendTime = 0, started = false, properties = { ...defaults };
      const raised = new Set();
      function pose(id, age) {
        const { track, loop } = animations[id];
        return track.sample(loop && track.duration ? age % track.duration : age);
      }
      function values() {
        const current = pose(state, clock - entered);
        if (!previous || clock - entered >= blendTime) return current;
        const amount = (clock - entered) / blendTime;
        const mix = (a, b) => a + (b - a) * amount;
        return Object.fromEntries(Object.entries(current).map(([key, value]) => {
          const from = previous[key];
          if (Array.isArray(value) && Array.isArray(from) && value.length === from.length)
            return [key, value.map((v, i) => mix(from[i], v))];
          if (Number.isFinite(value) && Number.isFinite(from)) {
            const mode = states[state].schema[key];
            if (mode === 'radians') return [key, mix(from, from + Math.atan2(Math.sin(value - from), Math.cos(value - from)))];
            if (mode === 'positive' && from > 0) return [key, Math.exp(mix(Math.log(from), Math.log(value)))];
            return [key, mix(from, value)];
          }
          return [key, value];
        }));
      }
      function cuesBetween(id, from, to) {
        const { track, loop, cues } = animations[id], duration = track.duration;
        if (!cues.length || to < from) return [];
        const first = loop && duration ? Math.max(0, Math.floor(from / duration)) : 0;
        const last = loop && duration ? Math.floor(to / duration) : 0;
        if (last - first > 10000) throw new RangeError('State cue step exceeds its cycle budget');
        const events = [];
        for (let cycle = first; cycle <= last; cycle++) for (const cue of cues) {
          const time = cycle * duration + cue.time;
          if (time > from && time <= to) events.push({ ...cue, time: entered + time, state: id });
        }
        return events;
      }
      function advance(time, changes = {}) {
        if (!Number.isFinite(time) || time < clock || !record(changes)) throw new RangeError('State graph needs nondecreasing time');
        const next = { ...properties };
        for (const [key, value] of Object.entries(changes)) {
          if (!Object.hasOwn(defaults, key) || typeof defaults[key] !== typeof value ||
              (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Invalid state property ' + key);
          next[key] = value;
        }
        const events = cuesBetween(state, started ? clock - entered : -1e-8, time - entered);
        started = true;
        clock = time;
        properties = next;
        const rule = rules.find(r => r.to !== state && (r.from === state || r.from === '*') &&
          clock - entered >= r.after && (r.trigger === undefined || raised.has(r.trigger)) &&
          r.guards.every(test => test(properties)));
        const from = state;
        if (rule) {
          previous = rule.blend ? values() : null;
          blendTime = rule.blend;
          state = rule.to;
          entered = time;
          events.push(...cuesBetween(state, -1e-8, 0));
        }
        raised.clear();
        return { state, age: clock - entered, values: values(), events,
          transition: rule ? { from, to: state, blend: blendTime } : null };
      }
      return { advance, trigger(name) {
        if (!triggerNames.has(name)) throw new RangeError('Unknown state trigger ' + name);
        raised.add(name);
      }, get state() { return state; } };
    }
    return Object.freeze({ spec: P.data.freeze(config), instantiate });
  }

  K.anim.stateGraph = Object.freeze({ create });
})(KIT);
