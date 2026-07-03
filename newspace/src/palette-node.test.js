import { describe, it, expect } from "vitest";
import {
  DEFAULT_PALETTE,
  normalizeBrushes,
  entriesFromConfig,
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
import { normalizeEntries, entriesFromIds, entryToolIds, entriesArePlainTools, toolEntry } from "./model.js";
import { TOOL_META, BRUSH_FALLBACK_PATH } from "./brush/ui/chrome.jsx";
import { PART_DRAG_TYPE, encodePartId } from "./parts-bin.js";
import { DEFAULT_LAYOUT, DEFAULT_TOOL_ENTRIES } from "./brush/constants.js";

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

  it("entry helpers (model.js): normalize, one level of menu nesting, flat ids", () => {
    expect(toolEntry("pen")).toEqual({ kind: "tool", id: "pen" });
    expect(entriesFromIds(["pen", "", 3, "hand"])).toEqual([toolEntry("pen"), toolEntry("hand")]);
    // bare strings read as tool ids; junk is dropped; nested menus are stripped
    const rich = normalizeEntries([
      "pen",
      { kind: "divider" },
      { kind: "menu", label: "shapes", items: ["line", { kind: "menu", label: "nope", items: ["box"] }, { kind: "tool", id: "box" }] },
      { kind: "wat" }, null, 7,
    ]);
    expect(rich).toEqual([
      toolEntry("pen"),
      { kind: "divider" },
      { kind: "menu", label: "shapes", items: [toolEntry("line"), toolEntry("box")] },
    ]);
    expect(entryToolIds(rich)).toEqual(["pen", "line", "box"]);
    expect(entriesArePlainTools(rich)).toBe(false);
    expect(entriesArePlainTools(entriesFromIds(["pen"]))).toBe(true);
  });

  it("entriesFromConfig: entries > brushes > default (back-compat forever)", () => {
    expect(entriesFromConfig({ entries: ["pen", { kind: "divider" }] })).toEqual([toolEntry("pen"), { kind: "divider" }]);
    expect(entriesFromConfig({ brushes: ["pen", "hand"] })).toEqual(entriesFromIds(["pen", "hand"]));
    expect(entriesFromConfig({})).toEqual(entriesFromIds(DEFAULT_PALETTE));
    // junk entries fall through to brushes
    expect(entriesFromConfig({ entries: [null, 3], brushes: ["pen"] })).toEqual([toolEntry("pen")]);
  });

  it("the DEFAULT_TOOL_ENTRIES reproduce the old Toolbar's layout", () => {
    // nav+draw · divider · shapes · the "more shapes" overflow with line/box
    expect(entryToolIds(DEFAULT_TOOL_ENTRIES)).toEqual([...DEFAULT_LAYOUT.tools, "line", "box"]);
    expect(DEFAULT_TOOL_ENTRIES.some((e) => e.kind === "divider")).toBe(true);
    const menu = DEFAULT_TOOL_ENTRIES.find((e) => e.kind === "menu");
    expect(menu.items).toEqual([toolEntry("line"), toolEntry("box")]);
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
  it("is a BARE sketchy:window with the optional tool + tools inlets", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("palette");
    expect(plugin.bare).toBe(true);
    expect(plugin.unlisted).toBeFalsy(); // appears in the + menu / parts bin
    expect(plugin.inlets).toEqual([
      { name: "tool", type: "json" },
      { name: "tools", type: "json" },
    ]);
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

  it("there is no ⚙ configurator on the palette itself any more (it's its own window)", () => {
    const m = mount({});
    expect(m.element.querySelector(".ns-palette-gear")).toBeFalsy();
    expect(m.element.querySelector(".ns-palette-x")).toBeFalsy();
    m.done();
  });

  it("renders ENTRIES from config.entries: dividers + an overflow menu with the old toolbar's visuals", () => {
    const m = mount({ config: { entries: ["pen", { kind: "divider" }, { kind: "menu", label: "shapes", items: ["line", "box"] }] } });
    expect(rowIds(m.element)).toEqual(["pen"]); // menu items render inside the popover, not the row
    expect(m.element.querySelectorAll(".ns-palette-row .ns-sep").length).toBe(1); // the old .ns-sep rule
    const menuBtn = m.element.querySelector(".ns-palette-menu-btn");
    expect(menuBtn).toBeTruthy();
    expect(menuBtn.title).toBe("shapes");
    expect(document.querySelector(".ns-menu-grid")).toBeFalsy(); // closed
    menuBtn.click();
    // the popover is PORTAL'd out of the (clipped) bare window to the canvas root
    // (document.body in this bare mount) — never inside the palette's own box
    expect(m.element.querySelector(".ns-menu-grid")).toBeFalsy();
    const grid = document.querySelector(".ns-menu.ns-menu-grid"); // the old Toolbar's overflow chrome
    expect(grid).toBeTruthy();
    expect(document.querySelector(".ns-menu-backdrop")).toBeTruthy(); // click-away closes
    const line = grid.querySelector('button[data-tool="line"]');
    expect(line).toBeTruthy();
    line.click(); // arms the tool AND closes the menu
    expect(m.tool.value).toBe("line");
    expect(document.querySelector(".ns-menu-grid")).toBeFalsy();
    expect(document.querySelector(".ns-menu-backdrop")).toBeFalsy();
    // the overflow button lights while its tool is the armed one
    expect(m.element.querySelector(".ns-palette-menu-btn").classList.contains("active")).toBe(true);
    m.done();
  });

  it("the overflow popover closes on backdrop click, and cleanup removes a still-open one", () => {
    const m = mount({ config: { entries: [{ kind: "menu", label: "shapes", items: ["line"] }] } });
    m.element.querySelector(".ns-palette-menu-btn").click();
    expect(document.querySelector(".ns-menu-grid")).toBeTruthy();
    document.querySelector(".ns-menu-backdrop").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(document.querySelector(".ns-menu-grid")).toBeFalsy();
    // an open popover never outlives the palette
    m.element.querySelector(".ns-palette-menu-btn").click();
    expect(document.querySelector(".ns-menu-grid")).toBeTruthy();
    m.cleanup();
    expect(document.querySelector(".ns-menu-grid")).toBeFalsy();
    expect(document.querySelector(".ns-menu-backdrop")).toBeFalsy();
    m.element.remove();
  });

  it("a WIRED `tools` inlet DRIVES the palette (and follows updates); unwired falls back to config", () => {
    const tools = stubSource(["pen", { kind: "divider" }, "eraser"]);
    tools.wired = true;
    const m = mount({ config: { brushes: ["select"] }, inlets: { tools } });
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]); // the wire wins over config.brushes
    expect(m.element.querySelectorAll(".ns-sep").length).toBe(1);
    tools.set([{ kind: "tool", id: "hand" }]); // the config node emits an edit
    expect(rowIds(m.element)).toEqual(["hand"]);
    // the wire drops (unwired proxy = own buffer): config comes back
    tools.wired = false;
    tools.set(undefined);
    expect(rowIds(m.element)).toEqual(["select"]);
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
    m.tool.set("eraser"); // an external change (keyboard shortcut, another palette)
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
    // writes are ENTRIES-only: the legacy `config.brushes` (read in above) is a
    // read-shim — it normalizes into entries and persists back as entries
    expect(m.saved.at(-1)).toEqual({ entries: entriesFromIds(["pen", "eraser"]) });
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    const before = m.saved.length;
    drop("pen"); // dedupe: no new list
    expect(m.saved.length).toBe(before + 1); // still a write, but…
    expect(m.saved.at(-1)).toEqual({ entries: entriesFromIds(["pen", "eraser"]) }); // …the list is unchanged
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    // a stamp / a namespaced part is NOT taken — the event bubbles to the canvas
    expect(drop("mouse").defaultPrevented).toBe(false);
    expect(drop(encodePartId("window", "codemirror")).defaultPrevented).toBe(false);
    expect(rowIds(m.element)).toEqual(["pen", "eraser"]);
    m.done();
  });

  it("a WIRED palette does not take drops (they bubble to the canvas)", () => {
    const tools = stubSource(["pen"]);
    tools.wired = true;
    const m = mount({ config: { brushes: ["select"] }, inlets: { tools } });
    const root = m.element.querySelector(".ns-palette");
    const e = new Event("drop", { bubbles: true, cancelable: true });
    e.dataTransfer = { types: [PART_DRAG_TYPE], getData: () => "eraser" };
    root.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(m.saved.length).toBe(0);
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

  it("there is NO ⠿ grip / identity-drag protocol — saving a palette is alt-drag into the parts flap", () => {
    const m = mount({ config: { entries: ["pen", { kind: "divider" }, "eraser"] } });
    expect(m.element.querySelector(".ns-palette-grip")).toBeFalsy();
    m.done();
  });

  it("onConfig reconciles external edits (rebuild only when the entries changed)", () => {
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
