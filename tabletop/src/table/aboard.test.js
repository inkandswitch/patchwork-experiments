// A table set down on something that moves (a Card table in a ship's
// cockpit): the layout under a parent, Draw and the free-slot search in the
// parent's frame, the seat's view put through the drawn table and riding it,
// first person keeping the camera until it ends, the hand's face-up test
// against the trays as drawn, a dropped deck going into the frame of what it
// was dropped on, name tags over the hands as drawn, and the two parts that
// set it all up.
import { afterEach, describe, it, expect, vi } from "vitest";
import { HIDDEN, SEATS, ZONE } from "./visibility.js";
import Extension, { dropSpot, seatTagAt } from "./extension.js";
import * as fakes from "../test/fakes.js";
import { emptyScene } from "../empty-scene.js";
import { apply, composeMatrix, multiply } from "./frame.js";
import { placeLayout, tableLayout, writeTable } from "../setup.js";
import * as lostCitiesGame from "../games/lost-cities.js";
import { cardTable, lostCities, PIECES, TABLE, GAME_TAG, partKey, squared } from "./parts.js";

afterEach(() => vi.useRealTimers());

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const hidden = { [HIDDEN]: { by: DECK } };
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const near = (got, want, digits = 6) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const sameMatrix = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

// a ship turned 0.7, a table across her cockpit, a turned-round hand for p2
const SHIP = T([10, 0, 5], [0, 0.7, 0]);
const TBL = T([0, 0.72, 2.85], [0, Math.PI / 2, 0]);
const card = (position, rotation = [0, 0.4, Math.PI]) => ({ name: "Card", parent: "tbl", transform: T(position, rotation), traits: hidden, tags: ["card"] });
const tray = (n = 4, yaw = 0.25) => ({
  extras: { connectors: Array.from({ length: n }, (_, k) => ({ position: [+(-0.27 + k * 0.06).toFixed(3), 0.002, 0], yaw, tags: ["card"] })), snapRadius: 0.03 },
});
const seatCam = (z) => ({ position: [0, 1.2, z], target: [0, 0.7, z * 0.17], in: "tbl" });

async function aboard({ local = {}, seated = { p1: { name: "Player 1", player: null, camera: seatCam(0.95) }, p2: { name: "Player 2", player: null, camera: seatCam(-0.95) } } } = {}) {
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
  const repo = fakes.fakeRepo();
  const faces = Object.fromEntries(["kept", "low", "mid", "top"].map((id) => [id, { sourceUrl: `automerge:face-${id}`, name: `Face of ${id}` }]));
  repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: faces }, DECK);
  const w = fakes.fakeWorld(doc, { repo, content: { hand1: tray(), hand2: tray() } });
  const a = w.join("A", { viewer: "alice", local });
  const b = w.join("B", { viewer: "bob" });
  const xa = w.attach("A", Extension.create(a));
  const xb = w.attach("B", Extension.create(b));
  w.flush();
  await vi.advanceTimersByTimeAsync(10);
  /** Pick a seat in a view's picker, as a person does. */
  const pick = async (session, sid) => {
    const select = w.view(session).overlay.querySelector("select");
    select.value = sid;
    select.dispatchEvent(new Event("change"));
    w.flush();
    await vi.advanceTimersByTimeAsync(10);
  };
  /** The ship drawn somewhere the doc hasn't caught up with yet (a peer simulating her). */
  const sail = (t) => w.holds.set("ship", { session: "SIM", transform: t, at: Date.now() });
  const cmd = (x, id) => x.commands.find((c) => c.id === id);
  return { w, a, b, xa, xb, pick, sail, cmd };
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
    const deckUrls = Object.fromEntries(Object.keys(on.decks).map((k) => [k, "automerge:2Deck"]));
    writeTable(d, on, deckUrls, { view: false });
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

