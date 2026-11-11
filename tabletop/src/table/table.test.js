import { afterEach, describe, it, expect, vi } from "vitest";
import * as Automerge from "@automerge/automerge";
import { HIDDEN, SEATS, ZONE, docUrl, faceUpIn, seatAt, seatOf, seatedPlayers, visibility, zones } from "./visibility.js";
import { plainResolver } from "./plain-deck.js";
import Extension, { PLAIN_HANDS, seatState } from "./extension.js";
import { testScene } from "./test-scene.js";
import * as fakes from "../test/fakes.js";
import { emptyScene } from "../empty-scene.js";

/** A scene doc as the scene makes one (empty-scene.js), with these objects in it, listed in order. */
const sceneOf = (objects, traits = {}, more = {}) => emptyScene({ objects, order: Object.keys(objects), traits, ...more });
import { DIE, MAX_FACE, eulerMatrix, faceUp, rollPlan, ROLL_SECONDS } from "./dice.js";

const T = (position, rotation = [0, 0, 0]) => ({ position, rotation, scale: 1 });
const zone = (seat) => ({ [ZONE]: { seat, min: [-0.3, 0, -0.05], max: [0.3, 0.15, 0.05] } });
const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const hidden = { [HIDDEN]: { by: DECK } };
const objects = () => ({
  // two hand trays, one turned round, each a private zone 0.6 × 0.1 m, 0.15 m high
  hand1: { name: "Hand 1", transform: T([0, 0, 0.5]), traits: zone("p1") },
  hand2: { name: "Hand 2", transform: T([0, 0, -0.5], [0, Math.PI, 0]), traits: zone("p2") },
  inHand1: { name: "Card", transform: T([0.1, 0.002, 0.5]), traits: hidden },
  inHand2Flipped: { name: "Card", transform: T([0.2, 0.002, -0.49], [0, 0, Math.PI]), traits: hidden },
  faceUp: { name: "Card", transform: T([0, 0, 0]), traits: hidden },
  faceDown: { name: "Card", transform: T([0.3, 0.001, 0], [0, 0.4, Math.PI]), traits: hidden },
  // attached to the tray: its world position decides
  onTray: { name: "Card", parent: "hand1", transform: T([-0.2, 0.002, 0]), traits: hidden },
  board: { name: "Board", transform: T([0, 0, 0]) },
});
const seats = (p1 = null, p2 = null) => ({ p1: { name: "Player 1", player: p1 }, p2: { name: "Player 2", player: p2 } });

describe("who may see what", () => {
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

  it("a hand is its seat's alone, either way up; the table is face up for everyone", () => {
    const scene = testScene(objects());
    const see = visibility(scene, seats("alice", "bob"));
    const hiddenOnes = (set) => [...set].filter((id) => scene.objects[id].traits?.[HIDDEN]).sort();
    expect(hiddenOnes(see("alice"))).toEqual(["faceUp", "inHand1", "onTray"]);
    expect(hiddenOnes(see("bob"))).toEqual(["faceUp", "inHand2Flipped"]);
    expect(hiddenOnes(see(null))).toEqual(["faceUp"]);
    expect(hiddenOnes(see("carol"))).toEqual(["faceUp"]); // not seated: watching
  });

  it("seats", () => {
    expect(seatOf(seats("alice"), "alice")).toBe("p1");
    expect(seatOf(seats("alice"), "bob")).toBeNull();
    expect(seatedPlayers(seats(null, "bob"))).toEqual(["bob"]);
    expect(docUrl(`${DECK}#heads`)).toBe(DECK);
    expect(docUrl("nope")).toBeNull();
  });
});

describe("the plain deck", () => {
  it("shows what the viewer may see, and shuffles entries", () => {
    let doc = { objects: { a: { sourceUrl: "automerge:a", name: "A" }, b: { sourceUrl: "automerge:b", name: "B" } } };
    const handle = { doc: () => doc, change: (fn) => ((doc = structuredClone(doc)), fn(doc)), on() {}, off() {} };
    const r = plainResolver({ handle, viewer: "alice" });
    r.update({ visibleTo: () => new Set(["a"]) });
    expect([...r.looks().keys()]).toEqual(["a"]);
    expect(r.shuffle(["a", "b"], () => 0)).toBe(2);
    expect(doc.objects.a.name).toBe("B");
    expect(r.shuffle(["a"])).toBe(0);
  });

  it("two shuffles at once merge to one whole shuffle: no card twice, none lost", () => {
    const entries = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`o${i}`, { sourceUrl: `automerge:card${i}`, name: `Card ${i}` }]));
    const base = Automerge.from({ title: "Deck", objects: entries });
    const handleOf = (doc) => ({ doc: () => doc, change: (fn) => (doc = Automerge.change(doc, fn)), on() {}, off() {}, get current() {
      return doc;
    } });
    const a = handleOf(Automerge.clone(base));
    const b = handleOf(Automerge.clone(base));
    const ids = Object.keys(entries);
    // the same pile, listed in a different order by each peer, shuffled differently
    expect(plainResolver({ handle: a, viewer: "alice" }).shuffle(ids, seeded(3))).toBe(10);
    expect(plainResolver({ handle: b, viewer: "bob" }).shuffle([...ids.slice(5), ...ids.slice(0, 5)], seeded(8))).toBe(10);
    const merged = Automerge.toJS(Automerge.merge(a.current, b.current));
    expect(Object.keys(merged.objects).sort()).toEqual([...ids].sort());
    const cards = (objects) => Object.values(objects).map((e) => `${e.sourceUrl}|${e.name}`).sort();
    expect(cards(merged.objects)).toEqual(cards(entries));
    // and the shuffle that won is one of the two, whole
    const one = Automerge.toJS(a.current).objects;
    const other = Automerge.toJS(b.current).objects;
    expect([one, other]).toContainEqual(merged.objects);
  });
});

/** Deterministic random numbers, for shuffles. */
function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}

