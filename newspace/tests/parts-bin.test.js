// THE PARTS BIN — pure census (registries in → grouped tiles out), the drag-out
// protocol (encode/decode), click-to-arm, the raw-DOM mount, and a real Canvas
// drop: a namespaced part id travels the toolbar's existing text/x-newspace-tool
// DnD type and lands an instance at the drop point.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";
import {
  PART_DRAG_TYPE, encodePartId, decodePartId, partsCensus, armPart, mountPartsBin,
  mountPartsWindow, PALETTE_PARTS, listPalettes, FLAP_PART,
} from "../src/parts-bin.js";
import { SKETCH_PALETTE } from "../src/palette-node.js";
import { entriesFromIds } from "../src/model.js";
import { palettePlugins } from "../src/registry/palettes.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

describe("drag-out protocol", () => {
  it("namespaces registry parts, keeps tool/shape/stamp ids BARE (toolbar unchanged)", () => {
    expect(encodePartId("datatype", "folder")).toBe("datatype:folder");
    expect(encodePartId("window", "codemirror")).toBe("window:codemirror");
    expect(encodePartId("lens", "uppercase")).toBe("lens:uppercase");
    expect(encodePartId("palette", "full")).toBe("palette:full");
    expect(encodePartId("palette", "sketch")).toBe("palette:sketch");
    expect(encodePartId("tool", "rectangle")).toBe("rectangle");
    expect(encodePartId("stamp", "face")).toBe("face");
  });

  it("the FLAP tile travels namespaced (the identity/customParts protocol is gone)", () => {
    expect(encodePartId("flap", "flap")).toBe(FLAP_PART);
    expect(decodePartId(FLAP_PART)).toEqual({ kind: "flap", id: "flap" });
  });

  it("round-trips, and bare ids decode as tools", () => {
    for (const [kind, id] of [["datatype", "folder"], ["window", "value"], ["lens", "keys"], ["palette", "full"], ["palette", "sketch"], ["flap", "flap"]])
      expect(decodePartId(encodePartId(kind, id))).toEqual({ kind, id });
    expect(decodePartId("rectangle")).toEqual({ kind: "tool", id: "rectangle" });
    expect(decodePartId("face")).toEqual({ kind: "tool", id: "face" });
    // an id that merely CONTAINS a colon but isn't a known namespace stays a tool id
    expect(decodePartId("weird:thing")).toEqual({ kind: "tool", id: "weird:thing" });
  });
});

describe("partsCensus (pure: registries in → grouped tiles out)", () => {
  const windows = [
    { id: "clock", name: "Clock", inlets: [], outlets: [{ name: "time" }] },          // source
    { id: "cm", name: "Codemirror", inlets: [{ name: "content" }], outlets: [{ name: "text" }] }, // editor
  ];
  const lenses = [{ id: "upper", name: "UPPERCASE", lens: true }];
  const datatypes = [{ id: "folder", name: "Folder" }, { id: "essay", name: "Essay" }];
  const stamps = { face: { view: "0 0 64 52", paths: ["M0 0"] } };

  it("groups shapes · stamps · new docs · sources · editors · lenses, with encoded part ids", () => {
    const groups = partsCensus({ datatypes, windows, lenses, stamps, shapes: ["rectangle", "ellipse"] });
    expect(groups.map((g) => g.id)).toEqual(["shapes", "stamps", "docs", "sources", "editors", "lenses"]);
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    expect(byId.shapes.tiles.map((t) => t.part)).toEqual(["rectangle", "ellipse"]);
    expect(byId.stamps.tiles[0]).toMatchObject({ part: "face", kind: "stamp", stamp: stamps.face });
    expect(byId.docs.tiles.map((t) => t.part)).toEqual(["datatype:essay", "datatype:folder"]); // sorted by name
    expect(byId.sources.tiles).toEqual([expect.objectContaining({ part: "window:clock", mark: "●" })]);
    expect(byId.editors.tiles).toEqual([expect.objectContaining({ part: "window:cm", mark: "⚡" })]);
    expect(byId.lenses.tiles).toEqual([expect.objectContaining({ part: "lens:upper", mark: "◇" })]);
  });

  it("a `palettes` group leads the census: the preconfigured palette PARTS", () => {
    const groups = partsCensus({ windows, palettes: PALETTE_PARTS });
    expect(groups.map((g) => g.id)).toEqual(["palettes", "sources", "editors"]);
    expect(groups[0].tiles.map((t) => t.part)).toEqual(["palette:full", "palette:sketch"]);
    expect(groups[0].tiles.every((t) => t.kind === "palette")).toBe(true);
  });

  it("empty registries → no empty groups (and NO brushes group, by design: placing a brush only arms it)", () => {
    expect(partsCensus({})).toEqual([]);
    const groups = partsCensus({ windows });
    expect(groups.map((g) => g.id)).toEqual(["sources", "editors"]);
    expect(groups.some((g) => g.id === "brushes")).toBe(false);
  });

  it("flap: true adds the containers group with the one flap tile (the bin mounts pass it)", () => {
    const groups = partsCensus({ windows, flap: true });
    expect(groups.map((g) => g.id)).toEqual(["flaps", "sources", "editors"]);
    expect(groups[0].tiles).toEqual([expect.objectContaining({ part: FLAP_PART, kind: "flap", name: "flap" })]);
  });
});

