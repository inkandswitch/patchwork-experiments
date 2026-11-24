// A table set down on something that moves (a Card table on a cart): the
// layout under a parent, Draw and the free-slot search in the
// parent's frame, the hand's face-up test against the trays as drawn, and
// the two parts that set it all up. (The seat's view riding the table, and
// name tags on the hands as drawn, are the seats' owner's.)
import { afterEach, describe, it, expect, vi } from "vitest";
import { CARD, ZONE } from "./visibility.js";
import Extension from "./extension.js";
import * as fakes from "../test/fakes.js";
import { SEATS, keeperOf, keptIn, keptTrait, registries, roster, seatsPlugin } from "../test/stand-ins.js";
import { emptyScene } from "../empty-scene.js";
import { apply, composeMatrix, multiply } from "./frame.js";
import { tableLayout, writeTable } from "../setup.js";
import { cardTable, gamePart, PIECES, TABLE, GAME_TAG, partKey, squared } from "./parts.js";
import { game as builtIn, gamePlugins } from "../test/games.js";

const lostCities = gamePart("lost-cities");

afterEach(() => vi.useRealTimers());

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
let slot = 0;
const hidden = () => ({ [CARD]: {}, [keptTrait("plain")]: { by: DECK, slot: slot++ } });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const near = (got, want, digits = 6) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const sameMatrix = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const lay = (await seatsPlugin().load()).lay;

// a cart turned 0.7, a table across its bed, a turned-round hand for p2
const CART = T([10, 0, 5], [0, 0.7, 0]);
const TBL = T([0, 0.72, 2.85], [0, Math.PI / 2, 0]);
const card = (position, rotation = [0, 0.4, Math.PI]) => ({ name: "Card", parent: "tbl", transform: T(position, rotation), traits: hidden(), tags: ["card"] });
const tray = (n = 4, yaw = 0.25) => ({
  extras: { connectors: Array.from({ length: n }, (_, k) => ({ position: [+(-0.27 + k * 0.06).toFixed(3), 0.002, 0], yaw, tags: ["card"] })), snapRadius: 0.03 },
});

async function onCart({ local = {}, seated = { p1: { name: "Player 1", player: null }, p2: { name: "Player 2", player: null } } } = {}) {
  const objects = {
      cart: { name: "Cart", transform: CART },
      tbl: { name: "Card table", parent: "cart", transform: TBL, locked: true },
      hand1: { name: "Hand 1", parent: "tbl", transform: T([0, 0.7, 0.5]), traits: zone("p1") },
      hand2: { name: "Hand 2", parent: "tbl", transform: T([0, 0.7, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
      kept: card([-0.27, 0.702, 0.5], [0, 0.25, 0]),
      low: card([0.3, 0.701, 0]),
      mid: card([0.3, 0.702, 0]),
      top: card([0.3, 0.703, 0]),
      board: { name: "Board", parent: "tbl", transform: T([0, 0.7, 0]), locked: true },
  };
  const doc = emptyScene({ objects, order: Object.keys(objects), traits: { [SEATS]: seated } });
  const w = fakes.fakeWorld(doc, { content: { hand1: tray(), hand2: tray() } });
  const at = (session, viewer, o) => {
    const api = w.join(session, { viewer, ...o });
    w.view(session).collected = { roster, keeper: keeperOf(() => w.doc.objects) };
    return [api, w.attach(session, Extension.create(api))];
  };
  const [a, xa] = at("A", "alice", { local });
  const [b, xb] = at("B", "bob");
  w.flush();
  await vi.advanceTimersByTimeAsync(10);
  /** The cart drawn somewhere the doc hasn't caught up with yet (a peer moving it). */
  const roll = (t) => w.holds.set("cart", { session: "SIM", transform: t, at: Date.now() });
  const cmd = (x, id) => x.commands.find((c) => c.id === id);
  return { w, a, b, xa, xb, roll, cmd };
}

describe("drawing at a table on a cart", () => {
  it("glides the top card into your first free slot, in the table's frame, whatever the cart is drawn doing", async () => {
    const t = await onCart({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: "bob" } } });
    t.roll(T([13, 0.3, 7], [0.08, 1.1, -0.05])); // rolled on, tipped: the doc hasn't been told yet
    expect(t.cmd(t.xa, "draw").state("mid", { scene: t.a.scene(), local: t.a.local.get() })).toEqual({ title: expect.stringMatching(/into your hand$/) });
    t.cmd(t.xa, "draw").run("mid");
    t.w.tick(1 / 60, 40);
    const o = t.w.doc.objects.top;
    expect(o.parent).toBe("tbl");
    // slot 0 has a card: the next, square to the tray, on the table
    near(o.transform.position, [-0.21, 0.702, 0.5]);
    near(o.transform.rotation, [0, 0.25, 0]);
    // the next draw: the next slot
    t.cmd(t.xa, "draw").run("mid");
    t.w.tick(1 / 60, 40);
    near(t.w.doc.objects.mid.transform.position, [-0.15, 0.702, 0.5]);
    t.w.done();
  });

  it("Shuffle and Draw apply whatever body you're in: walking, their keys are the body's (the stage shows them without), never hidden", async () => {
    const t = await onCart({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: null } } });
    const ctx = (local) => ({ scene: t.a.scene(), local: { ...t.a.local.get(), ...local } });
    for (const [body, hands] of [[{ id: "walk" }, []], [{ id: "seat" }, []], [{ id: "look" }, []], [{ id: "look" }, [{ kind: "edit", name: "Edit" }]], [{ id: "walk" }, [{ kind: "edit", name: "Edit" }]]]) {
      expect(t.cmd(t.xa, "shuffle").state("top", ctx({ body, hands }))).not.toBe(null);
      expect(t.cmd(t.xa, "draw").state("top", ctx({ body, hands }))).not.toBe(null);
    }
    t.w.done();
  });
});

