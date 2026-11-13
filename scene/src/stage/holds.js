// Pose holds in one view, and the one order they go in (TOOLS.md §7, "A
// person and a process on one object"; STAGE.md, "Holding a pose").
//
// An object has at most one holder in a view, and every view agrees on one
// across them. Holds are ranked by (a person's before a yielding one, then
// `since`): presence.js `ranksAhead`, the same everywhere. A yielding hold
// is a process's that gives way to a person: a hull nobody steers, a door
// closing itself. So:
//
// - here, a hold by another extension stands unless it yields and the new
//   one doesn't: a person takes an object from a process, never the other
//   way, and of two of a kind the first stays (no silent last-hold-wins);
// - across views, a hold is refused while a peer's ranks ahead of it
//   (presence.heldBy), and one this view has is dropped as soon as a peer's
//   does (reconcile), so its holder's next hold is refused.
//
// hold() says whether the hold stands. A refused hold changes nothing, and
// the extension that lost an object it held hears of it through `lost`, so
// the stage can stop counting it as that extension's. Nothing here draws:
// `shown` and `unshown` are the stage's (the viewport's pose, peers' playback).

/**
 * May a hold by `ext` (yielding or not) be taken where `cur` holds the
 * object in this view? "keep": it's `ext`'s own; "take": `cur` yields to
 * it; "refuse": `cur` stands. Pure.
 * @param {{ ext: string, yields: boolean } | null | undefined} cur
 * @param {string} ext
 * @param {boolean} yields
 * @returns {"keep" | "take" | "refuse"}
 */
export function localTake(cur, ext, yields) {
  if (!cur) return "take";
  if (cur.ext === ext) return "keep";
  return cur.yields && !yields ? "take" : "refuse";
}

/**
 * @param {{
 *   presence: { hold(ext, id, parent, transform, yields): void, release(ext, id, landed?): void, heldBy(id, o?: { yields?: boolean }): string | null },
 *   exists: (id: string) => boolean,          // an object a pose can be held on (not a group)
 *   parentOf: (id: string) => string | null,  // its doc parent, as the stage resolves it
 *   shown?: (id: string, transform: object) => void,
 *   unshown?: (id: string) => void,
 *   lost?: (ext: string, id: string) => void,  // an extension no longer holds this (taken from it here, or a peer's ranks ahead)
 * }} o
 */
export function createHolds({ presence, exists, parentOf, shown = () => {}, unshown = () => {}, lost = () => {} }) {
  const local = new Map(); // object id → { ext, yields }

  function drop(id, cur, landed) {
    local.delete(id);
    presence.release(cur.ext, id, landed);
  }

  /**
   * Hold an object's pose for an extension. True when the hold stands.
   * @param {string} ext @param {string} id @param {object} transform  (normalized by the caller)
   * @param {{ yields?: boolean }} [o]
   */
  function hold(ext, id, transform, { yields = false } = {}) {
    if (!exists(id)) return false;
    const y = !!yields;
    const cur = local.get(id) ?? null;
    const how = localTake(cur, ext, y);
    if (how === "refuse") return false;
    if (how === "take" && cur) {
      // taken from a process here: its hold goes first, so the new one is ranked as begun now
      drop(id, cur);
      lost(cur.ext, id);
    }
    if (presence.heldBy(id, { yields: y }) != null) {
      // a peer's ranks ahead: refused (and ours, if it was ours, goes)
      if (how === "keep") {
        drop(id, cur);
        lost(ext, id);
        unshown(id);
      } else if (cur) unshown(id);
      return false;
    }
    local.set(id, { ext, yields: y });
    presence.hold(ext, id, parentOf(id), transform, y);
    shown(id, transform);
    return true;
  }

  /** Let go of an extension's hold: put back, or (with the doc's transform) landed. */
  function release(ext, id, landed) {
    const cur = local.get(id);
    if (!cur || cur.ext !== ext) return false;
    drop(id, cur, landed);
    unshown(id);
    return true;
  }

  /** Peers' holds on these objects changed: any of ours a peer's now ranks ahead of goes. */
  function reconcile(ids) {
    for (const id of ids) {
      const cur = local.get(id);
      if (!cur || presence.heldBy(id, { yields: cur.yields }) == null) continue;
      drop(id, cur);
      lost(cur.ext, id);
      unshown(id);
    }
  }

  return {
    hold,
    release,
    reconcile,
    /** the extension holding this object here, or null */
    holderOf: (id) => local.get(id)?.ext ?? null,
    /** does this view's hold on it yield? (null: none) */
    yieldsOf: (id) => (local.has(id) ? local.get(id).yields : null),
    has: (id) => local.has(id),
  };
}
