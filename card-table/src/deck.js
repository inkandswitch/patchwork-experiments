// A secure deck: shuffles nobody can see through, on demand, and reveals that
// follow what the table shows. Plain JS; the host (a scene, a standalone deck
// view, an agent) says who is playing and who may see which card, and calls
// step().
//
// The doc (type "secure-deck"):
//   faces        the deck's contents, public: anything JSON (a scene puts
//                { sourceUrl, name } here). Only which card is where is secret.
//   back         what a hidden card looks like: { sourceUrl, name, bounds? }
//   slots        { [slotId]: offset }: which position each of the host's
//                things is (a scene's object ids)
//   phase        "waiting" (players joining) → "playing"
//   participants [{ id, exchangeKey }] in turn order; fixed once playing
//   cards        hex[]: card k, locked under every participant's key for (k, epochs[k])
//   epochs       { [offset]: n }: how many times card k has been shuffled; 0 = never
//                (still in the clear, shown to nobody)
//   queue        [{ id, offsets }]: shuffles asked for, run one at a time
//   op           the shuffle under way: { id, offsets, pass, turn, working, fresh }
//   shares       { [offset]: { epoch, by: { [participantId]: { open?: hex, to?: { [recipientId]: envelope } } } } }
//
// A shuffle of some cards K, by every participant in turn, three passes:
//   unify  each swaps their own key on each card for one key of theirs for this
//          shuffle (positions are still known, so they can find their keys);
//          skipped when K has never been shuffled (it's in the clear)
//   mix    each locks every card again under a fresh key and permutes them
//   rekey  each removes their shuffle keys and puts a key for each card's new
//          position (epoch + 1) on it
// Afterwards nobody knows which card is where in K. Keys come from each
// player's secret (derive.js), so any of their devices has them.
//
// A participant hands over its key for a card only when the host's
// visibleTo() says another player may see it: sealed to that player for a card
// in their hand, in the open for a card face up. No requests: nobody can ask
// for a card they can't see.

import { GROUP_ID, Q, cardDecoder, encodeCard, fromHex, modpow, shuffle, toHex } from "./crypto/group.js";
import { open, playerKeys, seal } from "./crypto/derive.js";

export const DATATYPE = "secure-deck";

/** A fresh deck doc (for repo.create2). */
export function newDeckDoc({ title = "Deck", faces = [], back = null, slots = {} } = {}) {
  return {
    "@patchwork": { type: DATATYPE },
    title,
    group: GROUP_ID,
    faces,
    back,
    slots,
    phase: "waiting",
    participants: [],
    cards: null,
    epochs: {},
    queue: [],
    op: null,
    shares: {},
  };
}

const newOpId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * One player (or onlooker) at a deck.
 * @param {{ handle, playerId: string | null, secret: Uint8Array | (() => Promise<Uint8Array>) | null }} o
 *   handle: the deck doc's handle; playerId: who this client is (null: just watching);
 *   secret: the player's secret (or how to get it), from which every key is derived
 */