/** An in-memory repo with real-looking urls, whose handles emit "change". */
function fakeRepo() {
  const handles = new Map();
  let n = 0;
  const make = (url, doc) => {
    const listeners = new Set();
    const h = {
      url,
      doc: () => doc,
      change(fn) {
        doc = structuredClone(doc);
        fn(doc);
        for (const l of [...listeners]) l();
      },
      on: (ev, fn) => ev === "change" && listeners.add(fn),
      off: (ev, fn) => listeners.delete(fn),
    };
    handles.set(url, h);
    return h;
  };
  return {
    add: (doc, url = `automerge:2Doc${String(n++).padStart(4, "x")}abcdefghijkmnopqr`) => make(url, structuredClone(doc)),
    async find(url) {
      const h = handles.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
  };
}

/** The extension against a stand-in for the scene's api. */
function mount({ viewer = "alice", registries = {}, deckType = "plain-deck" } = {}) {
  const repo = fakeRepo();
  let doc = sceneOf(objects(), { [SEATS]: seats(viewer) });
  const deck = repo.add(
    { "@patchwork": { type: deckType }, objects: Object.fromEntries(["inHand1", "inHand2Flipped", "faceUp", "faceDown", "onTray"].map((id) => [id, { sourceUrl: `automerge:${id}`, name: `Face of ${id}` }])) },
    DECK,
  );
  const calls = { toasts: [], refreshes: 0, selected: null, camera: null };
  const api = {
    repo,
    viewer,
    doc: () => doc,
    scene: () => testScene(doc.objects, doc.traits),
    change: (fn) => {
      doc = structuredClone(doc);
      fn(doc);
    },
    newId: (p) => `${p}${Math.random().toString(36).slice(2, 8)}`,
    local: { get: () => ({}), swap: (fn) => (calls.selected = fn({}).selected) },
    notify: (m, kind) => calls.toasts.push([m, kind]),
    schedule: () => calls.refreshes++,
    overlay: () => (calls.overlay = document.createElement("div")),
    presence: { get: () => calls.peers ?? {}, watch: (fn) => ((calls.presenceWatch = fn), () => {}) },
    style() {},
    box: () => null,
    camera: { set: (c) => (calls.camera = c) },
    registry: async (type) => registries[type] ?? null,
  };
  const x = Extension.create(api);
  return { x, api, deck, calls, repo, get doc() {
    return doc;
  } };
}
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("the table extension", () => {
  it("a deck of a kind nothing installed reads shows no faces, and the HUD names the kind", async () => {
    const m = mount({ deckType: "some-deck" });
    m.x.update(m.api.scene());
    await settle();
    expect(m.x.looks().size).toBe(0);
    expect(m.x.hud()).toEqual([{ text: expect.stringContaining("some-deck"), state: "error" }]);
  });

  it("reads a deck and shows this viewer what they may see", async () => {
    const m = mount();
    m.x.update(m.api.scene());
    await settle();
    expect(m.calls.refreshes).toBeGreaterThan(0);
    m.x.update(m.api.scene());
    expect([...m.x.looks().keys()].sort()).toEqual(["faceUp", "inHand1", "onTray"]);
    expect(m.x.looks().get("inHand1").name).toBe("Face of inHand1");
  });

  it("turns a hidden card face up over your own zone only", () => {
    const m = mount();
    m.x.update(m.api.scene());
    expect(m.x.landing("faceDown", [0.1, 0.01, 0.5])).toEqual({ faceUp: true });
    expect(m.x.landing("faceDown", [0.1, 0.01, -0.5])).toBeNull(); // someone else's
    expect(m.x.landing("faceDown", [0, 0, 0])).toBeNull();
    expect(m.x.landing("board", [0.1, 0.01, 0.5])).toBeNull(); // not hidden
    const watcher = mount({ viewer: "zed" });
    watcher.api.change((d) => (d.traits[SEATS] = seats()));
    watcher.x.update(watcher.api.scene());
    expect(watcher.x.landing("faceDown", [0.1, 0.01, 0.5])).toBeNull();
  });

  it("shuffles the pile a card is in, through its deck", async () => {
    const m = mount();
    m.x.update(m.api.scene());
    await settle();
    const shuffle = m.x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.key).toBe("s");
    expect(shuffle.state("faceDown")).not.toBeNull();
    expect(shuffle.state("board")).toBeNull();
    expect(shuffle.state(null)).toBeNull();
    // no boxes: the pile is what's on the same spot (faceDown alone)
    shuffle.run("faceDown");
    expect(m.calls.toasts.at(-1)[0]).toMatch(/nothing here to shuffle/);
  });

  it("lays out a deck dropped on the table when its provider can", async () => {
    const placement = vi.fn(() => ({ name: "Secret deck", count: 3, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: { min: [0, 0, 0], max: [0.05, 0.001, 0.08] } }));
    const bind = vi.fn();
    const registry = {
      filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
      load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map() }), placement, bind } }),
    };
    const m = mount({ registries: { "tabletop:deck": registry } });
    // the drop is the module's, called before the extension runs, with a small context
    const ctx = { ...m.api, notify: m.api.notify };
    const url = "automerge:2SecureSecureSecureSecure9";
    expect(await Extension.drop(ctx, { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {} })).toBe(true);
    const cards = Object.values(m.doc.objects).filter((o) => o.traits?.[HIDDEN]?.by === url);
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => Math.abs(c.transform.rotation[2] - Math.PI) < 1e-9)).toBe(true);
    expect(bind).toHaveBeenCalledOnce();
    // not a deck: left to the scene
    expect(m.calls.selected).toMatch(/^g/);
    expect(await Extension.drop(ctx, { url: "automerge:2Other", doc: { "@patchwork": { type: "file" } }, handle: {} })).toBe(false);
  });
});

