// Time for a machine. The host reads a clock with two methods, t() in world
// seconds and running(), and steps to tick floor(t · hz). It never reads a
// wall clock itself, so peers agree on the tick exactly as far as they agree
// on t, and a pause stops every peer at the same tick.
//
// The stage's api.clock (TOOLS.md §7) is such a clock. Until it lands,
// SessionClock is one kept in the session document, with SyncedWall as the
// shared wall time it needs.

/** The tick a clock is at. hz is [num, den], as the engine declares it. */
export function tickAt(clock, [num, den]) {
  return Math.floor((clock.t() * num) / den);
}

/**
 * The stand-in for api.clock: { t, at, until? } in the session document. t
 * was the world time at synced wall time `at` (ms); it runs at one second per
 * second until `until`, if set. Pausing sets `until` a little ahead (the
 * margin), so that every peer has heard of the pause before it reaches that
 * time and stops at exactly the same tick; resuming clears it. A pause or
 * resume rewrites the whole object, so two at once settle by Automerge's
 * last-writer rule and never mix.
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
    return Math.min(until ?? Infinity, t + (this.#wall() - at) / 1000);
  }

  running() {
    const { until } = this.#state();
    return until === undefined || this.t() < until;
  }

  /** Stops the world `margin` seconds from now (for everyone). */
  pause(margin = 0.25) {
    const t = this.t();
    const until = this.running() ? t + margin : t;
    this.#handle.change((d) => {
      d.clock = { t, at: this.#wall(), until };
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
