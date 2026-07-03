import { describe, it, expect, afterEach } from "vitest";
import { mountRawValue, mountBang, mountTimer, mountAutomergeSource, makeSourceMount, playSharedStream } from "../src/source-nodes.js";

// a fake setOutlet that captures the Source registered per outlet name
function makeOutlets() {
  const outlets = {};
  const setOutlet = (name, stream) => { outlets[name] = stream; };
  return { outlets, setOutlet };
}

// a fake setConfig that records every config object pushed (last is current)
function makeConfig() {
  const calls = [];
  const setConfig = (c) => { calls.push(c); };
  return { calls, setConfig, last: () => calls[calls.length - 1] };
}

describe("mountRawValue", () => {
  it("emits the initial coerced value on the value outlet and renders status", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const { setConfig, last } = makeConfig();
    const cleanup = mountRawValue({ element, setOutlet, config: {}, setConfig });

    // a value Source is registered up front
    expect(outlets.value).toBeDefined();
    // update() runs once on mount, persisting raw (empty) and the live select kind
    const sel = element.querySelector("select");
    expect(last()).toEqual({ raw: "", kind: sel.value });
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toBe(`${sel.value}: ${JSON.stringify(outlets.value.value)}`);
    cleanup();
  });

  it("restores a persisted text literal from config", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: { raw: "hi", kind: "text" } });
    // the persisted raw is restored into the input
    const input = element.querySelector("input");
    expect(input.value).toBe("hi");
    // and re-emitting as text yields the literal back
    const sel = element.querySelector("select");
    sel.value = "text";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe("hi");
    cleanup();
  });

  it("coerces a number literal and pushes it on input", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const { last } = makeConfig();
    const { setConfig } = makeConfig();
    const cleanup = mountRawValue({ element, setOutlet, config: { kind: "number", raw: "41" }, setConfig });
    const sel = element.querySelector("select");
    const input = element.querySelector("input");
    sel.value = "number";

    input.value = "41";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(41);

    input.value = "42";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(42);

    // a non-numeric literal coerces to 0
    input.value = "nope";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(0);
    cleanup();
  });

  it("coerces a boolean literal: only 'true' is true", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: { kind: "boolean", raw: "true" } });
    // the live type comes from the <select>; drive it explicitly so coercion is boolean
    const sel = element.querySelector("select");
    const input = element.querySelector("input");
    sel.value = "boolean";

    input.value = "true";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(true);

    input.value = "false";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(false);

    input.value = "anything";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(false);
    cleanup();
  });

  it("coerces a json literal, and yields null on bad json", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: { kind: "json", raw: '{"a":1}' } });
    const sel = element.querySelector("select");
    const input = element.querySelector("input");
    sel.value = "json";

    input.value = '{"a":1}';
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toEqual({ a: 1 });

    input.value = "not json";
    input.dispatchEvent(new Event("input"));
    expect(outlets.value.value).toBe(null);
    cleanup();
  });

  it("is BIDI: writing back through the outlet (apply) updates the value, the input, and config", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const { setConfig, last } = makeConfig();
    const cleanup = mountRawValue({ element, setOutlet, config: { raw: "hi", kind: "text" }, setConfig });
    const input = element.querySelector("input");
    // the outlet is writable (this is what renders the wire as bidi)
    expect(typeof outlets.value.apply).toBe("function");

    // a downstream write-back (a snapshot op) flows in
    outlets.value.apply({ type: "snapshot", value: "edited" });
    expect(outlets.value.value).toBe("edited");
    expect(input.value).toBe("edited");          // reflected into the UI
    expect(last()).toEqual({ raw: "edited", kind: "text" }); // persisted

    // idempotent: re-applying the SAME value does not re-emit / re-persist
    const before = last();
    outlets.value.apply({ type: "snapshot", value: "edited" });
    expect(last()).toBe(before);
    cleanup();
  });

  it("write-back coerces the raw text per the current kind (number)", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: { raw: "1", kind: "number" } });
    const input = element.querySelector("input");
    outlets.value.apply({ type: "snapshot", value: 42 });
    expect(outlets.value.value).toBe(42);
    expect(input.value).toBe("42"); // number → raw text for the input
    cleanup();
  });

  it("persists raw+kind via setConfig when the type select changes", () => {
    const element = document.createElement("div");
    const { setOutlet } = makeOutlets();
    const { setConfig, last } = makeConfig();
    const cleanup = mountRawValue({ element, setOutlet, config: { raw: "10", kind: "text" }, setConfig });

    const sel = element.querySelector("select");
    sel.value = "number";
    sel.dispatchEvent(new Event("change"));
    expect(last()).toEqual({ raw: "10", kind: "number" });
    cleanup();
  });

  it("notifies a connected subscriber when the value changes", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: { raw: "a", kind: "text" } });
    const input = element.querySelector("input");
    const sel = element.querySelector("select");
    sel.value = "text";
    input.value = "a";
    input.dispatchEvent(new Event("input"));

    const seen = [];
    const off = outlets.value.connect((op) => seen.push(op.value));
    // connect delivers the current value synchronously
    expect(seen).toEqual(["a"]);

    input.value = "b";
    input.dispatchEvent(new Event("input"));
    expect(seen).toEqual(["a", "b"]);
    off();
    cleanup();
  });

  it("cleanup removes the root element", () => {
    const element = document.createElement("div");
    const { setOutlet } = makeOutlets();
    const cleanup = mountRawValue({ element, setOutlet, config: {} });
    expect(element.querySelector(".ns-rawvalue")).toBeTruthy();
    cleanup();
    expect(element.querySelector(".ns-rawvalue")).toBeNull();
  });
});

