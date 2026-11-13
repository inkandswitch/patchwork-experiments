// The rollback core. A timeline runs one engine forward from what it currently
// believes each port's input to be, and keeps that belief and the engine's
// state consistent:
//
//   state(now) = step(...step(step(state(floor), used[floor]), used[floor+1])...)
//   used[t][p] = known(p, t) ?? predict(p, t)        for every t in [floor, now)
//
// predict(p, t) repeats p's last known input before t (or the input it had
// just before the floor; zeros at the very start). A belief change that makes
// some used[t] wrong marks t dirty; the next advance restores the newest
// snapshot at or before t and re-steps, so the equations hold again. Nothing
// here knows about networks, documents or seats: the host turns those into
// put(port, tick, bytes | undefined).
//
// The frontier is the first tick at which some port's input is unknown. Below
// it the state is confirmed: it is what every peer with the same inputs has.
// The floor is the newest snapshot at or before the frontier (and the
// timeline's own start); belief below the floor is gone, and a change there is
// refused with a RangeError, for the host to rebase from a checkpoint.
//
// A step that traps leaves the engine's memory half-written, so the timeline
// restores the newest snapshot at or before that tick and holds there: it
// does not step the tick again while the state before it and its row are the
// ones that trapped (an engine is deterministic, so it would trap again). Any
// change to either, by a late input or a rewind, lets it try again: a trap
// met only on a predicted input goes away when the real input arrives. A trap
// below the frontier is confirmed: every peer with these inputs meets it.
//
// A trace, if given, is told what the timeline does to the engine, and
// nothing else: { start: tick, snapshot } once, then { step: tick, row } for
// every step (re-steps included), { rewind: tick, from } for every restore,
// and { confirmed: tick, snapshot } as a marked tick's state is confirmed.
// That is enough to rebuild every state the engine passed through
// (history/), since a state is the start's with the rows stepped since.
// Snapshots and rows are lent: a snapshot is valid only during the call; a
// row is never written again.

export class Timeline {
  #engine;
  #ports;
  #width;
  #known; // per port: Map<tick, Uint8Array>
  #before; // per port: the input it had at floor - 1
  #used = new Map(); // tick -> the row stepped at that tick, for ticks in [floor, now)
  #snaps = new Map(); // tick -> snapshot of the state at that tick, ticks in [floor, now]
  #dirty = Infinity;
  #frontier;
  #every;
  #max;
  #marks;
  #confirmed;
  #spare = []; // dropped snapshots, reused rather than reallocated
  #stepped;
  #trap = null; // { tick, row, snap, error }: the step that trapped, from that state with that row
  #aim = 0; // the last target
  #trace;

