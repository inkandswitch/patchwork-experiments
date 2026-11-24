// Ordered holds (NATIVE.md, "Holding a pose"; H6):
// the one order holds go in, a view's own holds and its peers' (holds.js,
// the hold tables and the wire), exhaustively. Real wires on a bus whose
// messages wait until the test delivers them, a doc as a plain object.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HOLD_TTL_MS, POSE_MS, createHolds, createWire, localTake, poseInterval, ranksAhead, winningHold } from "./holds.js";

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
    // the winner of any three is ahead of every other of them, in every order they can be given in
    for (const x of all) for (const y of all) for (const z of all) {
      const w = winningHold([x, y, z]);
      for (const o of [x, y, z]) if (o !== w) expect(ranksAhead(o, w)).toBe(false);
    }
    expect(winningHold([])).toBe(null);
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

/** A bus of wires whose messages wait in a queue until deliver() (what's sent before then is concurrent), or go at once; `log` is everything sent. */
function queuedBus({ atOnce = false } = {}) {
  const wires = [];
  const queue = [];
  const log = [];
  const make = (session, opts, viewer = session) => {
    const w = createWire({ send: (data) => (log.push({ session, data }), queue.push({ from: w, session, viewer, data: structuredClone(data) }), atOnce && deliver()), session: () => session, ...opts });
    wires.push(w);
    return w;
  };
  function deliver() {
    while (queue.length) {
      const { from, session, viewer, data } = queue.shift();
      for (const w of wires) if (w !== from) w.receive(data, { session, viewer });
    }
  }
  return { make, deliver, log };
}

const OBJ = "hull";
const at = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });

/**
 * Two views of one doc. Each has a wire and a hold table; an actor is a
 * holder in one of them: a person (A in view 0, B in view 1) or the process
 * (P, in view `pView`, yielding unless `driven`).
 */