describe("mountBang", () => {
  it("registers a bang outlet seeded with 0", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountBang({ element, setOutlet });
    expect(outlets.bang).toBeDefined();
    expect(outlets.bang.value).toBe(0);
    cleanup();
  });

  it("emits a UNIQUE, incrementing value on every button push", () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountBang({ element, setOutlet });

    const seen = [];
    outlets.bang.connect((op) => seen.push(op.value));

    const btn = element.querySelector("button");
    btn.click();
    btn.click();
    btn.click();
    // connect delivers 0 first, then each click pushes the next counter value
    expect(seen).toEqual([0, 1, 2, 3]);
    // each fire is distinct so it always propagates
    expect(new Set(seen).size).toBe(seen.length);
    cleanup();
  });

  it("cleanup removes the root element", () => {
    const element = document.createElement("div");
    const { setOutlet } = makeOutlets();
    const cleanup = mountBang({ element, setOutlet });
    expect(element.querySelector(".ns-bang")).toBeTruthy();
    cleanup();
    expect(element.querySelector(".ns-bang")).toBeNull();
  });
});

describe("mountTimer", () => {
  it("emits incrementing bangs on the configured interval, then stops on cleanup", async () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 16 } });

    expect(outlets.bang).toBeDefined();
    const seen = [];
    outlets.bang.connect((op) => seen.push(op.value));
    // connect delivers the seed 0 immediately, before any tick
    expect(seen).toEqual([0]);

    // wait for a few interval ticks
    await new Promise((r) => setTimeout(r, 80));
    cleanup();
    const afterStop = seen.length;
    expect(afterStop).toBeGreaterThan(1);
    // values are 0,1,2,... strictly increasing
    expect(seen).toEqual(seen.map((_, i) => i));

    // after cleanup no further ticks land
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.length).toBe(afterStop);
  });

  it("does not auto-start when config.running is false", async () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 16, running: false } });

    const seen = [];
    outlets.bang.connect((op) => seen.push(op.value));
    await new Promise((r) => setTimeout(r, 80));
    // only the connect seed, never a tick
    expect(seen).toEqual([0]);
    cleanup();
  });

  it("run button toggles the interval on and off", async () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 16, running: false } });
    const run = element.querySelector(".ns-source-enable");

    const seen = [];
    outlets.bang.connect((op) => seen.push(op.value));

    run.click(); // start
    expect(run.textContent).toBe("⏸ stop");
    await new Promise((r) => setTimeout(r, 80));
    const whileRunning = seen.length;
    expect(whileRunning).toBeGreaterThan(1);

    run.click(); // stop
    expect(run.textContent).toBe("▶ run");
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.length).toBe(whileRunning);
    cleanup();
  });

  it("persists run/pause via setConfig — a paused timer must stay paused across reload", () => {
    const element = document.createElement("div");
    const { setOutlet } = makeOutlets();
    const { setConfig, last } = makeConfig();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 16, running: false }, setConfig });
    const run = element.querySelector(".ns-source-enable");

    run.click(); // start
    expect(last()).toEqual({ running: true });
    run.click(); // pause
    expect(last()).toEqual({ running: false });
    cleanup();
  });

  it("persists the interval via setConfig when the ms input changes, clamping to >=16", () => {
    const element = document.createElement("div");
    const { setOutlet } = makeOutlets();
    const { setConfig, last } = makeConfig();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 500, running: false }, setConfig });

    const input = element.querySelector("input");
    input.value = "5"; // below the floor
    input.dispatchEvent(new Event("change"));
    expect(last()).toEqual({ ms: 16 });

    input.value = "250";
    input.dispatchEvent(new Event("change"));
    expect(last()).toEqual({ ms: 250 });
    cleanup();
  });

  it("cleanup removes the root and clears the interval", async () => {
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mountTimer({ element, setOutlet, config: { ms: 16 } });
    const seen = [];
    outlets.bang.connect((op) => seen.push(op.value));
    expect(element.querySelector(".ns-timer")).toBeTruthy();
    cleanup();
    expect(element.querySelector(".ns-timer")).toBeNull();
    const n = seen.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.length).toBe(n);
  });
});

