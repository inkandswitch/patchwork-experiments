// The Lost Cities and Santorini templates against a stand-in for the stage's
// drop context: the art they file, the decks they make and when, and the
// table they write.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { lostCities, santorini, layOutTable, gameFileKey, fnv } from "./template.js";
import * as lostCitiesGame from "../games/lost-cities.js";
import { kindsUsed } from "../setup.js";
import { glbKey } from "../pieces.js";
import { fakeDrop, fakeRegistry } from "../test/fakes.js";

/** What the scene datatype's init makes. */
const emptyScene = () => ({ "@patchwork": { type: "scene" }, title: "Untitled scene", objects: {}, order: [], dimensions: {}, assets: {}, traits: {}, view: {} });

/** A registry with a secure-deck provider, as card-table registers it. */
const secureDecks = () =>
  fakeRegistry([{ id: "secure-deck", supportedDatatypes: ["secure-deck"], load: async () => ({ createResolver: () => ({}) }) }]);

const game = () => {
  const g = {};
  lostCitiesGame.fill(g);
  return g;
};

describe("the Lost Cities template", () => {
  it("files one GLB per kind under a versioned key, and every object shows one of them", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    const g = game();
    const keys = kindsUsed(g).map((k) => gameFileKey("lost-cities", k, g.pieces[k]));
    expect(Object.keys(doc.assets).sort()).toEqual([...keys].sort());
    for (const k of Object.keys(doc.assets)) expect(k).toMatch(/^tabletop\/lost-cities\/[\w-]+@[0-9a-f]{8}$/);
    expect(calls.made).toHaveLength(keys.length);
    for (const f of calls.made) {
      expect(f.mimeType).toBe("model/gltf-binary");
      expect(f.bytes).toBeInstanceOf(Uint8Array);
      expect(f.hint.bounds.min).toHaveLength(3);
    }
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    const objects = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(objects).toHaveLength(60 + 3);
    for (const o of objects) {
      expect(urls.has(o.sourceUrl)).toBe(true);
      expect(o.hint.bounds.max).toHaveLength(3);
    }
    expect(doc.order).toHaveLength(Object.keys(doc.objects).length);
  });

  it("the key changes with the art: it hashes what the GLB is drawn from", () => {
    const g = game();
    const a = gameFileKey("lost-cities", "back", g.pieces.back);
    expect(a).toBe(`tabletop/lost-cities/back@${fnv(glbKey(g.pieces.back))}`);
    g.pieces.back.parts[0].color = "#123456";
    expect(gameFileKey("lost-cities", "back", g.pieces.back)).not.toBe(a);
    expect(fnv("")).toBe("811c9dc5");
  });

  it("makes the deck doc before the one change that writes the table", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    expect(calls.changes).toBe(1);
    const at = calls.log.findIndex((e) => e.op === "change");
    expect(at).toBe(calls.log.length - 1);
    expect(calls.log.filter((e) => e.op === "create" && e.type === "secure-deck")).toHaveLength(1);
    expect(calls.log.findIndex((e) => e.type === "secure-deck")).toBeLessThan(at);
  });

  it("points every hidden card at the deck it made, a secure one where a provider is installed", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    const i = calls.created.findIndex((d) => d["@patchwork"].type === "secure-deck");
    const deckUrl = `automerge:file${i + 1}`;
    const deck = calls.created[i];
    expect(deck.title).toBe("Lost Cities table: Deck");
    const hidden = Object.entries(doc.objects).filter(([, o]) => o.traits?.["tabletop.hidden"]);
    expect(hidden).toHaveLength(60);
    for (const [, o] of hidden) expect(o.traits["tabletop.hidden"].by).toBe(deckUrl);
    expect(Object.keys(deck.slots).sort()).toEqual(hidden.map(([id]) => id).sort());
    // its faces and back are the scene's files
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    for (const f of deck.faces) expect(urls.has(f.sourceUrl)).toBe(true);
    expect(urls.has(deck.back.sourceUrl)).toBe(true);
    expect(calls.notices.some((n) => n.kind === "warn")).toBe(false);
  });

  it("with no secure-deck provider, falls back to a plain deck and says the hands aren't secret", async () => {
    for (const registries of [{}, { "tabletop:deck": fakeRegistry([]) }]) {
      const doc = emptyScene();
      const { ctx, calls } = fakeDrop(doc, { registries });
      await lostCities.create(ctx);
      const decks = calls.created.filter((d) => d["@patchwork"].type !== "file");
      expect(decks.map((d) => d["@patchwork"].type)).toEqual(["plain-deck"]);
      expect(Object.keys(decks[0].objects)).toHaveLength(60);
      const warn = calls.notices.find((n) => n.kind === "warn");
      expect(warn.text).toMatch(/plain one: anyone who opens the deck can read every hand/);
    }
  });

  it("starts in play, in the hand, seated nowhere yet, and says to pick a seat; nothing is the table's About", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    expect(doc.view.activity).toBe("play");
    expect(doc.view.tool).toBe("hand");
    expect(doc.view.snap).toBe(true);
    expect(doc.title).toBe("Lost Cities table");
    expect(doc.traits["tabletop.seats"]).toEqual({
      p1: expect.objectContaining({ name: "Player 1", player: null }),
      p2: expect.objectContaining({ name: "Player 2", player: null }),
    });
    expect(JSON.stringify(doc)).not.toContain("infoUrl");
    expect(calls.notices.at(-1)).toEqual({ text: "Pick a seat (top right) to play.", kind: "info" });
  });

  it("keeps a title the scene already has", async () => {
    const doc = { ...emptyScene(), title: "Friday night" };
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    expect(doc.title).toBe("Friday night");
    expect(calls.created.find((d) => d["@patchwork"].type === "secure-deck").title).toBe("Friday night: Deck");
  });

  it("reuses the scene's files: a second table makes no new GLBs", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await layOutTable(ctx, "lost-cities", lostCitiesGame);
    const made = calls.made.length;
    const assets = structuredClone(doc.assets);
    await layOutTable(ctx, "lost-cities", lostCitiesGame);
    expect(calls.made).toHaveLength(made);
    expect(doc.assets).toEqual(assets);
  });

  it("on a stage without ctx.file, files a doc of its own for each kind", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { file: false, registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx);
    expect(doc.assets).toEqual({});
    const files = calls.created.filter((d) => d["@patchwork"].type === "file");
    expect(files).toHaveLength(kindsUsed(game()).length);
    for (const o of Object.values(doc.objects)) if (o.kind !== "group") expect(o.sourceUrl).toMatch(/^automerge:file\d+$/);
  });
});

