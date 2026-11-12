// The table (extension.js, visibility.js, rule.js): its policy over every
// case, Shuffle through whatever keeps a card, Draw, a card turning face up
// over your own hand, the hand as the tool in play, and what it tells the
// others. Seats and keepers are stand-ins (test/stand-ins.js): the table
// meets them only through the stage's conventions.
import { afterEach, describe, it, expect, vi } from "vitest";
import { CARD, ZONE, audienceOf, faceUpIn, isCard, seatAt, seatOf, seatsFrom, zones } from "./visibility.js";
import Extension, { keptBy } from "./extension.js";
import Rule from "./rule.js";
import { testScene } from "./test-scene.js";
import * as fakes from "../test/fakes.js";
import { SEATS, keeperOf, keptTrait, roster } from "../test/stand-ins.js";
import { emptyScene } from "../empty-scene.js";

/** A scene doc as the scene makes one (empty-scene.js), with these objects in it, listed in order. */
const sceneOf = (objects, traits = {}, more = {}) => emptyScene({ objects, order: Object.keys(objects), traits, ...more });

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
let slot = 0;
// a card something keeps: a card (this package's trait) with a stand-in keeper's binding beside it
const hidden = () => ({ [CARD]: {}, [keptTrait("plain")]: { by: DECK, slot: slot++ } });
const objects = () => ({
  // two hand trays, one turned round, each a private zone 0.6 × 0.1 m, 0.15 m high
  hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1") },
  hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
  inHand1: { name: "Card", transform: T([0.1, 0.002, 0.5]), traits: hidden() },
  inHand2Flipped: { name: "Card", transform: T([0.2, 0.002, -0.49], [0, 0, Math.PI]), traits: hidden() },
  faceUp: { name: "Card", transform: T([0, 0, 0]), traits: hidden() },
  faceDown: { name: "Card", transform: T([0.3, 0.001, 0], [0, 0.4, Math.PI]), traits: hidden() },
  // attached to the tray: its world position decides
  onTray: { name: "Card", parent: "hand1", transform: T([-0.2, 0.002, 0]), traits: hidden() },
  board: { name: "Board", transform: T([0, 0, 0]) },
});
const seats = (p1 = null, p2 = null) => ({ p1: { name: "Player 1", player: p1 }, p2: { name: "Player 2", player: p2 } });

/** A view at the table: the extension, with the seats' roster and a keeper as the stage would let it collect them. */
function sit(w, session, viewer, { local = {} } = {}) {
  const api = w.join(session, { viewer, local });
  const keeper = keeperOf(() => w.doc.objects);
  w.view(session).collected = { roster, keeper };
  return { api, keeper, x: w.attach(session, Extension.create(api)) };
}

