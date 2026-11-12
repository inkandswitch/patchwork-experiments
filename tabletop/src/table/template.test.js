// The Lost Cities and Santorini templates against a stand-in for the stage's
// drop context: the art they file, the decks they make and when, and the
// table they write.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { lostCities, santorini, layOutTable, gameFileKey, fnv } from "./template.js";
import * as lostCitiesGame from "../games/lost-cities.js";
import { kindsUsed } from "../setup.js";
import { glbKey } from "../pieces.js";
import { fakeDrop } from "../test/fakes.js";
import { SEATS, keeperPlugin, keptIn, registries, seatsPlugin } from "../test/stand-ins.js";
import { emptyScene } from "../empty-scene.js";

/** What's installed where a table is usually made: whoever owns seats, and a keeper of each kind (stand-ins). */
const installed = () => registries(seatsPlugin(), keeperPlugin("joint"), keeperPlugin("plain"));

const game = () => {
  const g = {};
  lostCitiesGame.fill(g);
  return g;
};

describe("the Lost Cities template", () => {
  it("files one GLB per kind under a versioned key, and every object shows one of them", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
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

  it("makes the deck's container before the one change that writes the table", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    expect(calls.changes).toBe(1);
    const at = calls.log.findIndex((e) => e.op === "change");
    expect(at).toBe(calls.log.length - 1);
    expect(calls.log.filter((e) => e.op === "create" && e.type === "t-joint")).toHaveLength(1);
    expect(calls.log.findIndex((e) => e.type === "t-joint")).toBeLessThan(at);
  });

  it("binds every card to a slot of the container it had made, by a keeper whose players shuffle where one is installed", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    const i = calls.created.findIndex((d) => d["@patchwork"].type === "t-joint");
    const deckUrl = `automerge:file${i + 1}`;
    const deck = calls.created[i];
    expect(deck.title).toBe("Lost Cities table: Deck");
    const cards = Object.entries(doc.objects).filter(([, o]) => o.traits?.["tabletop.card"]);
    expect(cards).toHaveLength(60);
    for (const [, o] of cards) {
      expect(o.traits["tabletop.card"]).toEqual({});
      expect(keptIn(o)).toMatchObject({ kind: "joint", by: deckUrl });
    }
    expect(cards.map(([, o]) => keptIn(o).slot).sort((x, y) => x - y)).toEqual(Array.from({ length: 60 }, (_, k) => k));
    // what it holds are the scene's files
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    expect(deck.items).toHaveLength(60);
    for (const f of deck.items) expect(urls.has(f.sourceUrl)).toBe(true);
    expect(calls.notices.some((n) => n.kind === "warn")).toBe(false);
    // and the scene says nothing of which card is which: every card is its back
    expect(new Set(cards.map(([, o]) => o.sourceUrl)).size).toBe(1);
  });

  it("with only a plain keeper installed, the deck is kept in the open and the maker is told the hands aren't secret", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: registries(seatsPlugin(), keeperPlugin("plain")) });
    await lostCities.create(ctx);
    const decks = calls.created.filter((d) => d["@patchwork"].type !== "file");
    expect(decks.map((d) => d["@patchwork"].type)).toEqual(["t-plain"]);
    expect(decks[0].items).toHaveLength(60);
    const warn = calls.notices.find((n) => n.kind === "warn");
    expect(warn.text).toMatch(/kept in the open: anyone who opens it can read every hand/);
  });

  it("with no keeper installed at all, lays nothing out and says why: it never writes a card nothing keeps", async () => {
    for (const reg of [{}, registries(seatsPlugin())]) {
      const doc = emptyScene();
      const { ctx, calls } = fakeDrop(doc, { registries: reg });
      await lostCities.create(ctx);
      expect(calls.changes).toBe(0);
      expect(doc.objects).toEqual({});
      expect(calls.notices.at(-1)).toMatchObject({ kind: "error", text: expect.stringMatching(/nothing installed here keeps them/) });
    }
  });

  it("with nothing that owns seats, the table has none, and says so; it writes no seats of its own", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: registries(keeperPlugin("joint")) });
    await lostCities.create(ctx);
    expect(Object.keys(doc.objects).length).toBeGreaterThan(60);
    expect(doc.traits).toEqual({});
    expect(calls.notices.some((n) => n.kind === "warn" && /owns seats/.test(n.text))).toBe(true);
  });

  it("starts in play, in the hand, seated nowhere yet, and says to pick a seat; nothing is the table's About", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    expect(doc.view.activity).toBe("play");
    expect(doc.view.tool).toBe("hand");
    expect(doc.view.snap).toBe(true);
    expect(doc.title).toBe("Lost Cities table");
    expect(doc.traits[SEATS]).toEqual({
      p1: expect.objectContaining({ name: "Player 1", player: null }),
      p2: expect.objectContaining({ name: "Player 2", player: null }),
    });
    expect(JSON.stringify(doc)).not.toContain("infoUrl");
    expect(calls.notices.at(-1)).toEqual({ text: "Pick a seat (top right) to play.", kind: "info" });
  });

  it("keeps a title the scene already has", async () => {
    const doc = { ...emptyScene(), title: "Friday night" };
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    expect(doc.title).toBe("Friday night");
    expect(calls.created.find((d) => d["@patchwork"].type === "t-joint").title).toBe("Friday night: Deck");
  });

  it("reuses the scene's files: a second table makes no new GLBs", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await layOutTable(ctx, "lost-cities", lostCitiesGame);
    const made = calls.made.length;
    const assets = structuredClone(doc.assets);
    await layOutTable(ctx, "lost-cities", lostCitiesGame);
    expect(calls.made).toHaveLength(made);
    expect(doc.assets).toEqual(assets);
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
    const { ctx } = fakeDrop(plain, { registries: installed() });
    const rng = () => 0.25;
    await layOutTable(ctx, "lost-cities", lostCitiesGame, { rng });
    // the same again, through a change on an automerge doc
    let real = Automerge.from(emptyScene());
    const live = emptyScene();
    const { ctx: c2 } = fakeDrop(live, { registries: installed() });
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
