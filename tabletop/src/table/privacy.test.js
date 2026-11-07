// The three looks of a hidden card (privacy.js): face down its back, face up
// and yours its face, face up and not yours the privacy face, judged in the
// frame the card lies in; and the privacy face's file, made once per scene,
// shared, never written per card.
import { afterEach, describe, it, expect, vi } from "vitest";
import * as Automerge from "@automerge/automerge";
import { HIDDEN, SEATS, ZONE, faceUpIn } from "./visibility.js";
import Extension from "./extension.js";
import { DEFAULT_CARD, PRIVACY_VERSION, cardBounds, cardState, privacyFile, privacyKey, privacyPiece, rememberAsset } from "./privacy.js";
import { pieceMeshes, meshesBounds } from "../shapes.js";
import { testScene } from "./test-scene.js";
import * as fakes from "../test/fakes.js";

afterEach(() => vi.useRealTimers());

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const BOUNDS = { min: [-0.028, 0, -0.0435], max: [0.028, 0.0012, 0.0435] };
const card = (position, rotation = [0, 0, 0], parent = null) => ({ name: "Card", ...(parent ? { parent } : {}), transform: T(position, rotation), traits: { [HIDDEN]: { by: DECK } }, tags: ["card"], hint: { bounds: structuredClone(BOUNDS) } });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const DOWN = [0, 0.3, Math.PI];