describe("who may see what: the table's policy", () => {
  it("zones: the seat whose box holds a point, through the zone's own turn", () => {
    const scene = testScene(objects());
    const regions = zones(scene);
    expect(regions.map((r) => r.seat).sort()).toEqual(["p1", "p2"]);
    expect(seatAt(scene, regions, [0.25, 0.1, 0.52])).toBe("p1");
    expect(seatAt(scene, regions, [-0.25, 0.1, -0.46])).toBe("p2");
    expect(seatAt(scene, regions, [0, 0.2, 0.5])).toBeNull(); // above it
    expect(seatAt(scene, regions, [0, 0, 0])).toBeNull();
    expect(zones(testScene({ a: { transform: T([0, 0, 0]), traits: { [ZONE]: { seat: "p1" } } } }))).toEqual([]);
  });

  it("face up is +Y up in the world, whatever the yaw", () => {
    const scene = testScene(objects());
    expect(faceUpIn(scene, "faceUp")).toBe(true);
    expect(faceUpIn(scene, "faceDown")).toBe(false);
  });

  // Every case: where a thing lies (p1's hand, p2's, the hand of a seat
  // nobody has taken, the hand of a seat that isn't there, out on the
  // table), which way up, whether it's a card, and who is seated.
  const PLACES = { "p1's hand": [0.1, 0.002, 0.5], "p2's hand": [0.2, 0.002, -0.49], "an empty seat's hand": [1.1, 0.002, 0.5], "a hand of no seat": [2.1, 0.002, 0.5], "the table": [0, 0.001, 0] };
  const WAYS = { "face up": [0, 0.3, 0], "face down": [0, 0.3, Math.PI] };
  const KINDS = { card: { [CARD]: {} }, "not a card": {} };
  const SEATINGS = { "both seated": seats("ann", "ben"), "only p1": seats("ann", null), "nobody seated": seats() };
  const sceneWith = (position, rotation, traits) =>
    testScene({
      hand1: { transform: T([0, 0, 0.5]), traits: zone("p1") },
      hand2: { transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
      hand3: { transform: T([1, 0, 0.5]), traits: zone("p3") }, // p3 is a seat, never taken
      hand4: { transform: T([2, 0, 0.5]), traits: zone("gone") }, // no such seat
      thing: { transform: T(position, rotation), traits },
    });
  const rosterSeats = (s) => [...Object.entries(s).map(([id, v]) => ({ id, viewer: v.player })), { id: "p3", viewer: null }];
  const CASES = [];
  for (const [place, position] of Object.entries(PLACES)) for (const [way, rotation] of Object.entries(WAYS)) for (const [kind, traits] of Object.entries(KINDS)) for (const [seating, seated] of Object.entries(SEATINGS)) CASES.push({ place, way, kind, seating, position, rotation, traits, seated });

  it(`covers ${5 * 2 * 2 * 3} cases`, () => expect(CASES).toHaveLength(60));

  for (const c of CASES) {
    const owner = { "p1's hand": c.seated.p1.player, "p2's hand": c.seated.p2.player, "an empty seat's hand": null, "a hand of no seat": null }[c.place];
    const want =
      c.place !== "the table"
        ? owner
          ? { show: [owner], only: [owner] } // a hand: its seat's alone, whichever way up, card or not
          : { show: [], only: [] } // a hand nobody sits at: nobody's
        : c.kind === "card" && c.way === "face up"
          ? { show: "all" }
          : null; // face down, or not a card: nothing to say
    it(`${c.kind}, ${c.way}, in ${c.place}, ${c.seating} → ${JSON.stringify(want)}`, () => {
      expect(audienceOf(sceneWith(c.position, c.rotation, c.traits), rosterSeats(c.seated))("thing")).toEqual(want);
    });
  }

  it("what that means for each viewer, with no other policy running: another seat's hand is never turned toward you", () => {
    // (one policy alone: who it's shown to is its `show`; who may see it, that cut by its `only`)
    const has = (set, v) => set === "all" || (Array.isArray(set) && set.includes(v));
    const read = (a, v) => {
      const shown = has(a?.show ?? [], v);
      return { shown, may: shown && (a?.only === undefined || a.only.includes(v)) };
    };
    for (const c of CASES.filter((x) => x.seating === "both seated" && x.kind === "card")) {
      const a = audienceOf(sceneWith(c.position, c.rotation, c.traits), rosterSeats(c.seated))("thing");
      const [ann, ben, watcher] = ["ann", "ben", "zed"].map((v) => read(a, v));
      if (c.place === "p1's hand") expect([ann, ben, watcher]).toEqual([{ shown: true, may: true }, { shown: false, may: false }, { shown: false, may: false }]);
      else if (c.place === "p2's hand") expect([ann, ben, watcher]).toEqual([{ shown: false, may: false }, { shown: true, may: true }, { shown: false, may: false }]);
      else if (c.place === "the table" && c.way === "face up") expect([ann, ben, watcher]).toEqual([{ shown: true, may: true }, { shown: true, may: true }, { shown: true, may: true }]);
      else expect([ann, ben, watcher]).toEqual([{ shown: false, may: false }, { shown: false, may: false }, { shown: false, may: false }]);
      // so a keeper, by its rule, draws: the item to whoever `may`; the veil to whoever it's shown to
      // and may not (nobody, under this policy alone); and to everyone else its own back
      for (const v of [ann, ben, watcher]) expect(v.shown && !v.may).toBe(false);
    }
  });

  it("is from the doc alone, the same for every asker, and answers nothing for what isn't there", () => {
    const scene = testScene(objects());
    const of = audienceOf(scene, rosterSeats(seats("ann", "ben")));
    expect(of("nope")).toBeNull();
    expect(of("board")).toBeNull();
    expect(of("onTray")).toEqual({ show: ["ann"], only: ["ann"] }); // attached to the tray: where it is in the world decides
    expect(of("inHand2Flipped")).toEqual({ show: ["ben"], only: ["ben"] }); // face down in a hand: still its seat's
    expect(of("faceUp")).toEqual({ show: "all" });
    expect(of("faceDown")).toBeNull();
    expect(of("faceUp")).toBe(of("faceUp"));
  });

  it("seats come from the roster: with none contributed, every hand is nobody's", () => {
    const scene = testScene(objects(), { [SEATS]: seats("ann", "ben") });
    expect(seatsFrom({ collect: () => [] }, scene)).toEqual([]);
    expect(seatsFrom({ collect: (n) => (n === "roster" ? [{ id: "x", value: roster }] : []) }, scene).map((s) => [s.id, s.viewer])).toEqual([["p1", "ann"], ["p2", "ben"]]);
    // a roster that throws is no roster
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(seatsFrom({ collect: () => [{ id: "x", value: { seats: () => { throw new Error("boom"); } } }] }, scene)).toEqual([]);
    vi.restoreAllMocks();
    expect(audienceOf(scene, [])("inHand1")).toEqual({ show: [], only: [] });
    expect(seatOf([{ id: "p1", viewer: "ann" }], "ann")).toBe("p1");
    expect(seatOf([{ id: "p1", viewer: "ann" }], "ben")).toBeNull();
    expect(seatOf([{ id: "p1", viewer: null }], null)).toBeNull();
    expect(isCard({ traits: { [CARD]: {} } })).toBe(true);
  });

  it("the rule extension contributes exactly that, from the roster it collects, and nothing else", () => {
    const scene = testScene(objects(), { [SEATS]: seats("ann", null) });
    const x = Rule.create({ collect: (n) => (n === "roster" ? [{ id: "x", value: roster }] : []) });
    expect(Object.keys(x)).toEqual(["audience"]);
    const of = x.audience(scene);
    expect(of("inHand1")).toEqual({ show: ["ann"], only: ["ann"] });
    expect(of("inHand2Flipped")).toEqual({ show: [], only: [] });
    expect(of("faceUp")).toEqual({ show: "all" });
  });
});

describe("the table extension", () => {
  afterEach(() => vi.useRealTimers());
  /** Alice at the table of objects(), seated as given. */
  function mount({ viewer = "alice", seated = seats(viewer) } = {}) {
    const w = fakes.fakeWorld(sceneOf(objects(), { [SEATS]: seated }));
    const { api, keeper, x } = sit(w, "A", viewer);
    w.flush();
    return { w, api, keeper, x, toasts: () => w.view("A").notices.map((n) => [n.text, n.kind]) };
  }

  it("contributes no looks, no HUD and no audience of its own: what a card is, is its keeper's; who may see it, the rule's", () => {
    const m = mount();
    expect(m.x.looks).toBeUndefined();
    expect(m.x.hud).toBeUndefined();
    expect(m.x.audience).toBeUndefined();
    expect(Extension.drop).toBeUndefined();
    m.w.done();
  });

  it("says where each seat's hands are, for whoever shows seats", () => {
    const m = mount();
    expect(m.x.seatPlaces(m.api.scene())).toEqual([
      { id: "hand1", seat: "p1", min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] },
      { id: "hand2", seat: "p2", min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] },
    ]);
    m.w.done();
  });

  it("turns a card face up over your own hand only", () => {
    const m = mount();
    expect(m.x.landing("faceDown", [0.1, 0.01, 0.5])).toEqual({ faceUp: true });
    expect(m.x.landing("faceDown", [0.1, 0.01, -0.5])).toBeNull(); // someone else's
    expect(m.x.landing("faceDown", [0, 0, 0])).toBeNull();
    expect(m.x.landing("board", [0.1, 0.01, 0.5])).toBeNull(); // not a card
    m.w.done();
    const watcher = mount({ viewer: "zed", seated: seats() });
    expect(watcher.x.landing("faceDown", [0.1, 0.01, 0.5])).toBeNull();
    watcher.w.done();
  });

  it("shuffles the pile a card is in, through whatever keeps it", () => {
    const m = mount();
    const shuffle = m.x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.key).toBe("s");
    expect(shuffle.state("faceDown")).not.toBeNull();
    expect(shuffle.state("board")).toBeNull();
    expect(shuffle.state(null)).toBeNull();
    // no boxes: the pile is what's on the same spot (faceDown alone)
    shuffle.run("faceDown");
    expect(m.keeper.calls).toEqual([["faceDown"]]);
    expect(m.toasts().at(-1)[0]).toMatch(/nothing here to shuffle/);
    m.w.done();
  });

  it("a card nothing keeps is only what it looks like: Shuffle isn't offered; nor with no keeper running", () => {
    const m = mount();
    m.w.change((d) => (d.objects.bare = { name: "Card", transform: T([0.5, 0, 0]), traits: { [CARD]: {} } }));
    m.w.flush();
    const shuffle = m.x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.state("bare")).toBeNull();
    expect(keptBy(m.api, "bare")).toBeNull();
    expect(keptBy(m.api, "faceDown")).toMatchObject({ key: DECK });
    m.w.view("A").collected = { roster };
    expect(shuffle.state("faceDown")).toBeNull();
    // a keeper that throws doesn't keep it
    m.w.view("A").collected = { roster, keeper: { of: () => { throw new Error("boom"); } } };
    expect(shuffle.state("faceDown")).toBeNull();
    m.w.done();
  });

  it("a pile is the cards of one container that overlap: another container's cards on the same spot aren't in it", () => {
    const m = mount();
    m.w.change((d) => {
      d.objects.under = { name: "Card", transform: T([0.3, 0.0005, 0], [0, 0.4, Math.PI]), traits: { [CARD]: {}, [keptTrait("plain")]: { by: DECK, slot: 90 } } };
      d.objects.other = { name: "Card", transform: T([0.3, 0.0015, 0], [0, 0.4, Math.PI]), traits: { [CARD]: {}, [keptTrait("plain")]: { by: "automerge:2OtherOtherOtherOtherOther1", slot: 0 } } };
      d.objects.pawn = { name: "Pawn", transform: T([0.3, 0.002, 0]) };
    });
    m.w.flush();
    m.x.commands.find((c) => c.id === "shuffle").run("faceDown");
    expect(m.keeper.calls.at(-1).sort()).toEqual(["faceDown", "under"]);
    m.w.done();
  });
});

