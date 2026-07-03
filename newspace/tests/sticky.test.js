// STICKY — a window docked to a viewport edge by dragging (sticky.js + the
// canvas's move gesture). Pure math first (edge detection, t, resolution),
// then the real mounted flow: drag a window into snap range of an edge → the
// item gains `sticky: { edge, t }`; drag it away → sticky is DELETED and the
// item returns to plain space coords without jumping.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { registerPlugins } from "@inkandswitch/patchwork-plugins";
import { Canvas } from "../src/brush/canvas.jsx";
import { mountRawValue } from "../src/source-nodes.js";
import { stickyFromRect, stickyT, resolveStickyScreen, stickyOf, isStuck, STICKY_SNAP, STICKY_INSET } from "../src/sticky.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

// ── pure math ────────────────────────────────────────────────────────────────

describe("stickyFromRect — which edge (if any) a dropped rect docks to", () => {
  const W = 1000, H = 800;
  it("far from every edge → null", () => {
    expect(stickyFromRect(400, 300, 200, 100, W, H)).toBe(null);
  });
  it("within the snap threshold of each edge → that edge + t along it", () => {
    expect(stickyFromRect(10, 350, 200, 100, W, H)).toEqual({ edge: "left", t: 0.5 });
    expect(stickyFromRect(W - 200 - 10, 350, 200, 100, W, H)).toEqual({ edge: "right", t: 0.5 });
    expect(stickyFromRect(400, 12, 200, 100, W, H)).toEqual({ edge: "top", t: 0.5 });
    expect(stickyFromRect(400, H - 100 - 12, 200, 100, W, H)).toEqual({ edge: "bottom", t: 0.5 });
  });
  it("the NEAREST qualifying edge wins in a corner", () => {
    expect(stickyFromRect(4, H - 100 - 12, 200, 100, W, H).edge).toBe("left"); // 4px < 12px
    expect(stickyFromRect(20, H - 100 - 6, 200, 100, W, H).edge).toBe("bottom");
  });
  it("past the edge (dragged half off-screen) still docks", () => {
    expect(stickyFromRect(-30, 350, 200, 100, W, H).edge).toBe("left");
  });
  it("the threshold is ~24px (STICKY_SNAP)", () => {
    expect(STICKY_SNAP).toBe(24);
    expect(stickyFromRect(24, 350, 200, 100, W, H)?.edge).toBe("left");
    expect(stickyFromRect(25, 350, 200, 100, W, H)).toBe(null);
  });
});

describe("stickyT — normalized position along the edge", () => {
  it("0 at the top/left end, 1 at the bottom/right end, clamped", () => {
    expect(stickyT("bottom", 0, 0, 200, 100, 1000, 800)).toBe(0);
    expect(stickyT("bottom", 800, 0, 200, 100, 1000, 800)).toBe(1);
    expect(stickyT("bottom", 400, 0, 200, 100, 1000, 800)).toBe(0.5);
    expect(stickyT("left", 0, 350, 200, 100, 1000, 800)).toBe(0.5);
    expect(stickyT("bottom", 2000, 0, 200, 100, 1000, 800)).toBe(1); // clamped
  });
  it("a degenerate run (item ≥ viewport) centres", () => {
    expect(stickyT("bottom", 10, 0, 1200, 100, 1000, 800)).toBe(0.5);
  });
});

describe("resolveStickyScreen — sticky + size → the docked top-left", () => {
  const W = 1000, H = 800;
  it("each edge: flush (inset) against it, t along the free run", () => {
    expect(resolveStickyScreen({ edge: "bottom", t: 0.5 }, 200, 100, W, H)).toEqual({ x: 400, y: H - 100 - STICKY_INSET });
    expect(resolveStickyScreen({ edge: "top", t: 0 }, 200, 100, W, H)).toEqual({ x: 0, y: STICKY_INSET });
    expect(resolveStickyScreen({ edge: "left", t: 1 }, 200, 100, W, H)).toEqual({ x: STICKY_INSET, y: 700 });
    expect(resolveStickyScreen({ edge: "right", t: 0.5 }, 200, 100, W, H)).toEqual({ x: W - 200 - STICKY_INSET, y: 350 });
  });
  it("round-trips with stickyFromRect (dock → resolve → the same edge/t)", () => {
    const s = stickyFromRect(190, H - 100 - 10, 200, 100, W, H);
    const p = resolveStickyScreen(s, 200, 100, W, H);
    expect(stickyFromRect(p.x, p.y, 200, 100, W, H)).toEqual(s);
  });
  it("a zero-size viewport degrades safely (no NaN/negative-x blowups)", () => {
    const p = resolveStickyScreen({ edge: "top", t: 0 }, 200, 100, 0, 0);
    expect(p).toEqual({ x: 0, y: STICKY_INSET });
  });
});

