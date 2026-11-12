// A table set down on something that moves (a Card table in a ship's
// cockpit): the layout under a parent, Draw and the free-slot search in the
// parent's frame, the hand's face-up test against the trays as drawn, and
// the two parts that set it all up. (The seat's view riding the table, and
// name tags on the hands as drawn, are the seats' owner's.)
import { afterEach, describe, it, expect, vi } from "vitest";
import { CARD, ZONE } from "./visibility.js";
import Extension from "./extension.js";
import * as fakes from "../test/fakes.js";
import { SEATS, keeperOf, keeperPlugin, keptIn, keptTrait, registries, roster, seatsPlugin } from "../test/stand-ins.js";
import { emptyScene } from "../empty-scene.js";
import { apply, composeMatrix, multiply } from "./frame.js";
import { placeLayout, tableLayout, writeTable } from "../setup.js";
import * as lostCitiesGame from "../games/lost-cities.js";
import { cardTable, lostCities, PIECES, TABLE, GAME_TAG, partKey, squared } from "./parts.js";

afterEach(() => vi.useRealTimers());

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
let slot = 0;
const hidden = () => ({ [CARD]: {}, [keptTrait("plain")]: { by: DECK, slot: slot++ } });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const near = (got, want, digits = 6) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const sameMatrix = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const lay = (await seatsPlugin().load()).lay;

// a ship turned 0.7, a table across her cockpit, a turned-round hand for p2
const SHIP = T([10, 0, 5], [0, 0.7, 0]);
const TBL = T([0, 0.72, 2.85], [0, Math.PI / 2, 0]);
const card = (position, rotation = [0, 0.4, Math.PI]) => ({ name: "Card", parent: "tbl", transform: T(position, rotation), traits: hidden(), tags: ["card"] });
const tray = (n = 4, yaw = 0.25) => ({
  extras: { connectors: Array.from({ length: n }, (_, k) => ({ position: [+(-0.27 + k * 0.06).toFixed(3), 0.002, 0], yaw, tags: ["card"] })), snapRadius: 0.03 },
});