describe("telling the others", () => {
  afterEach(() => vi.useRealTimers());
  /** Alice in p1 and Bob in p2 at a table with a two-card pile (faceDown, under2); each view's extension attached. */
  function table({ seated = seats("alice", "bob") } = {}) {
    const doc = sceneOf({ ...objects(), under2: { name: "Card", transform: T([0.3, 0.0005, 0], [0, 0.4, Math.PI]), traits: hidden() } }, { [SEATS]: seated });
    const w = fakes.fakeWorld(doc);
    const { api: a, x: xa } = sit(w, "A", "alice");
    const { api: b, x: xb } = sit(w, "B", "bob");
    w.flush();
    return { w, a, b, xa, xb, notices: (s) => w.view(s).notices.map((n) => n.text) };
  }

  it("Shuffle is on the use prompt, and on the menu and inspector", () => {
    const t = table();
    expect(t.xa.commands.find((c) => c.id === "shuffle").show).toEqual(expect.arrayContaining(["use", "menu", "inspector"]));
    t.w.done();
  });

  it("a shuffle is sent once, as a count and the container's title, and the others hear who did it", () => {
    const t = table();
    t.xa.commands.find((c) => c.id === "shuffle").run("faceDown");
    expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "shuffled", data: { n: 2, of: "Deck" } }]);
    expect(t.notices("A")).toEqual(["Shuffling 2 cards…"]);
    // who did it is whoever the roster says they are
    expect(t.notices("B")).toEqual(["<alice> shuffled the deck (2)"]);
    t.w.done();
  });

  it("receives only what it knows, in the shape it expects", () => {
    const t = table();
    const from = (viewer) => ({ session: `s-${viewer}`, viewer });
    for (const [type, data] of [
      ["nope", { n: 1 }],
      ["toString", {}],
      ["shuffled", { of: 5, n: 2 }],
      ["shuffled", { of: "Deck", n: -1 }],
      ["shuffled", { of: "x".repeat(300), n: 2 }],
      ["sat", { seat: "p1" }], // sitting down is the seats' owner's to tell
      ["drew", { n: 1.5 }],
      ["drew", "1"],
      ["rolled", { die: "board", value: 4 }], // dice are the dice package's: nothing the table hears
    ]) t.xb.receive(type, data, from("alice"));
    expect(t.notices("B")).toEqual([]);
    t.xb.receive("drew", { n: 1 }, from("alice"));
    t.xb.receive("drew", { n: 2 }, from(undefined));
    t.xb.receive("shuffled", { n: 44 }, from("alice"));
    t.xb.receive("shuffled", { n: 3, of: "Wagers" }, from("alice"));
    expect(t.notices("B")).toEqual(["<alice> drew a card", "Someone drew 2 cards", "<alice> shuffled the deck (44)", "<alice> shuffled “Wagers” (3)"]);
    // with nobody to say who a peer is: Someone
    t.w.view("B").collected = {};
    t.xb.receive("drew", { n: 1 }, from("alice"));
    expect(t.notices("B").at(-1)).toBe("Someone drew a card");
    t.w.done();
  });

  it("never sends which card is which", () => {
    const t = table();
    t.xa.commands.find((c) => c.id === "shuffle").run("faceDown");
    expect(t.w.sent.map((s) => s.type)).toEqual(["shuffled"]);
    const wire = JSON.stringify(t.w.sent.map((s) => s.data));
    expect(wire).not.toMatch(/sourceUrl|face-|Face of|faceDown|under2|slot/);
    t.w.done();
  });
});

