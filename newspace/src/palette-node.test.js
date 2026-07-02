import { describe, it, expect } from "vitest";
import {
  DEFAULT_PALETTE,
  normalizeBrushes,
  sameList,
  addBrush,
  removeBrush,
  toggleBrush,
  acceptDrop,
  toolLabel,
  paletteCensus,
  mountPalette,
  plugin,
} from "./palette-node.js";
import { TOOL_META, BRUSH_FALLBACK_PATH } from "./brush/ui/chrome.jsx";
import { PART_DRAG_TYPE, encodePartId } from "./parts-bin.js";
import { DEFAULT_LAYOUT } from "./brush/constants.js";

// a fake context Source: value/connect/set/apply — the same stub shape the other
// node tests use, plus `set` (the context Source's alias the toolbar path writes).
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

function mount({ config, tool = stubSource("select"), inlets } = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const saved = [];
  let configCb = null;
  const cleanup = mountPalette({
    element,
    inlets: inlets || {},
    config,
    setConfig: (patch) => saved.push(patch),
    context: { tool },
    onConfig: (cb) => { configCb = cb; cb({ ...(config || {}) }); },
  });
  return { element, tool, saved, cfg: (c) => configCb(c), cleanup, done: () => { cleanup(); element.remove(); } };
}
const rowIds = (element) => [...element.querySelectorAll(".ns-palette-row button[data-tool]")].map((b) => b.dataset.tool);
const btn = (element, id) => element.querySelector(`.ns-palette-row button[data-tool="${id}"]`);

