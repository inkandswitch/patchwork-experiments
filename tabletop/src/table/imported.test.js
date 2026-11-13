// A Tabletop Simulator mod's game, as tts-import translates it (the
// contract's valid/tts-tiny-mod.json is its tiny fixture mod, translated),
// set up and played with nothing of its own: the same tableLayout,
// makeHolders and writeTable as a built-in game, then the table extension and
// the rule over the scene that makes. Shuffle, Draw, a private hand, a secure
// deck, a bag and a die all act on traits the setup wrote, never on where the
// game came from. Keepers, the bag maker and the seats' owner are stand-ins.
import { afterEach, describe, it, expect, vi } from "vitest";
import { tableLayout, writeTable } from "../setup.js";
import { makeHolders } from "./made-with.js";
import { extrasOf } from "../look/look.js";
import { emptyScene } from "../empty-scene.js";
import Extension from "./extension.js";
import { audienceOf, faceUpIn } from "./visibility.js";
import { testScene } from "./test-scene.js";
import * as fakes from "../test/fakes.js";
import { fakeRepo } from "../test/games.js";
import tiny from "../../contract/v1/fixtures/valid/tts-tiny-mod.json" with { type: "json" };
import { BAG, SEATS, bagPlugin, keeperOf, keeperPlugin, keptIn, registries, roster, seatsPlugin } from "../test/stand-ins.js";

const game = () => structuredClone(tiny);
const urlOf = (kind) => `automerge:${kind}`;
const kindOf = (url) => url.slice("automerge:".length);
// every piece drawn the size of a card: only where things are matters here
const fileOf = (kind) => ({ url: urlOf(kind), hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.0003, 0.04] } } });

/** The imported game set up as a table, with the keepers, bag maker and seats' owner given; alice in the one seat. */
async function setUp(g = game(), keepers = ["joint", "plain"]) {
  const installed = async (t) => registries(...keepers.map(keeperPlugin), bagPlugin(), seatsPlugin())[t] ?? null;
  const layout = tableLayout(g, { fileOf, rng: () => 0.5 });
  const repo = fakeRepo();
  const made = await makeHolders({ repo, registry: installed }, layout);
  const lay = (await (await installed("scene:extension")).load("t.seats")).module.lay;
  const scene = emptyScene({ title: g.title });
  writeTable(scene, layout, made, { seats: lay });
  scene.traits[SEATS].white.player = "alice";
  // what each object's GLB carries, as the game page draws it (look.js): the hand's card slots
  const content = Object.fromEntries(Object.entries(scene.objects).flatMap(([id, o]) => (o.sourceUrl ? [[id, { extras: extrasOf(g.pieces[kindOf(o.sourceUrl)]) }]] : [])));
  return { g, layout, made, repo, scene, content };
}

const byName = (scene, name) => Object.entries(scene.objects).filter(([, o]) => o.name === name).map(([id]) => id);

