// The host: runs one machine session on this peer. Every present peer runs
// the engine itself, from the same inputs (a replicated reducer); nobody's
// state is authoritative, and the document holds only what is needed to
// rebuild the state: the engine's identity, who holds which port, every
// port's inputs, and checkpoints.
//
// Per frame: read the clock's tick; sample this peer's port and send its
// recent inputs to everyone (ephemeral); tell the timeline what is known of
// every port's input in its window; let it step, rolling back where a late
// input proves a prediction wrong; write finished seconds of input and due
// checkpoints to the documents. See HOST.md for the reasoning and the numbers
// behind each choice.
import { compile, identify } from "../engine.js";
import { hashSnapshot } from "../wasm-state.js";
import { Timeline } from "./timeline.js";
import { seating, seatingKey, holder, firstDifference, chunkSpan, unpack, pack, gzip, gunzip } from "./session.js";
import { SessionClock, SyncedWall, tickAt } from "./clock.js";

/** Seconds, turned into ticks of the engine's rate when a session is made. */
export const SECONDS = {
  chunk: 1, // a durable input chunk: one change per seat per second
  every: 60, // between checkpoints
  roll: 600, // a seat document's span: past it the holder starts a new one
  delay: 0.1, // input delay (local; see README)
  claim: 0.5, // how far ahead a seat is taken, so that others hear of it first
  reap: 10, // a holder silent this long loses the rest of its seat
};

const BEAT_MS = 250;

const ticksOf = (seconds, [num, den]) => Math.max(1, Math.round((seconds * num) / den));

/**
 * Makes a session document for an engine and its content. Returns the handle.
 * `wall` is the shared wall time (ms) the clock starts from.
 */
export async function createSession(repo, { wasm, content = new Uint8Array(), vacant, seconds = {}, wall = Date.now() }) {
  const s = { ...SECONDS, ...seconds };
  const engine = (await compile(wasm)).boot(content);
  const { engine: wasmHash, content: contentHash } = await identify(wasm, content);
  const rate = engine.tickRate;
  return repo.create({
    engine: {
      wasm: wasmHash,
      content: contentHash,
      genesis: engine.hash(),
      hz: rate,
      players: engine.players,
      inputBytes: engine.inputBytes,
    },
    vacant: vacant ?? new Uint8Array(engine.inputBytes),
    chunk: ticksOf(s.chunk, rate),
    every: ticksOf(s.every, rate),
    roll: ticksOf(s.roll, rate),
    clock: { t: 0, at: wall },
    seats: {},
    checkpoints: {},
  });
}

export class Host {
  /** This peer's status, for a view and the tests. */
  status = { start: 0, desync: [], rebases: 0, asked: 0, written: { chunks: 0, checkpoints: 0 }, error: null };

  #repo;
  #handle;
  #machine;
  #content;
  #o;
  #rate;
  #ports;
  #width;
  #vacant;
  #chunk;
  #every;
  #roll;
  #wall = null;
  #clock;
  #timeline = null;
  #seated;
  #seats = new Map(); // seat id -> { record, handle, inputs: Map<tick, bytes>, top, heard, ingested: Map<n, length> }
  #mine = null; // { id, port, from, until, handle, next, durable }
  // Confirmed checkpoint states are { tick, snapshot, seating }, seating the
  // seatingKey they were computed under: one whose key is no longer the
  // current seating's is stale and is never used, written or kept.
  #anchor = null; // the newest confirmed checkpoint state in hand
  #confirmedQueue = [];
  #unwritten = null; // a confirmed checkpoint state nobody has written yet
  #hashes = new Map(); // tick -> our hash of the confirmed state there
  #loading = null;
  #asked = new Map(); // seat id -> local ms of our last request for its inputs
  #writing = new Set(); // checkpoint ticks being written by us
  #retry = 0; // local ms: when to look again for seat docs not found yet
  #again = Infinity; // a rebase wanted while a load was in flight: from this tick
  #off = [];