describe("armPart — a click arms the same place flow the + menu uses", () => {
  function host() {
    const calls = [];
    return {
      calls,
      datatypes: () => [{ id: "folder", name: "Folder" }],
      editors: () => [{ id: "cm", name: "Codemirror" }],
      lenses: () => [{ id: "upper", name: "UPPERCASE" }],
      selectPlacing: (d) => calls.push(["doc", d.id]),
      placeEditor: (d) => calls.push(["editor", d.id]),
      placeLens: (d) => calls.push(["lens", d.id]),
      placeFlap: () => calls.push(["flap"]),
      setTool: (t) => calls.push(["tool", t]),
    };
  }
  it("routes each kind, skips stamps", () => {
    const h = host();
    expect(armPart({ kind: "datatype", id: "folder" }, h)).toBe(true);
    expect(armPart({ kind: "window", id: "cm" }, h)).toBe(true);
    expect(armPart({ kind: "lens", id: "upper" }, h)).toBe(true);
    expect(armPart({ kind: "flap", id: "flap" }, h)).toBe(true); // the draw-a-flap place flow
    expect(armPart({ kind: "tool", id: "rectangle" }, h)).toBe(true);
    expect(armPart({ kind: "stamp", id: "face" }, h)).toBe(false); // drag-only
    expect(armPart({ kind: "palette", id: "full" }, h)).toBe(false); // drag-only (an instance to land)
    expect(h.calls).toEqual([["doc", "folder"], ["editor", "cm"], ["lens", "upper"], ["flap"], ["tool", "rectangle"]]);
  });
});

describe("mountPartsBin (raw DOM)", () => {
  it("renders grouped, draggable tiles carrying their part ids", () => {
    const element = document.createElement("div");
    const cleanup = mountPartsBin({
      element,
      host: {
        datatypes: () => [{ id: "folder", name: "Folder" }],
        editors: () => [{ id: "value", name: "Raw value", inlets: [], outlets: [{ name: "value" }] }],
        lenses: () => [],
      },
    });
    const tiles = [...element.querySelectorAll(".ns-part")];
    expect(tiles.length).toBeGreaterThan(4); // shapes + stamps + the doc + the source
    const parts = tiles.map((t) => t.dataset.part);
    expect(parts).toContain("datatype:folder");
    expect(parts).toContain("window:value");
    expect(parts).toContain("rectangle");
    expect(parts).toContain("face");
    expect(tiles.every((t) => t.draggable)).toBe(true);
    // stamps draw their real strokes as the tile icon
    const face = tiles.find((t) => t.dataset.part === "face");
    expect(face.querySelectorAll("svg path").length).toBeGreaterThan(1);
    // section labels use the house separator style
    expect([...element.querySelectorAll(".ns-menu-sep")].map((s) => s.textContent)).toContain("new docs");
    cleanup();
    expect(element.querySelector(".ns-partsbin")).toBeFalsy();
  });
});