describe("three looks", () => {
  it("cardState: its face if you may see it, else the privacy face face up (kept from you, or dealt and coming), else its back", () => {
    const table = [
      [{ face: true, faceUp: true }, "face"],
      [{ face: true, faceUp: false }, "face"], // your own hand, face down: the zone rule shows you it
      [{ face: false, faceUp: true }, "private"],
      [{ face: false, faceUp: false }, "back"],
      // in another seat's hand
      [{ face: false, faceUp: true, withheld: true, dealt: true }, "private"],
      [{ face: false, faceUp: true, withheld: true, dealt: null }, "private"],
      [{ face: false, faceUp: false, withheld: true, dealt: true }, "back"],
      // yours to see, its face on its way (a secure deck's keys): private once dealt
      [{ face: false, faceUp: true, withheld: false, dealt: true }, "private"],
      [{ face: false, faceUp: true, withheld: false, dealt: null }, "back"],
      // not dealt yet: nobody's, so backs everywhere
      [{ face: false, faceUp: true, withheld: false, dealt: false }, "back"],
      [{ face: false, faceUp: true, withheld: true, dealt: false }, "back"],
    ];
    for (const [o, want] of table) expect([o, cardState(o)]).toEqual([o, want]);
  });

  it("face up is judged in the frame the card lies in: at the root, the world's up", () => {
    const s = testScene({ up: card([0, 0, 0], [0, 2.1, 0]), down: card([0, 0, 0], DOWN), tipped: card([0, 0, 0], [Math.PI, 0, 0]) });
    expect(["up", "down", "tipped"].map((id) => faceUpIn(s, id))).toEqual([true, false, false]);
  });

  it("on a heeled, pitching, moving ship: as it lies on her table, whatever she does, even past 90°", () => {
    const poses = [
      T([10, 0, 5], [0, 0.7, 0]),
      T([12, 0.4, 6], [0.35, 1.2, -0.4]), // heeled 23°, pitched 20°, turned
      T([-3, -0.2, 9], [-0.2, -2.5, 0.6]),
      T([0, 1, 0], [0, 0.3, 2.2]), // knocked down past her beam ends: the table is upside down in the world
    ];
    for (const ship of poses) {
      const s = testScene({
        ship: { name: "Ship", transform: ship },
        tbl: { name: "Table", parent: "ship", transform: T([0, 0.72, 2.85], [0, Math.PI / 2, 0]), locked: true },
        up: card([0.1, 0.7, 0], [0, 0.4, 0], "tbl"),
        down: card([0.2, 0.7, 0], DOWN, "tbl"),
      });
      expect([faceUpIn(s, "up"), faceUpIn(s, "down")]).toEqual([true, false]);
    }
    // the world's up would have said otherwise there: the old test (+Y's world y) flips with her
    const s = testScene({ ship: { transform: poses[3] }, up: card([0, 0, 0], [0, 0, 0], "ship") });
    expect(s.world("up")[5]).toBeLessThan(0);
    expect(faceUpIn(s, "up")).toBe(true);
  });

  it("the privacy face is alike on both sides: turned over mid-flip it's still frost and a padlock, never a bare underside", () => {
    const { parts } = privacyPiece(BOUNDS);
    const mid = (BOUNDS.min[1] + BOUNDS.max[1]) / 2;
    const span = (p) => (p.shape === "box" ? [p.at[1], p.at[1] + p.size[1]] : [p.profile[0][1], p.profile.at(-1)[1]]);
    for (const name of ["frost", "reed", "lock", "shackle", "keyhole"]) {
      const ps = parts.filter((p) => p.name === name);
      const top = ps.filter((p) => span(p)[0] >= mid - 1e-9);
      const under = ps.filter((p) => span(p)[1] <= mid + 1e-9);
      expect([name, top.length > 0, top.length]).toEqual([name, true, under.length]);
      // the underside the top mirrored through the card's middle
      const flip = (p) => span(p).map((y) => +(2 * mid - y).toFixed(9)).reverse();
      expect(under.map((p) => span(p).map((y) => +y.toFixed(9))).sort()).toEqual(top.map(flip).sort());
    }
  });

  it("the privacy face fills the card's bounds, and is one file for every card that size", () => {
    const b = meshesBounds(pieceMeshes(privacyPiece(BOUNDS).parts));
    BOUNDS.min.forEach((v, i) => expect(b.min[i]).toBeCloseTo(v, 6));
    BOUNDS.max.forEach((v, i) => expect(b.max[i]).toBeCloseTo(v, 6));
    const f = privacyFile(BOUNDS);
    expect(f).toMatchObject({ name: "Private card.glb", extension: "glb", mimeType: "model/gltf-binary", hint: { bounds: BOUNDS } });
    expect(Buffer.from(privacyFile(BOUNDS).bytes).equals(Buffer.from(f.bytes))).toBe(true);
    expect(privacyKey(BOUNDS)).toBe(`tabletop/private-card@${PRIVACY_VERSION}:-280,0,-435,280,12,435`);
    expect(privacyKey(cardBounds({ hint: { bounds: BOUNDS } }))).toBe(privacyKey(BOUNDS));
    // no hint, or one that isn't a box: a Lost Cities card
    expect(cardBounds({})).toBe(DEFAULT_CARD);
    expect(cardBounds({ hint: { bounds: { min: [0, 0, 0], max: [0, 1, 1] } } })).toBe(DEFAULT_CARD);
    expect(privacyKey(cardBounds({ hint: { bounds: { min: [-0.03, 0, -0.045], max: [0.03, 0.001, 0.045] } } }))).not.toBe(privacyKey(BOUNDS));
  });

  it("two peers remembering it at once: the merge keeps one, whole", () => {
    const base = Automerge.from({ objects: {}, traits: {} }); // a table from before `assets`
    const key = privacyKey(BOUNDS);
    const a = Automerge.change(Automerge.clone(base), (d) => rememberAsset(d, key, "automerge:fileA", BOUNDS));
    const b = Automerge.change(Automerge.clone(base), (d) => rememberAsset(d, key, "automerge:fileB", BOUNDS));
    const merged = Automerge.merge(Automerge.clone(a), b);
    const m = Automerge.toJS(merged);
    expect(Object.keys(m.assets)).toEqual([key]);
    expect(["automerge:fileA", "automerge:fileB"]).toContain(m.assets[key].url);
    expect(m.assets[key].hint).toEqual({ bounds: BOUNDS });
    // and once it's there, nobody writes over it
    const c = Automerge.change(Automerge.clone(merged), (d) => rememberAsset(d, key, "automerge:fileC", BOUNDS));
    expect(Automerge.toJS(c).assets[key].url).toBe(m.assets[key].url);
  });
});

