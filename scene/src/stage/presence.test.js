import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPresence,
  effectiveHz,
  cleanKeys,
  winningHold,
  same,
  HEARTBEAT_MS,
  PEER_TTL_MS,
  POSE_MS,
  HOLD_TTL_MS,
} from "./presence.js";

// A clock whose timers run in due order when advanced.
function fakeClock() {
  let t = 1_000;
  let nextId = 1;
  const timers = new Map(); // id → { at, fn }
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimer: (id) => {
      if (id != null) timers.delete(id);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let due = null;
        for (const [id, x] of timers) if (x.at <= end && (!due || x.at < due[1].at || (x.at === due[1].at && id < due[0]))) due = [id, x];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

// Each handle's broadcast goes to every other handle's listeners. Everything
// sent is also logged, so tests can count messages.
function fakeBus() {
  const handles = [];
  const log = [];
  function makeHandle(name) {
    const listeners = new Set();
    const h = {
      name,
      broadcast(message) {
        log.push({ from: name, message });
        for (const other of handles) if (other !== h) for (const fn of [...other.listeners]) fn({ message, senderId: name });
      },
      on: (ev, fn) => ev === "ephemeral-message" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
      listeners,
      // a message from outside (a forged or broken one)
      inject: (message) => [...listeners].forEach((fn) => fn({ message, senderId: "x" })),
    };
    handles.push(h);
    return h;
  }
  return { makeHandle, log };
}

let clock, bus, a, b, ha, hb;
const sent = (from, type) => bus.log.filter((l) => l.from === from && l.message.type === type).map((l) => l.message);

beforeEach(() => {
  clock = fakeClock();
  bus = fakeBus();
  ha = bus.makeHandle("A");
  hb = bus.makeHandle("B");
  const opts = { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer };
  a = createPresence({ handle: ha, viewer: "alice", session: "sa", ...opts });
  b = createPresence({ handle: hb, viewer: "bob", session: "sb", ...opts });
  clock.advance(1000); // let the hellos settle
});

describe("pure helpers", () => {
  it("compares plain data by value", () => {
    expect(same([1, 2], [1, 2])).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same(null, {})).toBe(false);
    expect(same(NaN, NaN)).toBe(true);
  });
  it("rate is the highest asked, never below the default", () => {
    expect(effectiveHz([])).toBe(4);
    expect(effectiveHz([1])).toBe(4);
    expect(effectiveHz([10, 20])).toBe(20);
    expect(effectiveHz([1000])).toBe(60);
  });
  it("cleans keys to { ext: { key: value } }", () => {
    expect(cleanKeys(undefined)).toEqual({});
    expect(cleanKeys("x")).toBe(null);
    expect(cleanKeys({ sel: { id: "o1" }, bad: 3, list: [1] })).toEqual({ sel: { id: "o1" } });
  });
  it("a held hold beats a landed one, then the earliest, then the lower session", () => {
    expect(winningHold([{ session: "b", since: 1, landed: {} }, { session: "c", since: 5, landed: null }]).session).toBe("c");
    expect(winningHold([{ session: "b", since: 5, landed: null }, { session: "c", since: 2, landed: null }]).session).toBe("c");
    expect(winningHold([{ session: "b", since: 2, landed: null }, { session: "a", since: 2, landed: null }]).session).toBe("a");
    expect(winningHold([])).toBe(null);
  });
});

describe("presence state", () => {
  it("each peer learns the other on hello, without seeing itself", () => {
    expect(Object.keys(a.get())).toEqual(["sb"]);
    expect(Object.keys(b.get())).toEqual(["sa"]);
    expect(b.get().sa).toMatchObject({ viewer: "alice", keys: {} });
  });

  it("sends the whole state, namespaced by extension", () => {
    a.set("select", "id", "o1");
    clock.advance(1000);
    a.set("hover", "id", "o2");
    clock.advance(1000);
    expect(b.get().sa.keys).toEqual({ select: { id: "o1" }, hover: { id: "o2" } });
    const last = sent("A", "scene:presence").at(-1);
    expect(last).toMatchObject({ session: "sa", viewer: "alice", keys: { select: { id: "o1" }, hover: { id: "o2" } } });
    expect(typeof last.seq).toBe("number");
    expect(typeof last.at).toBe("number");
  });

  it("replaces a peer's record only with a newer seq", () => {
    const fn = vi.fn();
    b.watch(fn);
    ha.broadcast({ type: "scene:presence", session: "sz", viewer: "zed", seq: 5, at: 0, keys: { x: { v: 2 } } });
    ha.broadcast({ type: "scene:presence", session: "sz", viewer: "zed", seq: 4, at: 0, keys: { x: { v: 1 } } });
    expect(b.get().sz.keys).toEqual({ x: { v: 2 } });
    ha.broadcast({ type: "scene:presence", session: "sz", viewer: "zed", seq: 6, at: 0, keys: { y: { v: 3 } } });
    expect(b.get().sz.keys).toEqual({ y: { v: 3 } }); // whole state: x is gone
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toBe(b.get());
  });

  it("set with an unchanged value sends nothing; undefined deletes", () => {
    a.set("select", "id", ["o1"]);
    clock.advance(1000);
    const n = sent("A", "scene:presence").length;
    a.set("select", "id", ["o1"]);
    clock.advance(400);
    expect(sent("A", "scene:presence").length).toBe(n);
    a.set("select", "id", undefined);
    clock.advance(400);
    expect(sent("A", "scene:presence").length).toBe(n + 1);
    expect(b.get().sa.keys).toEqual({ select: {} });
  });

  it("coalesces changes at the default 4 Hz", () => {
    const before = sent("A", "scene:presence").length;
    for (let i = 0; i < 20; i++) {
      a.set("hover", "id", `o${i}`);
      clock.advance(10);
    }
    // 200 ms: the first change went at once, the rest waited for the 250 ms slot
    expect(sent("A", "scene:presence").length - before).toBe(1);
    clock.advance(50);
    expect(sent("A", "scene:presence").length - before).toBe(2);
    expect(b.get().sa.keys.hover.id).toBe("o19");
  });

  it("goes at the highest rate asked, and forgets a rate on clear", () => {
    a.rate("cursor", 20);
    a.rate("seats", 1);
    const before = sent("A", "scene:presence").length;
    for (let i = 0; i < 20; i++) {
      a.set("cursor", "at", [i, 0]);
      clock.advance(10);
    }
    // 200 ms at 20 Hz (not 1 Hz): at 0, 50, 100, 150 and 200 ms
    expect(sent("A", "scene:presence").length - before).toBe(5);
    a.clear("cursor");
    clock.advance(1000);
    const mid = sent("A", "scene:presence").length;
    for (let i = 0; i < 20; i++) {
      a.set("hover", "id", `o${i}`);
      clock.advance(10);
    }
    expect(sent("A", "scene:presence").length - mid).toBe(1); // back to 4 Hz
  });

  it("sends a heartbeat every 5 s", () => {
    const before = sent("A", "scene:presence").length;
    clock.advance(HEARTBEAT_MS * 3);
    expect(sent("A", "scene:presence").length - before).toBe(3);
  });

  it("a heartbeat that changes nothing doesn't wake watchers", () => {
    const fn = vi.fn();
    b.watch(fn);
    const rec = b.get().sa;
    clock.advance(HEARTBEAT_MS * 2);
    expect(fn).not.toHaveBeenCalled();
    expect(b.get().sa).toBe(rec);
  });

  it("drops a peer not heard from for 15 s", () => {
    ha.broadcast({ type: "scene:presence", session: "sz", viewer: "zed", seq: 1, at: 0, keys: {} });
    expect(b.get().sz).toBeTruthy();
    clock.advance(PEER_TTL_MS - 1);
    expect(b.get().sz).toBeTruthy();
    clock.advance(1);
    expect(b.get().sz).toBeUndefined();
    expect(b.get().sa).toBeTruthy(); // a heartbeats, so stays
  });

  it("drops a peer at once on bye, and ignores it after", () => {
    const fn = vi.fn();
    b.watch(fn);
    a.dispose();
    expect(b.get().sa).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sent("A", "scene:presence").at(-1)).toEqual({ type: "scene:presence", session: "sa", bye: true });
    // a late message from the departed session
    for (const fn2 of hb.listeners) fn2({ message: { type: "scene:presence", session: "sa", viewer: "alice", seq: 999, at: 0, keys: {} } });
    expect(b.get().sa).toBeUndefined();
    expect(ha.listeners.size).toBe(0);
    // and a sends nothing more
    const n = bus.log.length;
    a.set("x", "y", 1);
    clock.advance(HEARTBEAT_MS * 2);
    expect(bus.log.filter((l) => l.from === "A").length).toBe(sent("A", "scene:presence").length);
    expect(bus.log.length - n).toBeGreaterThan(0); // b's heartbeats only
    expect(bus.log.slice(n).every((l) => l.from === "B")).toBe(true);
  });

  it("clear(ext) deletes its keys and sends", () => {
    a.set("select", "id", "o1");
    a.set("hover", "id", "o2");
    clock.advance(1000);
    a.clear("select");
    clock.advance(1000);
    expect(b.get().sa.keys).toEqual({ hover: { id: "o2" } });
    const n = sent("A", "scene:presence").length;
    a.clear("never-set");
    clock.advance(300);
    expect(sent("A", "scene:presence").length).toBe(n);
  });

  it("ignores malformed and own messages", () => {
    const fn = vi.fn();
    b.watch(fn);
    const holds = vi.fn();
    b.watchHolds(holds);
    for (const m of [
      { type: "scene:presence", selected: "o1", hover: null }, // no session
      { type: "scene:presence", session: "sz", seq: "1", keys: {} },
      { type: "scene:presence", session: "sz", seq: 1, keys: "nope" },
      { type: "scene:presence", session: "sb", viewer: "bob", seq: 99, keys: {} }, // b's own session
      { type: "scene:pose", session: "sz", id: "o1", transform: 3, seq: 1 },
      { type: "scene:pose", session: "sz", transform: {}, seq: 1 },
      { type: "scene:pose", session: "sz", id: "o1", transform: { position: [1, 2, 3] }, seq: 1 }, // a hold with no stamp
      { type: "scene:send", session: "sz", ext: "x", data: 1, n: 1 },
      null,
      "hello",
    ])
      ha.broadcast(m);
    expect(fn).not.toHaveBeenCalled();
    expect(holds).not.toHaveBeenCalled();
    expect(Object.keys(b.get())).toEqual(["sa"]);
  });
});