describe("drawing to your hand", () => {
  afterEach(() => vi.useRealTimers());
  const card = (position, rotation = [0, 0.4, Math.PI]) => ({ name: "Card", transform: T(position, rotation), traits: hidden(), tags: ["card"] });
  /** A tray's card slots, along its length (x), each turned `yaw` in the tray's frame; then two connectors that aren't card slots. */
  const tray = (n = 4, yaw = 0.25) => ({
    extras: {
      connectors: [
        ...Array.from({ length: n }, (_, k) => ({ position: [+(-0.27 + k * 0.06).toFixed(3), 0.002, 0], yaw, tags: ["card"] })),
        { position: [0.25, 0.002, 0], yaw: null, tags: ["pawn"] },
        { position: [0.2, 0.002, 0], yaw: null, tags: [] },
      ],
      snapRadius: 0.03,
    },
  });
  /**
   * Hands for p1 (at +z) and p2 (at −z, turned round), a card already in
   * p1's first slot, and a face-down pile of three (top, mid, low) out on
   * the table, all kept in one container.
   */
  async function table({ seated = seats("alice", "bob"), content = { hand1: tray(), hand2: tray() }, local = {} } = {}) {
    const doc = sceneOf(
      {
        hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1") },
        hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
        kept: card([-0.27, 0.002, 0.5], [0, 0.25, 0]),
        low: card([0.3, 0.001, 0]),
        mid: card([0.3, 0.002, 0]),
        top: card([0.3, 0.003, 0]),
        board: { name: "Board", transform: T([0, 0, 0]) },
      },
      { [SEATS]: seated },
    );
    const w = fakes.fakeWorld(doc, { content });
    const { api: a, x: xa } = sit(w, "A", "alice", { local });
    const { api: b, x: xb } = sit(w, "B", "bob");
    w.flush();
    await vi.advanceTimersByTimeAsync(10);
    // every doc write A makes from here on
    const writes = [];
    const change = a.change;
    a.change = (fn) => (writes.push(fn), change(fn));
    const drawOf = (x) => x.commands.find((c) => c.id === "draw");
    const state = (x, id, api = x === xa ? a : b) => drawOf(x).state(id, { scene: api.scene(), local: api.local.get() });
    return { w, a, b, xa, xb, writes, draw: (id, x = xa) => drawOf(x).run(id), drawOf, state, notices: (s) => w.view(s).notices.map((n) => n.text) };
  }
  const near = (got, want) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));

  it("is D, on the use prompt and the menu", async () => {
    const t = await table();
    expect(t.drawOf(t.xa)).toMatchObject({ key: "d", name: "Draw to my hand" });
    expect(t.drawOf(t.xa).show).toEqual(["use", "menu"]);
    t.w.done();
  });

  it("applies to a card out on the table, while playing, for someone seated with room in their hand", async () => {
    const t = await table();
    expect(t.state(t.xa, "top")).toEqual({ title: expect.stringMatching(/\(D\)/) });
    expect(t.state(t.xa, "mid")).not.toBeNull(); // any card of the pile: the top one is what's drawn
    expect(t.state(t.xa, "board")).toBeNull(); // not a card
    expect(t.state(t.xa, "kept")).toBeNull(); // in a hand already
    expect(t.state(t.xa, null)).toBeNull();
    t.w.done();
  });

  it("not while editing", async () => {
    const t = await table({ local: { activities: { current: "edit", available: ["play", "edit"] } } });
    expect(t.state(t.xa, "top")).toBeNull();
    t.w.done();
  });

  it("greyed out for someone watching: sit down to draw", async () => {
    const t = await table({ seated: seats(null, "bob") });
    expect(t.state(t.xa, "top")).toMatchObject({ disabled: true, label: "Sit down to draw" });
    t.draw("top");
    t.w.tick(1 / 60, 30);
    expect(t.writes).toEqual([]);
    expect(t.notices("A")).toEqual(["Sit down to draw"]);
    t.w.done();
  });

  it("not offered to someone watching where no hand has a card slot (a TTS import), nor where there are no hands", async () => {
    const plainTray = { extras: { connectors: [{ position: [0, 0.002, 0], yaw: null, tags: [] }], snapRadius: 0.03 } };
    const t = await table({ seated: seats(null, "bob"), content: { hand1: plainTray, hand2: plainTray } });
    expect(t.state(t.xa, "top")).toBeNull();
    expect(t.state(t.xb, "top")).toBeNull();
    t.w.done();
    const doc = sceneOf({ a: { name: "Card", transform: T([0, 0.001, 0], [0, 0, Math.PI]), traits: hidden() } });
    const w = fakes.fakeWorld(doc);
    const { api, x } = sit(w, "A", "alice");
    w.flush();
    expect(x.commands.find((c) => c.id === "draw").state("a", { scene: api.scene(), local: api.local.get() })).toBeNull();
    w.done();
  });

  it("never takes a card from someone else's hand, even where a pile overlaps it", async () => {
    const t = await table();
    // Bob's card at the edge of his tray (its origin just inside his zone), on top of a table card just outside it
    t.w.change((d) => {
      d.objects.edge = card([0.29, 0.004, -0.552]);
      d.objects.bobs = card([0.29, 0.006, -0.548], [0, 0, 0]);
    });
    t.w.flush();
    expect(t.state(t.xa, "edge")).toMatchObject({ title: expect.any(String) });
    t.draw("edge");
    t.w.tick(1 / 60, 40);
    expect(t.w.doc.objects.bobs.transform.position).toEqual([0.29, 0.006, -0.548]);
    near(t.w.doc.objects.edge.transform.position, [-0.21, 0.002, 0.5]);
    t.w.done();
  });

  it("greyed out when your hand is full", async () => {
    const t = await table({ content: { hand1: tray(1), hand2: tray() } });
    expect(t.state(t.xa, "top")).toMatchObject({ disabled: true, label: "Your hand is full" });
    expect(t.state(t.xb, "top")).toMatchObject({ title: expect.any(String) });
    expect(t.state(t.xb, "top").disabled).toBeUndefined();
    t.w.done();
  });

  it("greyed out while your hand hasn't loaded; not offered for a hand with no card slots", async () => {
    const t = await table({ content: { hand2: { extras: { connectors: [{ position: [0, 0, 0], yaw: null, tags: [] }], snapRadius: 0.03 } } } });
    expect(t.state(t.xa, "top")).toMatchObject({ disabled: true, title: expect.stringMatching(/loading/) });
    t.draw("top");
    expect(t.w.holds.size).toBe(0);
    expect(t.state(t.xb, "top")).toBeNull();
    t.w.done();
  });

  it("glides the pile's top card to your first free slot, face up and turned the slot's way, in one write", async () => {
    const t = await table();
    t.draw("mid"); // hovering any card of the pile draws its top
    expect(t.w.holds.get("top")).toMatchObject({ session: "A" });
    t.w.tick(1 / 60, 10);
    // on its way, held, and lifted clear of the pile
    expect(t.w.holds.get("top").transform.position[1]).toBeGreaterThan(0.02);
    expect(t.writes).toEqual([]);
    t.w.tick(1 / 60, 20);
    expect(t.writes).toHaveLength(1);
    const o = t.w.doc.objects.top;
    near(o.transform.position, [-0.21, 0.002, 0.5]); // slot 0 has a card: the next one
    near(o.transform.rotation, [0, 0.25, 0]);
    expect(o.transform.scale).toBe(1);
    expect(t.w.released).toEqual([{ session: "A", id: "top", landed: true }]);
    expect(t.w.doc.objects.mid.transform.position).toEqual([0.3, 0.002, 0]);
    // told: here as "You", there by seat, as a count only
    expect(t.notices("A")).toEqual(["You drew a card"]);
    expect(t.notices("B")).toEqual(["<alice> drew a card"]);
    expect(t.w.sent).toEqual([expect.objectContaining({ type: "drew", data: { n: 1 } })]);
    t.w.done();
  });

  it("into a turned tray, turned with it", async () => {
    const t = await table();
    t.draw("top", t.xb);
    t.w.tick(1 / 60, 30);
    const o = t.w.doc.objects.top;
    near(o.transform.position, [0.27, 0.002, -0.5]); // the tray's first slot, seen from p2's side
    expect(Math.cos(o.transform.rotation[1] - (Math.PI + 0.25))).toBeCloseTo(1, 6);
    expect([o.transform.rotation[0], o.transform.rotation[2]]).toEqual([0, 0]);
    t.w.done();
  });

  it("twice in a row: the next card, into the next slot", async () => {
    const t = await table();
    t.draw("top");
    t.w.tick(1 / 60, 3);
    t.draw("top");
    t.w.tick(1 / 60, 40);
    near(t.w.doc.objects.top.transform.position, [-0.21, 0.002, 0.5]);
    near(t.w.doc.objects.mid.transform.position, [-0.15, 0.002, 0.5]);
    expect(t.writes).toHaveLength(2);
    t.w.done();
  });

  it("skips a top card a peer is holding, for the one under it", async () => {
    const t = await table();
    t.b.pose.hold("top", T([0.3, 0.05, 0]));
    t.draw("top");
    t.w.tick(1 / 60, 30);
    near(t.w.doc.objects.mid.transform.position, [-0.21, 0.002, 0.5]);
    expect(t.w.doc.objects.top.transform.position).toEqual([0.3, 0.003, 0]);
    expect(t.writes).toHaveLength(1);
    t.w.done();
  });

  it("a peer taking hold of it on its way: let go, and take the next one; twice, and say so", async () => {
    const t = await table();
    t.draw("top");
    t.w.tick(1 / 60, 5);
    t.b.pose.hold("top", T([0.3, 0.05, 0])); // took hold first, as heldBy tells this view
    t.w.tick(1 / 60, 5);
    expect(t.w.released).toEqual([{ session: "A", id: "top", landed: false }]);
    expect(t.w.holds.get("mid")).toMatchObject({ session: "A" });
    t.b.pose.hold("mid", T([0.3, 0.05, 0]));
    t.w.tick(1 / 60, 30);
    expect(t.writes).toEqual([]);
    expect(t.w.sent).toEqual([]);
    expect(t.notices("A")).toEqual(["Someone drew that one"]);
    expect(t.w.doc.objects.low.transform.position).toEqual([0.3, 0.001, 0]);
    t.w.done();
  });

  it("a peer who moved it first (written, not held): theirs", async () => {
    const t = await table();
    t.draw("top");
    t.w.tick(1 / 60, 5);
    t.w.change((d) => (d.objects.top.transform.position = [0.27, 0.002, -0.5]));
    t.w.tick(1 / 60, 40);
    near(t.w.doc.objects.top.transform.position, [0.27, 0.002, -0.5]);
    near(t.w.doc.objects.mid.transform.position, [-0.21, 0.002, 0.5]);
    expect(t.writes).toHaveLength(1);
    t.w.done();
  });

  it("a card nothing keeps can be drawn all the same: Draw is the table's, not the keeper's", async () => {
    const t = await table();
    t.w.change((d) => (d.objects.loose = { name: "Card", transform: T([0.5, 0.001, 0], [0, 0, Math.PI]), traits: { [CARD]: {} }, tags: ["card"] }));
    t.w.flush();
    expect(t.state(t.xa, "loose")).toMatchObject({ title: expect.any(String) });
    t.draw("loose");
    t.w.tick(1 / 60, 30);
    near(t.w.doc.objects.loose.transform.position, [-0.21, 0.002, 0.5]);
    // and nothing on the wire says which card it was
    expect(JSON.stringify(t.w.sent)).not.toMatch(/loose|slot/);
    t.w.done();
  });
});