// A Lost Cities-ish table: Alice in p1, Bob in p2, a plain deck that knows every card
const FACES = ["mineUp", "mineDown", "theirsUp", "theirsDown", "tableUp", "tableDown"];
function tableDoc({ assets } = {}) {
  return {
    objects: {
      hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1"), locked: true },
      hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2"), locked: true },
      mineUp: card([0.1, 0.002, 0.5]),
      mineDown: card([0.2, 0.002, 0.5], DOWN),
      theirsUp: card([0.1, 0.002, -0.5], [0, Math.PI, 0]),
      theirsDown: card([0.2, 0.002, -0.5], DOWN),
      tableUp: card([0, 0, 0]),
      tableDown: card([0.3, 0.001, 0], DOWN),
    },
    traits: { [SEATS]: { p1: { name: "Player 1", player: "alice" }, p2: { name: "Player 2", player: "bob" } } },
    ...(assets ? { assets } : {}),
  };
}
async function table({ doc = tableDoc(), deck = "plain-deck", resolver, hang = false } = {}) {
  const repo = fakes.fakeRepo();
  const creates = vi.spyOn(repo, "create2");
  repo.add({ "@patchwork": { type: deck }, title: "Deck", objects: Object.fromEntries(FACES.map((id) => [id, { sourceUrl: `automerge:face-${id}`, name: `Face of ${id}` }])) }, DECK);
  const registries = resolver
    ? { "tabletop:deck": fakes.fakeRegistry([{ id: "sd", supportedDatatypes: [deck], load: async () => ({ createResolver: resolver }) }]) }
    : hang
      ? { "tabletop:deck": fakes.fakeRegistry([{ id: "sd", supportedDatatypes: [deck], load: () => new Promise(() => {}) }]) }
      : {};
  const w = fakes.fakeWorld(doc, { repo, registries });
  const x = {};
  const join = async (session, viewer) => {
    x[session] = w.attach(session, Extension.create(w.join(session, { viewer })));
    await settle();
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      w.flush();
      await vi.advanceTimersByTimeAsync(5);
    }
  };
  const privateFiles = () => creates.mock.calls.filter(([d]) => d?.name === "Private card.glb").length;
  /** What a view shows each card as: "face", "private" or "back". */
  const shows = (session) => {
    const looks = x[session].looks();
    const url = w.doc.assets?.[privacyKey(BOUNDS)]?.url;
    return Object.fromEntries(
      FACES.filter((id) => w.doc.objects[id]).map((id) => {
        const l = looks.get(id);
        return [id, !l ? "back" : l.sourceUrl === url && url ? "private" : l.sourceUrl === `automerge:face-${id}` ? "face" : `? ${JSON.stringify(l)}`];
      }),
    );
  };
  return { w, x, join, settle, shows, privateFiles, creates, repo };
}

