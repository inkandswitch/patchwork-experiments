/* Named clip events and the presentation outputs of a native animation machine. */
(function (K) {
  const A = K.anim, { clone, freeze } = K.procedural.data;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const nameOK = value => typeof value === 'string' && value.length <= 128 && !!value.trim() && !(value in Object.prototype);
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const close = (a, b) => a === b || Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  const due = (time, now) => time <= now || close(time, now);
  const budget = 10000;
  const allowed = (value, fields) => Object.keys(value).every(key => fields.includes(key));

  function prepare(input, duration) {
    if (!Array.isArray(input) || input.length > budget || !Number.isFinite(duration) || duration <= 0)
      throw new TypeError('Named events need a bounded list and positive clip duration');
    const ids = new Set();
    return freeze(Array.from(input, (row, index) => {
      if (!record(row) || !nameOK(row.name) || !nonnegative(row.time) || row.time > duration ||
          !allowed(row, ['id', 'name', 'time', 'data']))
        throw new TypeError('Named animation events need a name and source time within their clip');
      const id = row.id ?? 'event:' + index;
      if (!nameOK(id) || ids.has(id)) throw new Error('Duplicate or invalid named animation event ID: ' + id);
      ids.add(id);
      return { id, name: row.name, time: row.time, ...(row.data !== undefined && { data: clone(row.data) }) };
    }).sort((a, b) => a.time - b.time));
  }

  function track(clip, { playback = 'clip', speed = 1 } = {}) {
    if (!['clip', 'once', 'loop'].includes(playback) || !Number.isFinite(speed) ||
        !Number.isFinite(clip.dur) || clip.dur <= 0)
      throw new TypeError('Animation event playback needs a finite speed and positive clip duration');
    const legacy = (clip.cues ?? []).flatMap((cue, index) => {
      if (!cue || cue.enabled === false || cue.type !== undefined) return [];
      const [time, name] = Array.isArray(cue) ? cue : [cue.time, cue.name ?? cue.id];
      if (!nameOK(name) || !nonnegative(time) || time > clip.dur) return [];
      return [{ id: 'cue:' + index, name, time }];
    });
    const reverse = speed < 0, rate = Math.abs(speed), span = rate ? clip.dur / rate : Infinity;
    if (rate && (!Number.isFinite(span) || span <= 0))
      throw new RangeError('Animation event playback exceeds timing precision');
    const loop = rate > 0 && (playback === 'loop' || playback === 'clip' && clip.loop);
    const rows = [...legacy, ...(clip.animationEvents ?? [])].flatMap(event => {
      const offset = reverse ? clip.dur - event.time : event.time;
      return rate ? [{ event, at: offset / rate }] : offset === 0 ? [{ event, at: 0 }] : [];
    }).sort((a, b) => a.at - b.at);

    return {
      rows, span, loop,
      time(index, cycle) {
        if (!Number.isSafeInteger(cycle)) throw new RangeError('Animation event cycle exceeds timing precision');
        if (!rows[index]) return Infinity;
        return (cycle === 0 ? 0 : cycle * span) + rows[index].at;
      },
      sample(age) {
        let local = loop ? age % span : Math.min(age, span);
        if (loop && age >= span && (close(age, age - local) || close(age, age + span - local))) local = 0;
        const time = Math.min(clip.dur, local * rate);
        return reverse ? clip.dur - time : time;
      }
    };
  }
  function between(clip, from, to, options) {
    if (![from, to].every(Number.isFinite) || to < from)
      throw new RangeError('Animation event range must be finite and ordered');
    const lane = track(clip, options), events = [];
    if (!lane.rows.length || to < 0) return events;
    const first = lane.loop ? Math.max(0, Math.floor(from / lane.span) - 1) : 0;
    const last = lane.loop ? Math.floor(to / lane.span) + 1 : 0;
    if (!Number.isSafeInteger(last) || last - first > budget)
      throw new RangeError('Animation event range exceeds its cycle budget');
    for (let cycle = first; cycle <= last; cycle++) for (const [index, { event }] of lane.rows.entries()) {
      const time = lane.time(index, cycle);
      if (!due(time, from) && due(time, to)) events.push({ ...event, time: Math.min(time, to), sourceTime: event.time, cycle });
      if (events.length > budget) throw new RangeError('Too many animation events in one range');
    }
    return events;
  }

  function responses(value = {}) {
    if (!record(value)) throw new TypeError('Animation event bindings must be a record of named response lists');
    const contacts = new Set();
    const routes = new Map(Object.entries(value).map(([name, items]) => {
      if (!nameOK(name) || !Array.isArray(items) || !items.length || items.length > 32)
        throw new TypeError('Invalid animation event binding: ' + name);
      const list = clone(items).map(row => {
        if (!record(row)) throw new TypeError('Invalid animation event response: ' + name);
        const { type, cue, gain = 1, contact, action, effect, settings = {} } = row;
        if (type === 'sound' && nameOK(cue) && nonnegative(gain) && allowed(row, ['type', 'cue', 'gain', 'contact']) &&
            (contact === undefined || nameOK(contact))) {
          if (contact !== undefined) contacts.add(contact);
          return { type, cue, gain, ...(contact !== undefined && { contact }) };
        }
        if (type === 'contact' && nameOK(contact) && ['plant', 'release'].includes(action) &&
            allowed(row, ['type', 'contact', 'action'])) {
          contacts.add(contact);
          return { type, contact, action };
        }
        if (type === 'effect' && Object.hasOwn(A.CUES, effect) && !['sound', 'freeze', 'slow'].includes(effect) &&
            record(settings) && allowed(row, ['type', 'effect', 'settings']) &&
            allowed(settings, ['duration', 'amount', 'color', 'frequency', 'rotation', 'damping', 'x', 'y', 'easing', 'seed']) &&
            (settings.duration === undefined || Number.isFinite(settings.duration) && settings.duration > 0) &&
            Object.entries(settings).every(([key, v]) => key === 'color'
              ? Array.isArray(v) && v.length === 3 && v.every(n => nonnegative(n) && n <= 255)
              : key === 'easing' ? nameOK(v) : Number.isFinite(v)))
          return { type, effect, settings };
        throw new TypeError('Invalid animation event response: ' + name);
      });
      return [name, freeze(list)];
    }));
    return { routes, contacts };
  }

  function bind(machine, required, { world, puppet, contacts = {}, sockets, onEvent, onSound, presentation } = {}) {
    if (!world?.anim || puppet?.anim !== world.anim || typeof puppet?.setPoseSampler !== 'function' ||
        !record(contacts) || [onEvent, onSound].some(fn => fn !== undefined && typeof fn !== 'function'))
      throw new TypeError('Bind the animation machine with its world and puppet');
    for (const id of required)
      if (!Object.hasOwn(contacts, id)) throw new Error('Missing animation event contact: ' + id);
    const holds = K.anim.contacts.create({ puppet, sample: () => ({}), duration: 1, sockets,
      contacts: Object.entries(contacts).map(([id, row]) => ({ ...row, id, start: 0, end: 1, fadeIn: 0, fadeOut: 0 })) });
    let cursor = 0, current;
    world.anim.stateful = true;
    puppet.setPoseSampler((time, dt, actor) => {
      if (!due(cursor, time)) throw new RangeError('Reset the animation machine before playing backward');
      const frame = machine.advance(Math.max(0, time - cursor));
      cursor = Math.max(cursor, time);
      machine.pose(actor.pose);
      const constraints = holds.apply(0, { active: new Set(frame.contacts) });
      A.show(world.anim, frame.presentation, world.pal, presentation);
      current = { ...frame, constraints: constraints.contacts };
      for (const row of frame.events) {
        onEvent?.(row);
        if (row.type === 'sound') onSound?.(row);
      }
    });
    return Object.freeze({
      frame: () => current,
      reset() {
        cursor = 0;
        current = undefined;
        return machine.reset();
      }
    });
  }

  function create(input) {
    const config = clone(input);
    if (!record(config) || !record(config.clips) || !Array.isArray(config.layers) || !config.layers.length ||
        config.layers.some(layer => !record(layer) || !Array.isArray(layer.states) || !layer.states.length))
      throw new TypeError('An animation graph needs a clip catalog and layers with states');
    const clips = new Map(Object.entries(config.clips).map(([id, def]) => {
      if (!nameOK(id) || !record(def)) throw new TypeError('Invalid animation clip ' + id);
      return [id, A.clip({ ...def, id })];
    }));
    for (const layer of config.layers) for (const state of layer.states) {
      if (!record(state)) throw new TypeError('Invalid animation graph state');
      if (state.clip === undefined) continue;
      if (!clips.has(state.clip)) throw new Error('Unknown animation clip: ' + state.clip);
      state.clip = clips.get(state.clip);
    }
    return A.machine({ ...config, eventBindings: config.eventBindings ?? {} });
  }

  A.animationEvents = Object.freeze({ prepare, track, between, responses, bind, nameOK, due, budget });
  A.animationGraph = Object.freeze({ create });
})(KIT);
