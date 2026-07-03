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
  seedPartsFlap,
  SEED_IDS,
  MINIMAP_INLETS,
  PALETTE_INLETS,
  DEFAULT_TOOL_ENTRIES,
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
    // seeded like before: items (overlay chrome), layout, layers. ns-parts (the
    // PARTS FLAP) is the exception — it creates docs, so the ROOT canvas seeds
    // it async (seedPartsFlap), never ensureLayout (boxes must not grow flaps).
    const ld = lh.doc();
    expect(Array.isArray(ld.items)).toBe(true);
    for (const id of SEED_IDS.filter((x) => x !== "ns-parts")) expect(ld.items.some((i) => i.id === id)).toBe(true);
    expect(ld.items.some((i) => i.id === "ns-parts")).toBe(false);
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

  it("seeds the TOOLBAR-PALETTE window: overlay home + canvas membership, sticky bottom-centre, the standard tools", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const pal = lh.doc().items.find((i) => i.id === "ns-toolbar-palette");
    expect(pal).toBeTruthy();
    expect(pal.kind).toBe("editor");
    expect(pal.editorId).toBe("palette");
    expect([...pal.layers]).toEqual(["overlay", "canvas"]); // the membership showcase: usable while drawing
    expect(pal.layer).toBe("overlay"); // mirrored for old clients
    expect(JSON.parse(JSON.stringify(pal.sticky))).toEqual({ edge: "bottom", t: 0.5 });
    // entries are the model — the legacy `config.brushes` id list is a read-shim, never written
    expect(pal.config.brushes).toBeUndefined();
    expect(JSON.parse(JSON.stringify(pal.config.entries)).map((e) => e.id)).toEqual(["select", "hand", "pen", "eraser", "wire", "rectangle", "ellipse", "arrow", "text"]);
    // the WIRED PAIR: the palette's tools inlet is a real persisted wire to the
    // seeded palette-config window (the MINIMAP_INLETS convention)
    expect(JSON.parse(JSON.stringify(pal.inlets))).toEqual(PALETTE_INLETS);
  });

  it("seeds the palette-CONFIG window overlay-ONLY, carrying the old Toolbar's entry layout", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const cfg = lh.doc().items.find((i) => i.id === "ns-toolbar-config");
    expect(cfg).toBeTruthy();
    expect(cfg.editorId).toBe("palette-config");
    expect([...cfg.layers]).toEqual(["overlay"]); // overlay ONLY
    expect(JSON.parse(JSON.stringify(cfg.config.entries))).toEqual(DEFAULT_TOOL_ENTRIES);
  });

  it("seeds the PRESENCE window: overlay home + canvas membership (ambient), sticky bottom-right", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const pr = lh.doc().items.find((i) => i.id === "ns-presence");
    expect(pr).toBeTruthy();
    expect(pr.editorId).toBe("presence");
    expect([...pr.layers]).toEqual(["overlay", "canvas"]); // presence matters while drawing
    expect(JSON.parse(JSON.stringify(pr.sticky))).toEqual({ edge: "right", t: 0.9 });
  });

  it("UPGRADE wires an existing palette seed's tools inlet — but respects the null tombstone", async () => {
    const repo = makeRepo();
    const layout = repo.create({
      "@patchwork": { type: "sketch-layout" },
      items: [
        { id: "ns-toolbar-palette", kind: "editor", editorId: "palette", layer: "overlay", layers: ["overlay", "canvas"], sticky: { edge: "bottom", t: 0.5 }, x: 0, y: 0, w: 356, h: 44, rotation: 0, inlets: {}, config: { brushes: ["select", "hand", "pen", "eraser", "wire", "rectangle", "ellipse", "arrow", "text"] } },
      ],
    });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const pal = lh.doc().items.find((i) => i.id === "ns-toolbar-palette");
    expect(JSON.parse(JSON.stringify(pal.inlets.tools))).toEqual(PALETTE_INLETS.tools);
    // an explicit unwire stays cut
    const layout2 = repo.create({
      "@patchwork": { type: "sketch-layout" },
      items: [{ id: "ns-toolbar-palette", kind: "editor", editorId: "palette", layer: "overlay", x: 0, y: 0, w: 356, h: 44, rotation: 0, inlets: { tools: null }, config: { brushes: ["pen"] } }],
    });
    const folder2 = repo.create({ title: "t", docs: [], sketch: layout2.url });
    const lh2 = await ensureLayoutDoc(repo, folder2, "canvas");
    expect(lh2.doc().items.find((i) => i.id === "ns-toolbar-palette").inlets.tools).toBe(null);
  });

  it("UPGRADE preserves a CUSTOMIZED palette: the config window is seeded with ITS brushes as entries", async () => {
    const repo = makeRepo();
    const layout = repo.create({
      "@patchwork": { type: "sketch-layout" },
      items: [{ id: "ns-toolbar-palette", kind: "editor", editorId: "palette", layer: "overlay", x: 0, y: 0, w: 356, h: 44, rotation: 0, inlets: {}, config: { brushes: ["pen", "marker"] } }],
    });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const cfg = lh.doc().items.find((i) => i.id === "ns-toolbar-config");
    expect(JSON.parse(JSON.stringify(cfg.config.entries))).toEqual([
      { kind: "tool", id: "pen" }, { kind: "tool", id: "marker" },
    ]);
  });

  it("the palette seed is DISMISSABLE like the others (dismissedSeeds honoured)", async () => {
    const repo = makeRepo();
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [], dismissedSeeds: ["ns-toolbar-palette"] });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    expect(lh.doc().items.some((i) => i.id === "ns-toolbar-palette")).toBe(false);
    expect(lh.doc().items.some((i) => i.id === "ns-zoom")).toBe(true); // others still seed
  });

  it("UPGRADE: an existing canvas doc gains the palette seed on re-open (idempotently)", async () => {
    const repo = makeRepo();
    const layout = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [] });
    const folder = repo.create({ title: "t", docs: [], sketch: layout.url });
    await ensureLayoutDoc(repo, folder, "canvas");
    await ensureLayoutDoc(repo, folder, "canvas"); // twice — no duplicates
    const items = layout.doc().items;
    expect(items.filter((i) => i.id === "ns-toolbar-palette").length).toBe(1);
  });
});