describe("the lens: what each viewer sees", () => {
  it("your hand face up and down, theirs, and the table: three looks, per viewer", async () => {
    const t = await table();
    await t.join("A", "alice");
    await t.join("B", "bob");
    await t.join("C", "carol"); // watching
    expect(t.shows("A")).toEqual({ mineUp: "face", mineDown: "face", theirsUp: "private", theirsDown: "back", tableUp: "face", tableDown: "back" });
    expect(t.shows("B")).toEqual({ mineUp: "private", mineDown: "back", theirsUp: "face", theirsDown: "face", tableUp: "face", tableDown: "back" });
    expect(t.shows("C")).toEqual({ mineUp: "private", mineDown: "back", theirsUp: "private", theirsDown: "back", tableUp: "face", tableDown: "back" });
    // the privacy look says nothing but the picture: no name to read in the outline
    expect([...t.x.A.looks().values()].filter((l) => !l.name)).toEqual([{ sourceUrl: t.w.doc.assets[privacyKey(BOUNDS)].url }]);
    t.w.done();
  });

  it("turning a card over in someone else's hand: back face down, private face up", async () => {
    const t = await table();
    await t.join("A", "alice");
    expect(t.shows("A").theirsDown).toBe("back");
    t.w.change((d) => (d.objects.theirsDown.transform.rotation = [0, Math.PI, 0]));
    await t.settle();
    expect(t.shows("A").theirsDown).toBe("private");
    t.w.done();
  });

  it("at a table aboard a ship that heels and sails on: the same looks in every pose", async () => {
    const doc = tableDoc();
    doc.objects.ship = { name: "Ship", transform: T([10, 0, 5], [0, 0.7, 0]) };
    doc.objects.tbl = { name: "Table", parent: "ship", transform: T([0, 0.72, 2.85], [0, Math.PI / 2, 0]), locked: true };
    for (const id of ["hand1", "hand2", ...FACES]) doc.objects[id].parent = "tbl";
    const t = await table({ doc });
    await t.join("A", "alice");
    const want = { mineUp: "face", mineDown: "face", theirsUp: "private", theirsDown: "back", tableUp: "face", tableDown: "back" };
    expect(t.shows("A")).toEqual(want);
    for (const pose of [T([12, 0.3, 6], [0.4, 1.1, -0.35]), T([14, -0.2, 8], [-0.3, 1.6, 0.5]), T([0, 0, 0], [0, 0, 2.4])]) {
      // written (a peer's sim saving her) and drawn (holds: the lens goes by the doc, so these change nothing)
      t.w.change((d) => (d.objects.ship.transform = pose));
      t.w.holds.set("ship", { session: "SIM", transform: T([pose.position[0] + 1, 0, 0], [0.5, 0, 0.5]), at: Date.now() });
      await t.settle();
      expect(t.shows("A")).toEqual(want);
    }
    t.w.done();
  });

  it("a face-up card whose key hasn't come yet (a secure deck) is private, and its face when it comes", async () => {
    let known = new Map();
    let poke = null;
    const resolver = ({ onChange }) => {
      poke = onChange;
      return { update() {}, looks: () => known, status: () => null, dealt: () => true };
    };
    const t = await table({ deck: "secure-deck", resolver });
    await t.join("A", "alice");
    expect(t.shows("A")).toEqual({ mineUp: "private", mineDown: "back", theirsUp: "private", theirsDown: "back", tableUp: "private", tableDown: "back" });
    known = new Map([["mineUp", { sourceUrl: "automerge:face-mineUp", name: "Face of mineUp" }], ["mineDown", { sourceUrl: "automerge:face-mineDown", name: "x" }]]);
    poke();
    await t.settle();
    expect(t.shows("A")).toMatchObject({ mineUp: "face", mineDown: "face", tableUp: "private" });
    t.w.done();
  });

  it("seated, the other seat still open (a secure deck not dealt): your own tray and every card shows its back", async () => {
    let dealt = false;
    let known = new Map();
    let poke = null;
    const resolver = ({ onChange }) => {
      poke = onChange;
      return { update() {}, looks: () => known, status: () => (dealt ? null : "Deck is shuffled once someone sits as Player 2."), dealt: () => dealt };
    };
    const doc = tableDoc();
    doc.traits[SEATS].p2.player = null;
    const t = await table({ doc, deck: "secure-deck", resolver });
    await t.join("A", "alice");
    expect(Object.values(t.shows("A")).every((v) => v === "back")).toBe(true);
    expect(t.privateFiles()).toBe(0);
    expect(t.x.A.hud()).toEqual([{ text: "Deck is shuffled once someone sits as Player 2.", state: "info" }]);
    // Bob sits and it's dealt: A's own hand its faces as they come, Bob's private
    t.w.change((d) => (d.traits[SEATS].p2.player = "bob"));
    dealt = true;
    known = new Map([["mineUp", { sourceUrl: "automerge:face-mineUp", name: "x" }], ["mineDown", { sourceUrl: "automerge:face-mineDown", name: "x" }]]);
    poke();
    await t.settle();
    expect(t.shows("A")).toEqual({ mineUp: "face", mineDown: "face", theirsUp: "private", theirsDown: "back", tableUp: "private", tableDown: "back" });
    t.w.done();
  });

  it("a deck that doesn't say whether it's dealt: private only what the zone rule keeps from you", async () => {
    const resolver = () => ({ update() {}, looks: () => new Map(), status: () => null });
    const t = await table({ deck: "secure-deck", resolver });
    await t.join("A", "alice");
    expect(t.shows("A")).toEqual({ mineUp: "back", mineDown: "back", theirsUp: "private", theirsDown: "back", tableUp: "back", tableDown: "back" });
    t.w.done();
  });

  it("never from the deck's secrets: the privacy look is the same whatever the deck says each card is", async () => {
    const looksWith = async (secrets) => {
      const t = await table();
      await t.join("A", "alice");
      // what the deck doc holds changes nothing about the private cards' look but which ones it can show
      (await t.repo.find(DECK)).change((d) => (d.objects = secrets));
      await t.settle();
      const l = t.x.A.looks().get("theirsUp");
      t.w.done();
      return { look: l, bytes: t.creates.mock.calls.find(([d]) => d?.name === "Private card.glb")[0].content };
    };
    const one = await looksWith({ theirsUp: { sourceUrl: "automerge:red-7", name: "Red 7" } });
    const two = await looksWith({ theirsUp: { sourceUrl: "automerge:blue-wager", name: "Blue wager" } });
    expect(Object.keys(one.look)).toEqual(["sourceUrl"]);
    expect(Buffer.from(one.bytes).equals(Buffer.from(two.bytes))).toBe(true);
  });

  it("a deck still loading leaves every card its back; one that can't be read is private face up", async () => {
    // (its provider's module never arrives)
    const loading = await table({ deck: "slow-deck", hang: true });
    await loading.join("A", "alice");
    expect(Object.values(loading.shows("A")).every((v) => v === "back")).toBe(true);
    expect(loading.privateFiles()).toBe(0);
    loading.w.done();
    const t = await table({ deck: "unknown-deck" });
    await t.join("A", "alice");
    expect(t.shows("A")).toEqual({ mineUp: "private", mineDown: "back", theirsUp: "private", theirsDown: "back", tableUp: "private", tableDown: "back" });
    expect(t.x.A.hud()).toEqual([{ text: expect.stringContaining("unknown-deck"), state: "error" }]);
    t.w.done();
  });
});