describe("the seat's view aboard", () => {
  it("is put through the table as drawn, and rides it", async () => {
    const t = await aboard();
    const drawn = T([14, 0.2, 9], [0.05, 1.4, 0.03]);
    t.sail(drawn);
    await t.pick("A", "p1");
    const m = t.a.worldOf("tbl");
    expect(t.w.view("A").camera.in).toBeUndefined();
    near(t.w.view("A").camera.position, apply(m, [0, 1.2, 0.95]));
    near(t.w.view("A").camera.target, apply(m, [0, 0.7, 0.95 * 0.17]));
    expect(t.w.view("A").rides).toEqual([{ id: "tbl", opts: { at: [0, 0.7, 0.95 * 0.17] } }]);
    // another seat: one ride, the new one's
    await t.pick("A", "p2");
    expect(t.w.view("A").rides.map((r) => r.id)).toEqual(["tbl"]);
    near(t.w.view("A").camera.position, apply(m, [0, 1.2, -0.95]));
    // standing up: no ride
    await t.pick("A", "");
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("a seat whose camera is in a frame that's gone (its table deleted) leaves the view as it is", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: null, camera: { ...seatCam(0.95), in: "gone" } }, p2: { name: "Player 2", player: null } } });
    t.a.camera.set({ position: [30, 6, 30], target: [0, 2, 0] });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toEqual({ position: [30, 6, 30], target: [0, 2, 0] });
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("a seat whose camera is in no frame is set once, and rides nothing", async () => {
    const t = await aboard({ seated: { p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "Player 2", player: null } } });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    expect(t.w.view("A").rides).toEqual([]);
    t.w.done();
  });

  it("in first person, waits until it ends; and whoever is seated is put back in their seat when it does", async () => {
    const t = await aboard({ local: { immersive: true } });
    await t.pick("A", "p1");
    expect(t.w.view("A").camera).toBe(null); // the walker has the camera
    expect(t.w.view("A").rides).toEqual([]);
    t.a.local.swap((m) => ({ ...m, immersive: false }));
    t.w.flush();
    near(t.w.view("A").camera.position, apply(t.a.worldOf("tbl"), [0, 1.2, 0.95]));
    expect(t.w.view("A").rides).toHaveLength(1);
    // walks again (Enter), and the walker leaves the camera off her quarter
    t.a.local.swap((m) => ({ ...m, immersive: true }));
    t.w.flush();
    t.a.camera.set({ position: [30, 6, 30], target: [0, 2, 0] });
    t.a.local.swap((m) => ({ ...m, immersive: false }));
    t.w.flush();
    near(t.w.view("A").camera.position, apply(t.a.worldOf("tbl"), [0, 1.2, 0.95]));
    expect(t.w.view("A").rides).toHaveLength(1);
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

  it("name tags lie on the hands as drawn, at the edge nearest each seat, and follow them each frame in play", async () => {
    const t = await aboard();
    const tag = (k) => t.w.view("A").labels.find((l) => l.key === k).position;
    // p1 sits on hand1's +z side; hand2 is turned round, so p2's side is its +z too
    near(tag("hand1"), apply(t.a.worldOf("hand1"), [0, 0, 0.05]), 3);
    near(tag("hand2"), apply(t.a.worldOf("hand2"), [0, 0, 0.05]), 3);
    t.sail(T([12, 0.4, 7.5], [0.1, 0.95, 0]));
    t.w.tick(1 / 60);
    near(tag("hand1"), apply(t.a.worldOf("hand1"), [0, 0, 0.05]), 3);
    t.w.done();
  });

  it("seatTagAt: the tray's floor at the edge nearest the eye, else its middle", () => {
    const z = { min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] };
    expect(seatTagAt(z, [0, 0.5, 0.45])).toEqual([0, 0, 0.05]);
    expect(seatTagAt(z, [0.9, 0.5, -2])).toEqual([0.3, 0, -0.05]);
    expect(seatTagAt(z, null)).toEqual([0, 0, 0]);
  });
});

describe("a deck dropped at a table aboard", () => {
  const cardBox = { min: [-0.028, 0, -0.0435], max: [0.028, 0.001, 0.0435] };
  const registry = {
    filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
    load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map() }), placement: () => ({ name: "Deck", count: 3, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: cardBox }), bind() {} } }),
  };
  const url = "automerge:2SecureSecureSecureSecure9";

  async function dropOn(hitId, local) {
    const t = await aboard();
    t.w.registries = { "tabletop:deck": registry };
    t.sail(T([12, 0.2, 7], [0.06, 1.0, 0]));
    const point = apply(t.a.worldOf(hitId), local);
    const ctx = { ...t.a, registry: async (type) => (type === "tabletop:deck" ? registry : null), worldOf: t.a.worldOf };
    expect(await Extension.drop(ctx, { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {}, at: { point, hitId } })).toBe(true);
    const cards = Object.entries(t.w.doc.objects).filter(([, o]) => o.traits?.[HIDDEN]?.by === url);
    return { t, point, cards };
  }

  it("on the board: beside it, on the table (what the board is attached to), where it was seen", async () => {
    const { t, point, cards } = await dropOn("board", [-0.1, 0.004, 0.02]);
    expect(cards).toHaveLength(3);
    for (const [id, o] of cards) {
      expect(o.parent).toBe("tbl");
      expect(o.transform.rotation).toEqual([0, 0, Math.PI]);
      const w = t.a.worldOf(id);
      near([w[12], w[14]], [point[0], point[2]], 3); // (stacked up along the heeled table's +Y)
    }
    t.w.done();
  });

  it("on the table itself (things are attached to it): under the table", async () => {
    const { cards } = await dropOn("tbl", [0.25, 0.7, 0.3]);
    for (const [, o] of cards) {
      expect(o.parent).toBe("tbl");
      near([o.transform.position[0], o.transform.position[2]], [0.25, 0.3], 5);
    }
  });
});

