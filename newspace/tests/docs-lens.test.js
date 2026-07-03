import { describe, it, expect, vi } from "vitest";
import { createDocsLens, docsLens } from "../src/docs-lens.js";
import { Opstream, splice } from "../src/opstreams.js";
import { linkItemId } from "../src/model.js";

// a fake layout doc + a `change(fn)` that runs fn against it in place (the shape the lens
// expects: change((d) => d.items.push/splice)). Returns the doc so assertions read its items.
function fakeDoc(items = []) {
  const doc = { items };
  return { doc, change: (fn) => fn(doc) };
}
const link = (url, type = "essay") => ({ url, type, name: url });

describe("createDocsLens.reconcile", () => {
  it("materializes one deterministic doc item per un-materialized folder link", () => {
    const lens = createDocsLens();
    const { doc, change } = fakeDoc();
    lens.reconcile([link("automerge:a"), link("automerge:b")], doc.items, change, () => ({ x: 100, y: 200 }));
    expect(doc.items.map((i) => i.id)).toEqual([linkItemId("automerge:a"), linkItemId("automerge:b")]);
    expect(doc.items[0]).toMatchObject({ kind: "doc", url: "automerge:a", x: 100, y: 200, w: 360, h: 280, rotation: 0, toolId: "" });
    expect(doc.items[1]).toMatchObject({ x: 128, y: 228 }); // second staggers by 28
  });

  it("materializes a frame for box-type links (folder/sketch/newspace)", () => {
    const lens = createDocsLens();
    const { doc, change } = fakeDoc();
    lens.reconcile([link("automerge:f", "folder")], doc.items, change, () => ({ x: 0, y: 0 }));
    expect(doc.items[0]).toMatchObject({ kind: "frame", url: "automerge:f" });
    expect(doc.items[0].toolId).toBeUndefined(); // frames don't carry doc-only fields
  });

  it("skips links that already have an item, and never writes when nothing is missing", () => {
    const lens = createDocsLens();
    const existing = { id: linkItemId("automerge:a"), kind: "doc", url: "automerge:a", x: 1, y: 1, w: 360, h: 280 };
    const { doc, change } = fakeDoc([existing]);
    const place = vi.fn(() => ({ x: 0, y: 0 }));
    lens.reconcile([link("automerge:a")], doc.items, change, place);
    expect(doc.items).toEqual([existing]); // untouched
    expect(place).not.toHaveBeenCalled(); // placeBase read lazily — not even called with nothing to do
  });

  it("refuses to re-materialize a tombstoned url (delete can't lose the race)", () => {
    const lens = createDocsLens();
    lens.tombstone("automerge:gone");
    const { doc, change } = fakeDoc();
    lens.reconcile([link("automerge:gone")], doc.items, change, () => ({ x: 0, y: 0 }));
    expect(doc.items).toEqual([]);
  });
});

describe("createDocsLens.dedupe", () => {
  it("collapses items whose id repeats (two peers, same deterministic id) — keeps the first", () => {
    const lens = createDocsLens();
    const id = linkItemId("automerge:a");
    const { doc, change } = fakeDoc([
      { id, url: "automerge:a", x: 0 },
      { id, url: "automerge:a", x: 9 },
      { id: "other", url: "automerge:b" },
    ]);
    lens.dedupe(doc.items, change);
    expect(doc.items.map((i) => i.id)).toEqual([id, "other"]);
    expect(doc.items[0].x).toBe(0); // the earlier one survives
  });

  it("preserves alt-drag copies (same url, unique ids)", () => {
    const lens = createDocsLens();
    const { doc, change } = fakeDoc([
      { id: "li-1", url: "automerge:a" },
      { id: "li-2", url: "automerge:a" },
    ]);
    lens.dedupe(doc.items, change);
    expect(doc.items).toHaveLength(2);
  });
});

describe("createDocsLens.unlinkForDelete", () => {
  it("unlinks + tombstones when removing the LAST shape for a url", () => {
    const lens = createDocsLens();
    const items = [{ id: "s1", kind: "doc", url: "automerge:a" }];
    const folder = fakeDoc();
    folder.doc.docs = [link("automerge:a")];
    const unlinked = lens.unlinkForDelete(items, "automerge:a", new Set(["s1"]), (fn) => fn(folder.doc));
    expect(unlinked).toBe(true);
    expect(folder.doc.docs).toEqual([]);
    expect(lens.isTombstoned("automerge:a")).toBe(true);
  });

  it("does NOT unlink while another (un-deleted) shape still references the url", () => {
    const lens = createDocsLens();
    const items = [
      { id: "s1", kind: "doc", url: "automerge:a" },
      { id: "s2", kind: "doc", url: "automerge:a" }, // a copy that survives
    ];
    const folder = fakeDoc();
    folder.doc.docs = [link("automerge:a")];
    const change = vi.fn();
    const unlinked = lens.unlinkForDelete(items, "automerge:a", new Set(["s1"]), change);
    expect(unlinked).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(lens.isTombstoned("automerge:a")).toBe(false);
  });
});