async function aboard({ local = {}, seated = { p1: { name: "Player 1", player: null }, p2: { name: "Player 2", player: null } } } = {}) {
  const objects = {
      ship: { name: "Ship", transform: SHIP },
      tbl: { name: "Card table", parent: "ship", transform: TBL, locked: true },
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
  /** The ship drawn somewhere the doc hasn't caught up with yet (a peer simulating her). */
  const sail = (t) => w.holds.set("ship", { session: "SIM", transform: t, at: Date.now() });
  const cmd = (x, id) => x.commands.find((c) => c.id === id);
  return { w, a, b, xa, xb, sail, cmd };
}

describe("a layout set down on something", () => {
  const files = { url: "automerge:glb", hint: { bounds: { min: [-0.03, 0, -0.04], max: [0.03, 0.001, 0.04] } } };
  const g = {};
  lostCitiesGame.fill(g);
  const flat = tableLayout(g, { fileOf: () => files, rng: () => 0.5 });

  it("a plain shift: every piece under the parent, moved up onto its top; each seat's view in its frame", () => {
    const on = placeLayout(flat, { parent: "tbl", transform: { position: [0, 0.7, 0] } });
    for (const [oid, o] of Object.entries(on.objects)) {
      if (o.kind === "group") {
        expect(o.parent).toBeUndefined();
        continue;
      }
      expect(o.parent).toBe("tbl");
      near(o.transform.position, flat.objects[oid].transform.position.map((v, i) => v + (i === 1 ? 0.7 : 0)));
      expect(o.transform.rotation).toEqual(flat.objects[oid].transform.rotation);
    }
    expect(on.seats.p1.camera).toEqual({ position: [0, 1.2, 0.95], target: [0, 0.7, 0.16], in: "tbl" });
    expect(on.order).toEqual(flat.order);
    // the flat layout is untouched
    expect(Object.values(flat.objects).every((o) => o.parent == null)).toBe(true);
  });

  it("a turn: whole matrices, the seats' views turned with the table", () => {
    const t = { position: [0.1, 0.7, -0.2], rotation: [0, Math.PI / 2, 0] };
    const on = placeLayout(flat, { parent: "tbl", transform: t });
    const M = composeMatrix(t);
    for (const [oid, o] of Object.entries(on.objects)) if (o.kind !== "group") sameMatrix(composeMatrix(o.transform), multiply(M, composeMatrix(flat.objects[oid].transform)));
    near(on.seats.p1.camera.position, apply(M, [0, 0.5, 0.95]));
    near(on.seats.p2.camera.target, apply(M, [0, 0, -0.16]));
    expect(on.seats.p2.camera.in).toBe("tbl");
  });

  it("written without the view: the scene's view, home and units stay as they were", () => {
    const d = emptyScene({ view: { units: "m", home: { position: [12, 6, 16], target: [0, 2, 0] }, activity: "play" } });
    const on = placeLayout(flat, { parent: "tbl", transform: { position: [0, 0.7, 0] } });
    const binds = Object.fromEntries(Object.keys(on.decks).map((k) => [k, (s) => ({ [keptTrait("plain")]: { by: DECK, slot: s } })]));
    writeTable(d, on, binds, { view: false, seats: lay });
    expect(d.view).toEqual({ units: "m", home: { position: [12, 6, 16], target: [0, 2, 0] }, activity: "play" });
    expect(d.traits[SEATS].p1.camera.in).toBe("tbl");
    expect(d.order).toHaveLength(on.order.length);
  });
});

describe("drawing at a table aboard", () => {
  it("glides the top card into your first free slot, in the table's frame, whatever the ship is drawn doing", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: "bob" } } });
    t.sail(T([13, 0.3, 7], [0.08, 1.1, -0.05])); // sailed on, heeled: the doc hasn't been told yet
    expect(t.cmd(t.xa, "draw").state("mid", { scene: t.a.scene(), local: t.a.local.get() })).toEqual({ title: expect.stringMatching(/\(D\)/) });
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

  it("into the turned-round tray across the table", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: "bob" } } });
    t.cmd(t.xb, "draw").run("top");
    t.w.tick(1 / 60, 40);
    const o = t.w.doc.objects.top;
    near(o.transform.position, [0.27, 0.702, -0.5]);
    expect(Math.cos(o.transform.rotation[1] - (Math.PI + 0.25))).toBeCloseTo(1, 6);
    expect([o.transform.rotation[0], o.transform.rotation[2]]).toEqual([0, 0]);
    t.w.done();
  });

  it("Shuffle and Draw stand aside in first person (S and D walk), and come back after", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: null } } });
    const ctx = (local) => ({ scene: t.a.scene(), local: { ...t.a.local.get(), ...local } });
    expect(t.cmd(t.xa, "shuffle").state("top", ctx({ immersive: true }))).toBe(null);
    expect(t.cmd(t.xa, "draw").state("top", ctx({ immersive: true }))).toBe(null);
    expect(t.cmd(t.xa, "shuffle").state("top", ctx({ immersive: false }))).not.toBe(null);
    expect(t.cmd(t.xa, "draw").state("top", ctx({ immersive: false }))).not.toBe(null);
    t.w.done();
  });
});

describe("the hand at a table aboard", () => {
  it("turns a card face up over your tray as it's drawn, not where the doc last had the ship", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: null } } });
    t.sail(T([12, 0.4, 7.5], [0.1, 0.95, 0]));
    const seen = apply(t.a.worldOf("hand1"), [0.1, 0.01, 0]);
    const doc = apply(t.a.scene().world("hand1"), [0.1, 0.01, 0]);
    expect(t.xa.landing("top", seen)).toEqual({ faceUp: true });
    expect(t.xa.landing("top", doc)).toBe(null);
    t.w.done();
  });
});

