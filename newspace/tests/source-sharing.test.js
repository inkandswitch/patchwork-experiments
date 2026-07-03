import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeSourceMount } from "../src/source-nodes.js";

// a synchronous fake device whose value we can drive
function fakeDevice(initial) {
  let v = initial, cb = null, stopped = false;
  const stream = { get value() { return v; }, connect(c) { cb = c; c({ type: "snapshot", value: v }); return () => { cb = null; }; } };
  return { handle: { stream, stop: () => { stopped = true; } }, set: (nv) => { v = nv; if (cb) cb({ type: "snapshot", value: nv }); }, get stopped() { return stopped; } };
}
const outlets = () => { const o = {}; return { o, setOutlet: (n, s) => (o[n] = s) }; };

describe("makeSourceMount — own/mine sharing", () => {
  beforeEach(() => { window.accountDocHandle = { doc: () => ({ contactUrl: "me" }) }; });
  afterEach(() => { delete window.accountDocHandle; });

  // a fake ShareSession mesh (the per-item `share` helper the mount receives)
  function fakeMesh() {
    const sent = []; let valueCb = null;
    return {
      sent, emit: (v) => valueCb && valueCb(v),
      mesh: { value: (v) => sent.push(v), onValue: (cb) => { valueCb = cb; return () => {}; }, stream: () => {}, onStream: () => () => {}, unshare: () => {} },
    };
  }

  it("own mode (default): runs the device, never shares", () => {
    const dev = fakeDevice(1);
    let started = 0; const fm = fakeMesh();
    const mount = makeSourceMount({ start: () => { started++; return dev.handle; }, outlet: "v", label: "X" });
    const { o, setOutlet } = outlets();
    mount({ element: document.createElement("div"), setOutlet, config: {}, share: fm.mesh });
    expect(started).toBe(1);
    dev.set(2);
    expect(o.v.value).toBe(2);
    expect(fm.sent).toEqual([]);   // own mode never shares
  });

  it("mine + I am the owner: runs the device AND writes the value to the top-level item.shared", () => {
    const dev = fakeDevice(1);
    const writes = [];
    const mount = makeSourceMount({ start: () => dev.handle, outlet: "v", label: "X" });
    const { o, setOutlet } = outlets();
    mount({ element: document.createElement("div"), setOutlet, config: { share: "mine", owner: "me" }, shareDoc: (v) => writes.push(v) });
    expect(writes.at(-1)).toBe(1);  // owner writes the value to the doc (leading edge)
    expect(o.v.value).toBe(1);
  });

  it("mine + someone ELSE owns: does NOT run the device, receives item.shared via onShared", () => {
    let started = 0; let sharedCb = null;
    const mount = makeSourceMount({ start: () => { started++; return fakeDevice(0).handle; }, outlet: "v", label: "X" });
    const { o, setOutlet } = outlets();
    mount({ element: document.createElement("div"), setOutlet, config: { share: "mine", owner: "someone-else" }, onShared: (cb) => { sharedCb = cb; } });
    expect(started).toBe(0);    // a non-owner never starts the local device
    sharedCb(42);               // owner's value arrives via the top-level doc field
    expect(o.v.value).toBe(42);
  });
});
