// CUT / COPY / PASTE — the selection over the system clipboard as plain JSON
// text ({ type: "sketchy/items", items }): copy serializes, cut = copy + the
// undoable delete, paste instantiates FRESH ids preserving the relative
// arrangement. Real Canvas mounts (happy-dom + in-memory repo), driven by
// dispatched ClipboardEvents; the isTypingTarget guard keeps embeds' clipboards
// untouched.
import { describe, it, expect, afterEach } from "vitest";
import { render } from "solid-js/web";
import { Repo } from "@automerge/automerge-repo";
import { Canvas } from "../src/brush/canvas.jsx";
import { worldToLocal } from "../src/model.js";

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];
if (!document.elementFromPoint) document.elementFromPoint = () => null;

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

// a ClipboardEvent stand-in (happy-dom's constructor lacks clipboardData)
function clipEvent(type, data = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const store = { ...data };
  e.clipboardData = {
    items: [],
    setData: (t, v) => { store[t] = v; },
    getData: (t) => store[t] || "",
  };
  e.store = store;
  return e;
}

// select an item the way a user does: press its hit area, release
async function select(element, id) {
  const hit = element.querySelector(`[data-item-id="${id}"] .ns-hit`);
  expect(hit).toBeTruthy();
  hit.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
  await flush(10);
}

const SHAPES = [
  { id: "s1", kind: "shape", type: "rectangle", x: 10, y: 10, w: 50, h: 40, color: "line", fill: "none", strokeWidth: 2, roughness: 1.5, bowing: 0.1, fillStyle: "solid", seed: 7, rotation: 0 },
  { id: "s2", kind: "shape", type: "rectangle", x: 110, y: 40, w: 30, h: 30, color: "red", fill: "none", strokeWidth: 2, roughness: 1.5, bowing: 0.1, fillStyle: "solid", seed: 8, rotation: 0, group: "gA" },
];

describe("copy", () => {
  it("⌘C serializes the selection to text/plain as sketchy/items JSON", async () => {
    const { element } = await mountCanvas(SHAPES.map((s) => ({ ...s })));
    await select(element, "s1");
    const e = clipEvent("copy");
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const payload = JSON.parse(e.store["text/plain"]);
    expect(payload.type).toBe("sketchy/items");
    expect(payload.items.length).toBe(1);
    expect(payload.items[0]).toMatchObject({ id: "s1", kind: "shape", w: 50, h: 40 });
  });

  it("does nothing with no selection, and never hijacks a typing target", async () => {
    const { element } = await mountCanvas(SHAPES.map((s) => ({ ...s })));
    const none = clipEvent("copy");
    window.dispatchEvent(none);
    expect(none.defaultPrevented).toBe(false);
    // an input (an embed's field) owns its own clipboard
    await select(element, "s1");
    const input = document.createElement("input");
    document.body.append(input);
    const typed = clipEvent("copy");
    input.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    input.remove();
  });
});

describe("cut", () => {
  it("⌘X copies then deletes (the ordinary undoable delete)", async () => {
    const { element, layout } = await mountCanvas(SHAPES.map((s) => ({ ...s })));
    await select(element, "s1");
    const e = clipEvent("cut");
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(JSON.parse(e.store["text/plain"]).items[0].id).toBe("s1");
    await flush(20); // the delete lands a microtask later (removeItems)
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(false);
    // undo restores it (the delete was recorded like Backspace)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }));
    await flush(10);
    expect(layout.doc().items.some((x) => x.id === "s1")).toBe(true);
  });
});

