// ensureLayoutDoc — the folder referencing MULTIPLE complement docs under
// `@layouts: { canvas: url, dock: url, … }` (one per layout kind, lazy), with the
// legacy single-field `.sketch`/`.newspace` reference migrated ADDITIVELY into
// `@layouts.canvas` (and `.sketch` kept written for old clients). Exercised
// against a REAL in-memory repo (the harness), not stubs.
import { describe, it, expect } from "vitest";
import { makeRepo } from "../test-harness.js";
import {
  ensureLayout,
  ensureLayoutDoc,
  layoutDocUrl,
  SEED_IDS,
  MINIMAP_INLETS,
} from "./constants.js";

describe("layoutDocUrl (pure resolution)", () => {
  it("resolves @layouts entries by key", () => {
    const doc = { "@layouts": { canvas: "automerge:c", dock: "automerge:d" } };
    expect(layoutDocUrl(doc, "canvas")).toBe("automerge:c");
    expect(layoutDocUrl(doc, "dock")).toBe("automerge:d");
  });
  it("the legacy field WINS for canvas (old clients only converge on .sketch)", () => {
    expect(layoutDocUrl({ sketch: "automerge:legacy", "@layouts": { canvas: "automerge:new" } }, "canvas")).toBe("automerge:legacy");
    expect(layoutDocUrl({ newspace: "automerge:older" }, "canvas")).toBe("automerge:older");
  });
  it("legacy fields never leak into non-canvas keys", () => {
    expect(layoutDocUrl({ sketch: "automerge:legacy" }, "dock")).toBe(undefined);
  });
  it("returns undefined for a missing/absent reference", () => {
    expect(layoutDocUrl({}, "canvas")).toBe(undefined);
    expect(layoutDocUrl(null, "dock")).toBe(undefined);
  });
});

describe("ensureLayoutDoc — canvas (the migrated legacy path)", () => {
  it("creates the canvas complement lazily, writing BOTH @layouts.canvas and .sketch", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const fd = folder.doc();
    expect(fd["@layouts"].canvas).toBe(lh.url);
    expect(fd.sketch).toBe(lh.url); // back-compat: old clients follow .sketch
    // seeded like before: items (overlay chrome), layout, layers
    const ld = lh.doc();
    expect(Array.isArray(ld.items)).toBe(true);
    for (const id of SEED_IDS) expect(ld.items.some((i) => i.id === id)).toBe(true);
    expect(ld.layout.component).toBe("sketchy");
    expect(Array.isArray(ld.layers)).toBe(true);
  });

  it("migrates legacy top-level folder items into the new canvas doc", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [], items: [{ id: "old1", kind: "shape", x: 1, y: 2 }] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    expect(lh.doc().items.some((i) => i.id === "old1")).toBe(true);
    expect(folder.doc().items.length).toBe(0); // emptied via splice, never deleted
  });

  it("adopts a legacy .newspace reference: mirrors to @layouts.canvas + writes .sketch, keeps .newspace", async () => {
    const repo = makeRepo();
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
    const folder = repo.create({ title: "t", docs: [], newspace: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    expect(lh.url).toBe(layout.url); // reused, not recreated
    const fd = folder.doc();
    expect(fd["@layouts"].canvas).toBe(layout.url);
    expect(fd.sketch).toBe(layout.url);
    expect(fd.newspace).toBe(layout.url); // additive — the old field survives
  });

  it("adopts a legacy .sketch reference into @layouts.canvas", async () => {
    const repo = makeRepo();
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    await ensureLayoutDoc(repo, folder, "canvas");
    expect(folder.doc()["@layouts"].canvas).toBe(layout.url);
    expect(folder.doc().sketch).toBe(layout.url);
  });

  it("is idempotent — a second ensure returns the SAME complement doc", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const a = await ensureLayoutDoc(repo, folder, "canvas");
    const b = await ensureLayoutDoc(repo, folder, "canvas");
    expect(b.url).toBe(a.url);
  });

  it("ensureLayout (every existing caller) is the canvas path", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayout(repo, folder);
    expect(folder.doc()["@layouts"].canvas).toBe(lh.url);
    expect(folder.doc().sketch).toBe(lh.url);
  });

  it("preserves the tombstone-aware seed upgrade: a null inlet (explicit unwire) is NOT rewired", async () => {
    const repo = makeRepo();
    const layout = repo.create({
      "@patchwork": { type: "sketch-layout" },
      items: [{ id: "ns-minimap", kind: "editor", editorId: "minimap", layer: "overlay", anchor: "bottom-left", x: 16, y: 16, w: 184, h: 136, rotation: 0, inlets: { rects: null } }],
    });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const mm = lh.doc().items.find((i) => i.id === "ns-minimap");
    expect(mm.inlets.rects).toBe(null); // the tombstone survives
  });

  it("respects dismissedSeeds — a deleted seed stays deleted", async () => {
    const repo = makeRepo();
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [], dismissedSeeds: ["ns-minimap"] });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    expect(lh.doc().items.some((i) => i.id === "ns-minimap")).toBe(false);
    expect(lh.doc().items.some((i) => i.id === "ns-zoom")).toBe(true); // others still seed
  });

  it("upgrades a genuinely-unwired minimap seed to the canonical inlets", async () => {
    const repo = makeRepo();
    const layout = repo.create({
      "@patchwork": { type: "sketch-layout" },
      items: [{ id: "ns-minimap", kind: "editor", editorId: "minimap", layer: "overlay", anchor: "bottom-left", x: 1, y: 1, w: 10, h: 10, rotation: 0, inlets: {} }],
    });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const mm = lh.doc().items.find((i) => i.id === "ns-minimap");
    expect(JSON.parse(JSON.stringify(mm.inlets))).toEqual(MINIMAP_INLETS);
  });
});

