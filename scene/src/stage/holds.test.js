// Ordered holds (TOOLS.md §7, "A person and a process on one object"; H6):
// the one order holds go in, a view's own holds (holds.js) and its peers'
// (presence.js), exhaustively. Real presences on a bus whose messages wait
// until the test delivers them, real hold tables, a doc as a plain object.
import { describe, it, expect } from "vitest";
import { createPresence, ranksAhead, winningHold } from "./presence.js";
import { createHolds, localTake } from "./holds.js";

// ─── the order ──────────────────────────────────────────────────────────────

describe("the order of holds", () => {
  const all = [];
  for (const landed of [null, { position: [0, 0, 0] }]) for (const yields of [false, true]) for (const since of [1, 2]) for (const session of ["a", "b"]) all.push({ landed, yields, since, session });

  it("is one total order: for every two distinct holds exactly one ranks ahead, and it's transitive", () => {
    for (const x of all)
      for (const y of all) {
        if (x === y) {
          expect(ranksAhead(x, y)).toBe(false);
          continue;
        }
        expect(ranksAhead(x, y) !== ranksAhead(y, x)).toBe(true);
        for (const z of all) if (ranksAhead(x, y) && ranksAhead(y, z)) expect(ranksAhead(x, z)).toBe(true);
      }
  });

  it("puts a held one before a landed one, a person's before a yielding one, then the earlier, then the session", () => {
    const h = (o) => ({ landed: null, yields: false, since: 1, session: "a", ...o });
    expect(ranksAhead(h({ since: 9 }), h({ landed: {} }))).toBe(true);
    expect(ranksAhead(h({ since: 9 }), h({ yields: true }))).toBe(true);
    expect(ranksAhead(h({ since: 1 }), h({ since: 2 }))).toBe(true);
    expect(ranksAhead(h({ session: "a" }), h({ session: "b" }))).toBe(true);
    // the winner of any set is ahead of every other in it, whatever order it's given in
    for (const x of all) for (const y of all) for (const z of all) {
      const w = winningHold([x, y, z]);
      for (const o of [x, y, z]) if (o !== w) expect(ranksAhead(o, w)).toBe(false);
      expect(winningHold([z, y, x])).toBe(winningHold([x, z, y]) === w ? w : winningHold([z, y, x]));
    }
  });

  it("here, in one view: a person takes from a process, never the other way; of two of a kind the first stays", () => {
    expect(localTake(null, "x", false)).toBe("take");
    expect(localTake(null, "x", true)).toBe("take");
    for (const yields of [false, true]) expect(localTake({ ext: "x", yields }, "x", !yields)).toBe("keep");
    expect(localTake({ ext: "proc", yields: true }, "carry", false)).toBe("take");
    expect(localTake({ ext: "carry", yields: false }, "proc", true)).toBe("refuse");
    expect(localTake({ ext: "carry", yields: false }, "halo", false)).toBe("refuse");
    expect(localTake({ ext: "proc", yields: true }, "other", true)).toBe("refuse");
  });
});

// ─── two views ──────────────────────────────────────────────────────────────

/** Timers that run in due order when advanced. */
function fakeClock() {
  let t = 1_000;
  let id = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => (timers.set(id, { at: t + Math.max(0, ms), fn }), id++),
    clearTimer: (k) => k != null && timers.delete(k),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let due = null;
        for (const [k, x] of timers) if (x.at <= end && (!due || x.at < due[1].at || (x.at === due[1].at && k < due[0]))) due = [k, x];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

/** A bus whose messages wait in a queue until deliver(): what's sent before then is concurrent. */
function queuedBus() {
  const handles = [];
  const queue = [];
  const make = () => {
    const listeners = new Set();
    const h = {
      listeners,
      broadcast: (message) => queue.push({ from: h, message }),
      on: (ev, fn) => ev === "ephemeral-message" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
    };
    handles.push(h);
    return h;
  };
  function deliver() {
    while (queue.length) {
      const { from, message } = queue.shift();
      for (const h of handles) if (h !== from) for (const fn of [...h.listeners]) fn({ message });
    }
  }
  return { make, deliver };
}

const OBJ = "hull";
const at = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });

/**
 * Two views of one doc. Each has a presence and a hold table; an actor is a
 * holder in one of them: a person (A in view 0, B in view 1) or the process
 * (P, in view `pView`, yielding unless `driven`).
 */