describe("paste", () => {
  it("instantiates fresh ids, preserves the relative arrangement, remaps groups, and selects the copies", async () => {
    const { element, layout } = await mountCanvas(SHAPES.map((s) => ({ ...s })));
    // copy BOTH via marquee-free path: select s1, shift-select s2
    await select(element, "s1");
    const hit2 = element.querySelector('[data-item-id="s2"] .ns-hit');
    hit2.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    await flush(10);
    const copy = clipEvent("copy");
    window.dispatchEvent(copy);
    const text = copy.store["text/plain"];
    expect(JSON.parse(text).items.length).toBe(2);
    const before = layout.doc().items.length;
    const paste = clipEvent("paste", { "text/plain": text });
    window.dispatchEvent(paste);
    await flush(20);
    expect(paste.defaultPrevented).toBe(true);
    const items = layout.doc().items;
    expect(items.length).toBe(before + 2);
    const fresh = items.filter((x) => x.kind === "shape" && x.id !== "s1" && x.id !== "s2");
    expect(fresh.length).toBe(2);
    // fresh ids, same relative offset between the two
    const [a, b] = fresh[0].seed === 7 ? fresh : [fresh[1], fresh[0]];
    expect(b.x - a.x).toBe(100);
    expect(b.y - a.y).toBe(30);
    // the copied group got a FRESH group id (no accidental link to the source)
    expect(b.group).toBeTruthy();
    expect(b.group).not.toBe("gA");
    // paste works "across sketches": it's just text — a second canvas takes the same payload
    const other = await mountCanvas([]);
    const paste2 = clipEvent("paste", { "text/plain": text });
    window.dispatchEvent(paste2);
    await flush(20);
    expect(other.layout.doc().items.filter((x) => x.kind === "shape").length).toBe(2);
  });

  // ── paste into an ENTERED frame — the pasted items must land in FRAME-LOCAL
  // coords (origin AND rotation folded in), not raw world coords offset by the
  // frame origin. The paste anchor here is the world origin (no cursor ⇒
  // centerWorld, and the headless viewport centre is (0,0) at cam {0,0,1}).
  async function mountWithFrame(frameProps = {}) {
    const repo = new Repo({});
    const childLayout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [
      { id: "c1", kind: "shape", type: "rectangle", x: 20, y: 20, w: 40, h: 30, color: "line", fill: "none", strokeWidth: 2, roughness: 1.5, bowing: 0.1, fillStyle: "solid", seed: 3, rotation: 0 },
    ] });
    const childFolder = repo.create({ title: "box", docs: [], sketch: childLayout.url });
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [
      { id: "f1", kind: "frame", url: childFolder.url, x: 100, y: 50, w: 400, h: 300, ...frameProps },
    ] });
    const folder = repo.create({ title: "test", docs: [{ name: "box", type: "folder", url: childFolder.url }], sketch: layout.url });
    const element = document.createElement("div");
    document.body.append(element);
    const dispose = render(() => Canvas({ handle: folder, repo, element, opts: {} }), element);
    mounted.push({ element, dispose });
    await flush(40);
    return { repo, layout, childLayout, folder, element };
  }
  const payload = () => JSON.stringify({ type: CLIP_KIND_TEXT, items: [{ ...SHAPES[0] }] });
  const CLIP_KIND_TEXT = "sketchy/items";

  it("into an entered frame: the anchor converts to the frame's space (no origin offset)", async () => {
    const m = await mountWithFrame();
    await select(m.element, "c1"); // selecting a child ENTERS the frame's surface
    const e = clipEvent("paste", { "text/plain": payload() });
    window.dispatchEvent(e);
    await flush(20);
    const fresh = m.childLayout.doc().items.find((x) => x.kind === "shape" && x.id !== "c1");
    expect(fresh).toBeTruthy();
    const [ex, ey] = worldToLocal({ x: 100, y: 50, w: 400, h: 300, rotation: 0 }, 0, 0);
    expect(fresh.x + fresh.w / 2).toBeCloseTo(ex, 4);
    expect(fresh.y + fresh.h / 2).toBeCloseTo(ey, 4);
    expect(fresh.layers).toBeUndefined(); // frame children carry no layer tags
  });

  it("into a ROTATED frame: rotation folds into the local coords like pushItem's conversion", async () => {
    const m = await mountWithFrame({ rotation: 30 });
    await select(m.element, "c1");
    const e = clipEvent("paste", { "text/plain": payload() });
    window.dispatchEvent(e);
    await flush(20);
    const fresh = m.childLayout.doc().items.find((x) => x.kind === "shape" && x.id !== "c1");
    expect(fresh).toBeTruthy();
    const [ex, ey] = worldToLocal({ x: 100, y: 50, w: 400, h: 300, rotation: 30 }, 0, 0);
    expect(fresh.x + fresh.w / 2).toBeCloseTo(ex, 4);
    expect(fresh.y + fresh.h / 2).toBeCloseTo(ey, 4);
    // the item counter-rotates so it keeps its world orientation (convertToLocal)
    expect(fresh.rotation).toBeCloseTo(-30, 4);
  });

  it("non-sketchy text falls through untouched (the image-paste path still owns files)", async () => {
    const { layout } = await mountCanvas([]);
    const before = layout.doc().items.length;
    const e = clipEvent("paste", { "text/plain": "just some words" });
    window.dispatchEvent(e);
    await flush(10);
    expect(e.defaultPrevented).toBe(false);
    expect(layout.doc().items.length).toBe(before);
  });
});
