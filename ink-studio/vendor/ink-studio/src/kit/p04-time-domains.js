/* Explicit shared clocks: fixed simulation, sampled animation, continuous camera/UI. */
(function (K) {
  const { freeze, clone } = K.procedural.data,
    format = 'ink-studio/time-domains',
    roots = ['simulation', 'animation', 'camera', 'interface'];
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Time domains: ' + message);
  };
  const record = v =>
    v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const fields = (v, names) => record(v) && Object.keys(v).every(k => names.includes(k));
  const name = v =>
    typeof v === 'string' &&
    /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,95}$/.test(v) &&
    !['__proto__', 'prototype', 'constructor', 'wall'].includes(v);
  const time = v => Number.isFinite(v) && v >= 0 && v <= 1e12;
  const near = (a, b) => Math.abs(a - b) <= 1e-9 + 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
  const floor = v => Math.floor(v + Number.EPSILON * Math.max(1, Math.abs(v)) * 8);
  const settingKeys = ['parent', 'rate', 'paused', 'fps', 'step', 'maxSteps', 'backlog', 'start'];
  function settings(raw = {}) {
    check(fields(raw, settingKeys), 'unknown clock setting');
    const {
      parent = null,
      rate = 1,
      paused = false,
      fps = null,
      step = null,
      maxSteps = 8,
      backlog = 'retain',
      start: initialStart = 0
    } = raw;
    let start = initialStart;
    check(
      (parent === null || name(parent)) &&
        Number.isFinite(rate) &&
        rate >= 0 &&
        rate <= 64 &&
        typeof paused === 'boolean' &&
        (fps === null || (Number.isFinite(fps) && fps > 0 && fps <= 240)) &&
        (step === null || (Number.isFinite(step) && step >= 1e-6 && step <= 60)) &&
        !(fps !== null && step !== null) &&
        Number.isSafeInteger(maxSteps) &&
        maxSteps >= 1 &&
        maxSteps <= 240 &&
        ['retain', 'drop'].includes(backlog) &&
        time(start),
      'invalid rate, cadence or fixed-step budget'
    );
    if (step !== null) {
      check(
        near(start / step, Math.round(start / step)) && Number.isSafeInteger(Math.round(start / step)),
        'fixed-step start must align to a safe tick'
      );
      start = Math.round(start / step) * step;
    }
    return { parent, rate, paused, fps, step, maxSteps, backlog, start };
  }
  function topology(rows) {
    const states = new Map(),
      depths = new Map(),
      order = [];
    function visit(id, depth) {
      check(depth <= 32, 'clock parent depth exceeds 32');
      if (states.get(id) === 2) return;
      check(states.get(id) !== 1, 'clock parent cycle');
      states.set(id, 1);
      const p = rows.get(id).settings.parent;
      if (p !== null) {
        check(rows.has(p), 'unknown parent clock ' + p);
        visit(p, depth + 1);
      }
      const d = p === null ? 0 : depths.get(p) + 1;
      check(d <= 32, 'clock parent depth exceeds 32');
      depths.set(id, d);
      states.set(id, 2);
      order.push(id);
    }
    for (const id of rows.keys()) visit(id, 0);
    return order;
  }
  function initial(s) {
    const tick = s.step === null ? 0 : Math.round(s.start / s.step);
    return {
      compensation: 0,
      settings: s,
      time: s.start,
      requested: s.start,
      sampleTime: s.fps === null ? s.start : floor(s.start * s.fps) / s.fps,
      phase: 0,
      tick,
      dropped: 0,
      dt: 0,
      sampleDt: 0,
      steps: [],
      limited: false
    };
  }
  function create(definition = {}) {
    check(fields(definition, ['domains', 'cues']), 'unknown configuration field');
    const defaults = { simulation: { step: 1 / 60 }, animation: {}, camera: {}, interface: {} };
    const defs = { ...defaults };
    for (const [id, raw] of Object.entries(definition.domains ?? {})) {
      check(name(id) && record(raw), 'invalid clock definition');
      defs[id] = { ...(defaults[id] ?? {}), ...raw };
    }
    check(record(definition.domains ?? {}) && Object.keys(defs).length <= 256, 'expected at most 256 domains');
    let rows = new Map(
        Object.entries(defs).map(([id, raw]) => {
          check(name(id), 'invalid clock ID');
          return [id, initial(settings(raw))];
        })
      ),
      order = topology(rows),
      wall = 0,
      wallCompensation = 0,
      frameId = 0,
      epoch = 0,
      serial = 0,
      cues = [],
      cache = new Map();
    const requireClock = id => {
      check(rows.has(id), 'unknown clock ' + id);
      return rows.get(id);
    };
    function parseCue(raw) {
      check(
        record(raw) &&
          name(raw.id) &&
          rows.has(raw.domain ?? 'animation') &&
          ['freeze', 'slow'].includes(raw.type) &&
          time(raw.time) &&
          Number.isFinite(raw.duration) &&
          raw.duration > 0 &&
          raw.duration <= 1e6 &&
          (raw.enabled === undefined || typeof raw.enabled === 'boolean'),
        'invalid freeze/slow cue'
      );
      const amount = raw.type === 'freeze' ? 0 : (raw.amount ?? 0.25);
      check(Number.isFinite(amount) && amount >= 0 && amount <= 4, 'invalid cue rate');
      return {
        id: raw.id,
        domain: raw.domain ?? 'animation',
        type: raw.type,
        time: raw.time,
        duration: raw.duration,
        amount,
        enabled: raw.enabled ?? true
      };
    }
    function factors(at) {
      const local = new Map(),
        effective = new Map();
      for (const id of order) {
        const s = rows.get(id).settings;
        let factor = s.paused ? 0 : s.rate;
        for (const cue of cues)
          if (cue.domain === id && cue.enabled && at >= cue.time && at < cue.time + cue.duration) factor *= cue.amount;
        local.set(id, factor);
        effective.set(id, factor * (s.parent === null ? 1 : effective.get(s.parent)));
      }
      return { local, effective };
    }
    function read(id) {
      if (cache.has(id)) return cache.get(id);
      const row = requireClock(id),
        s = row.settings,
        rates = factors(wall);
      const value = freeze({
        id,
        ...s,
        time: row.time,
        sampleTime: row.sampleTime,
        dt: row.dt,
        sampleDt: row.sampleDt,
        tick: row.tick,
        sampleIndex: s.fps === null ? (s.step === null ? null : row.tick) : floor((row.sampleTime - row.phase) * s.fps),
        steps: row.steps.map(v => ({ ...v })),
        backlogSeconds: Math.max(0, row.requested - row.time),
        droppedSeconds: row.dropped,
        limited: row.limited,
        effectiveRate: rates.effective.get(id),
        activeCues: cues
          .filter(c => c.enabled && c.domain === id && wall >= c.time && wall < c.time + c.duration)
          .map(c => c.id),
        frame: frameId,
        epoch
      });
      cache.set(id, value);
      return value;
    }
    function advance(seconds) {
      check(
        Number.isFinite(seconds) && seconds >= 0 && seconds <= 1e6 && time(wall + seconds),
        'advance needs bounded nonnegative seconds'
      );
      const wallDelta = seconds - wallCompensation,
        end = wall + wallDelta,
        nextWallCompensation = end - wall - wallDelta;
      const drafts = new Map(
          [...rows].map(([id, r]) => [
            id,
            { ...r, steps: [], dt: 0, sampleDt: 0, limited: false, budget: r.settings.maxSteps }
          ])
        ),
        boundaries = [wall, end];
      for (const cue of cues)
        if (cue.enabled)
          for (const t of [cue.time, cue.time + cue.duration]) if (t > wall && t < end) boundaries.push(t);
      const points = [...new Set(boundaries)].sort((a, b) => a - b);
      if (points.length === 1) points.push(points[0]);
      for (let j = 1; j < points.length; j++) {
        const span = points[j] - points[j - 1],
          at = span ? points[j - 1] + span / 2 : points[j],
          rates = factors(at),
          delta = new Map();
        for (const id of order) {
          const row = drafts.get(id),
            s = row.settings,
            parent = s.parent,
            local = rates.local.get(id),
            running = rates.effective.get(id) > 0,
            incoming = parent === null ? span : delta.get(parent),
            dt = incoming * local;
          check(time(row.requested + dt), 'clock exceeds its time budget');
          if (s.step !== null) {
            const correction = dt - row.compensation,
              next = row.requested + correction;
            row.compensation = next - row.requested - correction;
            row.requested = next;
            const targetTick = floor(row.requested / s.step);
            check(Number.isSafeInteger(targetTick), 'fixed tick budget exceeded');
            const due = Math.max(0, targetTick - row.tick),
              count = running ? Math.min(due, row.budget) : 0;
            for (let k = 0; k < count; k++) {
              row.tick++;
              const t = row.tick * s.step;
              row.steps.push({ tick: row.tick, time: t, dt: s.step });
            }
            const prior = row.time;
            row.time = row.tick * s.step;
            row.budget -= count;
            delta.set(id, row.time - prior);
            if (running && due > count) {
              row.limited = true;
              if (s.backlog === 'drop') {
                const discarded = (due - count) * s.step;
                row.requested -= discarded;
                row.compensation = 0;
                row.dropped += discarded;
              }
            }
          } else {
            const correction = dt - row.compensation,
              next = row.requested + correction;
            row.compensation = next - row.requested - correction;
            row.requested = next;
            row.time = next;
            delta.set(id, dt);
          }
        }
      }
      for (const [id, row] of drafts) {
        const before = rows.get(id),
          s = row.settings;
        row.sampleTime = s.fps === null ? row.time : row.phase + floor((row.time - row.phase) * s.fps) / s.fps;
        row.dt = Math.max(0, row.time - before.time);
        row.sampleDt = Math.max(0, row.sampleTime - before.sampleTime);
        check(
          time(row.time) && time(row.sampleTime) && Number.isSafeInteger(row.tick),
          'clock precision budget exceeded'
        );
        delete row.budget;
      }
      rows = drafts;
      wall = end;
      wallCompensation = nextWallCompensation;
      frameId++;
      cues = cues.filter(c => c.time + c.duration > end);
      cache.clear();
      return api;
    }
    function configure(id, patch) {
      const row = requireClock(id);
      check(fields(patch, settingKeys), 'unknown clock setting');
      const next = settings({ ...row.settings, ...patch });
      if (next.step !== row.settings.step || next.start !== row.settings.start)
        check(
          row.time === row.settings.start && row.requested === row.settings.start,
          'fixed step and start can only change before that clock advances'
        );
      const candidate = new Map(rows),
        updated = { ...row, settings: next };
      if (next.start !== row.settings.start || next.step !== row.settings.step) Object.assign(updated, initial(next));
      else if (next.fps !== row.settings.fps) {
        updated.phase = row.sampleTime;
        updated.sampleTime = next.fps === null ? row.time : row.sampleTime;
        updated.sampleDt = 0;
      }
      candidate.set(id, updated);
      const nextOrder = topology(candidate);
      rows = candidate;
      order = nextOrder;
      cache.clear();
      return api;
    }
    function cue(raw) {
      check(cues.length < 1024, 'cue budget exceeded');
      const parsed = parseCue(raw);
      check(!cues.some(c => c.id === parsed.id), 'duplicate cue ' + parsed.id);
      cues.push(parsed);
      cache.clear();
      return api;
    }
    check(
      definition.cues === undefined || (Array.isArray(definition.cues) && definition.cues.length <= 1024),
      'invalid cue list'
    );
    cues = (definition.cues ?? []).map(parseCue);
    check(new Set(cues.map(c => c.id)).size === cues.length, 'duplicate cue');
    function snapshot() {
      return {
        format,
        version: 1,
        wall,
        wallCompensation,
        frame: frameId,
        serial,
        domains: Object.fromEntries(
          [...rows].map(([id, r]) => [
            id,
            {
              settings: { ...r.settings },
              time: r.time,
              requested: r.requested,
              sampleTime: r.sampleTime,
              phase: r.phase,
              tick: r.tick,
              dropped: r.dropped,
              compensation: r.compensation
            }
          ])
        ),
        cues: cues.map(c => ({ ...c }))
      };
    }
    const baseline = snapshot();
    function restore(saved) {
      check(
        record(saved) &&
          saved.format === format &&
          saved.version === 1 &&
          time(saved.wall) &&
          Number.isFinite(saved.wallCompensation ?? 0) &&
          record(saved.domains) &&
          Object.keys(saved.domains).length <= 256 &&
          roots.every(id => Object.hasOwn(saved.domains, id)) &&
          Number.isSafeInteger(saved.frame) &&
          saved.frame >= 0 &&
          Number.isSafeInteger(saved.serial) &&
          saved.serial >= 0 &&
          Array.isArray(saved.cues) &&
          saved.cues.length <= 1024,
        'invalid checkpoint'
      );
      const candidate = new Map(
          Object.entries(saved.domains).map(([id, r]) => {
            check(name(id) && record(r), 'invalid clock checkpoint');
            const s = settings(r.settings);
            check(
              [r.time, r.requested, r.sampleTime, r.phase, r.dropped].every(time) &&
                r.requested >= r.time - 1e-8 &&
                r.sampleTime <= r.time + 1e-8 &&
                r.phase <= r.sampleTime + 1e-8 &&
                Number.isFinite(r.compensation ?? 0) &&
                (s.fps === null
                  ? near(r.sampleTime, r.time)
                  : near((r.sampleTime - r.phase) * s.fps, Math.round((r.sampleTime - r.phase) * s.fps))) &&
                Number.isSafeInteger(r.tick) &&
                r.tick >= 0 &&
                (s.step === null || near(r.time, r.tick * s.step)),
              'inconsistent clock checkpoint'
            );
            return [
              id,
              {
                ...initial(s),
                time: r.time,
                requested: r.requested,
                sampleTime: r.sampleTime,
                phase: r.phase,
                tick: r.tick,
                dropped: r.dropped,
                compensation: r.compensation ?? 0
              }
            ];
          })
        ),
        nextOrder = topology(candidate);
      const old = rows;
      rows = candidate;
      let parsed;
      try {
        parsed = saved.cues.map(parseCue);
        check(new Set(parsed.map(c => c.id)).size === parsed.length, 'duplicate cue checkpoint');
      } catch (error) {
        rows = old;
        throw error;
      }
      order = nextOrder;
      wall = saved.wall;
      wallCompensation = saved.wallCompensation ?? 0;
      frameId = saved.frame;
      serial = saved.serial;
      cues = parsed;
      epoch++;
      cache.clear();
      return api;
    }
    const api = Object.freeze({
      get wall() {
        return wall;
      },
      get frameId() {
        return frameId;
      },
      get epoch() {
        return epoch;
      },
      has: id => rows.has(id),
      ids: () => Array.from(rows.keys()),
      read,
      advance,
      configure,
      add(id, raw = {}) {
        check(name(id) && !rows.has(id) && rows.size < 256, 'invalid or duplicate clock ID');
        const candidate = new Map(rows);
        candidate.set(id, initial(settings(raw)));
        const nextOrder = topology(candidate);
        rows = candidate;
        order = nextOrder;
        cache.clear();
        return api;
      },
      pause: (id, paused = true) => configure(id, { paused }),
      rate: (id, rate) => configure(id, { rate }),
      fps: (id, fps) => configure(id, { fps }),
      cue,
      hold(id, duration) {
        requireClock(id);
        let next = serial + 1;
        while (cues.some(c => c.id === 'hold.' + next)) next++;
        const key = 'hold.' + next;
        cue({ id: key, domain: id, type: 'freeze', time: wall, duration });
        serial = next;
        return key;
      },
      cancel(id) {
        cues = cues.filter(c => c.id !== id);
        cache.clear();
        return api;
      },
      snapshot,
      restore,
      reset: () => restore(baseline),
      frame(options = {}) {
        return renderFrame({ timeDomains: api }, options);
      }
    });
    return api;
  }
  function renderFrame(world, options = {}) {
    const clocks = options.timeDomains ?? world?.timeDomains;
    if (!clocks) return options;
    check(typeof clocks.read === 'function', 'expected a live time-domain set');
    return {
      ...options,
      timeDomains: clocks,
      time: options.time ?? clocks.read('animation').sampleTime,
      cameraTime: options.cameraTime ?? clocks.read('camera').sampleTime,
      interfaceTime: options.interfaceTime ?? clocks.read('interface').sampleTime,
      simulationTime: options.simulationTime ?? clocks.read('simulation').time,
      stepAnimation: options.stepAnimation ?? false
    };
  }
  function simulation(clocks, run, { domain = 'simulation', maxSteps = 240 } = {}) {
    check(
      clocks?.read && run?.view && run?.step && Number.isSafeInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 240,
      'expected clocks and a fixed-step simulation'
    );
    const view = run.view(),
      dt = view.world.dt,
      c = clocks.read(domain);
    if (c.step !== dt || !near(c.time, view.time)) {
      check(c.time === c.start && clocks.wall === 0, 'simulation clock must match the current run');
      clocks.configure(domain, { step: dt, fps: null, start: view.time });
    }
    let busy = false;
    function target() {
      const c = clocks.read(domain),
        v = run.view();
      check(near(v.world.dt, c.step), 'simulation step changed');
      check(v.time <= c.time + 1e-8, 'restore the matching simulation checkpoint with its clocks');
      return Math.min(Math.round(c.time / dt), v.tick + maxSteps);
    }
    return Object.freeze({
      update() {
        check(!busy, 'simulation update already in progress');
        const end = target();
        while (run.view().tick < end) run.step();
        return run.view();
      },
      async updateAsync() {
        check(!busy, 'simulation update already in progress');
        busy = true;
        try {
          const end = target();
          while (run.view().tick < end) await run.stepAsync();
          return run.view();
        } finally {
          busy = false;
        }
      },
      status: () => ({
        domain,
        targetTime: clocks.read(domain).time,
        time: run.view().time,
        tick: run.view().tick,
        busy
      })
    });
  }
  K.timeDomains = Object.freeze({
    create,
    restore: saved =>
      create({
        domains: Object.fromEntries(Object.entries(saved.domains).map(([id, r]) => [id, r.settings])),
        cues: saved.cues
      }).restore(saved),
    frame: renderFrame,
    simulation
  });
})(KIT);