export function createParticipant({ handle, playerId, secret }) {
  let keys = null;
  const known = new Map(); // `${offset}:${epoch}` → face index (it never changes)
  let decoder = null;
  const deckId = handle.url;

  const doc = () => handle.doc() ?? {};
  const me = () => doc().participants?.find((p) => p.id === playerId) ?? null;
  const epochOf = (d, k) => Number(d.epochs?.[k] ?? 0);

  async function myKeys() {
    if (keys || !playerId || !secret) return keys;
    keys = playerKeys(typeof secret === "function" ? await secret() : secret);
    return keys;
  }

  async function join() {
    const { X } = await (await myKeys()).exchange(deckId);
    if (doc().phase !== "waiting" || me()) return;
    handle.change((d) => {
      if (d.phase !== "waiting" || d.participants.some((p) => p.id === playerId)) return;
      d.participants.push({ id: playerId, exchangeKey: toHex(X) });
    });
  }

  function begin(players) {
    const n = doc().faces?.length ?? 0;
    handle.change((d) => {
      if (d.phase !== "waiting") return;
      // turn order: the players, by id; anyone who joined but isn't playing is dropped
      const order = [...players].sort();
      const byId = new Map(d.participants.map((p) => [p.id, p]));
      if (!order.every((id) => byId.has(id))) return;
      d.participants = order.map((id) => ({ id, exchangeKey: byId.get(id).exchangeKey }));
      d.phase = "playing";
      d.cards = Array.from({ length: n }, (_, i) => toHex(encodeCard(i)));
      d.epochs = {};
      // the first shuffle: every card
      d.queue = [{ id: `deal-${newOpId()}`, offsets: Array.from({ length: n }, (_, i) => i) }, ...(d.queue ?? [])];
    });
  }

  /** Start the next queued shuffle, if none is running. Anyone may; the guard makes it once. */
  function startNext() {
    const d0 = doc();
    if (d0.phase !== "playing" || d0.op || !d0.queue?.length) return; // write only when there's work
    handle.change((d) => {
      if (d.phase !== "playing" || d.op || !d.queue?.length) return;
      const next = d.queue[0];
      const offsets = [...new Set(next.offsets)].filter((k) => Number.isInteger(k) && k >= 0 && k < d.cards.length);
      d.queue.splice(0, 1);
      if (offsets.length < 2) return;
      const fresh = offsets.every((k) => Number(d.epochs?.[k] ?? 0) === 0);
      d.op = { id: next.id, offsets, pass: fresh ? "mix" : "unify", turn: 0, working: offsets.map((k) => d.cards[k]), fresh };
    });
  }

  async function takeTurn() {
    const d0 = doc();
    const op = d0.op;
    const { id, pass, turn, offsets } = op;
    const k_ = await myKeys();
    const input = op.working.map(fromHex);
    let output;
    if (pass === "unify") {
      const u = await k_.unify(deckId, id);
      output = [];
      for (let j = 0; j < offsets.length; j++) {
        const c = await k_.card(deckId, offsets[j], epochOf(d0, offsets[j]));
        output.push(modpow(input[j], (c.d * u.e) % Q));
      }
    } else if (pass === "mix") {
      const g = await k_.mix(deckId, id);
      output = shuffle(input.map((c) => modpow(c, g.e)));
    } else {
      const g = await k_.mix(deckId, id);
      const u = op.fresh ? { d: 1n } : await k_.unify(deckId, id);
      output = [];
      for (let j = 0; j < offsets.length; j++) {
        const h = await k_.card(deckId, offsets[j], epochOf(d0, offsets[j]) + 1);
        output.push(modpow(input[j], (((g.d * u.d) % Q) * h.e) % Q));
      }
    }
    const last = turn === d0.participants.length - 1;
    const nextPass = { unify: "mix", mix: "rekey", rekey: null }[pass];
    handle.change((d) => {
      // someone (another device of ours) got there first
      if (!d.op || d.op.id !== id || d.op.pass !== pass || d.op.turn !== turn) return;
      const hex = output.map(toHex);
      if (!last) {
        d.op.turn = turn + 1;
        d.op.working = hex;
      } else if (nextPass) {
        d.op.pass = nextPass;
        d.op.turn = 0;
        d.op.working = hex;
      } else {
        // done: the cards take their new places, one epoch on; old shares are void
        offsets.forEach((k, j) => {
          d.cards[k] = hex[j];
          if (!d.epochs) d.epochs = {};
          d.epochs[k] = Number(d.epochs[k] ?? 0) + 1;
          if (d.shares?.[k]) delete d.shares[k];
        });
        d.op = null;
      }
    });
  }

  const busy = (d) => new Set(d.op?.offsets ?? []);

  /** The offsets of these slots that can be shown: shuffled at least once, and not being shuffled now. */
  const showable = (d, ids) => {
    const out = new Set();
    const now = busy(d);
    for (const id of ids ?? []) {
      const k = d.slots?.[id];
      if (Number.isInteger(k) && k >= 0 && k < (d.cards?.length ?? 0) && epochOf(d, k) > 0 && !now.has(k)) out.add(k);
    }
    return out;
  };

  /** This participant's share of card k as it stands now, if any (old epochs don't count). */
  const shareOf = (d, k, who) => (d.shares?.[k]?.epoch === epochOf(d, k) ? d.shares[k].by?.[who] : undefined);

  /** Hand over our keys for whatever the table says others may now see. */
  async function deliver(visibleTo) {
    const d = doc();
    const k_ = await myKeys();
    const pub = showable(d, visibleTo(null));
    const writes = [];
    for (const k of pub) if (!shareOf(d, k, playerId)?.open) writes.push({ k, epoch: epochOf(d, k), open: toHex((await k_.card(deckId, k, epochOf(d, k))).d) });
    for (const other of d.participants) {
      if (other.id === playerId || !other.exchangeKey) continue;
      for (const k of showable(d, visibleTo(other.id))) {
        const mine = shareOf(d, k, playerId);
        if (pub.has(k) || mine?.open || mine?.to?.[other.id]) continue;
        const key = await k_.card(deckId, k, epochOf(d, k));
        writes.push({ k, epoch: epochOf(d, k), to: other.id, envelope: await seal(fromHex(other.exchangeKey), toHex(key.d)) });
      }
    }
    if (!writes.length) return;
    handle.change((dd) => {
      if (!dd.shares) dd.shares = {};
      for (const w of writes) {
        // the card may have been reshuffled meanwhile: then this key is no use
        if (Number(dd.epochs?.[w.k] ?? 0) !== w.epoch || dd.op?.offsets?.includes(w.k)) continue;
        if (dd.shares[w.k]?.epoch !== w.epoch) dd.shares[w.k] = { epoch: w.epoch, by: {} };
        const by = dd.shares[w.k].by;
        if (!by[playerId]) by[playerId] = {};
        if (w.open) by[playerId].open = w.open;
        else {
          if (!by[playerId].to) by[playerId].to = {};
          by[playerId].to[w.to] = w.envelope;
        }
      }
    });
  }

  let running = null;
  let again = null;
  /**
   * Do whatever this player should do now: join, start playing, start a
   * queued shuffle, take a turn in one, hand over keys. Safe to call on every
   * change; runs one at a time.
   * @param {{ players: string[], openSeats?: string[], visibleTo: (playerId: string | null) => Iterable<string> }} ctx
   *   players: who must be in it (e.g. everyone seated); openSeats: places still
   *   waiting for a player (it waits for them: its players are fixed once it starts);
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
        again = null;
        await step(next);
      }
    })();
    return running;
  }

  async function stepOnce({ players, openSeats = [], visibleTo }) {
    if (!playerId || !secret) return;
    if (doc().phase === "waiting") {
      if (players.includes(playerId) && !me()) await join();
      const joined = new Set(doc().participants.map((p) => p.id));
      const ready = !openSeats.length && players.length > 0 && players.every((id) => joined.has(id));
      // the first player in turn order starts it, so only one does
      if (ready && [...players].sort()[0] === playerId) begin(players);
    }
    if (doc().phase !== "playing" || !me()) return;
    startNext();
    const d = doc();
    if (d.op && d.participants[d.op.turn]?.id === playerId) {
      await takeTurn();
      // the next turn may be ours too (or the next pass, or the next shuffle)
      return stepOnce({ players, openSeats, visibleTo });
    }
    await deliver(visibleTo);
  }

  /** Ask for these slots' cards to be shuffled among themselves (by everyone in turn, once the table is playing). */
  function shuffleSlots(ids) {
    const d = doc();
    const offsets = [...new Set((ids ?? []).map((id) => d.slots?.[id]).filter((k) => Number.isInteger(k)))];
    if (offsets.length < 2) return 0;
    handle.change((dd) => {
      if (!dd.queue) dd.queue = [];
      dd.queue.push({ id: newOpId(), offsets });
    });
    return offsets.length;
  }

  /**
   * What this client can see: slot id → face, for the slots in `ids` it has
   * every key for (its own, and everyone else's open or sealed to it). Also
   * how many it is still waiting on, and from whom.
   */
  async function reveal(ids) {
    const d = doc();
    const looks = new Map();
    const waiting = new Map(); // participant id → count of cards we lack their key for
    if (d.phase !== "playing" || !d.cards) return { looks, waiting };
    if (!decoder) decoder = cardDecoder(d.faces.length);
    const mine = me() && (await myKeys());
    const ids_ = [...(ids ?? [])];
    const offsets = showable(d, ids_);
    for (const id of ids_) {
      const k = d.slots?.[id];
      if (!offsets.has(k)) continue;
      const epoch = epochOf(d, k);
      const cacheKey = `${k}:${epoch}`;
      if (known.has(cacheKey)) {
        looks.set(id, d.faces[known.get(cacheKey)]);
        continue;
      }
      const ds = [];
      let missing = null;
      for (const p of d.participants) {
        if (p.id === playerId && mine) {
          ds.push((await mine.card(deckId, k, epoch)).d);
          continue;
        }
        const share = shareOf(d, k, p.id);
        if (share?.open) ds.push(fromHex(share.open));
        else if (share?.to?.[playerId] && mine) {
          try {
            ds.push(fromHex(await open((await mine.exchange(deckId)).x, share.to[playerId])));
          } catch {
            missing = p.id;
          }
        } else missing = p.id;
        if (missing) break;
      }
      if (missing) {
        waiting.set(missing, (waiting.get(missing) ?? 0) + 1);
        continue;
      }
      let m = fromHex(d.cards[k]);
      for (const x of ds) m = modpow(m, x);
      const i = decoder(m);
      if (i == null) continue; // a key that doesn't fit: someone cheated, or a secret changed
      known.set(cacheKey, i);
      looks.set(id, d.faces[i]);
    }
    return { looks, waiting };
  }

  /** A line about where things stand, for a status bar (null when there's nothing to say). */
  function status({ players, openSeats = [], nameOf = (id) => id }) {
    const d = doc();
    if (d.phase === "waiting") {
      const joined = new Set((d.participants ?? []).map((p) => p.id));
      const away = players.filter((id) => !joined.has(id));
      if (openSeats.length) return `${d.title || "The deck"} is shuffled once someone sits as ${openSeats.join(" and ")}.`;
      if (!players.length) return `${d.title || "The deck"} is shuffled once the players have sat down.`;
      return away.length ? `Waiting for ${away.map(nameOf).join(", ")} to shuffle ${d.title || "the deck"}.` : `Starting to shuffle ${d.title || "the deck"}…`;
    }
    if (d.op) {
      const who = d.participants[d.op.turn]?.id;
      const passes = d.op.fresh ? ["mix", "rekey"] : ["unify", "mix", "rekey"];
      return `Shuffling ${d.op.offsets.length} cards of ${d.title || "the deck"}: ${who === playerId ? "your" : `${nameOf(who)}'s`} turn (${passes.indexOf(d.op.pass) + 1} of ${passes.length})${d.queue?.length ? `, ${d.queue.length} more to go` : ""}.`;
    }
    if (d.queue?.length) return `A shuffle of ${d.title || "the deck"} is about to start.`;
    return null;
  }

  return { step, reveal, status, shuffle: shuffleSlots, get playerId() { return playerId; } };
}
