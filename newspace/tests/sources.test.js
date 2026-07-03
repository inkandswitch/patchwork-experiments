import { describe, it, expect, vi } from "vitest";
import { snapshotPad, snapshotPosition, snapshotMidi, snapshotMediaStream, clockSource } from "../src/sources.js";

describe("snapshotPad", () => {
  it("flattens a Gamepad into a plain value", () => {
    const pad = { id: "Pad", index: 0, connected: true, axes: [0, 0.5], buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }] };
    expect(snapshotPad(pad)).toEqual({
      id: "Pad", index: 0, connected: true,
      axes: [0, 0.5],
      buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }],
    });
  });
  it("null for no pad", () => expect(snapshotPad(null)).toBe(null));
});

describe("snapshotPosition", () => {
  it("flattens a GeolocationPosition", () => {
    const p = { coords: { latitude: 1, longitude: 2, accuracy: 3, altitude: null, heading: null, speed: null }, timestamp: 999 };
    expect(snapshotPosition(p)).toMatchObject({ lat: 1, lng: 2, accuracy: 3, timestamp: 999 });
  });
  it("null for no position", () => expect(snapshotPosition(null)).toBe(null));
});

describe("snapshotMidi", () => {
  it("decodes a MIDI message (command/channel from status byte)", () => {
    // 0x90 = note-on, channel 0; note 60, velocity 100
    const e = { data: [0x90, 60, 100], target: { name: "Keystation" }, timeStamp: 12 };
    expect(snapshotMidi(e)).toEqual({ status: 0x90, data1: 60, data2: 100, command: 9, channel: 0, port: "Keystation", time: 12 });
  });
});

describe("snapshotMediaStream", () => {
  it("summarises track metadata", () => {
    const ms = { id: "ms1", active: true, getTracks: () => [{ kind: "video", label: "cam", enabled: true, muted: false }] };
    expect(snapshotMediaStream(ms)).toEqual({ id: "ms1", active: true, tracks: [{ kind: "video", label: "cam", enabled: true, muted: false }] });
  });
  it("null for no stream", () => expect(snapshotMediaStream(null)).toBe(null));
});

describe("clockSource", () => {
  it("pushes the time on each tick and stops cleanly", () => {
    vi.useFakeTimers();
    const { stream, stop } = clockSource({ intervalMs: 100 });
    const seen = [];
    stream.connect(() => seen.push(stream.value));
    expect(typeof stream.value).toBe("number");
    vi.advanceTimersByTime(250); // ~2 ticks
    expect(seen.length).toBeGreaterThanOrEqual(3); // initial snapshot + 2 ticks
    stop();
    const n = seen.length;
    vi.advanceTimersByTime(300);
    expect(seen.length).toBe(n); // no more after stop
    vi.useRealTimers();
  });
});

import { geolocationSource, gamepadSource, midiSource } from "../src/sources.js";
import { makeSourceMount } from "../src/source-nodes.js";
import { Source } from "../src/opstreams.js";

function stub(obj, key, value) {
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const orig = obj[key];
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  return () => { if (had) Object.defineProperty(obj, key, { value: orig, configurable: true, writable: true }); else delete obj[key]; };
}

describe("geolocationSource", () => {
  it("watches position, pushes a snapshot, and clears on stop", () => {
    const watch = vi.fn((ok) => { ok({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 9 }); return 7; });
    const clear = vi.fn();
    const un = stub(navigator, "geolocation", { watchPosition: watch, clearWatch: clear });
    const { stream, stop } = geolocationSource();
    expect(stream.value).toMatchObject({ lat: 1, lng: 2, accuracy: 3 });
    stop();
    expect(clear).toHaveBeenCalledWith(7);
    un();
  });
  it("reports an error when geolocation is unavailable", () => {
    const un = stub(navigator, "geolocation", undefined);
    expect(geolocationSource().stream.value).toMatchObject({ error: expect.any(String) });
    un();
  });
});

