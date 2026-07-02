// ERASER DRAG-TO-ERASE regression pin (mount-level, real Canvas, happy-dom).
//
// Report: "can't click and drag with the eraser to erase multiple shapes."
// The eraser brush is down/move → ctx.eraseAt(ctx.event) (eraser-brush.js); eraseAt
// hit-tests via document.elementsFromPoint → closest("[data-item-id]") → removeItems.
// happy-dom's elementsFromPoint has no geometry (and no pointer-events filtering), so
// each test stubs it with a coordinate → live-DOM-node map built from the mounted tree:
// the GEOMETRIC hit-test is stubbed, the DISPATCH path (onPointerDown routing, the
// window pointermove pair from gestureListeners/beginGesture, callBrush("move"),
// brushCtx.event, eraseAt's loop + targetBox guard, removeItems) runs for real.
//
// Two scenarios:
//   1. drag STARTING ON EMPTY CANVAS, crossing two shapes → both erased
//      (pins the onPointerDown eraser branch + the brush move dispatch).
//   2. drag STARTING ON A SHAPE — the natural "rub the eraser over things" gesture.
//      The shape's own hit area (.ns-hit is rendered for the eraser too: item.jsx
//      hittable()) routes the press to onItemDown, which stopPropagation()s, deletes
//      that one item and RETURNS WITHOUT STARTING A GESTURE (canvas.jsx ~line 517) —
//      so the rest of the drag erases nothing. This test documents the reported bug.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "./brush/canvas.jsx";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// happy-dom gaps (same guard as the sibling mount tests); tests stub per-scenario
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;
const realElementsFromPoint = document.elementsFromPoint;

const mounted = [];
async function mountCanvas(items) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
  const m = { repo, layout, folder, element, disposed: false, dispose() { if (!this.disposed) { this.disposed = true; dispose(); } } };
  mounted.push(m);
  await flush();
  return m;
}
afterEach(() => {
  document.elementsFromPoint = realElementsFromPoint;
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y }));
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

// two side-by-side rectangles (camera starts at identity, so world == client here)
const R1 = { id: "r1", kind: "shape", type: "rectangle", x: 100, y: 100, w: 100, h: 100, color: "line", fill: "none", strokeWidth: 2, roughness: 1, bowing: 1, fillStyle: "hachure", seed: 7, rotation: 0 };
const R2 = { id: "r2", kind: "shape", type: "rectangle", x: 250, y: 100, w: 100, h: 100, color: "line", fill: "none", strokeWidth: 2, roughness: 1, bowing: 1, fillStyle: "hachure", seed: 8, rotation: 0 };

// stub elementsFromPoint with the items' REAL mounted nodes: any point inside an
// item's stored bounds returns its live .ns-hit (what a browser would return —
// item.jsx renders .ns-hit, pointer-events:auto, for select AND eraser), topmost
// first, then the viewport. A removed item's node is gone → no longer returned.
function stubHitTest(element, layout) {
  document.elementsFromPoint = (x, y) => {
    const stack = [];
    const items = layout.doc().items || [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (x < it.x || x > it.x + it.w || y < it.y || y > it.y + it.h) continue;
      const el = element.querySelector(`[data-item-id="${it.id}"] .ns-hit`) || element.querySelector(`[data-item-id="${it.id}"]`);
      if (el) stack.push(el);
    }
    const root = element.querySelector(".ns-root");
    if (root) stack.push(root);
    return stack;
  };
}

describe("eraser drag-to-erase (dispatch pin)", () => {
  it("a drag starting on EMPTY canvas erases every shape it crosses", async () => {
    const { element, layout } = await mountCanvas([structuredClone(R1), structuredClone(R2)]);
    stubHitTest(element, layout);
    key("e"); // arm the eraser
    await flush(5);
    const root = element.querySelector(".ns-root");
    expect(root).toBeTruthy();
    ptr("pointerdown", root, 500, 400); // empty canvas — the eraser gesture starts here
    ptr("pointermove", window, 150, 150); // cross r1
    ptr("pointermove", window, 300, 150); // cross r2
    ptr("pointerup", window, 320, 150);
    await flush(10); // removeItems splices on a microtask
    const ids = (layout.doc().items || []).map((x) => x.id);
    expect(ids).not.toContain("r1");
    expect(ids).not.toContain("r2");
  });

  it("a drag STARTING ON a shape (the natural rub) erases it AND everything else it crosses", async () => {
    const { element, layout } = await mountCanvas([structuredClone(R1), structuredClone(R2)]);
    stubHitTest(element, layout);
    key("e");
    await flush(5);
    // with the eraser armed, r1's full-bbox hit area is live (item.jsx hittable()):
    // the press lands on .ns-hit → onItemDown, exactly as it does in the browser
    const hit = element.querySelector('[data-item-id="r1"] .ns-hit');
    expect(hit).toBeTruthy();
    ptr("pointerdown", hit, 150, 150); // press ON r1
    ptr("pointermove", window, 300, 150); // drag across r2
    ptr("pointerup", window, 320, 150);
    await flush(10);
    const ids = (layout.doc().items || []).map((x) => x.id);
    expect(ids).not.toContain("r1"); // the pressed shape goes (single-click delete)
    expect(ids).not.toContain("r2"); // …and the drag must keep erasing (the reported bug)
  });
});
