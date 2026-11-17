// @vitest-environment node
// A whole import of the tiny fixture: the assets it stores (each saying where
// it came from), the tabletop-game it makes (valid by the format, its pieces
// naming those assets, everything where TTS had it), and its report. It
// makes no scene: a game's tables are set up from it as any game's are.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { runImport, source } from "./importer.js";
import { sourcesFromZip } from "./inputs.js";
import { FakeRepo } from "../test/fake-repo.js";
import { FIXTURE, fixtureSources } from "./test/fixture.js";
import { validate, errorText } from "../../contract/v1/validate.js";
import tinyGame from "../../contract/v1/fixtures/valid/tts-tiny-mod.json" with { type: "json" };

const U = 0.0254;
const notFound = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

async function importFixture(opts = {}) {
  const repo = new FakeRepo();
  const phases = [];
  const out = await runImport({ sources: fixtureSources(), repo, fetch: notFound, onProgress: (p) => phases.push(p.phase), ...opts });
  const doc = (url) => repo.handles.get(url)?.doc();
  const byName = (name) => Object.entries(out.game.pieces).find(([, p]) => p.name === name);
  const thingOf = (name) => out.game.setup.find((t) => t.piece === byName(name)?.[0]);
  return { ...out, repo, doc, phases, byName, thingOf };
}

