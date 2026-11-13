// The session's durable record, read from its documents: who held each port
// when (the seats), every input they wrote (their seat documents), and the
// checkpoints. It is the session's one history: a peer that confirms a tick
// confirms the state these give, so the state at any tick is genesis, or a
// checkpoint, with these rows stepped (travel.js). Nothing in it is ever
// forgotten: Automerge keeps every seat document whole, and the session
// keeps every seat and every checkpoint that is still good.
import { seating, holder, chunkSpan, unpack, seatingKey, firstDifference } from "../host/session.js";

export class Record {
  #width;
  #ports;
  #vacant;
  #chunk;
  #seats = {}; // the session's seats, as last read
  #inputs = new Map(); // seat id -> { from, inputs: Map<tick, bytes>, ingested: Map<n, length>, upto }
  seated;
  checkpointsAll = {};

  /** @param doc the session document */
  constructor(doc) {
    this.#width = doc.engine.inputBytes;
    this.#ports = doc.engine.players;
    this.#vacant = new Uint8Array(doc.vacant);
    this.#chunk = doc.chunk;
    this.genesis = doc.engine.genesis;
    this.seated = seating({}, this.#ports);
    this.update(doc);
  }

  get ports() {
    return this.#ports;
  }

  /**
   * Reads the session document again. Returns the first tick from which the
   * record now says something else (a seat taken or ended in the past), or
   * Infinity: states after it, rebuilt before, are no longer the session's.
   */
  update(doc) {
    this.#seats = doc.seats ?? {};
    this.checkpointsAll = doc.checkpoints ?? {};
    const next = seating(this.#seats, this.#ports);
    const changed = firstDifference(this.seated, next);
    this.seated = next;
    return changed;
  }

  /** Every seat the record holds: [{ id, port, from, until, by, inputs (url) }]. */
  seats() {
    return this.seated.flatMap((list, port) => list.map((s) => ({ ...s, port, by: this.#seats[s.id]?.by ?? null, inputs: this.#seats[s.id]?.inputs })));
  }

  /** Reads a seat document's chunks that are new or longer than last time. */
  ingest(id, d) {
    if (!d?.chunks) return;
    let seat = this.#inputs.get(id);
    if (!seat) this.#inputs.set(id, (seat = { from: d.from, inputs: new Map(), ingested: new Map(), upto: d.from }));
    for (const [k, bytes] of Object.entries(d.chunks)) {
      const n = +k;
      if (seat.ingested.get(n) === bytes.length) continue;
      seat.ingested.set(n, bytes.length);
      const [start] = chunkSpan(n, this.#chunk, { from: d.from });
      for (const [t, b] of unpack(start, bytes, this.#width)) seat.inputs.set(t, b);
    }
    while (seat.inputs.has(seat.upto)) seat.upto++;
  }

  /** The inputs stepped at tick t (players × inputBytes), or null where some aren't written yet. */
  rowAt(t) {
    const row = new Uint8Array(this.#ports * this.#width);
    for (let p = 0; p < this.#ports; p++) {
      const id = holder(this.seated, p, t);
      const b = id === null ? this.#vacant : this.#inputs.get(id)?.inputs.get(t);
      if (!b) return null;
      row.set(b, p * this.#width);
    }
    return row;
  }

  /** One port's input at tick t, or null. */
  inputAt(port, t) {
    const id = holder(this.seated, port, t);
    return id === null ? this.#vacant : this.#inputs.get(id)?.inputs.get(t) ?? null;
  }

  /**
   * The first tick whose row is not all written. Past the last seat's end
   * every port is vacant, so the record goes on for ever; the session ran
   * only as far as its clock, so then this is where the last seat ended.
   */
  get end() {
    let end = Infinity, last = 0;
    for (const list of this.seated)
      for (const s of list) {
        const upto = this.#inputs.get(s.id)?.upto ?? s.from;
        if (upto < s.until) end = Math.min(end, upto);
        if (s.until !== Infinity) last = Math.max(last, s.until);
      }
    return end === Infinity ? last : end;
  }

  /** The checkpoints good under the current seating: [{ tick, url, hash }], by tick. */
  checkpoints() {
    return Object.entries(this.checkpointsAll)
      .filter(([t, cp]) => cp.seating === seatingKey(this.seated, +t))
      .map(([t, cp]) => ({ tick: +t, url: cp.url, hash: cp.hash }))
      .sort((a, b) => a.tick - b.tick);
  }
}
