// The plain keeper against a stand-in for the stage: the looks it gives for
// what the stage says of each object, its HUD, the `keeper` convention, and
// `contain`.
import { describe, it, expect, vi, afterEach } from "vitest";
import Keeper, { TRAIT, contain, openly, openlyAll } from "./plain-keeper.js";
import { plugins } from "../index.js";
import { newPlain } from "./plain.js";

afterEach(() => vi.restoreAllMocks());

const settle = () => new Promise((r) => setTimeout(r, 0));
const FACES = Array.from({ length: 4 }, (_, i) => ({ sourceUrl: `automerge:face${i}`, name: `Card ${i}` }));

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
      listeners,
    };
    handles.set(url, h);
    return h;
  };
  const next = () => `automerge:2Doc${"abcdefghijk"[n++]}abcdefghijkmnopqrstuv`;
  return {
    handles,
    add: (doc, url = next()) => make(url, structuredClone(doc)),
    create2: async (doc) => make(next(), structuredClone(doc)),
    async find(url) {
      const h = handles.get(url);
      if (!h) throw new Error("unavailable");
      return h;
    },
  };
}

/** A scene of four kept cards, and a stage that answers audience and shown from a table the test fills. */
async function mount({ viewer = "me", doc = newPlain({ title: "Deck", items: FACES }), repo = fakeRepo(), objects: n = FACES.length } = {}) {
  const deck = repo.add(doc);
  const objects = Object.fromEntries(Array.from({ length: n }, (_, k) => [`c${k}`, { name: "Card", sourceUrl: "automerge:back", traits: { [TRAIT]: { by: deck.url, slot: k } } }]));
  const said = { audience: {}, shown: {} };
  const api = {
    repo,
    channel: { viewer },
    settled: () => ({ ready: true, missing: [] }),
    // scene.audience as the test says, and what the keeper displays
    use: (n) => (n === "audience" ? { audience: (id) => (id in said.audience ? said.audience[id] : []), shown: (id) => (id in said.shown ? said.shown[id] : (said.audience[id] ?? [])), veil: () => () => {} } : null),
    display: () => () => {},
    notify() {},
  };
  const x = Keeper.create(api);
  const t = { x, api, deck, objects, said, repo, update: () => x.update({ objects }) };
  t.update();
  await settle();
  t.update();
  return t;
}