function world({ pView, driven }) {
  const clock = fakeClock();
  const bus = queuedBus();
  const doc = { objects: { [OBJ]: { transform: at(0) } } };
  const views = [0, 1].map((i) => {
    const presence = createPresence({ handle: bus.make(), viewer: `v${i}`, session: `s${i}`, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const v = { i, presence, lost: [] };
    v.holds = createHolds({ presence, exists: (id) => !!doc.objects[id], parentOf: () => null, lost: (ext, id) => v.lost.push([ext, id]) });
    presence.watchHolds((_h, ids) => v.holds.reconcile(ids));
    return v;
  });
  const actors = {
    A: { view: views[0], ext: "carry", yields: false, x: 1, wants: false },
    B: { view: views[1], ext: "carry", yields: false, x: 2, wants: false },
    P: { view: views[pView], ext: "proc", yields: !driven, x: 3, wants: false, process: true },
  };
  const writes = []; // { by, holderEverywhere }
  /** Does this actor's view hold it for this actor now? */
  const holds = (a) => a.view.holds.holderOf(OBJ) === a.ext;
  const frame = () => {
    // everyone who wants it holds it again (a process every step, a carry every frame)
    for (const a of Object.values(actors)) if (a.wants) a.got = a.view.holds.hold(a.ext, OBJ, at(a.x), { yields: a.yields });
  };
  const settle = () => {
    for (let i = 0; i < 4; i++) {
      bus.deliver();
      clock.advance(60);
      bus.deliver();
      frame();
    }
    bus.deliver();
  };
  const land = (a) => {
    // a process saves only what it still holds; a person writes where they put it down
    if (!holds(a)) return false;
    writes.push({ by: a, personHeld: views.some((v) => v.holds.holderOf(OBJ) === "carry") });
    doc.objects[OBJ].transform = at(a.x);
    a.view.holds.release(a.ext, OBJ, at(a.x));
    return true;
  };
  const events = {
    "A take": () => (actors.A.wants = true),
    "A land": () => (land(actors.A), (actors.A.wants = false)),
    "A leave": () => (actors.A.view.holds.release("carry", OBJ), (actors.A.wants = false)),
    "B take": () => (actors.B.wants = true),
    "B land": () => (land(actors.B), (actors.B.wants = false)),
    "B leave": () => (actors.B.view.holds.release("carry", OBJ), (actors.B.wants = false)),
    "P take": () => (actors.P.wants = true),
    "P land": () => land(actors.P), // a checkpoint: it saves, and steps on
    "P leave": () => (actors.P.view.holds.release("proc", OBJ), (actors.P.wants = false)),
    pause: () => (land(actors.P), (actors.P.wants = false)), // the checkpoint on pause, then no more steps
  };
  return { views, actors, events, frame, settle, writes, doc, holds, deliver: bus.deliver };
}

const KINDS = ["A take", "A land", "A leave", "B take", "B land", "B leave", "P take", "P land", "P leave", "pause"];

/** Every sequence of up to n of the events. */
function* sequences(n) {
  yield [];
  if (n === 0) return;
  for (const rest of sequences(n - 1)) if (rest.length === n - 1) for (const k of KINDS) yield [...rest, k];
}
const allSequences = (n) => {
  const out = [];
  for (let k = 0; k <= n; k++) for (const s of sequences(k)) if (s.length === k) out.push(s);
  return out;
};

/** The invariants of H6 in a settled world. */
function check(w, label) {
  const { views, actors } = w;
  const holders = views.filter((v) => v.holds.has(OBJ)).map((v) => [v, v.holds.holderOf(OBJ)]);
  // one holder per object, across views (and so in each)
  expect(holders.length, label).toBeLessThanOrEqual(1);
  const persons = [actors.A, actors.B].filter((a) => a.wants);
  const process = actors.P;
  if (holders.length) {
    const [v, ext] = holders[0];
    // every other view sees that view's hold as the one that counts
    for (const o of views) if (o !== v) expect(o.presence.remoteHolds().get(OBJ)?.session, label).toBe(v.presence.session);
    // a yielding hold stands only while no person who wants it is refused for it
    if (ext === "proc" && process.yields) for (const p of persons) expect(p.got, label).toBe(false);
  }
  // a person who wants it and was refused is refused by a hold ahead of theirs: another person's (begun first), or the driven process's
  for (const p of persons) {
    if (p.got) continue;
    expect(holders.length, label).toBe(1);
    const [, ext] = holders[0];
    if (ext === "proc") expect(process.yields, label).toBe(false);
  }
  // a yielding process wanting it while nobody holds a person's gets it
  if (process.wants && process.yields && !persons.some((p) => p.got)) expect(process.got, label).toBe(true);
}

describe("H6: one holder per object, by (a person's before a yielding one, then since)", () => {
  for (const pView of [0, 1])
    for (const driven of [false, true])
      for (const heard of [true, false])
        it(`the process in ${pView === 0 ? "A's view (one view)" : "B's view (across)"}, ${driven ? "driven" : "not driven"}, ${heard ? "each event heard before the next" : "events in pairs, each pair concurrent"}: every sequence of up to 4 events`, () => {
          let runs = 0;
          for (const seq of allSequences(4)) {
            const w = world({ pView, driven });
            const label = seq.join(", ") || "(nothing)";
            seq.forEach((e, i) => {
              w.events[e]();
              w.frame();
              if (heard || i % 2 === 1) w.settle();
            });
            w.settle();
            check(w, label);
            // a process saves only what it holds: with every hold heard, none of its writes came while a person held it
            if (heard) for (const x of w.writes) if (x.by === w.actors.P) expect(x.personHeld, label).toBe(false);
            runs++;
          }
          expect(runs).toBe(11111);
        });
});
