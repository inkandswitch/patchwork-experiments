/* Fixed-tick authoring and replay of data-only simulation marks. */
(function (K) {
  const { clone, freeze } = K.procedural.data, V = K.V, finite = Number.isFinite;
  const format = 'ink-studio/simulation-inputs', checkpointFormat = format + '-checkpoint';
  const kinds = ['pin', 'brush', 'obstacle', 'inject'];
  const maxMarks = 4096, maxCells = 65536, maxTick = 10000000, maxAdvance = 10000;
  const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  const record = value => value != null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const idOK = id => typeof id === 'string' && /^[A-Za-z][\w./-]{0,127}$/.test(id);
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 180;
  const point = p => Array.isArray(p) && p.length === 3 && Array.from(p).every(n => finite(n) && Math.abs(n) <= 1e12);
  const address = at => text(at) || Array.isArray(at) && [2, 3].includes(at.length) &&
    Array.from(at).every((v, i) => integer(v, 0, maxCells - 1) || i === 0 && at.length === 3 && text(v));
  const check = (ok, message) => { if (!ok) throw new RangeError('Simulation inputs: ' + message); };

  function markFor(raw) {
    const { id, tick, kind, cells, stroke, value, enabled, mode } = raw ?? {};
    const writing = kind === 'brush' || kind === 'inject';
    check(record(raw) && Object.keys(raw).every(key => ['id', 'tick', 'kind', 'cells', 'stroke', 'value', 'enabled', 'mode'].includes(key)) &&
      idOK(id) && integer(tick, 0, maxTick) && kinds.includes(kind) && (cells === undefined) !== (stroke === undefined) &&
      (enabled === undefined || !writing && typeof enabled === 'boolean') &&
      (mode === undefined || writing && ['replace', 'add'].includes(mode)), 'invalid mark ID, tick, kind, selection or settings');
    const values = record(value) ? Object.values(value) : null;
    check((value === undefined ? !writing : kind !== 'obstacle' && (finite(value) ||
      values && integer(values.length, 1, 12) && values.every(finite))), 'marks need finite state values');
    if (cells !== undefined) {
      check(Array.isArray(cells) && integer(cells.length, 1, maxCells) && Array.from(cells).every(address),
        'cell selection needs valid simulation addresses');
    } else {
      const { points, radius, falloff = 'flat' } = stroke ?? {};
      check(record(stroke) && Object.keys(stroke).every(key => ['points', 'radius', 'falloff'].includes(key)) &&
        Array.isArray(points) && integer(points.length, 1, 128) && Array.from(points).every(point) &&
        finite(radius) && radius > 0 && radius <= 1e12 && (falloff === 'flat' || writing && falloff === 'smooth'),
        'stroke needs bounded XYZ points, a positive radius and an applicable falloff');
    }
    return freeze(clone({ id, tick, kind, ...(cells !== undefined ? { cells } : { stroke }),
      ...(value !== undefined && { value }), ...(writing ? { mode: mode ?? (kind === 'brush' ? 'replace' : 'add') }
        : { enabled: enabled ?? true }) }));
  }

  function documentFor(seed, dt, marks) {
    check(Number.isSafeInteger(seed) && finite(dt) && dt > 0 && finite(maxTick * dt) &&
      Array.isArray(marks) && marks.length <= maxMarks, 'expected a seed, positive timestep and bounded marks');
    const edits = Array.from(marks, markFor);
    check(new Set(edits.map(mark => mark.id)).size === edits.length &&
      edits.reduce((count, mark) => count + (mark.cells?.length ?? mark.stroke.points.length), 0) <= 262144,
      'mark IDs must be distinct and selections must fit the input budget');
    return freeze({ format, version: 1, seed, dt, marks: edits });
  }

  function validate(data) {
    check(record(data) && data.format === format && data.version === 1 && Object.hasOwn(data, 'seed') &&
      Object.hasOwn(data, 'dt') && Object.hasOwn(data, 'marks'), 'expected an Ink Studio simulation input record');
    return documentFor(data.seed, data.dt, data.marks);
  }

  function session({ seed = 0, dt, marks = [], build } = {}, saved) {
    check(typeof build === 'function' && Number.isSafeInteger(seed), 'expected a seeded solver builder');
    const solver = build(seed);
    check(solver?.tick === 0 && ['step', 'frame', 'compile', 'checkpoint', 'restore'].every(key => typeof solver[key] === 'function'),
      'bound solvers must start at tick zero and provide step, frame, compile, checkpoint and restore');
    dt ??= solver.dt ?? 1;
    check(solver.dt === undefined || dt === solver.dt, 'input and solver timesteps must match');
    let data = documentFor(seed, dt, marks), schedule = compile(data), busy = false;
    const origin = solver.checkpoint();
    runMarks(schedule, 0);
    if (saved !== undefined) {
      check(integer(saved.tick, 0, maxTick) && Object.hasOwn(saved, 'state'), 'invalid input checkpoint');
      solver.restore(saved.state);
      check(solver.tick === saved.tick, 'input checkpoint tick does not match solver state');
    }

    function compile(document) {
      const times = new Map();
      let work = 0;
      for (const mark of document.marks) {
        work += solver.markWork?.(mark) ?? 0;
        check(work <= 48000000, 'stroke selections exceed work budget');
        const apply = solver.compile(mark);
        check(typeof apply === 'function', 'solver must compile marks into input operations');
        if (!times.has(mark.tick)) times.set(mark.tick, []);
        times.get(mark.tick).push(apply);
      }
      return times;
    }

    function runMarks(times, tick) {
      for (const apply of times.get(tick) ?? []) apply();
      check(solver.tick === tick, 'an input operation changed the solver tick');
    }

    function advance(target, times, rewind) {
      if (rewind) {
        solver.restore(origin);
        runMarks(times, 0);
      }
      for (let tick = solver.tick + 1; tick <= target; tick++) {
        solver.step(1);
        check(solver.tick === tick, 'bound solver did not advance by one tick');
        runMarks(times, tick);
      }
    }

    function transaction(apply) {
      check(!busy, 'cannot change inputs during replay');
      const before = solver.checkpoint();
      busy = true;
      try { return apply(); }
      catch (error) {
        solver.restore(before);
        throw error;
      } finally { busy = false; }
    }

    function seek(tick) {
      check(!busy && integer(tick, 0, maxTick), 'expected a fixed tick outside active replay');
      const current = solver.tick, rewind = tick < current;
      if (tick === current) return solver.frame();
      check(tick - (rewind ? 0 : current) <= maxAdvance, 'seek exceeds the replay budget');
      return transaction(() => {
        advance(tick, schedule, rewind);
        return solver.frame();
      });
    }

    function seekTime(time) {
      check(finite(time) && time >= 0, 'expected a finite nonnegative simulation time');
      const ratio = time / dt;
      return seek(Math.floor(ratio + 4 * Number.EPSILON * Math.max(1, ratio)));
    }

    function replace(edits) {
      check(!busy, 'cannot change inputs during replay');
      const next = documentFor(seed, dt, edits), tick = solver.tick, plan = compile(next);
      const past = source => JSON.stringify(source.marks.filter(mark => mark.tick <= tick));
      const changed = past(next) !== past(data);
      check(!changed || tick <= maxAdvance, 'editing earlier inputs exceeds the replay budget');
      const frame = changed ? transaction(() => {
        advance(tick, plan, true);
        return solver.frame();
      }) : solver.frame();
      data = next; schedule = plan;
      return frame;
    }

    return Object.freeze({
      seed, dt, get tick() { return solver.tick; },
      frame: () => solver.frame(), seek, seekTime,
      step(count = 1) {
        check(integer(count, 1, maxAdvance), 'expected a positive step count within the replay budget');
        return seek(solver.tick + count);
      },
      replace,
      put(mark) {
        const index = data.marks.findIndex(row => row.id === mark?.id);
        const edit = { tick: data.marks[index]?.tick ?? solver.tick, ...mark };
        const next = data.marks.slice();
        if (index === -1) next.push(edit);
        else next[index] = edit;
        return replace(next);
      },
      remove(id) {
        check(idOK(id), 'expected a mark ID');
        return replace(data.marks.filter(mark => mark.id !== id));
      },
      record: () => data,
      checkpoint: () => ({ format: checkpointFormat, version: 1, inputs: data, tick: solver.tick, state: solver.checkpoint() })
    });
  }

  function open(data, { build } = {}) {
    const saved = data?.format === checkpointFormat ? data : undefined;
    check(!saved || saved.version === 1, 'invalid input checkpoint version');
    return session({ ...validate(saved ? saved.inputs : data), build }, saved);
  }

  function footprint(stroke, sites) {
    const { points, radius, falloff = 'flat' } = stroke;
    const ends = points.length === 1 ? points : points.slice(1);
    const segments = ends.map((b, i) => {
      const a = points[i], delta = V.sub(b, a);
      return { a, delta, length2: V.dot(delta, delta) };
    });
    const box = points[0].map((_, axis) => [Math.min(...points.map(row => row[axis])) - radius,
      Math.max(...points.map(row => row[axis])) + radius]);
    const selection = [];
    for (const site of sites) {
      const p = site.position;
      if (!p || !p.every((value, axis) => value >= box[axis][0] && value <= box[axis][1])) continue;
      let nearest = Infinity;
      for (const { a, delta, length2 } of segments) {
        const t = length2 > 0 ? Math.min(1, Math.max(0, V.dot(V.sub(p, a), delta) / length2)) : 0;
        nearest = Math.min(nearest, V.dist(p, V.mad(a, delta, t)));
      }
      if (nearest > radius) continue;
      const d = nearest / radius, weight = falloff === 'flat' ? 1 : (1 - d) ** 2 * (1 + 2 * d);
      if (weight > 0) selection.push({ site, weight });
    }
    return selection;
  }

  function binding(sim, { sites, lookup, read, write, frame, checkpoint, channels, coverage }) {
    const states = sim.states, clamp = (value, max) => Math.max(0, Math.min(max, value));
    function compile(mark) {
      const { kind, value, mode, enabled } = mark;
      const smooth = mark.stroke?.falloff === 'smooth';
      if (value !== undefined) {
        if (channels) check(record(value) && Object.keys(value).every(name => channels.includes(name)),
          'mark needs named state values supported by the solver');
        else check(!smooth && Number.isSafeInteger(value) &&
          (mode === 'add' || integer(value, 0, states - 1)), 'discrete marks need a flat stroke and a valid integer state');
      }
      const selection = mark.stroke ? footprint(mark.stroke, sites) : mark.cells.map(at => {
        const site = lookup(at);
        check(site, 'unknown or masked cell ' + String(at) + ' in mark ' + mark.id);
        return { site, weight: 1 };
      });
      check(new Set(selection.map(row => row.site)).size === selection.length, 'a mark cannot select the same cell twice');
      return () => {
        const current = value === undefined ? null : frame();
        const changes = selection.map(({ site, weight }) => {
          const flags = kind === 'pin' ? { locked: enabled } : kind === 'obstacle' ? { blocked: enabled } : {};
          if (value === undefined) return write(site, flags);
          const strength = weight * (coverage && kind !== 'pin' ? coverage(current, site) : 1);
          const before = read(current, site);
          const blend = (previous, target) => mode === 'add' ? previous + strength * target
            : (1 - strength) * previous + strength * target;
          const state = channels ? { ...before, ...Object.fromEntries(Object.entries(value).map(([name, target]) => {
            const result = blend(before[name], target);
            return [name, coverage ? clamp(result, 1) : result];
          })) } : clamp(blend(before, value), states - 1);
          return write(site, flags, state);
        });
        if (changes.length) sim.edit(changes);
      };
    }
    return Object.freeze({ dt: sim.dt, get tick() { return sim.tick; }, step: sim.step, frame,
      checkpoint, restore: sim.restore, compile,
      markWork: mark => mark.stroke ? sites.length * Math.max(1, mark.stroke.points.length - 1) : mark.cells.length });
  }

  function lattice(sim) {
    const { width, height, depth } = sim, volume = sim.lattice === 'voxel';
    const sites = Array.from({ length: width * height * depth }, (_, i) => {
      const x = i % width, y = Math.floor(i / width) % height, z = Math.floor(i / (width * height));
      return { at: volume ? [x, y, z] : [x, y], position: sim.position(x, y, z), i };
    });
    const byAddress = new Map(sites.map(site => [site.at.join(','), site]));
    return binding(sim, {
      sites, lookup: at => Array.isArray(at) && byAddress.get(at.join(',')), frame: sim.snapshot,
      read: (frame, site) => frame.cells[site.i],
      write({ at: [x, y, z] }, flags, state) {
        return { x, y, ...(volume && { z }), ...flags, ...(state !== undefined && { state }) };
      },
      checkpoint() {
        const { cells, locked, blocked, ...meta } = sim.snapshot();
        return { ...meta, cells: Array.from(cells), locked: Array.from(locked), ...(blocked && { blocked: Array.from(blocked) }) };
      }
    });
  }

  function domain(sim) {
    return binding(sim, { sites: sim.domain.cells, lookup: sim.domain.cell, frame: sim.frame,
      read: (frame, cell) => frame.get(cell.id),
      write: (cell, flags, state) => ({ id: cell.id, ...flags, ...(state !== undefined && { state }) }),
      channels: sim.channels, checkpoint: sim.checkpoint });
  }

  function continuous(sim) {
    const { width, height } = sim;
    const sites = Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      return { at: [x, y], position: [x, y, 0] };
    });
    const byAddress = new Map(sites.map(site => [site.at.join(','), site]));
    return binding(sim, { sites, lookup: at => Array.isArray(at) && byAddress.get(at.join(',')), frame: sim.frame,
      read: (frame, site) => frame.get(...site.at), coverage: (frame, site) => frame.coverage(...site.at),
      write: ({ at: [x, y] }, flags, values) => ({ x, y, ...flags, ...(values !== undefined && { values }) }),
      channels: sim.stateChannels, checkpoint: sim.checkpoint });
  }

  function tracks(sources) {
    check(record(sources) && integer(Object.keys(sources).length, 1, 16), 'expected 1–16 named simulation tracks');
    return freeze(Object.fromEntries(Object.entries(sources).map(([id, track]) => {
      check(idOK(id), 'invalid simulation track ID');
      return [id, validate(typeof track?.record === 'function' ? track.record() : track)];
    })));
  }

  K.simulationInputs = Object.freeze({ create: options => session(options), open, validate, tracks, lattice, domain, continuous });
})(KIT);
