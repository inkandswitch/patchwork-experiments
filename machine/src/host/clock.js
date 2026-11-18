// Time for a machine. The host reads a clock with two methods, t() in world
// seconds and running(), and steps to tick floor(t · hz). It never reads a
// wall clock itself, so peers agree on the tick exactly as far as they agree
// on t, and a pause stops every peer at the same tick.
//
// SessionClock is one kept in the session document: a run of the machine's
// time over some time every peer shares. Standing alone (the Machine tool),
// that is SyncedWall, a wall clock the session's peers agree on. In a scene
// it is the scene's world time (worldClock below), so a machine there pauses
// with its world, and still stops on its own while nobody plays.

/** The tick a clock is at. hz is [num, den], as the engine declares it. */
export function tickAt(clock, [num, den]) {
  return Math.floor((clock.t() * num) / den);
}

/**
 * The machine's time, as { t, at, until? } in the session document: t was
 * the machine's time when the shared time was `at` (ms); it runs at one
 * second per second from there until `until`, if set. Pausing sets `until` a
 * little ahead (the margin), so that every peer has heard of the pause
 * before it reaches that time and stops at exactly the same tick; resuming
 * clears it. A pause or resume rewrites the whole object, so two at once
 * settle by Automerge's last-writer rule and never mix.
 *
 * A run starts at `at`, never before: a peer whose shared time is still
 * short of it (a scene's follower trails the view computing its world by up
 * to 200 ms) holds at t until it gets there, so resuming never takes a peer
 * back below the tick it was stopped at. `at` is the offset that makes the
 * machine's tick 0 its first moment, however far into the shared time it was
 * made (a scene hours into its world starts its machine at tick 0, not at
 * hours of ticks to replay).
 */
export class SessionClock {
  #handle;
  #wall;

  /** @param wall () => ms, shared across peers (a SyncedWall's now) */
  constructor(handle, wall) {
    this.#handle = handle;
    this.#wall = wall;
  }

  #state() {
    return this.#handle.doc()?.clock ?? { t: 0, at: this.#wall(), until: 0 };
  }

  t() {
    const { t, at, until } = this.#state();
    return Math.min(until ?? Infinity, t + Math.max(0, this.#wall() - at) / 1000);
  }

  running() {
    const { until } = this.#state();
    return until === undefined || this.t() < until;
  }

  /**
   * Stops the machine `margin` seconds from now (for everyone). A stop
   * already set stands: a second pause in its margin would set one earlier,
   * which a peer ahead of the second pauser may have passed. That holds for
   * pauses made in sequence, each pauser having seen the stop before. Two
   * made at once each write a stop, the merge keeps one, and a peer that had
   * passed the one kept goes back to it: its timeline rewinds, as for a
   * pause that reaches a peer ahead of the pauser by more than the margin.
   */
  pause(margin = 0.25) {
    if (this.#state().until !== undefined) return;
    const t = this.t();
    this.#handle.change((d) => {
      d.clock = { t, at: this.#wall(), until: t + margin };
    });
  }

  resume() {
    if (this.running()) return;
    const t = this.t();
    this.#handle.change((d) => {
      d.clock = { t, at: this.#wall() };
    });
  }
}

/**
 * A session's clock on a scene's world time (the "clock" service: scene/STAGE.md,
 * "World time"; or anything with t() in seconds and running()). The shared
 * time is world time, which every view of the scene has: no wall clock to
 * agree on, and a paused world stops the machine too. Its own `until` stops
 * it while the world runs on (nobody plays: quiet.js). The machine pulls its
 * tick from t(); it is not stepped by the world. Its `at` is world ms
 * (`world.t() * 1000`: createSession's `wall`, quietClock's `now`).
 * @param handle  the session document's
 * @param world   { t() seconds, running() }
 */
export function worldClock(handle, world) {
  const own = new SessionClock(handle, () => world.t() * 1000);
  return {
    t: () => own.t(),
    running: () => world.running() && own.running(),
    pause: (margin) => own.pause(margin),
    resume: () => own.resume(),
  };
}

/**
 * A wall clock shared by the peers of one session, over ephemeral messages.
 * Each peer pings once a second; every peer answers with its own shared time.
 * The reference is the peer with the smallest id heard from lately (or this
 * one): it keeps its own clock, and everyone else takes the reference's time
 * from the answer with the shortest round trip among the last few, plus half
 * that round trip. When the reference leaves, the next smallest has been
 * following it, so time carries on.
 */
export class SyncedWall {
  #id;
  #local;
  #send;
  #samples = new Map(); // peer id -> [{ offset, rtt, at }] (offset: their shared time - our local time)
  #lastPing = -Infinity;
  #offset = 0;

  static PING_MS = 1000;
  static FORGET_MS = 5000;
  static KEEP = 8;

  /**
   * @param id    this peer's id (ids order the peers; the smallest leads)
   * @param local () => ms, this machine's clock
   * @param send  (message) => void, an ephemeral broadcast to the session
   */
  constructor(id, local, send) {
    this.#id = id;
    this.#local = local;
    this.#send = send;
  }

  /** Shared time, ms. */
  now() {
    return this.#local() + this.#offset;
  }

  /** The peer whose clock everyone follows. */
  get reference() {
    const cutoff = this.#local() - SyncedWall.FORGET_MS;
    let ref = this.#id;
    for (const [id, list] of this.#samples) if (id < ref && list.some((s) => s.at >= cutoff)) ref = id;
    return ref;
  }

  /** Call every frame: pings when one is due, and settles the offset. */
  tick() {
    const local = this.#local();
    if (local - this.#lastPing >= SyncedWall.PING_MS) {
      this.#lastPing = local;
      this.#send({ m: "clock/ping", id: this.#id, at: local });
    }
    const ref = this.reference;
    if (ref === this.#id) return void (this.#offset = 0);
    const best = this.#samples.get(ref).reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.#offset = best.offset;
  }

  /** Feed every ephemeral message here; returns whether it was a clock message. */
  receive(msg) {
    if (msg?.m === "clock/ping" && msg.id !== this.#id) {
      this.#send({ m: "clock/pong", id: this.#id, to: msg.id, at: msg.at, wall: this.now() });
      return true;
    }
    if (msg?.m === "clock/pong" && msg.to === this.#id) {
      const local = this.#local();
      const rtt = local - msg.at;
      const list = this.#samples.get(msg.id) ?? [];
      list.push({ offset: msg.wall + rtt / 2 - local, rtt, at: local });
      if (list.length > SyncedWall.KEEP) list.shift();
      this.#samples.set(msg.id, list);
      return true;
    }
    return msg?.m === "clock/ping" || msg?.m === "clock/pong";
  }
}
