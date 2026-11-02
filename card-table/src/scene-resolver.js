// The secure deck as a scene's secrets provider (`scene:secrets` for
// "secure-deck" docs; see scene/README.md, "Hidden objects"). The scene says
// who is seated and who may see which object; this runs the deck's protocol
// for this viewer and hands back the faces it can decrypt.
//
// A resolver: update(ctx) on every scene change, looks() → Map objectId →
// face ({ sourceUrl, name }), status() → string | null, dispose().

import { createParticipant, localKeyStore } from "./deck.js";

/**
 * @param {{ handle, viewer: string, onChange: () => void, keyStore? }} o
 *   handle: the secure-deck doc; viewer: this client's player id (the scene's)
 */
export function createResolver({ handle, viewer, onChange, keyStore = localKeyStore() }) {
  const participant = createParticipant({ handle, playerId: viewer, keyStore });
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
        const n = [...waiting.values()].reduce((a, b) => Math.max(a, b), 0);
        status = `Waiting for ${[...waiting.keys()].map(c.nameOf).join(", ")} to show you ${n} card${n === 1 ? "" : "s"}.`;
      }
      if (!sameLooks(next, looks) || status !== line) {
        looks = next;
        line = status;
        onChange?.();
      }
    } catch (err) {
      console.warn("[card-table] deck step failed", err);
      line = `The deck hit a problem: ${err?.message ?? err}`;
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
    dispose() {
      dead = true;
      handle.off?.("change", soon);
    },
  };
}
