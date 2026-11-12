// The joint keeper (`scene:extension` "card-table"): what an object really
// is, kept in a secure deck (deck.js) that the seated players' clients
// shuffle between them, and shown only to whoever the scene says may see it.
// Built only from the stage's contract (scene/STAGE.md): who takes part
// comes from the `roster` convention (whoever owns seats contributes it),
// who may see what from api.audience, and what this viewer sees is
// looks() by the one rule (rule.js). It offers the `keeper` convention to
// whatever handles kept things (a table's Shuffle).
//
// An object is kept by its trait:  "card-table.kept": { by: <deck url>, slot: n }
// `slot` is the card's position in the deck. The binding is in the scene
// doc, so moving or drawing a kept thing is one change there and none here.
//
// THREAT MODEL (README.md has it in full).
// - Someone who opens the documents sees what the deck holds (the multiset
//   of items), which object is which position, how often each position has
//   been shuffled, and who has been handed keys for which position. Never
//   which item is where.
// - A player's client hands over its key for a position only when its own
//   reading of the scene says another may see it (api.audience): sealed to
//   the players in the audience, in the open when the audience is everyone.
//   When the audience is unknown (a listed package is missing here), it
//   hands over nothing.
// - A cheating client can't read a card without every other player's key.
//   It can stall a shuffle, corrupt its pass unproven, withhold a key it
//   owes, and forge unsigned writes (visible in the doc's history).
// - Anyone who can write the scene can change an audience (sit down, carry
//   a card into their tray, turn it over): no disclosure without a change
//   everyone can see. A key handed over stays handed over.
//
// For whatever sets a scene up, the module's `contain` (found through this
// plugin's `keeper: "joint"` in the scene:extension registry):
//
//   const { key, bind } = await contain({ repo }, { title, items });
//   object.traits = { ...bind(slot) };

import { createParticipant, newDeckDoc } from "./deck.js";
import { secretFor } from "./player-secret.js";
import { bindings, itemLook, lookFor } from "./rule.js";

export const TRAIT = "card-table.kept";

/**
 * Make a deck for `items` and say how to bind objects to it. The items are
 * public (what the deck holds); which is where is settled by the players'
 * first shuffle, once every seat is taken.
 * @param {{ repo: { create2(doc): Promise<{ url: string }> } }} host
 * @param {{ title?: string, items: any[] }} o
 * @returns {Promise<{ key: string, bind(slot: number): object }>}
 */
export async function contain({ repo }, { title, items }) {
  const handle = await repo.create2(newDeckDoc({ title: title || "Deck", faces: JSON.parse(JSON.stringify(items ?? [])) }));
  const key = handle.url;
  return { key, bind: (slot) => ({ [TRAIT]: { by: key, slot } }) };
}

/** The roster, from whoever contributes one (the seats' owner): who is playing, in this snapshot. */
function playing(api, scene) {
  const roster = api.collect("roster").map((r) => r?.value).find((r) => r && typeof r.viewers === "function");
  const safe = (fn, fallback) => {
    try {
      return fn() ?? fallback;
    } catch {
      return fallback;
    }
  };
  if (!roster) return { players: [], openSeats: [], nameOf: () => "someone" };
  return {
    players: safe(() => roster.viewers(scene), []),
    openSeats: safe(() => roster.open?.(scene), []),
    nameOf: (v) => safe(() => roster.nameOf?.(scene, v), null) ?? "someone",
  };
}

