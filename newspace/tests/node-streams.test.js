// README.md Phase 7 — nodeStreams is a plain Map (O(1) reads, no store proxy)
// with a manual bump signal standing in for the store's tracking. The signal
// matters because outlets register AFTER an async mount — no rootItems change
// fires then — yet wireSpecs' bidi flags, the wire-subscription effect and the
// sink's inlet backing all resolve through nodeStream. Pinned at mount level:
// a mounted source registers its outlets (the wired sink receives the value,
// the wire shows the bidi diamond), and unmounting it unregisters them (the
// sink's inlet reverts to its own buffer).
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Source } from "../src/opstreams.js";
import { Canvas } from "../src/brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer/drop paths need
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const got = []; // every snapshot value the sink's inlet delivered, in order

registerPlugins([
  {
    type: "sketchy:window", id: "ns7-src", name: "NS7 src", inlets: [], outlets: [{ name: "value", type: "json" }],
    load: async () => ({ element, setOutlet }) => {
      element.textContent = "src";
      const s = new Source(7);
      s.apply = () => {}; // writable outlet → the wire to it reads as bidi
      setOutlet("value", s);
      return () => {};
    },
  },
  {
    type: "sketchy:window", id: "ns7-sink", name: "NS7 sink", inlets: [{ name: "in", type: "json" }], outlets: [],
    load: async () => ({ element, inlets }) => {
      element.textContent = "sink";
      const off = inlets.in.connect((op) => { if (op && op.type === "snapshot") got.push(op.value); });
      return () => off();
    },
  },
  // an INSTRUMENTED source: counts live connect()s on its outlet stream, so the
  // leak pin below can assert every downstream subscription is released.
  {
    type: "sketchy:window", id: "ns7-leak-src", name: "NS7 leak src", inlets: [], outlets: [{ name: "value", type: "json" }],
    load: async () => ({ element, setOutlet }) => {
      element.textContent = "leak-src";
      const s = new Source(1);
      const c0 = s.connect.bind(s);
      s.connect = (cb) => { leak.live++; const off = c0(cb); return () => { leak.live--; return off(); }; };
      setOutlet("value", s);
      return () => {};
    },
  },
]);
const leak = { live: 0 };

const mounted = [];
async function mountCanvas(items = []) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush();
  return m;
}
beforeEach(() => got.splice(0));
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

const SRC = { id: "src1", kind: "editor", editorId: "ns7-src", x: 40, y: 40, w: 160, h: 90 };
const SINK = { id: "sink1", kind: "editor", editorId: "ns7-sink", x: 420, y: 40, w: 160, h: 90, inlets: { in: { node: "src1", outlet: "value" } } };
const diamond = (element) => element.querySelector('.ns-wires rect[transform="rotate(45)"]');

describe("nodeStreams Map + bump signal — register/unregister stays reactive", () => {
  it("a mounted source registers its outlets: the wired sink receives the value and the wire is bidi", async () => {
    const { element } = await mountCanvas([structuredClone(SRC), structuredClone(SINK)]);
    await flush(40);
    // registration landed after the async mount (no items change), so both of
    // these need the bump signal: the inlet backing swap and wireSpecs' bidi.
    expect(got).toContain(7);
    expect(element.querySelector(".ns-wires > g")).toBeTruthy();
    expect(diamond(element)).toBeTruthy(); // bidi midpoint marker (writable outlet)
  });

  it("unmounting the source unregisters its outlets: the sink's inlet reverts to its buffer", async () => {
    const { element, layout } = await mountCanvas([structuredClone(SRC), structuredClone(SINK)]);
    await flush(40);
    expect(got).toContain(7);
    layout.change((d) => { d.items.splice(d.items.findIndex((x) => x.id === "src1"), 1); });
    await flush(40);
    // the Map entry is gone → nodeStream resolves undefined → the proxy's own
    // (empty) buffer re-emits; a stale entry would keep delivering 7 here
    expect(got[got.length - 1]).toBe(undefined);
    expect(diamond(element)).toBeFalsy(); // no upstream → no wire, no bidi marker
  });
});

describe("inlet proxies disconnect on unmount (leak pin)", () => {
  it("adding + removing a wired sink N times leaves the upstream's listener count FLAT", async () => {
    const { layout } = await mountCanvas([{ id: "lsrc", kind: "editor", editorId: "ns7-leak-src", x: 40, y: 40, w: 160, h: 90 }]);
    await flush(40);
    const base = leak.live; // the src alone (no wires yet)
    for (let i = 0; i < 3; i++) {
      layout.change((d) => { d.items.push({ id: "lsink" + i, kind: "editor", editorId: "ns7-sink", x: 420, y: 40, w: 160, h: 90, inlets: { in: { node: "lsrc", outlet: "value" } } }); });
      await flush(40);
      expect(leak.live).toBeGreaterThan(base); // wired: the sink's inlet proxy subscribed upstream
      layout.change((d) => { const j = d.items.findIndex((x) => x.id === "lsink" + i); if (j >= 0) d.items.splice(j, 1); });
      await flush(40);
      // FLAT after unmount: the proxy backing was released (setBacking(null)) —
      // before the fix each cycle stranded one live subscription on the source
      expect(leak.live).toBe(base);
    }
  });
});