function world({ pView, driven }) {
  const clock = fakeClock();
  const bus = queuedBus();
  const doc = { objects: { [OBJ]: { transform: at(0) } } };
  const views = [0, 1].map((i) => {
    const presence = bus.make(`s${i}`, { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const v = { i, presence, lost: [] };
    v.holds = createHolds({ presence, exists: (id) => !!doc.objects[id], parentOf: () => null, lost: (ext, id) => v.lost.push([ext, id]) });
    presence.watch((_h, ids) => v.holds.reconcile(ids));
    return v;
  });
  const actors = {
    A: { view: views[0], ext: "carry", yields: false, x: 1, wants: false },
    B: { view: views[1], ext: "carry", yields: false, x: 2, wants: false },
    P: { view: views[pView], ext: "proc", yields: !driven, x: 3, wants: false, process: true },
  };
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
    // a well-behaved process saves only what it still holds (its own rule: NATIVE.md, "World
    // time"; clock.js doesn't enforce it); a person writes where they put it down
    if (!holds(a)) return false;
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
  return { views, actors, events, frame, settle, doc, holds, deliver: bus.deliver };
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

/** The invariants of H6 in a settled world: what breaks one, said (none: []). */
function check(w, label) {
  const { views, actors } = w;
  const bad = [];
  const want = (ok, what) => ok || bad.push(`${label}: ${what}`);
  const holders = views.filter((v) => v.holds.has(OBJ)).map((v) => [v, v.holds.holderOf(OBJ)]);
  // one holder per object, across views (and so in each)
  want(holders.length <= 1, `${holders.length} holders`);
  const persons = [actors.A, actors.B].filter((a) => a.wants);
  const process = actors.P;
  if (holders.length) {
    const [v, ext] = holders[0];
    // every other view sees that view's hold as the one that counts
    for (const o of views) if (o !== v) want(o.presence.remoteHolds().get(OBJ)?.session === `s${v.i}`, `view ${o.i} sees another hold`);
    // a yielding hold stands only while no person who wants it is refused for it
    if (ext === "proc" && process.yields) for (const p of persons) want(p.got === false, "a yielding hold stands over a person");
  }
  // a person who wants it and was refused is refused by a hold ahead of theirs: another person's (begun first), or the driven process's
  for (const p of persons) {
    if (p.got) continue;
    want(holders.length === 1, "refused with no holder");
    const [, ext] = holders[0] ?? [];
    if (ext === "proc") want(process.yields === false, "refused for a yielding process");
  }
  // a yielding process wanting it while nobody holds a person's gets it
  if (process.wants && process.yields && !persons.some((p) => p.got)) want(process.got === true, "a yielding process wanting it, unheld, doesn't get it");
  return bad;
}

describe("H6: one holder per object, by (a person's before a yielding one, then since)", () => {
  for (const pView of [0, 1])
    for (const driven of [false, true])
      for (const heard of [true, false])
        it(`the process in ${pView === 0 ? "A's view (one view)" : "B's view (across)"}, ${driven ? "driven" : "not driven"}, ${heard ? "each event heard before the next" : "events in pairs, each pair concurrent"}: every sequence of up to 4 events`, () => {
          let runs = 0;
          const bad = [];
          for (const seq of allSequences(4)) {
            const w = world({ pView, driven });
            const label = seq.join(", ") || "(nothing)";
            seq.forEach((e, i) => {
              w.events[e]();
              w.frame();
              if (heard || i % 2 === 1) w.settle();
            });
            w.settle();
            bad.push(...check(w, label));
            runs++;
          }
          expect(bad.slice(0, 5)).toEqual([]);
          expect(runs).toBe(11111);
        });
});

// ─── the wire, between two views ────────────────────────────────────────────
// a (session sa, viewer alice) and b (sb, bob): what one sends the other
// hears at once; everything sent is logged.

let clock, bus, a, b, rates;
const sent = (from) => bus.log.filter((l) => l.session === `s${from.toLowerCase()}`).map((l) => l.data);

beforeEach(() => {
  clock = fakeClock();
  bus = queuedBus({ atOnce: true });
  rates = new Map(); // a's callers' pose rates
  const opts = { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer };
  a = bus.make("sa", { ...opts, interval: () => poseInterval(rates.values()) }, "alice");
  b = bus.make("sb", opts, "bob");
});

describe("pose holds", () => {
  const T = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });

  it("throttles to one pose per 50 ms per object, with a trailing send", () => {
    for (let i = 0; i < 10; i++) {
      a.hold("hand", "o1", "g1", T(i));
      // another object, held while o1 waits for its slot: it goes at once
      if (i === 2) {
        a.hold("hand", "o2", null, T(-1));
        expect(sent("A").at(-1).id).toBe("o2");
      }
      clock.advance(10);
    }
    // 100 ms: at 0, at 50 (carrying the latest by then), then the trailing one at 100
    const poses = sent("A").filter((m) => m.id === "o1");
    expect(poses.length).toBe(3);
    expect(poses[0].transform).toEqual(T(0));
    expect(poses[1].transform).toEqual(T(4));
    clock.advance(POSE_MS);
    const after = sent("A");
    expect(after.at(-1).transform).toEqual(T(9)); // the last pose always goes
    expect(b.remoteHolds().get("o1")).toMatchObject({ session: "sa", viewer: "alice", parent: "g1", transform: T(9), landed: null });
  });

  it("a put-back drops the hold at once", () => {
    const fn = vi.fn();
    b.watch(fn);
    a.hold("hand", "o1", null, T(1));
    expect(b.heldBy("o1")).toBe("sa");
    a.release("hand", "o1");
    expect(sent("A").at(-1)).toMatchObject({ id: "o1", transform: null });
    expect(sent("A").at(-1).landed).toBeUndefined();
    expect(b.remoteHolds().has("o1")).toBe(false);
    expect(b.heldBy("o1")).toBe(null);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][1]).toEqual(["o1"]);
  });

  it("a landed release keeps the last pose with landed set, until settled or 3 s", () => {
    a.hold("hand", "o1", null, T(1));
    a.release("hand", "o1", T(2));
    expect(sent("A").at(-1)).toMatchObject({ id: "o1", transform: null, landed: T(2) });
    expect(b.remoteHolds().get("o1")).toMatchObject({ transform: T(1), landed: T(2) });
    expect(b.heldBy("o1")).toBe(null); // landed is no longer held
    clock.advance(HOLD_TTL_MS - 1);
    expect(b.remoteHolds().has("o1")).toBe(true);
    clock.advance(1);
    expect(b.remoteHolds().has("o1")).toBe(false);

    a.hold("hand", "o2", null, T(1));
    a.release("hand", "o2", T(3));
    b.settle("o2"); // the stage saw its doc catch up
    expect(b.remoteHolds().has("o2")).toBe(false);
  });

  it("only the extension holding an object releases it", () => {
    a.hold("hand", "o1", null, T(1));
    a.release("halo", "o1");
    expect(b.heldBy("o1")).toBe("sa");
  });

  it("a release cancels a pending trailing pose", () => {
    a.hold("hand", "o1", null, T(1));
    clock.advance(10);
    a.hold("hand", "o1", null, T(2)); // waits for its slot
    a.release("hand", "o1");
    clock.advance(1000);
    expect(b.remoteHolds().has("o1")).toBe(false);
    expect(sent("A").map((m) => m.transform)).toEqual([T(1), null]);
  });

  it("drops a hold not refreshed for 3 s (the holder went silent)", () => {
    // forged peer that never refreshes
    b.receive({ id: "o1", parent: null, transform: T(1), since: 1, seq: 1 }, { session: "sz", viewer: "zed" });
    expect(b.heldBy("o1")).toBe("sz");
    clock.advance(HOLD_TTL_MS);
    expect(b.heldBy("o1")).toBe(null);
  });

  it("keeps a still hold alive with resends", () => {
    a.hold("hand", "o1", null, T(1));
    const stamp = b.remoteHolds().get("o1").since;
    clock.advance(HOLD_TTL_MS * 3);
    expect(b.heldBy("o1")).toBe("sa");
    expect(b.remoteHolds().get("o1").since).toBe(stamp); // resends keep the hold's stamp
  });

  it("heldBy and remoteHolds report the earliest of two holders", () => {
    a.hold("hand", "o1", null, T(1));
    clock.advance(100);
    b.receive({ id: "o1", parent: null, transform: T(9), since: 50, seq: 1 }, { session: "sz", viewer: "zed" });
    expect(b.heldBy("o1")).toBe("sa");
    expect(b.remoteHolds().get("o1").transform).toEqual(T(1));
    a.release("hand", "o1");
    expect(b.heldBy("o1")).toBe("sz"); // the other hold was kept underneath
    expect(b.remoteHolds().get("o1").transform).toEqual(T(9));
  });

  it("every view ranks two holds alike, whatever order it heard them in (the holder's stamp)", () => {
    const pose = (session, since) => b.receive({ id: "o9", parent: null, transform: T(1), since, seq: 1 }, { session, viewer: session });
    // b hears the later grab first
    pose("late", 2_000);
    pose("early", 1_500);
    expect(b.heldBy("o9")).toBe("early");
    expect(b.remoteHolds().get("o9").session).toBe("early");
  });

  it("a hold begun after hearing of another ranks after it, whatever the clocks say", () => {
    a.hold("hand", "o1", null, T(1));
    // b's clock is far behind a's: stamps, not times, decide
    b.hold("hand", "o1", null, T(2));
    expect(b.heldBy("o1")).toBe("sa"); // b should let go
    expect(a.heldBy("o1")).toBe(null); // a was first: its own, and b's later hold doesn't count against it
    expect(sent("B")[0].since).toBeGreaterThan(sent("A")[0].since);
  });

  it("goodbye (pagehide) puts holds back", () => {
    a.hold("hand", "o1", null, T(1));
    a.goodbye();
    expect(b.heldBy("o1")).toBe(null);
  });

  it("ignores a pose that arrives after a later release", () => {
    a.hold("hand", "o1", null, T(1));
    const first = sent("A")[0];
    a.release("hand", "o1");
    b.receive(first, { session: "sa", viewer: "alice" }); // replayed late
    expect(b.heldBy("o1")).toBe(null);
  });

  it("a peer gone (a bye) ends its holds", () => {
    a.hold("hand", "o1", null, T(1));
    b.dropHoldsOf("sa");
    expect(b.remoteHolds().size).toBe(0);
  });

});