describe("seats, held by claims", () => {
  afterEach(() => vi.useRealTimers());
  const KIND = (sid) => `tabletop.seat:${sid}`;
  // contacts, with names
  const ANA = "automerge:2AnaAnaAnaAnaAnaAnaAnaAna1";
  const BEN = "automerge:2BenBenBenBenBenBenBenBen1";
  /** A table (seats p1/p2, hands hand1/hand2) and its views, each [session, viewer]. */
  async function room(seated, { claims, views = [] } = {}) {
    const repo = fakes.fakeRepo();
    repo.add({ name: "Ana" }, ANA);
    repo.add({ name: "Ben" }, BEN);
    repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: {} }, DECK);
    const doc = sceneOf(objects(), { [SEATS]: seated }, claims ? { claims } : {});
    const w = fakes.fakeWorld(doc, { repo });
    const t = { w, api: {}, x: {} };
    t.join = async (session, viewer) => {
      t.api[session] = w.join(session, { viewer });
      t.x[session] = w.attach(session, Extension.create(t.api[session]));
      await t.step();
      return t.api[session];
    };
    /** let the views hear the doc, and their microtasks (reconcile) and lookups run, twice over */
    t.step = async () => {
      for (let i = 0; i < 3; i++) {
        w.flush();
        await vi.advanceTimersByTimeAsync(0);
      }
    };
    t.pick = async (session, seat) => {
      const sel = w.view(session).overlay.querySelector(".tabletop-seat");
      sel.value = seat;
      sel.dispatchEvent(new Event("change"));
      await t.step();
    };
    t.options = (session) => [...w.view(session).overlay.querySelector(".tabletop-seat").options].map((o) => o.textContent);
    t.picked = (session) => w.view(session).overlay.querySelector(".tabletop-seat").value;
    t.notices = (session) => w.view(session).notices.map((n) => n.text);
    t.claim = (sid) => w.doc.claims?.[KIND(sid)] ?? null;
    t.player = (sid) => w.doc.traits[SEATS][sid].player;
    for (const [s, v] of views) await t.join(s, v);
    return t;
  }

  it("seatState: whose a seat is, from the doc's player and the live claim", () => {
    const seat = (player = null) => ({ name: "Seat", player });
    const by = (viewer, mine = false) => ({ viewer, session: `s-${viewer}`, mine });
    const table = [
      [seat(), null, "free"],
      [undefined, null, "free"],
      [seat("a"), null, "mine"], // yours in the doc, not claimed yet (a reload)
      [seat("b"), null, "away"],
      [seat(), by("a", true), "mine"],
      [seat("b"), by("a", true), "mine"], // a split merge: the claim's holder writes itself back
      [seat("a"), by("a"), "mine-elsewhere"], // your other tab
      [seat("a"), by("b"), "taken"], // you lost it, or it's theirs now
      [seat(), by("b"), "taken"], // they're sitting down
      [seat("b"), by("b"), "taken"],
      [seat(), by(null), "taken"],
    ];
    for (const [s, b, want] of table) expect([s?.player, b?.viewer, b?.mine, seatState(s, b, "a")]).toEqual([s?.player, b?.viewer, b?.mine, want]);
    expect(seatState(seat(), by(null), null)).toBe("taken");
  });

  it("sit, and the seat's camera; the seat is claimed as well as written down", async () => {
    const t = await room(seats(), { views: [["C", "carol"]] });
    t.w.change((d) => (d.traits[SEATS].p1.camera = { position: [0, 1, 1], target: [0, 0, 0] }));
    await t.step();
    expect(t.options("C")).toEqual(["Watching", "Player 1", "Player 2"]);
    await t.pick("C", "p1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    expect(t.w.view("C").camera).toEqual({ position: [0, 1, 1], target: [0, 0, 0] });
    expect(t.picked("C")).toBe("p1");
    // moving seats lets go of the last one
    await t.pick("C", "p2");
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "carol"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "C"]);
    t.w.done();
  });

  it("a view that has just opened sees a present player's seat as taken, and can't take it", async () => {
    // Ben sat down in a session this view hasn't heard from yet: it counts (the stage's grace)
    const t = await room(seats(BEN), { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol"]] });
    expect(t.options("C")).toEqual(["Watching", "Player 1 (taken)", "Player 2"]);
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    await t.pick("C", "p1");
    expect(confirm).not.toHaveBeenCalled();
    expect(t.notices("C")).toEqual(["Ben is sitting there."]);
    expect(t.player("p1")).toBe(BEN);
    expect(t.claim("p1").session).toBe("Sben");
    expect(t.picked("C")).toBe("");
    confirm.mockRestore();
    t.w.done();
  });

  it("once that claim has lapsed unheard, the seat is away, and taken only after asking", async () => {
    const t = await room(seats(BEN), { claims: { [KIND("p1")]: { viewer: BEN, session: "Sben" } }, views: [["C", "carol"]] });
    expect(t.options("C")[1]).toBe("Player 1 (taken)");
    // no presence event says it lapsed: the view looks again after the grace period
    t.w.grace = false;
    await vi.advanceTimersByTimeAsync(6500);
    expect(t.options("C")[1]).toBe("Player 1 (away)");
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    await t.pick("C", "p1");
    expect(confirm).toHaveBeenCalledWith("Ben is away. Take their seat? You'll see their hand.");
    expect(t.player("p1")).toBe(BEN);
    expect(t.picked("C")).toBe("");
    confirm.mockReturnValue(true);
    await t.pick("C", "p1");
    expect(t.player("p1")).toBe("carol");
    expect(t.claim("p1")).toEqual({ viewer: "carol", session: "C" });
    confirm.mockRestore();
    t.w.done();
  });

  it("two sitting at once: the one whose claim lost the merge is told once, and writes nothing", async () => {
    const t = await room(seats(), { views: [["B", BEN], ["C", "carol"]] });
    await t.pick("C", "p1");
    expect(t.claim("p1").session).toBe("C");
    const writes = vi.spyOn(t.api.C, "change");
    const claims = vi.spyOn(t.api.C, "claim");
    // Ben sat down at the same moment, and the merge kept his claim and his player
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    await vi.advanceTimersByTimeAsync(7000);
    await t.step();
    expect(t.notices("C").filter((n) => /first/.test(n))).toEqual(["Ben sat in Player 1 first; you're watching"]);
    expect(writes).not.toHaveBeenCalled();
    expect(claims).not.toHaveBeenCalled();
    expect(t.player("p1")).toBe(BEN);
    expect(t.picked("C")).toBe("");
    expect(t.options("C")[1]).toBe("Player 1 (taken)");
    t.w.done();
  });

  it("a seat taken while this view went unheard, long after it sat down, says so", async () => {
    const t = await room(seats(), { views: [["B", BEN], ["C", "carol"]] });
    await t.pick("C", "p1");
    await vi.advanceTimersByTimeAsync(20_000);
    const writes = vi.spyOn(t.api.C, "change");
    t.w.change((d) => {
      d.claims[KIND("p1")] = { viewer: BEN, session: "B" };
      d.traits[SEATS].p1.player = BEN;
    });
    await t.step();
    expect(t.notices("C").at(-1)).toBe("Ben took Player 1 while you were away; you're watching");
    expect(writes).not.toHaveBeenCalled();
    t.w.done();
  });

  it("a merge that split the claim from the player: the claim's holder writes itself back in, once", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    const writesA = vi.spyOn(t.api.A, "change");
    const writesB = vi.spyOn(t.api.B, "change");
    // the claims key went to Alice, the player key to Bob
    t.w.change((d) => (d.traits[SEATS].p1.player = "bob"));
    await t.step();
    expect(t.player("p1")).toBe("alice");
    expect(writesA).toHaveBeenCalledOnce();
    // and that's the end of it: no write answers a write
    t.w.change((d) => (d.view = { touched: true }));
    await t.step();
    expect(writesA).toHaveBeenCalledOnce();
    expect(writesB).not.toHaveBeenCalled();
    expect(t.picked("B")).toBe("");
    t.w.done();
  });

  it("a reload (a new session, the same viewer) claims its seat again", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    // a clean close: its claim goes with it, its player stays
    t.w.leave("A");
    await t.step();
    expect([t.claim("p1"), t.player("p1")]).toEqual([null, "alice"]);
    expect(t.options("B")[1]).toBe("Player 1 (away)");
    await t.join("A2", "alice");
    expect(t.claim("p1")).toEqual({ viewer: "alice", session: "A2" });
    expect(t.picked("A2")).toBe("p1");
    expect(t.options("B")[1]).toBe("Player 1 (taken)");
    // a crash leaves its claim behind, lapsed: taken over just the same
    t.w.leave("A2", { bye: false });
    expect(t.claim("p1").session).toBe("A2");
    await t.join("A3", "alice");
    expect(t.claim("p1")).toEqual({ viewer: "alice", session: "A3" });
    t.w.done();
  });

  it("one person in two tabs: both seated; the tab that loses the claim says nothing", async () => {
    const t = await room(seats(), { views: [["A", "alice"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    // the second tab is seated too, and leaves the claim with the first
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p1", "p1"]);
    expect(t.options("A2")[1]).toBe("Player 1");
    expect(t.claim("p1").session).toBe("A");
    await t.pick("A2", "p1");
    expect(t.claim("p1").session).toBe("A");
    // both sat down at once and the second tab's claim won: the first just stays seated
    t.w.change((d) => (d.claims[KIND("p1")] = { viewer: "alice", session: "A2" }));
    await t.step();
    expect(t.notices("A").filter((n) => /first|sitting there/.test(n))).toEqual([]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p1", "p1"]);
    expect(t.player("p1")).toBe("alice");
    // the second tab closes: the first takes the claim back
    t.w.leave("A2");
    await t.step();
    expect(t.claim("p1").session).toBe("A");
    t.w.done();
  });

  it("one person in two tabs: the second moves to another seat, and the first lets go rather than writing itself back", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    expect(t.picked("A2")).toBe("p1");
    let writes = 0;
    for (const s of ["A", "A2"]) {
      const change = t.api[s].change;
      t.api[s].change = (fn) => (writes++, change(fn));
    }
    await t.pick("A2", "p2");
    for (let i = 0; i < 20; i++) await t.step();
    // A2 claimed p2 and wrote alice there (and out of p1), once; A let go of p1 and wrote nothing
    expect(writes).toBe(1);
    expect([t.player("p1"), t.player("p2")]).toEqual([null, "alice"]);
    expect([t.claim("p1"), t.claim("p2")?.session]).toEqual([null, "A2"]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["p2", "p2"]);
    expect(t.options("B")).toEqual(["Watching", "Player 1", "Player 2 (taken)"]);
    expect(t.notices("A").filter((n) => /first|sitting there|away/.test(n))).toEqual([]);
    t.w.done();
  });

  it("one person in two tabs: Watching in the one without the claim stands them up in both", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.join("A2", "alice");
    let writes = 0;
    for (const s of ["A", "A2"]) {
      const change = t.api[s].change;
      t.api[s].change = (fn) => (writes++, change(fn));
    }
    await t.pick("A2", "");
    for (let i = 0; i < 20; i++) await t.step();
    expect(writes).toBe(1);
    expect([t.player("p1"), t.claim("p1")]).toEqual([null, null]);
    expect([t.picked("A"), t.picked("A2")]).toEqual(["", ""]);
    expect(t.options("B")[1]).toBe("Player 1");
    t.w.done();
  });

  it("Watching lets go of the claim, and says nothing", async () => {
    const t = await room(seats(), { views: [["A", "alice"], ["B", "bob"]] });
    await t.pick("A", "p1");
    await t.pick("A", "");
    expect([t.claim("p1"), t.player("p1")]).toEqual([null, null]);
    expect(t.w.sent.map((s) => s.type)).toEqual(["sat"]);
    expect(t.options("B")[1]).toBe("Player 1");
    t.w.done();
  });

  it("a name tag over each hand: its seat, who sits there, and whether they're here", async () => {
    const t = await room(seats(ANA, BEN), { views: [["A", ANA], ["C", "carol"]] });
    const tags = () => t.w.view("C").labels.map(({ key, text, position, data }) => ({ key, text, position, state: data.state }));
    expect(tags()).toEqual([
      // on each tray, in the world (these seats have no camera to say which edge is theirs: the middle)
      { key: "hand1", text: "Player 1 · Ana", position: [0, 0, 0.5], state: "taken" },
      { key: "hand2", text: "Player 2 · Ben (away)", position: [0, 0, -0.5], state: "away" },
    ]);
    expect(t.w.view("A").labels[0].text).toBe("Player 1 · Ana");
    await t.pick("A", "");
    expect(tags().map((x) => x.text)).toEqual(["Player 1 · free", "Player 2 · Ben (away)"]);
    // and what peers say comes from them by name
    t.x.C.receive("sat", { seat: "p2" }, { session: "B", viewer: BEN });
    expect(t.notices("C").at(-1)).toBe("Ben sat down as Player 2");
    t.w.done();
  });
});

describe("telling the others", () => {
  afterEach(() => vi.useRealTimers());
  /** Alice in p1 and Bob in p2 at a table with a two-card pile (faceDown, under2) of a plain deck; each view's extension attached. */
  async function table({ seated = seats("alice", "bob") } = {}) {
    const doc = sceneOf({ ...objects(), under2: { name: "Card", transform: T([0.3, 0.0005, 0], [0, 0.4, Math.PI]), traits: hidden } }, { [SEATS]: seated });
    const repo = fakes.fakeRepo();
    const faces = Object.fromEntries(["inHand1", "inHand2Flipped", "faceUp", "faceDown", "onTray", "under2"].map((id) => [id, { sourceUrl: `automerge:face-${id}`, name: `Face of ${id}` }]));
    repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: faces }, DECK);
    const w = fakes.fakeWorld(doc, { repo });
    const a = w.join("A", { viewer: "alice" });
    const b = w.join("B", { viewer: "bob" });
    const xa = w.attach("A", Extension.create(a));
    const xb = w.attach("B", Extension.create(b));
    w.flush();
    await vi.advanceTimersByTimeAsync(10);
    return { w, a, b, xa, xb, notices: (s) => w.view(s).notices.map((n) => n.text) };
  }

  it("Shuffle is on the use prompt, and on the menu and inspector", () => {
    const m = mount();
    const shuffle = m.x.commands.find((c) => c.id === "shuffle");
    expect(shuffle.show).toEqual(expect.arrayContaining(["use", "menu", "inspector"]));
  });

  it("a shuffle is sent once, as the deck and a count, and the others hear who did it", async () => {
    const t = await table();
    t.xa.commands.find((c) => c.id === "shuffle").run("faceDown");
    expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "shuffled", data: { deck: DECK, n: 2 } }]);
    expect(t.notices("A")).toEqual(["Shuffling 2 cards…"]);
    expect(t.notices("B")).toEqual(["Player 1 shuffled the deck (2)"]);
    t.w.done();
  });

  it("sitting down is sent as the seat id", async () => {
    const t = await table({ seated: seats("alice", null) });
    const select = t.w.view("A").overlay.querySelector(".tabletop-seat");
    select.value = "p2";
    select.dispatchEvent(new Event("change"));
    expect(t.w.doc.traits[SEATS].p2.player).toBe("alice");
    expect(t.w.sent).toEqual([expect.objectContaining({ type: "sat", data: { seat: "p2" } })]);
    expect(t.notices("A")).toEqual(["You sat down as Player 2"]);
    expect(t.notices("B").at(-1)).toMatch(/sat down as Player 2$/);
    // watching says nothing
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(t.w.sent).toHaveLength(1);
    t.w.done();
  });

  it("receives only what it knows, in the shape it expects", async () => {
    const t = await table();
    const from = (viewer) => ({ session: `s-${viewer}`, viewer });
    for (const [type, data] of [
      ["nope", { n: 1 }],
      ["toString", {}],
      ["shuffled", { deck: 5, n: 2 }],
      ["shuffled", { deck: DECK, n: -1 }],
      ["sat", { seat: "p9" }],
      ["sat", null],
      ["drew", { n: 1.5 }],
      ["drew", "1"],
      ["rolled", { value: 0 }],
      ["rolled", {}],
      ["rolled", { value: 4 }], // which die: it's checked against the doc (rolling a die, below)
      ["rolled", { die: "nope", value: 4 }], // no such die
      ["rolled", { die: "board", value: 4 }], // not a die
    ]) t.xb.receive(type, data, from("alice"));
    expect(t.notices("B")).toEqual([]);
    t.xb.receive("drew", { n: 1 }, from("alice"));
    t.xb.receive("drew", { n: 2 }, from("carol"));
    t.xb.receive("sat", { seat: "p1" }, from("carol"));
    t.xb.receive("shuffled", { deck: DECK, n: 44 }, from("alice"));
    expect(t.notices("B")).toEqual(["Player 1 drew a card", "Someone drew 2 cards", "Someone sat down as Player 1", "Player 1 shuffled the deck (44)"]);
    t.w.done();
  });

  it("never sends which card is which", async () => {
    const t = await table({ seated: seats("alice", null) });
    t.xa.commands.find((c) => c.id === "shuffle").run("faceDown");
    const select = t.w.view("A").overlay.querySelector(".tabletop-seat");
    select.value = "p2";
    select.dispatchEvent(new Event("change"));
    expect(t.w.sent.map((s) => s.type)).toEqual(["shuffled", "sat"]);
    const wire = JSON.stringify(t.w.sent.map((s) => s.data));
    expect(wire).not.toMatch(/sourceUrl|face-|Face of/);
    t.w.done();
  });

  it("a plain deck at a table with hands: every view is told, each time it opens, that hands aren't secret", async () => {
    // (as the Lost Cities template leaves a table where no secure deck is installed)
    const t = await table();
    expect(t.xa.hud()).toEqual([{ text: PLAIN_HANDS, state: "info" }]);
    expect(t.xb.hud()).toEqual([{ text: PLAIN_HANDS, state: "info" }]);
    // a view that opens it later hears it too
    const c = t.w.join("C", { viewer: "carol" });
    const xc = t.w.attach("C", Extension.create(c));
    t.w.flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(xc.hud()).toEqual([{ text: PLAIN_HANDS, state: "info" }]);
    t.w.done();
  });

  it("a plain deck at a table without hands (a TTS import) says nothing", async () => {
    const repo = fakes.fakeRepo();
    repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: { a: { sourceUrl: "automerge:x", name: "A" } } }, DECK);
    const w = fakes.fakeWorld(sceneOf({ a: { name: "Card", transform: T([0, 0.001, 0], [0, 0, Math.PI]), traits: hidden } }), { repo });
    const x = w.attach("A", Extension.create(w.join("A", { viewer: "alice" })));
    w.flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(x.hud()).toEqual([]);
    w.done();
  });

  it("a deck's status is news, not trouble: info, and error only for a problem", async () => {
    const registry = {
      filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
      load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map(), status: () => "Waiting for 2 players" }) } }),
    };
    const m = mount({ deckType: "secure-deck", registries: { "tabletop:deck": registry } });
    m.x.update(m.api.scene());
    await settle();
    expect(m.x.hud()).toEqual([{ text: "Waiting for 2 players", state: "info" }]);
  });
});