/** @param {object} api  @param {{ secret?: (viewer: string) => Promise<Uint8Array> | Uint8Array }} [o]  secret: the player's secret (default: their account's; player-secret.js) */
export function create(api, { secret } = {}) {
  const { repo, viewer } = api;
  const decks = new Map(); // url → { handle, participant, faces: Map slot → item, line, problem, off, queued, running, rerun }
  let bound = bindings({}, TRAIT);
  let scene = null;
  let looks = new Map();
  let dead = false;

  /** What the deck's protocol is told of the table, read from the stage as it is now. */
  function tableFor(url) {
    const slots = bound.slots.get(url) ?? new Map();
    const { players, openSeats, nameOf } = playing(api, scene);
    return {
      players,
      openSeats,
      nameOf,
      // the positions `player` may see (null: the ones everyone may), by this client's reading of
      // the scene now; an unknown audience (null) is nobody's
      visibleTo(player) {
        const out = [];
        for (const [slot, id] of slots) {
          const a = api.audience(id);
          if (player == null ? a === "all" : a === "all" || (Array.isArray(a) && a.includes(player))) out.push(slot);
        }
        return out;
      },
    };
  }

  const sameFaces = (a, b) => a.size === b.size && [...a].every(([k, f]) => JSON.stringify(b.get(k)) === JSON.stringify(f));

  async function step(url, deck) {
    deck.queued = false;
    if (dead || decks.get(url) !== deck || !deck.participant || !scene) return;
    // one at a time; whatever changed meanwhile gets one more pass
    if (deck.running) {
      deck.rerun = true;
      return;
    }
    deck.running = true;
    try {
      const t = tableFor(url);
      await deck.participant.step(t);
      if (dead) return;
      // what this viewer may see, of this deck's
      const mine = [];
      for (const [slot, id] of bound.slots.get(url) ?? []) {
        const a = api.audience(id);
        if (a === "all" || (Array.isArray(a) && a.includes(viewer))) mine.push(slot);
      }
      const { looks: next, waiting } = await deck.participant.reveal(mine);
      if (dead) return;
      let line = deck.participant.status(t);
      if (!line && waiting.size) {
        const n = [...waiting.values()].reduce((a, b) => a + b, 0);
        line = `Waiting for ${[...waiting.keys()].map(t.nameOf).join(", ")} to show you ${n} card${n === 1 ? "" : "s"}.`;
      }
      const changed = !sameFaces(next, deck.faces) || line !== deck.line;
      deck.faces = next;
      deck.line = line;
      if (changed) refresh();
    } catch (err) {
      console.warn("[card-table] deck step failed", err);
      deck.line = null;
      deck.problem = `${deck.handle?.doc()?.title || "A deck"} hit a problem: ${err?.message ?? err}`;
      refresh();
    } finally {
      deck.running = false;
      if (deck.rerun) {
        deck.rerun = false;
        soon(url, deck);
      }
    }
  }

  // coalesce: scene syncs and deck changes come in bursts
  function soon(url, deck) {
    if (deck.queued || dead) return;
    deck.queued = true;
    queueMicrotask(() => step(url, deck));
  }

  // something learned (a face, a status), or a deck arrived: read the lens again, and have the stage look
  function refresh() {
    if (dead) return;
    lens();
    api.schedule(() => {});
  }

  function watch(urls) {
    for (const [url, d] of decks) {
      if (urls.has(url)) continue;
      d.off?.();
      decks.delete(url);
    }
    for (const url of urls) {
      if (decks.has(url)) continue;
      const deck = { handle: null, participant: null, faces: new Map(), line: null, problem: null, off: null, queued: false, running: false, rerun: false };
      decks.set(url, deck);
      (async () => {
        const h = await repo.find(url);
        if (dead || decks.get(url) !== deck) return;
        if (!Array.isArray(h?.doc?.()?.faces)) throw new Error("it isn't a secure deck");
        deck.handle = h;
        deck.participant = createParticipant({ handle: h, playerId: viewer, secret: () => (secret ? secret(viewer) : secretFor({ repo, viewer })) });
        const onChange = () => {
          // the doc's public state decides whether anything can be shown (dealt): look at once, then step
          refresh();
          soon(url, deck);
        };
        h.on?.("change", onChange);
        deck.off = () => h.off?.("change", onChange);
        refresh();
        soon(url, deck);
      })().catch((err) => {
        console.warn("[card-table] deck unavailable", url, err);
        deck.problem = `Some things here can't be shown: ${err?.message ?? err}`;
        refresh();
      });
    }
  }

  function lens() {
    const next = new Map();
    for (const [id, { key, slot }] of bound.of) {
      const deck = decks.get(key);
      // nothing is anyone's until the players' first shuffle is done: every card closed
      const ready = !!deck?.participant && deck.participant.dealt();
      const look = lookFor({ ready, audience: api.audience(id), shown: api.shown(id), viewer, look: ready && deck.faces.has(slot) ? itemLook(deck.faces.get(slot)) : null });
      if (look) next.set(id, look);
    }
    looks = next;
  }

  const titleOf = (key) => decks.get(key)?.handle?.doc?.()?.title ?? null;

  return {
    // Who is seated and who may see what are functions of the doc, of what's running and of which
    // packages are here (scene/STAGE.md, "Audience"): step again when any of those changed, and
    // not when only what's drawn did (a pose streaming by, sixty times a second).
    update(snapshot, local, prev) {
      if (prev && snapshot === prev.scene && local?.running === prev.local?.running && local?.packages === prev.local?.packages) return;
      scene = snapshot;
      bound = bindings(snapshot.objects, TRAIT);
      watch(new Set(bound.slots.keys()));
      lens();
      for (const [url, deck] of decks) soon(url, deck);
    },
    looks: () => looks,
    hud() {
      const out = [];
      for (const deck of decks.values()) {
        // a deck's status (waiting for players, shuffling) is news, not trouble
        if (deck.problem) out.push({ text: deck.problem, state: "error" });
        else if (deck.line) out.push({ text: deck.line, state: "info" });
      }
      if (bound.clashes.length) out.push({ text: `${bound.clashes.length === 1 ? "An object claims" : `${bound.clashes.length} objects claim`} a position something else already has: ${bound.clashes.length === 1 ? "it stays" : "they stay"} closed.`, state: "error" });
      return out;
    },
    // for whatever handles kept things (api.collect("keeper")); the stage never reads it
    keeper: Object.freeze({
      kind: "joint",
      /** the deck an object is kept in, or null when it isn't this keeper's */
      of: (id) => bound.of.get(id)?.key ?? null,
      /** a deck's name for people, once it's loaded */
      name: titleOf,
      /** ask for what these objects are to be shuffled among themselves (those of the first one's deck), by every player in turn: how many, 0 when there's nothing to do */
      shuffle(ids) {
        const mine = [...new Set(ids ?? [])].map((id) => bound.of.get(id)).filter(Boolean);
        const key = mine[0]?.key;
        const deck = key ? decks.get(key) : null;
        if (!deck?.participant) return 0;
        return deck.participant.shuffle(mine.filter((b) => b.key === key).map((b) => b.slot));
      },
    }),
    dispose() {
      dead = true;
      for (const d of decks.values()) d.off?.();
      decks.clear();
    },
  };
}

export default { create, contain };