describe("stickyOf — legacy corner anchors normalize to sticky (migrate-on-read)", () => {
  const W = 1000, H = 800;
  it("a bottom-left anchored minimap resolves within a few px of its legacy spot", () => {
    const mm = { anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136 };
    const s = stickyOf(mm, W, H);
    expect(s.edge).toBe("left");
    const p = resolveStickyScreen(s, mm.w, mm.h, W, H);
    expect(p.x).toBe(STICKY_INSET);          // the 16px corner offset becomes the 12px inset
    expect(p.y).toBeCloseTo(H - mm.h - 16, 5); // along-edge position exact
  });
  it("a bottom-right anchor with a big along-edge offset (the ctx chips) keeps that offset exactly", () => {
    const chip = { anchor: "bottom-right", x: 16, y: 54, w: 74, h: 22 };
    const p = resolveStickyScreen(stickyOf(chip, W, H), chip.w, chip.h, W, H);
    expect(p.x).toBe(W - chip.w - STICKY_INSET);
    expect(p.y).toBeCloseTo(H - chip.h - 54, 5);
  });
  it("a top anchor measures from the top", () => {
    const p = resolveStickyScreen(stickyOf({ anchor: "top-left", x: 16, y: 20, w: 100, h: 40 }, W, H), 100, 40, W, H);
    expect(p).toEqual({ x: STICKY_INSET, y: 20 });
  });
  it("sticky WINS when both fields are present", () => {
    expect(stickyOf({ sticky: { edge: "top", t: 0.5 }, anchor: "bottom-left", y: 16, h: 40 }, W, H)).toEqual({ edge: "top", t: 0.5 });
  });
  it("isStuck: sticky or anchor, nothing else", () => {
    expect(isStuck({ sticky: { edge: "top", t: 0 } })).toBe(true);
    expect(isStuck({ anchor: "bottom-left" })).toBe(true);
    expect(isStuck({ x: 5, y: 5 })).toBe(false);
    expect(isStuck(null)).toBe(false);
  });
});

// ── mounted: drag a window to an edge → it sticks; drag it off → it unsticks ──

registerPlugins([{
  type: "sketchy:window", id: "value", name: "Raw value",
  inlets: [], outlets: [{ name: "value", type: "json" }],
  load: async () => mountRawValue,
}]);

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
  // give the zero-layout happy-dom viewport a real size for the snap math +
  // toWorld (rect and offset sizes must AGREE so client px == world px at z 1)
  const vp = element.querySelector(".ns-root");
  Object.defineProperty(vp, "offsetWidth", { get: () => 1000 });
  Object.defineProperty(vp, "offsetHeight", { get: () => 800 });
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0 });
  return { repo, layout, folder, element, vp };
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

const drag = async (element, id, from, to) => {
  const node = element.querySelector(`[data-item-id="${id}"]`);
  const target = node.querySelector(".ns-hit") || node; // a shape grabs via its hit layer; a window via its chrome
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: from.x, clientY: from.y }));
  window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 }));
  window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: to.x, clientY: to.y }));
  await flush(30); // let the rAF-batched doc write land before the drop
  window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: to.x, clientY: to.y }));
  await flush(20);
};