  /**
   * @param engine   from compile(wasm).boot(content), at `tick`
   * @param o.tick   the tick the engine is at (0 at boot, a checkpoint's tick)
   * @param o.before each port's input at tick - 1, for prediction (zeros)
   * @param o.every  snapshot at least every `every` ticks past the frontier
   * @param o.max    most snapshots held; past it the oldest above the floor go
   * @param o.marks  ticks whose confirmed state the host wants (checkpoints)
   * @param o.confirmed (tick, snapshot) called once a marked tick's state is confirmed
   * @param o.stepped (tick) called after every step of tick, the engine then at
   *                 tick + 1 (so its output() is tick's), re-steps included
   * @param o.trace  (event) told of every start, step and rewind (above)
   */
  constructor(engine, { tick = 0, before, every = 4, max = 64, marks = () => false, confirmed = () => {}, stepped = () => {}, trace = null } = {}) {
    this.#engine = engine;
    this.#ports = engine.players;
    this.#width = engine.inputBytes;
    this.#known = Array.from({ length: this.#ports }, () => new Map());
    this.#before = before ?? Array.from({ length: this.#ports }, () => new Uint8Array(this.#width));
    this.#every = every;
    this.#max = Math.max(2, max);
    this.#marks = marks;
    this.#confirmed = confirmed;
    this.#stepped = stepped;
    this.#trace = trace;
    this.now = tick;
    this.floor = tick;
    this.#frontier = tick;
    this.#snaps.set(tick, engine.snapshot());
    trace?.({ start: tick, snapshot: this.#snaps.get(tick) });
  }

  /** Counts: rewinds, ticks stepped again because of them, and all steps. */
  stats = { rewinds: 0, restepped: 0, steps: 0 };

  get engine() {
    return this.#engine;
  }

  /** The first tick at which some port's input is not known. */
  get frontier() {
    return this.#frontier;
  }

  /**
   * The step the timeline is held before because it trapped: { tick, error },
   * or null. `confirmed` when every input up to it is known, so that every peer
   * with them meets it too.
   */
  get fault() {
    const f = this.#trap;
    if (!f || !this.#holds(f, this.#aim)) return null;
    return { tick: f.tick, error: f.error, confirmed: f.tick < this.#frontier };
  }

  // Whether the trap still stands in the way of reaching target: the
  // timeline is at its tick, from the same state, with the same row.
  #holds(f, target) {
    return this.now === f.tick && target > f.tick && f.snap === this.#snaps.get(f.tick) && equal(f.row, this.#row(f.tick));
  }

  /** How many snapshots are held (for the host's accounting and the tests). */
  get snapshots() {
    return this.#snaps.size;
  }

  /** What the timeline believes port's input at tick is: bytes, or undefined if unknown. */
  known(port, tick) {
    return this.#known[port].get(tick);
  }

  /**
   * Sets the belief about one input: bytes (inputBytes long) or undefined for
   * unknown. Returns whether the state has to be re-stepped from tick.
   */
  put(port, tick, bytes) {
    if (tick < this.floor) throw new RangeError(`input for tick ${tick} is below the floor ${this.floor}`);
    if (bytes !== undefined && bytes.length !== this.#width)
      throw new Error(`an input is ${this.#width} bytes, got ${bytes.length}`);
    const map = this.#known[port];
    const had = map.get(tick);
    if (had === bytes || (had && bytes && equal(had, bytes))) return false;
    if (bytes === undefined) map.delete(tick);
    else map.set(tick, bytes);

    if (bytes === undefined) this.#frontier = Math.min(this.#frontier, tick);
    else if (tick === this.#frontier) this.#advanceFrontier();

    // If tick's effective input is unchanged, so are the predictions after it
    // (they repeat it, or a later known input), so nothing past tick changes.
    const used = this.#used.get(tick);
    if (!used) return false;
    const now = bytes ?? this.#predict(port, tick);
    if (equal(now, used.subarray(port * this.#width, (port + 1) * this.#width))) return false;
    this.#dirty = Math.min(this.#dirty, tick);
    return true;
  }

  /**
   * Brings the state to `target`: repairs any dirty tick by restoring and
   * re-stepping, then steps forward, or restores back if target is behind
   * (never below the floor: the state goes no further back than that). At
   * most `limit` steps happen per call; returns how many did.
   */
  advance(target, limit = Infinity) {
    let steps = 0;
    target = Math.max(target, this.floor);
    this.#aim = target;
    const back = Math.min(this.#dirty, target);
    if (back < this.now) {
      const was = this.now;
      this.#rewind(back);
      this.stats.rewinds++;
      this.stats.restepped += Math.min(was, target) - this.now;
    }
    this.#dirty = Infinity;
    while (this.now < target && steps < limit) {
      const t = this.now;
      if (!this.#snaps.has(t) && this.#wants(t)) this.#take(t);
      const trap = this.#trap;
      if (trap && this.#holds(trap, target)) break;
      const row = this.#row(t);
      try {
        this.#step(t, row);
      } catch (e) {
        // The memory is half-written: back to the state before the step,
        // which is kept, so that the trap is held without stepping again.
        this.#used.delete(t);
        this.#rewind(t);
        while (this.now < t) this.#step(this.now, this.#row(this.now)); // the rows just stepped
        if (!this.#snaps.has(t)) this.#take(t);
        this.#trap = { tick: t, row, snap: this.#snaps.get(t), error: String(e?.message ?? e) };
        break;
      }
      if (trap?.tick === t) this.#trap = null;
      steps++;
    }
    if (this.#marks(this.now) && !this.#snaps.has(this.now)) this.#take(this.now);
    this.#settle();
    return steps;
  }

  #step(t, row) {
    this.#used.set(t, row);
    this.#engine.step(row);
    this.now = t + 1;
    this.stats.steps++;
    this.#trace?.({ step: t, row });
    this.#stepped(t);
  }

  /** The inputs stepped at tick (players * inputBytes), if tick is in [floor, now). */
  used(tick) {
    return this.#used.get(tick);
  }

  // Whether to keep the state at t before stepping it: a marked tick; the
  // frontier itself (the floor to be: no late input can land below it); past
  // the frontier, `every` ticks since the last one, so a late input never
  // re-steps more than about `every` past its tick; below it, where every
  // input is known and nothing can be rolled back, only every 16·`every`
  // ticks, enough to move the floor along.
  #wants(t) {
    if (this.#marks(t) || t === this.#frontier) return true;
    let last = -Infinity;
    for (const s of this.#snaps.keys()) if (s <= t && s > last) last = s;
    return t - last >= (t > this.#frontier ? this.#every : 16 * this.#every);
  }

  #take(t) {
    this.#snaps.set(t, this.#engine.snapshot(this.#spare.pop()));
  }

  // A marked snapshot may have been handed to the host, so it is never reused.
  #drop(s) {
    const snap = this.#snaps.get(s);
    if (this.#trap?.snap === snap) this.#trap.snap = null; // the state it trapped from is gone
    if (!this.#marks(s) && this.#spare.length < 4) this.#spare.push(snap);
    this.#snaps.delete(s);
  }

  #rewind(tick) {
    let best = -Infinity;
    for (const s of this.#snaps.keys()) if (s <= tick && s > best) best = s;
    if (best === -Infinity) throw new Error(`no snapshot at or before ${tick}`);
    this.#engine.restore(this.#snaps.get(best));
    for (const s of [...this.#snaps.keys()]) if (s > best) this.#drop(s);
    for (const t of [...this.#used.keys()]) if (t >= best) this.#used.delete(t);
    this.#trace?.({ rewind: best, from: this.now });
    this.now = best;
  }

  #row(t) {
    const row = new Uint8Array(this.#ports * this.#width);
    for (let p = 0; p < this.#ports; p++) row.set(this.#known[p].get(t) ?? this.#predict(p, t), p * this.#width);
    return row;
  }

  #predict(port, tick) {
    const map = this.#known[port];
    for (let t = tick - 1; t >= this.floor; t--) {
      const b = map.get(t);
      if (b) return b;
    }
    return this.#before[port];
  }

  #advanceFrontier() {
    let f = this.#frontier;
    while (this.#known.every((m) => m.has(f))) f++;
    this.#frontier = f;
  }

  // Hands confirmed marked snapshots to the host, moves the floor up to the
  // newest snapshot at or before the frontier, and caps how many are held.
  #settle() {
    const f = Math.min(this.#frontier, this.now);
    for (const [s, snap] of this.#snaps)
      if (s <= f && s !== this.floor && this.#marks(s)) {
        this.#confirmed(s, snap);
        this.#trace?.({ confirmed: s, snapshot: snap });
      }
    let base = this.floor;
    for (const s of this.#snaps.keys()) if (s <= f && s > base) base = s;
    if (base > this.floor) {
      for (let p = 0; p < this.#ports; p++) {
        this.#before[p] = this.#predictAt(p, base);
        for (const t of [...this.#known[p].keys()]) if (t < base) this.#known[p].delete(t);
      }
      for (const s of [...this.#snaps.keys()]) if (s < base) this.#drop(s);
      for (const t of [...this.#used.keys()]) if (t < base) this.#used.delete(t);
      this.floor = base;
    }
    if (this.#snaps.size > this.#max) {
      const ticks = [...this.#snaps.keys()].sort((a, b) => a - b);
      const newest = ticks[ticks.length - 1];
      for (const s of ticks) {
        if (this.#snaps.size <= this.#max) break;
        if (s !== this.floor && s !== newest && !this.#marks(s)) this.#drop(s);
      }
    }
  }

  // The input port had at base - 1: known there (every tick below the
  // frontier is), else predicted.
  #predictAt(port, base) {
    return this.#known[port].get(base - 1) ?? this.#predict(port, base);
  }
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
