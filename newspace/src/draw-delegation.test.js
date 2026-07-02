// DRAW DELEGATION, end to end in happy-dom: the canvas CLAIMS draw gestures over an
// embedded spatial box (a map item with a bound fake instance) — a pen gesture over the
// box lands as a normal items-array stroke with `parent: boxId` + box-LOCAL (geo) coords,
// via the capture-phase path (the box's body stopPropagations, like the real map editor).
// Plus the keyboard-guard contract: undo/delete keystrokes aimed at editable content or an
// embedded tool must NOT reach the canvas history.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "./brush/canvas.jsx";
import { bindMapInstance } from "./box-transform.js";
import { isTypingTarget } from "./brush/constants.js";

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
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

// a fake Leaflet (no Leaflet in vitest): Mercator-ish scale + the y-inversion
const fakeMap = (zoom = 13, center = { lat: 51.5, lng: -0.09 }, size = { w: 200, h: 150 }) => {
  const scale = (256 * Math.pow(2, zoom)) / 360;
  return {
    latLngToContainerPoint: ([lat, lng]) => ({ x: size.w / 2 + (lng - center.lng) * scale, y: size.h / 2 - (lat - center.lat) * scale }),
    containerPointToLatLng: ([x, y]) => ({ lng: center.lng + (x - size.w / 2) / scale, lat: center.lat - (y - size.h / 2) / scale }),
  };
};
const MAP_ITEM = { id: "map1", kind: "editor", editorId: "map", x: 100, y: 100, w: 200, h: 150, rotation: 0, inlets: {} };

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y }));

describe("claimed draw over a spatial box → a parented, box-local item", () => {
  it("a pen gesture over the map (capture path: its body stops propagation) commits a stroke with parent + geo coords", async () => {
    const inst = fakeMap();
    bindMapInstance("map1", inst);
    const { element, layout } = await mountCanvas({}, [structuredClone(MAP_ITEM)]);
    try {
      const body = element.querySelector('[data-item-id="map1"] .ns-doc-body');
      expect(body).toBeTruthy();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true })); // arm the pen
      await flush(5);
      // draw a short stroke starting ON the map body (bubbling stops there — only the
      // canvas's capture-phase claim can start this gesture, exactly like the real map)
      ptr("pointerdown", body, 150, 150);
      ptr("pointermove", window, 170, 160);
      ptr("pointermove", window, 190, 175);
      ptr("pointerup", window, 190, 175);
      await flush(10);
      const stroke = layout.doc().items.find((x) => x.kind === "stroke");
      expect(stroke).toBeTruthy();
      // ANNOTATION regime: in the OUTER items array, parented onto the box, origin 0
      expect(stroke.parent).toBe("map1");
      expect(stroke.x).toBe(0);
      expect(stroke.y).toBe(0);
      // BOX-LOCAL (geo) coords: world (150,150) − box origin (100,100) = container (50,50)
      const g0 = inst.containerPointToLatLng([50, 50]);
      expect(stroke.points[0][0]).toBeCloseTo(g0.lng, 9); // x slot = lng
      expect(stroke.points[0][1]).toBeCloseTo(g0.lat, 9); // y slot = lat
      const g2 = inst.containerPointToLatLng([90, 75]);
      expect(stroke.points[2][0]).toBeCloseTo(g2.lng, 9);
      expect(stroke.points[2][1]).toBeCloseTo(g2.lat, 9);
      // and it renders through the NORMAL pipeline as a plain mark div (clipped to the box)
      const mark = element.querySelector(`[data-item-id="${stroke.id}"]`);
      expect(mark).toBeTruthy();
      expect(mark.classList.contains("ns-mark")).toBe(true);
      expect(mark.style.clipPath || mark.style["clip-path"]).toContain("polygon");
    } finally {
      bindMapInstance("map1", null);
    }
  });

  it("a pen gesture on empty canvas stays a plain root stroke (no parent)", async () => {
    const { element, layout } = await mountCanvas({}, [structuredClone(MAP_ITEM)]);
    const root = element.querySelector(".ns-root");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
    await flush(5);
    ptr("pointerdown", root, 500, 500);
    ptr("pointermove", window, 520, 510);
    ptr("pointerup", window, 520, 510);
    await flush(10);
    const stroke = layout.doc().items.find((x) => x.kind === "stroke");
    expect(stroke).toBeTruthy();
    expect(stroke.parent).toBeUndefined();
    expect(stroke.points[0][0]).toBeCloseTo(500);
  });
});

describe("keystrokes inside an embed / editable content never reach the canvas history", () => {
  const STROKE = { id: "s1", kind: "stroke", points: [[0, 0, 0.5], [30, 30, 0.5]], x: 500, y: 500, color: "line", size: 4, rotation: 0 };

  it("isTypingTarget covers inputs, contenteditable, embed bodies AND patchwork-views", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(isTypingTarget(input)).toBe(true);
    const ce = document.createElement("div");
    ce.contentEditable = "true";
    document.body.append(ce);
    expect(isTypingTarget(ce)).toBe(true);
    const pv = document.createElement("patchwork-view");
    const inner = document.createElement("div");
    pv.append(inner);
    document.body.append(pv);
    expect(isTypingTarget(inner)).toBe(true); // an embedded tool owns its keys (incl. its own undo)
    const plain = document.createElement("div");
    document.body.append(plain);
    expect(isTypingTarget(plain)).toBe(false);
    input.remove(); ce.remove(); pv.remove(); plain.remove();
  });

  it("Backspace from inside a patchwork-view leaves the selected canvas item alone; from the canvas it deletes; ⌘Z is guarded the same way", async () => {
    const { element, layout } = await mountCanvas({}, [structuredClone(STROKE)]);
    // select the stroke the way a user does
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    expect(hit).toBeTruthy();
    ptr("pointerdown", hit, 505, 505);
    ptr("pointerup", window, 505, 505);
    await flush(10);
    // a keystroke aimed INTO an embedded tool must not delete the canvas selection
    const pv = document.createElement("patchwork-view");
    const inner = document.createElement("div");
    pv.append(inner);
    document.body.append(pv);
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await flush(10);
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(true); // untouched
    // the same key aimed at the canvas deletes it (and records undo)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await flush(10);
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(false);
    // ⌘Z from inside the embed must NOT canvas-undo (the embed owns its own history)
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    await flush(10);
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(false); // still deleted
    // ⌘Z aimed at the canvas restores it
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    await flush(10);
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(true);
    pv.remove();
  });
});
