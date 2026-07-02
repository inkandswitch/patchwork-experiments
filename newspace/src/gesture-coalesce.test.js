// PERF.md Phase 1 — gesture doc writes are rAF-coalesced. Budget: ≤1
// handle.change per frame per gesture, however fast the pointer streams.
// Pinned here at the mount level (real Canvas, happy-dom, in-memory repo):
//   • N pointermoves in one tick → ZERO writes until the (hand-cranked) rAF
//     fires, then exactly ONE, carrying the LATEST position.
//   • pointerup flush()es the pending write BEFORE endTxn, so the undo diff
//     sees the final position (undo restores the start, redo the end).
//   • the shared gestureListeners helper detaches the window pair on unmount,
//     so a gesture cut short by disposal can't leak listeners or write late.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "./brush/canvas.jsx";
import { now } from "./perf.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

// a hand-cranked rAF (same shape as perf.test.js): callbacks queue until step()
function fakeRaf() {
  let nextId = 1;
  const queue = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id) => { queue.delete(id); });
  return { queue, step(t = now()) { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(t); } };
}

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
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
  vi.unstubAllGlobals();
});

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y }));
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const docWrites = () => (window.__perf && window.__perf.docWrite) || 0;
const gestureEvents = () => (window.__perf && window.__perf.gestureEvent) || 0;

const STROKE = { id: "s1", kind: "stroke", points: [[0, 0, 0.5], [30, 30, 0.5]], x: 500, y: 500, color: "line", size: 4, rotation: 0 };
const RECT = { id: "r1", kind: "shape", type: "rectangle", x: 100, y: 100, w: 100, h: 100, color: "line", fill: "none", strokeWidth: 2, roughness: 1, bowing: 1, fillStyle: "hachure", seed: 7, rotation: 0 };

describe("move gesture: ≤1 doc write per frame", () => {
  it("N pointermoves in one tick coalesce to exactly ONE handle.change on the frame, latest position winning", async () => {
    const raf = fakeRaf();
    const { element, layout } = await mountCanvas([structuredClone(STROKE)]);
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    expect(hit).toBeTruthy();
    let changes = 0;
    layout.on("change", () => changes++);
    const w0 = docWrites(), e0 = gestureEvents();
    ptr("pointerdown", hit, 505, 505);
    for (const x of [515, 525, 535, 545, 555]) ptr("pointermove", window, x, 505);
    // deferred: five raw events, zero writes before the frame
    expect(gestureEvents() - e0).toBe(5);
    expect(docWrites() - w0).toBe(0);
    expect(changes).toBe(0);
    raf.step();
    expect(docWrites() - w0).toBe(1);
    expect(changes).toBe(1);
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(550); // 500 + (555 − 505): latest event won
    // a second burst is the next frame's single write
    for (const x of [565, 575, 585]) ptr("pointermove", window, x, 505);
    raf.step();
    expect(docWrites() - w0).toBe(2);
    expect(changes).toBe(2);
    ptr("pointerup", window, 585, 505); // nothing pending — flush is a no-op
    expect(docWrites() - w0).toBe(2);
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(580);
  });

  it("pointerup flushes the pending write before endTxn: undo restores the start, redo the FINAL position", async () => {
    fakeRaf(); // no step() ever runs — only the pointerup flush can land the write
    const { element, layout } = await mountCanvas([structuredClone(STROKE)]);
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    ptr("pointerdown", hit, 505, 505);
    ptr("pointermove", window, 605, 515);
    ptr("pointerup", window, 605, 515);
    // the flush landed the write synchronously, before the rAF ever fired
    let it1 = layout.doc().items.find((x) => x.id === "s1");
    expect(it1.x).toBe(600);
    expect(it1.y).toBe(510);
    await flush(5);
    key("z"); // undo — the txn diff must contain the flushed (final) position
    it1 = layout.doc().items.find((x) => x.id === "s1");
    expect(it1.x).toBe(500);
    expect(it1.y).toBe(500);
    key("Z"); // redo lands back on the FINAL position
    it1 = layout.doc().items.find((x) => x.id === "s1");
    expect(it1.x).toBe(600);
    expect(it1.y).toBe(510);
  });
});

describe("resize gesture: same budget through the handle path", () => {
  it("coalesces handle-drag writes to one per frame and undoes to the original size", async () => {
    const raf = fakeRaf();
    const { element, layout } = await mountCanvas([structuredClone(RECT)]);
    const hit = element.querySelector('[data-item-id="r1"] .ns-hit');
    expect(hit).toBeTruthy();
    ptr("pointerdown", hit, 150, 150); // select it (a no-move click pushes no command)
    ptr("pointerup", window, 150, 150);
    raf.step();
    await flush(5);
    const br = [...element.querySelectorAll(".ns-handle")].find((h) => h.style.left === "100%" && h.style.top === "100%");
    expect(br).toBeTruthy();
    const w0 = docWrites();
    ptr("pointerdown", br, 200, 200);
    for (const [x, y] of [[220, 210], [240, 215], [260, 220]]) ptr("pointermove", window, x, y);
    expect(docWrites() - w0).toBe(0);
    raf.step();
    expect(docWrites() - w0).toBe(1);
    let r = layout.doc().items.find((x) => x.id === "r1");
    expect(r.w).toBe(160); // bottom-right handle at (260,220) → 100×100 grows to 160×120
    expect(r.h).toBe(120);
    ptr("pointerup", window, 260, 220);
    await flush(5);
    key("z");
    r = layout.doc().items.find((x) => x.id === "r1");
    expect(r.w).toBe(100);
    expect(r.h).toBe(100);
  });
});

describe("gestureListeners cleanup", () => {
  it("disposing the canvas mid-gesture cancels the pending write and detaches the window listeners", async () => {
    const raf = fakeRaf();
    const m = await mountCanvas([structuredClone(STROKE)]);
    const hit = m.element.querySelector('[data-item-id="s1"] .ns-hit');
    const w0 = docWrites(), e0 = gestureEvents();
    ptr("pointerdown", hit, 505, 505);
    ptr("pointermove", window, 545, 505); // schedules a write for the next frame
    expect(gestureEvents() - e0).toBe(1);
    m.dispose(); // unmount with the gesture (and its pending write) still live
    raf.step(); // the frame the write was scheduled for
    expect(docWrites() - w0).toBe(0); // cancelled — no post-unmount doc write
    ptr("pointermove", window, 585, 505); // and the window listeners are gone
    raf.step();
    expect(gestureEvents() - e0).toBe(1);
    expect(docWrites() - w0).toBe(0);
    expect(m.layout.doc().items.find((x) => x.id === "s1").x).toBe(500);
  });
});
