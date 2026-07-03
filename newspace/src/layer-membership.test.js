// Layer MEMBERSHIP — the model rules (model.js itemLayers/itemHomeLayer). An
// item's `layers[0]` is the HOME space (owns coordinates); further entries are
// pure memberships. Reading is back-compat and additive: `layers` wins →
// legacy `layer` → "canvas". Memberships drive VISIBILITY for the active tab
// (itemVisibleForActive): home at/below the active layer shows (frosted
// beneath), above it hides (display:none) unless a membership includes the
// active layer. Plus the mounted behaviour (render once, in the home
// container; hidden vs member-visible items; the Properties "appears on" row)
// and the cross-layer SELECTION rules (selection stays within the active
// layer; selection geometry projects through the item's HOME layer).
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { itemLayers, itemHomeLayer, itemVisibleOn, itemVisibleForActive } from "./model.js";
import { itemLayer } from "./layers.js";
import { Canvas } from "./brush/canvas.jsx";
import { plugin as palettePlugin } from "./palette-node.js";
import { plugin as minimapPlugin } from "./minimap-node.js";

describe("itemLayers — the back-compat read matrix", () => {
  it("`layers` wins over a legacy `layer` tag", () => {
    expect(itemLayers({ layers: ["overlay", "canvas"], layer: "canvas" })).toEqual(["overlay", "canvas"]);
  });
  it("a legacy `layer: x` reads as [x]", () => {
    expect(itemLayers({ layer: "overlay" })).toEqual(["overlay"]);
  });
  it("absent → the base canvas layer", () => {
    expect(itemLayers({})).toEqual(["canvas"]);
    expect(itemLayers(null)).toEqual(["canvas"]);
  });
  it("an empty/garbage `layers` array falls back to the legacy read (additive, never throws)", () => {
    expect(itemLayers({ layers: [], layer: "overlay" })).toEqual(["overlay"]);
    expect(itemLayers({ layers: [null, ""], layer: "overlay" })).toEqual(["overlay"]);
  });
  it("an entry may later grow into { id, x, y } (per-mode placement) — object entries normalize to their id", () => {
    expect(itemLayers({ layers: [{ id: "canvas", x: 5, y: 9 }, "overlay"] })).toEqual(["canvas", "overlay"]);
  });
});

describe("itemHomeLayer / the itemLayer alias", () => {
  it("home is the FIRST entry — it owns coordinates + transform", () => {
    expect(itemHomeLayer({ layers: ["overlay", "canvas"] })).toBe("overlay");
    expect(itemHomeLayer({ layer: "overlay" })).toBe("overlay");
    expect(itemHomeLayer({})).toBe("canvas");
  });
  it("itemLayer (the existing space-math callers' import) IS the home alias", () => {
    expect(itemLayer).toBe(itemHomeLayer);
    expect(itemLayer({ layers: ["overlay", "canvas"] })).toBe("overlay");
  });
});

describe("itemVisibleOn — shown iff ANY member layer is visible", () => {
  const vis = (visible) => (id) => visible.includes(id);
  it("a member of a visible layer shows, even when its home is hidden", () => {
    const it = { layers: ["overlay", "canvas"] };
    expect(itemVisibleOn(it, vis(["canvas"]))).toBe(true);
    expect(itemVisibleOn(it, vis(["overlay"]))).toBe(true);
    expect(itemVisibleOn(it, vis([]))).toBe(false);
  });
  it("legacy/untagged items resolve through the same read", () => {
    expect(itemVisibleOn({ layer: "overlay" }, vis(["canvas"]))).toBe(false);
    expect(itemVisibleOn({}, vis(["canvas"]))).toBe(true);
  });
});

describe("itemVisibleForActive — membership drives what the active tab shows", () => {
  const STACK = ["canvas", "overlay"];
  it("home at/below the active layer ⇒ visible (lower layers render frosted beneath)", () => {
    expect(itemVisibleForActive({}, STACK, "canvas")).toBe(true); // canvas home, canvas tab
    expect(itemVisibleForActive({}, STACK, "overlay")).toBe(true); // canvas home under the active overlay
    expect(itemVisibleForActive({ layer: "overlay" }, STACK, "overlay")).toBe(true); // home == active
  });
  it("home ABOVE the active layer ⇒ hidden unless a membership includes the active layer", () => {
    expect(itemVisibleForActive({ layer: "overlay" }, STACK, "canvas")).toBe(false); // overlay-only, canvas tab
    expect(itemVisibleForActive({ layers: ["overlay", "canvas"] }, STACK, "canvas")).toBe(true); // canvas membership
  });
  it("unknown home/active layers never hide anything (additive)", () => {
    expect(itemVisibleForActive({ layer: "mystery" }, STACK, "canvas")).toBe(true);
    expect(itemVisibleForActive({}, STACK, "mystery")).toBe(true);
  });
});

