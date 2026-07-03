import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountDelay, plugin, clampMs, DEFAULT_MS } from "../src/delay-node.js";

describe("clampMs", () => {
  it("floors and rejects negatives / non-numbers → default", () => {
    expect(clampMs(120)).toBe(120);
    expect(clampMs(50.9)).toBe(50);
    expect(clampMs(-5)).toBe(DEFAULT_MS);
    expect(clampMs("abc")).toBe(DEFAULT_MS);
    expect(clampMs(0)).toBe(0);
  });
});

describe("delay plugin descriptor", () => {
  it("is a sketchy:window with in→out and load() → mountDelay", async () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("delay");
    expect(plugin.inlets.map((i) => i.name)).toEqual(["in"]);
    expect(plugin.outlets.map((o) => o.name)).toEqual(["out"]);
    expect(await plugin.load()).toBe(mountDelay);
  });
});

describe("mountDelay", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // a controllable fake opstream
  function fakeStream(initial) {
    let v = initial, cb = null;
    return { get value() { return v; }, connect(c) { cb = c; c({ type: "snapshot", value: v }); return () => { cb = null; }; }, set(nv) { v = nv; if (cb) cb({ type: "snapshot", value: nv }); } };
  }

  it("re-emits a changed value after the delay, not before", () => {
    const src = fakeStream(0);
    const outs = [];
    const el = document.createElement("div");
    mountDelay({ element: el, inlets: { in: src }, setOutlet: (n, s) => s.connect((op) => outs.push(op.value)), config: { ms: 100 } });
    outs.length = 0; // drop the out's own initial snapshot
    src.set(7);
    expect(outs).toEqual([]);       // nothing yet
    vi.advanceTimersByTime(99);
    expect(outs).toEqual([]);       // still waiting
    vi.advanceTimersByTime(1);
    expect(outs).toEqual([7]);      // delivered at 100ms
  });

  it("does not emit on mount (skips the initial snapshot)", () => {
    const src = fakeStream(42);
    const outs = [];
    mountDelay({ element: document.createElement("div"), inlets: { in: src }, setOutlet: (n, s) => s.connect((op) => outs.push(op.value)), config: { ms: 50 } });
    outs.length = 0;
    vi.advanceTimersByTime(1000);
    expect(outs).toEqual([]);       // mount value was not scheduled
  });

  it("schedules each change independently", () => {
    const src = fakeStream(0);
    const outs = [];
    mountDelay({ element: document.createElement("div"), inlets: { in: src }, setOutlet: (n, s) => s.connect((op) => outs.push(op.value)), config: { ms: 100 } });
    outs.length = 0;
    src.set("a"); vi.advanceTimersByTime(40);
    src.set("b");
    vi.advanceTimersByTime(60); // a fires (100ms total)
    expect(outs).toEqual(["a"]);
    vi.advanceTimersByTime(40); // b fires
    expect(outs).toEqual(["a", "b"]);
  });

  it("clears pending timers on cleanup", () => {
    const src = fakeStream(0);
    const outs = [];
    const cleanup = mountDelay({ element: document.createElement("div"), inlets: { in: src }, setOutlet: (n, s) => s.connect((op) => outs.push(op.value)), config: { ms: 100 } });
    outs.length = 0;
    src.set(1);
    cleanup();
    vi.advanceTimersByTime(1000);
    expect(outs).toEqual([]);       // the pending emit was cancelled
  });
});
