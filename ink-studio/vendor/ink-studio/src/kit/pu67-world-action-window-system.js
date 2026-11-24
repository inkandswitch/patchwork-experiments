/* Fixed-tick ports for the renderer-independent action window clock. */
(function (K) {
  const W = K.world, { check, id, record } = W.data;

  function actionWindows(config) {
    const machine = W.actionWindows.create(config), channels = config.contactChannels ?? [];
    check(Array.isArray(channels) && channels.length <= 16 && new Set(channels).size === channels.length &&
      channels.every(key => id(key) && !['commands', 'contacts', 'sweeps'].includes(key)), 'Invalid action contact channels');
    const inputs = { commands: 'event', contacts: 'event', sweeps: 'event' }, outputs = { events: 'event' };
    for (const channel of channels) inputs[channel] = 'event';
    for (const key of machine.signals) outputs['signal.' + key] = 'event';
    for (const key of machine.flags) outputs['flag.' + key] = 'bool';

    function step(state, ctx) {
      const to = ctx.time, from = state.clock.time;
      const absolute = fraction => {
        if (fraction === undefined) return undefined;
        check(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1, 'Action port times must be fractions of the evaluation');
        return from + (to - from) * fraction;
      };
      const event = raw => {
        check(record(raw), 'Action ports expect event records');
        return { ...raw, at: absolute(raw.at) };
      };
      const contacts = [ctx.input.contacts, ...channels.map(key => ctx.input[key])].flat().map(event);
      const commands = ctx.input.commands.map(event);
      const sweeps = ctx.input.sweeps.map(raw => ({ ...event(raw), start: absolute(raw.start), end: absolute(raw.end) }));
      const result = machine.step(state.clock, { to, commands, contacts, sweeps });
      const trace = [...result.events, ...result.outcomes.map(({ kind, id: contactId, ...row }) => ({
        ...row, contactKind: kind, ...(contactId && { contactId }), type: 'action-outcome'
      }))];
      trace.sort((a, b) => a.time - b.time);
      for (const { type, ...detail } of trace) ctx.emit(type, detail);
      return { clock: result.state, events: result.events, outcomes: result.outcomes };
    }
    function output(state) {
      const out = { events: state.events };
      for (const key of machine.signals) out['signal.' + key] = [];
      for (const row of state.outcomes) out['signal.' + row.signal].push(row);
      for (const [key, raised] of Object.entries(machine.read(state.clock).flags)) out['flag.' + key] = raised;
      return out;
    }
    return {
      inputs, outputs, step, output,
      initial: () => ({ clock: machine.initial(), events: [], outcomes: [] }),
      settleInitial: (state, { query }) => ({ ...state, clock: machine.initial(query.time) }),
      validateState(state) {
        check(record(state) && Array.isArray(state.events) && state.events.length <= 4096 &&
          Array.isArray(state.outcomes) && state.outcomes.length <= 4096 &&
          state.outcomes.every(row => record(row) && machine.signals.includes(row.signal)), 'Invalid saved action outputs');
        machine.validate(state.clock);
      },
      fields: {
        state: { type: 'record', read: ({ state }) => W.query.ok({
          time: state.clock.time, ...machine.read(state.clock), spent: state.clock.spent
        }) },
        outcomes: { type: 'records', read: ({ state }) => W.query.ok(state.outcomes) }
      }
    };
  }

  W.runtime.register('action-windows', actionWindows);
})(KIT);
