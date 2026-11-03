import { describe, it, expect } from "vitest";
import { bind, createResolver, placement } from "./scene-resolver.js";
import { newSecret } from "./crypto/derive.js";
import { accountSecret, secretFor } from "./player-secret.js";
import { newDeckDoc } from "./deck.js";
import { plugins } from "./index.js";

/** One deck doc shared by several resolvers, with change events. */
function sharedDeck(faces, slots) {
  let state = structuredClone(newDeckDoc({ faces, slots }));
  const listeners = new Set();
  return {
    url: "automerge:deck",
    doc: () => state,
    change(fn) {
      const d = structuredClone(state);
      fn(d);
      state = d;
      queueMicrotask(() => {
        for (const l of [...listeners]) l();
      });
    },
    on: (_, f) => listeners.add(f),
    off: (_, f) => listeners.delete(f),
  };
}

const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("the scene resolver", () => {
  it("registers as the scene's secrets provider for secure decks, worker-safe", () => {
    const p = plugins.find((x) => x.type === "scene:secrets");
    expect(p.supportedDatatypes).toEqual(["secure-deck"]);
    for (const x of plugins) expect(() => structuredClone({ ...x, load: undefined })).not.toThrow();
  });

  it("two seated players: shuffles on its own, then each sees their own hand and the face-up card", async () => {
    const faces = Array.from({ length: 6 }, (_, i) => ({ sourceUrl: `automerge:face${i}`, name: `Card ${i}` }));
    const slots = Object.fromEntries(faces.map((_, i) => [`o${i}`, i]));
    const deck = sharedDeck(faces, slots);
    const where = { o0: "me", o1: "you", o2: "public" };
    const visibleTo = (p) => new Set(Object.entries(where).filter(([, w]) => w === "public" || (p != null && w === p)).map(([id]) => id));
    const ctx = { players: ["me", "you"], visibleTo, nameOf: (p) => p.toUpperCase() };
    let changes = 0;
    const me = createResolver({ handle: deck, viewer: "me", secret: newSecret(), onChange: () => changes++ });
    const you = createResolver({ handle: deck, viewer: "you", secret: newSecret(), onChange: () => {} });
    me.update(ctx);
    expect(changes).toBe(0);
    await until(() => me.status() === "Waiting for YOU to shuffle Deck.");
    you.update(ctx);
    await until(() => me.looks().size === 2 && you.looks().size === 2);
    expect([...me.looks().keys()].sort()).toEqual(["o0", "o2"]);
    expect([...you.looks().keys()].sort()).toEqual(["o1", "o2"]);
    expect(me.looks().get("o2")).toEqual(you.looks().get("o2"));
    expect(me.status()).toBeNull();
    // shuffle my hand card with the deck card o3: still one card for me, and it's one of the two
    const mine = me.looks().get("o0").name;
    expect(me.shuffle(["o0", "o3"])).toBe(2);
    await until(() => deck.doc().op == null && deck.doc().queue.length === 0 && me.looks().size === 2 && deck.doc().epochs[0] === 2, 30000);
    expect(me.looks().has("o0")).toBe(true);
    expect(["Card 0", "Card 1", "Card 2", "Card 3", "Card 4", "Card 5"]).toContain(mine);
    me.dispose();
    you.dispose();
  }, 60000);
});

describe("a deck dropped on a scene", () => {
  it("lays out one face-down card per face, once", () => {
    const deck = sharedDeck([{ name: "a" }, { name: "b" }], {});
    deck.change((d) => (d.back = { sourceUrl: "automerge:back", name: "Card", bounds: { min: [0, 0, 0], max: [1, 0.001, 1] } }));
    expect(placement(deck.doc())).toEqual({ name: "Deck", count: 2, look: { sourceUrl: "automerge:back", name: "Card" }, bounds: { min: [0, 0, 0], max: [1, 0.001, 1] } });
    bind(deck, ["x", "y"]);
    expect(deck.doc().slots).toEqual({ x: 0, y: 1 });
    expect(placement(deck.doc())).toBeNull();
  });
  it("can't be laid out without a back to show", () => {
    expect(placement(sharedDeck([{ name: "a" }], {}).doc())).toBeNull();
  });
});

describe("a player's secret", () => {
  /** Docs in memory, each with a handle. */
  function memoryRepo() {
    const docs = new Map();
    let n = 0;
    const handleFor = (url) => ({ url, doc: () => docs.get(url), change(fn) { const d = structuredClone(docs.get(url)); fn(d); docs.set(url, d); } });
    return {
      docs,
      async create2(init) { const url = `automerge:d${n++}`; docs.set(url, structuredClone(init)); return handleFor(url); },
      async find(url) { return handleFor(url); },
      handleFor,
    };
  }

  it("is the account's: made once, linked from the account doc, the same for every device that opens it", async () => {
    const repo = memoryRepo();
    const account = await repo.create2({ contactUrl: "automerge:me" });
    const first = await accountSecret({ repo, account });
    expect(first).toHaveLength(32);
    const url = account.doc().playerSecretsUrl;
    expect(repo.docs.get(url)["@patchwork"].type).toBe("player-secrets");
    // another device: the same account doc
    const again = await accountSecret({ repo, account: repo.handleFor(account.url) });
    expect([...again]).toEqual([...first]);
    expect(await secretFor({ repo, viewer: "automerge:me", account })).toEqual(first);
  });

  it("falls back to this browser's own, per viewer, outside an account", async () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const { browserSecret } = await import("./player-secret.js");
    const a = browserSecret("viewer:x", storage);
    expect(a).toHaveLength(32);
    expect([...browserSecret("viewer:x", storage)]).toEqual([...a]);
    expect([...browserSecret("viewer:y", storage)]).not.toEqual([...a]);
    // a viewer that isn't the account's contact doesn't get the account's secret
    expect(await secretFor({ repo: null, viewer: "viewer:x", account: null })).toHaveLength(32);
  });
});
