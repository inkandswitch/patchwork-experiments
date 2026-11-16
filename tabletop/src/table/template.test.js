// The templates against a stand-in for the stage's drop context: each loads
// its game by id from the registry (this package's games/*.json, registered
// as index.js registers them), and these check the art it files, the
// containers it makes and when, and the table it writes.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { setUp, template } from "./template.js";
import { lookFileKey } from "./files.js";
import { kindsUsed } from "../setup.js";
import { lookKey, shortHash } from "../look/look.js";
import { fakeDrop } from "../test/fakes.js";
import { SEATS, keeperPlugin, keptIn, registries, seatsPlugin } from "../test/stand-ins.js";
import { game as builtIn, gamePlugins } from "../test/games.js";
import { emptyScene } from "../empty-scene.js";
import { CASES, cardsGame } from "../test/table-notes.js";

/** What's installed where a table is usually made: whoever owns seats, a keeper of each kind (stand-ins), and the games. */
const installed = (...more) => registries(seatsPlugin(), keeperPlugin("joint"), keeperPlugin("plain"), ...gamePlugins(), ...more);
const lostCities = template("lost-cities");
const santorini = template("santorini");
const game = () => builtIn("lost-cities");

describe("the Lost Cities template", () => {
  it("files one GLB per kind under a versioned key, and every object shows one of them", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    const g = game();
    const keys = kindsUsed(g).map((k) => lookFileKey(g.pieces[k]));
    expect(Object.keys(doc.assets).sort()).toEqual([...new Set(keys)].sort());
    for (const k of Object.keys(doc.assets)) expect(k).toMatch(/^tabletop\/look@[0-9a-z]+$/);
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

  it("the key changes with the art, and only with it: it hashes what the GLB is drawn from", () => {
    const g = game();
    const a = lookFileKey(g.pieces.back);
    expect(a).toBe(`tabletop/look@${shortHash(lookKey(g.pieces.back))}`);
    expect(lookFileKey({ ...g.pieces.back, name: "Another" })).toBe(a);
    g.pieces.back.parts[0].color = "#123456";
    expect(lookFileKey(g.pieces.back)).not.toBe(a);
  });

  it("with no such game installed, or one that isn't valid, lays nothing out and says why", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await template("no-such-game").create(ctx);
    expect(calls.notices.at(-1)).toEqual({ kind: "error", text: "There's no game “no-such-game” installed here." });
    const bad = { ...game(), setup: [{ piece: "nowhere" }] };
    await setUp(ctx, bad);
    expect(calls.notices.at(-1)).toMatchObject({ kind: "error", text: expect.stringMatching(/isn't a game this can lay out: unknown-piece at \$\.setup\[0\]\.piece/) });
    expect([calls.changes, calls.made.length]).toEqual([0, 0]);
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
    // titled by the game and its deck: never by the scene it's in
    expect(deck.title).toBe("Lost Cities: Deck");
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
    const { ctx, calls } = fakeDrop(doc, { registries: registries(seatsPlugin(), keeperPlugin("plain"), ...gamePlugins()) });
    await lostCities.create(ctx);
    const decks = calls.created.filter((d) => d["@patchwork"].type !== "file");
    expect(decks.map((d) => d["@patchwork"].type)).toEqual(["t-plain"]);
    expect(decks[0].items).toHaveLength(60);
    const warn = calls.notices.find((n) => n.kind === "warn");
    expect(warn.text).toMatch(/kept in the open: anyone who opens it can read every hand/);
  });

  it("with no keeper installed at all, lays nothing out and says why: it never writes a card nothing keeps", async () => {
    for (const reg of [registries(...gamePlugins()), registries(seatsPlugin(), ...gamePlugins())]) {
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
    const { ctx, calls } = fakeDrop(doc, { registries: registries(keeperPlugin("joint"), ...gamePlugins()) });
    await lostCities.create(ctx);
    expect(Object.keys(doc.objects).length).toBeGreaterThan(60);
    expect(doc.traits).toEqual({});
    expect(calls.notices.some((n) => n.kind === "warn" && /owns seats/.test(n.text))).toBe(true);
  });

  it("starts people in the seat body, seated nowhere yet, and says to pick a seat; nothing is the table's About", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx);
    expect(doc.view.start).toMatchObject({ body: "seat", home: expect.any(Object) });
    expect("activity" in doc.view || "tool" in doc.view || "home" in doc.view).toBe(false);
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
    expect(calls.created.find((d) => d["@patchwork"].type === "t-joint").title).toBe("Lost Cities: Deck");
  });

  it("reuses the scene's files: a second table makes no new GLBs", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: installed() });
    await setUp(ctx, "lost-cities");
    const made = calls.made.length;
    const assets = structuredClone(doc.assets);
    await setUp(ctx, "lost-cities");
    expect(calls.made).toHaveLength(made);
    expect(doc.assets).toEqual(assets);
  });
});

