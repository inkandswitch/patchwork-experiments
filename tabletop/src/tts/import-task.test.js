// @vitest-environment node
// The TTS import as a task (import-task.js), on the tiny fixture mod kept as
// file docs the way the tool keeps a drop (dropped.js), with a stand-in
// fetch and a stand-in ctx: the game it makes is the importer's own; it
// writes the outcome only while the doc still asks for this import; a second
// run makes no second game; a stop is prompt and writes nothing; a fetch
// that fails says what it says today; what it returns is small.
import { describe, it, expect } from "vitest";
import { FakeRepo } from "../test/fake-repo.js";
import { fixtureSources } from "./test/fixture.js";
import { storeDropped, NO_SAVE } from "./dropped.js";
import { importAsk, importRequest } from "./request.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import importTask, { importMod, MOVED, STOPPED } from "./import-task.js";
import { runImport } from "./importer.js";
import tinyGame from "../../contract/v2/fixtures/valid/tts-tiny-mod.json" with { type: "json" };

const notFound = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

/** A stand-in ctx, as a pool hands one: what was logged and reported is kept. */
function context(repo, controller = new AbortController()) {
  const logs = [];
  const stages = [];
  return { repo, signal: controller.signal, controller, logs, stages, log: (...a) => logs.push(a.join(" ")), progress: (v) => stages.push(v), taskUrl: null, key: "k", run: "r" };
}

/** A repo holding the fixture kept as a drop keeps it, and an import doc asking for it. */
async function asked(settings = {}) {
  const repo = new FakeRepo();
  const files = await storeDropped(repo, fixtureSources());
  const request = await importRequest(files, { ...DEFAULT_SETTINGS, ...settings });
  const doc = repo.add({ "@patchwork": { type: "tts-import" }, title: "TTS import", settings: { ...DEFAULT_SETTINGS }, request, imported: null, games: [] });
  const { input, key } = importAsk(doc.url, request);
  const made = () => repo.created.filter((h) => h.doc()["@patchwork"]?.type !== "file" || !files.some((f) => f.url === h.url)).map((h) => h.doc()["@patchwork"]?.type);
  return { repo, files, request, doc, input, key, made };
}

// the game with every name a repo or a hash gave it named by the order it is first met (as importer.test.js does)
const rekeyed = (g) => {
  const named = (x) => {
    const kinds = new Map(Object.keys(x.pieces).map((k, i) => [k, `kind${i}`]));
    const urls = new Map();
    return JSON.parse(JSON.stringify(x), (key, v) => (typeof v !== "string" ? v : kinds.has(v) ? kinds.get(v) : v.startsWith("automerge:") ? `automerge:${urls.get(v) ?? urls.set(v, urls.size).get(v)}` : v));
  };
  return { ...named(g), pieces: Object.fromEntries(Object.entries(named(g).pieces).map(([, p], i) => [`kind${i}`, p])) };
};
const gameOf = (d) => {
  const { "@patchwork": _t, drawn: _d, tables: _s, ...game } = d;
  return game;
};

describe("the kept drop", () => {
  it("keeps the save and only the files it uses, each a file doc saying the URLs it was found under", async () => {
    const repo = new FakeRepo();
    const extra = fixtureSources();
    const files = await storeDropped(repo, extra);
    expect(files[0]).toMatchObject({ path: "Workshop/1234567890.json" });
    // the fixture's 8 cached assets, and the save
    expect(files).toHaveLength(9);
    const docs = files.map((f) => repo.handles.get(f.url).doc());
    expect(docs.every((d) => d["@patchwork"].type === "file")).toBe(true);
    expect(docs[0]).toMatchObject({ extension: "json", mimeType: "application/json" });
    expect(docs[0].content).toBeInstanceOf(Uint8Array);
    for (const d of docs.slice(1)) expect(d.origin.urls.length).toBeGreaterThan(0);
    expect(docs.filter((d) => d.extension === "obj").every((d) => typeof d.content === "string")).toBe(true);
  });

  it("without a save keeps nothing and says what to drop", async () => {
    const repo = new FakeRepo();
    await expect(storeDropped(repo, fixtureSources({ without: [".json"] }))).rejects.toThrow(NO_SAVE);
    expect(repo.created).toEqual([]);
  });

  it("a request is the same request for the same files and settings, and another for other settings", async () => {
    const { files } = await asked();
    const a = await importRequest(files, DEFAULT_SETTINGS);
    const b = await importRequest(files.map((f) => ({ size: f.size, url: f.url, path: f.path })), { ...DEFAULT_SETTINGS });
    const c = await importRequest(files, { ...DEFAULT_SETTINGS, includeContents: false });
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
  });
});