describe("createDocsLens tombstone lifecycle", () => {
  it("clears the tombstone after tombstoneMs", () => {
    vi.useFakeTimers();
    try {
      const lens = createDocsLens({ tombstoneMs: 1500 });
      lens.tombstone("automerge:a");
      expect(lens.isTombstoned("automerge:a")).toBe(true);
      vi.advanceTimersByTime(1499);
      expect(lens.isTombstoned("automerge:a")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(lens.isTombstoned("automerge:a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose clears pending timers and tombstones", () => {
    const cleared = [];
    const lens = createDocsLens({ setTimeoutImpl: () => 42, clearTimeoutImpl: (t) => cleared.push(t) });
    lens.tombstone("automerge:a");
    expect(lens.isTombstoned("automerge:a")).toBe(true);
    lens.dispose();
    expect(cleared).toEqual([42]);
    expect(lens.isTombstoned("automerge:a")).toBe(false);
  });
});

describe("createDocsLens convergence (two peers, same link)", () => {
  it("both peers materialize the same id → after merge, dedupe collapses to one shape", () => {
    const lensA = createDocsLens(), lensB = createDocsLens();
    // each peer reconciles its OWN replica (the url-guard prevents a same-replica dup)
    const a = fakeDoc(), b = fakeDoc();
    lensA.reconcile([link("automerge:x")], a.doc.items, a.change, () => ({ x: 0, y: 0 }));
    lensB.reconcile([link("automerge:x")], b.doc.items, b.change, () => ({ x: 50, y: 50 }));
    expect(a.doc.items[0].id).toBe(b.doc.items[0].id); // same deterministic id
    // automerge merges two concurrent pushes as two array elements; the dedupe pass collapses
    const merged = fakeDoc([...a.doc.items, ...b.doc.items]);
    expect(merged.doc.items).toHaveLength(2);
    lensA.dedupe(merged.doc.items, merged.change);
    expect(merged.doc.items).toHaveLength(1);
    expect(merged.doc.items[0].id).toBe(linkItemId("automerge:x"));
  });
});

// ── the OPSTREAM lens: driven against real Opstreams (exercises scope write-back) ──
const folderOf = (docs = []) => new Opstream({ docs });
const sketchOf = (items = []) => new Opstream({ items });

describe("docsLens (opstream)", () => {
  it("materializes an item for each folder link, written through to the sketch doc", () => {
    const folder = folderOf([link("automerge:a"), link("automerge:b")]);
    const sketch = sketchOf([]);
    const lens = docsLens(folder, sketch);
    expect(lens.items.value.map((i) => i.id)).toEqual([linkItemId("automerge:a"), linkItemId("automerge:b")]);
    expect(sketch.value.items.map((i) => i.url)).toEqual(["automerge:a", "automerge:b"]); // scope wrote back
    expect(lens.items.value[0]).toMatchObject({ kind: "doc", url: "automerge:a", w: 360, h: 280, rotation: 0, toolId: "" });
    lens.dispose();
  });

  it("materializes a frame for box-type links", () => {
    const lens = docsLens(folderOf([link("automerge:f", "folder")]), sketchOf([]));
    expect(lens.items.value[0]).toMatchObject({ kind: "frame", url: "automerge:f" });
    expect(lens.items.value[0].toolId).toBeUndefined();
    lens.dispose();
  });

  it("reacts to a link ADDED after wiring", () => {
    const folder = folderOf([]);
    const lens = docsLens(folder, sketchOf([]));
    expect(lens.items.value).toEqual([]);
    folder.apply(splice(["docs"], 0, 0, [link("automerge:late")]));
    expect(lens.items.value.map((i) => i.url)).toEqual(["automerge:late"]);
    lens.dispose();
  });

  it("removing the LAST shape drops the folder link and tombstones the url (no re-add)", () => {
    const folder = folderOf([link("automerge:a")]);
    const lens = docsLens(folder, sketchOf([]));
    expect(lens.items.value).toHaveLength(1);
    lens.items.apply(splice([], 0, 1, [])); // the component deletes the shape
    expect(lens.items.value).toEqual([]);        // stays gone (not recreated)
    expect(folder.value.docs).toEqual([]);       // folder link dropped
    expect(lens.isTombstoned("automerge:a")).toBe(true);
    lens.dispose();
  });

  it("removing ONE of two copies keeps the folder link (last-shape only)", () => {
    const folder = folderOf([link("automerge:a")]);
    // two shapes for one url (alt-drag copy): seed the sketch directly, unique ids
    const sketch = sketchOf([
      { id: "li-a", kind: "doc", url: "automerge:a", x: 0, y: 0, w: 360, h: 280 },
      { id: "copy", kind: "doc", url: "automerge:a", x: 40, y: 40, w: 360, h: 280 },
    ]);
    const lens = docsLens(folder, sketch);
    lens.items.apply(splice([], 1, 2, [])); // delete the copy (range [from,to))
    expect(folder.value.docs).toHaveLength(1); // still linked — a shape remains
    expect(lens.isTombstoned("automerge:a")).toBe(false);
    lens.dispose();
  });

  it("collapses two peers' identical materializations to one (dedupe on seed)", () => {
    const sketch = sketchOf([
      { id: linkItemId("automerge:a"), kind: "doc", url: "automerge:a", x: 0, y: 0 },
      { id: linkItemId("automerge:a"), kind: "doc", url: "automerge:a", x: 9, y: 9 }, // the doubled push
    ]);
    const lens = docsLens(folderOf([link("automerge:a")]), sketch);
    expect(lens.items.value).toHaveLength(1);
    expect(lens.items.value[0].x).toBe(0); // earlier survives
    lens.dispose();
  });

  it("dispose stops driving (a later folder change no longer materializes)", () => {
    const folder = folderOf([]);
    const lens = docsLens(folder, sketchOf([]));
    lens.dispose();
    folder.apply(splice(["docs"], 0, 0, [link("automerge:a")]));
    expect(lens.items.value).toEqual([]);
  });
});