describe("the Santorini template", () => {
  it("lays the island out with its own art, no decks; its seats are the seat owner's to lay (none installed here)", async () => {
    const doc = emptyScene();
    const { ctx, calls } = fakeDrop(doc, { registries: registries(...gamePlugins()) });
    await santorini.create(ctx);
    expect(calls.created.every((d) => d["@patchwork"].type === "file")).toBe(true);
    expect(Object.keys(doc.assets).every((k) => k.startsWith("tabletop/look@"))).toBe(true);
    const objects = Object.values(doc.objects).filter((o) => o.kind !== "group");
    expect(objects).toHaveLength(79);
    const urls = new Set(Object.values(doc.assets).map((a) => a.url));
    for (const o of objects) expect(urls.has(o.sourceUrl)).toBe(true);
    expect(doc.traits).toEqual({});
    // people start in the seat body, at its home view until a seat is there to watch from
    expect(doc.view).not.toHaveProperty("tool");
    expect(doc.view.start).toEqual({ body: "seat", home: expect.any(Object) });
    expect(calls.changes).toBe(1);
    expect(calls.notices.at(-1).text).toMatch(/Santorini is laid out/);
  });
});

describe("in a real automerge change", () => {
  it("writes the same table as onto a plain doc", async () => {
    const plain = emptyScene();
    const { ctx } = fakeDrop(plain, { registries: installed() });
    const rng = () => 0.25;
    await setUp(ctx, "lost-cities", { rng });
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
    await setUp(c2, "lost-cities", { rng });
    expect(Automerge.toJS(real)).toEqual(plain);
  });
});

describe("the Draw Dominoes templates", () => {
  for (const n of [2, 3, 4]) {
    it(`(${n} players) lay the felt, ${n} racks, ${n} seats and the 28 tiles face down, kept by a keeper whose players shuffle, in one change, in play`, async () => {
      const doc = emptyScene();
      const { ctx, calls } = fakeDrop(doc, { registries: installed() });
      await template(`draw-dominoes-${n}`).create(ctx);
      expect(calls.changes).toBe(1);
      // one file per look: the racks are one kind, and the art is the same whatever the count
      const two = builtIn("draw-dominoes-2");
      expect(Object.keys(doc.assets).sort()).toEqual(kindsUsed(two).map((k) => lookFileKey(two.pieces[k])).sort());
      const objects = Object.values(doc.objects).filter((o) => o.kind !== "group");
      const tiles = objects.filter((o) => o.traits?.["tabletop.card"]);
      expect(tiles).toHaveLength(28);
      for (const o of tiles) {
        expect(keptIn(o)).toMatchObject({ kind: "joint" });
        expect(o.name).toBe("Domino");
        expect(o.transform.rotation[2]).toBeCloseTo(Math.PI, 9);
      }
      expect(new Set(tiles.map((o) => keptIn(o).slot)).size).toBe(28);
      expect(objects.filter((o) => o.traits?.["tabletop.zone"])).toHaveLength(n);
      expect(Object.keys(doc.traits[SEATS])).toHaveLength(n);
      expect(doc.view.start.body).toBe("seat");
      const deck = calls.created.find((d) => d["@patchwork"].type === "t-joint");
      expect(deck.items).toHaveLength(28);
      expect(new Set(deck.items.map((i) => i.name)).size).toBe(28);
      // the scene itself names no tile: every tile shows the one back
      expect(new Set(tiles.map((o) => o.sourceUrl)).size).toBe(1);
    });
  }
});

describe("what the maker is warned of (test/table-notes.js: the game page's status line says the same)", () => {
  for (const c of CASES)
    it(c.name, async () => {
      const doc = emptyScene();
      const plugins = [...c.keepers.map((k) => keeperPlugin(k)), ...(c.owner ? [seatsPlugin()] : [])];
      const { ctx, calls } = fakeDrop(doc, { registries: registries(...plugins) });
      expect(await setUp(ctx, cardsGame(c))).not.toBe(null);
      expect(calls.notices.filter((n) => n.kind === "warn").map((n) => n.text)).toEqual(c.expected);
    });
});