describe("makeSourceMount (non-gated, synchronous fake start)", () => {
  it("starts immediately, registers the stream on the outlet, and shows a preview readout", () => {
    let stopped = false;
    const stream = {
      _v: 7,
      get value() { return this._v; },
      connect(cb) { cb({ type: "snapshot", value: this._v }); return () => {}; },
      apply() {},
    };
    const start = () => ({ stream, stop: () => { stopped = true; } });
    const mount = makeSourceMount({ start, outlet: "out", label: "Fake" });

    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mount({ element, setOutlet });

    // a published `out` Source mirrors the device value (it's always registered up
    // front so the outlet is wireable before the device starts / when shared).
    expect(outlets.out).toBeTruthy();
    expect(outlets.out.value).toBe(7);
    const status = element.querySelector(".ns-source-status");
    expect(status.textContent).toBe("Fake ▸ 7");

    cleanup();
    expect(stopped).toBe(true);
    expect(element.querySelector(".ns-source")).toBeNull();
  });

  it("reports unavailable when start() returns nothing", () => {
    const mount = makeSourceMount({ start: () => null, outlet: "out", label: "Dev" });
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mount({ element, setOutlet });
    expect(outlets.out).toBeTruthy(); // outlet always present (a mirror Source)
    expect(element.querySelector(".ns-source-status").textContent).toBe("Dev: unavailable");
    cleanup();
  });

  it("catches a throwing start() and surfaces the error in status", () => {
    const mount = makeSourceMount({ start: () => { throw new Error("boom"); }, outlet: "out", label: "Dev" });
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mount({ element, setOutlet });
    expect(outlets.out).toBeTruthy();
    expect(element.querySelector(".ns-source-status").textContent).toBe("Dev: boom");
    cleanup();
  });

  it("gated mode registers a proxy up front and forwards on enable", () => {
    let started = false;
    const stream = {
      _v: 3,
      get value() { return this._v; },
      connect(cb) { cb({ type: "snapshot", value: this._v }); return () => {}; },
      apply() {},
    };
    const start = () => { started = true; return { stream, stop() {} }; };
    const mount = makeSourceMount({ start, outlet: "geo", label: "Geo", gated: true });

    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const cleanup = mount({ element, setOutlet });

    // a proxy is registered before enabling, and start() has NOT run yet
    expect(outlets.geo).toBeDefined();
    expect(started).toBe(false);
    const proxy = outlets.geo;
    expect(proxy.value).toBe(null);

    const seen = [];
    proxy.connect((op) => seen.push(op.value));

    element.querySelector(".ns-source-enable").click();
    expect(started).toBe(true);
    // the device value gets forwarded into the proxy
    expect(proxy.value).toBe(3);
    expect(seen[seen.length - 1]).toBe(3);
    cleanup();
  });
});