describe("seedPartsFlap — the parts bin as a FLAP (a `flap: true` frame, seeded async from the root canvas)", () => {
  it("seeds ns-parts as an overlay-only STUCK flap whose sub-space holds one parked parts window", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    const flapFolder = await seedPartsFlap(repo, lh);
    expect(flapFolder).toBeTruthy();
    const flap = lh.doc().items.find((i) => i.id === "ns-parts");
    expect(flap).toBeTruthy();
    expect(flap.kind).toBe("frame");
    expect(flap.flap).toBe(true);
    expect(flap.url).toBe(flapFolder.url);
    expect([...flap.layers]).toEqual(["overlay"]); // no canvas membership — it appears when arranging
    expect(JSON.parse(JSON.stringify(flap.sticky))).toEqual({ edge: "left", t: 1 }); // stuck ⇒ an edge tab
    // the flap's sub-space: named "parts", ONE item (the bin window), and every
    // seed dismissed — re-opens never grow chrome inside the shelf
    expect(flapFolder.doc().title).toBe("parts");
    const sub = await repo.find(flapFolder.doc().sketch);
    const subItems = sub.doc().items;
    expect(subItems.length).toBe(1);
    expect(subItems[0]).toMatchObject({ id: "ns-parts-window", kind: "editor", editorId: "parts" });
    for (const id of SEED_IDS) expect([...sub.doc().dismissedSeeds]).toContain(id);
    // opening the flap's folder through the ordinary frame path stays chrome-free
    await ensureLayoutDoc(repo, flapFolder, "canvas");
    expect(sub.doc().items.length).toBe(1);
  });

  it("is idempotent, respects dismissal, and never doubles an existing (old-style) ns-parts", async () => {
    const repo = makeRepo();
    const folder = repo.create({ title: "t", docs: [] });
    const lh = await ensureLayoutDoc(repo, folder, "canvas");
    await seedPartsFlap(repo, lh);
    expect(await seedPartsFlap(repo, lh)).toBe(null); // second open: no new docs
    expect(lh.doc().items.filter((i) => i.id === "ns-parts").length).toBe(1);
    // dismissal sticks
    const layout2 = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [], dismissedSeeds: ["ns-parts"] });
    expect(await seedPartsFlap(repo, layout2)).toBe(null);
    expect(layout2.doc().items.some((i) => i.id === "ns-parts")).toBe(false);
    // an OLD doc's bare parts window keeps what it has (migration-free)
    const layout3 = repo.create({ "@patchwork": { type: "sketch-layout" }, items: [{ id: "ns-parts", kind: "editor", editorId: "parts", layer: "overlay", layers: ["overlay"], sticky: { edge: "left", t: 1 }, x: 0, y: 0, w: 248, h: 340, rotation: 0, inlets: {} }] });
    expect(await seedPartsFlap(repo, layout3)).toBe(null);
    const kept = layout3.doc().items.filter((i) => i.id === "ns-parts");
    expect(kept.length).toBe(1);
    expect(kept[0].kind).toBe("editor");
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