describe("sends", () => {
  it("delivers to the other peer's receivers once, with who sent it", () => {
    const got = vi.fn();
    b.onReceive(got);
    a.send("dice", "roll", { faces: [3, 5] });
    expect(got).toHaveBeenCalledWith("dice", "roll", { faces: [3, 5] }, { session: "sa", viewer: "alice" });
    const msg = sent("A", "scene:send")[0];
    expect(msg).toMatchObject({ type: "scene:send", session: "sa", viewer: "alice", ext: "dice", kind: "roll" });
    // the same message again (a relay echo) is not delivered twice
    ha.broadcast(msg);
    expect(got).toHaveBeenCalledTimes(1);
  });

  it("never replays to a late listener, and the sender doesn't hear itself", () => {
    const own = vi.fn();
    a.onReceive(own);
    a.send("dice", "roll", 1);
    const late = vi.fn();
    b.onReceive(late);
    clock.advance(HEARTBEAT_MS);
    expect(late).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
  });

  it("off stops delivery", () => {
    const got = vi.fn();
    const off = b.onReceive(got);
    off();
    a.send("dice", "roll", 1);
    expect(got).not.toHaveBeenCalled();
  });
});

describe("pose holds", () => {
  const T = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: 1 });

  it("throttles to one pose per 50 ms per object, with a trailing send", () => {
    for (let i = 0; i < 10; i++) {
      a.hold("hand", "o1", "g1", T(i));
      clock.advance(10);
    }
    // 100 ms: at 0, at 50 (carrying the latest by then), then the trailing one at 100
    const poses = sent("A", "scene:pose").filter((m) => m.id === "o1");
    expect(poses.length).toBe(3);
    expect(poses[0].transform).toEqual(T(0));
    expect(poses[1].transform).toEqual(T(4));
    clock.advance(POSE_MS);
    const after = sent("A", "scene:pose");
    expect(after.at(-1).transform).toEqual(T(9)); // the last pose always goes
    expect(b.remoteHolds().get("o1")).toMatchObject({ session: "sa", viewer: "alice", parent: "g1", transform: T(9), landed: null });
  });

  it("throttles each object separately", () => {
    a.hold("hand", "o1", null, T(1));
    a.hold("hand", "o2", null, T(2));
    expect(sent("A", "scene:pose").map((m) => m.id)).toEqual(["o1", "o2"]);
  });

  it("a put-back drops the hold at once", () => {
    const fn = vi.fn();
    b.watchHolds(fn);
    a.hold("hand", "o1", null, T(1));
    expect(b.heldBy("o1")).toBe("sa");
    a.release("hand", "o1");
    expect(sent("A", "scene:pose").at(-1)).toMatchObject({ id: "o1", transform: null });
    expect(sent("A", "scene:pose").at(-1).landed).toBeUndefined();
    expect(b.remoteHolds().has("o1")).toBe(false);
    expect(b.heldBy("o1")).toBe(null);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][1]).toEqual(["o1"]);
  });

  it("a landed release keeps the last pose with landed set, until settled or 3 s", () => {
    a.hold("hand", "o1", null, T(1));
    a.release("hand", "o1", T(2));
    expect(sent("A", "scene:pose").at(-1)).toMatchObject({ id: "o1", transform: null, landed: T(2) });
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
    a.release("gizmo", "o1");
    expect(b.heldBy("o1")).toBe("sa");
  });

  it("a release cancels a pending trailing pose", () => {
    a.hold("hand", "o1", null, T(1));
    clock.advance(10);
    a.hold("hand", "o1", null, T(2)); // waits for its slot
    a.release("hand", "o1");
    clock.advance(1000);
    expect(b.remoteHolds().has("o1")).toBe(false);
    expect(sent("A", "scene:pose").map((m) => m.transform)).toEqual([T(1), null]);
  });

  it("drops a hold not refreshed for 3 s (the holder went silent)", () => {
    // forged peer that never refreshes
    ha.broadcast({ type: "scene:pose", session: "sz", viewer: "zed", id: "o1", parent: null, transform: T(1), since: 1, seq: 1 });
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
    ha.broadcast({ type: "scene:pose", session: "sz", viewer: "zed", id: "o1", parent: null, transform: T(9), since: 50, seq: 1 });
    expect(b.heldBy("o1")).toBe("sa");
    expect(b.remoteHolds().get("o1").transform).toEqual(T(1));
    a.release("hand", "o1");
    expect(b.heldBy("o1")).toBe("sz"); // the other hold was kept underneath
    expect(b.remoteHolds().get("o1").transform).toEqual(T(9));
  });

  it("every view ranks two holds alike, whatever order it heard them in (the holder's stamp)", () => {
    const pose = (session, since) => ({ type: "scene:pose", session, viewer: session, id: "o9", parent: null, transform: T(1), since, seq: 1 });
    // b hears the later grab first
    hb.inject(pose("late", 2_000));
    hb.inject(pose("early", 1_500));
    expect(b.heldBy("o9")).toBe("early");
    expect(b.remoteHolds().get("o9").session).toBe("early");
  });

  it("concurrent holds (neither holder had heard of the other) fall to the session id, on every view", () => {
    const pose = (session, since) => ({ type: "scene:pose", session, viewer: session, id: "o8", parent: null, transform: T(1), since, seq: 1 });
    hb.inject(pose("s2", 1));
    hb.inject(pose("s1", 1));
    expect(b.heldBy("o8")).toBe("s1");
  });

  it("a hold begun after hearing of another ranks after it, whatever the clocks say", () => {
    a.hold("hand", "o1", null, T(1));
    // b's clock is far behind a's: stamps, not times, decide
    b.hold("hand", "o1", null, T(2));
    expect(b.heldBy("o1")).toBe("sa");
    expect(sent("B", "scene:pose")[0].since).toBeGreaterThan(sent("A", "scene:pose")[0].since);
  });

  it("while this view holds it too, only a peer that took it first counts", () => {
    a.hold("hand", "o1", null, T(1));
    clock.advance(100);
    b.hold("hand", "o1", null, T(2)); // b grabbed it a moment later
    expect(a.heldBy("o1")).toBe(null); // a was first: it's a's
    expect(b.heldBy("o1")).toBe("sa"); // b should let go
    expect(sent("A", "scene:pose")[0].since).toBeLessThan(sent("B", "scene:pose")[0].since);
  });

  it("goodbye (pagehide) puts holds back and leaves at once; hello comes back as a new session", () => {
    a.hold("hand", "o1", null, T(1));
    a.goodbye();
    expect(b.heldBy("o1")).toBe(null);
    expect(Object.keys(b.get())).toEqual([]);
    a.set("ext", "k", 1);
    clock.advance(HEARTBEAT_MS * 2);
    expect(Object.keys(b.get())).toEqual([]); // quiet while away
    a.hello();
    expect(a.session).not.toBe("sa");
    expect(Object.keys(b.get())).toEqual([a.session]);
    expect(b.get()[a.session].keys).toEqual({ ext: { k: 1 } });
  });

  it("ignores a pose that arrives after a later release", () => {
    a.hold("hand", "o1", null, T(1));
    const first = sent("A", "scene:pose")[0];
    a.release("hand", "o1");
    ha.broadcast(first); // replayed late
    expect(b.heldBy("o1")).toBe(null);
  });

  it("clearing an extension puts its holds back", () => {
    a.hold("hand", "o1", null, T(1));
    a.hold("gizmo", "o2", null, T(1));
    a.clear("hand");
    expect(b.heldBy("o1")).toBe(null);
    expect(b.heldBy("o2")).toBe("sa");
  });

  it("a bye ends the departed peer's holds", () => {
    a.hold("hand", "o1", null, T(1));
    a.dispose();
    expect(b.remoteHolds().size).toBe(0);
  });

  it("remoteHolds is a stable value between changes", () => {
    a.hold("hand", "o1", null, T(1));
    const m = b.remoteHolds();
    expect(b.remoteHolds()).toBe(m);
    clock.advance(POSE_MS);
    a.hold("hand", "o1", null, T(2));
    expect(b.remoteHolds()).not.toBe(m);
  });
});

describe("without a usable handle", () => {
  it("works locally when the handle has no broadcast or on", () => {
    const p = createPresence({ handle: {}, viewer: null });
    p.set("x", "y", 1);
    p.hold("x", "o1", null, { position: [0, 0, 0] });
    expect(p.get()).toEqual({});
    p.dispose();
    p.dispose();
  });
  it("survives a broadcast that throws", () => {
    const p = createPresence({
      handle: {
        broadcast() {
          throw new Error("offline");
        },
      },
      viewer: "v",
    });
    expect(() => p.send("x", "y", 1)).not.toThrow();
    p.dispose();
  });
});