describe("pose streams, for playing back", () => {
  const T = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });

  it("raising the pose rate (asking for less than 20 Hz still sends at 20)", () => {
    rates.set("slow", 10);
    a.hold("sim", "hull", null, T(-1));
    expect(sent("A").at(-1).every).toBe(POSE_MS);
    clock.advance(POSE_MS);
    rates.set("sim", 60);
    for (let i = 0; i < 12; i++) {
      a.hold("sim", "hull", null, T(i));
      clock.advance(1000 / 60);
    }
    // 200 ms at 60 Hz: a pose a frame, not one per 50 ms
    const poses = sent("A").filter((m) => m.id === "hull");
    expect(poses.length).toBeGreaterThanOrEqual(11);
    expect(poses.at(-1).every).toBeCloseTo(1000 / 60);
    expect(b.remoteHolds().get("hull").every).toBeCloseTo(1000 / 60);
  });

  it("a peer keeps the last few as samples on the sender's clock, with its clock's offset", () => {
    for (let i = 0; i < 4; i++) {
      a.hold("sim", "hull", null, T(i));
      clock.advance(POSE_MS);
    }
    const h = b.remoteHolds().get("hull");
    expect(h.samples.map((x) => x.transform.position[0])).toEqual([0, 1, 2, 3]);
    expect(h.samples[1].at - h.samples[0].at).toBe(POSE_MS);
    expect(h.offset).toBe(0); // one clock, delivered at once
    expect(Object.isFrozen(h.samples)).toBe(true);
  });

  it("the offset is ours minus the sender's, from its stamps; an unstamped pose is timed on arrival", () => {
    // a peer whose clock is 5 s behind ours, its poses 20 ms on the way
    const pose = (seq, x, at) => b.receive({ id: "o9", parent: null, transform: T(x), since: 1, seq, at, every: 50 }, { session: "sz", viewer: "zed" });
    pose(1, 0, clock.now() - 5_020);
    expect(b.remoteHolds().get("o9").offset).toBe(5_020);
    expect(b.remoteHolds().get("o9").samples[0].at).toBe(clock.now() - 5_020);
    // a pose with no stamp and no interval
    b.receive({ id: "o8", parent: null, transform: T(1), since: 1, seq: 1 }, { session: "sy", viewer: "yan" });
    expect(b.remoteHolds().get("o8")).toMatchObject({ offset: 0, every: POSE_MS, samples: [{ at: clock.now(), transform: T(1) }] });
  });

  it("a trailing pose is stamped when it was held, not when it went", () => {
    a.hold("sim", "hull", null, T(0));
    clock.advance(20);
    const heldAt = clock.now();
    a.hold("sim", "hull", null, T(1)); // waits for the 50 ms
    clock.advance(POSE_MS);
    const msg = sent("A").at(-1);
    expect(msg.transform).toEqual(T(1));
    expect(msg.at).toBe(heldAt);
  });

  it("shownAt: the moment on a peer's clock whose holds are drawn now, behind by the playout delay", () => {
    expect(b.shownAt("sa")).toBe(null); // nothing heard yet
    rates.set("sim", 30);
    a.hold("sim", "hull", null, T(0));
    // one clock, delivered at once: 1.5 intervals at 30 Hz behind
    expect(b.shownAt("sa")).toBeCloseTo(clock.now() - 1.5 * (1000 / 30));
    // a peer whose clock is 5 s behind ours
    b.receive({ id: "o9", parent: null, transform: T(0), since: 1, seq: 1, at: clock.now() - 5_000, every: 50 }, { session: "sz", viewer: "zed" });
    expect(b.shownAt("sz")).toBe(clock.now() - 5_000 - 75);
    // gone with a bye: unknown again
    b.dropHoldsOf("sa");
    expect(b.shownAt("sa")).toBe(null);
  });

  it("a new hold, or the same one moved to another parent, starts its samples afresh", () => {
    a.hold("hand", "o1", "g1", T(1));
    clock.advance(POSE_MS);
    a.hold("hand", "o1", "g1", T(2));
    expect(b.remoteHolds().get("o1").samples).toHaveLength(2);
    clock.advance(POSE_MS);
    a.hold("hand", "o1", "g2", T(3));
    expect(b.remoteHolds().get("o1").samples.map((x) => x.transform)).toEqual([T(3)]);
    a.release("hand", "o1");
    a.hold("hand", "o1", "g2", T(4));
    expect(b.remoteHolds().get("o1").samples.map((x) => x.transform)).toEqual([T(4)]);
  });
});


