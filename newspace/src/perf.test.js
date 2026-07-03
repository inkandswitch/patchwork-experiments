// PERF.md Phase 0 — the measurement scaffolding itself.
// rafBatch is the primitive Phase 1 builds on (coalesce gesture doc writes,
// flush-before-endTxn), so its semantics are pinned here: N schedules → ONE
// rAF callback, LATEST state wins, flush() runs the pending callback
// synchronously and clears it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { rafBatch, count, counters, frame, now, perFrame, __resetFrameLoop } from "./perf.js";
import { Canvas } from "./brush/canvas.jsx";

// a hand-cranked rAF: callbacks queue up until step() runs them
function fakeRaf() {
  let nextId = 1;
  const queue = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb) => { const id = nextId++; queue.set(id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id) => { queue.delete(id); });
  return {
    queue,
    get size() { return queue.size; },
    step(t = now()) { const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(t); },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("rafBatch", () => {
  it("coalesces N schedule() calls into ONE rAF callback", () => {
    const raf = fakeRaf();
    const b = rafBatch();
    const ran = [];
    b.schedule(() => ran.push(1));
    b.schedule(() => ran.push(2));
    b.schedule(() => ran.push(3));
    expect(raf.size).toBe(1); // one rAF, not three
    expect(b.pending).toBe(true);
    raf.step();
    expect(ran).toEqual([3]); // latest closure wins, runs exactly once
    expect(b.pending).toBe(false);
  });

  it("with a fixed fn, the LATEST args win", () => {
    const raf = fakeRaf();
    const write = vi.fn();
    const b = rafBatch(write);
    b.schedule(1, "a");
    b.schedule(2, "b");
    raf.step();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(2, "b");
  });

  it("flush() runs the pending callback synchronously and clears it (no double-run on the rAF)", () => {
    const raf = fakeRaf();
    const ran = [];
    const b = rafBatch();
    b.schedule(() => ran.push("stale"));
    b.schedule(() => ran.push("latest"));
    expect(b.flush()).toBe(true);
    expect(ran).toEqual(["latest"]); // ran NOW, latest state
    expect(b.pending).toBe(false);
    expect(raf.size).toBe(0); // rAF cancelled — the frame won't re-run it
    raf.step();
    expect(ran).toEqual(["latest"]);
    expect(b.flush()).toBe(false); // nothing pending → no-op
  });

  it("schedule works again after a flush (per-gesture reuse)", () => {
    const raf = fakeRaf();
    const ran = [];
    const b = rafBatch();
    b.schedule(() => ran.push(1));
    b.flush();
    b.schedule(() => ran.push(2));
    expect(b.pending).toBe(true);
    raf.step();
    expect(ran).toEqual([1, 2]);
  });

  it("cancel() drops the pending callback without running it", () => {
    const raf = fakeRaf();
    const ran = [];
    const b = rafBatch();
    b.schedule(() => ran.push(1));
    b.cancel();
    raf.step();
    expect(ran).toEqual([]);
    expect(b.flush()).toBe(false);
  });
});

describe("count / counters / frame / now", () => {
  it("count() accumulates named counters on window.__perf", () => {
    delete window.__perf;
    expect(count("x")).toBe(1);
    expect(count("x", 2)).toBe(3);
    expect(window.__perf.x).toBe(3);
    expect(counters()).toBe(window.__perf);
  });

  it("now() is a number and monotone-ish", () => {
    const a = now();
    expect(typeof a).toBe("number");
    expect(now()).toBeGreaterThanOrEqual(a);
  });

  it("frame() starts its loop lazily and bumps once per rAF", () => {
    const raf = fakeRaf();
    const n0 = frame(); // first use starts the loop
    expect(raf.size).toBe(1);
    raf.step();
    expect(frame()).toBe(n0 + 1);
    expect(raf.size).toBe(1); // loop re-armed
    raf.step();
    expect(frame()).toBe(n0 + 2);
  });

  it("frame() restarts a STRANDED loop through the CURRENT global rAF (stall self-heal)", () => {
    __resetFrameLoop(); // forget whatever loop an earlier test left behind
    let t = 1000;
    vi.stubGlobal("performance", { now: () => t }); // drive the stall clock
    const raf1 = fakeRaf();
    const n0 = frame(); // loop armed in raf1's queue
    raf1.step();
    expect(frame()).toBe(n0 + 1);
    // strand the re-arm: a NEW fake rAF discards raf1's queue (what a test file
    // mounting a canvas + fakeRaf + unstubAllGlobals does to the shared loop)
    const raf2 = fakeRaf();
    expect(raf2.size).toBe(0); // the old tick is stuck in the dead queue
    t += 1000; // well past STALL_MS
    const n1 = frame(); // detects the stall and re-arms on the CURRENT rAF
    expect(raf2.size).toBe(1);
    raf2.step();
    expect(frame()).toBe(n1 + 1); // ticking again — perFrame caches expire once more
    __resetFrameLoop(); // don't leak this test's loop into the next one
  });
});

// Phase 3's viewport-rect cache: read once per frame, fresh next frame, and
// NEVER stale when the frame loop isn't ticking (headless / pre-first-rAF).
describe("perFrame", () => {
  it("two reads in the same frame → ONE underlying call; the next frame reads fresh", () => {
    let f = 1;
    const read = vi.fn(() => ({ at: f }));
    const cached = perFrame(read, () => f);
    const a = cached();
    expect(cached()).toBe(a); // same frame ⇒ the cached object, no second read
    expect(read).toHaveBeenCalledTimes(1);
    f = 2;
    const b = cached();
    expect(read).toHaveBeenCalledTimes(2);
    expect(b).not.toBe(a);
    expect(cached()).toBe(b);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("degrades to a fresh read per call while the frame counter is stuck at 0", () => {
    const read = vi.fn(() => ({}));
    const cached = perFrame(read, () => 0);
    cached(); cached(); cached();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("a PAUSED counter (started, then frozen > 0 — hidden tab) unpins on visibilitychange", () => {
    // rAF stops in hidden tabs while remote-change effects keep running: the
    // frame counter freezes at some N > 0, so without the visibility epoch the
    // cache would return the pre-hide value forever.
    const read = vi.fn(() => ({}));
    const cached = perFrame(read, () => 7); // the loop ticked, then paused
    const a = cached();
    expect(cached()).toBe(a); // frozen counter ⇒ pinned…
    expect(read).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange")); // …until visibility flips
    const b = cached();
    expect(read).toHaveBeenCalledTimes(2); // first read after the flip is FRESH
    expect(b).not.toBe(a);
    expect(cached()).toBe(b); // and it caches again within the new epoch
    expect(read).toHaveBeenCalledTimes(2);
  });
});

// ---- baseline pin: a real drag gesture writes the doc (≥1 docWrite) --------
// Mounts the REAL Canvas (happy-dom, in-memory repo) like canvas-chrome.test.js
// and drags a stroke; Phase 1 will tighten this to ≤1 write per frame.

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: x, clientY: y }));

describe("gesture instrumentation", () => {
  it("dragging an item counts docWrite (≥1 per gesture) and moves it", async () => {
    const repo = new Repo({});
    const stroke = { id: "s1", kind: "stroke", points: [[0, 0, 0.5], [30, 30, 0.5]], x: 500, y: 500, color: "line", size: 4, rotation: 0 };
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [stroke] });
    const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
    const element = document.createElement("div");
    document.body.append(element);
    const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
    try {
      await flush();
      const hit = element.querySelector('[data-item-id="s1"] .ns-hit');
      expect(hit).toBeTruthy();
      const before = (window.__perf && window.__perf.docWrite) || 0;
      ptr("pointerdown", hit, 505, 505);
      ptr("pointermove", window, 525, 515);
      ptr("pointermove", window, 545, 525);
      ptr("pointerup", window, 545, 525);
      await flush(10);
      const wrote = ((window.__perf && window.__perf.docWrite) || 0) - before;
      expect(wrote).toBeGreaterThanOrEqual(1); // baseline pin — Phase 1 caps it per-frame
      const it0 = layout.doc().items.find((x) => x.id === "s1");
      expect(it0.x).toBe(540); // 500 + (545 − 505): the writes actually landed
      expect(it0.y).toBe(520);
    } finally {
      dispose();
      element.remove();
    }
  });
});
