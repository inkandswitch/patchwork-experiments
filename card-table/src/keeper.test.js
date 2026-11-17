// The joint keeper (keeper.js) against a stand-in for the stage: two seated
// players' clients on one deck, each with its own reading of who may see
// what; the looks each gets by the rule; nothing handed over while the
// audience is unknown; the `keeper` convention; `contain`; the plugin.
import { describe, it, expect, vi, afterEach } from "vitest";
import { TRAIT, contain, create, playing } from "./keeper.js";
import { lookFor } from "./rule.js";
import { newSecret } from "./crypto/derive.js";
import { accountSecret, secretFor } from "./player-secret.js";
import { newDeckDoc } from "./deck.js";
import { plugins } from "./index.js";

afterEach(() => vi.restoreAllMocks());

const DECK = "automerge:2DeckDeckDeckDeckDeckDeck1";
const FACES = Array.from({ length: 6 }, (_, i) => ({ sourceUrl: `automerge:face${i}`, name: `Card ${i}` }));

/** One deck doc shared by several clients, with change events. */
function sharedDeck(faces = FACES) {
  let state = structuredClone(newDeckDoc({ faces }));
  const listeners = new Set();
  return {
    url: DECK,
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
    listeners,
  };
}

const until = async (fn, ms = 30000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

/**
 * A table of six kept cards and its seated players, and a client per viewer.
 * `where[id]` is where each card lies: a player (in their hand), "public"
 * (face up), "screened:<player>" (face up behind their screen) or nothing
 * (face down). Each client reads it through its own api.audience, unless
 * the test makes that client's audience unknown.
 */
function table({ seated = ["me", "you"], open = [] } = {}) {
  const deck = sharedDeck();
  const objects = Object.fromEntries(FACES.map((_, k) => [`c${k}`, { name: "Card", traits: { [TRAIT]: { by: DECK, slot: k } } }]));
  const where = {};
  const t = { deck, objects, where, seated, open, clients: {} };
  const roster = { viewers: () => [...t.seated], open: () => [...t.open], nameOf: (_s, v) => (v ? v.toUpperCase() : null) };
  const audienceOf = (id) => {
    const w = where[id];
    if (!w) return { audience: [], shown: [] };
    if (w === "public") return { audience: "all", shown: "all" };
    if (w.startsWith("screened:")) return { audience: [w.slice(9)], shown: "all" };
    return { audience: [w], shown: [w] };
  };
  /**
   * A client for `viewer`. `writable: false` is a stage that may not write (a pin, a mirror, a reader):
   * its deck handle refuses every write, as a read-only stage's repo hands it out, and counts each
   * one tried. `secret` is the player's (one per viewer by default, so a viewer's two clients share it).
   */
  t.secrets = {};
  t.join = (viewer, { roster: has = true, writable = true, at = null } = {}) => {
    const c = { unknown: false, scheduled: 0, refused: 0 };
    const readOnlyDeck = {
      // (a pin's handle is the deck at fixed heads: its url names them)
      url: at ? `${deck.url}#${at}` : deck.url,
      doc: () => deck.doc(),
      on: deck.on,
      off: deck.off,
      change() {
        c.refused++;
        throw new Error("Cannot change the deck: it is read-only here.");
      },
    };
    const api = {
      repo: { find: async (url) => (url === DECK ? (writable ? deck : readOnlyDeck) : Promise.reject(new Error("unavailable"))) },
      writable: () => writable,
      viewer,
      collect: (name) => (name === "roster" && has ? [{ id: "seats", value: roster }] : []),
      audience: (id) => (c.unknown ? null : audienceOf(id).audience),
      shown: (id) => (c.unknown ? null : audienceOf(id).shown),
      schedule: () => c.scheduled++,
      notify() {},
    };
    const secret = (t.secrets[viewer] ??= newSecret());
    c.x = create(api, { secret: () => secret });
    c.update = () => c.x.update({ objects });
    c.looks = () => Object.fromEntries([...c.x.looks()].map(([id, l]) => [id, l.veil ? "veil" : l.name]));
    c.status = () => c.x.hud().map((h) => h.text);
    t.clients[viewer] = c;
    c.update();
    return c;
  };
  /** every client hears the scene again (a doc change, or the stage's update after an audience change) */
  t.update = () => Object.values(t.clients).forEach((c) => c.update());
  /** what `who` has handed over, by position: "open" and the players sealed to */
  t.shares = (who) => {
    const out = {};
    for (const [k, s] of Object.entries(deck.doc().shares ?? {})) {
      const mine = s.by?.[who];
      if (mine) out[k] = [...(mine.open ? ["open"] : []), ...Object.keys(mine.to ?? {})].sort();
    }
    return out;
  };
  t.dealt = () => deck.doc().phase === "playing" && deck.doc().op == null && deck.doc().queue.length === 0 && Object.keys(deck.doc().epochs).length === FACES.length;
  t.dispose = () => Object.values(t.clients).forEach((c) => c.x.dispose());
  return t;
}

describe("the joint keeper", () => {
  it("two seated players: shuffled between them once both are here, then each sees their own hand and the face-up card, by the rule", async () => {
    const t = table();
    Object.assign(t.where, { c0: "me", c1: "you", c2: "public", c3: "screened:you" });
    const me = t.join("me");
    await until(() => me.status()[0] === "Waiting for YOU to shuffle Deck.");
    // not dealt yet: nothing is anyone's, every card its own back
    expect(me.looks()).toEqual({});
    expect(t.deck.doc().shares).toEqual({});
    const you = t.join("you");
    const faces = (c) => Object.values(c.looks()).filter((l) => l !== "veil").length;
    await until(() => t.dealt() && faces(me) === 2 && faces(you) === 3);
    // mine, the public one; theirs is its back (no look); the one behind their screen is veiled
    expect(Object.keys(me.looks()).sort()).toEqual(["c0", "c2", "c3"]);
    expect(me.looks().c3).toBe("veil");
    expect(Object.keys(you.looks()).sort()).toEqual(["c1", "c2", "c3"]);
    expect(you.looks().c3).not.toBe("veil");
    expect(me.looks().c2).toBe(you.looks().c2);
    expect(me.status()).toEqual([]);
    // every card is one of the deck's, each once among what's been shown
    const shown = [me.looks().c0, me.looks().c2, you.looks().c1, you.looks().c3];
    expect(new Set(shown).size).toBe(4);
    for (const n of shown) expect(FACES.map((f) => f.name)).toContain(n);
    // keys followed the table, and nothing else: in the open for the public card, sealed for the hands and the screen
    expect(t.shares("me")).toEqual({ 1: ["you"], 2: ["open"], 3: ["you"] });
    expect(t.shares("you")).toEqual({ 0: ["me"], 2: ["open"] });
    t.dispose();
  }, 60000);

  it("mine to see, its key not here yet: the veil, and the HUD says who it waits for", async () => {
    const t = table();
    Object.assign(t.where, { c0: "me" });
    const me = t.join("me");
    const you = t.join("you");
    await until(() => t.dealt() && me.looks().c0 && me.looks().c0 !== "veil");
    // you goes quiet (their client stops) before the card moves to me
    you.x.dispose();
    t.where.c1 = "me";
    t.update();
    await until(() => me.looks().c1 === "veil" && me.status().some((s) => /Waiting for YOU to show you 1 card/.test(s)));
    expect(me.looks().c0).not.toBe("veil");
    t.dispose();
  }, 60000);

  it("fails closed: a client whose audience is unknown shuffles its turn, and hands over nothing, to anyone; it sees no faces", async () => {
    const t = table();
    Object.assign(t.where, { c0: "me", c1: "you", c2: "public" });
    const me = t.join("me");
    const you = t.join("you");
    // you is missing a listed package: the stage tells their client nothing about who may see what
    you.unknown = true;
    await until(() => t.dealt() && Object.keys(t.shares("me")).length === 2);
    // let anything that was going to happen, happen
    for (let i = 0; i < 20; i++) {
      t.update();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(t.shares("you")).toEqual({});
    expect(you.looks()).toEqual({});
    // so I wait for them: my own card and the public one are veiled, not shown
    expect(me.looks()).toEqual({ c0: "veil", c2: "veil" });
    // the package arrives: their client reads the table and hands over what it owes
    you.unknown = false;
    t.update();
    await until(() => me.looks().c0 !== "veil" && me.looks().c2 !== "veil" && Object.keys(you.looks()).length === 2);
    expect(t.shares("you")).toEqual({ 0: ["me"], 2: ["open"] });
    t.dispose();
  }, 60000);

  it("waits for every seat: an open one, or no roster at all, and nothing is dealt", async () => {
    const t = table({ seated: ["me"], open: ["Player 2"] });
    const me = t.join("me");
    await until(() => me.status().length === 1);
    expect(me.status()).toEqual(["Deck is shuffled once someone sits as Player 2."]);
    expect(t.deck.doc().phase).toBe("waiting");
    expect(t.dealt()).toBe(false);
    const lone = table();
    const nobody = lone.join("me", { roster: false });
    await until(() => nobody.status().length === 1);
    expect(nobody.status()).toEqual(["Deck is shuffled once the players have sat down."]);
    expect(lone.deck.doc().participants).toEqual([]);
    t.dispose();
    lone.dispose();
  });

  it("the keeper convention: which deck, its name, and a shuffle the players do between them", async () => {
    const t = table();
    Object.assign(t.where, { c0: "me" });
    const me = t.join("me");
    t.join("you");
    await until(() => t.dealt() && me.looks().c0 && me.looks().c0 !== "veil");
    const k = me.x.keeper;
    expect(k.kind).toBe("joint");
    expect([k.of("c3"), k.of("nope")]).toEqual([DECK, null]);
    expect(k.name(DECK)).toBe("Deck");
    expect(k.shuffle(["c0"])).toBe(0);
    expect(k.shuffle(["c0", "c3", "nope"])).toBe(2);
    await until(() => t.deck.doc().op == null && t.deck.doc().queue.length === 0 && t.deck.doc().epochs[0] === 2 && me.looks().c0 && me.looks().c0 !== "veil");
    expect(t.deck.doc().epochs[3]).toBe(2);
    expect(t.deck.doc().epochs[1]).toBe(1);
    // the scene's binding never moved: the deck's order did
    expect(t.objects.c0.traits[TRAIT]).toEqual({ by: DECK, slot: 0 });
    t.dispose();
  }, 60000);

  it("two objects naming one position: the lower id keeps it, the other stays closed and is flagged", async () => {
    const t = table();
    t.objects.c9 = { traits: { [TRAIT]: { by: DECK, slot: 0 } } };
    Object.assign(t.where, { c0: "public", c9: "public" });
    const me = t.join("me");
    t.join("you");
    await until(() => t.dealt() && me.looks().c0);
    expect(me.looks().c9).toBeUndefined();
    expect(me.x.keeper.of("c9")).toBeNull();
    expect(me.x.hud().at(-1)).toMatchObject({ state: "error" });
    t.dispose();
  }, 60000);

  it("a deck that can't be found, or isn't one: closed, and the HUD says so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = { repo: { find: async () => ({ doc: () => ({ title: "Not a deck" }) }) }, viewer: "me", collect: () => [], audience: () => "all", shown: () => "all", schedule() {}, notify() {} };
    const x = create(api, { secret: () => newSecret() });
    x.update({ objects: { a: { traits: { [TRAIT]: { by: DECK, slot: 0 } } } } });
    await until(() => x.hud().length === 1);
    expect(x.hud()[0]).toMatchObject({ state: "error" });
    expect(x.looks().size).toBe(0);
    x.dispose();
  });

  // I6 (scene/STAGE.md): in a stage that may not write, the keeper never reaches a refusal.
  // Over every case of who else is at the table: the viewer's own acting client (a pin
  // beside the game played live), the other player only (a reader whose writable client is away),
  // or nobody.
  for (const twin of ["mine", "mine, pinned", "theirs", "none"]) {
    it(`a client that may not write takes no part and writes nothing (its writable twin: ${twin}); it shows what the doc and its secret already hold`, async () => {
      const warned = [];
      vi.spyOn(console, "warn").mockImplementation((...a) => warned.push(a.map(String).join(" ")));
      const t = table();
      Object.assign(t.where, { c0: "me", c1: "you", c2: "public" });
      const pinned = twin === "mine, pinned";
      const ro = t.join("me", { writable: false, ...(pinned ? { at: "h1" } : {}) });
      if (twin.startsWith("mine")) t.join("me");
      if (twin !== "none") t.join("you");
      const settle = async () => {
        for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 5));
      };
      if (twin.startsWith("mine")) {
        // dealt by the writable clients (a pin's deck is the same deck: its keys are the same); the read-only one shows exactly what its twin shows
        await until(() => t.dealt() && t.clients.you.looks().c1 && t.clients.you.looks().c1 !== "veil");
        await until(() => JSON.stringify(ro.looks()) === JSON.stringify(t.clients.me.looks()) && ro.looks().c0 && ro.looks().c0 !== "veil");
        expect(Object.keys(ro.looks()).sort()).toEqual(["c0", "c2"]);
        // a shuffle asked of it is refused before the doc is reached
        expect(ro.x.keeper.shuffle(["c0", "c1"])).toBe(0);
      } else {
        // nobody who may write joins for "me": the deck waits, and the read-only client shows nothing
        await settle();
        expect(t.deck.doc().phase).toBe("waiting");
        expect(t.deck.doc().participants.map((p) => p.id)).not.toContain("me");
        expect(ro.looks()).toEqual({});
      }
      t.update();
      await settle();
      expect(ro.refused).toBe(0);
      expect(warned).toEqual([]);
      expect(ro.status().filter((x) => /problem/.test(x))).toEqual([]);
      t.dispose();
    }, 60000);
  }

  it("the rule it shows by (rule.js): the item only inside the audience, the veil only when it's turned toward you", () => {
    const face = { name: "X" };
    const look = (audience, shown, known = true, ready = true) => lookFor({ ready, audience, shown, viewer: "me", look: known ? face : null });
    expect(look(["me"], ["me"])).toBe(face);
    expect(look(["me"], ["me"], false)).toEqual({ veil: true });
    expect(look(["you"], ["you"])).toBeNull();
    expect(look(["you"], "all")).toEqual({ veil: true });
    expect(look("all", "all", true, false)).toBeNull();
    expect(look(null, null)).toBeNull();
  });
});

