// A secure deck: a shuffle nobody can see through, and reveals that follow
// what the table shows. Plain JS; the host (a scene, a standalone deck view,
// an agent) says who is playing and who may see which card, and calls step().
//
// The doc (type "secure-deck"):
//   faces        the deck's contents, public: anything JSON (a scene puts
//                { sourceUrl, name } here). Only their order is secret.
//   slots        { [slotId]: offset }: which shuffled position each of the
//                host's things is (a scene's object ids).
//   phase        "waiting" → "shuffling" → "ready"
//   participants [{ id, exchangeKey }] in turn order; fixed once shuffling starts
//   pass, turn   whose turn it is, forward (encrypt + shuffle) or back
//                (swap the shared key for one key per card)
//   working      the deck in flight (hex), while shuffling
//   cards        the shuffled deck (hex): card k is encrypted under every
//                participant's key for k
//   shares       { [offset]: { [participantId]: { open?: hex d, to?: { [recipientId]: envelope } } } }
//                a participant's key for a card: `open` when everyone may see
//                it, sealed `to` one player when only they may
//
// Keys never leave the player's device (a key store the host provides). A
// participant hands over its key for a card only when the host's
// visibleTo() says the other player may see that card, so every reveal
// follows something visible at the table: a card moved into a hand, or
// turned face up. No requests: nobody can ask for a card they can't see.

import { GROUP_ID, cardDecoder, decrypt, decryptWith, encodeCard, encrypt, fromHex, newKey, shuffle, toHex } from "./crypto/group.js";
import { newExchangeKeys, open, publicPart, seal } from "./crypto/envelope.js";

export const DATATYPE = "secure-deck";

/** A fresh deck doc (for repo.create2). */
export function newDeckDoc({ title = "Deck", faces = [], slots = {} } = {}) {
  return {
    "@patchwork": { type: DATATYPE },
    title,
    group: GROUP_ID,
    faces,
    slots,
    phase: "waiting",
    participants: [],
    pass: null,
    turn: 0,
    working: null,
    cards: null,
    shares: {},
  };
}

/** A key store in localStorage (one entry per deck and player); falls back to memory. */
export function localKeyStore(storage = globalThis.localStorage) {
  const memory = new Map();
  return {
    get(id) {
      try {
        const raw = storage?.getItem(id);
        if (raw) return JSON.parse(raw);
      } catch {
        // unavailable: memory only
      }
      return memory.get(id) ?? null;
    },
    set(id, value) {
      memory.set(id, value);
      try {
        storage?.setItem(id, JSON.stringify(value));
      } catch {
        // memory only: lost on reload
      }
    },
  };
}

const keyFromHex = (k) => ({ e: fromHex(k.e), d: fromHex(k.d) });
const keyToHex = (k) => ({ e: toHex(k.e), d: toHex(k.d) });

/**
 * One player (or onlooker) at a deck.
 * @param {{ handle, playerId: string | null, keyStore }} o
 *   handle: the deck doc's handle; playerId: who this client is (null: just watching)
 */