describe("dropSpot aboard a moving ship: the hands as drawn", () => {
  // a scene with the ship where the doc has her, and drawn somewhere else (sailing on)
  const sceneOf = () => {
    const objects = {
      ship: { transform: SHIP },
      tbl: { parent: "ship", transform: TBL },
      hand1: { parent: "tbl", transform: T([0, 0.7, 0.5]), traits: zone("p1") },
    };
    const local = (id) => composeMatrix(objects[id].transform);
    const world = (id) => (objects[id].parent ? multiply(world(objects[id].parent), local(id)) : local(id));
    const inv = (m) => {
      // rigid: transpose the turn, back off the shift
      const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
      const t = apply(r, [m[12], m[13], m[14]]);
      return [...r.slice(0, 12), -t[0], -t[1], -t[2], 1];
    };
    const parents = new Map(Object.entries(objects).map(([id, o]) => [id, o.parent ?? null]));
    return { objects, ids: Object.keys(objects), parents, world, toLocal: (id, p) => apply(inv(world(id)), p) };
  };
  const drawnShip = composeMatrix(T([14, 0.3, 9], [0.07, 1.3, -0.04]));
  const ctxFor = (snap) => {
    const drawnWorld = (id) => (id === "ship" ? drawnShip : multiply(drawnWorld(snap.objects[id].parent), composeMatrix(snap.objects[id].transform)));
    return { scene: () => snap, worldOf: drawnWorld, content: () => null };
  };

  it("refuses a drop on a seat's tray where it's drawn, though the doc has the tray elsewhere", () => {
    const snap = sceneOf();
    const ctx = ctxFor(snap);
    const onTray = apply(ctx.worldOf("hand1"), [0.05, 0.01, 0]);
    const inDocTray = snap.toLocal("hand1", onTray).every((v, k) => v >= [-0.3, 0, -0.05][k] && v <= [0.3, 0.15, 0.05][k]);
    expect(inDocTray).toBe(false); // (the doc's tray is metres away)
    expect(dropSpot(ctx, { point: onTray, hitId: "tbl" })).toBe(null);
  });

  it("takes a drop where the doc's tray is but the drawn one isn't", () => {
    const snap = sceneOf();
    const ctx = ctxFor(snap);
    const docTray = apply(snap.world("hand1"), [0.05, 0.01, 0]);
    const spot = dropSpot(ctx, { point: docTray, hitId: "tbl" });
    expect(spot).not.toBe(null);
    expect(spot.parent).toBe("tbl");
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
  const secureDecks = () => fakes.fakeRegistry([{ id: "secure-deck", supportedDatatypes: ["secure-deck"], load: async () => ({ createResolver: () => ({}) }) }]);

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
    const { ctx } = fakes.fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
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
    expect(doc.traits[SEATS].p1.camera).toEqual({ position: [0, 1.2006, 0.95], target: [0, 0.7006, 0.16], in: tid });
    // a secure deck, named for the scene
    const deck = Object.values(doc.objects).find((o) => o.traits?.[HIDDEN])?.traits[HIDDEN].by;
    expect(deck).toMatch(/^automerge:/);
  });

  it("seats left from a table that's gone look at the new one", async () => {
    const doc = emptyShip();
    doc.traits[SEATS] = { p1: { name: "Player 1", player: "alice", camera: { position: [0, 1, 1], target: [0, 0, 0], in: "old-table" } }, p2: { name: "Player 2", player: null, camera: { position: [0, 1, -1], target: [0, 0, 0] } } };
    const { ctx } = fakes.fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    const tid = await cardTable.create(ctx, { parent: "ship", transform: TBL });
    await lostCities.create(ctx, { parent: tid, transform: { position: [0, TABLE.h + 0.0006, 0], rotation: [0, 0, 0], scale: 1 } });
    // p1's table went: it takes the new one's view (and keeps who sits there); p2's view was in no frame, and stays
    expect(doc.traits[SEATS].p1).toEqual({ name: "Player 1", player: "alice", camera: { position: [0, 1.2006, 0.95], target: [0, 0.7006, 0.16], in: tid } });
    expect(doc.traits[SEATS].p2.camera).toEqual({ position: [0, 1, -1], target: [0, 0, 0] });
  });

  it("brings seats only to a scene without any, and puts nothing when what it was put on went", async () => {
    const doc = emptyShip();
    doc.traits[SEATS] = { a: { name: "Captain", player: null } };
    const { ctx } = fakes.fakeDrop(doc, { registries: { "tabletop:deck": secureDecks() } });
    await lostCities.create(ctx, { parent: "ship", transform: T([0, 1, 0]) });
    expect(doc.traits[SEATS]).toEqual({ a: { name: "Captain", player: null } });
    const n = Object.keys(doc.objects).length;
    expect(await lostCities.create(ctx, { parent: "gone", transform: T([0, 1, 0]) })).toBe(null);
    expect(Object.keys(doc.objects)).toHaveLength(n);
  });
});