describe("midiSource", () => {
  it("subscribes to inputs and pushes decoded messages", async () => {
    let handler;
    const input = { addEventListener: (_t, h) => { handler = h; }, removeEventListener: vi.fn() };
    const access = { inputs: { forEach: (fn) => fn(input) } };
    const un = stub(navigator, "requestMIDIAccess", () => Promise.resolve(access));
    const { stream } = midiSource();
    await Promise.resolve(); await Promise.resolve();
    handler({ data: [0x90, 60, 100], target: { name: "K" }, timeStamp: 1 });
    expect(stream.value).toMatchObject({ command: 9, data1: 60, data2: 100 });
    un();
  });

  it("hot-plug: a device appearing via statechange gets subscribed too, and stop unhooks it all", async () => {
    const mkInput = () => { const i = { handlers: {}, addEventListener: (t, h) => { i.handlers[t] = h; }, removeEventListener: vi.fn() }; return i; };
    const a = mkInput();
    const live = [a];
    let stateHandler = null;
    const access = {
      inputs: { forEach: (fn) => live.forEach(fn) }, // live map: reflects hot-plugs
      addEventListener: (t, h) => { if (t === "statechange") stateHandler = h; },
      removeEventListener: vi.fn(),
    };
    const un = stub(navigator, "requestMIDIAccess", () => Promise.resolve(access));
    const { stream, stop } = midiSource();
    await Promise.resolve(); await Promise.resolve();
    expect(typeof stateHandler).toBe("function"); // hot-plug listener registered
    // plug a new device in AFTER the grant
    const b = mkInput();
    live.push(b);
    stateHandler({ port: b });
    expect(typeof b.handlers.midimessage).toBe("function"); // the new input is subscribed
    b.handlers.midimessage({ data: [0x80, 61, 0], target: { name: "B" }, timeStamp: 2 });
    expect(stream.value).toMatchObject({ command: 8, data1: 61 });
    // a re-fired statechange must not double-subscribe (inputs are deduped) — count via a spy
    const before = Object.keys(a.handlers).length;
    stateHandler({ port: a });
    expect(Object.keys(a.handlers).length).toBe(before);
    stop();
    expect(access.removeEventListener).toHaveBeenCalledWith("statechange", stateHandler);
    expect(a.removeEventListener).toHaveBeenCalled();
    expect(b.removeEventListener).toHaveBeenCalled();
    un();
  });
});

describe("makeSourceMount", () => {
  it("non-gated: starts immediately and registers the outlet", () => {
    const stream = new Source(5);
    const el = document.createElement("div"); const outlets = {};
    makeSourceMount({ start: () => ({ stream, stop() {} }), outlet: "v", label: "x" })({ element: el, outlets });
    expect(outlets.v).toBeTruthy();        // a published mirror Source
    expect(outlets.v.value).toBe(5);       // mirrors the device value
    expect(el.textContent).toContain("x"); // label is shown, not empty
  });
  it("gated: registers a proxy up front (wireable before enable); device forwards on click", () => {
    const device = new Source(5);
    const el = document.createElement("div"); const outlets = {};
    makeSourceMount({ start: () => ({ stream: device, stop() {} }), outlet: "v", label: "geo", gated: true })({ element: el, outlets });
    const proxy = outlets.v;
    expect(proxy).toBeTruthy();   // wireable before enabling
    expect(proxy.value).toBe(null);
    const btn = el.querySelector("button");
    expect(btn).toBeTruthy();
    btn.click();
    expect(outlets.v).toBe(proxy); // same stream identity (downstream stays wired)
    expect(proxy.value).toBe(5);   // device value forwarded in
  });
});

import { rafSource } from "../src/sources.js";

describe("rafSource", () => {
  it("bangs a unique count each animation frame and stops cleanly", () => {
    const cbs = [];
    const un1 = stub(globalThis, "requestAnimationFrame", (cb) => { cbs.push(cb); return cbs.length; });
    const un2 = stub(globalThis, "cancelAnimationFrame", () => {});
    const { stream, stop } = rafSource();
    const tick = () => { const c = cbs.shift(); if (c) c(); };
    tick(); expect(stream.value).toBe(1);
    tick(); expect(stream.value).toBe(2);
    stop();
    const before = stream.value;
    tick(); // after stop, the scheduled tick is a no-op
    expect(stream.value).toBe(before);
    un1(); un2();
  });
});
