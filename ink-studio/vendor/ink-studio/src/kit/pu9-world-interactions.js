/* Durable named world actions and authored effects at the publication boundary. */
(function (K) {
  const W = K.world, { clone, freeze } = K.procedural.data;
  const { safeKey, own, record } = W.data;
  const format = 'ink-studio/world-interactions';
  const integer = Number.isSafeInteger, finite = Number.isFinite;
  const nonnegative = value => integer(value) && value >= 0;
  const positive = value => integer(value) && value > 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const byDue = (a, b) => a.at - b.at || order(a.target, b.target) || order(a.id, b.id);
  const json = value => freeze(clone(value));

  function synchronous(value, label) {
    if (typeof value?.then === 'function') {
      Promise.resolve(value).catch(() => {});
      throw new TypeError(label + ' must be synchronous');
    }
    return value;
  }

  function create({ id = 'world', interactables, realize } = {}) {
    if (!safeKey(id) || !Array.isArray(interactables) || typeof realize !== 'function')
      throw new TypeError('World interactions need an ID, interactables and a realization callback');
    const definitions = new Map(), listeners = new Set();
    const actionsFor = target => definitions.get(target)?.actions;
    function checkedState(value, validate) {
      const state = json(value);
      if (validate && !synchronous(validate(state), 'Interactable state validation'))
        throw new TypeError('Invalid interactable state');
      return state;
    }
    for (const row of interactables) {
      if (!safeKey(row?.id) || definitions.has(row.id) || !record(row.actions) ||
          row.validate !== undefined && typeof row.validate !== 'function')
        throw new TypeError('Interactables need unique IDs, named actions and optional state validation');
      const actions = new Map(Object.entries(row.actions));
      if ([...actions].some(([verb, run]) => !safeKey(verb) || typeof run !== 'function'))
        throw new TypeError('Interactable actions need valid names and callbacks');
      definitions.set(row.id, { actions, initial: checkedState(row.initial, row.validate), validate: row.validate,
        point: row.point === undefined ? null : json(row.point) });
      const point = definitions.get(row.id).point;
      if (row.point !== undefined && (!Array.isArray(point) || point.length !== 3 || !point.every(finite)))
        throw new TypeError('An interactable point must be finite XYZ');
    }
    let save = null, current = null, queue = Promise.resolve();
    function enqueue(work) {
      const pending = queue.then(work);
      queue = pending.catch(() => {});
      return pending;
    }
    function initialized() {
      if (save === null) throw new Error('Restore the interaction world before dispatching actions');
    }
    function publish(next, revision) {
      if (revision === undefined) throw new TypeError('Interaction realization must return a world revision');
      const snapshot = Object.freeze({ ...next, revision });
      save = next;
      current = snapshot;
      return snapshot;
    }
    function restore(checkpoint) {
      const stored = checkpoint === undefined ? null : json(checkpoint);
      return enqueue(async () => {
        if (save) throw new Error('Restore needs a fresh interaction world');
        if (checkpoint !== undefined && (!record(stored) || stored.format !== format || stored.version !== 1 ||
            stored.id !== id || !nonnegative(stored.tick) || !nonnegative(stored.sequence) ||
            !record(stored.states) || !Array.isArray(stored.timers) ||
            Object.keys(stored.states).some(key => !definitions.has(key))))
          throw new TypeError('Invalid interaction checkpoint for this world');
        const tick = stored?.tick ?? 0, states = {};
        for (const [key, definition] of definitions)
          states[key] = own(stored?.states, key) ? checkedState(stored.states[key], definition.validate) : definition.initial;
        const timerIds = new Set();
        const timers = (stored?.timers ?? []).map(row => {
          const key = JSON.stringify([row?.target, row?.id]);
          if (!safeKey(row?.id) || !actionsFor(row.target)?.has(row.action) || !nonnegative(row.at) ||
              row.at < tick || timerIds.has(key) || !own(row, 'args'))
            throw new TypeError('Invalid timer in interaction checkpoint');
          timerIds.add(key);
          return row;
        }).sort(byDue);
        const next = freeze({ format, version: 1, id, tick, sequence: stored?.sequence ?? 0, states, timers });
        return publish(next, await realize(Object.freeze({ ...next, event: null }), null));
      });
    }
    function timerChanges(before, changes, target, tick, due) {
      const retained = before.filter(row => row !== due && !(row.target === target && own(changes, row.id)));
      for (const [key, rule] of Object.entries(changes ?? {})) {
        if (!safeKey(key)) throw new TypeError('Timers need stable names');
        if (rule === null) continue;
        if (!record(rule) || !positive(rule.after) || !integer(tick + rule.after) || !actionsFor(target).has(rule.action))
          throw new TypeError('A timer needs a positive tick delay and a named action on the same interactable');
        retained.push({ id: key, target, at: tick + rule.after, action: rule.action, args: json(rule.args ?? null) });
      }
      return retained.sort(byDue);
    }
    async function attempt(command, tick, due = null) {
      const { target, action, actor, args } = command, definition = definitions.get(target);
      const before = current, state = save.states[target];
      const handler = definition.actions.get(action);
      const result = synchronous(handler(Object.freeze({ state, states: save.states, revision: before.revision,
        point: definition.point, actor, args, tick, timer: due?.id ?? null })), 'Interactable actions');
      if (result == null) {
        if (due) publish(freeze({ ...save, tick, timers: save.timers.filter(row => row !== due) }), before.revision);
        return null;
      }
      if (!record(result) || !own(result, 'state') ||
          result.timers !== undefined && !record(result.timers) ||
          result.point != null && !W.data.vector(result.point) ||
          result.cue !== undefined && !safeKey(result.cue))
        throw new TypeError('A successful action needs state and can supply timers, a cue, an XYZ point and JSON detail');
      const sequence = save.sequence + 1;
      if (!integer(sequence)) throw new RangeError('Interaction sequence overflow');
      const nextState = checkedState(result.state, definition.validate);
      const timers = timerChanges(save.timers, result.timers, target, tick, due);
      const next = freeze({ ...save, sequence, tick, timers, states: { ...save.states, [target]: nextState } });
      const event = freeze({ world: id, sequence, tick, target, action,
        point: result.point === undefined ? definition.point : json(result.point),
        actor, timer: due?.id ?? null, cue: result.cue ?? null, detail: json(result.detail ?? null) });
      const revision = await realize(Object.freeze({ ...next, event }), before);
      const snapshot = publish(next, revision), errors = [];
      for (const listener of [...listeners]) {
        try { synchronous(listener(event, snapshot, before), 'Interaction event listeners'); }
        catch (error) { errors.push(error); }
      }
      return Object.freeze({ snapshot, event, errors: Object.freeze(errors) });
    }
    function dispatch(target, action, { actor = null, args = null, expectedSequence } = {}) {
      if (!actionsFor(target)?.has(action)) throw new RangeError('Unknown interactable or action');
      if (expectedSequence !== undefined && !nonnegative(expectedSequence))
        throw new RangeError('Expected a nonnegative interaction sequence');
      const command = Object.freeze({ target, action, actor: json(actor), args: json(args) });
      return enqueue(() => {
        initialized();
        if (expectedSequence !== undefined && save.sequence !== expectedSequence) return null;
        return attempt(command, save.tick);
      });
    }
    function advance(to, { limit = 1024 } = {}) {
      if (!nonnegative(to) || !positive(limit)) throw new RangeError('Timer advancement needs a tick and a positive action limit');
      return enqueue(async () => {
        initialized();
        if (to < save.tick) throw new RangeError('The interaction clock cannot move backward');
        const outcomes = [];
        for (let i = 0; i < limit && save.timers[0]?.at <= to; i++) {
          const due = save.timers[0];
          const result = await attempt({ ...due, actor: null }, due.at, due);
          if (result) outcomes.push(Object.freeze({ event: result.event, errors: result.errors }));
        }
        const complete = !(save.timers[0]?.at <= to);
        if (complete && to !== save.tick) publish(freeze({ ...save, tick: to }), current.revision);
        return Object.freeze({ tick: save.tick, complete, outcomes: Object.freeze(outcomes) });
      });
    }
    return Object.freeze({
      restore, dispatch, advance, current: () => current, checkpoint: () => save,
      onEvent(listener) {
        if (typeof listener !== 'function') throw new TypeError('Expected an interaction event listener');
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    });
  }

  function breakable({ id, point, integrity = 1, breakCue = 'break', impactCue = 'impact' } = {}) {
    if (!finite(integrity) || integrity <= 0) throw new RangeError('A breakable needs positive integrity');
    return {
      id, point, initial: { remaining: integrity },
      validate: state => finite(state?.remaining) && state.remaining >= 0 && state.remaining <= integrity,
      actions: {
        hit({ state, args }) {
          const amount = args?.amount ?? 1;
          if (!finite(amount) || amount <= 0) throw new RangeError('Impact needs a positive amount');
          if (state.remaining === 0) return null;
          const remaining = Math.max(0, state.remaining - amount);
          if (remaining === state.remaining) return null;
          return { state: { remaining }, cue: remaining ? impactCue : breakCue, detail: { amount, remaining } };
        }
      }
    };
  }
  function latch({ id, point, ticks = 0, onCue = 'switch-on', offCue = 'switch-off' } = {}) {
    if (!nonnegative(ticks)) throw new RangeError('A switch duration must be a nonnegative integer tick count');
    return {
      id, point, initial: { active: false }, validate: state => typeof state?.active === 'boolean',
      actions: {
        press({ state }) {
          const active = ticks > 0 || !state.active;
          return { state: { active }, cue: active ? onCue : offCue,
            ...(ticks ? { timers: { reset: { after: ticks, action: 'reset' } } } : {}) };
        },
        reset({ state, timer }) {
          return timer === 'reset' && state.active ? { state: { active: false }, cue: offCue } : null;
        }
      }
    };
  }
  W.interactions = Object.freeze({ create, breakable, latch, components: W.interactionComponents });
})(KIT);
