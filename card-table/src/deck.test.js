import { describe, it, expect } from "vitest";
import { P, Q, cardDecoder, decrypt, encodeCard, encrypt, isResidue, modpow, newKey, shuffle } from "./crypto/group.js";
import { newExchangeKeys, open, seal } from "./crypto/envelope.js";
import { createParticipant, newDeckDoc } from "./deck.js";

describe("the group", () => {
  it("P is the RFC 3526 safe prime: 2048 bits, P = 2Q + 1", () => {
    expect(P.toString(2)).toHaveLength(2048);
    expect(2n * Q + 1n).toBe(P);
    // Fermat check on both (not a proof, but catches a typo in the constant)
    expect(modpow(2n, P - 1n, P)).toBe(1n);
    expect(modpow(3n, Q - 1n, Q)).toBe(1n);
  });

  it("keys commute, and undo each other in any order", () => {
    const a = newKey();
    const b = newKey();
    const m = encodeCard(7);
    const c = encrypt(encrypt(m, a), b);
    expect(encrypt(encrypt(m, b), a)).toBe(c);
    expect(decrypt(decrypt(c, a), b)).toBe(m);
    expect(decrypt(decrypt(c, b), a)).toBe(m);
  });

  it("every card, and so every encrypted card, is a quadratic residue: residuosity says nothing", () => {
    const k = newKey();
    for (let i = 0; i < 60; i++) {
      expect(isResidue(encodeCard(i))).toBe(true);
      expect(isResidue(encrypt(encodeCard(i), k))).toBe(true);
    }
  });

  it("decodes cards back to their index, and nothing else", () => {
    const dec = cardDecoder(60);
    for (const i of [0, 1, 59]) expect(dec(encodeCard(i))).toBe(i);
    expect(dec(encodeCard(60))).toBeNull();
  });

  it("shuffles to a permutation", () => {
    const a = Array.from({ length: 100 }, (_, i) => i);
    const s = shuffle(a);
    expect(s).not.toEqual(a);
    expect([...s].sort((x, y) => x - y)).toEqual(a);
  });
});

describe("envelopes", () => {
  it("open only for their recipient", async () => {
    const alice = await newExchangeKeys();
    const bob = await newExchangeKeys();
    const env = await seal(alice.publicJwk, "the key");
    expect(await open(alice.privateJwk, env)).toBe("the key");
    await expect(open(bob.privateJwk, env)).rejects.toThrow();
  });
});

/** One deck doc, shared by several clients (synchronously, like a merged doc). */
function table(n) {
  let state = structuredClone(newDeckDoc({ title: "Test deck", faces: Array.from({ length: n }, (_, i) => ({ name: `card ${i}` })), slots: Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, i])) }));
  const handle = {
    url: "automerge:deck",
    doc: () => state,
    change(fn) {
      const d = structuredClone(state);
      fn(d);
      state = d;
    },
  };
  return handle;
}

/** A key store per client, in memory. */
const memoryStore = () => {
  const m = new Map();
  return { get: (id) => m.get(id) ?? null, set: (id, v) => m.set(id, v) };
};

/** Where each slot is: a player's id (in their hand), "public" (face up), or "deck". */
function placer(where) {
  return (player) => Object.entries(where).filter(([, w]) => (player == null ? w === "public" : w === player || w === "public")).map(([id]) => id);
}

async function settle(clients, players, where) {
  for (let round = 0; round < 12; round++) for (const c of clients) await c.step({ players, visibleTo: placer(where) });
}

const names = async (c, ids) => {
  const { looks } = await c.reveal(ids);
  return Object.fromEntries([...looks].map(([id, face]) => [id, face.name]));
};