describe("palette pure helpers", () => {
  it("normalizeBrushes: config list wins, junk dropped, default otherwise", () => {
    expect(normalizeBrushes({ brushes: ["pen", "eraser"] })).toEqual(["pen", "eraser"]);
    expect(normalizeBrushes({ brushes: ["pen", 3, "", null, "hand"] })).toEqual(["pen", "hand"]);
    expect(normalizeBrushes()).toEqual(DEFAULT_PALETTE);
    expect(normalizeBrushes({})).toEqual(DEFAULT_PALETTE);
    expect(normalizeBrushes()).not.toBe(DEFAULT_PALETTE); // a fresh array each time
    expect(DEFAULT_PALETTE).toEqual(DEFAULT_LAYOUT.tools); // seeded from the toolbar's default set
  });

  it("add / remove / toggle keep order and dedupe", () => {
    expect(addBrush(["pen"], "eraser")).toEqual(["pen", "eraser"]);
    expect(addBrush(["pen"], "pen")).toEqual(["pen"]);
    expect(removeBrush(["pen", "eraser"], "pen")).toEqual(["eraser"]);
    expect(toggleBrush(["pen"], "pen")).toEqual([]);
    expect(toggleBrush(["pen"], "hand")).toEqual(["pen", "hand"]);
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("acceptDrop takes only bare tool ids — not stamps or namespaced parts", () => {
    expect(acceptDrop("pen")).toBe("pen");
    expect(acceptDrop("highlighter")).toBe("highlighter");
    expect(acceptDrop("mouse")).toBe(null); // a stamp drawing, not an armable tool
    expect(acceptDrop(encodePartId("datatype", "folder"))).toBe(null);
    expect(acceptDrop(encodePartId("window", "codemirror"))).toBe(null);
    expect(acceptDrop(encodePartId("lens", "uppercase"))).toBe(null);
    expect(acceptDrop("")).toBe(null);
    expect(acceptDrop(null)).toBe(null);
  });

  it("toolLabel strips the hotkey suffix; census covers built-ins + registry with the toolbar glyphs", () => {
    expect(toolLabel("pen")).toBe("Draw");
    expect(toolLabel("select")).toBe("Select");
    expect(toolLabel("unknown-brush")).toBe("unknown-brush");
    const rows = paletteCensus([{ id: "marker", name: "Marker" }, { id: "pen", name: "shadowed" }]);
    const ids = rows.map((r) => r.id);
    for (const id of Object.keys(TOOL_META)) expect(ids).toContain(id);
    expect(ids).toContain("marker");
    expect(ids.filter((x) => x === "pen").length).toBe(1); // built-in wins, no dupe
    expect(rows.find((r) => r.id === "pen").path).toBe(TOOL_META.pen[1]);
    expect(rows.find((r) => r.id === "marker").path).toBe(BRUSH_FALLBACK_PATH);
  });
});

describe("plugin descriptor", () => {
  it("is a BARE sketchy:window, listed, with an optional tool inlet", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("palette");
    expect(plugin.bare).toBe(true);
    expect(plugin.unlisted).toBeFalsy(); // appears in the + menu / parts bin
    expect(plugin.inlets).toEqual([{ name: "tool", type: "json" }]);
    expect(plugin.outlets).toEqual([]);
  });
  it("loads to mountPalette", async () => {
    expect(await plugin.load()).toBe(mountPalette);
  });
});

describe("mountPalette", () => {
  it("renders the configured brushes, in config order, with the toolbar glyphs", () => {
    const m = mount({ config: { brushes: ["eraser", "pen", "hand"] } });
    expect(rowIds(m.element)).toEqual(["eraser", "pen", "hand"]);
    const pen = btn(m.element, "pen");
    expect(pen.title).toBe(TOOL_META.pen[0]);
    expect(pen.querySelector("svg path").getAttribute("d")).toBe(TOOL_META.pen[1]);
    m.done();
  });

  it("seeds the DEFAULT_LAYOUT tools when config has no brushes", () => {
    const m = mount({});
    expect(rowIds(m.element)).toEqual(DEFAULT_PALETTE);
    m.done();
  });

  it("a click sets the tool through the context (context.tool.set)", () => {
    const m = mount({ config: { brushes: ["pen", "eraser"] } });
    btn(m.element, "eraser").click();
    expect(m.tool.value).toBe("eraser");
    m.done();
  });

  it("active state follows the context tool — live, both directions", () => {
    const m = mount({ config: { brushes: ["pen", "eraser"] }, tool: stubSource("pen") });
    expect(btn(m.element, "pen").classList.contains("active")).toBe(true);
    m.tool.set("eraser"); // an external change (the toolbar, a keyboard shortcut)
    expect(btn(m.element, "pen").classList.contains("active")).toBe(false);
    expect(btn(m.element, "eraser").classList.contains("active")).toBe(true);
    btn(m.element, "pen").click(); // and back through our own write
    expect(btn(m.element, "pen").classList.contains("active")).toBe(true);
    m.done();
  });

  it("a WIRED tool inlet wins over the context (writes via apply)", () => {
    const wired = stubSource("select");
    wired.wired = true;
    const m = mount({ config: { brushes: ["pen"] }, inlets: { tool: wired } });
    btn(m.element, "pen").click();
    expect(wired.value).toBe("pen"); // through the wire…
    expect(m.tool.value).toBe("select"); // …not the context
    expect(btn(m.element, "pen").classList.contains("active")).toBe(true);
    m.done();
  });

  it("⚙ opens the census popover; toggling persists via setConfig (add + remove)", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    expect(m.element.querySelector(".ns-palette-menu")).toBeFalsy();
    m.element.querySelector(".ns-palette-gear").click();
    const menu = m.element.querySelector(".ns-palette-menu");
    expect(menu).toBeTruthy();
    const checks = [...menu.querySelectorAll(".ns-palette-check")];
    expect(checks.length).toBeGreaterThanOrEqual(Object.keys(TOOL_META).length);
    const box = (id) => checks.find((c) => c.textContent.includes(toolLabel(id))).querySelector("input");
    expect(box("pen").checked).toBe(true);
    expect(box("eraser").checked).toBe(false);
    box("eraser").click(); // add
    expect(m.saved.at(-1)).toEqual({ brushes: ["pen", "eraser"] });
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    const box2 = [...m.element.querySelectorAll(".ns-palette-check")].find((c) => c.textContent.includes(toolLabel("pen"))).querySelector("input");
    box2.click(); // remove
    expect(m.saved.at(-1)).toEqual({ brushes: ["eraser"] });
    expect(rowIds(m.element)).toEqual(["eraser"]);
    m.done();
  });

  it("while the popover is open each button grows an × that removes it", () => {
    const m = mount({ config: { brushes: ["pen", "eraser"] } });
    expect(m.element.querySelector(".ns-palette-x")).toBeFalsy(); // not while just painting
    m.element.querySelector(".ns-palette-gear").click();
    const xs = [...m.element.querySelectorAll(".ns-palette-x")];
    expect(xs.length).toBe(2);
    xs[0].click();
    expect(m.saved.at(-1)).toEqual({ brushes: ["eraser"] });
    expect(rowIds(m.element)).toEqual(["eraser"]);
    m.done();
  });

  it("dropping a bare tool id appends (and dedupes); stamps/parts fall through", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    const root = m.element.querySelector(".ns-palette");
    const drop = (payload) => {
      const e = new Event("drop", { bubbles: true, cancelable: true });
      e.dataTransfer = { types: [PART_DRAG_TYPE], getData: (t) => (t === PART_DRAG_TYPE ? payload : "") };
      root.dispatchEvent(e);
      return e;
    };
    expect(drop("eraser").defaultPrevented).toBe(true);
    expect(m.saved.at(-1)).toEqual({ brushes: ["pen", "eraser"] });
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    const before = m.saved.length;
    drop("pen"); // dedupe: no new write
    expect(m.saved.length).toBe(before + 1); // setBrushes writes, but…
    expect(m.saved.at(-1)).toEqual({ brushes: ["pen", "eraser"] }); // …the list is unchanged
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    // a stamp / a namespaced part is NOT taken — the event bubbles to the canvas
    expect(drop("mouse").defaultPrevented).toBe(false);
    expect(drop(encodePartId("window", "codemirror")).defaultPrevented).toBe(false);
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    m.done();
  });

  it("dragover accepts only the tool drag type", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    const root = m.element.querySelector(".ns-palette");
    const over = (types) => {
      const e = new Event("dragover", { bubbles: true, cancelable: true });
      e.dataTransfer = { types, dropEffect: "" };
      root.dispatchEvent(e);
      return e;
    };
    expect(over([PART_DRAG_TYPE]).defaultPrevented).toBe(true);
    expect(over(["text/plain"]).defaultPrevented).toBe(false);
    m.done();
  });

  it("onConfig reconciles external edits (rebuild only when the list changed)", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    const penBtn = btn(m.element, "pen");
    m.cfg({ brushes: ["pen"] }); // an echo of the same list — no rebuild
    expect(btn(m.element, "pen")).toBe(penBtn); // the same DOM node survived
    m.cfg({ brushes: ["hand", "pen"] }); // a remote edit
    expect(rowIds(m.element)).toEqual(["hand", "pen"]);
    m.cfg({}); // brushes deleted remotely ⇒ back to the default set
    expect(rowIds(m.element)).toEqual(DEFAULT_PALETTE);
    m.done();
  });

  it("stops propagation on pointerdown (only) so the canvas doesn't grab/draw through it", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    let sawDown = 0, sawClick = 0;
    m.element.addEventListener("pointerdown", () => sawDown++);
    m.element.addEventListener("click", () => sawClick++);
    const root = m.element.querySelector(".ns-palette");
    root.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(sawDown).toBe(0); // stopped
    btn(m.element, "pen").click();
    expect(sawClick).toBe(1); // clicks keep bubbling (document-delegation frameworks)
    m.done();
  });

  it("cleanup removes the DOM and disconnects the tool subscription", () => {
    const m = mount({ config: { brushes: ["pen"] } });
    m.cleanup();
    expect(m.element.querySelector(".ns-palette")).toBeFalsy();
    m.tool.set("eraser"); // no listeners left to throw / touch removed DOM
    m.element.remove();
  });
});
