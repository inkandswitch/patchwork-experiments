// The palette CONFIGURATOR — its own bare window: owns the entry structure in
// its config, edits it (add/remove from the census, dividers, one-level menus,
// reorder), and emits the live array on a `tools` OUTLET (wired into a palette's
// `tools` inlet — the seeded ns-toolbar-config → ns-toolbar-palette pair).
import { describe, it, expect } from "vitest";
import {
  mountPaletteConfig, plugin, moveAt, removeAt, configEntries,
} from "./palette-config-node.js";
import { toolEntry } from "./model.js";
import { DEFAULT_TOOL_ENTRIES } from "./brush/constants.js";
import { toolLabel } from "./palette-node.js";

function mount({ config } = {}) {
  const element = document.createElement("div");
  document.body.append(element);
  const saved = [];
  const outlets = {};
  let configCb = null;
  const cleanup = mountPaletteConfig({
    element,
    config,
    setConfig: (patch) => saved.push(patch),
    onConfig: (cb) => { configCb = cb; cb({ ...(config || {}) }); },
    setOutlet: (name, stream) => { outlets[name] = stream; },
  });
  return { element, saved, outlets, cfg: (c) => configCb(c), done: () => { cleanup(); element.remove(); } };
}
const names = (element) => [...element.querySelectorAll(".ns-palcfg-row .ns-palcfg-name, .ns-palcfg-row .ns-palcfg-label")].map((n) => n.value ?? n.textContent);

describe("pure helpers", () => {
  it("moveAt swaps neighbours and clamps at the ends; removeAt removes", () => {
    expect(moveAt(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveAt(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]); // clamped
    expect(moveAt(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]); // clamped
    expect(removeAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
  it("configEntries: config.entries else the DEFAULT (old Toolbar layout), always a fresh copy", () => {
    expect(configEntries({ entries: ["pen"] })).toEqual([toolEntry("pen")]);
    const d = configEntries({});
    expect(d).toEqual(DEFAULT_TOOL_ENTRIES);
    expect(d).not.toBe(DEFAULT_TOOL_ENTRIES);
    expect(d.find((e) => e.kind === "menu").items).not.toBe(DEFAULT_TOOL_ENTRIES.find((e) => e.kind === "menu").items);
  });
});

describe("plugin descriptor", () => {
  it("is a BARE sketchy:window with a `tools` outlet and no inlets (a source)", () => {
    expect(plugin.type).toBe("sketchy:window");
    expect(plugin.id).toBe("palette-config");
    expect(plugin.bare).toBe(true);
    expect(plugin.inlets).toEqual([]);
    expect(plugin.outlets).toEqual([{ name: "tools", type: "json" }]);
  });
  it("loads to mountPaletteConfig", async () => {
    expect(await plugin.load()).toBe(mountPaletteConfig);
  });
});

describe("mountPaletteConfig", () => {
  it("registers the `tools` outlet carrying the config entries (default = the old Toolbar)", () => {
    const m = mount({});
    expect(m.outlets.tools).toBeTruthy();
    expect(m.outlets.tools.value).toEqual(DEFAULT_TOOL_ENTRIES);
    m.done();
  });

  it("renders every entry as a row: tools with glyph+name, dividers, a menu with editable label + nested items", () => {
    const m = mount({ config: { entries: ["pen", { kind: "divider" }, { kind: "menu", label: "shapes", items: ["line", "box"] }] } });
    expect(names(m.element)).toEqual(["Draw", "— divider —", "shapes", toolLabel("line"), toolLabel("box")]);
    expect(m.element.querySelector(".ns-palcfg-nest")).toBeTruthy(); // menu items indent
    m.done();
  });

  it("remove / reorder write config AND emit on the outlet", () => {
    const m = mount({ config: { entries: ["pen", "eraser", "hand"] } });
    const emitted = [];
    m.outlets.tools.connect((op) => emitted.push(op));
    const rows = () => [...m.element.querySelectorAll(".ns-palcfg-row")];
    // move "eraser" (row 1) up
    rows()[1].querySelector('button[title="move up"]').click();
    expect(m.saved.at(-1)).toEqual({ entries: [toolEntry("eraser"), toolEntry("pen"), toolEntry("hand")] });
    expect(m.outlets.tools.value).toEqual([toolEntry("eraser"), toolEntry("pen"), toolEntry("hand")]);
    // remove the (now) first row
    rows()[0].querySelector('button[title="remove"]').click();
    expect(m.saved.at(-1)).toEqual({ entries: [toolEntry("pen"), toolEntry("hand")] });
    expect(names(m.element)).toEqual(["Draw", toolLabel("hand")]);
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    m.done();
  });

  it("+ divider and + menu append structure; the census picker adds tools (top level and inside a menu)", () => {
    const m = mount({ config: { entries: ["pen"] } });
    const topAdd = () => [...m.element.querySelectorAll(".ns-palcfg-add")].at(-1); // the top-level bar is last
    topAdd().querySelector('button[title="insert a divider"]').click();
    expect(m.outlets.tools.value.at(-1)).toEqual({ kind: "divider" });
    topAdd().querySelector('button[title="create an overflow menu (one level)"]').click();
    expect(m.outlets.tools.value.at(-1)).toEqual({ kind: "menu", label: "menu", items: [] });
    // add a tool INSIDE the menu via its own census picker (the nested add bar)
    const nestAdd = m.element.querySelector(".ns-palcfg-nest .ns-palcfg-add");
    nestAdd.querySelector('button[title="add a tool from the registry census"]').click();
    const pick = [...m.element.querySelectorAll(".ns-palcfg-pick")].find((b) => b.textContent.includes("Eraser"));
    expect(pick).toBeTruthy();
    pick.click();
    expect(m.outlets.tools.value.at(-1)).toEqual({ kind: "menu", label: "menu", items: [toolEntry("eraser")] });
    // and a top-level tool through the top-level picker
    topAdd().querySelector('button[title="add a tool from the registry census"]').click();
    [...m.element.querySelectorAll(".ns-palcfg-pick")].find((b) => b.textContent.includes("Select")).click();
    expect(m.outlets.tools.value.at(-1)).toEqual(toolEntry("select"));
    m.done();
  });

  it("renaming a menu writes through", () => {
    const m = mount({ config: { entries: [{ kind: "menu", label: "shapes", items: ["line"] }] } });
    const lab = m.element.querySelector(".ns-palcfg-label");
    lab.value = "extras";
    lab.dispatchEvent(new Event("change", { bubbles: true }));
    expect(m.outlets.tools.value[0].label).toBe("extras");
    expect(m.saved.at(-1).entries[0].label).toBe("extras");
    m.done();
  });

  it("external/remote config edits reconcile in AND re-emit (the wired palette follows)", () => {
    const m = mount({ config: { entries: ["pen"] } });
    m.cfg({ entries: ["hand", "eraser"] });
    expect(m.outlets.tools.value).toEqual([toolEntry("hand"), toolEntry("eraser")]);
    expect(names(m.element)).toEqual([toolLabel("hand"), "Eraser"]);
    m.done();
  });

  it("stops propagation on pointerdown only (the house rule)", () => {
    const m = mount({});
    let sawDown = 0;
    m.element.addEventListener("pointerdown", () => sawDown++);
    m.element.querySelector(".ns-palcfg").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(sawDown).toBe(0);
    m.done();
  });
});
