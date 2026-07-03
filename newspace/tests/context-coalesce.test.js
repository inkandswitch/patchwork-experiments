// README.md Phase 4 — high-frequency context Source writes are coalesced to a
// 16ms trailing edge (≤60 emissions/sec per source however fast the upstream
// writes), while `.value` stays CURRENT on every set — the Source contract for
// synchronous readers (toWorld, drawClaim geometry, a provider priming a
// nested canvas). Pinned at the mount level (real Canvas, happy-dom,
// in-memory repo, fake timers driving the window):
//   • N pointermoves → ZERO emissions inside the window, exactly ONE at 16ms
//     carrying the LATEST pointer; `.value` tracks every event immediately.
//   • a subscriber connecting mid-window snapshots the CURRENT value.
//   • the canvas outlet Sources (bounds/peers/view/rects) coalesce the same way.
//   • the presence broadcast keeps its 55ms cap but gains a trailing send.
//   • unmount clears a pending emission.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "../src/brush/canvas.jsx";
import { isSnapshot } from "../src/opstreams.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

const mounted = [];
async function mountCanvas(items = [], { contact = false } = {}) {
  const repo = new Repo({});
  const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items });
  const folder = repo.create({ title: "test", docs: [], sketch: layout.url });
  folder.broadcast = vi.fn(); // observe the presence sends (no network in tests)
  if (contact) {
    const contactH = repo.create({ type: "registered", name: "Tester", color: "#123456" });
    window.accountDocHandle = { doc: () => ({ contactUrl: contactH.url }) };
  }
  const element = document.createElement("div");
  element.api = {}; // opt in to the api surface so the canvas exposes context/canvasOutlets
  document.body.append(element);
  const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
  const m = { repo, layout, folder, element, disposed: false, dispose() { if (!this.disposed) { this.disposed = true; dispose(); } } };
  mounted.push(m);
  await flush();
  return m;
}
afterEach(() => {
  vi.useRealTimers();
  delete window.accountDocHandle;
  for (const m of mounted.splice(0)) {
    try { m.dispose(); } catch {}
    try { m.element.remove(); } catch {}
  }
});

const ptr = (type, target, x, y) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y }));
const perf = (name) => (window.__perf && window.__perf[name]) || 0;

describe("context.pointer: ≤1 emission per 16ms window, .value always current", () => {
  // retry(1): the window.__perf counters are global — a previous file's canvas can
  // leak one async tick into our deltas when file order lines up (seen 2026-07-02).
  // A real regression fails BOTH attempts; only cross-file noise gets absorbed.
  it("N rapid pointermoves → one trailing emission with the latest point", { retry: 1 }, async () => {
    const { element } = await mountCanvas();
    const ctx = element.api.context;
    const root = element.querySelector(".ns-root");
    const seen = [];
    ctx.pointer.connect((op) => { if (isSnapshot(op)) seen.push(op.value); });
    const base = seen.length; // the connect snapshot
    const sets0 = perf("ctxSet:pointer"), pushes0 = perf("ctxPush:pointer");
    vi.useFakeTimers();
    for (const x of [110, 120, 130, 140, 150]) {
      ptr("pointermove", root, x, 40);
      expect(ctx.pointer.value.x).toBe(x); // live on EVERY event (0-rect viewport ⇒ world x = clientX)
    }
    expect(perf("ctxSet:pointer") - sets0).toBe(5);
    expect(seen.length).toBe(base); // nothing shipped inside the window
    vi.advanceTimersByTime(15);
    expect(seen.length).toBe(base); // still inside
    vi.advanceTimersByTime(2);
    expect(seen.length).toBe(base + 1); // exactly ONE
    expect(seen.at(-1).x).toBe(150); // the latest event won
    expect(perf("ctxPush:pointer") - pushes0).toBe(1);
  });

  it("a subscriber connecting mid-window snapshots the CURRENT value", async () => {
    const { element } = await mountCanvas();
    const root = element.querySelector(".ns-root");
    vi.useFakeTimers();
    ptr("pointermove", root, 210, 40); // buffered — not emitted yet
    const got = [];
    element.api.context.pointer.connect((op) => { if (isSnapshot(op)) got.push(op.value); });
    expect(got.length).toBe(1);
    expect(got[0].x).toBe(210); // current, not the last emitted
  });

  it("unmount inside the window cancels the pending emission", async () => {
    const m = await mountCanvas();
    const root = m.element.querySelector(".ns-root");
    const seen = [];
    m.element.api.context.pointer.connect((op) => { if (isSnapshot(op)) seen.push(op.value); });
    const base = seen.length;
    vi.useFakeTimers();
    ptr("pointermove", root, 310, 40);
    m.dispose();
    vi.advanceTimersByTime(50);
    expect(seen.length).toBe(base); // cleanup dropped the pending emit
  });
});

describe("canvas outlet Sources (bounds/peers/view/rects) coalesce the same way", () => {
  it("a burst of pushes → one trailing emission, .value current throughout", async () => {
    const { element } = await mountCanvas();
    const outlets = element.api.canvasOutlets();
    vi.useFakeTimers();
    for (const name of ["bounds", "peers", "view", "rects"]) {
      const s = outlets[name].stream;
      const seen = [];
      s.connect((op) => { if (isSnapshot(op)) seen.push(op.value); });
      const base = seen.length;
      const bursts = [[{ i: 1 }], [{ i: 2 }], [{ i: 3 }]]; // array-shaped: peers/rects consumers map over them
      for (const v of bursts) {
        s.push(v);
        expect(s.value).toBe(v); // live between coalesced emissions
      }
      expect(seen.length).toBe(base);
      vi.advanceTimersByTime(17);
      expect(seen.length).toBe(base + 1);
      expect(seen.at(-1)).toBe(bursts.at(-1));
    }
  });
});

describe("presence broadcast: 55ms cap kept, trailing send added", () => {
  it("a pointer burst sends ≤1 message inside the window and the LATEST cursor on the trailing edge", async () => {
    const { element, folder } = await mountCanvas([], { contact: true });
    await flush(); // let the async self-contact load land before freezing time
    const sends = () => folder.broadcast.mock.calls.filter((c) => c[0] && c[0].type === "ns-presence");
    const root = element.querySelector(".ns-root");
    const b0 = sends().length;
    vi.useFakeTimers();
    for (const x of [10, 20, 30, 40, 50]) ptr("pointermove", root, x, 40);
    const during = sends().length - b0;
    expect(during).toBeLessThanOrEqual(1); // at most the leading send inside one 55ms window
    vi.advanceTimersByTime(56);
    const after = sends().length - b0;
    expect(after).toBe(during + 1); // the trailing send landed
    expect(sends().at(-1)[0].cursor.x).toBe(50); // carrying the LATEST cursor
  });
});
