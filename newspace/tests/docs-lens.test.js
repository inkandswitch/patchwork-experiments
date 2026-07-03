import { describe, it, expect } from "vitest";
import { docsLens } from "../src/docs-lens.js";
import { Opstream, splice } from "../src/opstreams.js";
import { linkItemId } from "../src/model.js";
import { ASIDE_ID } from "../src/brush/constants.js";

const link = (url, type = "essay") => ({ url, type, name: url });
const folderOf = (docs = []) => new Opstream({ docs });
const sketchOf = (items = []) => new Opstream({ items });

describe("docsLens (opstream)", () => {
  it("materializes an item for each folder link, written through to the sketch doc", () => {
    const folder = folderOf([link("automerge:a"), link("automerge:b")]);
    const sketch = sketchOf([]);
    const lens = docsLens(folder, sketch);
    expect(lens.items.value.map((i) => i.id)).toEqual([linkItemId("automerge:a"), linkItemId("automerge:b")]);
    expect(sketch.value.items.map((i) => i.url)).toEqual(["automerge:a", "automerge:b"]); // scope wrote back
    expect(lens.items.value[0]).toMatchObject({ kind: "doc", url: "automerge:a", parent: ASIDE_ID, w: 360, h: 280, rotation: 0, toolId: "" });
    expect(lens.items.value[0].x).toBeUndefined();
    lens.dispose();
  });

  it("materializes a frame for box-type links", () => {
    const lens = docsLens(folderOf([link("automerge:f", "folder")]), sketchOf([]));
    expect(lens.items.value[0]).toMatchObject({ kind: "frame", url: "automerge:f", parent: ASIDE_ID });
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
