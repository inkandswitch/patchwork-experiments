import { describe, it, expect } from "vitest";
import { docHandleFromOpstream, provideSketchyStreams } from "./sketchy-streams.js";
import { Opstream } from "./opstreams.js";

describe("docHandleFromOpstream — a DocHandle face over an opstream", () => {
  it("doc() reads the stream; change() writes back; on('change') fires", () => {
    const s = new Opstream({ items: [], layout: { tools: ["pen"] } });
    const h = docHandleFromOpstream(s, "automerge:X");
    expect(h.url).toBe("automerge:X");
    expect(h.doc()).toEqual({ items: [], layout: { tools: ["pen"] } });
    let fired = 0; h.on("change", () => fired++);
    h.change((d) => { d.items.push({ id: "a" }); });
    expect(s.value.items).toEqual([{ id: "a" }]);  // written back to the opstream
    expect(h.doc().items).toEqual([{ id: "a" }]);
    expect(fired).toBeGreaterThan(0);
  });
  it("a remote op on the opstream fires the handle's change listeners", () => {
    const s = new Opstream({ n: 1 });
    const h = docHandleFromOpstream(s, "automerge:Y");
    let last = null; h.on("change", (e) => { last = e.doc; });
    s.apply({ type: "snapshot", value: { n: 2 } });
    expect(last).toEqual({ n: 2 });
    h.off("change", () => {});
    h.free();
  });
});

describe("provideSketchyStreams — the tool-side provider", () => {
  it("serves a matching sketchy:* selector over the port, ignores the rest", () => {
    const el = document.createElement("div");
    const items = new Opstream(["x"]);
    const stop = provideSketchyStreams(el, (type) => (type === "sketchy:items" ? items : null));
    const posts = [];
    const port = { onmessage: null, postMessage: (d) => posts.push(d), start() {} };
    el.dispatchEvent(new CustomEvent("patchwork:subscribe", { detail: { selector: { type: "sketchy:items" }, port }, bubbles: true }));
    expect(posts.at(-1)).toEqual({ type: "snapshot", value: ["x"] }); // initial snapshot served

    const before = posts.length;
    el.dispatchEvent(new CustomEvent("patchwork:subscribe", { detail: { selector: { type: "other:thing" }, port }, bubbles: true }));
    expect(posts.length).toBe(before); // a non-sketchy selector isn't answered

    items.apply({ type: "snapshot", value: ["x", "y"] }); // a later provider edit forwards
    expect(posts.at(-1)).toEqual({ type: "snapshot", value: ["x", "y"] });
    stop();
  });

  it("a re-subscribe from the same source REPLACES the old bridge (no per-remount accumulation)", () => {
    const el = document.createElement("div");
    const items = new Opstream(["x"]);
    const stop = provideSketchyStreams(el, (type) => (type === "sketchy:items" ? items : null));
    const mkPort = () => { const p = { posts: [], closed: false, onmessage: null, postMessage(d) { p.posts.push(d); }, start() {}, close() { p.closed = true; } }; return p; };
    const sub = (port) => el.dispatchEvent(new CustomEvent("patchwork:subscribe", { detail: { selector: { type: "sketchy:items" }, port }, bubbles: true }));
    const p1 = mkPort(); sub(p1);
    const p2 = mkPort(); sub(p2); // the component remounted and re-subscribed
    expect(p1.closed).toBe(true); // the stale bridge is torn down + its port closed
    const n1 = p1.posts.length;
    items.apply({ type: "snapshot", value: ["x", "y"] });
    expect(p1.posts.length).toBe(n1); // the dead port no longer receives
    expect(p2.posts.at(-1)).toEqual({ type: "snapshot", value: ["x", "y"] }); // the live one does
    stop();
    expect(p2.closed).toBe(true); // provider teardown disposes the live bridge too
  });

  it("tears a bridge down when the consumer's port fires `close` (where supported)", () => {
    const el = document.createElement("div");
    const items = new Opstream([1]);
    const stop = provideSketchyStreams(el, () => items);
    let closeCb = null;
    const posts = [];
    const port = { onmessage: null, postMessage: (d) => posts.push(d), start() {}, close() {}, addEventListener(t, cb) { if (t === "close") closeCb = cb; } };
    el.dispatchEvent(new CustomEvent("patchwork:subscribe", { detail: { selector: { type: "sketchy:items" }, port }, bubbles: true }));
    expect(typeof closeCb).toBe("function");
    closeCb(); // the consumer side closed / was GC'd
    const n = posts.length;
    items.apply({ type: "snapshot", value: [1, 2] });
    expect(posts.length).toBe(n); // nothing posted into the dead port
    stop();
  });
});