describe("mountPartsWindow (the bin as a bare sketchy:window)", () => {
  it("reads the registries itself, includes the palettes group + the flap tile, and arms tools via the context", () => {
    const element = document.createElement("div");
    let armed = null;
    const cleanup = mountPartsWindow({ element, context: { tool: { set: (id) => { armed = id; } } } });
    expect(element.querySelector(".ns-parts-window")).toBeTruthy();
    const parts = [...element.querySelectorAll(".ns-part")].map((t) => t.dataset.part);
    expect(parts).toContain("palette:full");
    expect(parts).toContain("palette:sketch");
    expect(parts).toContain("rectangle");
    expect(parts).toContain(FLAP_PART); // the flap creation affordance
    expect([...element.querySelectorAll(".ns-menu-sep")].map((x) => x.textContent)).toContain("palettes");
    expect([...element.querySelectorAll(".ns-menu-sep")].map((x) => x.textContent)).toContain("containers");
    // clicking a SHAPE tile arms its tool through the context Source
    element.querySelector('.ns-part[data-part="rectangle"]').click();
    expect(armed).toBe("rectangle");
    cleanup();
    expect(element.querySelector(".ns-parts-window")).toBeFalsy();
  });

  it("has NO drop-to-save protocol any more — every drop bubbles to the canvas (saving = drop into the flap)", () => {
    const element = document.createElement("div");
    const cleanup = mountPartsWindow({ element, context: {} });
    const root = element.querySelector(".ns-parts-window");
    const drop = (payload) => {
      const e = new Event("drop", { bubbles: true, cancelable: true });
      e.dataTransfer = { types: [PART_DRAG_TYPE], getData: (t) => (t === PART_DRAG_TYPE ? payload : "") };
      root.dispatchEvent(e);
      return e;
    };
    expect(drop("palette:full").defaultPrevented).toBe(false);
    expect(drop("rectangle").defaultPrevented).toBe(false);
    expect(drop("window:codemirror").defaultPrevented).toBe(false);
    cleanup();
    element.remove();
  });
});

describe("sketchy:palette — palettes as plugins", () => {
  it("full/sketch are registrations of the type (entries array or drop-time function)", () => {
    expect(palettePlugins.map((p) => p.id)).toEqual(["full", "sketch"]);
    for (const p of palettePlugins) expect(p.type).toBe("sketchy:palette");
    const sketch = palettePlugins.find((p) => p.id === "sketch");
    expect(sketch.entries).toEqual(entriesFromIds(SKETCH_PALETTE));
    const full = palettePlugins.find((p) => p.id === "full");
    expect(typeof full.entries).toBe("function"); // censused at drop time
    expect(full.entries().map((e) => e.id)).toContain("wire");
  });
  it("listPalettes falls back to the built-ins when nothing is registered", () => {
    expect(listPalettes()).toEqual(PALETTE_PARTS);
  });
  it("registered palettes drive the census's palettes group", () => {
    const groups = partsCensus({ palettes: [{ id: "mine", name: "my palette" }] });
    expect(groups[0].id).toBe("palettes");
    expect(groups[0].tiles[0].part).toBe("palette:mine");
    expect(groups[0].tiles[0].name).toBe("my palette");
  });
});

