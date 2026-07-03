// README.md Phase 10 (plan-2 §9) — a text item's auto-measured w/h stay OFF the
// render path and OUT of the undo history. Pinned at the mount level (real
// Canvas, happy-dom, hand-cranked rAF, offsetWidth/Height mocked for the
// `.ns-text-static` element only):
//   • the measure persist is DEFERRED (rafBatch) — no doc write on the render
//     path, and pressing undo after it lands is a no-op (no undo entry).
//   • typing in the text editor writes the TEXT per input, never w/h; blur
//     (the commit) persists the measured size.
//   • a style txn (fontSize via the panel) carries NO w/h in its undo diff —
//     undoing it keeps the measured size, then the measurer converges to the
//     reverted font's measure instead of fighting.
//   • undo of a move restores x/y with the measured size untouched.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "../src/brush/canvas.jsx";
import { now } from "../src/perf.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

// hand-cranked rAF (the gesture-coalesce.test.js shape)
function fakeRaf() {
  let nextId = 1;
  const queue = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id) => { queue.delete(id); });
  return { queue, step(t = now()) { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(t); } };
}

// happy-dom lays out nothing — give the TEXT element (static or editing, both
// carry .ns-text-static) a controllable measure; everything else keeps 0 so
// toWorld's offsetWidth fallback stays on its 1:1 path.
let MEASURE = { w: 120, h: 40 };
function mockTextMeasure() {
  const forText = (dim) => function () { return this.classList && this.classList.contains("ns-text-static") ? MEASURE[dim] : 0; };
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(forText("w"));
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(forText("h"));
}

const mounted = [];
async function mountCanvas(items) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  const element = document.createElement("div");
  document.body.append(element);
  let host = null;
  const opts = { slots: { presence: (h) => { host = h; return document.createElement("div"); } } }; // any slotted part hands over the chrome host (the fixed toolbar is gone)
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts }), element);
  const m = { repo, layout, folder, element, dispose };
  mounted.push(m);
  await flush();
  return { ...m, host };
}
afterEach(() => {
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y }));
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
const TEXT = { id: "t1", kind: "text", text: "hello", x: 100, y: 100, w: 10, h: 10, color: "line", font: "hand", fontSize: 20, rotation: 0 };
const item = (layout) => layout.doc().items.find((x) => x.id === "t1");

describe("measure persist is deferred off the render path and not undoable", () => {
  it("the mount measure lands on the frame, not synchronously, and undo is a no-op", async () => {
    const raf = fakeRaf();
    mockTextMeasure();
    MEASURE = { w: 120, h: 40 };
    const { layout } = await mountCanvas([structuredClone(TEXT)]);
    // measured, but the persist waits for the frame
    let t = item(layout);
    expect([t.w, t.h]).toEqual([10, 10]);
    raf.step();
    t = item(layout);
    expect([t.w, t.h]).toEqual([120, 40]);
    key("z"); // no undo entry for a measurement write
    t = item(layout);
    expect([t.w, t.h]).toEqual([120, 40]);
  });
});

describe("typing → text only; blur commits the size", () => {
  it("inputs write no w/h; the blur commit persists the measured size", async () => {
    const raf = fakeRaf();
    mockTextMeasure();
    MEASURE = { w: 120, h: 40 };
    const { element, layout } = await mountCanvas([structuredClone(TEXT)]);
    raf.step(); // the mount measure lands
    const st = element.querySelector('[data-item-id="t1"] .ns-text-static');
    expect(st).toBeTruthy();
    st.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true }));
    await flush(5);
    const ed = element.querySelector('[data-item-id="t1"] .ns-text-editing');
    expect(ed).toBeTruthy();
    MEASURE = { w: 200, h: 64 }; // the text grows while typing
    let changes = 0;
    layout.on("change", () => changes++);
    for (const text of ["hello w", "hello world"]) {
      ed.innerText = text;
      ed.dispatchEvent(new Event("input", { bubbles: true }));
    }
    raf.step(); // any (wrongly) scheduled size write would land here
    let t = item(layout);
    expect(t.text).toBe("hello world");
    expect(changes).toBe(2); // one text write per input — nothing else
    expect([t.w, t.h]).toEqual([120, 40]); // no per-keystroke size writes
    ed.dispatchEvent(new Event("blur")); // commit
    await flush(5);
    t = item(layout);
    expect(t.text).toBe("hello world");
    expect([t.w, t.h]).toEqual([200, 64]); // the committed size persisted
  });
});

describe("style txn and move txn stay clean of measurement writes", () => {
  it("undoing a fontSize change keeps the measured size, then the measurer converges", async () => {
    const raf = fakeRaf();
    mockTextMeasure();
    MEASURE = { w: 120, h: 40 };
    const { element, layout, host } = await mountCanvas([structuredClone(TEXT)]);
    raf.step();
    // select the item the way a user does
    const st = element.querySelector('[data-item-id="t1"] .ns-text-static');
    ptr("pointerdown", st, 110, 110);
    ptr("pointerup", window, 110, 110);
    await flush(5);
    MEASURE = { w: 220, h: 60 }; // the bigger font measures bigger
    host.set("size", 34); // → fontSize via the panel (a "style" transact)
    let t = item(layout);
    expect(t.fontSize).toBe(34);
    expect([t.w, t.h]).toEqual([120, 40]); // measure write NOT inside the txn
    raf.step();
    t = item(layout);
    expect([t.w, t.h]).toEqual([220, 60]); // it lands after, outside the diff
    MEASURE = { w: 120, h: 40 };
    key("z"); // undo the style txn
    t = item(layout);
    expect(t.fontSize).toBe(20);
    expect([t.w, t.h]).toEqual([220, 60]); // w/h were NOT in the undo diff
    raf.step(); // the measurer re-measures the reverted font and converges
    t = item(layout);
    expect([t.w, t.h]).toEqual([120, 40]);
  });

  it("undo of a move restores x/y and leaves the measured size alone", async () => {
    const raf = fakeRaf();
    mockTextMeasure();
    MEASURE = { w: 120, h: 40 };
    const { element, layout } = await mountCanvas([structuredClone(TEXT)]);
    raf.step();
    const st = element.querySelector('[data-item-id="t1"] .ns-text-static');
    ptr("pointerdown", st, 110, 110);
    ptr("pointermove", window, 170, 130);
    raf.step(); // let a coalesced gesture write land (no-op on the sync path)
    ptr("pointerup", window, 170, 130);
    await flush(5);
    let t = item(layout);
    expect([t.x, t.y]).toEqual([160, 120]);
    key("z");
    raf.step(); // any measurer reaction would land here
    t = item(layout);
    expect([t.x, t.y]).toEqual([100, 100]);
    expect([t.w, t.h]).toEqual([120, 40]); // the measurer did not fight the undo
  });
});