describe("an imported game, set up as any game is", () => {
  afterEach(() => vi.useRealTimers());

  it("is set up from the game alone: its origin carried, its seat laid, in play", async () => {
    const { g, scene, made } = await setUp();
    expect(made.notes).toEqual([]);
    expect(scene.origin).toEqual({ tts: { saveName: "Tiny Test Mod", fileName: "Workshop/1234567890.json", workshopId: "1234567890" } });
    expect(scene.origin).toEqual(g.origin);
    expect(Object.keys(scene.traits[SEATS])).toEqual(["white"]);
    expect(scene.view.activity).toBe("play");
  });

  it("every card is kept: the deck's three in a container titled by the game and deck, the loose one in the game's", async () => {
    const { layout, made, scene } = await setUp();
    expect(Object.values(layout.containers).map((c) => [c.title, c.secure, c.items.length])).toEqual([
      ["Tiny Test Mod: Draw pile", false, 3],
      ["Tiny Test Mod: Cards", false, 1],
    ]);
    expect(Object.values(made.kinds)).toEqual(["plain", "plain"]);
    const cards = Object.values(scene.objects).filter((o) => o.traits?.["tabletop.card"]);
    expect(cards).toHaveLength(4);
    for (const o of cards) expect(keptIn(o)).toMatchObject({ kind: "plain" });
    // each drawn as its back: what it is, is its keeper's
    expect(new Set(cards.map((o) => kindOf(o.sourceUrl)))).toEqual(new Set(["p8h1dj21q8kpo3"]));
  });

  it("a deck someone marks secure (the game page's tick) is kept by a keeper whose players shuffle between them; with none installed, by a plain one", async () => {
    const g = game();
    g.setup.find((t) => t.deck).deck.secure = true;
    const joint = await setUp(g);
    expect(Object.values(joint.made.kinds)).toEqual(["joint", "plain"]);
    const drawPile = Object.values(joint.scene.objects).filter((o) => keptIn(o)?.kind === "joint");
    expect(drawPile).toHaveLength(3);
    const fallback = await setUp(g, ["plain"]);
    expect(Object.values(fallback.made.kinds)).toEqual(["plain", "plain"]);
  });

  it("the bag holds what TTS had in it, in a bag document; the die is a die by its trait", async () => {
    const { scene, repo } = await setUp();
    const [pouch] = byName(scene, "Pouch");
    const doc = repo.docs.get(scene.objects[pouch].traits[BAG].doc);
    expect(doc).toMatchObject({ "@patchwork": { type: "t-bag" }, rule: "random" });
    expect(doc.items.map((i) => i.object.name)).toEqual(["Token in the bag", "Lost model"]);
    // never in the scene
    expect(byName(scene, "Token in the bag")).toEqual([]);
    const dice = Object.values(scene.objects).filter((o) => o.traits?.["dice.die"]);
    expect(dice.map((o) => o.name)).toEqual(["Die"]);
  });

  it("Shuffle and Draw are offered on its deck, and Draw puts the top card in the seat's hand, where only its player may see it", async () => {
    const { scene, content } = await setUp();
    const w = fakes.fakeWorld(scene, { content });
    const api = w.join("A", { viewer: "alice" });
    const keeper = keeperOf(() => w.doc.objects);
    w.view("A").collected = { roster, keeper };
    const x = w.attach("A", Extension.create(api));
    w.flush();
    await vi.advanceTimersByTimeAsync(10);

    // the deck: three cards, face down, one on another
    const byContainer = Object.groupBy(Object.keys(w.doc.objects).filter((id) => keptIn(w.doc.objects[id])), (id) => keptIn(w.doc.objects[id]).by);
    const pile = Object.values(byContainer).find((ids) => ids.length > 1);
    expect(pile).toHaveLength(3);
    const [bottom, , top] = [...pile].sort((a, b) => w.doc.objects[a].transform.position[1] - w.doc.objects[b].transform.position[1]);
    for (const id of pile) expect(faceUpIn(testScene(w.doc.objects), id)).toBe(false);

    const shuffle = x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.state(bottom)).not.toBeNull();
    shuffle.run(bottom);
    expect(keeper.calls.map((ids) => [...ids].sort())).toEqual([[...pile].sort()]);

    const draw = x.commands.find((c) => c.id === "draw");
    expect(draw.state(bottom, { scene: api.scene(), local: api.local.get() })).toEqual({ title: "Draw the top card into your hand (D)" });
    draw.run(bottom);
    w.tick(1 / 60, 30);
    const [hand] = byName(w.doc, "White's hand");
    // in the hand's first card slot, face up
    const snap = testScene(w.doc.objects);
    const m = snap.world(top);
    const h = snap.world(hand);
    const slot0 = [-0.09525, 0.002, 0];
    const want = [0, 1, 2].map((r) => h[r] * slot0[0] + h[4 + r] * slot0[1] + h[8 + r] * slot0[2] + h[12 + r]);
    for (let r = 0; r < 3; r++) expect(m[12 + r]).toBeCloseTo(want[r], 5);
    expect(faceUpIn(snap, top)).toBe(true);
    // the rule: the seat's player alone; the cards left on the table, nobody
    const of = audienceOf(snap, roster.seats(w.doc));
    expect(of(top)).toEqual({ show: ["alice"], only: ["alice"] });
    expect(of(bottom)).toBeNull();
    w.done();
  });
});