describe("the hand in play", () => {
  afterEach(() => vi.useRealTimers());
  const pawn = () => ({ name: "Pawn", transform: T([0, 0, 0]) });

  it("back in play after editing with Rotate (R) or Move (G), the hand is the tool again", () => {
    const w = fakes.fakeWorld(sceneOf({ pawn: pawn() }, { [SEATS]: seats("alice", "bob") }));
    const { api: a } = sit(w, "A", "alice", { local: { tool: "rotate", activities: { current: "edit", available: ["play", "edit"] } } });
    w.flush();
    expect(a.local.get().tool).toBe("rotate"); // editing: left alone
    a.local.swap((m) => ({ ...m, activities: { ...m.activities, current: "play" } }));
    w.flush();
    expect(a.local.get().tool).toBe("hand");
    a.local.swap((m) => ({ ...m, tool: "move" }));
    w.flush();
    expect(a.local.get().tool).toBe("hand");
    w.done();
  });

  it("a table whose doc suggests no tool (no view.tool): in play, the hand is the tool", () => {
    const doc = sceneOf({ p1: pawn() });
    const w = fakes.fakeWorld(doc);
    const { api: a } = sit(w, "A", "alice");
    expect(a.local.get().tool).toBeUndefined(); // the stage's default, Move, is in force
    w.flush();
    expect(a.local.get().tool).toBe("hand");
    // a doc that suggests the hand already: nothing to do
    const doc2 = sceneOf({ p1: pawn() }, {}, { view: { ...emptyScene().view, tool: "hand" } });
    const w2 = fakes.fakeWorld(doc2);
    const b = w2.join("B", { viewer: "bob" });
    const swap = vi.spyOn(b.local, "swap");
    w2.attach("B", Extension.create(b));
    w2.flush();
    expect(swap).not.toHaveBeenCalled();
    expect(b.local.get().tool).toBeUndefined();
    w2.done();
    w.done();
  });

  it("has Shuffle and Draw and nothing else: no Roll (dice are the dice package's), no Sit (seats are their owner's)", () => {
    const w = fakes.fakeWorld(sceneOf({ p1: pawn() }));
    const { x } = sit(w, "A", "alice");
    expect(x.commands.map((c) => c.id)).toEqual(["shuffle", "draw"]);
    w.done();
  });
});
