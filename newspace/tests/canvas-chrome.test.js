// Mounts the REAL Canvas (happy-dom + a real in-memory repo) and pins the
// chrome ↔ context contract: chrome parts read their STATE from the canvas
// context Sources (host.context) — not mirrored props — and the slot mechanism
// hands a custom part the same host the built-ins get.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";
import { plugin as palettePlugin } from "../src/palette-node.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps the pointer-up drop path needs
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const mounted = [];
async function mountCanvas(opts = {}, items = []) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush();
  return m;
}
function dropEvent(store, x = 120, y = 90) {
  const ev = new Event("drop", { bubbles: true, cancelable: true });
  ev.dataTransfer = {
    types: Object.keys(store),
    getData: (t) => store[t] || "",
    setData: (t, v) => { store[t] = v; },
    files: [],
    dropEffect: "copy", effectAllowed: "copyMove",
  };
  ev.clientX = x; ev.clientY = y;
  return ev;
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

describe("canvas chrome reads the context", () => {
  it("accepts a sidebar doc drop whose patchwork-urls payload is a bare URL", async () => {
    const { repo, element, layout, folder } = await mountCanvas();
    const child = repo.create({ "@patchwork": { type: "file" }, name: "dropped.txt" });
    element.querySelector(".ns-root").dispatchEvent(dropEvent({ "text/x-patchwork-urls": child.url }));
    await flush(40);
    const item = layout.doc().items.find((x) => x.url === child.url);
    expect(item).toMatchObject({ kind: "doc", url: child.url });
    expect(item.parent).toBeUndefined();
    expect(folder.doc().docs.some((l) => l.url === child.url)).toBe(true);
  });

  it("parks externally-added folder docs in set-aside", async () => {
    const { repo, layout, folder } = await mountCanvas();
    const child = repo.create({ "@patchwork": { type: "file" }, name: "external.txt" });
    folder.change((d) => { d.docs.push({ name: "external.txt", type: "file", url: child.url }); });
    await flush(80);
    expect(layout.doc().items.find((x) => x.url === child.url)).toMatchObject({ kind: "doc", parent: "ns-aside" });
  });

  it("unparks an existing set-aside doc when that sidebar doc is dropped on the canvas", async () => {
    const { repo, element, layout, folder } = await mountCanvas();
    const child = repo.create({ "@patchwork": { type: "file" }, name: "aside.txt" });
    folder.change((d) => { d.docs.push({ name: "aside.txt", type: "file", url: child.url }); });
    await flush(80);
    expect(layout.doc().items.find((x) => x.url === child.url).parent).toBe("ns-aside");
    element.querySelector(".ns-root").dispatchEvent(dropEvent({ "text/x-patchwork-dnd": JSON.stringify({ items: [{ name: "aside.txt", type: "file", url: child.url }] }) }, 160, 130));
    await flush(40);
    const item = layout.doc().items.find((x) => x.url === child.url);
    expect(item.parent).toBeUndefined();
    expect(item.x).toBe(160);
    expect(item.y).toBe(130);
  });

  it("mounts the presence layer; the fixed toolbar + corner tray + views eyeball are gone", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-presence")).toBeTruthy();
    // the toolbar is the seeded "ns-toolbar-palette" window item now — never fixed chrome
    expect(element.querySelector(".ns-toolbar")).toBeFalsy();
    // the corner tray (and its inspect eyeball) went with it
    expect(element.querySelector(".ns-layout-cust")).toBeFalsy();
    expect(element.querySelector(".ns-inspect-btn")).toBeFalsy();
    // and the last fixed eyeball too: the presence BAR/controls are the seeded
    // `presence` bare window (presence-node.js) — no fixed .ns-views button
    expect(element.querySelectorAll(".ns-views").length).toBe(0);
  });

  it("exposes writable presence controls on the context (the presence window's surface)", async () => {
    let ctx = null;
    await mountCanvas({ slots: { presence: (host) => { ctx = host.context; return document.createElement("div"); } } });
    expect(ctx).toBeTruthy();
    expect(typeof ctx.showViews?.connect).toBe("function");
    expect(ctx.showViews.value).toBe(false);
    ctx.showViews.apply({ type: "snapshot", value: true });
    await flush(5);
    expect(ctx.showViews.value).toBe(true);
    expect(typeof ctx.following?.apply).toBe("function");
    ctx.following.apply({ type: "snapshot", value: "automerge:someone" });
    await flush(5);
    expect(ctx.following.value).toBe("automerge:someone");
    expect(typeof ctx.serviceUrl).toBe("function");
  });

  it("a PALETTE window click drives the context tool, which drives the chrome back", async () => {
    registerPlugins([palettePlugin]);
    const { element } = await mountCanvas({}, [
      { id: "pal", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], x: 10, y: 10, w: 300, h: 44, inlets: {}, config: { brushes: ["select", "pen"] } },
    ]);
    await flush(40); // the palette node mounts async
    const pen = element.querySelector('.ns-palette [data-tool="pen"]');
    expect(pen).toBeTruthy();
    expect(pen.classList.contains("active")).toBe(false);
    expect(element.querySelector(".ns-props")).toBeFalsy();
    pen.click();
    await flush(10);
    // the active state comes back through the CONTEXT tool Source
    expect(pen.classList.contains("active")).toBe(true);
    // and the properties panel appears for the stroke mode (context-driven chrome)
    expect(element.querySelector(".ns-props")).toBeTruthy();
  });

  it("the SEEDED WIRED PAIR: palette-config's tools outlet drives the palette's entries live", async () => {
    const { plugin: paletteConfigPlugin } = await import("../src/palette-config-node.js");
    registerPlugins([palettePlugin, paletteConfigPlugin]);
    const { PALETTE_INLETS } = await import("../src/brush/constants.js");
    const { element, layout } = await mountCanvas({}, [
      // the seeded pair, as constants.js ships it (positions simplified)
      { id: "ns-toolbar-config", kind: "editor", editorId: "palette-config", layer: "overlay", layers: ["overlay"], x: 0, y: 0, w: 236, h: 320, rotation: 0, inlets: {}, config: { entries: ["pen", { kind: "divider" }, { kind: "menu", label: "shapes", items: ["line"] }] } },
      { id: "ns-toolbar-palette", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], x: 0, y: 400, w: 356, h: 44, rotation: 0, inlets: { ...PALETTE_INLETS }, config: { brushes: ["select"] } },
    ]);
    await flush(60); // both nodes mount async; the outlet registers, the proxy re-backs
    // the WIRE won: entries (divider + menu) render, not config.brushes' plain "select"
    const pal = element.querySelector(".ns-palette");
    expect(pal).toBeTruthy();
    expect(pal.querySelector('[data-tool="pen"]')).toBeTruthy();
    expect(pal.querySelector('[data-tool="select"]')).toBeFalsy();
    expect(pal.querySelectorAll(".ns-palette-row .ns-sep").length).toBe(1);
    expect(pal.querySelector(".ns-palette-menu-btn")).toBeTruthy();
    // an EDIT in the config window flows down the wire: remove the first row ("pen")
    const cfgWin = element.querySelector(".ns-palcfg");
    expect(cfgWin).toBeTruthy();
    cfgWin.querySelector('.ns-palcfg-row button[title="remove"]').click();
    await flush(20);
    expect(pal.querySelector('[data-tool="pen"]')).toBeFalsy();
    // …and it persisted on the config node's item
    const cfgItem = layout.doc().items.find((x) => x.id === "ns-toolbar-config");
    expect(JSON.parse(JSON.stringify(cfgItem.config.entries))[0]).toEqual({ kind: "divider" });
  });

  it("the seeded PRESENCE window mounts (user icon, frameless) and its toggle drives the canvas's showViews", async () => {
    const { plugin: presencePlugin } = await import("../src/presence-node.js");
    registerPlugins([presencePlugin]);
    let ctx = null;
    const { element } = await mountCanvas(
      { slots: { presence: (host) => { ctx = host.context; return document.createElement("div"); } } },
      [{ id: "ns-presence", kind: "editor", editorId: "presence", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "right", t: 0.9 }, x: 0, y: 0, w: 148, h: 34, rotation: 0, inlets: {} }],
    );
    await flush(60);
    const bar = element.querySelector(".ns-presence-bar");
    expect(bar).toBeTruthy();
    expect(element.querySelector('[data-item-id="ns-presence"]').classList.contains("ns-bare")).toBe(true); // frameless
    const btn = bar.querySelector(".ns-presence-btn");
    expect(btn.title.length).toBeGreaterThan(0); // tooltip
    btn.click();
    // the flyout portals to the canvas root (it escapes the bare window's clipped body)
    const items = [...element.querySelectorAll(".ns-root > .ns-presence-menu .ns-presence-item")];
    expect(items.length).toBeGreaterThan(0);
    items[0].click(); // "show everyone's views"
    await flush(10);
    expect(ctx.showViews.value).toBe(true); // wrote through the context Source
  });

  it("the layer switcher is NOT fixed chrome any more (no strip child of .ns-root; it's the seeded ns-layers window)", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-root > .ns-layers")).toBeFalsy();
  });

  it("` toggles op-debug AND the perf overlay (perf.js startOverlay, finally mounted)", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-perf")).toBeFalsy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", bubbles: true }));
    await flush(10);
    expect(element.querySelector(".ns-debug-badge")).toBeTruthy(); // the ops badge, as before
    expect(element.querySelector(".ns-root > .ns-perf")).toBeTruthy(); // the frame/counter readout, new
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", bubbles: true }));
    await flush(10);
    expect(element.querySelector(".ns-debug-badge")).toBeFalsy();
    expect(element.querySelector(".ns-perf")).toBeFalsy(); // torn down with the toggle
  });

  it("the LIVE WIRE DRAFT stacks with the active layer: above the frost on the overlay (it drew under the glass, reading as the canvas layer)", async () => {
    const { snapshot } = await import("../src/ops.js");
    let ctx = null;
    const { element } = await mountCanvas({ slots: { presence: (host) => { ctx = host.context; return document.createElement("div"); } } });
    const root = element.querySelector(".ns-root");
    const draftAt = () => element.querySelector(".ns-wire-overlay");
    const drag = () => {
      root.dispatchEvent(new CustomEvent("sketchy:wire-from", { detail: { clientX: 10, clientY: 10 }, bubbles: true, composed: true }));
    };
    // base layer active: the draft sits with the persistent wires (z 5)
    drag();
    expect(draftAt()).toBeTruthy();
    expect(draftAt().style.zIndex).toBe("5");
    root.dispatchEvent(new CustomEvent("sketchy:wire-drop", { detail: {}, bubbles: true, composed: true }));
    expect(draftAt()).toBeFalsy();
    // overlay active (frosting): the draft lifts above the frost like committed wires
    ctx.activeLayer.apply(snapshot("overlay"));
    await flush(10);
    expect(root.classList.contains("ns-frosted")).toBe(true);
    drag();
    expect(draftAt().style.zIndex).toBe("24");
    root.dispatchEvent(new CustomEvent("sketchy:wire-drop", { detail: {}, bubbles: true, composed: true }));
  });

  it("the context exposes layers (read) + activeLayer (write) — the layers window's surface", async () => {
    const { snapshot } = await import("../src/ops.js");
    let ctx = null;
    const { element } = await mountCanvas({ slots: { presence: (host) => { ctx = host.context; return document.createElement("div"); } } });
    expect(JSON.parse(JSON.stringify(ctx.layers.value))).toEqual([
      { id: "canvas", name: "Canvas", kind: "canvas" },
      { id: "overlay", name: "Overlay", kind: "overlay" },
    ]);
    expect(ctx.activeLayer.value).toBe("canvas"); // the base (first) layer — derived, not hardcoded
    ctx.activeLayer.apply(snapshot("overlay"));
    await flush(10);
    expect(ctx.activeLayer.value).toBe("overlay");
    expect(element.querySelector(".ns-root").classList.contains("ns-frosted")).toBe(true);
  });

  it("a palette docked to a LEFT edge mounts vertical (onSticky threads the item's sticky through the mount contract)", async () => {
    registerPlugins([palettePlugin]);
    const { element } = await mountCanvas({}, [
      { id: "pal", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "left", t: 0.5 }, x: 0, y: 0, w: 44, h: 300, inlets: {}, config: { brushes: ["select", "pen"] } },
    ]);
    await flush(40);
    const pal = element.querySelector(".ns-palette");
    expect(pal).toBeTruthy();
    expect(pal.classList.contains("ns-palette-vert")).toBe(true);
  });

  it("an UNWIRED bare minimap auto-feeds from the AMBIENT canvas outlets (no seeded chips needed)", async () => {
    const { plugin: minimapPlugin } = await import("../src/minimap-node.js");
    registerPlugins([minimapPlugin]);
    const { element } = await mountCanvas({}, [
      { id: "mm", kind: "editor", editorId: "minimap", layer: "overlay", layers: ["overlay"], x: 10, y: 10, w: 180, h: 130, inlets: {} },
      { id: "s1", kind: "shape", type: "rectangle", x: 40, y: 40, w: 60, h: 40, color: "line", strokeWidth: 2, rotation: 0 },
    ]);
    await flush(60);
    const dbg = element.querySelector(".ns-mm-dbg");
    expect(dbg).toBeTruthy();
    // "wire" = the inlet proxies are BACKED (the ambient auto plan), and a
    // non-zero rect count shows real canvas data arrived (items + seeded flap)
    expect(dbg.textContent).toMatch(/^wire [1-9]\d*▢/);
  });

  it("keyboard tool shortcuts work with NO toolbar/palette mounted at all", async () => {
    const { element } = await mountCanvas();
    expect(element.querySelector(".ns-toolbar")).toBeFalsy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    await flush(10);
    // the pen arms → the properties panel shows the stroke mode
    expect(element.querySelector(".ns-props")).toBeTruthy();
    expect(element.querySelector(".ns-root").className).toContain("ns-cur-cross");
  });

  it("a SLOT replaces a chrome part and receives the host with `context`", async () => {
    let got = null;
    const { element } = await mountCanvas({
      slots: {
        presence: (host) => {
          got = host;
          const el = document.createElement("div");
          el.className = "my-presence";
          return el;
        },
      },
    });
    expect(element.querySelector(".my-presence")).toBeTruthy();
    expect(element.querySelector(".ns-presence")).toBeFalsy(); // replaced, not doubled
    // the slot's host reads the SAME context the built-ins read…
    expect(got).toBeTruthy();
    expect(got.context).toBeTruthy();
    expect(typeof got.context.tool?.connect).toBe("function");
    expect(got.context.tool.value).toBe("select");
    // …plus the command surface
    expect(typeof got.setTool).toBe("function");
    got.setTool("pen");
    await flush(5);
    expect(got.context.tool.value).toBe("pen");
  });

  it("chrome parts gate on opts (presence off)", async () => {
    const { element } = await mountCanvas({ presence: false });
    expect(element.querySelector(".ns-presence")).toBeFalsy();
  });
});

