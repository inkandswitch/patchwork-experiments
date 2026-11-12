import { describe, it, expect } from "vitest";
import { G, P, Q, cardDecoder, decrypt, encodeCard, encrypt, isResidue, modpow, newKey, shuffle } from "./crypto/group.js";
import { newSecret, open, playerKeys, seal } from "./crypto/derive.js";
import { createParticipant, newDeckDoc } from "./deck.js";

describe("the group", () => {
  it("P is the RFC 3526 safe prime: 2048 bits, P = 2Q + 1, and G generates the residues", () => {
    expect(P.toString(2)).toHaveLength(2048);
    expect(2n * Q + 1n).toBe(P);
    expect(modpow(2n, P - 1n, P)).toBe(1n);
    expect(modpow(3n, Q - 1n, Q)).toBe(1n);
    expect(modpow(G, Q)).toBe(1n);
  });

  it("keys commute, and undo each other in any order", () => {
    const a = newKey();
    const b = newKey();
    const m = encodeCard(7);
    const c = encrypt(encrypt(m, a), b);
    expect(encrypt(encrypt(m, b), a)).toBe(c);
    expect(decrypt(decrypt(c, a), b)).toBe(m);
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

describe("a player's keys", () => {
  it("are the same from the same secret, on any device, and differ by deck, card and epoch", async () => {
    const secret = newSecret();
    const one = playerKeys(secret);
    const two = playerKeys(Uint8Array.from(secret));
    expect((await one.card("d1", 3, 1)).e).toBe((await two.card("d1", 3, 1)).e);
    expect((await one.card("d1", 3, 1)).e).not.toBe((await one.card("d1", 3, 2)).e);
    expect((await one.card("d1", 3, 1)).e).not.toBe((await one.card("d2", 3, 1)).e);
    expect((await one.exchange("d1")).X).toBe((await two.exchange("d1")).X);
    const k = await one.card("d1", 0, 1);
    expect((k.e * k.d) % Q).toBe(1n);
  });

  it("seal a share for one player only", async () => {
    const alice = await playerKeys(newSecret()).exchange("d");
    const bob = await playerKeys(newSecret()).exchange("d");
    const env = await seal(alice.X, "the key");
    expect(await open(alice.x, env)).toBe("the key");
    await expect(open(bob.x, env)).rejects.toThrow();
  });
});

/** One deck doc, shared by several clients (synchronously, like a merged doc). */
function table(n, url = "automerge:deck") {
  let state = structuredClone(newDeckDoc({ title: "Test deck", faces: Array.from({ length: n }, (_, i) => ({ name: `card ${i}` })) }));
  return {
    url,
    doc: () => state,
    change(fn) {
      const d = structuredClone(state);
      fn(d);
      state = d;
    },
  };
}

/** Where each card (by its position in the deck) is: a player's id (in their hand), "public" (face up), or "deck". */
const placer = (where) => (player) => Object.entries(where).filter(([, w]) => (player == null ? w === "public" : w === player || w === "public")).map(([id]) => Number(id));

async function settle(clients, players, where) {
  for (let round = 0; round < 16; round++) for (const c of clients) await c.step({ players, visibleTo: placer(where) });
}

const names = async (c, ids) => {
  const { looks } = await c.reveal(ids);
  return Object.fromEntries([...looks].map(([id, face]) => [id, face.name]));
};

describe("a secure deck", () => {
  const N = 10;
  const ids = Array.from({ length: N }, (_, i) => i);
  const players = ["alice", "bob", "carol"];

  async function dealt() {
    const handle = table(N);
    const secrets = Object.fromEntries(players.map((p) => [p, newSecret()]));
    const [alice, bob, carol] = players.map((playerId) => createParticipant({ handle, playerId, secret: secrets[playerId] }));
    const watcher = createParticipant({ handle, playerId: null, secret: null });
    const where = { 0: "alice", 1: "alice", 2: "bob", 3: "bob", 4: "carol", 5: "public" };
    for (const id of ids) where[id] ??= "deck";
    const clients = [alice, bob, carol, watcher];
    await settle(clients, players, where);
    return { handle, alice, bob, carol, watcher, where, clients, secrets };
  }

  it("deals: each in turn, mix then rekey; every card shuffled once, nothing in the clear", async () => {
    const { handle, alice } = await dealt();
    const d = handle.doc();
    expect(d.phase).toBe("playing");
    expect(d.op).toBeNull();
    expect(d.participants.map((p) => p.id)).toEqual(["alice", "bob", "carol"]);
    expect(Object.values(d.epochs)).toEqual(Array(N).fill(1));
    expect(alice.dealt()).toBe(true);
    const plain = new Set(ids.map((_, i) => encodeCard(i).toString(16)));
    for (const c of d.cards) expect(plain.has(c)).toBe(false);
  }, 30000);

  it("shows each hand to its owner, face-up cards to everyone, and the deck to no one", async () => {
    const { alice, bob, carol, watcher } = await dealt();
    const [a, b, c, w] = await Promise.all([alice, bob, carol, watcher].map((x) => names(x, ids)));
    expect(Object.keys(a).sort()).toEqual(["0", "1", "5"]);
    expect(Object.keys(b).sort()).toEqual(["2", "3", "5"]);
    expect(Object.keys(c).sort()).toEqual(["4", "5"]);
    expect(Object.keys(w)).toEqual(["5"]);
    expect(new Set([a[5], b[5], c[5], w[5]]).size).toBe(1);
    expect(new Set([a[0], a[1], b[2], b[3], c[4], a[5]]).size).toBe(6);
  }, 30000);

  it("a card passed from one hand to another is seen by its new owner, and still not by the third player", async () => {
    const { alice, bob, carol, watcher, where, clients } = await dealt();
    const before = (await names(alice, [0]))[0];
    where[0] = "bob";
    await settle(clients, players, where);
    expect((await names(bob, [0]))[0]).toBe(before);
    expect(await names(carol, [0])).toEqual({});
    expect(await names(watcher, [0])).toEqual({});
  }, 30000);

  it("shuffles some cards on demand: the same cards, in a new order, hidden again", async () => {
    const { handle, alice, bob, where, clients } = await dealt();
    const pile = [6, 7, 8, 9, 5];
    for (const id of pile) where[id] = "public";
    await settle(clients, players, where);
    const before = await names(bob, pile);
    expect(Object.keys(before)).toHaveLength(5);
    // turn the pile face down and shuffle it
    for (const id of pile) where[id] = "deck";
    expect(alice.shuffle(pile)).toBe(5);
    await settle(clients, players, where);
    const d = handle.doc();
    expect(d.op).toBeNull();
    for (const id of pile) expect(d.epochs[id]).toBe(2);
    expect(d.epochs[0]).toBe(1); // untouched
    expect(await names(alice, pile)).toEqual({});
    // face up again: the same five cards
    for (const id of pile) where[id] = "public";
    await settle(clients, players, where);
    const after = await names(bob, pile);
    expect(Object.values(after).sort()).toEqual(Object.values(before).sort());
  }, 60000);

  it("reshuffles a hand: its owner still sees the same cards, nobody else does", async () => {
    const { alice, bob, where, clients } = await dealt();
    const mine = await names(alice, [0, 1]);
    alice.shuffle([0, 1]);
    await settle(clients, players, where);
    const again = await names(alice, [0, 1]);
    expect(Object.values(again).sort()).toEqual(Object.values(mine).sort());
    expect(await names(bob, [0, 1])).toEqual({});
  }, 60000);

  it("runs shuffles asked for together one after another", async () => {
    const { handle, alice, bob, where, clients } = await dealt();
    alice.shuffle([6, 7]);
    bob.shuffle([8, 9]);
    bob.shuffle([6, 9]);
    expect(handle.doc().queue).toHaveLength(3);
    await settle(clients, players, where);
    const d = handle.doc();
    expect(d.queue).toHaveLength(0);
    expect([6, 7, 8, 9].map((k) => d.epochs[k])).toEqual([3, 2, 2, 3]);
  }, 60000);

  it("is the account's, not the device's: another device with the same secret sees the same hand", async () => {
    const { handle, secrets, alice } = await dealt();
    const phone = createParticipant({ handle, playerId: "alice", secret: Uint8Array.from(secrets.alice) });
    expect(await names(phone, [0, 1, 2])).toEqual(await names(alice, [0, 1, 2]));
    // and a device without it sees nothing
    const stranger = createParticipant({ handle, playerId: "alice", secret: newSecret() });
    expect(await names(stranger, [0, 1])).toEqual({});
  }, 30000);

  it("an offline player holds up only the cards that need their key", async () => {
    const handle = table(N);
    const [alice, bob] = ["alice", "bob"].map((playerId) => createParticipant({ handle, playerId, secret: newSecret() }));
    const where = { 0: "alice", 1: "bob" };
    for (const id of ids) where[id] ??= "deck";
    await settle([alice, bob], ["alice", "bob"], where);
    where[2] = "alice";
    await settle([alice], ["alice", "bob"], where);
    const { looks, waiting } = await alice.reveal([0, 2]);
    expect([...looks.keys()]).toEqual([0]);
    expect(waiting.get("bob")).toBe(1);
    await settle([bob], ["alice", "bob"], where);
    expect(Object.keys(await names(alice, [2]))).toEqual(["2"]);
  }, 30000);

  it("doesn't start while a seat is open, and says what it's waiting for", async () => {
    const handle = table(4);
    const alice = createParticipant({ handle, playerId: "alice", secret: newSecret() });
    await alice.step({ players: ["alice"], openSeats: ["Player 2"], visibleTo: () => [] });
    expect(handle.doc().phase).toBe("waiting");
    expect(alice.dealt()).toBe(false);
    expect(alice.status({ players: ["alice"], openSeats: ["Player 2"] })).toBe("Test deck is shuffled once someone sits as Player 2.");
    expect(alice.status({ players: ["alice", "bob"], nameOf: (id) => id.toUpperCase() })).toBe("Waiting for BOB to shuffle Test deck.");
  });
});