// ── mounted: the real Canvas in happy-dom ────────────────────────────────────

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const ITEMS = () => [
  { id: "s1", kind: "shape", type: "rectangle", x: 400, y: 400, w: 60, h: 40, color: "line", strokeWidth: 2, rotation: 0 }, // canvas home (untagged legacy)
  { id: "ov", kind: "shape", type: "rectangle", layer: "overlay", x: 10, y: 10, w: 40, h: 30, color: "line", strokeWidth: 2, rotation: 0 }, // overlay-home (legacy tag)
  { id: "both", kind: "shape", type: "rectangle", layers: ["canvas", "overlay"], x: 200, y: 200, w: 40, h: 30, color: "line", strokeWidth: 2, rotation: 0 }, // canvas home + overlay member
];

const mounted = [];
async function mountCanvas(items = ITEMS(), camera = null) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  if (camera) localStorage.setItem(`sketchy:camera:${folder.url}`, JSON.stringify(camera));
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

const el = (root, id) => root.querySelector(`[data-item-id="${id}"]`);
const tab = (root, name) => [...root.querySelectorAll(".ns-layer-tab")].find((t) => t.textContent === name);
const clickItem = (root, id) => {
  el(root, id).querySelector(".ns-hit").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
  window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
};

describe("membership, mounted — visibility follows the ACTIVE layer", () => {
  it("canvas tab: overlay-home items are HIDDEN (display:none, DOM kept) unless they carry a canvas membership", async () => {
    const { element } = await mountCanvas();
    // each item still renders exactly ONCE, in its HOME layer's container
    for (const id of ["s1", "ov", "both"]) expect(element.querySelectorAll(`[data-item-id="${id}"]`).length).toBe(1);
    expect(el(element, "s1").closest(".ns-world")).toBeTruthy();
    expect(el(element, "both").closest(".ns-world")).toBeTruthy(); // member of overlay, but HOME is canvas
    expect(el(element, "ov").closest(".ns-layer")).toBeTruthy();
    // canvas tab active: the overlay-only item is hidden — but its DOM node survives
    expect(el(element, "s1").style.display).not.toBe("none");
    expect(el(element, "both").style.display).not.toBe("none");
    expect(el(element, "ov").style.display).toBe("none");
  });

  it("overlay tab: everything shows (lower layers keep rendering, frosted, under the active one)", async () => {
    const { element } = await mountCanvas();
    tab(element, "Overlay").click();
    await flush();
    for (const id of ["s1", "ov", "both"]) expect(el(element, id).style.display).not.toBe("none");
    // the canvas items sit under the frost pane (the compositing is unchanged)
    expect(element.querySelector(".ns-frost")).toBeTruthy();
    expect(el(element, "s1").closest(".ns-world")).toBeTruthy();
  });

  it("overlay-only MINIMAP hidden on the canvas tab; PALETTE with ['overlay','canvas'] visible (and interactive) on both", async () => {
    registerPlugins([palettePlugin, minimapPlugin]);
    const { element } = await mountCanvas([
      { id: "mm", kind: "editor", editorId: "minimap", layer: "overlay", layers: ["overlay"], x: 10, y: 10, w: 180, h: 130, inlets: {} },
      { id: "pal", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], x: 10, y: 200, w: 300, h: 44, inlets: {}, config: { brushes: ["select", "pen"] } },
      { id: "ink", kind: "stroke", points: [[0, 0, 0.5], [50, 50, 0.5]], color: "line", size: 5 },
    ]);
    await flush(40);
    // canvas tab: the overlay-only minimap is hidden — display:none is also what
    // makes it unhittable/unclickable (no box, no elementsFromPoint entry)
    expect(el(element, "mm").style.display).toBe("none");
    // …while the palette's canvas MEMBERSHIP keeps it visible AND usable (pointer-events opt-in)
    expect(el(element, "pal").style.display).not.toBe("none");
    expect(el(element, "pal").style.pointerEvents).toBe("auto");
    expect(el(element, "ink").style.display).not.toBe("none");
    // overlay tab: everything shows; canvas ink still visible (frosted beneath)
    tab(element, "Overlay").click();
    await flush();
    expect(el(element, "mm").style.display).not.toBe("none");
    expect(el(element, "pal").style.display).not.toBe("none");
    expect(el(element, "ink").style.display).not.toBe("none");
    expect(element.querySelector(".ns-frost")).toBeTruthy();
  });

  it("a selected item's Properties panel shows the 'appears on' memberships (home locked on) and toggling writes `layers` without deleting the legacy `layer`", async () => {
    const { element, layout } = await mountCanvas();
    clickItem(element, "s1");
    await flush();
    const rows = [...element.querySelectorAll(".ns-appears .ns-check")];
    expect(rows.length).toBe(2);
    const homeRow = rows.find((r) => r.textContent.includes("home"));
    expect(homeRow.textContent).toContain("canvas"); // s1's home (the layer id — stack layers carry no display name)
    expect(homeRow.querySelector("input").disabled).toBe(true); // locked on
    const overlayRow = rows.find((r) => !r.textContent.includes("home"));
    expect(overlayRow.querySelector("input").checked).toBe(false);
    overlayRow.querySelector("input").click();
    await flush();
    const s1 = layout.doc().items.find((x) => x.id === "s1");
    expect([...s1.layers]).toEqual(["canvas", "overlay"]); // membership added, home first
    // untoggling removes the membership again; the legacy `layer` field is never deleted
    overlayRow.querySelector("input").click();
    await flush();
    const s1b = layout.doc().items.find((x) => x.id === "s1");
    expect([...s1b.layers]).toEqual(["canvas"]);
    const ov = layout.doc().items.find((x) => x.id === "ov");
    expect(ov.layer).toBe("overlay"); // untouched throughout
  });
});

