/* Exact discrete cycle search, shared periodic clocks, and checkpoint-backed output loops. */
(function (K) {
  const finite = Number.isFinite, { freeze } = K.procedural.data;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const check = (ok, message) => { if (!ok) throw new RangeError('Loop authoring: ' + message); };
  const sizeLimit = Symbol('cycle state size');

  // Compare canonical contents rather than object identities or hash matches.
  function stateKey(value, limit) {
    let size = 0;
    function append(part) {
      size += part.length;
      if (size > limit) throw sizeLimit;
      return part;
    }
    function key(node, depth) {
      check(depth <= 32, 'cycle state is too deep or circular');
      if (node === null || typeof node === 'boolean' || finite(node) || typeof node === 'string') {
        if (typeof node === 'string' && node.length + 2 > limit - size) throw sizeLimit;
        return append(Object.is(node, -0) ? '-0' : JSON.stringify(node));
      }
      if (Array.isArray(node) || ArrayBuffer.isView(node) && Number.isSafeInteger(node.length)) {
        if (node.length > limit - size) throw sizeLimit;
        append('[]');
        return '[' + Array.from(node, (item, i) => (i ? append(',') : '') + key(item, depth + 1)).join('') + ']';
      }
      check(record(node), 'cycle state must contain finite numbers, strings, booleans, null, arrays or records');
      const keys = Object.keys(node).sort();
      if (keys.length > limit - size) throw sizeLimit;
      append('{}');
      return '{' + keys.map((name, i) => {
        if (name.length + 3 > limit - size) throw sizeLimit;
        return (i ? append(',') : '') + append(JSON.stringify(name) + ':') + key(node[name], depth + 1);
      }).join('') + '}';
    }
    return key(value, 0);
  }

  function detect({ stateAt, from = 0, maxTicks = 4096, confirm = 1, maxStateChars = 16000000 } = {}) {
    check(typeof stateAt === 'function' && integer(from, 0, Number.MAX_SAFE_INTEGER) && integer(maxTicks, 1, 100000) &&
      Number.isSafeInteger(from + maxTicks) && integer(confirm, 0, 8) && integer(maxStateChars, 1, 64000000),
    'expected a state sampler, bounded search and confirmation count');
    const recent = new Map(), states = [];
    let candidate, chars = 0;
    for (let tick = from; tick <= from + maxTicks; tick++) {
      let key;
      try { key = stateKey(stateAt(tick), maxStateChars); }
      catch (error) {
        if (error !== sizeLimit) throw error;
        return Object.freeze({ found: false, reason: 'state-budget', examined: states.length });
      }
      const prior = recent.get(key);
      if (prior === undefined) {
        chars += key.length;
        if (chars > maxStateChars) return Object.freeze({ found: false, reason: 'state-budget', examined: states.length });
      }
      if (candidate && key !== states[tick - candidate.periodTicks - from]) candidate = undefined;
      if (!candidate && prior !== undefined) candidate = { startTick: prior, endTick: tick, periodTicks: tick - prior };
      states.push(prior === undefined ? key : states[prior - from]);
      recent.set(key, tick);
      if (candidate && (tick - candidate.endTick) / candidate.periodTicks >= confirm)
        return Object.freeze({ found: true, ...candidate, confirmedThrough: tick, examined: states.length });
    }
    return Object.freeze({ found: false, reason: 'tick-budget', examined: states.length });
  }

  function wrap(turns) {
    const phase = turns - Math.floor(turns), tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(turns));
    return phase <= tolerance || 1 - phase <= tolerance ? 0 : phase;
  }
  function clock(period, from) {
    check(finite(period) && period >= 1e-6 && period <= 1e6 && finite(from) &&
      finite(from + period) && from + period > from, 'expected a bounded period and origin in seconds');
    return time => {
      check(finite(time), 'sample time must be finite');
      const turns = (time - from) / period;
      check(Math.abs(turns) <= 1e9, 'sample time exceeds the phase clock range');
      return time === from + Math.round(turns) * period ? 0 : wrap(turns);
    };
  }

  function phaseLock({ period, from = 0, tracks } = {}) {
    const phaseAt = clock(period, from);
    check(record(tracks) && integer(Object.keys(tracks).length, 1, 64), 'expected named periodic tracks');
    const fitted = freeze(Object.fromEntries(Object.entries(tracks).map(([id, descriptor]) => {
      const { period: nativePeriod, turns = Math.max(1, Math.round(period / nativePeriod)), phase = 0 } = descriptor ?? {};
      check(id.trim().length > 0 && id.length <= 96 && record(descriptor) &&
        finite(nativePeriod) && nativePeriod >= 1e-6 && nativePeriod <= 1e6 &&
        integer(turns, -4096, 4096) && turns !== 0 && finite(phase) && Math.abs(phase) <= 1e6,
      'track needs a native period, nonzero integer turns and finite phase');
      return [id, { period: nativePeriod, turns, phase: wrap(phase), rate: turns * nativePeriod / period }];
    })));
    return Object.freeze({ from, period, tracks: fitted, phaseAt,
      sample(id, time) {
        check(Object.hasOwn(fitted, id), 'unknown periodic track ' + String(id));
        const row = fitted[id], phase = wrap(row.phase + phaseAt(time) * row.turns);
        return { phase, time: phase * row.period, rate: row.rate, turns: row.turns };
      }
    });
  }

  function fromCheckpoint(checkpoint, { open, read, blend, periodTicks, overlapTicks = Math.ceil(periodTicks / 5),
    dt, from = 0, startTick = checkpoint?.tick ?? 0, interpolate = true } = {}) {
    check(typeof open === 'function' && typeof read === 'function' && typeof blend === 'function' &&
      integer(periodTicks, 2, 4094) && integer(overlapTicks, 1, periodTicks - 1) &&
      periodTicks + overlapTicks + 1 <= 4096 && typeof interpolate === 'boolean' &&
      integer(startTick, 0, Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(startTick + periodTicks + overlapTicks),
    'expected checkpoint readers, a blend function and a bounded period and overlap in ticks');
    const solver = open(checkpoint);
    check(typeof solver?.step === 'function' && (solver.tick === undefined || solver.tick === startTick),
      'open must return a replay at the checkpoint tick');
    dt ??= solver.dt;
    check(finite(dt) && dt > 0 && (solver.dt === undefined || solver.dt === dt),
      'the loop and solver need the same positive fixed timestep');
    const period = periodTicks * dt, phaseAt = clock(period, from);
    const frames = Array.from({ length: periodTicks + overlapTicks + 1 }, (_, i) => {
      if (i) solver.step(1);
      const tick = startTick + i;
      check(solver.tick === undefined || solver.tick === tick, 'solver must advance exactly one tick');
      return read(solver, tick);
    });

    function windowAt(time) {
      const phase = phaseAt(time), position = phase * periodTicks;
      const rounded = Math.round(position);
      const head = rounded < periodTicks && Math.abs(position - rounded) <= 8 * Number.EPSILON * periodTicks
        ? rounded : position;
      const fraction = Math.min(1, head / overlapTicks);
      return { phase, head, tail: fraction === 1 ? null : periodTicks + head,
        headWeight: fraction * fraction * (3 - 2 * fraction) };
    }
    function describe(time) {
      const { phase, head, tail, headWeight } = windowAt(time);
      return { phase, headTick: startTick + head, tailTick: tail === null ? null : startTick + tail, headWeight };
    }
    function frameAt(position) {
      const low = Math.floor(position), fraction = position - low;
      return interpolate && fraction ? blend(frames[low], frames[low + 1], fraction) : frames[low];
    }
    function sample(time) {
      const { head, tail, headWeight } = windowAt(time);
      if (headWeight === 0) return frameAt(tail);
      if (tail === null) return frameAt(head);
      return blend(frameAt(tail), frameAt(head), headWeight);
    }
    return Object.freeze({ from, period, dt, periodTicks, overlapTicks, startTick,
      join: Object.freeze({ from, end: from + period, sourceTick: startTick + periodTicks }),
      describe, sample });
  }

  K.loopAuthoring = Object.freeze({ detect, phaseLock, fromCheckpoint });
})(KIT);
