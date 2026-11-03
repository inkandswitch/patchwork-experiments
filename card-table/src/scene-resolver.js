// The secure deck in a scene: the `scene:secrets` provider for "secure-deck"
// docs (see scene/README.md, "Hidden objects and decks"). A scene can hold any number
// of decks; each gets its own resolver. The scene says who is seated and who
// may see which object; this runs the deck's protocol for this viewer and
// hands back the faces it can decrypt.
//
// A resolver: update(ctx) on every scene change, looks() → Map objectId →
// face ({ sourceUrl, name }), status() → string | null, shuffle(ids),
// dispose(). The module also says how to lay a deck out when it is dropped
// on a scene: placement(doc) and bind(handle, ids).

import { createParticipant } from "./deck.js";
import { secretFor } from "./player-secret.js";

/**
 * @param {{ repo, handle, viewer: string, onChange: () => void, secret? }} o
 *   handle: the secure-deck doc; viewer: this client's player id (the scene's);
 *   secret: the player's secret (default: their account's; see player-secret.js)
 */
export function createResolver({ repo, handle, viewer, onChange, secret }) {
  const participant = createParticipant({ handle, playerId: viewer, secret: secret ?? (() => secretFor({ repo, viewer })) });
  let ctx = null;
  let looks = new Map();
  let line = null;
  let dead = false;
  let queued = false;
  let running = false;
  let rerun = false;

  const sameLooks = (a, b) => a.size === b.size && [...a].every(([id, f]) => b.get(id)?.sourceUrl === f?.sourceUrl && b.get(id)?.name === f?.name);

  async function refresh() {
    queued = false;
    if (dead || !ctx) return;
    // one at a time; whatever changed meanwhile gets one more pass
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    const c = ctx;
    try {
      await participant.step(c);
      if (dead) return;
      const mine = new Set([...c.visibleTo(viewer), ...c.visibleTo(null)]);
      const { looks: next, waiting } = await participant.reveal(mine);
      if (dead) return;
      let status = participant.status({ players: c.players, openSeats: c.openSeats, nameOf: c.nameOf });
      if (!status && waiting.size) {
        const n = [...waiting.values()].reduce((a, b) => a + b, 0);
        status = `Waiting for ${[...waiting.keys()].map(c.nameOf).join(", ")} to show you ${n} card${n === 1 ? "" : "s"}.`;
      }
      if (!sameLooks(next, looks) || status !== line) {
        looks = next;
        line = status;
        onChange?.();
      }
    } catch (err) {
      console.warn("[card-table] deck step failed", err);
      line = `${handle.doc()?.title || "A deck"} hit a problem: ${err?.message ?? err}`;
      onChange?.();
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        soon();
      }
    }
  }

  // coalesce: scene syncs and deck changes come in bursts
  function soon() {
    if (queued || dead) return;
    queued = true;
    queueMicrotask(refresh);
  }

  handle.on?.("change", soon);
  return {
    update(c) {
      ctx = c;
      soon();
    },
    looks: () => looks,
    status: () => line,
    /** Shuffle these objects' cards among themselves; how many it will shuffle (0: nothing to do). */
    shuffle: (ids) => participant.shuffle(ids),
    dispose() {
      dead = true;
      handle.off?.("change", soon);
    },
  };
}

/**
 * How to lay this deck out on a scene it was dropped on: one hidden object per
 * card, face down in a stack, each looking like `back`. null when it can't be
 * (no back to show) or is already on a table (it has slots).
 * @returns {{ name: string, count: number, look: { sourceUrl, name }, bounds?: { min, max } } | null}
 */
export function placement(doc) {
  if (!doc?.back?.sourceUrl || !doc.faces?.length) return null;
  if (Object.keys(doc.slots ?? {}).length) return null;
  return { name: doc.title || "Deck", count: doc.faces.length, look: { sourceUrl: doc.back.sourceUrl, name: doc.back.name || "Card" }, bounds: doc.back.bounds ?? null };
}

/** The objects the scene made for it, in deck order: card k is ids[k]. */
export function bind(handle, ids) {
  handle.change((d) => {
    if (Object.keys(d.slots ?? {}).length) return;
    d.slots = Object.fromEntries(ids.map((id, k) => [id, k]));
  });
}