describe("ensureLayoutDoc — multiple keys", () => {
  it("creates a SEPARATE complement per layout key, lazily", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const canvas = await ensureLayoutDoc(repo, folder, "canvas");
    const dock = await ensureLayoutDoc(repo, folder, "dock");
    expect(dock.url).not.toBe(canvas.url);
    const fd = folder.doc();
    expect(fd["@layouts"].canvas).toBe(canvas.url);
    expect(fd["@layouts"].dock).toBe(dock.url);
  });

  it("a non-canvas key never touches the legacy fields", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    await ensureLayoutDoc(repo, folder, "dock");
    const fd = folder.doc();
    expect(fd.sketch).toBe(undefined);
    expect(fd.newspace).toBe(undefined);
    expect(fd["@layouts"].dock).toBeTruthy();
  });

  it("a non-canvas complement keeps the sketch-layout doc shape (items:[]) without canvas seeding", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const dock = await ensureLayoutDoc(repo, folder, "dock");
    const dd = dock.doc();
    expect(dd["@patchwork"].type).toBe("sketch-layout");
    expect(JSON.parse(JSON.stringify(dd.items))).toEqual([]); // no overlay chrome seeded
    expect(dd.layout).toBe(undefined);
  });

  it("is idempotent per key", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const a = await ensureLayoutDoc(repo, folder, "dock");
    const b = await ensureLayoutDoc(repo, folder, "dock");
    expect(b.url).toBe(a.url);
  });

  it("keys accumulate — adding dock/list leaves canvas untouched", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const canvas = await ensureLayoutDoc(repo, folder, "canvas");
    await ensureLayoutDoc(repo, folder, "dock");
    await ensureLayoutDoc(repo, folder, "list");
    const m = folder.doc()["@layouts"];
    expect(Object.keys(JSON.parse(JSON.stringify(m))).sort()).toEqual(["canvas", "dock", "list"]);
    expect(m.canvas).toBe(canvas.url);
    expect(folder.doc().sketch).toBe(canvas.url);
  });
});
