import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPresence,
  effectiveHz,
  cleanKeys,
  same,
  HEARTBEAT_MS,
  PEER_TTL_MS,
} from "./presence.js";

// the stage's time is presence's (now, setTimer, clearTimer): here, the page's
const pageTime = { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t) };

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
    for (const m of [
      { type: "scene:presence", selected: "o1", hover: null }, // no session
      { type: "scene:presence", session: "sz", seq: "1", keys: {} },
      { type: "scene:presence", session: "sz", seq: 1, keys: "nope" },
      { type: "scene:presence", session: "sb", viewer: "bob", seq: 99, keys: {} }, // b's own session
      { type: "scene:send", session: "sz", ext: "x", data: 1, n: 1 },
      null,
      "hello",
    ])
      ha.broadcast(m);
    expect(fn).not.toHaveBeenCalled();
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

describe("without a usable handle", () => {
  it("works locally when the handle has no broadcast or on", () => {
    const p = createPresence({ handle: {}, viewer: null, ...pageTime });
    p.set("x", "y", 1);
    expect(p.get()).toEqual({});
    p.dispose();
    p.dispose();
  });
  it("survives a broadcast that throws", () => {
    const p = createPresence({
      ...pageTime,
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

// A presence that only listens (a read-only stage's: STAGE.md, "Views, stages and links"): over
// every call that would speak and over time, it says nothing; it hears the
// channel, never its own session.
describe("listening only", () => {
  const SPEAKS = {
    hello: (p) => p,
    set: (p) => p.set("x", "k", 1),
    rate: (p) => p.rate("x", 60),
    clear: (p) => p.clear("x"),
    send: (p) => p.send("x", "kind", { n: 1 }),
    goodbye: (p) => p.goodbye(),
    back: (p) => (p.goodbye(), p.hello("s-new")),
    dispose: (p) => p.dispose(),
  };
  for (const [what, act] of Object.entries(SPEAKS)) {
    it(`${what}: nothing goes out, now or after a minute`, () => {
      const hl = bus.makeHandle("L");
      const l = createPresence({ handle: hl, viewer: "alice", session: "sa", listen: true, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
      act(l);
      clock.advance(60_000);
      expect(bus.log.filter((x) => x.from === "L")).toEqual([]);
      l.dispose();
    });
  }

  it("hears the channel: presence and sends; never its own session", () => {
    const hl = bus.makeHandle("L");
    const l = createPresence({ handle: hl, viewer: "alice", session: "sl", listen: true, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const self = createPresence({ handle: bus.makeHandle("M"), viewer: "alice", session: "sa", listen: true, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const got = [];
    l.onReceive((ext, kind, data, from) => got.push([ext, kind, from.session]));
    a.set("x", "k", 2);
    a.send("x", "kind", null);
    b.send("x", "kind", null);
    clock.advance(HEARTBEAT_MS); // (b says nothing new until its heartbeat)
    expect(l.get().sa?.keys?.x?.k).toBe(2);
    expect(Object.keys(l.get()).sort()).toEqual(["sa", "sb"]);
    expect(got).toEqual([["x", "kind", "sa"], ["x", "kind", "sb"]]);
    // a listener of the speaker's own session hears none of it, and nor does the speaker
    expect(self.get().sa).toBeUndefined();
    expect(a.get().sa).toBeUndefined();
    self.dispose();
    l.dispose();
  });
});

// What the view says of the viewer (STAGE.md, "Views, stages and links"): its body and its
// hands, top last, beside `viewer`, on every channel it acts on; cleaned on
// the way in; a listening presence says none of it.
describe("the view's body and hands", () => {
  it("go out with the state, cleaned, and only when they change; a listener says nothing", () => {
    a.announce({ body: { id: "seat", label: "Player 1", extra: 1 }, held: [{ name: "Edit" }, { name: "Measure", ext: "x" }] });
    clock.advance(1000);
    expect(b.get().sa).toMatchObject({ viewer: "alice", body: { id: "seat", label: "Player 1" }, held: [{ name: "Edit" }, { name: "Measure" }] });
    expect(Object.keys(b.get().sa.body)).toEqual(["id", "label"]);
    expect(Object.keys(b.get().sa.held[1])).toEqual(["name"]);
    const before = sent("A", "scene:presence").length;
    a.announce({ body: { id: "seat", label: "Player 1" }, held: [{ name: "Edit" }, { name: "Measure" }] });
    clock.advance(100);
    expect(sent("A", "scene:presence").length).toBe(before);
    // the order is what's said: the same hands the other way up are a change
    a.announce({ body: { id: "seat", label: "Player 1" }, held: [{ name: "Measure" }, { name: "Edit" }] });
    clock.advance(1000);
    expect(b.get().sa.held).toEqual([{ name: "Measure" }, { name: "Edit" }]);
    a.announce({ body: { id: "look", label: "Look" }, held: [] });
    clock.advance(1000);
    expect(b.get().sa).toMatchObject({ body: { id: "look", label: "Look" }, held: [] });
    // what isn't a body is nothing; what isn't a hand is left out, and what isn't a list holds nothing
    for (const [body, held, want] of [[{ id: 3, label: "x" }, [{ name: 4 }, { name: "Gun" }], [{ name: "Gun" }]], ["seat", { name: "Measure" }, []], [null, undefined, []], [null, "Measure", []]]) {
      a.announce({ body, held });
      clock.advance(1000);
      expect([b.get().sa.body, b.get().sa.held]).toEqual([null, want]);
    }
    const hc = bus.makeHandle("C");
    const quiet = createPresence({ handle: hc, viewer: "cara", session: "sc", listen: true, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    quiet.announce({ body: { id: "walk", label: "Walk" }, held: [] });
    clock.advance(HEARTBEAT_MS * 2);
    expect(sent("C", "scene:presence")).toEqual([]);
    expect("sc" in b.get()).toBe(false);
  });
});
