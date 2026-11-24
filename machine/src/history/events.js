// The session document's own history, which Automerge keeps whole: what each
// change to it did, when, and by whom. The seats are where people meet in
// the record: a port taken, given back, reaped from someone silent, rolled
// over to a new input document, or claimed by two at once (the seating
// settles that the same way everywhere; the one who lost gives up its claim).
// Checkpoints are written, and dropped when a seat change in the past makes
// them stale. The clock is paused and resumed.
//
// Read from a DocHandle: history() lists the changes, metadata() says who
// and when, and diff(deps, change) what that change alone did. A change's
// deps come as hashes and diff wants heads as history() spells them;
// history() itself is the dictionary between the two.

/**
 * @typedef {object} Event
 * @property {string} hash     the change
 * @property {number} time     ms
 * @property {string} actor
 * @property {string} kind     made | claim | end | lost | reap | roll | checkpoint | stale | pause | resume
 * @property {number} [port]
 * @property {number} [tick]   the tick it is about (a seat's from or until, a checkpoint's)
 * @property {string} [seat]
 * @property {string|null} [by]    who held the seat
 * @property {string|null} [who]   who made the change, as far as the record says (an actor that claimed a seat)
 * @property {boolean} [concurrent]  a claim made without having seen another claim on the port
 */

/**
 * The events of a session document, oldest first, its tick rate hz. `memo`
 * (kept by the caller) holds the changes already read, so calling it again
 * as the document grows reads only the new ones.
 */
export function sessionEvents(handle, hz, memo = { changes: new Map(), spelled: new Map() }) {
  const out = [];
  const doc = handle.doc();
  const seats = doc.seats ?? {};
  const deps = new Map(); // hash -> deps, for ancestry
  const { changes: seen, spelled } = memo; // read changes; hash -> the head as history() spells it
  for (const [h] of handle.history()) {
    let e = seen.get(h);
    if (!e) {
      const m = handle.metadata(h);
      spelled.set(m.hash, h);
      const patches = handle.diff(m.deps.map((d) => spelled.get(d)), [h]);
      e = { hash: m.hash, deps: m.deps, time: m.time * 1000, actor: m.actor, ops: read(patches, handle, h) };
      seen.set(h, e);
    }
    deps.set(e.hash, e.deps);
    out.push(e);
  }
  // Who an actor is: the person in a seat it claimed.
  const names = new Map();
  for (const e of out) for (const o of e.ops) if (o.kind === "claim") names.set(e.actor, seats[o.seat]?.by ?? null);
  const claims = new Map(); // seat -> the change that claimed it
  for (const e of out) for (const o of e.ops) if (o.kind === "claim") claims.set(o.seat, e);
  const ancestor = ancestry(deps);

  const events = [];
  for (const e of out) {
    const ends = e.ops.filter((o) => o.kind === "end");
    const made = e.ops.filter((o) => o.kind === "claim");
    for (const o of e.ops) {
      const s = o.seat ? seats[o.seat] : null;
      const base = { hash: e.hash, time: e.time, actor: e.actor, who: names.get(e.actor) ?? null };
      if (o.kind === "claim") {
        // Rolled over: the same change ends the seat it follows on.
        if (ends.some((x) => seats[x.seat]?.port === s?.port && x.until === s?.from)) continue;
        const rivals = [...claims].filter(([id, c]) => id !== o.seat && seats[id]?.port === s?.port && c !== e && !ancestor(c.hash, e.hash) && !ancestor(e.hash, c.hash));
        events.push({ ...base, kind: "claim", seat: o.seat, port: s?.port, tick: s?.from, by: s?.by ?? null, concurrent: rivals.length > 0 });
      } else if (o.kind === "end") {
        const roll = made.some((x) => seats[x.seat]?.port === s?.port && seats[x.seat]?.from === o.until);
        const own = claims.get(o.seat)?.actor === e.actor;
        const kind = o.until <= (s?.from ?? -1) ? "lost" : roll ? "roll" : own ? "end" : "reap";
        events.push({ ...base, kind, seat: o.seat, port: s?.port, tick: o.until, by: s?.by ?? null });
      } else if (o.kind === "made") events.push({ ...base, kind: "made", tick: 0 });
      else if (o.kind === "checkpoint" || o.kind === "stale") events.push({ ...base, kind: o.kind, tick: o.tick });
      else if (o.kind === "clock") events.push({ ...base, kind: o.until === undefined ? "resume" : "pause", tick: Math.round((o.until ?? o.t) * hz) });
    }
  }
  return events;
}

// What one change's patches did, in the session's terms.
function read(patches, handle, h) {
  const ops = [];
  const seen = new Set();
  for (const p of patches) {
    const [top, key, field] = p.path;
    if (top === "engine" && !seen.has("made")) {
      seen.add("made");
      ops.push({ kind: "made" });
    } else if (top === "seats" && key !== undefined && field === undefined && p.action === "put") ops.push({ kind: "claim", seat: key });
    else if (top === "seats" && field === "until" && p.action === "put") ops.push({ kind: "end", seat: key, until: p.value });
    else if (top === "checkpoints" && key !== undefined && p.path.length === 2)
      ops.push({ kind: p.action === "del" ? "stale" : "checkpoint", tick: +key });
    else if (top === "clock" && !seen.has("clock")) {
      seen.add("clock");
      const c = handle.view([h]).doc().clock ?? {};
      ops.push({ kind: "clock", t: c.t, until: c.until });
    }
  }
  return ops;
}

// Whether change a is an ancestor of change b, over the deps graph.
function ancestry(deps) {
  const memo = new Map();
  const above = (b) => {
    let s = memo.get(b);
    if (s) return s;
    s = new Set();
    const stack = [...(deps.get(b) ?? [])];
    while (stack.length) {
      const x = stack.pop();
      if (s.has(x)) continue;
      s.add(x);
      stack.push(...(deps.get(x) ?? []));
    }
    memo.set(b, s);
    return s;
  };
  return (a, b) => above(b).has(a);
}