describe("cross-layer selection — selection stays within the active layer, geometry in the item's HOME space", () => {
  // camera pan/zoom ≠ identity, so a wrong-layer projection is DETECTABLY wrong
  const CAM = { x: 50, y: 30, z: 2 };

  it("picking an overlay-home item while the canvas tab is active SWITCHES to overlay; the handles sit at its viewport coords", async () => {
    // an overlay-ONLY item is display:none on the canvas tab (unclickable), so the
    // cross-layer pick applies to items VISIBLE here via a canvas MEMBERSHIP
    const items = ITEMS().map((it) => (it.id === "ov" ? { ...it, layers: ["overlay", "canvas"] } : it));
    const { element } = await mountCanvas(items, CAM);
    expect(tab(element, "Canvas").classList.contains("active")).toBe(true);
    expect(el(element, "ov").style.display).not.toBe("none"); // the membership shows it
    clickItem(element, "ov");
    await flush();
    expect(tab(element, "Overlay").classList.contains("active")).toBe(true); // auto-switched to the item's home
    const h = element.querySelector(".ns-handles");
    expect(h).toBeTruthy();
    // overlay = viewport space (identity): the box is exactly the item's stored rect,
    // NOT the camera projection (which would put it at 70,50 ×2)
    expect(h.style.left).toBe("10px");
    expect(h.style.top).toBe("10px");
    expect(h.style.width).toBe("40px");
    expect(h.style.height).toBe("30px");
  });

  it("picking a canvas-home item while the overlay tab is active switches back; the handles project through the CAMERA (not identity)", async () => {
    const { element } = await mountCanvas(ITEMS(), CAM);
    tab(element, "Overlay").click();
    await flush();
    clickItem(element, "s1");
    await flush();
    expect(tab(element, "Canvas").classList.contains("active")).toBe(true);
    const h = element.querySelector(".ns-handles");
    expect(h).toBeTruthy();
    // s1 at world 400,400 60×40 through cam {x:50,y:30,z:2}: centre (430,420) →
    // screen (910,870), size ×2 → box at (850,830) 120×80
    expect(h.style.left).toBe("850px");
    expect(h.style.top).toBe("830px");
    expect(h.style.width).toBe("120px");
    expect(h.style.height).toBe("80px");
  });
});
