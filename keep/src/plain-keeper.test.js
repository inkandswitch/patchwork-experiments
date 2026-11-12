// The plain keeper against a stand-in for the stage: the looks it gives for
// what the stage says of each object, its HUD, the `keeper` convention, and
// `contain`.
import { describe, it, expect, vi, afterEach } from "vitest";
import Keeper, { TRAIT, contain, openly } from "./plain-keeper.js";
import { plugins } from "./index.js";
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
async function mount({ viewer = "me", doc = newPlain({ title: "Deck", items: FACES }) } = {}) {
  const repo = fakeRepo();
  const deck = repo.add(doc);
  const objects = Object.fromEntries(FACES.map((_, k) => [`c${k}`, { name: "Card", sourceUrl: "automerge:back", traits: { [TRAIT]: { by: deck.url, slot: k } } }]));
  const said = { audience: {}, shown: {} };
  const scheduled = [];
  const api = {
    repo,
    viewer,
    audience: (id) => (id in said.audience ? said.audience[id] : []),
    shown: (id) => (id in said.shown ? said.shown[id] : (said.audience[id] ?? [])),
    schedule: (fn) => scheduled.push(fn),
    notify() {},
  };
  const x = Keeper.create(api);
  const t = { x, api, deck, objects, said, scheduled, repo, update: () => x.update({ objects }) };
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
    expect([...t.x.looks()]).toEqual([
      ["c0", FACES[0]], // face up on the table
      ["c1", FACES[1]], // in my hand
      // c2: in someone else's hand: its back, no look
      ["c3", { veil: true }], // face up behind their screen
    ]);
  });

  it("unknown (a listed package missing): no look for anything, even what would be mine", async () => {
    const t = await mount();
    t.said.audience = { c0: null, c1: null, c2: null, c3: null };
    t.said.shown = { c0: null, c1: null, c2: null, c3: null };
    t.update();
    expect(t.x.looks().size).toBe(0);
  });

  it("before its container has loaded, and for one it can't read: closed, and the HUD says why", async () => {
    const repo = fakeRepo();
    const api = { repo, viewer: "me", audience: () => "all", shown: () => "all", schedule() {}, notify() {} };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const x = Keeper.create(api);
    const gone = "automerge:2GoneGoneGoneGoneGoneGone1";
    const bad = repo.add({ items: FACES, at: [0, 0, 1, 2] });
    const objects = { a: { traits: { [TRAIT]: { by: gone, slot: 0 } } }, b: { traits: { [TRAIT]: { by: bad.url, slot: 0 } } } };
    x.update({ objects });
    expect(x.looks().size).toBe(0);
    await settle();
    x.update({ objects });
    expect(x.looks().size).toBe(0);
    expect(x.hud().map((h) => h.state)).toEqual(["error", "error"]);
    expect(x.keeper.shuffle(["b"])).toBe(0);
  });

  it("two objects naming one slot: the lower id keeps it, the other stays closed and is flagged", async () => {
    const t = await mount();
    t.objects.c9 = { traits: { [TRAIT]: { by: t.deck.url, slot: 0 } } };
    t.said.audience = { c0: "all", c9: "all" };
    t.update();
    expect([...t.x.looks().keys()]).toEqual(["c0"]);
    expect(t.x.keeper.of("c9")).toBeNull();
    expect(t.x.hud().at(-1)).toMatchObject({ state: "error" });
  });

  it("says, at every scene that uses one, that it isn't secret", async () => {
    const t = await mount();
    expect(t.x.hud()).toEqual([{ text: openly("Deck"), state: "info" }]);
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
    // the doc changing is heard: the lens is read again and the stage asked to look
    expect(t.scheduled.length).toBeGreaterThan(0);
    t.said.audience = { c0: "all" };
    t.update();
    expect(t.x.looks().get("c0")).toEqual(FACES[at[0]]);
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
  const p = plugins.find((x) => x.type === "scene:extension");
  it("is an ordinary scene extension, found by `keeper`, attached by its own trait, in every activity", async () => {
    expect(p).toMatchObject({ id: "keep.plain", keeper: "plain", traits: [TRAIT] });
    expect(p.activities).toBeUndefined();
    for (const x of plugins) expect(() => structuredClone({ ...x, load: undefined })).not.toThrow();
    // no private registry type: only the scene's and Patchwork's own
    expect([...new Set(plugins.map((x) => x.type))].sort()).toEqual(["patchwork:datatype", "scene:extension"]);
    const mod = await p.load();
    expect(typeof mod.create).toBe("function");
    expect(mod.contain).toBe(contain);
  });

  it("a copy leaves the binding behind: the trait is runtime, its container dropped", () => {
    const d = p.describes[TRAIT];
    expect(d.runtime).toBe(true);
    expect(d.fields.find((f) => f.key === "by")).toMatchObject({ kind: "url", copy: "drop" });
  });
});