describe("what the wire won't take", () => {
  it("a pose without an id, a transform or a stamp is no hold", () => {
    const fn = vi.fn();
    b.watch(fn);
    for (const m of [{ id: "o1", transform: 3, seq: 1 }, { transform: {}, seq: 1 }, { id: "o1", transform: { position: [1, 2, 3] }, seq: 1 }, null]) b.receive(m, { session: "sz" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("every hold the wire knows of (all(): scene.poses' inspect)", () => {
  // Over every order of up to three holds on one object by two views (a
  // person's or a yielding one each, the second view's heard or concurrent):
  // all() lists each live hold once, its rank its place in ranksAhead's
  // order, and rank 0 is the hold heldBy says counts.
  it("each hold once, ranked as ranksAhead orders them; rank 0 is the one that counts", () => {
    const actors = [["a", "hand", false], ["a", "proc", true], ["b", "hand", false], ["b", "proc", true]];
    let n = 0;
    for (const p of actors)
      for (const q of actors)
        for (const sync of [false, true]) {
          if (p[0] === q[0]) continue;
          const clock = fakeClock();
          const bus = queuedBus({ atOnce: sync });
          const wa = bus.make("a", clock);
          const wb = bus.make("b", clock);
          const wire = { a: wa, b: wb };
          wire[p[0]].hold(p[1], OBJ, null, at(1), p[2]);
          wire[q[0]].hold(q[1], OBJ, null, at(2), q[2]);
          bus.deliver();
          for (const [s, w] of Object.entries(wire)) {
            const all = w.all();
            expect(all.map((h) => h.session).sort()).toEqual(["a", "b"]);
            expect(all.map((h) => h.rank)).toEqual([0, 1]);
            expect(ranksAhead(all[0], all[1])).toBe(true);
            // the first is this view's own iff no peer's ranks ahead of it
            expect(all[0].mine).toBe(w.heldBy(OBJ, { yields: all.find((h) => h.mine).yields }) == null);
            expect(all.find((h) => h.mine)).toMatchObject({ session: s, ext: s === p[0] ? p[1] : q[1] });
            n++;
          }
        }
    expect(n).toBe(32);
  });
});
