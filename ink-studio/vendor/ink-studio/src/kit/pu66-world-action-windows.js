/* Timed action phases and deterministic contact outcomes for scene entities. */
(function (K) {
  const W = K.world, { V, M } = K;
  const { check, copy, id, own, record, vector } = W.data;
  const { freeze } = K.procedural.data;
  const eps = 1e-8, zero = Object.freeze([0, 0, 0]), identity = Object.freeze(M.id());
  const clock = value => Number.isFinite(value) && Math.abs(value) <= 1e9;
  const metric = value => Number.isFinite(value) && value >= 0 && value <= 1e9;
  const names = (list, limit) => Array.isArray(list) && list.length <= limit && list.every(id) &&
    new Set(list).size === list.length;
  const table = (value, limit) => record(value) && Object.keys(value).length <= limit && Object.keys(value).every(id);
  const markerName = name => K.anim.animationEvents.nameOK(name);

  function create(definition = {}) {
    const { recipes = {}, assign = {} } = copy(definition);
    check(table(recipes, 64) && table(assign, 128) && Object.keys(assign).length, 'Expected action recipes and assignments');
    const signals = new Set(), flags = new Map();
    function guard(raw) {
      if (raw === undefined) return null;
      check(record(raw) && own(recipes, raw.action) && recipes[raw.action].some(phase => phase.id === raw.phase),
        'Unknown action phase guard');
      return raw;
    }
    function rules(list = [], receive = false) {
      check(Array.isArray(list) && list.length <= 16, 'An action window accepts up to 16 contact rules');
      return list.map(raw => {
        check(record(raw) && id(raw.kind) && id(raw.emit) && names(raw.targets ?? [], 128) && names(raw.sources ?? [], 128) &&
          metric(raw.minSpeed ?? 0) && metric(raw.minEnergy ?? 0) &&
          (receive ? raw.once === undefined || typeof raw.once === 'boolean' :
            (raw.once === undefined || ['phase', 'action'].includes(raw.once)) &&
              raw.during === undefined && raw.sourceDuring === undefined), 'Invalid action contact rule');
        signals.add(raw.emit);
        return { ...raw, during: receive ? guard(raw.during) : null, sourceDuring: receive ? guard(raw.sourceDuring) : null };
      });
    }
    for (const [name, recipe] of Object.entries(recipes)) {
      check(record(recipe) && Array.isArray(recipe.phases) && recipe.phases.length > 0 && recipe.phases.length <= 16 &&
        names(recipe.phases.map(phase => phase?.id), 16), 'Invalid phases for ' + name);
      recipes[name] = recipe.phases.map(phase => {
        const { duration, until, cue } = phase;
        check(record(phase) && (duration !== undefined || until !== undefined) &&
          (duration === undefined || metric(duration) && duration >= .001 && duration <= 3600) &&
          (until === undefined || markerName(until)) && (cue === undefined || id(cue)) && names(phase.flags ?? [], 16),
        'Invalid action phase ' + name + '/' + phase.id);
        const onContact = rules(phase.onContact);
        check(new Set(onContact.map(rule => rule.kind + '/' + rule.emit)).size === onContact.length,
          'Duplicate action contact outcome in ' + name + '/' + phase.id);
        return { ...phase, onContact };
      });
    }
    // The authored definitions are copied before compilation. Guards on receivers
    // can reference any action, including one assigned to another object.
    for (const [entity, row] of Object.entries(assign)) {
      check(record(row) && names(row.actions ?? [], 32) && (row.actions ?? []).every(name => own(recipes, name)) &&
        record(row.markers ?? {}) && Object.entries(row.markers ?? {}).every(([name, action]) =>
          markerName(name) && (row.actions ?? []).includes(action)), 'Invalid action assignment for ' + entity);
      assign[entity] = { ...row, actions: row.actions ?? [], markers: row.markers ?? {}, receive: rules(row.receive, true) };
      check(assign[entity].receive.every(rule => !rule.during || assign[entity].actions.includes(rule.during.action)),
        'Receiver guard needs an action assigned to ' + entity);
      for (const action of assign[entity].actions) for (const phase of recipes[action])
        for (const flag of phase.flags ?? []) {
          const key = entity + '.' + flag;
          check(!flags.has(key) || flags.get(key) === entity, 'Action flags produce an ambiguous output ' + key);
          flags.set(key, entity);
        }
    }
    check(flags.size <= 256 && signals.size <= 128, 'Action outputs exceed their budget');

    function initial(time = 0) {
      check(clock(time), 'Invalid action clock');
      return freeze({ time, sequence: 0, active: {}, spent: {} });
    }
    function validate(state) {
      check(record(state) && clock(state.time) && Number.isSafeInteger(state.sequence) && state.sequence >= 0 &&
        table(state.active, 128) && table(state.spent, 128), 'Invalid saved action state');
      const activations = new Set();
      for (const [entity, row] of Object.entries(state.active)) {
        check(own(assign, entity) && record(row) && assign[entity].actions.includes(row.action) &&
          Number.isSafeInteger(row.phase) && own(recipes[row.action], row.phase) &&
          clock(row.entered) && row.entered <= state.time && Number.isSafeInteger(row.activation) &&
          row.activation > 0 && row.activation <= state.sequence && !activations.has(row.activation) &&
          Array.isArray(row.seen) && row.seen.length <= 512 &&
          row.seen.every(key => typeof key === 'string' && key.length <= 300) &&
          new Set(row.seen).size === row.seen.length, 'Invalid active action for ' + entity);
        activations.add(row.activation);
      }
      for (const [entity, indices] of Object.entries(state.spent))
        check(own(assign, entity) && Array.isArray(indices) && new Set(indices).size === indices.length &&
          indices.every(i => Number.isSafeInteger(i) && assign[entity].receive[i]?.once === true), 'Invalid spent action receiver');
      return state;
    }
    function read(state) {
      const active = {}, exposed = {};
      for (const key of flags.keys()) exposed[key] = false;
      for (const [entity, row] of Object.entries(state.active)) {
        const phase = recipes[row.action][row.phase], phaseFlags = phase.flags ?? [];
        active[entity] = { action: row.action, phase: phase.id, activation: row.activation, entered: row.entered, flags: phaseFlags };
        for (const flag of phaseFlags) exposed[entity + '.' + flag] = true;
      }
      return { active, flags: exposed };
    }

    function step(prior, { to, commands = [], contacts = [], sweeps = [] } = {}) {
      validate(prior);
      const from = prior.time;
      check(clock(to) && to >= from && to - from <= 3600 && Array.isArray(commands) && commands.length <= 256 &&
        Array.isArray(contacts) && contacts.length <= 1024 && Array.isArray(sweeps) && sweeps.length <= 256,
      'Invalid action step or input budget');
      const atTime = time => clock(time) && time >= from - eps && time <= to + eps;
      const timeOf = time => Math.max(from, Math.min(to, time ?? to));
      const operations = commands.map(raw => {
        check(record(raw) && ['start', 'cancel', 'marker'].includes(raw.op) && id(raw.entity) &&
          (raw.at === undefined || atTime(raw.at)) && (raw.op !== 'start' || id(raw.action)) &&
          (raw.op !== 'marker' || markerName(raw.name)), 'Invalid action command');
        return { type: 'command', at: timeOf(raw.at), raw };
      });
      const contactIds = new Set();
      for (const raw of contacts) {
        const contact = contactRow(raw);
        check(raw.at === undefined || atTime(raw.at), 'Action contact lies outside its step');
        if (contact.id && contactIds.has(contact.id)) continue;
        if (contact.id) contactIds.add(contact.id);
        operations.push({ type: 'contact', at: timeOf(raw.at), raw: contact });
      }
      operations.sort((a, b) => a.at - b.at || Number(a.type === 'contact') - Number(b.type === 'contact'));
      const motions = sweeps.map(raw => {
        const contact = contactRow(raw), start = raw.start ?? from, end = raw.end ?? to;
        check(atTime(start) && atTime(end) && end >= start, 'Action sweep lies outside its step');
        return { contact, start: timeOf(start), end: timeOf(end),
          probe: sweptBody(raw.probe), target: sweptBody(raw.targetBody) };
      });
      const state = copy(prior), events = [], outcomes = [], passive = new Set();
      const phaseOf = row => row && recipes[row.action][row.phase];
      const deadline = row => phaseOf(row).duration === undefined ? Infinity : row.entered + phaseOf(row).duration;
      function event(type, entity, row, at, extra = {}) {
        check(events.length < 4096, 'Action step exceeds its event budget');
        events.push({ type, entity, action: row.action, activation: row.activation, phase: phaseOf(row).id, time: at, ...extra });
      }
      function announce(entity, row, at) {
        const { flags = [], cue } = phaseOf(row);
        event('action-phase', entity, row, at, { flags, ...(cue && { cue }) });
      }
      function advance(entity, row, at) {
        if (row.phase + 1 === recipes[row.action].length) {
          event('action-end', entity, row, at);
          delete state.active[entity];
        } else {
          const next = { ...row, phase: row.phase + 1, entered: at, seen: row.seen.filter(key => key.startsWith('a/')) };
          state.active[entity] = next;
          announce(entity, next, at);
        }
      }
      function start(entity, name, at) {
        if (!own(assign, entity) || !assign[entity].actions.includes(name) || own(state.active, entity)) return;
        check(Number.isSafeInteger(state.sequence + 1), 'Action activation counter exhausted');
        const row = { action: name, phase: 0, entered: at, activation: ++state.sequence, seen: [] };
        state.active[entity] = row;
        event('action-start', entity, row, at);
        announce(entity, row, at);
      }
      function command({ op, entity, action, name }, at) {
        if (!own(assign, entity)) return;
        const row = state.active[entity];
        if (op === 'start') start(entity, action, at);
        else if (op === 'cancel') {
          if (!row) return;
          event('action-cancel', entity, row, at);
          delete state.active[entity];
        } else if (row) {
          if (phaseOf(row).until === name) advance(entity, row, at);
        } else if (own(assign[entity].markers, name)) start(entity, assign[entity].markers[name], at);
      }
      const inPhase = (guard, row) => !guard || row?.action === guard.action && phaseOf(row).id === guard.phase;
      const applies = (rule, hit) => rule.kind === hit.kind &&
        (!rule.targets?.length || rule.targets.includes(hit.target)) && (!rule.sources?.length || rule.sources.includes(hit.source));
      const matches = (rule, hit) => applies(rule, hit) && (hit.speed ?? 0) >= (rule.minSpeed ?? 0) &&
        (hit.energy ?? 0) >= (rule.minEnergy ?? 0);
      const eligible = (rule, source, target) => inPhase(rule.during, target) && inPhase(rule.sourceDuring, source);
      function remember(row, key) {
        if (row.seen.includes(key)) return false;
        check(row.seen.length < 512, 'Action activation exceeds its contact budget');
        row.seen.push(key);
        return true;
      }
      function outcome(rule, hit, row, entity, at) {
        check(outcomes.length < 4096, 'Action step exceeds its outcome budget');
        outcomes.push({ ...hit, time: at, signal: rule.emit, entity,
          ...(row && { action: row.action, phase: phaseOf(row).id, activation: row.activation }),
          ...(rule.data !== undefined && { data: rule.data }) });
      }
      function apply(hit, at, sweepIndex) {
        const source = state.active[hit.source], target = state.active[hit.target];
        if (source) phaseOf(source).onContact.forEach((rule, i) => {
          if (!matches(rule, hit)) return;
          const prefix = rule.once === 'action' ? 'a/' + rule.emit : 'p/' + i;
          if (remember(source, prefix + '/' + hit.target)) outcome(rule, hit, source, hit.source, at);
        });
        if (!own(assign, hit.target)) return;
        assign[hit.target].receive.forEach((rule, i) => {
          if (!matches(rule, hit) || !eligible(rule, source, target)) return;
          const spent = state.spent[hit.target];
          if (rule.once && spent?.includes(i)) return;
          const identity = hit.id ? 'id/' + hit.id : sweepIndex === undefined ? null : 'sweep/' + sweepIndex;
          const key = identity && identity + '/' + hit.target + '/' + i;
          if ((key && passive.has(key)) || rule.sourceDuring && !remember(source, 'p/receiver/' + hit.target + '/' + i)) return;
          if (key) passive.add(key);
          if (rule.once) (state.spent[hit.target] ??= []).push(i);
          outcome(rule, hit, target, hit.target, at);
        });
      }
      function collect(low, high, includeEnd) {
        const hits = [];
        for (const [i, motion] of motions.entries()) {
          const { contact } = motion, source = state.active[contact.source], target = state.active[contact.target];
          const active = phaseOf(source)?.onContact.some(rule => applies(rule, contact));
          const receiver = assign[contact.target]?.receive.some(rule => applies(rule, contact) && eligible(rule, source, target));
          if (!active && !receiver) continue;
          const hit = sweptContact(motion, low, high);
          if (hit && (includeEnd || hit.time < high - eps)) hits.push({ ...hit, index: i });
        }
        hits.sort((a, b) => a.time - b.time || a.index - b.index);
        for (const row of hits) apply(row.contact, row.time, row.index);
      }

      let cursor = from, index = 0, iterations = 0;
      for (;;) {
        check(++iterations <= 4096, 'Action step exceeds its phase budget');
        for (const entity of Object.keys(state.active).sort()) {
          const row = state.active[entity];
          if (deadline(row) <= cursor + eps) advance(entity, row, cursor);
        }
        while (index < operations.length && operations[index].at <= cursor + eps) {
          const { type, raw } = operations[index++];
          if (type === 'command') command(raw, cursor);
          else apply(raw, cursor);
        }
        if (cursor === to) {
          collect(to, to, true);
          break;
        }
        let next = Math.min(to, operations[index]?.at ?? Infinity);
        for (const row of Object.values(state.active)) next = Math.min(next, deadline(row));
        check(next > cursor, 'Action clock failed to advance');
        collect(cursor, next, false);
        cursor = next;
      }
      state.time = to;
      return freeze({ state, events, outcomes, ...read(state) });
    }
    return Object.freeze({ initial, validate, read, step, signals: freeze([...signals].sort()), flags: freeze([...flags.keys()].sort()) });
  }

  function contactRow(raw) {
    check(record(raw) && id(raw.source) && id(raw.target) && raw.source !== raw.target && id(raw.kind) &&
      (raw.id === undefined || id(raw.id)) && (raw.speed === undefined || metric(raw.speed)) &&
      (raw.energy === undefined || metric(raw.energy)) && (raw.point === undefined || vector(raw.point)) &&
      (raw.normal === undefined || vector(raw.normal)), 'Invalid action contact');
    const { source, target, kind, id: key, speed, energy, point, normal } = raw;
    return { source, target, kind, ...(key && { id: key }), ...(speed !== undefined && { speed }),
      ...(energy !== undefined && { energy }), ...(point && { point: point.slice() }), ...(normal && { normal: normal.slice() }) };
  }

  function sweptBody(raw) {
    const position = value => vector(value) && value.every(n => Math.abs(n) <= 1e6);
    check(record(raw) && position(raw.from) && position(raw.to ?? raw.from) &&
      (raw.rotation === undefined || vector(raw.rotation, 9)), 'An action sweep needs a finite body pose');
    let { collider, half, radius } = raw;
    check(Number(collider !== undefined) + Number(half !== undefined) + Number(radius !== undefined) === 1,
      'An action sweep needs one collider, box or radius');
    if (radius !== undefined) {
      check(metric(radius) && radius >= .005 && radius <= 100, 'Invalid swept action radius');
      collider = { kind: 'capsule', a: zero, b: zero, radius };
    }
    if (collider) W.colliders.local(collider);
    else check(vector(half) && half.every(n => n >= .005 && n <= 1000), 'Invalid swept action box');
    return { from: raw.from, to: raw.to ?? raw.from, rotation: raw.rotation ?? identity,
      ...(collider ? { collider } : { half }) };
  }

  function sweptContact({ contact, start, end, probe, target }, low, high) {
    const a = Math.max(start, low), b = Math.min(end, high);
    if (a > b) return null;
    const duration = end - start, fraction = time => duration ? (time - start) / duration : 0;
    const posed = (body, time) => ({ ...body, position: V.mad(body.from, V.sub(body.to, body.from), fraction(time)) });
    const left = posed(probe, a), right = posed(target, a);
    const delta = V.sub(V.sub(posed(probe, b).position, left.position), V.sub(posed(target, b).position, right.position));
    const overlap = W.colliders.contact(left, right);
    const sweep = overlap ? { ...overlap, time: 0 } : b > a && W.colliders.sweep(left, right, delta);
    if (!sweep || sweep.limited) return null;
    const time = a + (b - a) * sweep.time, point = posed(probe, time).position;
    const travel = V.sub(V.sub(probe.to, probe.from), V.sub(target.to, target.from));
    const speed = duration ? Math.max(0, V.dot(travel, sweep.normal) / duration) : 0;
    return { time, contact: { ...contact, speed: contact.speed ?? speed, point, normal: sweep.normal } };
  }

  function markers(entity, events, offset = 0) {
    check(id(entity) && Array.isArray(events) && events.length <= 4096 && clock(offset), 'Invalid animation marker feed');
    return events.filter(row => row?.type === 'animation').map(row => ({ op: 'marker', entity, name: row.name, at: row.time + offset }));
  }

  W.actionWindows = Object.freeze({ create, markers });
})(KIT);