  /**
   * Opens a session and brings this peer to its state: the newest checkpoint,
   * then every durable input after it; live inputs follow by message.
   *
   * @param o.wasm, o.content   the engine and its content (checked against the doc)
   * @param o.id       this peer's id (orders peers for the shared wall time)
   * @param o.by       who sits, as recorded in seats (a name or contact url)
   * @param o.now      () => local ms (Date.now)
   * @param o.clock    { t(), running() }; defaults to the session's own clock
   * @param o.input    () => this peer's current input, inputBytes long
   * @param o.delay    input delay, ticks (default: SECONDS.delay of the rate)
   * @param o.redundancy  how many recent inputs each message repeats (8)
   * @param o.budget   ms of stepping per frame, at least one step (10): a
   *                  joiner catching up, or a deep rollback, spreads over
   *                  frames instead of stopping one
   * @param o.perf     () => ms, for the budget only (performance.now)
   * @param o.reap     seconds of silence after which a holder loses its seat
   */
  static async open(repo, url, o) {
    const handle = await repo.find(url);
    const doc = handle.doc();
    const ident = await identify(o.wasm, o.content ?? new Uint8Array());
    if (doc.engine.wasm !== ident.engine) throw new Error("this session runs a different engine");
    if (doc.engine.content !== ident.content) throw new Error("this session runs different content");
    const host = new Host(repo, handle, await compile(o.wasm), o);
    await host.#start(Infinity);
    return host;
  }