describe("the import task", () => {
  it("imports the kept files into the game the importer makes of the fixture, writes the outcome as one value, and returns a url and a line", async () => {
    const { repo, doc, input, files, made } = await asked();
    const ctx = context(repo);
    const result = await importMod(input, ctx, { fetch: notFound, shrink: null });
    expect(Object.keys(result).sort()).toEqual(["gameUrl", "imported", "message"]);
    expect(JSON.stringify(result).length).toBeLessThan(300);
    expect(result.imported).toBe(true);
    const d = doc.doc();
    expect(d.imported).toMatchObject({ id: input.request.id, gameUrl: result.gameUrl });
    expect(d.games).toEqual([result.gameUrl]);
    expect(d.title).toBe("Tiny Test Mod (TTS)");
    // the report is the importer's: 8 assets from what was dropped, one to fetch when first drawn
    expect(d.imported.report.counts.assets).toMatchObject({ needed: 9, cache: 8, fetched: 0, web: 1, missing: 0 });
    expect(d.imported.report.counts).toMatchObject({ cards: 4, decks: 1, bags: 1, dice: 1, seats: 1, pieces: 16 });
    // the game: the format's own fixture of this mod, as the importer's tests expect it
    const game = gameOf(repo.handles.get(result.gameUrl).doc());
    expect(rekeyed(game)).toEqual(rekeyed(tinyGame));
    // its assets are the kept files themselves: nothing stored twice; one new doc, the game
    for (const { file } of Object.values(game.assets)) expect(files.some((f) => f.url === file)).toBe(true);
    expect(made()).toEqual(["tabletop-game"]);
    // what a person reads: the stages as they come, and a line for each
    expect(ctx.stages.map((p) => p.phase)).toContain("Storing assets");
    expect(ctx.logs).toEqual(["Reading the mod…", "Finding assets…", "Storing assets…", "Translating the game…", result.message]);
    expect(result.message).toMatch(/^Imported “Tiny Test Mod”/);
  });

  it("is the default export, called as a pool calls it (ctx as this, and as the second argument)", async () => {
    const { repo, input } = await asked();
    // the network is not reached: nothing is fetched now with the default settings
    const ctx = context(repo);
    const result = await importTask.call(ctx, input, ctx);
    expect(result.imported).toBe(true);
  });

  it("the same game as the importer makes from the dropped files directly", async () => {
    const { repo, input } = await asked();
    const viaTask = gameOf(repo.handles.get((await importMod(input, context(repo), { fetch: notFound, shrink: null })).gameUrl).doc());
    const direct = await runImport({ sources: fixtureSources(), repo: new FakeRepo(), fetch: notFound, shrink: null });
    const { finishedAt: _a, ...reportA } = repo.handles.get(input.import).doc().imported.report;
    expect(rekeyed(viaTask)).toEqual(rekeyed(direct.game));
    expect(Object.keys(reportA).sort()).toEqual(Object.keys(direct.report).filter((k) => k !== "finishedAt").sort());
  });

  it("a doc that asks for another import when it starts: writes nothing, makes nothing, and says so", async () => {
    const { repo, doc, input, made } = await asked();
    const other = await importRequest(input.request.files, { ...DEFAULT_SETTINGS, includeContents: false });
    doc.change((d) => (d.request = other));
    const ctx = context(repo);
    const result = await importMod(input, ctx, { fetch: notFound, shrink: null });
    expect(result).toEqual({ imported: false, message: MOVED });
    expect(doc.doc().imported).toBeNull();
    expect(doc.doc().games).toEqual([]);
    expect(made()).toEqual([]);
    expect(ctx.logs).toEqual([MOVED]);
  });

  it("a doc that comes to ask for another import while it runs: writes nothing", async () => {
    const { repo, doc, input } = await asked();
    const other = await importRequest(input.request.files.slice(0, 1), DEFAULT_SETTINGS);
    const ctx = context(repo);
    ctx.progress = (p) => p.phase === "Translating the game" && doc.change((d) => (d.request = other));
    const result = await importMod(input, ctx, { fetch: notFound, shrink: null });
    expect(result).toEqual({ imported: false, message: MOVED });
    expect(doc.doc().imported).toBeNull();
    expect(doc.doc().games).toEqual([]);
    expect(doc.doc().title).toBe("TTS import");
  });

  it("run twice, one after the other: the second finds the first's game and makes none", async () => {
    const { repo, doc, input, made } = await asked();
    const first = await importMod(input, context(repo), { fetch: notFound, shrink: null });
    const second = await importMod(input, context(repo), { fetch: notFound, shrink: null });
    expect(second).toEqual(first);
    expect(made()).toEqual(["tabletop-game"]);
    expect(doc.doc().games).toEqual([first.gameUrl]);
  });

  it("run twice at once: the doc names one game, and both runs return it", async () => {
    const { repo, doc, input } = await asked();
    const [a, b] = await Promise.all([importMod(input, context(repo), { fetch: notFound, shrink: null }), importMod(input, context(repo), { fetch: notFound, shrink: null })]);
    expect(a.gameUrl).toBe(b.gameUrl);
    expect(doc.doc().games).toEqual([a.gameUrl]);
    expect(doc.doc().imported.gameUrl).toBe(a.gameUrl);
  });

  it("stopped while it fetches: rejects at once with STOPPED, writes nothing and makes no game", async () => {
    const { repo, doc, input, made } = await asked({ fetchNow: true });
    const ctx = context(repo);
    let fetching = null;
    // a fetch that answers only when it is aborted, as a slow host would be cut off
    const slow = (url, init) =>
      new Promise((_, reject) => {
        fetching?.();
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const started = new Promise((resolve) => (fetching = resolve));
    const run = importMod(input, ctx, { fetch: slow, shrink: null });
    await started;
    const t0 = performance.now();
    ctx.controller.abort("cancelled");
    await expect(run).rejects.toThrow(STOPPED);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(doc.doc().imported).toBeNull();
    expect(doc.doc().games).toEqual([]);
    expect(made()).toEqual([]);
  });

  it("stopped before it starts: makes nothing", async () => {
    const { repo, doc, input, made } = await asked();
    const ctx = context(repo);
    ctx.controller.abort("cancelled");
    await expect(importMod(input, ctx, { fetch: notFound, shrink: null })).rejects.toThrow(STOPPED);
    expect(doc.doc().imported).toBeNull();
    expect(made()).toEqual([]);
  });

  it("a fetch that fails: the asset is missing, with the reason a person reads in the report today", async () => {
    const { repo, doc, input } = await asked({ fetchNow: true });
    const result = await importMod(input, context(repo), { fetch: notFound, shrink: null });
    expect(result.imported).toBe(true);
    const report = doc.doc().imported.report;
    expect(report.counts.assets).toMatchObject({ needed: 9, cache: 8, fetched: 0, web: 0, missing: 1 });
    expect(Object.values(report.assets).filter((a) => !a.source).map((a) => [a.usedBy[0], a.error])).toEqual([["Lost model", "not in the dropped files; fetching failed: HTTP 404"]]);
  });

  it("an import that cannot be done fails with its reason, kept on the doc for whoever opens it", async () => {
    const { repo, doc, input } = await asked();
    // kept files with no save among them
    const request = await importRequest(input.request.files.slice(1), DEFAULT_SETTINGS);
    doc.change((d) => (d.request = request));
    const { input: bad } = importAsk(doc.url, request);
    await expect(importMod(bad, context(repo), { fetch: notFound, shrink: null })).rejects.toThrow(/No Tabletop Simulator save found/);
    expect(doc.doc().imported).toMatchObject({ id: request.id, error: expect.stringMatching(/No Tabletop Simulator save found/) });
    // asked again, the same request is tried again (a failure is no game to return)
    doc.change((d) => (d.request = input.request));
    expect((await importMod(input, context(repo), { fetch: notFound, shrink: null })).imported).toBe(true);
  });

  it("refuses an input that names no import", async () => {
    await expect(importMod({}, context(new FakeRepo()))).rejects.toThrow("No import was named.");
    await expect(importMod({ import: "automerge:x", request: {} }, context(new FakeRepo()))).rejects.toThrow("No import was named.");
  });
});
