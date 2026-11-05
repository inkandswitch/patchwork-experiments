// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { runImport, source } from "./importer.js";
import { sourcesFromZip } from "./inputs.js";
import { parseGLB } from "./glb.js";
import { hideObject } from "./layout.js";
import { FakeRepo } from "./test/fake-repo.js";
import { nodeImages } from "./test/node-images.js";
import { FIXTURE, fixtureSources } from "./test/fixture.js";

const U = 0.0254;
const notFound = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

async function importFixture(opts = {}) {
  const repo = new FakeRepo();
  const phases = [];
  const out = await runImport({ sources: fixtureSources(), repo, images: nodeImages(), fetch: notFound, onProgress: (p) => phases.push(p.phase), infoUrl: "automerge:import", infoToolId: "tts-import", ...opts });
  const doc = (url) => repo.handles.get(url)?.doc();
  return { ...out, repo, doc, phases };
}

describe("runImport on the tiny fixture", () => {
  it("finds the save and the cached assets (through the cloud-3 rewrite), and reports what's missing", async () => {
    const { report, phases } = await importFixture();
    expect(report.mod).toMatchObject({ saveName: "Tiny Test Mod", fileName: "Workshop/1234567890.json", objects: 17 });
    expect(report.counts.assets).toMatchObject({ needed: 10, cache: 8, fetched: 0, missing: 2 });
    const back = Object.values(report.assets).find((a) => a.url.includes("cloud-3"));
    expect(back).toMatchObject({ source: "cache", mimeType: "image/png" });
    expect(back.fileUrl).toMatch(/^automerge:/);
    const missing = Object.values(report.assets).filter((a) => !a.source);
    expect(missing.map((a) => [a.usedBy[0], a.error])).toEqual([
      ["Lost model", "not in the dropped files; fetching failed: HTTP 404"],
      ["Rules", "not in the dropped files; fetching failed: HTTP 404"],
    ]);
    expect(report.notes["missing model: https://example.invalid/missing-model.obj"]).toBe(1);
    expect(phases).toEqual(expect.arrayContaining(["Reading the mod", "Finding assets", "Storing assets", "Drawing pieces", "Laying out the table", "Done"]));
    expect(report.counts.skipped).toEqual({ "HandTrigger (a seat)": 1, "3DText (not drawn)": 1, ScriptingTrigger: 1 });
  });

  it("stores raw assets as file docs, OBJ as text", async () => {
    const { report, doc } = await importFixture();
    const obj = Object.values(report.assets).find((a) => a.role === "model" && a.source);
    const f = doc(obj.fileUrl);
    expect(f).toMatchObject({ "@patchwork": { type: "file" }, extension: "obj", mimeType: "model/obj" });
    expect(typeof f.content).toBe("string");
    const png = doc(Object.values(report.assets).find((a) => a.role === "image" && a.source).fileUrl);
    expect(png.content).toBeInstanceOf(Uint8Array);
  });

  it("lays out the table: every object a passthrough GLB at its transform, in the hand", async () => {
    const { scene, report, doc } = await importFixture();
    expect(scene.view).toMatchObject({ tool: "hand", snap: true, grid: false, home: { position: expect.any(Array), target: expect.any(Array) } });
    expect(scene.camera).toBeUndefined();
    expect(scene.traits).toEqual(expect.any(Object));
    const objs = Object.entries(scene.objects);
    for (const [, o] of objs.filter(([, o]) => o.kind !== "group")) {
      expect(o.providerId).toBe("file-glb");
      expect(o.renderUrl).toBeNull();
      expect(doc(o.sourceUrl)).toMatchObject({ extension: "glb", mimeType: "model/gltf-binary" });
      expect(o.hint.bounds.min).toHaveLength(3);
    }
    const byName = (n) => objs.find(([, o]) => o.name === n)?.[1];
    // the board: locked, at TTS (0, 0.96, 4) → scene (0, ~0, -4u), a half turn
    const board = byName("Board");
    expect(board.locked).toBe(true);
    expect(board.transform.position[0]).toBeCloseTo(0, 6);
    expect(board.transform.position[2]).toBeCloseTo(-4 * U, 6);
    expect(board.transform.position[1]).toBeGreaterThanOrEqual(0);
    expect(board.transform.position[1]).toBeLessThan(0.002);
    expect(board.transform.rotation[1]).toBeCloseTo(Math.PI, 5);
    expect(board.infoUrl).toBe("automerge:import");
    // its snap points went into its GLB as connectors, scaled
    const snaps = parseGLB(doc(board.sourceUrl).content).json.scenes[0].extras.connectors;
    expect(snaps).toHaveLength(4);
    expect(snaps[0].position[0]).toBeCloseTo(-0.4 * 3 * U, 5);
    // the table, locked, under everything, carrying the mod's own snap points
    const table = scene.objects.table;
    expect(table.locked).toBe(true);
    expect(scene.order[0]).toBe("table");
    expect(parseGLB(doc(table.sourceUrl).content).json.scenes[0].extras.connectors).toHaveLength(2);
    // the stack of three coins, one above the other
    const coins = objs.filter(([, o]) => o.name === "Coins" && o.kind !== "group").map(([, o]) => o.transform.position[1]);
    expect(coins).toHaveLength(3);
    expect(coins[1] - coins[0]).toBeCloseTo(0.1 * U, 6);
    // a seat from the HandTrigger
    expect(scene.traits["tabletop.seats"].white).toMatchObject({ name: "White", player: null });
    expect(scene.traits["tabletop.seats"].white.camera.position[2]).toBeGreaterThan(0); // the hand is at TTS -z: the scene's near side
    expect(report.counts.tableY).toBeGreaterThan(0.9);
  });

  it("a face-down deck is a stack of hidden cards backed by its own plain-deck doc", async () => {
    const { scene, doc } = await importFixture();
    const group = Object.entries(scene.objects).find(([, o]) => o.kind === "group" && o.name === "Draw pile (3)");
    expect(group[1].visible).toBe(true);
    const cards = Object.entries(scene.objects).filter(([, o]) => o.group === group[0]);
    expect(cards).toHaveLength(3);
    const by = new Set(cards.map(([, o]) => o.traits?.["tabletop.hidden"]?.by));
    expect(by.size).toBe(1);
    const secrets = doc([...by][0]);
    expect(secrets["@patchwork"].type).toBe("plain-deck");
    expect(Object.keys(secrets.objects).sort()).toEqual(cards.map(([id]) => id).sort());
    // the scene says only "Card", with one look for all three; the secrets say which is which
    expect(cards.map(([, o]) => o.name)).toEqual(["Card", "Card", "Card"]);
    expect(new Set(cards.map(([, o]) => o.sourceUrl)).size).toBe(1);
    const names = cards.map(([id]) => secrets.objects[id].name);
    expect(names).toEqual(["Red One", "Green Two", "Blue Three"]);
    expect(new Set(cards.map(([id]) => secrets.objects[id].sourceUrl)).size).toBe(3);
    // stacked: the first card is on top
    const ys = cards.map(([, o]) => o.transform.position[1]);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    // there is no scene-wide secrets doc any more
    expect(scene.secretsUrl).toBeUndefined();
    // a face-up lone card is just itself
    const yellow = Object.values(scene.objects).find((o) => o.name === "Yellow Four");
    expect(yellow.traits?.["tabletop.hidden"]).toBeUndefined();
  });

  it("hideFaceDown off: the deck's cards are themselves", async () => {
    const { scene } = await importFixture({ settings: { hideFaceDown: false } });
    expect(Object.values(scene.objects).some((o) => o.traits?.["tabletop.hidden"])).toBe(false);
    expect(Object.values(scene.objects).map((o) => o.name)).toContain("Red One");
  });

  it("a bag's contents are a hidden group beside it, resting on the table", async () => {
    const { scene } = await importFixture();
    const [gid, g] = Object.entries(scene.objects).find(([, o]) => o.name === "Pouch: contents (2)");
    expect(g.visible).toBe(false);
    const inside = Object.values(scene.objects).filter((o) => o.group === gid);
    expect(inside.map((o) => o.name)).toEqual(["Token in the bag", "Lost model"]);
    const pouch = Object.values(scene.objects).find((o) => o.name === "Pouch");
    for (const o of inside) {
      expect(o.transform.position[0]).toBeGreaterThan(pouch.transform.position[0]);
      expect(o.transform.position[1] + o.hint.bounds.min[1]).toBeCloseTo(0, 4);
    }
    const { scene: none } = await importFixture({ settings: { includeContents: false } });
    expect(Object.values(none.objects).some((o) => o.name === "Token in the bag")).toBe(false);
  });

  it("identical pieces share one GLB", async () => {
    const { scene, report } = await importFixture();
    const coins = Object.values(scene.objects).filter((o) => o.name === "Coins" && o.kind !== "group");
    expect(new Set(coins.map((o) => o.sourceUrl)).size).toBe(1);
    expect(report.counts.kinds).toBeLessThan(report.counts.placed + 1);
  });

  it("takes a zip, and says clearly when there's no save at all", async () => {
    const files = {};
    for (const s of fixtureSources()) files[s.path] = await s.read();
    const zipped = zipSync(files);
    const sources = await sourcesFromZip(zipped, "tiny.zip");
    expect(sources.length).toBe(Object.keys(files).length);
    const json = sources.find((s) => s.path.endsWith(".json"));
    expect(new TextDecoder().decode(await json.read())).toContain("Tiny Test Mod");
    const out = await runImport({ sources, repo: new FakeRepo(), images: nodeImages(), fetch: notFound });
    expect(out.report.counts.assets.cache).toBe(8);
    await expect(runImport({ sources: [source("a.png", 1, async () => new Uint8Array(1))], repo: new FakeRepo(), images: nodeImages() })).rejects.toThrow(/No Tabletop Simulator save/);
  });

  it("only the mod's own files are read when a whole folder is dropped", async () => {
    const reads = [];
    const sources = fixtureSources().map((s) => ({ ...s, read: () => (reads.push(s.path), s.read()) }));
    for (let i = 0; i < 50; i++) sources.push(source(`Mods/Images/someOtherMod${i}.png`, 10, async () => (reads.push("other"), new Uint8Array(10))));
    await runImport({ sources, repo: new FakeRepo(), images: nodeImages(), fetch: notFound });
    expect(reads).not.toContain("other");
  });

  it("hideObject is the one place that knows the hidden shape", () => {
    expect(hideObject({ name: "Card" }, "automerge:deck")).toEqual({ name: "Card", traits: { "tabletop.hidden": { by: "automerge:deck" } } });
  });

  it("the fixture's JSON is a real file on disk", () => {
    expect(readFileSync(join(FIXTURE, "Workshop/1234567890.json"), "utf8")).toContain("ObjectStates");
  });
});