describe("sticky, mounted — set and cleared by dragging", () => {
  const WIN = () => [{ id: "w1", kind: "editor", editorId: "value", x: 400, y: 300, w: 200, h: 60, inlets: {}, config: { raw: "5", kind: "number" } }];

  it("dropping a window within snap range of the bottom edge writes sticky {edge, t}", async () => {
    const { element, layout } = await mountCanvas(WIN());
    // drag down: y 300 → 730, so the rect (730..790) ends 10px off the bottom (800)
    await drag(element, "w1", { x: 500, y: 320 }, { x: 500, y: 750 });
    const w1 = layout.doc().items.find((x) => x.id === "w1");
    expect(w1.sticky).toBeTruthy();
    expect(w1.sticky.edge).toBe("bottom");
    expect(w1.sticky.t).toBeCloseTo(400 / 800, 5); // x 400 over the 800px free run
  });

  it("a stuck window renders viewport-anchored; dragging it away DELETES sticky and returns space coords (no jump)", async () => {
    const { element, layout } = await mountCanvas([
      { id: "w1", kind: "editor", editorId: "value", sticky: { edge: "bottom", t: 0.25 }, x: 7, y: 9, w: 200, h: 60, inlets: {}, config: { raw: "5", kind: "number" } },
    ]);
    await flush(20);
    // nudge an item field so the style recomputes against the (test-supplied)
    // viewport metrics — happy-dom's ResizeObserver never fires vpTick
    layout.change((d) => { d.items[0].x = 8; });
    await flush(20);
    // resolved dock position: x = 0.25 * 800 = 200, y = 800 - 60 - 12 = 728
    const node = element.querySelector('[data-item-id="w1"]');
    expect(node.style.left).toBe("200px");
    expect(node.style.top).toBe("728px");
    // drag it up into open space (Δ -300 y): the move unsticks from the RESOLVED
    // position, so the item lands where it visually was, not at its stale x/y
    await drag(element, "w1", { x: 300, y: 740 }, { x: 300, y: 440 });
    const w1 = layout.doc().items.find((x) => x.id === "w1");
    expect(w1.sticky).toBeUndefined(); // deleted (never `undefined`-assigned)
    expect(w1.x).toBeCloseTo(200, 3);
    expect(w1.y).toBeCloseTo(428, 3);
  });

  it("dragging a STUCK window un-sticks SYNCHRONOUSLY on the first move — monotonic positions, no dock-resolved frames after", async () => {
    const { element, layout } = await mountCanvas([
      { id: "w1", kind: "editor", editorId: "value", sticky: { edge: "bottom", t: 0.25 }, x: 7, y: 9, w: 200, h: 60, inlets: {}, config: { raw: "5", kind: "number" } },
    ]);
    await flush(20);
    // recompute the style against the test viewport (happy-dom never fires vpTick)
    layout.change((d) => { d.items[0].x = 8; });
    await flush(20);
    const node = element.querySelector('[data-item-id="w1"]');
    expect(node.style.top).toBe("728px"); // dock-resolved: 800 − 60 − 12
    const DOCK_TOP = 728;
    // press + FIRST move: the unstick must land synchronously (not on the next rAF) —
    // sticky deleted, the RESOLVED origin written — so no frame can render the item
    // dock-resolved while the gesture writes space coords.
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 740 }));
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: 700 }));
    let w1 = layout.doc().items.find((x) => x.id === "w1");
    expect(w1.sticky).toBeUndefined(); // gone BEFORE any rAF write
    expect(w1.x).toBeCloseTo(200, 3); // the resolved dock origin, not the stale 8/9
    expect(w1.y).toBeCloseTo(DOCK_TOP, 3);
    // keep dragging up; after each frame the rendered top must strictly DECREASE and
    // never revisit the dock position (the old bug: rAF-deferred unstick let early
    // frames render dock-resolved while space coords accumulated → pin-then-jump)
    const tops = [];
    for (const y of [660, 620, 580]) {
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 300, clientY: y }));
      await flush(30); // let the batched write + projection land
      tops.push(parseFloat(node.style.top));
    }
    expect(tops).toEqual([...tops].sort((a, b) => b - a)); // monotonic upward
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeLessThan(tops[i - 1]);
    for (const t of tops) expect(t).toBeLessThan(DOCK_TOP); // no dock-position frames after the first move
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 300, clientY: 580 }));
    await flush(20);
    w1 = layout.doc().items.find((x) => x.id === "w1");
    expect(w1.sticky).toBeUndefined();
    expect(w1.y).toBeCloseTo(DOCK_TOP - 160, 3); // origin + the full Δ (740→580)
  });

  it("a plain CLICK on a stuck window (no move) keeps it docked", async () => {
    const { element, layout } = await mountCanvas([
      { id: "w1", kind: "editor", editorId: "value", sticky: { edge: "bottom", t: 0.25 }, x: 7, y: 9, w: 200, h: 60, inlets: {}, config: { raw: "5", kind: "number" } },
    ]);
    await flush(20);
    const node = element.querySelector('[data-item-id="w1"]');
    node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 300, clientY: 740 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 300, clientY: 740 }));
    await flush(20);
    expect(layout.doc().items.find((x) => x.id === "w1").sticky).toEqual({ edge: "bottom", t: 0.25 });
  });

  it("strokes/shapes never dock — only windows (doc/editor items) do", async () => {
    const { element, layout } = await mountCanvas([
      { id: "sh", kind: "shape", type: "rectangle", x: 400, y: 700, w: 100, h: 80, color: "line", strokeWidth: 2, rotation: 0 },
    ]);
    await drag(element, "sh", { x: 450, y: 740 }, { x: 450, y: 758 });
    expect(layout.doc().items.find((x) => x.id === "sh").sticky).toBeUndefined();
  });
});