describe("properties popup — inline raw-value inlets + param-inlet-wins-when-wired", () => {
  async function mountGraph() {
    // the REAL raw-value + delay nodes (as index.jsx registers them)
    const { mountRawValue } = await import("../src/source-nodes.js");
    const { plugin: delayPlugin } = await import("../src/delay-node.js");
    registerPlugins([
      { type: "sketchy:surface", id: "value", name: "Raw value", inlets: [], outlets: [{ name: "value", type: "json" }], load: async () => mountRawValue },
      delayPlugin,
    ]);
    // a raw value (number 5) feeding BOTH the delay's `in` inlet AND its `ms` PARAM
    const m = await mountCanvas({}, [
      { id: "rv1", kind: "editor", editorId: "value", x: 0, y: 0, w: 200, h: 80, inlets: {}, config: { raw: "5", kind: "number" } },
      { id: "dl1", kind: "editor", editorId: "delay", x: 300, y: 0, w: 200, h: 80, inlets: { in: { node: "rv1", outlet: "value" }, ms: { node: "rv1", outlet: "value" } } },
    ]);
    await flush(40); // let both nodes mount + register their outlets
    return m;
  }

  it("shows the wired param disabled (⚡, live value) and the raw inlet editable inline", async () => {
    const { element, layout } = await mountGraph();
    // select the delay node the way a user does — a pointer press on its chrome
    const dl = element.querySelector('.ns-editor[data-item-id="dl1"]');
    expect(dl).toBeTruthy();
    dl.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(10);
    const props = element.querySelector(".ns-props");
    expect(props).toBeTruthy();
    // the ms PARAM is wired ⇒ its slider is disabled + flagged; it shows the WIRED value
    expect(props.querySelector(".ns-wired-flag")).toBeTruthy();
    const slider = props.querySelector('input[type="range"]');
    expect(slider).toBeTruthy();
    expect(slider.disabled).toBe(true);
    expect(Number(slider.value)).toBe(5); // the raw node's live value, not the config default
    // the `in` inlet is wired to a raw value ⇒ an inline editor appears
    const flag = props.querySelector(".ns-raw-flag");
    expect(flag).toBeTruthy();
    const raw = props.querySelector('input[type="number"]');
    expect(raw).toBeTruthy();
    expect(Number(raw.value)).toBe(5);
    // editing inline writes THROUGH the raw node's stream — its own input follows
    raw.value = "9";
    raw.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(10);
    const rvInput = element.querySelector('.ns-editor[data-item-id="rv1"] .ns-rawvalue input');
    expect(rvInput).toBeTruthy();
    expect(rvInput.value).toBe("9");
    // and the WIRED PARAM mirrors into config (the runtime half: the wire wins)
    await flush(10);
    expect(layout.doc().items.find((x) => x.id === "dl1").config.ms).toBe(9);
  });

  it("ports render rough.js nubs (the hit divs stay; the drawing is svg)", async () => {
    const { element } = await mountGraph();
    // ports show while the wire tool is armed (keyboard shortcut)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await flush(10);
    const port = element.querySelector('.ns-editor[data-item-id="dl1"] .ns-node-port.ns-node-inlet');
    expect(port).toBeTruthy();
    // the hit host keeps its data attrs (wire grabs unchanged) …
    expect(port.getAttribute("data-sketchy-inlet")).toBe("in");
    // … and the visible nub is a rough svg drawing, not a CSS shape
    const nub = port.querySelector("svg.ns-nub");
    expect(nub).toBeTruthy();
    expect(nub.querySelectorAll("path").length).toBeGreaterThan(0);
    // deterministic: two renders of the same port draw the same scribble
    const d1 = [...nub.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    const outlet = element.querySelector('.ns-editor[data-item-id="rv1"] .ns-node-port.ns-node-outlet svg.ns-nub');
    expect(outlet).toBeTruthy();
    const d2 = [...outlet.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    expect(d1).not.toBe(d2); // different ports, different (but each stable) scribbles
  });
});

describe("port schema popover — shows the ACTUAL shape (describeSchema)", () => {
  it("a structured inlet's popover renders its field structure, not a vague label", async () => {
    const { objectSchema, stringSchema, numberSchema } = await import("../src/ops.js");
    registerPlugins([{
      type: "sketchy:surface", id: "shapely", name: "Shapely",
      inlets: [{ name: "in", type: "json", schema: objectSchema({ name: stringSchema(), count: numberSchema() }, ["count"]), required: true }],
      outlets: [],
      load: async () => ({ element }) => { element.textContent = "shapely"; return () => {}; },
    }]);
    const { element } = await mountCanvas({}, [
      { id: "sh1", kind: "editor", editorId: "shapely", x: 0, y: 0, w: 200, h: 100, inlets: {} },
    ]);
    await flush(30);
    // arm the wire tool so the ports show, then CLICK the inlet port
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    await flush(10);
    const port = element.querySelector('.ns-editor[data-item-id="sh1"] .ns-node-port.ns-node-inlet');
    expect(port).toBeTruthy();
    port.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true, button: 0 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(10);
    const info = element.querySelector(".ns-portinfo");
    expect(info).toBeTruthy();
    expect(info.textContent).toContain("Shapely ◂ in");
    // the real shape, not "(specific shape)"
    expect(info.textContent).toContain("accepts: { name: string, count?: number }");
    expect(info.textContent).not.toContain("(specific shape)");
    expect(info.textContent).toContain("required");
  });
});