describe("the hand at a table on a cart", () => {
  it("turns a card face up over your tray as it's drawn, not where the doc last had the cart", async () => {
    const t = await onCart({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: null } } });
    t.roll(T([12, 0.4, 7.5], [0.1, 0.95, 0]));
    const seen = apply(t.a.worldOf("hand1"), [0.1, 0.01, 0]);
    const doc = apply(t.a.scene().world("hand1"), [0.1, 0.01, 0]);
    expect(t.xa.landing("top", seen)).toEqual({ faceUp: true });
    expect(t.xa.landing("top", doc)).toBe(null);
    t.w.done();
  });
});

describe("the Card table and Lost Cities parts", () => {
  const emptyCart = () =>
    emptyScene({
      title: "A cart",
      objects: { cart: { name: "Cart", transform: CART, parent: null } },
      order: ["cart"],
      view: { units: "m", start: { home: { position: [12, 6.5, 16], target: [0, 2.5, 0] } } },
    });
  // what's installed: whoever owns seats, and the games
  const installed = () => registries(seatsPlugin(), ...gamePlugins());

  it("a Card table goes under what it's put on, square to it, locked, with a top that takes a game", async () => {
    const doc = emptyCart();
    const { ctx } = fakes.fakeDrop(doc);
    const id = await cardTable.create(ctx, { parent: "cart", transform: { position: [0, 0.72, 2.85], rotation: [0.06, Math.PI / 2, -0.03], scale: 1 } });
    const o = doc.objects[id];
    expect(o).toMatchObject({ name: "Card table", parent: "cart", locked: true });
    near(o.transform.position, [0, 0.72, 2.85]);
    expect(o.transform.rotation[0]).toBe(0);
    expect(o.transform.rotation[2]).toBe(0);
    expect(o.transform.rotation[1]).toBeCloseTo(squared({ rotation: [0.06, Math.PI / 2, -0.03] }).rotation[1], 6);
    expect(o.sourceUrl).toBe(doc.assets[partKey("table")].url);
    expect(o.hint.bounds.max[1]).toBeCloseTo(TABLE.h, 2);
    expect(PIECES.table.snapPoints).toEqual([{ position: [0, TABLE.h + 0.0006, 0], rotation: [0, 0, 0], tags: [GAME_TAG] }]);
  });

  it("Lost Cities on it: a game doc of its own, laid out whole (its pieces, its seats in its root frame, its title and start), linked onto the table, locked; the cart's doc gains only the link", async () => {
    const doc = emptyCart();
    const { ctx, calls } = fakes.fakeDrop(doc, { registries: installed() });
    const tid = await cardTable.create(ctx, { parent: "cart", transform: TBL });
    const before = { view: structuredClone(doc.view), title: doc.title, objects: Object.keys(doc.objects).length };
    const link = await lostCities.create(ctx, { parent: tid, transform: { position: [0, TABLE.h + 0.0006, 0], rotation: [0, 0, 0], scale: 1 } });
    // the cart's doc: one more object, the link, under the table, locked; its view and title as they were, no seats
    expect(Object.keys(doc.objects)).toHaveLength(before.objects + 1);
    expect(doc.objects[link]).toMatchObject({ providerId: "scene.link", parent: tid, locked: true });
    expect(doc.objects[link].hint.bounds.max[1]).toBeGreaterThan(0);
    expect(doc.view).toEqual(before.view);
    expect(doc.title).toBe(before.title);
    expect(doc.traits?.[SEATS]).toBeUndefined();
    // the game: its own doc, every piece at its root
    const game = ctx.made(doc.objects[link].sourceUrl);
    expect(game["@patchwork"].type).toBe("scene");
    expect(game.title).toBe("Lost Cities table");
    const pieces = Object.values(game.objects).filter((o) => o.kind !== "group");
    expect(pieces).toHaveLength(63);
    for (const o of pieces) expect(o.parent ?? null).toBe(null);
    // its seats in its root frame (nothing to be `in`), and it starts people in the seat body
    expect(game.traits[SEATS].p1.camera).toEqual({ position: [0, 0.5, 0.95], target: [0, 0, 0.16] });
    expect(game.view.start.body).toBe("seat");
    // its files are its own; its deck asks for its players to shuffle it, named for the game
    for (const o of pieces) expect(Object.values(game.assets).map((a) => a.url)).toContain(o.sourceUrl);
    const cards = pieces.filter((o) => o.traits?.[CARD]);
    expect(cards).toHaveLength(60);
    expect(new Set(cards.map((o) => keptIn(o).kind))).toEqual(new Set(["joint"]));
    const container = calls.created.find((d) => d?.["@patchwork"]?.type === "secure-deck");
    expect(container.title).toBe("Lost Cities: Deck");
  });

  it("two games: two docs, each with its own p1 and p2 and its hands named by them", async () => {
    const doc = emptyCart();
    const { ctx } = fakes.fakeDrop(doc, { registries: installed() });
    const a = await lostCities.create(ctx, { parent: "cart", transform: T([0, 1, 0]) });
    const b = await lostCities.create(ctx, { parent: "cart", transform: T([0, 1, 3]) });
    for (const link of [a, b]) {
      const game = ctx.made(doc.objects[link].sourceUrl);
      expect(Object.keys(game.traits[SEATS])).toEqual(["p1", "p2"]);
      const handSeats = Object.values(game.objects).map((o) => o.traits?.[ZONE]?.seat).filter(Boolean).sort();
      expect(handSeats).toEqual(["p1", "p2"]);
    }
    expect(doc.objects[a].sourceUrl).not.toBe(doc.objects[b].sourceUrl);
  });
});