describe("mountAutomergeSource — the in-flight open() token", () => {
  afterEach(() => { delete window.repo; });

  const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
  // enough handle for automergeOpstream: doc()/on/off/url (listener counts observable)
  const fakeHandle = (url) => ({ url, ons: 0, offs: 0, doc: () => ({}), on() { this.ons++; }, off() { this.offs++; }, change() {} });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("a slow url resolving AFTER a newer one neither replaces the stream nor re-persists its stale url", async () => {
    const defs = { "automerge:A": deferred(), "automerge:B": deferred() };
    window.repo = { find: (url) => defs[url].promise };
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    const { calls, setConfig, last } = makeConfig();
    let onCfg;
    const cleanup = mountAutomergeSource({ element, setOutlet, setConfig, config: {}, onConfig: (cb) => (onCfg = cb) });

    const a = fakeHandle("automerge:A"), b = fakeHandle("automerge:B");
    onCfg({ url: "automerge:A" }); // slow
    onCfg({ url: "automerge:B" }); // newer — must win
    defs["automerge:B"].resolve(b);
    await flush();
    expect(outlets.doc.complement.handle).toBe(b);
    expect(last()).toEqual({ url: "automerge:B" });

    const persisted = calls.length;
    defs["automerge:A"].resolve(a); // the STALE resolve lands late
    await flush();
    expect(outlets.doc.complement.handle).toBe(b); // stream not replaced
    expect(calls.length).toBe(persisted);          // stale url never persisted back
    expect(a.offs).toBe(a.ons);                    // the stale stream was fully dropped
    cleanup();
    expect(b.offs).toBe(b.ons); // teardown releases the winner's listener too
  });

  it("a stale rejection does not clobber the newer stream's status", async () => {
    const defs = { "automerge:A": deferred(), "automerge:B": deferred() };
    window.repo = { find: (url) => defs[url].promise };
    const element = document.createElement("div");
    const { outlets, setOutlet } = makeOutlets();
    let onCfg;
    const cleanup = mountAutomergeSource({ element, setOutlet, setConfig() {}, config: {}, onConfig: (cb) => (onCfg = cb) });

    onCfg({ url: "automerge:A" });
    onCfg({ url: "automerge:B" });
    defs["automerge:B"].resolve(fakeHandle("automerge:B"));
    await flush();
    const status = element.querySelector(".ns-source-status").textContent;
    defs["automerge:A"].reject(new Error("gone"));
    await flush();
    expect(element.querySelector(".ns-source-status").textContent).toBe(status); // untouched
    cleanup();
  });
});

describe("playSharedStream — the one shared-audio receiver (mic + audio-file)", () => {
  it("appends a playing <audio> to the root and stop() removes it", () => {
    const root = document.createElement("div");
    const out = { complement: {} };
    const stop = playSharedStream({ id: "remote" }, { root, out });
    expect(root.querySelector("audio")).toBeTruthy();
    stop();
    expect(root.querySelector("audio")).toBeFalsy();
    expect(() => stop()).not.toThrow(); // idempotent
  });
});
