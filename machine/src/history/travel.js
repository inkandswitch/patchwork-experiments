// Goes to any tick of the session's durable record (record.js): from the
// nearest state it has at or before it (its own position, a keyframe it
// kept, a checkpoint, genesis), stepping the record's rows. Exact, for the
// same reason rebuild.js is. A step can be slow (an emulated console runs
// a millisecond or more a tick, and a checkpoint can be a minute away), so
// travel goes a few milliseconds at a time, from work(); and it keeps a
// keyframe each `aim` ms of stepping, within a byte budget, so that going
// back and forth near where it has been is quick.

export class Travel {
  #machine;
  #content;
  #record;
  #load;
  #engine = null;
  #keys = new Map(); // tick -> snapshot, least recently used first
  #bytes = 0;
  #budget;
  #aim;
  #gap = 64;
  #lastKey = -Infinity;
  #patience;
  #loaded = new Map(); // checkpoint tick -> ms its load began, or "failed"
  /** The tick the engine is at (null before the first work()). */
  at = null;
  /** Where it is going. */
  target = null;
  /** Steps taken, checkpoints used, and states that disagreed with a checkpoint's hash. */
  stats = { steps: 0, checkpoints: 0, mismatches: [] };

  /**
   * @param o.load    async (url) => snapshot: a checkpoint's state, checked
   * @param o.budget  bytes of keyframes kept (genesis aside)
   * @param o.aim     ms of stepping between keyframes
   * @param o.patience  ms to wait for a checkpoint before stepping without it
   */
  constructor(machine, content, record, { load = null, budget = 160e6, aim = 100, patience = 3000 } = {}) {
    this.#patience = patience;
    this.#machine = machine;
    this.#content = content;
    this.#record = record;
    this.#load = load;
    this.#budget = budget;
    this.#aim = aim;
  }

  /** The engine, at `at`. Look (frame, query, hash), never step. */
  get engine() {
    return this.#engine;
  }

  seek(t) {
    this.target = Math.max(0, t);
  }

  /** Whether the engine is at the target. */
  get there() {
    return this.at !== null && this.at === this.target;
  }

  /**
   * The record changed from tick t on (Record.update): states after t that
   * were rebuilt before may be wrong now.
   */
  invalidate(t) {
    if (t === Infinity) return;
    for (const k of [...this.#keys.keys()]) if (k > t) this.#drop(k);
    if (this.at !== null && this.at > t) this.at = null;
    this.#loaded.clear();
  }

  /**
   * Goes towards the target for about `ms` (at least one step). Returns
   * "there", "going", "waiting" (for a checkpoint to load) or "beyond"
   * (the record has no row for some tick before the target yet).
   */
  work(ms = 12) {
    if (this.target === null) return "there";
    if (!this.#engine) {
      this.#engine = this.#machine.boot(this.#content);
      const g = this.#engine.snapshot();
      if (this.#engine.hash() !== this.#record.genesis) throw new Error("the engine boots to a different state than the session's");
      this.#keys.set(0, g); // genesis: pinned, outside the budget
      this.at = 0;
    }
    if (this.at === this.target) return "there";
    // The nearest state at or before the target: here, a keyframe, or a
    // checkpoint (if it is nearer than the others).
    const t = this.target;
    let base = this.at !== null && this.at <= t ? this.at : -1, from = "here";
    for (const k of this.#keys.keys()) if (k <= t && k > base) [base, from] = [k, "key"];
    if (this.#load)
      for (const cp of this.#record.checkpoints())
        if (cp.tick <= t && cp.tick > base && this.#loaded.get(cp.tick) !== "failed") {
          if (!this.#keys.has(cp.tick)) {
            if (!this.#loaded.has(cp.tick)) this.#fetch(cp);
            const began = this.#loaded.get(cp.tick);
            // Worth waiting for, if far enough ahead of what we have, for a while.
            if (cp.tick - base > this.#gap && performance.now() - began < this.#patience) return "waiting";
          }
        }
    if (from === "key" && base !== this.at) {
      this.#engine.restore(this.#touch(base));
      this.at = base;
    }
    const end = performance.now() + ms;
    const started = performance.now(), before = this.stats.steps;
    while (this.at < t && (this.stats.steps === before || performance.now() < end)) {
      const row = this.#record.rowAt(this.at);
      if (!row) return "beyond";
      this.#engine.step(row);
      this.at++;
      this.stats.steps++;
      this.#check(this.at);
      if (this.at - Math.max(this.#lastKey, this.#below(this.at)) >= this.#gap) this.#keep(this.at);
    }
    // How many steps make `aim` ms, from how long these took.
    const n = this.stats.steps - before, took = performance.now() - started;
    if (n >= 8 && took > 0) this.#gap = Math.max(16, Math.min(8192, Math.round((this.#aim * n) / took)));
    return this.at === t ? "there" : "going";
  }

  // A checkpoint's state, fetched and checked, becomes a keyframe.
  #fetch(cp) {
    const began = performance.now();
    this.#loaded.set(cp.tick, began);
    this.#load(cp.url).then(
      (snap) => {
        if (this.#loaded.get(cp.tick) !== began) return; // invalidated meanwhile
        this.#loaded.delete(cp.tick);
        this.#keys.set(cp.tick, snap);
        this.#bytes += snap.length;
        this.stats.checkpoints++;
        this.#evict();
      },
      () => this.#loaded.set(cp.tick, "failed"),
    );
  }

  // A state stepped to a checkpoint's tick should be the checkpoint's.
  #check(t) {
    const cp = this.#record.checkpointsAll[t];
    if (!cp || this.stats.mismatches.some((m) => m.tick === t)) return;
    if (!this.#record.checkpoints().some((c) => c.tick === t)) return;
    if (this.#engine.hash() !== cp.hash) this.stats.mismatches.push({ tick: t, ours: this.#engine.hash(), theirs: cp.hash });
  }

  #below(t) {
    let best = -Infinity;
    for (const k of this.#keys.keys()) if (k <= t && k > best) best = k;
    return best;
  }

  #keep(t) {
    if (this.#keys.has(t)) return;
    const s = this.#engine.snapshot();
    this.#keys.set(t, s);
    this.#bytes += s.length;
    this.#lastKey = t;
    this.#evict();
  }

  #touch(k) {
    const s = this.#keys.get(k);
    if (k !== 0) {
      this.#keys.delete(k);
      this.#keys.set(k, s);
    }
    return s;
  }

  #evict() {
    for (const k of this.#keys.keys()) {
      if (this.#bytes <= this.#budget) break;
      if (k !== 0) this.#drop(k);
    }
  }

  #drop(k) {
    if (k === 0) return;
    this.#bytes -= this.#keys.get(k).length;
    this.#keys.delete(k);
  }
}
