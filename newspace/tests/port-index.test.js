// README.md Phase 3 — the PORT INDEX behind domPortPos/ctxPortPos. Wire-endpoint
// lookup is a Map hit fed by ONE viewport-scoped MutationObserver, not a
// querySelectorAll walk per geometry recompute. Pinned here at mount level:
// a url wire appears when its DOM port mounts and disappears when it unmounts
// (the index invalidation is REACTIVE via portsTick), and recomputing geometry
// without a DOM change performs zero port scans (the `portScan` counter is flat).
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer/drop paths need
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

registerPlugins([{
  type: "sketchy:surface", id: "port-sink", name: "Port sink",
  inlets: [{ name: "in", type: "json" }],
  outlets: [],
  load: async () => ({ element }) => { element.textContent = "sink"; return () => {}; },
}]);

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

const scans = () => (window.__perf && window.__perf.portScan) || 0;

describe("port index — url wires anchor to [data-automerge-path] ports", () => {
  // retry(1): the window.__perf counters are global — a previous file's canvas can
  // leak one async tick into our deltas when file order lines up (seen 2026-07-02).
  // A real regression fails BOTH attempts; only cross-file noise gets absorbed.
  it("the wire appears when its port mounts, survives a pan without a rescan, and drops when the port unmounts", { retry: 1 }, async () => {
    const { element } = await mountCanvas([
      { id: "ed1", kind: "editor", editorId: "port-sink", x: 40, y: 40, w: 200, h: 100, inlets: { in: { url: "automerge:port-test", path: ["title"] } } },
    ]);
    await flush(30);
    // the wire spec exists but its source port isn't in the DOM → no geometry, no drawn wire
    expect(element.querySelector(".ns-wires")).toBeTruthy();
    expect(element.querySelectorAll(".ns-wires > g").length).toBe(0);

    // a port element mounts (what an embedded tool's field renders as) → the
    // MutationObserver invalidates the index, portsTick re-runs the geometry
    const port = document.createElement("span");
    port.dataset.automergeUrl = "automerge:port-test";
    port.dataset.automergePath = JSON.stringify(["title"]);
    element.querySelector(".ns-root").append(port);
    await flush(30);
    expect(element.querySelectorAll(".ns-wires > g").length).toBe(1);

    // geometry recomputes on a pan (cam is a geomFor dep) WITHOUT rescanning the DOM
    const before = scans();
    element.querySelector(".ns-root").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 12, deltaY: 7 }));
    await flush(30);
    expect(element.querySelectorAll(".ns-wires > g").length).toBe(1); // still anchored
    expect(scans()).toBe(before); // Map hit, zero querySelectorAll in the wire path

    // the port unmounts → the index invalidates and the wire drops its endpoint
    port.remove();
    await flush(30);
    expect(element.querySelectorAll(".ns-wires > g").length).toBe(0);
  });
});

describe("ctx port anchoring — the computed chip position (the inspect strip is gone)", () => {
  it("a context wire anchors at the fixed left-edge chip position, no DOM lookup", async () => {
    const { element } = await mountCanvas([
      { id: "ed2", kind: "editor", editorId: "port-sink", x: 40, y: 40, w: 200, h: 100, inlets: { in: { context: "pointer" } } },
    ]);
    await flush(30);
    const wireG = () => element.querySelector(".ns-wires g");
    expect(wireG()).toBeTruthy();
    // the computed left-edge chip position (x=78 ...) — pure math (ctxPortPos)
    expect(wireG().getAttribute("transform")).toMatch(/^translate\(78 /);
    // the inspect strip + its tray eyeball were removed 2026-07-02
    expect(element.querySelector(".ns-ctx-inlets")).toBeFalsy();
    expect(element.querySelector(".ns-inspect-btn")).toBeFalsy();
  });
});