describe("the privacy face's file: once per scene, shared, nothing per card", () => {
  it("a table published before it existed (no assets at all) gets one, from the first view that needs it", async () => {
    const t = await table();
    const before = structuredClone(t.w.doc.objects);
    expect(t.w.doc.assets).toBeUndefined();
    await t.join("A", "alice");
    expect(t.privateFiles()).toBe(1);
    const key = privacyKey(BOUNDS);
    expect(Object.keys(t.w.doc.assets)).toEqual([key]);
    expect(t.w.doc.assets[key]).toEqual({ url: expect.stringMatching(/^automerge:/), hint: { bounds: BOUNDS } });
    // nothing written on any card, or anywhere but that one key
    expect(t.w.doc.objects).toEqual(before);
    // more passes of the lens, more changes: no more files
    for (let i = 0; i < 3; i++) {
      t.w.change((d) => (d.objects.tableUp.transform.position[0] += 0.01));
      await t.settle();
    }
    expect(t.privateFiles()).toBe(1);
    t.w.done();
  });

  it("a view that comes later uses the one the scene has", async () => {
    const t = await table();
    await t.join("A", "alice");
    await t.join("B", "bob");
    await t.join("C", "carol");
    expect(t.privateFiles()).toBe(1);
    const url = t.w.doc.assets[privacyKey(BOUNDS)].url;
    for (const s of ["A", "B", "C"]) expect(t.x[s].looks().get(s === "A" ? "theirsUp" : "mineUp")).toEqual({ sourceUrl: url });
    t.w.done();
  });

  it("one the scene already has is used, and nothing is made", async () => {
    const url = "automerge:2PrivatePrivatePrivate1";
    const t = await table({ doc: tableDoc({ assets: { [privacyKey(BOUNDS)]: { url, hint: { bounds: BOUNDS } } } }) });
    await t.join("A", "alice");
    expect(t.privateFiles()).toBe(0);
    expect(t.x.A.looks().get("theirsUp")).toEqual({ sourceUrl: url });
    t.w.done();
  });

  it("nobody needs one (every card face down or yours): nothing is made, nothing written", async () => {
    const doc = tableDoc();
    delete doc.objects.theirsUp;
    doc.objects.tableUp.transform.rotation = DOWN;
    const t = await table({ doc });
    await t.join("A", "alice");
    expect(t.privateFiles()).toBe(0);
    expect(t.w.doc.assets).toBeUndefined();
    t.w.done();
  });

  it("two views needing it at once: one more file doc at most, and both use the one kept", async () => {
    const t = await table();
    // both join before either has settled: each makes one
    t.x.A = t.w.attach("A", Extension.create(t.w.join("A", { viewer: "alice" })));
    t.x.B = t.w.attach("B", Extension.create(t.w.join("B", { viewer: "bob" })));
    await t.settle();
    expect(t.privateFiles()).toBe(2);
    const url = t.w.doc.assets[privacyKey(BOUNDS)].url;
    expect(t.x.A.looks().get("theirsUp")).toEqual({ sourceUrl: url });
    expect(t.x.B.looks().get("mineUp")).toEqual({ sourceUrl: url });
    await t.settle();
    expect(t.privateFiles()).toBe(2);
    t.w.done();
  });

  it("two sizes of card: one each", async () => {
    const doc = tableDoc();
    doc.objects.theirsUp.hint = { bounds: { min: [-0.03, 0, -0.045], max: [0.03, 0.001, 0.045] } };
    const t = await table({ doc });
    await t.join("C", "carol");
    expect(t.privateFiles()).toBe(2);
    expect(Object.keys(t.w.doc.assets).sort()).toEqual([privacyKey(BOUNDS), privacyKey(doc.objects.theirsUp.hint.bounds)].sort());
    expect(t.x.C.looks().get("theirsUp")).not.toEqual(t.x.C.looks().get("mineUp"));
    t.w.done();
  });
});