describe("a deck dropped on the table", () => {
  const card = { min: [-0.028, 0, -0.0435], max: [0.028, 0.001, 0.0435] };
  const registry = {
    filter: (fn) => [{ id: "sd", supportedDatatypes: ["secure-deck"] }].filter(fn),
    load: async () => ({ module: { createResolver: () => ({ update() {}, looks: () => new Map() }), placement: () => ({ name: "Deck", count: 3, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: card }), bind() {} } }),
  };
  const url = "automerge:2SecureSecureSecureSecure9";
  /** Drop it with `at`, on a table with a turned mat (yaw 0.5) at x = 0.5; → its cards, bottom first. */
  async function dropAt(at, content) {
    const m = mount({ registries: { "tabletop:deck": registry } });
    m.api.change((d) => (d.objects.mat = { name: "Mat", transform: T([0.5, 0, 0], [0, 0.5, 0]) }));
    const ctx = { ...m.api, ...(content ? { content: (id) => content[id] ?? null } : {}) };
    expect(await Extension.drop(ctx, { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {}, at })).toBe(true);
    const cards = Object.values(m.doc.objects).filter((o) => o.traits?.[HIDDEN]?.by === url);
    return { m, cards: cards.sort((p, q) => p.transform.position[1] - q.transform.position[1]) };
  }

  it("with no point, stacks at the table's origin, face down and tagged as cards", async () => {
    const { cards } = await dropAt(null);
    expect(cards.map((c) => c.transform.position)).toEqual([[0, 0.001, 0], [0, 0.002, 0], [0, 0.003, 0]]);
    for (const c of cards) {
      expect(c.transform.rotation).toEqual([0, 0, Math.PI]);
      expect(c.tags).toEqual(["card"]);
    }
  });

  it("stacks where it was dropped", async () => {
    const { cards } = await dropAt({ point: [0.1, 0.02, -0.2], hitId: null });
    expect(cards.map((c) => c.transform.position)).toEqual([[0.1, 0.021, -0.2], [0.1, 0.022, -0.2], [0.1, 0.023, -0.2]]);
  });

  it("squares onto a card slot within reach, turned its way", async () => {
    const content = { mat: { extras: { connectors: [{ position: [0.1, 0.01, 0], yaw: 0.3, tags: ["card"] }, { position: [0, 0, 0], yaw: null, tags: [] }], snapRadius: 0.05 } } };
    const m0 = mount();
    m0.api.change((d) => (d.objects.mat = { name: "Mat", transform: T([0.5, 0, 0], [0, 0.5, 0]) }));
    const w = m0.api.scene().world("mat");
    const slot = [w[0] * 0.1 + w[4] * 0.01 + w[12], 0, w[2] * 0.1 + w[6] * 0.01 + w[14]];
    const { cards } = await dropAt({ point: [slot[0] + 0.02, 0.004, slot[2] - 0.01], hitId: "mat" }, content);
    for (const [j, c] of cards.entries()) {
      expect(c.transform.position[0]).toBeCloseTo(slot[0], 5);
      expect(c.transform.position[2]).toBeCloseTo(slot[2], 5);
      expect(c.transform.position[1]).toBeCloseTo(0.004 + (j + 1) * 0.001, 6);
      expect(c.transform.rotation[1]).toBeCloseTo(0.8, 5);
      expect(c.transform.rotation[2]).toBe(Math.PI);
    }
  });

  it("ignores slots that don't take cards, and ones out of reach", async () => {
    const content = { mat: { extras: { connectors: [{ position: [0, 0, 0], tags: [] }, { position: [0.01, 0, 0], tags: ["pawn"] }, { position: [0.3, 0, 0], tags: ["card"] }], snapRadius: 0.05 } } };
    const { cards } = await dropAt({ point: [0.5, 0.004, 0], hitId: "mat" }, content);
    for (const c of cards) {
      expect(c.transform.position[0]).toBe(0.5);
      expect(c.transform.position[2]).toBe(0);
      expect(c.transform.rotation).toEqual([0, 0, Math.PI]);
    }
  });

  it("never into a hand: a slot in a private zone is passed over, and a drop in one is refused", async () => {
    const m = mount({ registries: { "tabletop:deck": registry } });
    const ctx = (content) => ({ ...m.api, content: (id) => content[id] ?? null });
    // hand1 (p1's zone, at z = 0.5) has two card slots: one inside its zone, one just outside it (a deck spot beside the hand)
    const content = { hand1: { extras: { connectors: [{ position: [0, 0.002, -0.04], yaw: 0, tags: ["card"] }, { position: [0, 0.002, -0.12], yaw: 0.2, tags: ["card"] }], snapRadius: 0.1 } } };
    const before = Object.keys(m.doc.objects).length;
    // dropped on the hand itself: refused, nothing written
    expect(await Extension.drop(ctx(content), { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {}, at: { point: [0.01, 0.002, 0.5], hitId: "hand1" } })).toBe(true);
    expect(Object.keys(m.doc.objects)).toHaveLength(before);
    expect(m.calls.toasts.at(-1)).toEqual(["Drop the deck on the table, not in a hand.", "error"]);
    // dropped beside it: the slot outside the zone, though the one inside is nearer
    expect(await Extension.drop(ctx(content), { url, doc: { "@patchwork": { type: "secure-deck" } }, handle: {}, at: { point: [0, 0.002, 0.44], hitId: "hand1" } })).toBe(true);
    const cards = Object.values(m.doc.objects).filter((o) => o.traits?.[HIDDEN]?.by === url);
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.transform.position[2]).toBeCloseTo(0.38, 6);
      expect(c.transform.rotation[1]).toBeCloseTo(0.2, 6);
    }
    const s = m.api.scene();
    expect(cards.every((c) => seatAt(s, zones(s), c.transform.position) == null)).toBe(true);
  });

  it("uses the point while what it hit hasn't loaded", async () => {
    const { cards } = await dropAt({ point: [0.5, 0.004, 0], hitId: "mat" }, {});
    expect(cards[0].transform.position).toEqual([0.5, 0.005, 0]);
  });
});

