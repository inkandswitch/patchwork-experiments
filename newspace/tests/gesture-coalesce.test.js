// README.md Phase 1 — gesture doc writes are rAF-coalesced. Budget: ≤1
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
import { Canvas } from "../src/brush/canvas.jsx";
import { now } from "../src/perf.js";

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
// `legacy: true` seeds the PRE-RENAME doc shape ("newspace-layout" +
// `folder.newspace`) — the back-compat read pinned at the bottom of this file.
async function mountCanvas(items, { legacy = false } = {}) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: legacy ? "newspace-layout" : "sketch-layout" }, items });
  const folder = repo.create(legacy
    ? { title: "test", docs: [], newspace: layout.url }
    : { title: "test", docs: [], sketch: layout.url });
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
  // retry(1): the window.__perf counters are global — a previous file's canvas can
  // leak one async tick into our deltas when file order lines up (seen 2026-07-02).
  // A real regression fails BOTH attempts; only cross-file noise gets absorbed.
  it("N pointermoves in one tick coalesce to exactly ONE handle.change on the frame, latest position winning", { retry: 1 }, async () => {
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
  // retry(1): global __perf deltas — cross-file async-tick noise only; see the note above.
  it("coalesces handle-drag writes to one per frame and undoes to the original size", { retry: 1 }, async () => {
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
  // retry(1): global __perf deltas — cross-file async-tick noise only; see the note above.
  it("disposing the canvas mid-gesture cancels the pending write and detaches the window listeners", { retry: 1 }, async () => {
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

describe("pointercancel: a cancelled gesture settles cleanly", () => {
  it("detaches, drops the pending write, and leaves no stale gesture for a foreign pointerup", async () => {
    const raf = fakeRaf();
    const { element, layout } = await mountCanvas([structuredClone(STROKE)]);
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    const w0 = docWrites();
    ptr("pointerdown", hit, 505, 505);
    ptr("pointermove", window, 545, 505); // a write is pending in the gesture's batch
    ptr("pointercancel", window, 545, 505);
    raf.step(); // the frame the write was scheduled for — it was dropped
    expect(docWrites() - w0).toBe(0);
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(500);
    // the listeners are detached and the gesture settled: a FOREIGN pointer's
    // move/up must not drive or endTxn a stale gesture (the old bug: cancel
    // left everything attached and the NEXT pointerup flushed it)
    ptr("pointermove", window, 585, 505);
    ptr("pointerup", window, 585, 505);
    raf.step();
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(500);
    // and no empty undo entry was pushed (an unchanged txn diffs to null)
    key("z");
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(500);
  });

  it("a cancel AFTER a landed frame keeps what landed, closed as one undoable unit", async () => {
    const raf = fakeRaf();
    const { element, layout } = await mountCanvas([structuredClone(STROKE)]);
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    ptr("pointerdown", hit, 505, 505);
    ptr("pointermove", window, 545, 505);
    raf.step(); // this write LANDS (x 540)
    ptr("pointermove", window, 605, 505); // pending again…
    ptr("pointercancel", window, 605, 505); // …dropped by the cancel
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(540);
    await flush(5);
    key("z"); // the cancel closed the txn over what landed
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(500);
  });
});

describe("multi-touch: ONE gesture at a time, first pointer wins", () => {
  const pptr = (type, target, x, y, pointerId) => {
    const e = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(e, "pointerId", { value: pointerId });
    target.dispatchEvent(e);
  };
  it("a second finger neither drives nor ends the first gesture, and can't start its own", async () => {
    const raf = fakeRaf();
    const { element, layout } = await mountCanvas([structuredClone(STROKE), structuredClone(RECT)]);
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    pptr("pointerdown", hit, 505, 505, 1);
    // a SECOND pointer presses another item mid-gesture — refused (first wins)
    pptr("pointerdown", element.querySelector('[data-item-id="r1"] .ns-hit'), 150, 150, 2);
    pptr("pointermove", window, 400, 400, 2); // finger 2 must not drive finger 1's move…
    pptr("pointerup", window, 400, 400, 2); // …nor end its gesture/txn
    raf.step();
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(500); // untouched by finger 2
    pptr("pointermove", window, 545, 505, 1); // finger 1 still owns the gesture
    pptr("pointerup", window, 545, 505, 1); // the flush carries finger 1's FINAL write
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(540);
    expect(layout.doc().items.find((x) => x.id === "r1").x).toBe(100); // the refused press moved nothing
  });
});

describe("tool shortcuts decline while a modifier is held", () => {
  it("⌘A / ⌥P must not arm a tool; the bare key still does", async () => {
    const { element } = await mountCanvas([]);
    const root = element.querySelector(".ns-root");
    expect(root.classList.contains("ns-cur-default")).toBe(true); // select
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true }));
    await flush(5);
    expect(root.classList.contains("ns-cur-default")).toBe(true); // ⌘A (select-all) did NOT arm arrow
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true, bubbles: true }));
    await flush(5);
    expect(root.classList.contains("ns-cur-default")).toBe(true); // ⌥P did not arm pen
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", ctrlKey: true, bubbles: true }));
    await flush(5);
    expect(root.classList.contains("ns-cur-default")).toBe(true); // the number row declines too
    key("a"); // the bare key still arms
    await flush(5);
    expect(root.classList.contains("ns-cur-cross")).toBe(true);
  });
});