describe("the Card table and Lost Cities parts", () => {
  const emptyShip = () =>
    emptyScene({
      title: "Ship at anchor",
      objects: { ship: { name: "Sloop", transform: SHIP, parent: null } },
      order: ["ship"],
      view: { units: "m", activity: "play", home: { position: [12, 6.5, 16], target: [0, 2.5, 0] } },
    });
  // what's installed: whoever owns seats, and a keeper of each kind
  const installed = () => registries(seatsPlugin(), keeperPlugin("joint"), keeperPlugin("plain"));

  it("a Card table goes under what it's put on, square to it, locked, with a top that takes a game", async () => {
    const doc = emptyShip();
    const { ctx } = fakes.fakeDrop(doc);
    const id = await cardTable.create(ctx, { parent: "ship", transform: { position: [0, 0.72, 2.85], rotation: [0.06, Math.PI / 2, -0.03], scale: 1 } });
    const o = doc.objects[id];
    expect(o).toMatchObject({ name: "Card table", parent: "ship", locked: true });
    near(o.transform.position, [0, 0.72, 2.85]);
    expect(o.transform.rotation[0]).toBe(0);
    expect(o.transform.rotation[2]).toBe(0);
    expect(o.transform.rotation[1]).toBeCloseTo(squared({ rotation: [0.06, Math.PI / 2, -0.03] }).rotation[1], 6);
    expect(o.sourceUrl).toBe(doc.assets[partKey("table")].url);
    expect(o.hint.bounds.max[1]).toBeCloseTo(TABLE.h, 2);
    expect(PIECES.table.snapPoints).toEqual([{ position: [0, TABLE.h + 0.0006, 0], yaw: 0, tags: [GAME_TAG] }]);
  });

  it("Lost Cities on it: every piece under the table, the seats' views in its frame, and the scene's view and title left alone", async () => {
    const doc = emptyShip();
    const { ctx, calls } = fakes.fakeDrop(doc, { registries: installed() });
    const tid = await cardTable.create(ctx, { parent: "ship", transform: TBL });
    const before = structuredClone(doc.view);
    const board = await lostCities.create(ctx, { parent: tid, transform: { position: [0, TABLE.h + 0.0006, 0], rotation: [0, 0, 0], scale: 1 } });
    expect(doc.objects[board].name).toBe("Board");
    const pieces = Object.entries(doc.objects).filter(([id, o]) => o.kind !== "group" && id !== "ship" && id !== tid);
    expect(pieces).toHaveLength(63);
    for (const [, o] of pieces) {
      expect(o.parent).toBe(tid);
      expect(o.transform.position[1]).toBeGreaterThanOrEqual(TABLE.h);
    }
    expect(doc.view).toEqual(before);
    expect(doc.title).toBe("Ship at anchor");
    // the seats' owner was asked to lay them, each view in the table's frame
    expect(doc.traits[SEATS].p1.camera).toEqual({ position: [0, 1.2006, 0.95], target: [0, 0.7006, 0.16], in: tid });
    // its deck asks for its players to shuffle it: a joint keeper's container, named for the scene, every card bound to it
    const cards = Object.values(doc.objects).filter((o) => o.traits?.[CARD]);
    expect(cards).toHaveLength(60);
    expect(new Set(cards.map((o) => keptIn(o).kind))).toEqual(new Set(["joint"]));
    const container = calls.created.find((d) => d?.["@patchwork"]?.type === "t-joint");
    expect(container.title).toBe("Ship at anchor: Deck");
    expect(container.items).toHaveLength(60);
  });

  it("brings seats only to a scene without any (the owner's rule), and puts nothing when what it was put on went", async () => {
    const doc = emptyShip();
    doc.traits[SEATS] = { a: { name: "Captain", player: null } };
    const { ctx } = fakes.fakeDrop(doc, { registries: installed() });
    await lostCities.create(ctx, { parent: "ship", transform: T([0, 1, 0]) });
    expect(doc.traits[SEATS]).toEqual({ a: { name: "Captain", player: null } });
    const n = Object.keys(doc.objects).length;
    expect(await lostCities.create(ctx, { parent: "gone", transform: T([0, 1, 0]) })).toBe(null);
    expect(Object.keys(doc.objects)).toHaveLength(n);
  });
});