describe("a secure deck", () => {
  const N = 10;
  const ids = Array.from({ length: N }, (_, i) => `o${i}`);
  const players = ["alice", "bob", "carol"];

  async function dealt() {
    const handle = table(N);
    const [alice, bob, carol] = players.map((playerId) => createParticipant({ handle, playerId, keyStore: memoryStore() }));
    const watcher = createParticipant({ handle, playerId: null, keyStore: memoryStore() });
    const where = { o0: "alice", o1: "alice", o2: "bob", o3: "bob", o4: "carol", o5: "public" };
    for (const id of ids) where[id] ??= "deck";
    await settle([alice, bob, carol, watcher], players, where);
    return { handle, alice, bob, carol, watcher, where };
  }

  it("shuffles with all three: each turn in order, forward then back", async () => {
    const { handle } = await dealt();
    const d = handle.doc();
    expect(d.phase).toBe("ready");
    expect(d.participants.map((p) => p.id)).toEqual(["alice", "bob", "carol"]);
    expect(d.cards).toHaveLength(N);
    // nothing in the doc is a card in the clear
    const plain = new Set(ids.map((_, i) => encodeCard(i).toString(16)));
    for (const c of d.cards) expect(plain.has(c)).toBe(false);
  }, 30000);

  it("shows each hand to its owner, face-up cards to everyone, and the deck to no one", async () => {
    const { alice, bob, carol, watcher } = await dealt();
    const a = await names(alice, ids);
    const b = await names(bob, ids);
    const c = await names(carol, ids);
    const w = await names(watcher, ids);
    expect(Object.keys(a).sort()).toEqual(["o0", "o1", "o5"]);
    expect(Object.keys(b).sort()).toEqual(["o2", "o3", "o5"]);
    expect(Object.keys(c).sort()).toEqual(["o4", "o5"]);
    expect(Object.keys(w)).toEqual(["o5"]);
    // the face-up card is the same card for everyone
    expect(new Set([a.o5, b.o5, c.o5, w.o5]).size).toBe(1);
    // and the dealt cards are all different cards
    expect(new Set([a.o0, a.o1, b.o2, b.o3, c.o4, a.o5]).size).toBe(6);
  }, 30000);

  it("a card passed from one hand to another is seen by its new owner, and still not by the third player", async () => {
    const { alice, bob, carol, watcher, where } = await dealt();
    const before = (await names(alice, ["o0"])).o0;
    where.o0 = "bob";
    await settle([alice, bob, carol, watcher], players, where);
    expect((await names(bob, ["o0"])).o0).toBe(before);
    expect(await names(carol, ["o0"])).toEqual({});
    expect(await names(watcher, ["o0"])).toEqual({});
  }, 30000);

  it("a card turned face up is seen by everyone, watchers too", async () => {
    const { alice, bob, carol, watcher, where } = await dealt();
    where.o9 = "public";
    await settle([alice, bob, carol, watcher], players, where);
    const seen = await Promise.all([alice, bob, carol, watcher].map((c) => names(c, ["o9"])));
    expect(seen.every((s) => s.o9 && s.o9 === seen[0].o9)).toBe(true);
  }, 30000);

  it("an offline player holds up only the cards that need their key", async () => {
    const handle = table(N);
    const [alice, bob] = ["alice", "bob"].map((playerId) => createParticipant({ handle, playerId, keyStore: memoryStore() }));
    const where = { o0: "alice", o1: "bob" };
    for (const id of ids) where[id] ??= "deck";
    await settle([alice, bob], ["alice", "bob"], where);
    // bob goes away; alice draws o2
    where.o2 = "alice";
    await settle([alice], ["alice", "bob"], where);
    const { looks, waiting } = await alice.reveal(["o0", "o2"]);
    expect([...looks.keys()]).toEqual(["o0"]);
    expect(waiting.get("bob")).toBe(1);
    expect(alice.status({ players: ["alice", "bob"] })).toBeNull();
    // bob comes back: alice sees it
    await settle([bob], ["alice", "bob"], where);
    expect(Object.keys(await names(alice, ["o2"]))).toEqual(["o2"]);
  }, 30000);

  it("doesn't start while a seat is open, even if everyone seated has joined", async () => {
    const handle = table(4);
    const alice = createParticipant({ handle, playerId: "alice", keyStore: memoryStore() });
    await alice.step({ players: ["alice"], openSeats: ["Player 2"], visibleTo: () => [] });
    expect(handle.doc().phase).toBe("waiting");
    expect(handle.doc().participants.map((p) => p.id)).toEqual(["alice"]);
    expect(alice.status({ players: ["alice"], openSeats: ["Player 2"] })).toBe("The deck is shuffled once someone sits as Player 2.");
  });

  it("waits for every player before shuffling, and says who it's waiting for", async () => {
    const handle = table(4);
    const alice = createParticipant({ handle, playerId: "alice", keyStore: memoryStore() });
    await alice.step({ players: ["alice", "bob"], visibleTo: () => [] });
    expect(handle.doc().phase).toBe("waiting");
    expect(alice.status({ players: ["alice", "bob"], nameOf: (id) => id.toUpperCase() })).toBe("Waiting for BOB to shuffle.");
  });
});
