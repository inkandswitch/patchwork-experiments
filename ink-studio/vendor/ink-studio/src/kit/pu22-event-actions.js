/* Routes named timeline and simulation events to delayed, inspectable actions. */
(function (K) {
  const W = K.world, { check, copy, endpoint, id, own, read, record, selector } = W.data;
  const { freeze } = K.procedural.data;
  const maxTick = W.runtime.maxTick, maxActions = 512;
  const prefix = (a, b) => a.length <= b.length && a.every((key, i) => key === b[i]);
  const tickOK = value => Number.isSafeInteger(value) && value >= 0 && value <= maxTick;
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const ceilTicks = (seconds, dt) => {
    const floor = Math.floor(seconds / dt);
    return floor + Number(seconds > floor * dt);
  };

  function compile(definition, { dt, validateAction, validateSource } = {}) {
    check(Number.isFinite(dt) && dt > 0 && dt <= 1, 'Event actions need a fixed step in (0, 1]');
    check(record(definition) && Object.keys(definition).length <= 128, 'Expected a bounded event action table');
    const byKind = new Map(), rules = new Map();
    const authored = copy(definition);
    for (const name of Object.keys(authored).sort()) {
      const raw = authored[name];
      check(id(name) && keys(raw, ['on', 'delay', 'limit', 'actions']), 'Invalid event action rule ' + name);
      const { on, delay = 0, limit = 1, actions } = raw;
      check(keys(on, ['kind', 'system', 'where']) && id(on.kind) && on.kind !== 'event-action-scheduled' &&
        (on.system === undefined || id(on.system)) && Number.isFinite(delay) && delay >= 0 &&
        tickOK(ceilTicks(delay, dt)) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 10000 &&
        Array.isArray(actions) && actions.length > 0 && actions.length <= 16, 'Invalid event action trigger or budget ' + name);
      W.query.condition(on.where, {});
      validateSource?.(on);
      const commands = actions.map(command => {
        check(keys(command, ['action', 'args', 'bindings']) && record(command.args ?? {}) &&
          record(command.bindings ?? {}), 'Invalid command in event action ' + name);
        endpoint(command.action);
        const args = command.args ?? {}, bindings = Object.entries(command.bindings ?? {}).map(([target, source]) => {
          const into = selector(target), from = selector(source);
          check(read(args, into) !== undefined, 'Event binding must name an existing command argument: ' + target);
          return { into, from };
        });
        check(bindings.length <= 32 && bindings.every(({ into }, index) => bindings.every(({ into: other }, i) =>
          i === index || !prefix(other, into))),
        'Event action bindings must address distinct arguments');
        validateAction?.({ action: command.action, args, tick: 1 });
        return freeze({ action: command.action, args, bindings });
      });
      const rule = { name, on, ticks: Math.max(1, ceilTicks(delay, dt)), limit, commands };
      rules.set(name, rule);
      if (!byKind.has(on.kind)) byKind.set(on.kind, []);
      byKind.get(on.kind).push(rule);
    }

    function validate(state) {
      check(record(state) && Object.entries(state).every(([name, value]) =>
        rules.has(name) && Number.isSafeInteger(value) && value > 0 && value <= rules.get(name).limit),
      'Invalid event action checkpoint');
    }

    function route(state, events, tick) {
      const commands = [], scheduled = [];
      let counts = state;
      for (const event of events) for (const { name, on, ticks, limit, commands: outputs } of byKind.get(event.kind) ?? []) {
        const count = own(counts, name) ? counts[name] : 0;
        if (count >= limit || on.system !== undefined && event.system !== on.system || !W.query.condition(on.where, event)) continue;
        const due = tick + ticks;
        check(tickOK(due) && commands.length + outputs.length <= maxActions, 'Event action schedule exceeds its budget');
        if (counts === state) counts = { ...state };
        counts[name] = count + 1;
        for (const { action, args, bindings } of outputs) {
          const changes = bindings.map(({ into, from }) => {
            const value = read(event, from);
            check(value !== undefined, 'Event action ' + name + ' needs event value ' + from.join('/'));
            return { op: 'set', path: into, value };
          });
          const resolved = changes.length ? W.apply(args, changes, { validate: null }).world : args;
          const row = { action, args: resolved, tick: due };
          commands.push(validateAction ? validateAction(row) : freeze(row));
        }
        scheduled.push({ rule: name, due, occurrence: count + 1, trigger: event.id,
          source: event.system, eventKind: event.kind, actions: outputs.map(row => row.action) });
      }
      return { counts: freeze(counts), commands, scheduled };
    }
    return Object.freeze({ validate, route });
  }

  // For stage-bound rigs and effects, recreate the authored scene on a backward seek.
  function playback({ timeline, eventActions = {}, dt = 1 / 120, build, maxSeekTicks = 36000 } = {}) {
    check(typeof build === 'function' && Number.isSafeInteger(maxSeekTicks) && maxSeekTicks >= 1 && maxSeekTicks <= maxTick,
      'Event playback needs a build callback and a bounded seek budget');
    const program = typeof timeline?.sample === 'function' ? timeline : K.timeline.compile(timeline ?? {});
    check(Array.isArray(program.events), 'Event playback needs a compiled scene timeline');
    let scene, tick, pending, pendingCount, counts, events, disposed = false;
    const validateAction = command => {
      check(own(scene.actions, command.action) && typeof scene.actions[command.action] === 'function',
        'Unknown stage event action ' + command.action);
      return freeze(command);
    };
    function reset() {
      const next = build();
      check(next?.world && typeof next.step === 'function' && record(next.actions), 'Event playback build needs a world, step and actions');
      scene?.dispose?.();
      scene = next;
      tick = 0; pending = new Map(); pendingCount = 0; counts = freeze({}); events = freeze([]);
      scene.step(0, 0, { tick, sample: program.sample(0), emit() {} });
    }
    let router;
    try {
      reset();
      router = compile(eventActions, { dt, validateAction });
    } catch (error) {
      scene?.dispose?.();
      throw error;
    }
    const timelineEvents = new Map();
    for (const cue of program.events) {
      const at = Math.max(1, ceilTicks(cue.time, dt));
      if (!timelineEvents.has(at)) timelineEvents.set(at, []);
      timelineEvents.get(at).push(cue);
    }
    function frame() {
      return Object.freeze({ world: scene.world, tick, time: tick * dt, events });
    }
    function seek(time) {
      const target = Math.round(time / dt);
      check(!disposed && Number.isFinite(time) && time >= 0 && tickOK(target), 'Invalid event playback time');
      check(target - (target < tick ? 0 : tick) <= maxSeekTicks, 'Event playback seek exceeds its tick budget');
      if (target < tick) reset();
      try {
        while (tick < target) advance();
      } catch (error) {
        reset();
        throw error;
      }
      return frame();
    }
    function advance() {
      const at = tick + 1, seconds = at * dt, emitted = [];
      const emit = (kind, detail = {}, system = 'stage') => {
        check(id(kind) && kind !== 'event-action-scheduled' && id(system) && record(detail) && emitted.length < 2048,
          'Invalid stage event or event budget exceeded');
        emitted.push(freeze({ ...copy(detail), kind, system, tick: at, id: at + '.' + emitted.length }));
      };
      const ctx = Object.freeze({ tick: at, sample: program.sample(seconds), emit });
      const due = pending.get(at) ?? [];
      for (const command of due) scene.actions[command.action](command.args, ctx);
      for (const { id, path, time, kind, detail } of timelineEvents.get(at) ?? [])
        emit(kind, { ...detail, timeline: { id, path, time } }, 'world');
      scene.step(dt, seconds, ctx);
      const routed = router.route(counts, emitted, at);
      counts = routed.counts;
      pendingCount += routed.commands.length - due.length;
      check(pendingCount <= 100000, 'Pending stage event action budget exceeded');
      pending.delete(at);
      for (const command of routed.commands) {
        if (!pending.has(command.tick)) pending.set(command.tick, []);
        pending.get(command.tick).push(command);
      }
      events = freeze([...emitted, ...routed.scheduled.map((row, index) => ({ ...row, system: 'world',
        kind: 'event-action-scheduled', tick: at, id: at + '.' + (emitted.length + index) }))]);
      tick = at;
    }
    return Object.freeze({ seek, frame, timeline: program, dispose() {
      if (disposed) return;
      disposed = true;
      scene.dispose?.();
      pending.clear();
    } });
  }
  K.eventActions = Object.freeze({ compile, playback });
})(KIT);