  constructor(repo, handle, machine, o) {
    const doc = handle.doc();
    this.#repo = repo;
    this.#handle = handle;
    this.#machine = machine;
    this.#content = o.content ?? new Uint8Array();
    this.#rate = doc.engine.hz;
    this.#ports = doc.engine.players;
    this.#width = doc.engine.inputBytes;
    this.#vacant = new Uint8Array(doc.vacant);
    this.#chunk = doc.chunk;
    this.#every = doc.every;
    this.#roll = doc.roll;
    this.#o = {
      id: o.id ?? Math.random().toString(36).slice(2),
      by: o.by ?? null,
      now: o.now ?? (() => Date.now()),
      input: o.input ?? (() => this.#vacant),
      delay: o.delay ?? ticksOf(SECONDS.delay, this.#rate),
      redundancy: o.redundancy ?? 8,
      budget: o.budget ?? 10,
      perf: o.perf ?? (() => performance.now()),
      reap: o.reap ?? SECONDS.reap,
    };
    if (o.clock) this.#clock = o.clock;
    else {
      this.#wall = new SyncedWall(this.#o.id, this.#o.now, (m) => handle.broadcast(m));
      this.#clock = new SessionClock(handle, () => this.#wall.now());
    }
    this.#seated = seating(doc.seats, this.#ports);
    const onMessage = ({ message }) => this.#receive(message);
    const onChange = () => this.#sessionChanged();
    handle.on("ephemeral-message", onMessage);
    handle.on("change", onChange);
    this.#off.push(() => handle.off("ephemeral-message", onMessage), () => handle.off("change", onChange));
  }

  get url() {
    return this.#handle.url;
  }
  get id() {
    return this.#o.id;
  }
  /** The live engine, for frame(view) and output(). Never step it. */
  get engine() {
    return this.#timeline?.engine ?? null;
  }
  /** This peer's input delay, in ticks. */
  get delay() {
    return this.#o.delay;
  }
  /** The tick the engine is at. */
  get tick() {
    return this.#timeline?.now ?? 0;
  }
  /** Ticks below this are confirmed: every peer with these inputs has this state. */
  get frontier() {
    return this.#timeline?.frontier ?? 0;
  }
  /** The timeline's counts: rewinds, ticks re-stepped, steps. */
  get stats() {
    return this.#timeline?.stats ?? null;
  }
  get loading() {
    return this.#loading !== null;
  }
  /** The seat this peer holds: { id, port, from } or null. */
  get seat() {
    const m = this.#mine;
    return m && { id: m.id, port: m.port, from: m.from };
  }
  get clock() {
    return this.#clock;
  }
  /** The tick the clock says it is. */
  target() {
    return tickAt(this.#clock, this.#rate);
  }

  /** One frame: call it as often as the view draws. */
  frame() {
    this.#wall?.tick();
    if (this.#loading) return;
    const target = this.target();
    if (this.#mine) this.#sample(target);
    this.#feed(Math.max(target, this.#timeline.now));
    this.#advance(target);
    this.#settleCheckpoints();
    this.#askForGaps();
    this.#reap();
    if (this.#o.now() >= this.#retry) {
      this.#retry = this.#o.now() + 2000;
      this.#loadSeats(this.#timeline.floor);
    }
    if (this.#mine && !this.#clock.running()) this.#flush(true);
  }

  // Steps towards target for at most the budget (and at least one step).
  // How far a frame gets changes when this peer reaches a state, never which
  // state it reaches, so the budget's clock is local and needs no agreement.
  #advance(target) {
    const end = this.#o.perf() + this.#o.budget;
    while (this.#timeline.advance(target, 1) && this.#o.perf() < end);
  }

  /** Takes a free port, from a little ahead of now. */
  sit(port) {
    if (this.#mine) throw new Error("this peer already holds a port");
    const from = Math.max(this.target(), this.tick) + ticksOf(SECONDS.claim, this.#rate);
    const held = this.#seated[port];
    const last = held[held.length - 1];
    if (last && last.until > from) throw new Error(`port ${port} is taken`);
    this.#take(port, from);
  }

  /** Gives the port back, after the last input this peer has sent. */
  stand() {
    const m = this.#mine;
    if (!m) return;
    this.#flush(true);
    const until = Math.max(m.next, m.from);
    this.#handle.change((d) => {
      d.seats[m.id].until = until;
    });
    this.#mine = null;
  }

  pause(margin) {
    this.#clock.pause(margin);
  }
  resume() {
    this.#clock.resume();
  }

  close() {
    for (const off of this.#off.splice(0)) off();
  }

  // ---- starting, and starting again from a checkpoint

  // Loads the newest state at or before `tick` that this peer can have (a
  // confirmed checkpoint in hand, one in the doc, or genesis), and every
  // seat's durable inputs from there.
  async #start(tick) {
    const load = (async () => {
      const doc = this.#handle.doc();
      this.#seated = seating(doc.seats, this.#ports);
      let base = { tick: 0, snapshot: null, hash: doc.engine.genesis };
      for (const [k, cp] of Object.entries(doc.checkpoints ?? {}))
        if (+k <= tick && +k > base.tick && this.#current(+k, cp)) base = { tick: +k, url: cp.url, hash: cp.hash };
      const a = this.#anchor;
      if (a && a.tick <= tick && a.tick >= base.tick && this.#current(a.tick, a))
        base = { tick: a.tick, snapshot: a.snapshot, hash: hashSnapshot(a.snapshot) };
      const engine = this.#timeline?.engine ?? this.#machine.boot(this.#content);
      if (base.tick === 0 && !base.snapshot) {
        const fresh = this.#machine.boot(this.#content);
        if (fresh.hash() !== doc.engine.genesis) throw new Error("the engine boots to a different state than the session's");
        base.snapshot = fresh.snapshot();
      } else if (!base.snapshot) {
        const cp = (await this.#repo.find(base.url)).doc();
        base.snapshot = await gunzip(cp.state);
        if (hashSnapshot(base.snapshot) !== base.hash) throw new Error(`checkpoint ${base.tick} does not match its hash`);
      }
      engine.restore(base.snapshot);
      this.status.start = base.tick;
      await this.#loadSeats(base.tick, true);
      this.#timeline = new Timeline(engine, {
        tick: base.tick,
        before: Array.from({ length: this.#ports }, () => this.#vacant),
        marks: (t) => t > 0 && t % this.#every === 0,
        confirmed: (t, snap) => this.#confirmedQueue.push([t, snap]),
      });
    })();
    this.#loading = load;
    try {
      await load;
    } finally {
      this.#loading = null;
    }
  }

  // A change below the floor (a seat ended or taken in the past, by a peer
  // that had not heard of later inputs) needs the state from before it.
  #rebase(tick) {
    this.#again = Math.min(this.#again, tick);
    if (this.#loading) return; // the load in flight starts again when it ends
    const go = () => {
      const t = this.#again;
      this.#again = Infinity;
      this.status.rebases++;
      this.#start(t)
        .then(() => this.#again < Infinity && go())
        .catch((e) => (this.status.error = String(e)));
    };
    go();
  }

  // Finds each accepted seat's input doc that matters from `from` on, and
  // reads its chunks (all of them again, if `again`). A doc that cannot be
  // found yet (its holder made it and vanished) is tried again later; until
  // then that seat's inputs are only what came by message.
  async #loadSeats(from, again = false) {
    const doc = this.#handle.doc();
    const wanted = [];
    for (const port of this.#seated) for (const s of port) if (s.until > from) wanted.push(s.id);
    await Promise.all(
      wanted.map(async (id) => {
        const seat = this.#seat(id);
        if (!seat.handle && this.#mine?.id === id) seat.handle = this.#mine.handle;
        if (!seat.handle) {
          seat.finding ??= this.#repo.find(doc.seats[id].inputs).then(
            (handle) => {
              const onChange = () => this.#ingest(seat);
              handle.on("change", onChange);
              this.#off.push(() => handle.off("change", onChange));
              seat.handle = handle;
            },
            () => (seat.finding = null),
          );
          await seat.finding;
        }
        if (again) seat.ingested.clear();
        this.#ingest(seat);
      }),
    );
  }

  #seat(id) {
    let s = this.#seats.get(id);
    if (!s) {
      s = { handle: null, finding: null, inputs: new Map(), top: -1, heard: this.#o.now(), ingested: new Map() };
      this.#seats.set(id, s);
    }
    return s;
  }

  // Reads a seat doc's chunks that are new or longer than last time.
  #ingest(seat) {
    const d = seat.handle?.doc();
    if (!d?.chunks) return;
    for (const [k, bytes] of Object.entries(d.chunks)) {
      const n = +k;
      if (seat.ingested.get(n) === bytes.length) continue;
      seat.ingested.set(n, bytes.length);
      const [start] = chunkSpan(n, this.#chunk, { from: d.from });
      for (const [t, b] of unpack(start, bytes, this.#width)) {
        seat.inputs.set(t, b);
        if (t > seat.top) seat.top = t;
      }
    }
  }

  // ---- the session document changed

  #sessionChanged() {
    const doc = this.#handle.doc();
    const next = seating(doc.seats, this.#ports);
    const changed = firstDifference(this.#seated, next);
    this.#seated = next;
    const m = this.#mine;
    if (m) {
      const mine = next[m.port].find((s) => s.id === m.id);
      const until = doc.seats[m.id]?.until;
      if (!mine && m.until === Infinity && until === undefined) {
        // Someone took the port first: give up the claim, for good.
        this.#handle.change((d) => {
          d.seats[m.id].until = m.from;
        });
        this.#mine = null;
      } else if (until !== undefined) m.until = until;
    }
    // Every state after `changed` may differ now, so our hashes of them go.
    // Checkpoints computed under another seating are stale: in hand they are
    // dropped, and in the document any peer deletes them (on any change, so
    // also one written concurrently with the seat change, whose writer may
    // be gone); confirmed again, they are written again.
    for (const t of [...this.#hashes.keys()]) if (t > changed) this.#hashes.delete(t);
    if (this.#anchor && !this.#current(this.#anchor.tick, this.#anchor)) this.#anchor = null;
    if (this.#unwritten && !this.#current(this.#unwritten.tick, this.#unwritten)) this.#unwritten = null;
    const stale = Object.entries(doc.checkpoints ?? {}).filter(([t, cp]) => !this.#current(+t, cp));
    if (stale.length)
      this.#handle.change((d) => {
        for (const [t] of stale) delete d.checkpoints[t];
      });
    if (this.#timeline) {
      if (changed < this.#timeline.floor) this.#rebase(changed);
      else if (changed !== Infinity) this.#loadSeats(changed);
      this.#verify();
    }
  }

  // ---- inputs

  #receive(msg) {
    if (this.#wall?.receive(msg)) return;
    if (msg?.m === "in") {
      const seat = this.#seat(msg.seat);
      seat.heard = this.#o.now();
      for (const [t, b] of unpack(msg.at, msg.bytes, this.#width)) {
        if (!seat.inputs.has(t)) seat.inputs.set(t, b);
        if (t > seat.top) seat.top = t;
      }
    } else if (msg?.m === "need" && this.#mine?.id === msg.seat) {
      const m = this.#mine;
      const at = Math.max(msg.from, m.from);
      const to = Math.min(m.next, at + 4 * this.#chunk);
      if (to > at) this.#handle.broadcast({ m: "in", seat: m.id, at, bytes: pack(this.#mine.inputs, at, to, this.#width) });
    }
  }

  // This peer's input, for every tick up to target - 1 + delay in its seat.
  #sample(target) {
    let m = this.#mine;
    const input = new Uint8Array(this.#o.input());
    if (input.length !== this.#width) throw new Error(`input() gave ${input.length} bytes; a port's input is ${this.#width}`);
    const last = target - 1 + this.#o.delay;
    while (m.next <= last && m.next < m.until) {
      if (m.next > m.from && m.next % this.#roll === 0) m = this.#rollOver();
      m.inputs.set(m.next, input);
      m.next++;
    }
    const seat = this.#seats.get(m.id);
    seat.top = Math.max(seat.top, m.next - 1);
    seat.heard = this.#o.now();
    // Sent when there is a new input, repeating the last few (so one lost
    // message costs nothing), and every BEAT_MS even with nothing new
    // (paused, or before the seat starts), which is how the others know the
    // holder is still here.
    const now = this.#o.now();
    if (m.next > m.sent || now - m.beat >= BEAT_MS) {
      const at = Math.max(m.from, m.next - this.#o.redundancy);
      this.#handle.broadcast({ m: "in", seat: m.id, at, bytes: pack(m.inputs, at, m.next, this.#width) });
      m.sent = m.next;
      m.beat = now;
    }
    this.#flush(false);
    if (m.next >= m.until) this.#mine = null; // the seat ended (stood, or reaped)
  }

  // Writes this seat's finished chunks (and, if `all`, the unfinished one).
  #flush(all) {
    const m = this.#mine;
    if (!m || m.next <= m.durable) return;
    const writes = [];
    while (m.durable < m.next) {
      const n = Math.floor(m.durable / this.#chunk);
      const [start, end] = chunkSpan(n, this.#chunk, m);
      const to = Math.min(end, m.next);
      if (to < end && !all) break;
      writes.push([n, pack(m.inputs, start, to, this.#width)]);
      m.durable = to;
    }
    if (!writes.length) return;
    m.handle.change((d) => {
      for (const [n, bytes] of writes) d.chunks[n] = bytes;
    });
    this.status.written.chunks += writes.length;
  }

  // A seat doc spans at most `roll` ticks: at the boundary this peer ends its
  // seat and takes the same port again with a new doc, in one change.
  #rollOver() {
    const old = this.#mine;
    this.#flush(true);
    const at = old.next;
    this.#take(old.port, at, (d) => {
      d.seats[old.id].until = at;
    });
    return this.#mine;
  }

  #take(port, from, also = () => {}) {
    const id = `${this.#o.id}.${from}`;
    const handle = this.#repo.create({ session: this.#handle.url, seat: id, port, from, chunks: {} });
    const seat = this.#seat(id);
    seat.handle = handle;
    this.#handle.change((d) => {
      also(d);
      d.seats[id] = { port, from, inputs: handle.url, ...(this.#o.by ? { by: this.#o.by } : {}) };
    });
    this.#mine = { id, port, from, until: Infinity, handle, next: from, durable: from, sent: from, beat: -Infinity, inputs: seat.inputs };
  }

  // Tells the timeline what is known of every port's input over its window.
  #feed(horizon) {
    const tl = this.#timeline;
    for (let p = 0; p < this.#ports; p++)
      for (let t = tl.floor; t < horizon; t++) {
        const id = holder(this.#seated, p, t);
        tl.put(p, t, id === null ? this.#vacant : this.#seats.get(id)?.inputs.get(t));
      }
  }

  // An input we lack below one we have was lost on the way: ask its holder.
  #askForGaps() {
    const t = this.#timeline.frontier;
    const now = this.#o.now();
    for (let p = 0; p < this.#ports; p++) {
      const id = holder(this.#seated, p, t);
      if (id === null || id === this.#mine?.id) continue;
      const seat = this.#seats.get(id);
      if (!seat || seat.inputs.has(t) || seat.top <= t) continue;
      if (now - (this.#asked.get(id) ?? -Infinity) < 100) continue;
      this.#asked.set(id, now);
      this.status.asked++;
      this.#handle.broadcast({ m: "need", seat: id, from: t });
    }
  }

  // A holder silent for SECONDS.reap loses the rest of its seat: it ends
  // where its durable inputs end, as this peer sees them. Any peer may do it
  // (the lead's call: anyone may move anything); two at once settle by
  // last writer, the same everywhere.
  #reap() {
    const now = this.#o.now();
    const doc = this.#handle.doc();
    for (const port of this.#seated)
      for (const s of port) {
        if (s.until !== Infinity || s.id === this.#mine?.id) continue;
        const seat = this.#seat(s.id);
        if (now - seat.heard < this.#o.reap * 1000) continue;
        let end = s.from;
        const chunks = seat.handle?.doc()?.chunks ?? {};
        for (const [k, bytes] of Object.entries(chunks)) {
          const [start] = chunkSpan(+k, this.#chunk, s);
          end = Math.max(end, start + bytes.length / this.#width);
        }
        if (doc.seats[s.id]?.until !== undefined) continue;
        this.#handle.change((d) => {
          d.seats[s.id].until = end;
        });
      }
  }

  // ---- checkpoints

  #settleCheckpoints() {
    // Confirmed in this frame's advance, so under the seating fed to it.
    for (const [t, snapshot] of this.#confirmedQueue.splice(0)) {
      const cp = { tick: t, snapshot, seating: seatingKey(this.#seated, t) };
      this.#hashes.set(t, hashSnapshot(snapshot));
      if (!this.#anchor || t >= this.#anchor.tick) this.#anchor = cp;
      if (this.#duty(t)) this.#write(cp);
      else if (!this.#unwritten || t >= this.#unwritten.tick) this.#unwritten = cp;
    }
    const u = this.#unwritten;
    const fallback = !this.#wall || this.#wall.reference === this.#o.id;
    if (u && fallback && this.#timeline.frontier >= u.tick + this.#every) {
      this.#unwritten = null;
      this.#write(u);
    }
    for (const t of this.#hashes.keys()) if (t < (this.#anchor?.tick ?? 0) - 2 * this.#every) this.#hashes.delete(t);
    this.#verify();
  }

  // The holder of the lowest port held at t writes its checkpoint (seat ids
  // begin with their holder's peer id). One nobody wrote in time, the
  // reference peer of the shared wall time writes; another copy, should two
  // be written, holds the same state, so either may win.
  #duty(t) {
    for (let p = 0; p < this.#ports; p++) {
      const id = holder(this.#seated, p, t);
      if (id !== null) return id.startsWith(`${this.#o.id}.`);
    }
    return false;
  }

  // Whether a checkpoint ({ seating }, in hand or in the document) was
  // computed under the current seating.
  #current(t, cp) {
    return cp.seating === seatingKey(this.#seated, t);
  }

  async #write({ tick: t, snapshot, seating }) {
    const has = () => {
      const cp = this.#handle.doc().checkpoints?.[t];
      return cp && this.#current(t, cp);
    };
    if (this.#writing.has(t) || has()) return;
    this.#writing.add(t);
    try {
      const hash = hashSnapshot(snapshot);
      const state = await gzip(snapshot);
      // The seating may have changed while gzip ran: then this state is stale.
      if (!this.#current(t, { seating }) || has()) return;
      const cp = this.#repo.create({ session: this.#handle.url, tick: t, hash, state });
      this.#handle.change((d) => {
        d.checkpoints ??= {};
        d.checkpoints[t] = { url: cp.url, hash, seating };
        const ticks = Object.keys(d.checkpoints).map(Number).sort((a, b) => b - a);
        for (const old of ticks.slice(2)) delete d.checkpoints[old];
      });
      this.status.written.checkpoints++;
    } finally {
      this.#writing.delete(t);
    }
  }

  // Our confirmed hashes against the checkpoints others wrote under the
  // same seating.
  #verify() {
    const cps = this.#handle.doc().checkpoints ?? {};
    for (const [t, ours] of this.#hashes) {
      const theirs = cps[t] && this.#current(t, cps[t]) ? cps[t].hash : undefined;
      if (theirs && theirs !== ours && !this.status.desync.some((d) => d.tick === t))
        this.status.desync.push({ tick: t, ours, theirs });
    }
  }
}
