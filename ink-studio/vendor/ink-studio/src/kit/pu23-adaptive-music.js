/* Host-neutral score state, driven by an explicit clock and named signals. */
(function (K) {
  const W = K.world, { check, copy, endpoint, id, own, read, record, selector, vector } = W.data;
  const { freeze } = K.procedural.data;
  const groups = { emotions: 'emotion.', parameters: 'parameter.' };
  const groupNames = Object.keys(groups);
  const quantizations = ['none', 'half-beat', 'beat', 'half-bar', 'bar', 'phrase'];
  const maxCues = 128, maxTime = 1e7, beatTolerance = 1e-9;
  const bounded = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  const positiveInt = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
  const token = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

  function entries(table, name, limit = 64) {
    check(record(table), 'Expected a music ' + name + ' record');
    const rows = Object.entries(table);
    check(rows.length <= limit && rows.every(([key]) => id(key)), 'Invalid music ' + name + ' names or count');
    return rows;
  }

  function site(value) {
    return vector(value) || record(value) &&
      (value.entity === undefined ? vector(value.point) && value.socket === undefined :
        id(value.entity) && (value.socket === undefined || id(value.socket)));
  }

  function create(config) {
    check(record(config), 'Expected a music score');
    const { tempo = 120, beatsPerBar = 4, barsPerPhrase = 4, entry,
      sections: sectionTable, cues: cueTable = {}, transitions: rules = [] } = freeze(copy(config));
    check(bounded(tempo, 1, 1000) && positiveInt(beatsPerBar, 32) && positiveInt(barsPerPhrase, 64),
      'Invalid music tempo or meter');
    const grids = { 'half-beat': .5, beat: 1, 'half-bar': beatsPerBar / 2,
      bar: beatsPerBar, phrase: beatsPerBar * barsPerPhrase };
    const channels = {};
    for (const group of groupNames) {
      channels[group] = Object.fromEntries(entries(config[group] ?? {}, group).map(([key, raw]) => {
        check(record(raw), 'Invalid music channel ' + key);
        const { default: fallback = 0, attack = 0, release = attack } = raw;
        check(bounded(fallback, 0, 1) && bounded(attack, 0, 3600) && bounded(release, 0, 3600),
          'Invalid music channel response ' + key);
        return [key, { fallback, attack, release }];
      }));
    }
    const sections = new Map(entries(sectionTable, 'sections').map(([key, raw]) => {
      check(record(raw), 'Invalid music section ' + key);
      const { resource, tempo: bpm = tempo, layers = {} } = raw;
      check(token(resource) && bounded(bpm, 1, 1000) &&
        entries(layers, 'layers').every(([, value]) => bounded(value, 0, 1)), 'Invalid music section ' + key);
      return [key, { resource, tempo: bpm, layers }];
    }));
    check(sections.has(entry), 'Unknown music entry section ' + entry);
    const cues = new Map(entries(cueTable, 'cues', maxCues).map(([key, raw]) => {
      check(record(raw), 'Invalid music cue ' + key);
      const { resource, quantize = 'none' } = raw;
      check(token(resource) && quantizations.includes(quantize), 'Invalid music cue ' + key);
      return [key, { resource, quantize }];
    }));
    check(Array.isArray(rules) && rules.length <= 256, 'Expected a bounded music transition list');
    const transitions = new Map();
    for (const raw of rules) {
      check(record(raw), 'Invalid music transition');
      const { id: name, from, to, when, quantize = 'bar', cue } = raw;
      check(id(name) && !transitions.has(name) && sections.has(from) && sections.has(to) && from !== to &&
        quantizations.includes(quantize) && (cue === undefined || cues.has(cue)), 'Invalid music transition ' + name);
      W.query.condition(when, {});
      transitions.set(name, { name, from, to, when, quantize, cue });
    }
    const outgoing = new Map([...sections.keys()].map(name => [name, []]));
    for (const rule of transitions.values()) outgoing.get(rule.from).push(rule);

    function channelRecord(map) {
      return Object.fromEntries(groupNames.map(group => [group,
        Object.fromEntries(Object.entries(channels[group]).map(([key, spec]) => [key, map(group, key, spec)]))]));
    }
    const defaults = channelRecord((group, key, spec) => spec.fallback);
    const beatAt = (state, time = state.time) => state.anchorBeat + (time - state.anchorTime) * sections.get(state.section).tempo / 60;
    const timeAt = (state, beat) => state.anchorTime + (beat - state.anchorBeat) * 60 / sections.get(state.section).tempo;
    const gridAfter = (beat, quantize) => {
      if (quantize === 'none') return beat;
      const grid = grids[quantize];
      return (Math.floor((beat + beatTolerance) / grid) + 1) * grid;
    };
    const candidate = state => outgoing.get(state.section).find(rule => W.query.condition(rule.when, state.levels));

    function initial(time = 0) {
      check(bounded(time, 0, maxTime), 'Invalid music start time');
      return freeze({ time, anchorTime: time, anchorBeat: 0, section: entry,
        levels: defaults, targets: defaults, transition: null, cues: [], serial: 0 });
    }

    function checkRequest(raw) {
      check(record(raw) && cues.has(raw.cue) &&
        (raw.emitter === undefined || site(raw.emitter)) && (raw.data === undefined || record(raw.data)),
      'Unknown or invalid music cue ' + raw?.cue);
    }

    function request(raw) {
      checkRequest(raw);
      const { cue, emitter, data } = raw;
      return copy({ cue, ...(emitter !== undefined && { emitter }), ...(data !== undefined && { data }) });
    }

    function validate(state) {
      const levelsOK = values => record(values) && groupNames.every(group => {
        const row = values[group];
        return record(row) && Object.keys(row).length === Object.keys(channels[group]).length &&
          Object.keys(channels[group]).every(name => own(row, name) && bounded(row[name], 0, 1));
      });
      check(record(state) && sections.has(state.section) && bounded(state.time, 0, maxTime) &&
        bounded(state.anchorTime, 0, state.time) && bounded(state.anchorBeat, 0, maxTime * 1000 / 60) &&
        levelsOK(state.levels) && levelsOK(state.targets) &&
        Number.isSafeInteger(state.serial) && state.serial >= 0, 'Invalid music checkpoint');
      const beat = beatAt(state, state.time);
      const future = due => bounded(due, beat - beatTolerance, beat + grids.phrase + 1);
      check(state.transition === null || record(state.transition) && future(state.transition.beat) &&
        transitions.get(state.transition.rule)?.from === state.section, 'Invalid pending music transition');
      check(Array.isArray(state.cues) && state.cues.length <= maxCues && state.cues.every(row =>
        record(row) && future(row.beat) && positiveInt(row.serial, state.serial)), 'Invalid pending music cues');
      const serials = new Set();
      for (const row of state.cues) {
        check(!serials.has(row.serial), 'Duplicate pending music cue serial');
        checkRequest(row);
        serials.add(row.serial);
      }
    }

    function smooth(state, time) {
      if (state.time === time) return;
      const elapsed = time - state.time;
      state.levels = channelRecord((group, key, spec) => {
        const before = state.levels[group][key], target = state.targets[group][key];
        const tau = target > before ? spec.attack : spec.release;
        return tau === 0 ? target : K.mix(before, target, -Math.expm1(-elapsed / tau));
      });
      state.time = time;
    }

    function advance(previous, { time, emotions, parameters, cues: requests = [] } = {}) {
      validate(previous);
      check(bounded(time, previous.time, maxTime), 'Music time must advance monotonically');
      check(Array.isArray(requests) && requests.length <= maxCues, 'Music cue input budget exceeded');
      const state = { ...previous }, intents = [];
      const emitCue = (row, beat, source) => {
        const serial = row.serial ?? ++state.serial;
        check(Number.isSafeInteger(serial), 'Music intent serial exhausted');
        const { cue, emitter, data } = row;
        intents.push({ kind: 'music-cue', serial, time: state.time, beat, cue, resource: cues.get(cue).resource,
          ...(source !== undefined && { transition: source }), ...(emitter !== undefined && { emitter }),
          ...(data !== undefined && { data }) });
      };
      function applyTransition(rule, beat) {
        const serial = ++state.serial;
        check(Number.isSafeInteger(serial), 'Music intent serial exhausted');
        state.anchorBeat = beat;
        state.anchorTime = state.time;
        state.section = rule.to;
        const { resource, tempo, layers } = sections.get(state.section);
        intents.push({ kind: 'music-transition', serial, time: state.time, beat,
          rule: rule.name, from: rule.from, to: rule.to, resource, tempo, layers });
        if (rule.cue !== undefined) emitCue({ cue: rule.cue }, beat, rule.name);
      }

      // Recompute the deadline of each cue against the active tempo after any section change.
      const scheduled = previous.cues.slice();
      if (previous.transition) scheduled.push(previous.transition);
      scheduled.sort((a, b) => a.beat - b.beat || (a.serial ?? 0) - (b.serial ?? 0));
      let consumed = 0;
      for (const row of scheduled) {
        if (row.beat > beatAt(state, time) + beatTolerance) break;
        smooth(state, Math.max(state.time, Math.min(time, timeAt(state, row.beat))));
        if (row.rule !== undefined) {
          state.transition = null;
          const rule = candidate(state);
          if (rule?.name === row.rule) applyTransition(rule, row.beat);
        } else emitCue(row, row.beat);
        consumed++;
      }
      state.cues = scheduled.slice(consumed).filter(row => row.rule === undefined);
      smooth(state, time);

      const updates = { emotions, parameters };
      for (const group of groupNames) {
        if (updates[group] === undefined) continue;
        check(record(updates[group]) && Object.entries(updates[group]).every(([key, value]) =>
          own(channels[group], key) && bounded(value, 0, 1)), 'Unknown or invalid music ' + group + ' input');
      }
      state.targets = channelRecord((group, key) => updates[group]?.[key] ?? state.targets[group][key]);
      state.levels = channelRecord((group, key, spec) => {
        const value = state.levels[group][key], target = state.targets[group][key];
        return (target > value ? spec.attack : spec.release) === 0 ? target : value;
      });

      const beat = beatAt(state, time), rule = candidate(state);
      if (rule?.name !== state.transition?.rule) {
        state.transition = null;
        if (rule?.quantize === 'none') applyTransition(rule, beat);
        else if (rule) state.transition = { rule: rule.name, beat: gridAfter(beat, rule.quantize) };
      }
      for (const raw of requests) {
        const row = request(raw), due = gridAfter(beat, cues.get(row.cue).quantize);
        if (due === beat) emitCue(row, beat);
        else {
          check(state.cues.length < maxCues && state.serial < Number.MAX_SAFE_INTEGER, 'Pending music cue budget exceeded');
          state.cues.push({ ...row, beat: due, serial: ++state.serial });
        }
      }
      return freeze({ state, intents });
    }

    function inspect(state) {
      validate(state);
      const beat = beatAt(state, state.time), winner = candidate(state)?.name ?? null;
      const due = row => ({ ...row, estimatedTime: timeAt(state, row.beat) });
      return freeze({ time: state.time, beat, beatsPerBar, barsPerPhrase,
        bar: Math.floor((beat + beatTolerance) / beatsPerBar),
        phrase: Math.floor((beat + beatTolerance) / grids.phrase),
        nextBeatTime: timeAt(state, gridAfter(beat, 'beat')), nextBarTime: timeAt(state, gridAfter(beat, 'bar')),
        section: state.section, ...sections.get(state.section), ...state.levels, targets: state.targets, winner,
        transitions: outgoing.get(state.section).map(rule => ({ rule: rule.name, to: rule.to,
          quantize: rule.quantize, matches: W.query.condition(rule.when, state.levels) })),
        pendingTransition: state.transition && due(state.transition), pendingCues: state.cues.map(due) });
    }
    return Object.freeze({ initial, advance, inspect, beat: beatAt, validate, request });
  }

  // Accepts both score intents and existing world cues with a spatial "at" value.
  function acoustics(query, cue, { listener, field, args = {} } = {}) {
    check(record(cue) && site(listener) && query.field(field)?.role === 'acoustic-hearing',
      'A spatial cue needs a listener and an acoustic hearing field');
    const emitter = cue.emitter ?? cue.at;
    if (!site(emitter)) return W.query.missing('cue has no spatial emitter', 'missing');
    return query.probe(field, listener, { ...args, from: emitter });
  }

  function adaptiveMusic(config) {
    const machine = create(config), inputs = { cues: 'event' }, fields = [];
    const outputs = { beat: 'number', intents: 'event' };
    for (const group of groupNames) {
      for (const [name, spec] of Object.entries(config[group] ?? {})) {
        const key = groups[group] + name, output = 'level.' + key;
        outputs[output] = 'number';
        if (spec.field === undefined) {
          inputs[key] = { type: 'number', default: spec.default ?? 0 };
          fields.push({ group, name, key, output });
          continue;
        }
        const { field, at, args = {}, path, range = [0, 1] } = spec;
        endpoint(field);
        check((at === undefined || site(at)) && record(args) && vector(range, 2) && range[0] !== range[1] && Number.isFinite(range[1] - range[0]),
          'Invalid music field binding for ' + key);
        fields.push({ group, name, key, output, field, at, args, path: path === undefined ? undefined : selector(path),
          range, fallback: spec.default ?? 0 });
      }
    }

    function step(state, ctx) {
      const updates = { emotions: {}, parameters: {} };
      for (const row of fields) {
        let value;
        if (row.field !== undefined) {
          const result = ctx.query.probe(row.field, row.at, row.args);
          const selected = row.path ? read(result.value, row.path) : result.value;
          const sample = typeof selected === 'boolean' ? Number(selected) : selected;
          const [low, high] = row.range;
          value = result.status === 'ok' && Number.isFinite(sample) ?
            K.world.fields.clamp((sample - low) / (high - low), 0, 1) : row.fallback;
        } else value = K.world.fields.clamp(ctx.input[row.key], 0, 1);
        updates[row.group][row.name] = value;
      }
      const result = machine.advance(state.clock, { ...updates, time: ctx.time,
        cues: state.requests.concat(ctx.input.cues) });
      for (const { kind, ...detail } of result.intents) ctx.emit(kind, detail);
      return { clock: result.state, intents: result.intents, requests: [] };
    }

    return {
      inputs, outputs, step, contract: { emits: ['music-transition', 'music-cue'] },
      initial: () => ({ clock: machine.initial(), intents: [], requests: [] }),
      checkFields(query) {
        for (const row of fields) {
          if (row.field === undefined) continue;
          const field = query.field(row.field);
          check(field && (row.path || ['number', 'bool', 'boolean'].includes(field.type)) && (!field.spatial || row.at !== undefined),
            'Invalid music signal field ' + row.field + ' for ' + row.key);
        }
      },
      checkAction(type, args) { machine.request(args); },
      actions: {
        cue(state, args) {
          check(state.requests.length < maxCues, 'Music cue input budget exceeded');
          return { ...state, requests: [...state.requests, machine.request(args)] };
        }
      },
      validateState(state) {
        check(record(state) && Array.isArray(state.requests) && state.requests.length <= maxCues &&
          Array.isArray(state.intents) && state.intents.length <= maxCues * 2 + 4, 'Invalid saved music event buffers');
        machine.validate(state.clock);
        for (const row of state.requests) machine.request(row);
      },
      output(state) {
        const out = { beat: machine.beat(state.clock), intents: state.intents };
        for (const row of fields) out[row.output] = state.clock.levels[row.group][row.name];
        return out;
      },
      fields: {
        state: { type: 'record', read: ({ state }) => W.query.ok(machine.inspect(state.clock)) },
        intents: { type: 'records', read: ({ state }) => W.query.ok(state.intents) }
      }
    };

  }

  K.music = Object.freeze({ create, acoustics });
  W.runtime.register('adaptive-music', adaptiveMusic);
})(KIT);