export function createParticipant({ handle, playerId, keyStore = localKeyStore() }) {
  const storeId = `secure-deck:${handle.url}:${playerId}`;
  let keys = null; // { main, cards: [], exchange: { publicJwk, privateJwk } }, BigInts in memory
  const known = new Map(); // offset → face index, once decrypted (it never changes)
  let decoder = null;

  const doc = () => handle.doc() ?? {};
  const me = () => doc().participants?.find((p) => p.id === playerId) ?? null;

  function loadKeys() {
    if (keys || !playerId) return keys;
    const stored = keyStore.get(storeId);
    if (stored) keys = { main: keyFromHex(stored.main), cards: stored.cards.map(keyFromHex), exchange: stored.exchange };
    return keys;
  }

  async function makeKeys(n) {
    const exchange = await newExchangeKeys();
    keys = { main: newKey(), cards: Array.from({ length: n }, newKey), exchange };
    keyStore.set(storeId, { main: keyToHex(keys.main), cards: keys.cards.map(keyToHex), exchange });
    return keys;
  }

  async function join(n) {
    if (!loadKeys()) await makeKeys(n);
    const pub = publicPart(keys.exchange.publicJwk);
    handle.change((d) => {
      if (d.phase !== "waiting" || d.participants.some((p) => p.id === playerId)) return;
      d.participants.push({ id: playerId, exchangeKey: pub });
    });
  }

  function start(players) {
    const d0 = doc();
    const n = d0.faces?.length ?? 0;
    handle.change((d) => {
      if (d.phase !== "waiting") return;
      // turn order: the players, by id; anyone who joined but isn't playing is dropped
      const order = [...players].sort();
      const byId = new Map(d.participants.map((p) => [p.id, p]));
      if (!order.every((id) => byId.has(id))) return;
      d.participants = order.map((id) => ({ id, exchangeKey: { ...byId.get(id).exchangeKey } }));
      d.phase = "shuffling";
      d.pass = "forward";
      d.turn = 0;
      d.working = Array.from({ length: n }, (_, i) => toHex(encodeCard(i)));
      d.cards = null;
    });
  }

  function takeTurn() {
    const d0 = doc();
    const { pass, turn } = d0;
    const input = d0.working.map(fromHex);
    let output;
    if (pass === "forward") output = shuffle(input.map((c) => encrypt(c, keys.main)));
    else output = input.map((c, k) => encrypt(decrypt(c, keys.main), keys.cards[k]));
    const last = turn === d0.participants.length - 1;
    handle.change((d) => {
      // someone (another tab of ours) got there first
      if (d.phase !== "shuffling" || d.pass !== pass || d.turn !== turn) return;
      const hex = output.map(toHex);
      if (pass === "forward" && last) {
        d.pass = "back";
        d.turn = 0;
        d.working = hex;
      } else if (pass === "back" && last) {
        d.cards = hex;
        d.working = null;
        d.pass = null;
        d.phase = "ready";
      } else {
        d.turn = turn + 1;
        d.working = hex;
      }
    });
  }

  const offsetsOf = (d, ids) => {
    const out = new Set();
    for (const id of ids ?? []) {
      const k = d.slots?.[id];
      if (Number.isInteger(k) && k >= 0 && k < (d.cards?.length ?? 0)) out.add(k);
    }
    return out;
  };

  /** Hand over our keys for whatever the table says others may now see. */
  async function deliver(visibleTo) {
    const d = doc();
    const pub = offsetsOf(d, visibleTo(null));
    const writes = [];
    for (const k of pub) if (!d.shares?.[k]?.[playerId]?.open) writes.push({ k, open: toHex(keys.cards[k].d) });
    for (const other of d.participants) {
      if (other.id === playerId || !other.exchangeKey) continue;
      for (const k of offsetsOf(d, visibleTo(other.id))) {
        if (pub.has(k) || d.shares?.[k]?.[playerId]?.to?.[other.id] || d.shares?.[k]?.[playerId]?.open) continue;
        writes.push({ k, to: other.id, envelope: await seal(other.exchangeKey, toHex(keys.cards[k].d)) });
      }
    }
    if (!writes.length) return;
    handle.change((dd) => {
      if (!dd.shares) dd.shares = {};
      for (const w of writes) {
        if (!dd.shares[w.k]) dd.shares[w.k] = {};
        if (!dd.shares[w.k][playerId]) dd.shares[w.k][playerId] = {};
        const mine = dd.shares[w.k][playerId];
        if (w.open) mine.open = w.open;
        else {
          if (!mine.to) mine.to = {};
          mine.to[w.to] = w.envelope;
        }
      }
    });
  }

  let running = null;
  let again = false;
  /**
   * Do whatever this player should do now: join, start the shuffle, take a
   * turn, hand over keys. Safe to call on every change; runs one at a time.
   * @param {{ players: string[], openSeats?: string[], visibleTo: (playerId: string | null) => Iterable<string> }} ctx
   *   players: who must be in the shuffle (e.g. everyone seated); openSeats: places still
   *   waiting for a player (the shuffle waits for them: its players are fixed once it starts);
   *   visibleTo(id): the slot ids that player may see now, visibleTo(null): those everyone may see
   */
  async function step(ctx) {
    if (running) {
      again = ctx;
      return running;
    }
    running = (async () => {
      try {
        await stepOnce(ctx);
      } finally {
        running = null;
      }
      if (again) {
        const next = again;
        again = false;
        await step(next);
      }
    })();
    return running;
  }

  async function stepOnce({ players, openSeats = [], visibleTo }) {
    const d = doc();
    if (!playerId) return;
    const playing = players.includes(playerId);
    if (d.phase === "waiting") {
      if (playing && !me()) await join(d.faces?.length ?? 0);
      const after = doc();
      const joined = new Set(after.participants.map((p) => p.id));
      const ready = !openSeats.length && players.length > 0 && players.every((id) => joined.has(id));
      // the first player in turn order starts it, so only one does
      if (ready && [...players].sort()[0] === playerId) start(players);
    }
    const d2 = doc();
    if (d2.phase === "shuffling" && d2.participants[d2.turn]?.id === playerId && loadKeys()) {
      takeTurn();
      // the next turn may be ours too (or the pass may turn round to us)
      return stepOnce({ players, openSeats, visibleTo });
    }
    if (d2.phase === "ready" && me() && loadKeys()) await deliver(visibleTo);
  }

  /**
   * What this client can see: slot id → face, for the slots in `ids` it has
   * every key for (its own, and everyone else's open or sealed to it).
   * Also how many it is still waiting on, and from whom.
   */
  async function reveal(ids) {
    const d = doc();
    const out = new Map();
    const waiting = new Map(); // participant id → count of cards we lack their key for
    if (d.phase !== "ready" || !d.cards) return { looks: out, waiting };
    if (!decoder) decoder = cardDecoder(d.faces.length);
    const mine = me() && loadKeys();
    for (const id of ids) {
      const k = d.slots?.[id];
      if (!Number.isInteger(k) || k < 0 || k >= d.cards.length) continue;
      if (known.has(k)) {
        out.set(id, d.faces[known.get(k)]);
        continue;
      }
      const ds = [];
      let missing = false;
      for (const p of d.participants) {
        if (p.id === playerId && mine) {
          ds.push(keys.cards[k].d);
          continue;
        }
        const share = d.shares?.[k]?.[p.id];
        if (share?.open) ds.push(fromHex(share.open));
        else if (share?.to?.[playerId] && mine) {
          try {
            ds.push(fromHex(await open(keys.exchange.privateJwk, share.to[playerId])));
          } catch {
            missing = true;
          }
        } else missing = true;
        if (missing) {
          waiting.set(p.id, (waiting.get(p.id) ?? 0) + 1);
          break;
        }
      }
      if (missing) continue;
      let m = fromHex(d.cards[k]);
      for (const x of ds) m = decryptWith(m, x);
      const i = decoder(m);
      if (i == null) continue; // a key that doesn't fit: someone cheated, or keys were lost
      known.set(k, i);
      out.set(id, d.faces[i]);
    }
    return { looks: out, waiting };
  }

  /** A line about where things stand, for a status bar. */
  function status({ players, openSeats = [], nameOf = (id) => id }) {
    const d = doc();
    if (d.phase === "waiting") {
      const joined = new Set((d.participants ?? []).map((p) => p.id));
      const away = players.filter((id) => !joined.has(id));
      if (openSeats.length) return `The deck is shuffled once someone sits as ${openSeats.join(" and ")}.`;
      if (!players.length) return "The deck is shuffled once the players have sat down.";
      return away.length ? `Waiting for ${away.map(nameOf).join(", ")} to shuffle.` : "Starting the shuffle…";
    }
    if (d.phase === "shuffling") {
      const who = d.participants[d.turn]?.id;
      return `Shuffling: ${who === playerId ? "your" : `${nameOf(who)}'s`} turn (${d.pass === "forward" ? "1" : "2"} of 2).`;
    }
    return null;
  }

  return { step, reveal, status, get playerId() { return playerId; } };
}
