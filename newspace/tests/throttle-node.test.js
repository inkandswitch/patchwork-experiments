import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountThrottle, makeThrottle, plugin, clampMs, preview, DEFAULT_MS } from "../src/throttle-node.js";

describe("clampMs", () => {
  it("floors, allows 0, rejects negatives / non-numbers → default", () => {
    expect(clampMs(200)).toBe(200);
    expect(clampMs(99.9)).toBe(99);
    expect(clampMs(0)).toBe(0);
    expect(clampMs(-5)).toBe(DEFAULT_MS);
    expect(clampMs("abc")).toBe(DEFAULT_MS);
    expect(clampMs(undefined)).toBe(DEFAULT_MS);
  });
});

describe("preview", () => {
  it("renders values compactly", () => {
    expect(preview(undefined)).toBe("∅");
    expect(preview(7)).toBe("7");
    expect(preview("hi")).toBe("hi");
    expect(preview({ a: 1 })).toBe('{"a":1}');
    expect(preview("x".repeat(40)).endsWith("…")).toBe(true);
  });
});

describe("makeThrottle (pure, injected clock + scheduler)", () => {
  // a deterministic fake clock + scheduler
  function harness(ms) {
    let t = 0;
    let nextId = 1;
    const timers = new Map(); // id -> { at, fn }
    const emits = [];
    const now = () => t;
    const schedule = (fn, after) => { const id = nextId++; timers.set(id, { at: t + after, fn }); return id; };
    const cancel = (id) => { timers.delete(id); };
    const advance = (dt) => {
      const target = t + dt;
      // fire timers in time order up to target
      let safety = 1000;
      while (safety-- > 0) {
        let soonest = null;
        for (const [id, e] of timers) if (e.at <= target && (soonest == null || e.at < timers.get(soonest).at)) soonest = id;
        if (soonest == null) break;
        const e = timers.get(soonest);
        timers.delete(soonest);
        t = e.at;
        e.fn();
      }
      t = target;
    };
    const th = makeThrottle(() => ms, (v) => emits.push(v), { now, schedule, cancel });
    return { th, emits, advance, timersSize: () => timers.size };
  }

  it("LEADING edge: first value fires immediately", () => {
    const h = harness(100);
    h.th.push("a");
    expect(h.emits).toEqual(["a"]);
  });

  it("suppresses during the window and fires the LAST one on the TRAILING edge", () => {
    const h = harness(100);
    h.th.push("a");          // leading at t=0
    expect(h.emits).toEqual(["a"]);
    h.advance(30); h.th.push("b"); // suppressed
    h.advance(30); h.th.push("c"); // suppressed, replaces b
    expect(h.emits).toEqual(["a"]); // still only leading
    h.advance(40);           // t=100, window closes → trailing fires "c"
    expect(h.emits).toEqual(["a", "c"]);
  });

  it("a value after the window passes as a fresh leading edge", () => {
    const h = harness(100);
    h.th.push("a");          // leading t=0
    h.advance(150);          // well past window, no pending
    h.th.push("b");          // fresh leading
    expect(h.emits).toEqual(["a", "b"]);
  });

  it("0ms window passes everything immediately", () => {
    const h = harness(0);
    h.th.push(1); h.th.push(2); h.th.push(3);
    expect(h.emits).toEqual([1, 2, 3]);
  });

  it("cancel() clears the pending trailing timer", () => {
    const h = harness(100);
    h.th.push("a");
    h.th.push("b");          // suppressed → arms a timer
    expect(h.timersSize()).toBe(1);
    h.th.cancel();
    expect(h.timersSize()).toBe(0);
    h.advance(1000);
    expect(h.emits).toEqual(["a"]); // trailing never fired
  });
});

describe("throttle plugin descriptor", () => {
  it("is a sketchy:surface with in:json → out:json and load() → mountThrottle", async () => {
    expect(plugin.type).toBe("sketchy:surface");
    expect(plugin.id).toBe("throttle");
    expect(plugin.name).toBe("Throttle");
    expect(plugin.icon).toBe("Gauge");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["in"]);
    expect(plugin.inlets[0].type).toBe("json");
    expect(plugin.outlets.map((o) => o.name)).toEqual(["out"]);
    expect(plugin.outlets[0].type).toBe("json");
    expect(await plugin.load()).toBe(mountThrottle);
  });
});

describe("mountThrottle (DOM + fake opstream + fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // a controllable fake opstream: connect sends a snapshot immediately, set() pushes more
  function fakeStream(initial) {
    let v = initial, cb = null;
    return {
      get value() { return v; },
      connect(c) { cb = c; c({ type: "snapshot", value: v }); return () => { cb = null; }; },
      apply(_op) {},
      set(nv) { v = nv; if (cb) cb({ type: "snapshot", value: nv }); },
    };
  }

  function mount(initial, configMs) {
    const src = fakeStream(initial);
    const outs = [];
    const el = document.createElement("div");
    const cleanup = mountThrottle({
      element: el,
      inlets: { in: src },
      setOutlet: (n, s) => s.connect((op) => outs.push(op.value)),
      config: { ms: configMs },
      setConfig: () => {},
    });
    outs.length = 0; // drop the out's own initial snapshot
    return { src, outs, el, cleanup };
  }

  it("does NOT emit on mount (skips the initial connect snapshot)", () => {
    const { outs } = mount(42, 100);
    vi.advanceTimersByTime(1000);
    expect(outs).toEqual([]);
  });

  it("LEADING edge: first change fires immediately", () => {
    const { src, outs } = mount(0, 100);
    src.set(7);
    expect(outs).toEqual([7]);
  });

  it("TRAILING edge: suppressed value fires at the end of the window", () => {
    const { src, outs } = mount(0, 100);
    src.set("a");              // leading
    expect(outs).toEqual(["a"]);
    vi.advanceTimersByTime(30); src.set("b"); // suppressed
    vi.advanceTimersByTime(30); src.set("c"); // suppressed, replaces b
    expect(outs).toEqual(["a"]);
    vi.advanceTimersByTime(40); // t=100 → trailing "c"
    expect(outs).toEqual(["a", "c"]);
  });

  it("renders an ms input seeded from config", () => {
    const { el } = mount(0, 250);
    const input = el.querySelector("input");
    expect(input).toBeTruthy();
    expect(input.value).toBe("250");
  });

  it("cleanup clears pending timers", () => {
    const { src, outs, cleanup } = mount(0, 100);
    src.set("a");              // leading fires
    src.set("b");              // suppressed → timer armed
    expect(outs).toEqual(["a"]);
    cleanup();
    vi.advanceTimersByTime(1000);
    expect(outs).toEqual(["a"]); // trailing cancelled
  });
});