describe("contain", () => {
  it("makes a secure deck of the items, waiting for its players, and binds an object to a position by this keeper's trait", async () => {
    const made = [];
    const repo = { create2: async (doc) => (made.push(doc), { url: DECK }) };
    const { key, bind } = await contain({ repo }, { title: "Lost Cities: Deck", items: FACES });
    expect(key).toBe(DECK);
    expect(made[0]).toEqual(newDeckDoc({ title: "Lost Cities: Deck", faces: FACES }));
    expect(made[0]).toMatchObject({ phase: "waiting", participants: [], cards: null, shares: {} });
    // the deck knows nothing of the scene's objects: no slots map, no back
    expect("slots" in made[0] || "back" in made[0]).toBe(false);
    expect(bind(4)).toEqual({ [TRAIT]: { by: DECK, slot: 4 } });
  });
});

describe("the plugin", () => {
  const p = plugins.find((x) => x.type === "scene:extension");
  it("is an ordinary scene extension, found by `keeper`, run by its own trait; no private registry type", () => {
    expect(p).toMatchObject({ id: "card-table", keeper: "joint", traits: [TRAIT] });
    for (const k of ["activities", "requires", "always", "general"]) expect(k in p).toBe(false);
    expect([...new Set(plugins.map((x) => x.type))].sort()).toEqual(["patchwork:datatype", "patchwork:tool", "scene:extension"]);
    for (const x of plugins) expect(() => structuredClone({ ...x, load: undefined })).not.toThrow();
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

  it("one that may not make it (a stage that may not write) gets null until it's made, and writes nothing", async () => {
    const repo = memoryRepo();
    const account = await repo.create2({ contactUrl: "automerge:me" });
    const writes = [];
    const ro = { ...repo, create2: async () => (writes.push("create2"), null) };
    const roAccount = { url: account.url, doc: () => account.doc(), change: () => writes.push("account") };
    expect(await accountSecret({ repo: ro, account: roAccount, make: false })).toBe(null);
    expect(await secretFor({ repo: ro, viewer: "automerge:me", account: roAccount, make: false })).toBe(null);
    // linked, but its doc has no secret yet (another device is making it)
    const empty = await repo.create2({ title: "Player secrets" });
    account.change((d) => (d.playerSecretsUrl = empty.url));
    const roFind = { ...ro, find: async (url) => ({ ...repo.handleFor(url), change: () => writes.push("secrets") }) };
    expect(await accountSecret({ repo: roFind, account: roAccount, make: false })).toBe(null);
    expect(writes).toEqual([]);
    // made: read as it is
    const made = await accountSecret({ repo, account });
    expect([...(await accountSecret({ repo: roFind, account: roAccount, make: false }))]).toEqual([...made]);
    expect(writes).toEqual([]);
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

describe("who plays a deck: the roster's seats (a game is a doc of its own: every seat of its doc)", () => {
  const apiWith = (roster) => ({ collect: (n) => (n === "roster" && roster ? [{ id: "seats", value: roster }] : []) });

  it("no roster, nobody", () => {
    expect(playing(apiWith(null), {})).toMatchObject({ players: [], openSeats: [] });
  });
});

