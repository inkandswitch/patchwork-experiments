// README.md Phase 6 — visibleWires is a MEMO shared by its two JSX callsites
// (the <Show> gate + the <For>), so the wiring graph is filtered ONCE per
// change, not twice per render. Pinned here at mount level via the
// `visibleWires` perf counter, alongside the behavior the memo must preserve:
// wire paths render, and per-wire geometry (a separate memo over geomFor,
// now O(1) through the Phase 2 indexById) still tracks an item move without
// recomputing the visible-wire list at all.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer/drop paths need
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

registerPlugins([
  { type: "sketchy:window", id: "wm-src", name: "Wire src", inlets: [], outlets: [{ name: "value", type: "json" }], load: async () => ({ element }) => { element.textContent = "src"; return () => {}; } },
  { type: "sketchy:window", id: "wm-sink", name: "Wire sink", inlets: [{ name: "in", type: "json" }], outlets: [], load: async () => ({ element }) => { element.textContent = "sink"; return () => {}; } },
]);

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
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

const computes = () => (window.__perf && window.__perf.visibleWires) || 0;

const SRC = { id: "src1", kind: "editor", editorId: "wm-src", x: 40, y: 40, w: 160, h: 90 };
const SINK = { id: "sink1", kind: "editor", editorId: "wm-sink", x: 420, y: 40, w: 160, h: 90, inlets: { in: { node: "src1", outlet: "value" } } };
const RECT = { id: "r1", kind: "shape", type: "rectangle", x: 700, y: 300, w: 80, h: 60, color: "line", fill: "none", strokeWidth: 2, roughness: 1, bowing: 1, fillStyle: "hachure", seed: 7, rotation: 0 };

describe("visibleWires memo — one computation per change, geometry per wire", () => {
  it("renders the node wire's rough paths", async () => {
    const { element } = await mountCanvas([structuredClone(SRC), structuredClone(SINK)]);
    await flush(30);
    const wireG = element.querySelector(".ns-wires > g");
    expect(wireG).toBeTruthy();
    expect(wireG.querySelectorAll("path").length).toBeGreaterThan(0); // roughLink strokes + the hit path
    expect(wireG.getAttribute("transform")).toMatch(/^translate\(/);
  });

  // retry(1): the window.__perf counters are global — a previous file's canvas can
  // leak one async tick into our deltas when file order lines up (seen 2026-07-02).
  // A real regression fails BOTH attempts; only cross-file noise gets absorbed.
  it("an items change recomputes the wire list ONCE (two callsites share the memo)", { retry: 1 }, async () => {
    const { layout } = await mountCanvas([structuredClone(SRC), structuredClone(SINK)]);
    await flush(30);
    const c0 = computes();
    // a structural items change (add) is a visibleWires dep → exactly one recompute;
    // the pre-memo function ran once per callsite (2) here
    layout.change((d) => { d.items.push(structuredClone(RECT)); });
    await flush(30);
    expect(computes() - c0).toBe(1);
  });

  // retry(1): global __perf deltas — cross-file async-tick noise only; see the note above.
  it("moving the upstream item updates the wire transform WITHOUT recomputing the wire list", { retry: 1 }, async () => {
    const { element, layout } = await mountCanvas([structuredClone(SRC), structuredClone(SINK)]);
    await flush(30);
    const wireG = () => element.querySelector(".ns-wires > g");
    const t0 = wireG().getAttribute("transform");
    const c0 = computes();
    layout.change((d) => { d.items.find((x) => x.id === "src1").x = 240; });
    await flush(30);
    expect(wireG().getAttribute("transform")).not.toBe(t0); // geomFor tracked the move (indexById lookup)
    expect(computes() - c0).toBe(0); // geometry memos re-ran; the list memo did not
  });
});