describe("the Santorini template", () => {
  it("lays the island out with its own art, no decks, no seats", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc);
    await santorini.create(ctx);
    expect(calls.created.every((d) => d["@patchwork"].type === "file")).toBe(true);
    expect(Object.keys(doc.assets).every((k) => k.startsWith("tabletop/santorini/"))).toBe(true);
    const objects = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(objects).toHaveLength(79);
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    for (const o of objects) expect(urls.has(o.sourceUrl)).toBe(true);
    expect(doc.traits).toEqual({});
    // nothing here starts the table extension, so play isn't on offer: the doc doesn't claim it
    expect(doc.view).toMatchObject({ tool: "hand" });
    expect(doc.view).not.toHaveProperty("activity");
    expect(calls.changes).toBe(1);
    expect(calls.notices.at(-1).text).toMatch(/Santorini is laid out/);
  });
});

describe("in a real automerge change", () => {
  it("writes the same table as onto a plain doc", async () => {
    const plain = emptyScene();
    const { ctx } = fakeDrop(plain, { registries: { "tabletop:deck": secureDecks() } });
    const rng = () => 0.25;
    await layOutTable(ctx, "lost-cities", lostCitiesGame, { rng });
    // the same again, through a change on an automerge doc
    let real = Automerge.from(emptyScene());
    const live = emptyScene();
    const { ctx: c2 } = fakeDrop(live, { registries: { "tabletop:deck": secureDecks() } });
    c2.change = (fn) => {
      real = Automerge.change(real, (d) => {
        d.assets = structuredClone(live.assets);
        fn(d);
      });
    };
    await layOutTable(c2, "lost-cities", lostCitiesGame, { rng });
    expect(Automerge.toJS(real)).toEqual(plain);
  });
});
