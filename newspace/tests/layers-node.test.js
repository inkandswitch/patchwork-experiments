// The LAYER SWITCHER as a bare window (layers-node.js) — the fixed .ns-layers
// strip made a placeable, dismissable seed. It reads the stack from
// context.layers and switches tabs by writing context.activeLayer.
import { describe, it, expect } from "vitest";
import { mountLayers, plugin } from "../src/layers-node.js";

// the stub Source shape the other node tests use (value/connect/set/apply)
function stubSource(initial) {
  let val = initial;
  const cbs = new Set();
  const s = {
    get value() { return val; },
    connect(cb) { cbs.add(cb); cb({ type: "snapshot", value: val }); return () => cbs.delete(cb); },
    set(v) { val = v; for (const cb of [...cbs]) cb({ type: "snapshot", value: v }); },
    apply(op) { if (op && op.type === "snapshot") s.set(op.value); },
  };
  return s;
}

const STACK = [
  { id: "canvas", name: "Canvas", kind: "canvas" },
  { id: "overlay", name: "Overlay", kind: "overlay" },
];

function mount({ layers = stubSource(STACK), active = stubSource("canvas") } = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const cleanup = mountLayers({ element, context: { layers, activeLayer: active } });
  return { element, layers, active, cleanup, done: () => { cleanup(); element.remove(); } };
}
const tabs = (element) => [...element.querySelectorAll(".ns-layer-tab")];

describe("plugin descriptor", () => {
  it("is a BARE, FIT-CONTENT sketchy:window with no ports (state rides the context)", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("layers");
    expect(plugin.bare).toBe(true);
    expect(plugin.fit).toBe(true);
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toEqual([]);
  });
  it("loads to mountLayers", async () => {
    expect(await plugin.load()).toBe(mountLayers);
  });
});

describe("mountLayers", () => {
  it("renders one tab per layer, TOPMOST space first, the active one marked", () => {
    const m = mount();
    expect(tabs(m.element).map((t) => t.textContent)).toEqual(["Overlay", "Canvas"]); // reverse of doc order
    expect(tabs(m.element).map((t) => t.classList.contains("active"))).toEqual([false, true]);
    m.done();
  });

  it("a tab click WRITES context.activeLayer; the active mark follows the source (both directions)", () => {
    const m = mount();
    tabs(m.element).find((t) => t.textContent === "Overlay").click();
    expect(m.active.value).toBe("overlay");
    expect(tabs(m.element).find((t) => t.textContent === "Overlay").classList.contains("active")).toBe(true);
    m.active.set("canvas"); // an external switch (the canvas's own mirror) flows back in
    expect(tabs(m.element).find((t) => t.textContent === "Canvas").classList.contains("active")).toBe(true);
    m.done();
  });

  it("follows a LIVE stack change, reconciling tabs in place (a tab keeps its DOM identity)", () => {
    const m = mount();
    const before = tabs(m.element).find((t) => t.textContent === "Canvas");
    m.layers.set([...STACK, { id: "geo", name: "Map", kind: "geo" }]);
    expect(tabs(m.element).map((t) => t.textContent)).toEqual(["Map", "Overlay", "Canvas"]);
    expect(tabs(m.element).find((t) => t.textContent === "Canvas")).toBe(before); // same node
    m.done();
  });

  it("a single-layer stack hides the pill (nothing to switch)", () => {
    const m = mount({ layers: stubSource([STACK[0]]) });
    expect(m.element.querySelector(".ns-layers").style.display).toBe("none");
    m.layers.set(STACK); // a second layer appears → the pill shows
    expect(m.element.querySelector(".ns-layers").style.display).not.toBe("none");
    m.done();
  });

  it("stops propagation on pointerdown only (the house rule); cleanup removes + disconnects", () => {
    const m = mount();
    let saw = 0;
    document.body.addEventListener("pointerdown", () => saw++);
    m.element.querySelector(".ns-layers").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(saw).toBe(0);
    m.cleanup();
    expect(m.element.querySelector(".ns-layers")).toBeFalsy();
    m.layers.set([]); // a post-cleanup emission must not throw / touch DOM
    m.element.remove();
  });
});