describe("the plain keeper", () => {
  it("shows each object by the rule: the item, the veil, or nothing (its own back)", async () => {
    const t = await mount();
    t.said.audience = { c0: "all", c1: ["me"], c2: ["you"], c3: ["you"] };
    t.said.shown = { c0: "all", c1: ["me"], c2: ["you"], c3: "all" };
    t.update();
    expect([...t.x.showing()]).toEqual([
      ["c0", FACES[0]], // face up on the table
      ["c1", FACES[1]], // in my hand
      // c2: in someone else's hand: its back, no look
      ["c3", { veil: true }], // face up behind their screen
    ]);
  });

  it("a face named by its game is drawn when it's first shown here, and not before: in someone else's hand, or face down, it isn't", async () => {
    // a table set up from a game page: each item names the game and the kind (setup.js faceOf)
    const repo = fakeRepo();
    const box = (color) => [{ shape: "box", size: [0.05, 0.001, 0.07], color }];
    const game = repo.add({ pieces: { back: { name: "Back", parts: box("#203040") }, x: { name: "X", parts: box("#ff0000"), back: "back" }, y: { name: "Y", parts: box("#00ff00"), back: "back" } }, drawn: {} });
    const items = [{ game: game.url, kind: "x", name: "X" }, { game: game.url, kind: "y", name: "Y" }];
    const t = await mount({ repo, doc: newPlain({ title: "Deck", items }), objects: 2 });
    const shown = new Map(); // id → what this viewer's client displays for it
    const log = [];
    t.api.display = (id, o) => (log.push([id, o.content instanceof Uint8Array ? "bytes" : (o.content ?? null)]), shown.set(id, o), () => shown.get(id) === o && shown.delete(id));
    // c0 in someone else's hand, c1 face down: nothing drawn
    t.said.audience = { c0: ["you"], c1: [] };
    t.update();
    await settle();
    expect(game.doc().drawn).toEqual({});
    expect(shown.size).toBe(0);
    // c1 dealt to me: its name at once, its face from the bytes drawn here, then its doc once its sheet
    // (every face of it, here both) is kept in the game
    t.said.audience = { c0: ["you"], c1: ["me"] };
    t.update();
    expect(shown.get("c1")).toEqual({ name: "Y" });
    for (let i = 0; i < 1000 && typeof shown.get("c1")?.content !== "string"; i++) await settle();
    expect(Object.keys(game.doc().drawn).sort()).toEqual(["x", "y"]);
    expect(log).toEqual([["c1", null], ["c1", "bytes"], ["c1", game.doc().drawn.y.url]]);
    // c0 shown to me later: the doc the game has, nothing drawn again
    const url = game.doc().drawn.x.url;
    t.said.audience = { c0: "all", c1: ["me"] };
    t.update();
    for (let i = 0; i < 1000 && !shown.get("c0")?.content; i++) await settle();
    expect(shown.get("c0")).toEqual({ name: "X", content: url });
  });

  it("unknown (a listed package missing): no look for anything, even what would be mine", async () => {
    const t = await mount();
    t.said.audience = { c0: null, c1: null, c2: null, c3: null };
    t.said.shown = { c0: null, c1: null, c2: null, c3: null };
    t.update();
    expect(t.x.showing().size).toBe(0);
  });

  it("before its container has loaded, and for one it can't read: closed, and the HUD says why", async () => {
    const repo = fakeRepo();
    const api = { repo, channel: { viewer: "me" }, settled: () => ({ ready: true, missing: [] }), use: (n) => (n === "audience" ? { audience: () => "all", shown: () => "all", veil: () => () => {} } : null), display: () => () => {}, notify() {} };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const x = Keeper.create(api);
    const gone = "automerge:2GoneGoneGoneGoneGoneGone1";
    const bad = repo.add({ items: FACES, at: [0, 0, 1, 2] });
    const objects = { a: { traits: { [TRAIT]: { by: gone, slot: 0 } } }, b: { traits: { [TRAIT]: { by: bad.url, slot: 0 } } } };
    x.update({ objects });
    expect(x.showing().size).toBe(0);
    await settle();
    x.update({ objects });
    expect(x.showing().size).toBe(0);
    expect(x.hud().map((h) => h.state)).toEqual(["error", "error"]);
    expect(x.keeper.shuffle(["b"])).toBe(0);
  });

  it("a container's line learned after the update (it loaded, or failed to) is told to the notices, so the HUD shows it", async () => {
    const repo = fakeRepo();
    const told = [];
    let x = null;
    // scene.notices: what it would draw when told the lines changed (it reads every hud then)
    const notices = { notify() {}, changed: () => told.push(x.hud().map((h) => h.state)) };
    const api = { repo, channel: { viewer: "me" }, settled: () => ({ ready: true, missing: [] }), use: (n) => (n === "audience" ? { audience: () => "all", shown: () => "all", veil: () => () => {} } : n === "notices" ? notices : null), display: () => () => {} };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    x = Keeper.create(api);
    const gone = "automerge:2GoneGoneGoneGoneGoneGone1";
    x.update({ objects: { a: { traits: { [TRAIT]: { by: gone, slot: 0 } } } } });
    expect(x.hud()).toEqual([]);
    await settle();
    // no update since: only changed() lets the HUD know
    expect(x.hud().map((h) => h.state)).toEqual(["error"]);
    expect(told.at(-1)).toEqual(["error"]);
  });

  it("two objects naming one slot: the lower id keeps it, the other stays closed and is flagged", async () => {
    const t = await mount();
    t.objects.c9 = { traits: { [TRAIT]: { by: t.deck.url, slot: 0 } } };
    t.said.audience = { c0: "all", c9: "all" };
    t.update();
    expect([...t.x.showing().keys()]).toEqual(["c0"]);
    expect(t.x.keeper.of("c9")).toBeNull();
    expect(t.x.hud().at(-1)).toMatchObject({ state: "error" });
  });

  it("says, at every scene that uses one, that it isn't secret", async () => {
    const t = await mount();
    expect(t.x.hud()).toEqual([{ text: openly("Deck"), state: "info" }]);
  });

  it("says it once for a scene with several containers, not once each", async () => {
    const t = await mount();
    for (let n = 2; n <= 5; n++) {
      const more = t.repo.add(newPlain({ title: `Deck ${n}`, items: ["x"] }));
      t.objects[`m${n}`] = { name: "Card", sourceUrl: "automerge:back", traits: { [TRAIT]: { by: more.url, slot: 0 } } };
      t.update();
      await settle();
      t.update();
      expect(t.x.hud()).toEqual([{ text: openlyAll(n), state: "info" }]);
    }
  });

  it("the keeper convention: which container, its name, and a shuffle of what the objects are", async () => {
    const t = await mount();
    const k = t.x.keeper;
    expect(k.kind).toBe("plain");
    expect(k.of("c2")).toBe(t.deck.url);
    expect(k.of("nope")).toBeNull();
    expect(k.name(t.deck.url)).toBe("Deck");
    expect(k.shuffle(["c1"])).toBe(0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(k.shuffle(["c0", "c1", "c2", "nope"])).toBe(3);
    const at = t.deck.doc().at;
    expect(at[3]).toBe(3);
    expect([...at].sort()).toEqual([0, 1, 2, 3]);
    expect(at.slice(0, 3)).not.toEqual([0, 1, 2]);
    t.said.audience = { c0: "all" };
    t.update();
    expect(t.x.showing().get("c0")).toEqual(FACES[at[0]]);
    // the scene doc was never touched: the binding is the object's, the order the container's
    expect(t.objects.c0.traits[TRAIT]).toEqual({ by: t.deck.url, slot: 0 });
  });

  it("stops listening when it stops", async () => {
    const t = await mount();
    expect(t.deck.listeners.size).toBe(1);
    t.x.dispose();
    expect(t.deck.listeners.size).toBe(0);
  });
});

describe("contain", () => {
  it("makes a container holding item k in slot k, and binds an object to a slot by this keeper's trait", async () => {
    const repo = fakeRepo();
    const { key, bind } = await contain({ repo }, { title: "Lost Cities: Deck", items: FACES });
    const doc = repo.handles.get(key).doc();
    expect(doc).toEqual(newPlain({ title: "Lost Cities: Deck", items: FACES }));
    expect(bind(2)).toEqual({ [TRAIT]: { by: key, slot: 2 } });
  });
});

describe("the plugin", () => {
  const p = plugins.find((x) => x.id === "keep.plain");
  it("is an ordinary scene extension, found by `keeper`, run by its own trait", () => {
    expect(p).toMatchObject({ type: "scene:extension", keeper: "plain", traits: [TRAIT] });
    for (const k of ["activities", "requires", "always", "general"]) expect(k in p).toBe(false);
  });
});