describe("drag a part OUT onto the canvas → an instance lands at the drop point", () => {
  const mounted = [];
  async function mountCanvas(items = []) {
    const repo = new Repo({});
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
    const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
    const element = document.createElement("div");
    document.body.append(element);
    const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
    mounted.push({ element, dispose });
    await flush();
    return { repo, layout, folder, element };
  }
  afterEach(() => {
    for (const m of mounted.splice(0)) {
      try { m.dispose(); } catch {}
      try { m.element.remove(); } catch {}
    }
  });

  // a minimal dataTransfer stand-in (happy-dom's DragEvent plumbing is spotty)
  function dropEvent(payload) {
    const store = { [PART_DRAG_TYPE]: payload };
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    ev.dataTransfer = {
      types: Object.keys(store),
      getData: (t) => store[t] || "",
      setData: (t, v) => { store[t] = v; },
      files: [],
      dropEffect: "copy", effectAllowed: "copy",
    };
    ev.clientX = 120; ev.clientY = 90;
    return ev;
  }

  it("window:value lands a raw-value node via the same placeNode path as the palette", async () => {
    const { mountRawValue } = await import("../src/source-nodes.js");
    registerPlugins([{
      type: "sketchy:window", id: "value", name: "Raw value",
      inlets: [], outlets: [{ name: "value", type: "json" }],
      load: async () => mountRawValue,
    }]);
    const { element, layout } = await mountCanvas();
    element.querySelector(".ns-root").dispatchEvent(dropEvent("window:value"));
    await flush(30);
    const items = layout.doc().items || [];
    expect(items.some((x) => x.kind === "editor" && x.editorId === "value")).toBe(true);
  });

  it("palette:sketch lands a preconfigured PALETTE window at the drop point", async () => {
    const { element, layout } = await mountCanvas();
    element.querySelector(".ns-root").dispatchEvent(dropEvent("palette:sketch"));
    await flush(30);
    const pal = (layout.doc().items || []).find((x) => x.kind === "editor" && x.editorId === "palette");
    expect(pal).toBeTruthy();
    // writes are entries-only — the legacy `config.brushes` id list is a read-shim, never written
    expect(pal.config.brushes).toBeUndefined();
    expect(JSON.parse(JSON.stringify(pal.config.entries))).toEqual(entriesFromIds(SKETCH_PALETTE));
  });

  it("palette:full lands a palette carrying EVERY registered tool/brush", async () => {
    const { element, layout } = await mountCanvas();
    element.querySelector(".ns-root").dispatchEvent(dropEvent("palette:full"));
    await flush(30);
    const pal = (layout.doc().items || []).find((x) => x.kind === "editor" && x.editorId === "palette");
    expect(pal).toBeTruthy();
    const ids = JSON.parse(JSON.stringify(pal.config.entries)).map((e) => e.id);
    for (const id of SKETCH_PALETTE) expect(ids).toContain(id); // the full set supersets the sketching one
    expect(ids).toContain("wire");
  });

  it("flap:flap lands a fresh FLAP — a `flap: true` frame with a chrome-free sub-space", async () => {
    const { repo, element, layout } = await mountCanvas();
    element.querySelector(".ns-root").dispatchEvent(dropEvent("flap:flap"));
    await flush(60); // createFlapAt makes the flap's folder + layout docs first
    // (skip ns-parts — the canvas seeds the PARTS flap on open; this is the dropped one)
    const flap = (layout.doc().items || []).find((x) => x.kind === "frame" && x.flap === true && x.id !== "ns-parts");
    expect(flap).toBeTruthy();
    expect(flap.url).toMatch(/^automerge:/);
    // the flap's sub-space dismisses every seed: a shelf, not a full sketch space
    const folder = await repo.find(flap.url);
    expect(folder.doc().title).toBe("flap");
    const sub = await repo.find(folder.doc().sketch);
    expect(JSON.parse(JSON.stringify(sub.doc().items))).toEqual([]);
    expect(sub.doc().dismissedSeeds.length).toBeGreaterThan(0);
  });

  it("a BARE shape id still drops a drawn shape (the toolbar protocol is unchanged)", async () => {
    const { element, layout } = await mountCanvas();
    element.querySelector(".ns-root").dispatchEvent(dropEvent("rectangle"));
    await flush(30);
    const items = layout.doc().items || [];
    expect(items.some((x) => x.kind === "shape" && x.type === "rectangle")).toBe(true);
  });
});