describe("drawing to your hand", () => {
  afterEach(() => vi.useRealTimers());
  const card = (position, rotation = [0, 0.4, Math.PI]) => ({ name: "Card", transform: T(position, rotation), traits: hidden, tags: ["card"] });
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
   * the table, of a plain deck that knows every card's face.
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
    const repo = fakes.fakeRepo();
    const faces = Object.fromEntries(["kept", "low", "mid", "top"].map((id) => [id, { sourceUrl: `automerge:face-${id}`, name: `Face of ${id}` }]));
    repo.add({ "@patchwork": { type: "plain-deck" }, title: "Deck", objects: faces }, DECK);
    const w = fakes.fakeWorld(doc, { repo, content });
    const a = w.join("A", { viewer: "alice", local });
    const b = w.join("B", { viewer: "bob" });
    const xa = w.attach("A", Extension.create(a));
    const xb = w.attach("B", Extension.create(b));
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

  it("applies to a hidden card out on the table, while playing, for someone seated with room in their hand", async () => {
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
    const doc = sceneOf({ a: { name: "Card", transform: T([0, 0.001, 0], [0, 0, Math.PI]), traits: hidden } });
    const w = fakes.fakeWorld(doc);
    const api = w.join("A", { viewer: "alice" });
    const x = w.attach("A", Extension.create(api));
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
    expect(t.notices("B")).toEqual(["Player 1 drew a card"]);
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

  it("with a plain deck, only the drawer sees what they drew", async () => {
    const t = await table();
    expect(t.xa.looks().has("top")).toBe(false);
    t.draw("top");
    t.w.tick(1 / 60, 30);
    t.w.flush();
    expect(t.xa.looks().get("top")).toEqual({ sourceUrl: "automerge:face-top", name: "Face of top" });
    // face up in A's hand: to B, the privacy face (privacy.js), never its face or its name
    expect(t.xb.looks().get("top")?.name).toBeUndefined();
    expect(t.xb.looks().get("top")?.sourceUrl ?? null).not.toMatch(/face-/);
    // and nothing on the wire says which card it was
    expect(JSON.stringify(t.w.sent)).not.toMatch(/face-|Face of|top/);
    t.w.done();
  });
});

describe("rolling a die", () => {
  afterEach(() => vi.useRealTimers());
  const BOUNDS = { min: [-0.008, 0, -0.008], max: [0.008, 0.016, 0.008] };
  const die = (o = {}) => ({ name: "Die", transform: T([0.1, 0, 0.2], [0, 0.3, 0]), hint: { bounds: BOUNDS }, traits: { [DIE]: {} }, ...o });
  /** A table with a die, a pawn, and Player 1 (alice) and Player 2 (bob) seated; A is alice, B is bob. */
  function table({ objects = {}, local = {} } = {}) {
    const doc = sceneOf({ d1: die(), pawn: { name: "Pawn", transform: T([0, 0, 0]) }, ...objects }, { [SEATS]: seats("alice", "bob") });
    const w = fakes.fakeWorld(doc);
    const a = w.join("A", { viewer: "alice", local });
    const b = w.join("B", { viewer: "bob" });
    const xa = w.attach("A", Extension.create(a));
    const xb = w.attach("B", Extension.create(b));
    w.flush();
    const writes = [];
    const change = a.change;
    a.change = (fn) => (writes.push(fn), change(fn));
    const rollOf = (x) => x.commands.find((c) => c.id === "roll");
    const state = (x, id, api = x === xa ? a : b) => rollOf(x).state(id, { scene: api.scene(), local: api.local.get() });
    const frames = Math.ceil(ROLL_SECONDS * 60) + 2;
    return { w, a, b, xa, xb, doc, writes, rollOf, state, frames, roll: (id = "d1", x = xa) => rollOf(x).run(id), notices: (s) => w.view(s).notices.map((n) => n.text) };
  }
  const centre = (t) => {
    const c = eulerMatrix(t.rotation).map((r) => r[0] * 0 + r[1] * 0.008 + r[2] * 0);
    return t.position.map((v, i) => v + c[i]);
  };

  it("is R, on the use prompt and the menu", () => {
    const t = table();
    expect(t.rollOf(t.xa)).toMatchObject({ key: "r", name: "Roll" });
    expect(t.rollOf(t.xa).show).toEqual(["use", "menu"]);
    t.w.done();
  });

  it("back in play after editing with Rotate (R) or Move (G), the hand is the tool again", () => {
    const t = table({ local: { tool: "rotate", activities: { current: "edit", available: ["play", "edit"] } } });
    t.w.flush();
    expect(t.a.local.get().tool).toBe("rotate"); // editing: left alone
    t.a.local.swap((m) => ({ ...m, activities: { ...m.activities, current: "play" } }));
    t.w.flush();
    expect(t.a.local.get().tool).toBe("hand");
    t.a.local.swap((m) => ({ ...m, tool: "move" }));
    t.w.flush();
    expect(t.a.local.get().tool).toBe("hand");
    t.w.done();
  });

  it("applies to a die in play only: never while editing (R is the gizmo's Rotate there), nor to anything that isn't a die or is locked", () => {
    const t = table({ objects: { locked: die({ locked: true }) } });
    expect(t.state(t.xa, "d1")).toEqual({ title: "Roll the die (R)" });
    expect(t.state(t.xa, "pawn")).toBeNull();
    expect(t.state(t.xa, "locked")).toBeNull();
    expect(t.state(t.xa, null)).toBeNull();
    const edit = { ...t.a.local.get(), activities: { current: "edit", available: ["play", "edit"] } };
    expect(t.rollOf(t.xa).state("d1", { scene: t.a.scene(), local: edit })).toBeNull();
    t.w.done();
  });

  it("tumbles it in the air for everyone, then writes where it landed once, lets go landed and tells everyone what it shows", () => {
    const t = table();
    const before = structuredClone(t.doc.objects.d1.transform);
    t.roll();
    expect(t.state(t.xa, "d1")).toMatchObject({ disabled: true });
    t.w.tick(1 / 60, 18); // about half way
    const mid = t.w.holds.get("d1");
    expect(mid.session).toBe("A");
    expect(centre(mid.transform)[1]).toBeGreaterThan(centre(before)[1] + 0.03);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform).toEqual(before);
    t.w.tick(1 / 60, t.frames);
    expect(t.writes).toHaveLength(1);
    const to = t.doc.objects.d1.transform;
    const value = faceUp(to.rotation).value;
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
    // it lands on its side, its middle as high as before, near where it was
    expect(centre(to)[1]).toBeCloseTo(centre(before)[1], 5);
    expect(Math.hypot(to.position[0] - before.position[0], to.position[2] - before.position[2])).toBeLessThan(0.03);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: true }]);
    expect(t.w.sent).toEqual([{ session: "A", viewer: "alice", type: "rolled", data: { die: "d1", value } }]);
    expect(t.notices("A")).toEqual([`You rolled ${value}`]);
    expect(t.notices("B")).toEqual([`Player 1 rolled ${value}`]);
    // nothing else is written: no seats, no traits
    expect(t.doc.traits).toEqual({ [SEATS]: seats("alice", "bob") });
    expect(t.doc.objects.d1.traits).toEqual({ [DIE]: {} });
    t.w.done();
  });

  it("lands as the seed it drew says", () => {
    const t = table();
    vi.spyOn(Math, "random").mockReturnValue(0.25);
    const from = structuredClone(t.doc.objects.d1.transform);
    t.roll();
    vi.mocked(Math.random).mockRestore();
    t.w.tick(1 / 60, t.frames);
    const plan = rollPlan(Math.floor(0.25 * 2 ** 32), { from, pivot: [0, 0.008, 0] });
    expect(t.doc.objects.d1.transform).toEqual(plan.to);
    expect(t.w.sent[0].data).toEqual({ die: "d1", value: plan.value });
    t.w.done();
  });

  it("reads the faces its trait gives", () => {
    const faces = { "+y": 12, "-y": 13 };
    const t = table({ objects: { d1: die({ traits: { [DIE]: { faces } } }) } });
    t.roll();
    t.w.tick(1 / 60, t.frames);
    const v = t.w.sent[0].data.value;
    expect([12, 13]).toContain(v);
    expect(faceUp(t.doc.objects.d1.transform.rotation, faces).value).toBe(v);
    t.w.done();
  });

  it("on a tilted board, lands with the side it names facing the world's up", () => {
    const t = table({ objects: { board: { name: "Board", transform: T([0, 0.1, 0], [0.4, 0.9, -0.2]) }, d1: die({ parent: "board", transform: T([0.05, 0.02, 0], [0, 0, 0]) }) } });
    t.roll();
    t.w.tick(1 / 60, t.frames);
    const value = t.w.sent[0].data.value;
    const m = fakes.multiply(fakes.composeMatrix(t.doc.objects.board.transform), fakes.composeMatrix(t.doc.objects.d1.transform));
    // which local axis points most nearly up in the world: the matrix's second row
    const rows = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    expect(faceUp(rows).value).toBe(value);
    t.w.done();
  });

  it("pressing R again while it's rolling doesn't roll it twice", () => {
    const t = table();
    t.roll();
    t.w.tick(1 / 60, 5);
    t.roll();
    t.w.tick(1 / 60, t.frames * 2);
    expect(t.writes).toHaveLength(1);
    expect(t.w.sent).toHaveLength(1);
    t.w.done();
  });

  it("a die a peer is holding can't be rolled", () => {
    const t = table();
    t.b.pose.hold("d1", t.doc.objects.d1.transform);
    expect(t.state(t.xa, "d1")).toEqual({ disabled: true, title: "Someone has that die" });
    t.roll();
    t.w.tick(1 / 60, t.frames);
    expect(t.writes).toHaveLength(0);
    expect(t.w.sent).toHaveLength(0);
    expect(t.notices("A")).toEqual(["Someone has that die"]);
    t.w.done();
  });

  it("a peer who catches it mid-roll has it: no write, nothing told", () => {
    const t = table();
    t.roll();
    t.w.tick(1 / 60, 10);
    // B grabs it first as the stage sees it (its hold is the one that counts)
    t.w.holds.set("d1", { session: "B", transform: structuredClone(t.doc.objects.d1.transform), at: Date.now() - 1 });
    t.w.tick(1 / 60, t.frames);
    expect(t.writes).toHaveLength(0);
    expect(t.w.sent).toHaveLength(0);
    expect(t.w.released).toEqual([{ session: "A", id: "d1", landed: false }]);
    t.w.done();
  });

  it("a die a peer moved in the doc mid-roll is left where they put it", () => {
    const t = table();
    t.roll();
    t.w.tick(1 / 60, 10);
    t.b.change((d) => (d.objects.d1.transform.position = [0.4, 0, 0.4]));
    t.w.tick(1 / 60, t.frames);
    expect(t.writes).toHaveLength(0);
    expect(t.doc.objects.d1.transform.position).toEqual([0.4, 0, 0.4]);
    expect(t.w.sent).toHaveLength(0);
    t.w.done();
  });

  it("stops rolling when the table goes", () => {
    const t = table();
    t.roll();
    t.w.tick(1 / 60, 5);
    t.xa.dispose();
    expect(t.w.view("A").loops).toHaveLength(0);
    t.w.done();
  });

  it("a peer's roll is told only as the die shows it in the doc, and only when the doc moved it", () => {
    const t = table();
    const from = { session: "A", viewer: "alice" };
    const shows = () => faceUp(t.doc.objects.d1.transform.rotation).value;
    // the die hasn't moved: a "roll" of it is nobody's word to take
    t.xb.receive("rolled", { die: "d1", value: shows() }, from);
    vi.advanceTimersByTime(4000);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // put down by hand on a side, then "announced" after the moment has passed: still nothing
    t.a.change((d) => (d.objects.d1.transform.rotation = [Math.PI / 2, 0, 0]));
    t.w.flush();
    vi.advanceTimersByTime(4000);
    t.xb.receive("rolled", { die: "d1", value: shows() }, from);
    expect(t.notices("B")).toEqual([]);
    // the doc moved it just now, but to another side than they say
    t.a.change((d) => (d.objects.d1.transform.rotation = [0, 0, 0]));
    const lie = shows() === 6 ? 5 : 6;
    t.xb.receive("rolled", { die: "d1", value: lie }, from);
    t.w.flush();
    expect(t.notices("B")).toEqual([]);
    // the message first, the doc after (they travel apart): told when the doc lands it
    t.xb.receive("rolled", { die: "d1", value: 6 }, from);
    expect(t.notices("B")).toEqual([]);
    t.a.change((d) => (d.objects.d1.transform.rotation = [Math.PI, 0, 0]));
    t.w.flush();
    expect(t.notices("B")).toEqual(["Player 1 rolled 6"]);
    t.w.done();
  });

  it("a number past the highest a side may show (dice.js MAX_FACE) isn't heard", () => {
    const t = table({ objects: { d1: die({ traits: { [DIE]: { faces: { "+y": MAX_FACE, "-y": 2 } } } }) } });
    t.a.change((d) => (d.objects.d1.transform.rotation = [0, 0, 0]));
    t.xb.receive("rolled", { die: "d1", value: MAX_FACE + 1 }, { session: "A", viewer: "alice" });
    expect(t.notices("B")).toEqual([]);
    t.a.change((d) => (d.objects.d1.transform.rotation = [0, 0, 1e-3]));
    t.xb.receive("rolled", { die: "d1", value: MAX_FACE }, { session: "A", viewer: "alice" });
    expect(t.notices("B")).toEqual([`Player 1 rolled ${MAX_FACE}`]);
    t.w.done();
  });

  it("a scene that became a table by a part (a die alone, no view.tool): in play, the hand is the tool", () => {
    const doc = sceneOf({ d1: die() });
    const w = fakes.fakeWorld(doc);
    const a = w.join("A", { viewer: "alice" });
    w.attach("A", Extension.create(a));
    expect(a.local.get().tool).toBeUndefined(); // the stage's default, Move, is in force
    w.flush();
    expect(a.local.get().tool).toBe("hand");
    // a doc that suggests the hand already: nothing to do
    const doc2 = sceneOf({ d1: die() }, {}, { view: { ...emptyScene().view, tool: "hand" } });
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

  it("a die alone (no seats) still rolls, and the peer is told by someone", () => {
    const doc = sceneOf({ d1: die() });
    const w = fakes.fakeWorld(doc);
    const a = w.join("A", { viewer: "alice" });
    const b = w.join("B", { viewer: "bob" });
    const xa = w.attach("A", Extension.create(a));
    w.attach("B", Extension.create(b));
    w.flush();
    xa.commands.find((c) => c.id === "roll").run("d1");
    w.tick(1 / 60, Math.ceil(ROLL_SECONDS * 60) + 2);
    const v = w.sent[0].data.value;
    expect(w.view("B").notices.map((n) => n.text)).toEqual([`Someone rolled ${v}`]);
    expect(doc.traits).toEqual({});
    w.done();
  });
});