describe("drag into a frame (reparent) — surfaces are keyed by URL", () => {
  it("moves the item into the box AND keeps a working selection (handles show)", async () => {
    fakeRaf(); // pointerup's flush lands the final position without stepping
    const m = await mountCanvas([]);
    const childLayout = m.repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
    const childFolder = m.repo.create({ title: "box", docs: [], sketch: childLayout.url });
    m.layout.change((d) => {
      d.items.push({ id: "f1", kind: "frame", url: childFolder.url, x: 100, y: 100, w: 300, h: 200 });
      d.items.push({ ...structuredClone(RECT), id: "rr", x: 500, y: 500, w: 50, h: 40 });
    });
    await flush(40);
    const hit = m.element.querySelector('[data-item-id="rr"] .ns-hit');
    expect(hit).toBeTruthy();
    ptr("pointerdown", hit, 525, 520);
    ptr("pointermove", window, 200, 200); // centre lands inside the frame
    ptr("pointerup", window, 200, 200);
    await flush(40); // maybeReparent awaits loadSpace
    expect(m.layout.doc().items.some((x) => x.id === "rr")).toBe(false);
    const moved = childLayout.doc().items.find((x) => x.id === "rr");
    expect(moved).toBeTruthy();
    expect(moved.x + moved.w / 2).toBe(100); // frame-local centre (200,200 world − frame 100,100)
    // REGRESSION: the active surface must be keyed by the frame URL — keying by
    // the frame's ITEM id fell back to root, silently dangling the selection
    // (no handles for the item you just moved).
    expect(m.element.querySelector(".ns-handles")).toBeTruthy();
  });
});

describe("drop preview over a STUCK box clips at the RESOLVED dock rect", () => {
  it("dropClip goes through effFrame, not the dormant stored coords", async () => {
    const raf = fakeRaf();
    const m = await mountCanvas([]);
    const childLayout = m.repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
    const childFolder = m.repo.create({ title: "box", docs: [], sketch: childLayout.url });
    m.layout.change((d) => {
      // a DOCKED (sticky) frame: stored x/y are dormant; it resolves to the left
      // edge (inset 12, t 0 → top) — in this headless viewport, (12, 0) 200×150
      d.items.push({ id: "f1", kind: "frame", url: childFolder.url, x: 5000, y: 5000, w: 200, h: 150, sticky: { edge: "left", t: 0 } });
      d.items.push({ ...structuredClone(RECT), id: "rr", x: 300, y: 300, w: 50, h: 40 });
    });
    await flush(40);
    const hit = m.element.querySelector('[data-item-id="rr"] .ns-hit');
    ptr("pointerdown", hit, 325, 320);
    ptr("pointermove", window, 100, 60); // over the RESOLVED dock rect, ~4900px from the dormant coords
    raf.step(); // land the write + the drop-target decoration (same batched closure)
    await flush(10);
    const clip = m.element.querySelector('[data-item-id="rr"]').style.getPropertyValue("clip-path");
    expect(clip).toContain("polygon(");
    // first clip corner = the RESOLVED box top-left in the item's local space:
    // (12 − 75, 0 − 40). The dormant coords would put it thousands of px out.
    expect(clip).toContain("-63px -40px");
    ptr("pointerup", window, 100, 60);
    await flush(30);
  });
});

// test-harness.js (and the mounts above) now seed the CURRENT doc shape
// ("sketch-layout" + folder.sketch), so this pins the LEGACY read explicitly:
// a pre-rename doc — "@patchwork".type "newspace-layout", referenced only via
// `folder.newspace` — must still open (layoutDocUrl falls back to .newspace).
describe("legacy doc shape (back-compat read)", () => {
  it("a folder with only the legacy .newspace reference still renders its layout items", async () => {
    const { element, layout, folder } = await mountCanvas([structuredClone(STROKE)], { legacy: true });
    await flush(30);
    // the canvas resolved the layout through the legacy field and rendered its item
    expect(element.querySelector('[data-item-id="s1"]')).toBeTruthy();
    // the legacy reference survives (migration is additive — .newspace is never deleted)
    expect(folder.doc().newspace).toBe(layout.url);
    // and the item is live: a drag through the legacy-opened doc still writes it
    const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
    ptr("pointerdown", hit, 505, 505);
    ptr("pointermove", window, 545, 505);
    ptr("pointerup", window, 545, 505);
    await flush(30);
    expect(layout.doc().items.find((x) => x.id === "s1").x).toBe(540);
  });
});