describe("runImport on the tiny fixture", () => {
  it("finds the save and the assets the game uses (through the cloud-3 rewrite), and reports what's missing", async () => {
    const { report, phases } = await importFixture();
    expect(report.mod).toMatchObject({ saveName: "Tiny Test Mod", fileName: "Workshop/1234567890.json", objects: 17 });
    // the PDF isn't one: a sheet is drawn for it, and its file is left where it was
    expect(report.counts.assets).toMatchObject({ needed: 8, cache: 7, fetched: 0, missing: 1, referenced: 10 });
    const back = Object.values(report.assets).find((a) => a.url.includes("cloud-3"));
    expect(back).toMatchObject({ source: "cache", mimeType: "image/png" });
    const missing = Object.values(report.assets).filter((a) => !a.source);
    expect(missing.map((a) => [a.usedBy[0], a.error])).toEqual([["Lost model", "not in the dropped files; fetching failed: HTTP 404"]]);
    expect(phases).toEqual(["Reading the mod", "Finding assets", ...Array(8).fill("Finding assets"), "Storing assets", ...Array(7).fill("Storing assets"), "Translating the game", "Done"]);
    expect(report.counts.skipped).toEqual({ "3DText": 1, ScriptingTrigger: 1 });
    expect(report.counts.approximated).toEqual({ Custom_Model: 1 });
    expect(report.counts).toMatchObject({ cards: 4, decks: 1, bags: 1, dice: 1, seats: 1, pieces: 16 });
  });

  it("stores each asset as a file doc saying which of the mod's URLs it came from, OBJ as text", async () => {
    const { report, doc } = await importFixture();
    const stored = Object.values(report.assets).filter((a) => a.fileUrl);
    expect(stored).toHaveLength(7);
    for (const a of stored) expect(doc(a.fileUrl).origin).toEqual({ urls: [a.url] });
    const obj = stored.find((a) => a.role === "model");
    expect(doc(obj.fileUrl)).toMatchObject({ "@patchwork": { type: "file" }, extension: "obj", mimeType: "model/obj" });
    expect(typeof doc(obj.fileUrl).content).toBe("string");
    expect(doc(stored.find((a) => a.role === "image").fileUrl).content).toBeInstanceOf(Uint8Array);
  });

  it("an asset over maxStoredBytes: an image made smaller where a shrinker can (stored, said), else not stored; a model never shrunk", async () => {
    const sizes = Object.values((await importFixture()).report.assets).filter((a) => a.fileUrl).map((a) => [a.role, a.bytes]);
    const limit = Math.min(...sizes.map(([, n]) => n)); // every asset but the smallest is over it
    const over = sizes.filter(([, n]) => n > limit);
    const overImages = over.filter(([role]) => role === "image").length;
    const overModels = over.filter(([role]) => role === "model").length;
    for (const shrinks of [true, false]) {
      const asked = [];
      const shrink = async (bytes, o) => (asked.push(o), shrinks ? { bytes: new Uint8Array(limit).fill(1), mimeType: o.mimeType, extension: "png", width: 2, height: 1 } : null);
      const { report, doc } = await importFixture({ settings: { maxStoredBytes: limit }, shrink });
      const warnings = report.warnings;
      const all = Object.values(report.assets);
      expect(asked.length, `shrinks ${shrinks}`).toBe(overImages);
      expect(asked.every((o) => o.limit === limit && /^image\//.test(o.mimeType))).toBe(true);
      const shrunk = all.filter((a) => a.shrunkFrom);
      expect(shrunk.length).toBe(shrinks ? overImages : 0);
      for (const a of shrunk) expect(doc(a.fileUrl).content).toEqual(new Uint8Array(limit).fill(1));
      expect(all.filter((a) => a.fileUrl).length).toBe(sizes.length - overModels - (shrinks ? 0 : overImages));
      expect(warnings.filter((w) => /stored at 2 × 1/.test(w)).length).toBe(shrinks ? overImages : 0);
      expect(warnings.filter((w) => /wasn't stored: over/.test(w)).length).toBe(overModels + (shrinks ? 0 : overImages));
    }
  });

  it("makes one tabletop-game doc, valid by the format, saying which mod it came from; and no scene", async () => {
    const { gameUrl, game, doc, repo } = await importFixture();
    const d = doc(gameUrl);
    expect(d["@patchwork"]).toEqual({ type: "tabletop-game" });
    expect(d).toMatchObject({ drawn: {}, tables: [] });
    const r = validate(game);
    expect(r.ok, errorText(r)).toBe(true);
    expect(game.origin).toEqual({ tts: { saveName: "Tiny Test Mod", fileName: "Workshop/1234567890.json", workshopId: "1234567890" } });
    expect(game.title).toBe("Tiny Test Mod");
    expect(game.about).toMatch(/^Imported from Tabletop Simulator: “Tiny Test Mod”/);
    const types = repo.created.map((h) => h.doc()["@patchwork"].type);
    expect(types.filter((t) => t !== "file")).toEqual(["tabletop-game"]);
  });

  it("is, whole, the format's own fixture of it (contract/v1's valid/tts-tiny-mod.json), up to the names the repo gave it", async () => {
    // file docs' URLs are whatever the repo made, and a kind's id is a hash of its look, URLs and all:
    // name both by the order they're first met
    const named = (g) => {
      const kinds = new Map(Object.keys(g.pieces).map((k, i) => [k, `kind${i}`]));
      const urls = new Map();
      return JSON.parse(JSON.stringify(g), (key, v) => {
        if (typeof v !== "string") return v;
        if (kinds.has(v)) return kinds.get(v);
        return v.startsWith("automerge:") ? `automerge:${urls.get(v) ?? urls.set(v, urls.size).get(v)}` : v;
      });
    };
    const rekeyed = (g) => ({ ...named(g), pieces: Object.fromEntries(Object.entries(named(g).pieces).map(([, p], i) => [`kind${i}`, p])) });
    const { game } = await importFixture();
    expect(rekeyed(game)).toEqual(rekeyed(tinyGame));
  });

  it("every image and model a piece names is one of the stored file docs", async () => {
    const { game, report } = await importFixture();
    const stored = new Set(Object.values(report.assets).map((a) => a.fileUrl).filter(Boolean));
    const named = [];
    for (const p of Object.values(game.pieces)) for (const part of p.parts ?? []) for (const u of [part.top?.file, part.bottom?.file, part.file, part.texture]) if (u) named.push(u);
    expect(named.length).toBeGreaterThan(0);
    for (const u of named) expect(stored.has(u)).toBe(true);
  });

  it("puts everything where TTS had it: the board locked at (0, ~0, −4u) a half turn round, its snap points scaled", async () => {
    const { byName, thingOf } = await importFixture();
    const [, board] = byName("Board");
    expect(board.locked).toBe(true);
    expect(board.snapPoints).toHaveLength(4);
    expect(board.snapPoints[0].position[0]).toBeCloseTo(-0.4 * 3 * U, 5);
    const t = thingOf("Board");
    expect(t.at.position[0]).toBeCloseTo(0, 6);
    expect(t.at.position[2]).toBeCloseTo(-4 * U, 6);
    expect(t.at.position[1]).toBeGreaterThanOrEqual(0);
    expect(t.at.position[1]).toBeLessThan(0.002);
    expect(t.at.rotation[1]).toBeCloseTo(Math.PI, 5);
    // the table, first, locked, its top at y = 0, carrying the mod's own snap points
    const [, table] = byName("Table");
    expect(table.locked).toBe(true);
    expect(table.snapPoints).toHaveLength(2);
  });

  it("a face-down deck lists its cards top first, level and turned over, every card one back", async () => {
    const { game } = await importFixture();
    const deck = game.setup.find((t) => t.deck);
    expect(deck.deck).toMatchObject({ name: "Draw pile", faceDown: true });
    expect(deck.deck.cards.map((k) => game.pieces[k].name)).toEqual(["Red One", "Green Two", "Blue Three"]);
    expect(new Set(deck.deck.cards.map((k) => game.pieces[k].back)).size).toBe(1);
    const back = game.pieces[game.pieces[deck.deck.cards[0]].back];
    expect(back).toMatchObject({ name: "Card", tags: ["card"] });
    // level: a turn about y alone; the turning over is the deck's
    expect(deck.at.rotation.filter((v, i) => i !== 1)).toEqual([0, 0]);
    // a face-up loose card is a card too: kept, its face shown to all while it lies face up
    const yellow = game.setup.find((t) => game.pieces[t.piece]?.name === "Yellow Four");
    expect(game.pieces[yellow.piece].back).toBe(game.pieces[deck.deck.cards[0]].back);
  });

  it("a stack is one thing of several copies, each a coin's thickness above the last", async () => {
    const { thingOf } = await importFixture();
    const coins = thingOf("Coins");
    expect(coins.count).toBe(3);
    expect(coins.grid).toEqual({ cols: 1, across: [0, 0, 0], down: [0, 0.00254, 0] });
  });

  it("a bag holds what TTS had in it; without its contents setting, nothing", async () => {
    const { byName, thingOf, game } = await importFixture();
    expect(byName("Pouch")[1].bag).toEqual({ rule: "random" });
    expect(thingOf("Pouch").contents.map((t) => game.pieces[t.piece].name)).toEqual(["Token in the bag", "Lost model"]);
    // the lost model, its OBJ missing, is a see-through stand-in
    expect(byName("Lost model")[1].parts[0]).toMatchObject({ shape: "box", color: "#a0a0a8b0" });
    const none = await importFixture({ settings: { includeContents: false } });
    expect(none.thingOf("Pouch").contents).toBeUndefined();
  });

  it("a die is a die document with the trait that makes it one, standing on its foot where TTS had its middle", async () => {
    const { byName, thingOf } = await importFixture();
    const [, die] = byName("Die");
    expect(die).toMatchObject({ doc: { "@patchwork": { type: "die" }, shape: "d6", size: U }, traits: { "dice.die": {} } });
    expect(die.parts).toBeUndefined();
    // TTS has it at y = 1.5 by its middle; the table top is at 0.96; a die document stands on its foot
    expect(thingOf("Die").at.position[1]).toBeCloseTo((1.5 - 0.96) * U - U / 2, 6);
  });

  it("a HandTrigger is a seat, and its hand: a tray with card slots whose +Z faces its player", async () => {
    const { game } = await importFixture();
    expect(Object.keys(game.seats)).toEqual(["white"]);
    expect(game.seats.white.camera.position[2]).toBeGreaterThan(0); // the hand is at TTS −z: the scene's near side
    const hand = game.setup.find((t) => t.seat === "white");
    const piece = game.pieces[hand.piece];
    expect(piece.zone.min.every((v, i) => v < piece.zone.max[i])).toBe(true);
    expect(piece.snapPoints.length).toBeGreaterThan(0);
    for (const s of piece.snapPoints) expect(s.tags).toEqual(["card"]);
    // each slot reaches halfway to the next, so a hand of one slot still takes a card
    const pitch = piece.snapPoints.length > 1 ? piece.snapPoints[1].position[0] - piece.snapPoints[0].position[0] : piece.zone.max[0] - piece.zone.min[0];
    expect(piece.snapRadius).toBeCloseTo(pitch / 2, 6);
    // +Z away from the table's middle: toward the near side
    expect(Math.cos(hand.at.rotation[1])).toBeGreaterThan(0.9);
  });

  it("identical pieces are one piece", async () => {
    const { game } = await importFixture();
    const coins = game.setup.filter((t) => game.pieces[t.piece]?.name === "Coins");
    expect(coins).toHaveLength(1);
    const backs = new Set(Object.values(game.pieces).filter((p) => p.back).map((p) => p.back));
    expect(backs.size).toBe(1);
  });

  it("takes a zip, and says clearly when there's no save at all", async () => {
    const files = {};
    for (const s of fixtureSources()) files[s.path] = await s.read();
    const sources = await sourcesFromZip(zipSync(files), "tiny.zip");
    expect(sources.length).toBe(Object.keys(files).length);
    const out = await runImport({ sources, repo: new FakeRepo(), fetch: notFound });
    expect(out.report.counts.assets.cache).toBe(7);
    await expect(runImport({ sources: [source("a.png", 1, async () => new Uint8Array(1))], repo: new FakeRepo() })).rejects.toThrow(/No Tabletop Simulator save/);
  });

  it("only the mod's own files are read when a whole folder is dropped", async () => {
    const reads = [];
    const sources = fixtureSources().map((s) => ({ ...s, read: () => (reads.push(s.path), s.read()) }));
    for (let i = 0; i < 50; i++) sources.push(source(`Mods/Images/someOtherMod${i}.png`, 10, async () => (reads.push("other"), new Uint8Array(10))));
    await runImport({ sources, repo: new FakeRepo(), fetch: notFound });
    expect(reads).not.toContain("other");
  });

  it("the fixture's JSON is a real file on disk", () => {
    expect(readFileSync(join(FIXTURE, "Workshop/1234567890.json"), "utf8")).toContain("ObjectStates");
  });
});
