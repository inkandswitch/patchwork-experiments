// The exit itself: reading the trait, and what its verb is where. Pure.
//
//   "traversal.exit": { to?: "automerge:…", verb?: string }
//
// - `to` is where it leads: a document link (an automerge URL, as the
//   inspector's url fields take one; anything after it, a `#…`, is passed on
//   as it is). Anything else, or a link to the document the exit is in, leads
//   nowhere, and an exit that leads nowhere offers no verb, anywhere.
// - `verb` is what using it is called ("Go below", "Exit"); "Go" when it's
//   missing or blank. At most 40 characters are shown.

export const KEY = "traversal.exit";

/** The verb when the trait names none. */
export const DEFAULT_VERB = "Go";

const VERB_MAX = 40;
const LINK = /^automerge:[1-9A-HJ-NP-Za-km-z]+/;

/** A document link's document (the link without what follows its id), or null. */
export const docOf = (url) => (typeof url === "string" && LINK.test(url) ? url.match(LINK)[0] : null);

/**
 * Where an exit leads, or null when nowhere: no link, not a document link,
 * or a link to `here` (the document it's in; `here` null: nowhere is here).
 * @param {object | null | undefined} trait
 * @param {string | null} [here]
 * @returns {string | null}  the link, trimmed, as written
 */
export function destinationOf(trait, here = null) {
  const to = typeof trait?.to === "string" ? trait.to.trim() : null;
  const doc = docOf(to);
  if (!doc) return null;
  if (here != null && doc === docOf(here)) return null;
  return to;
}

/** What using an exit is called: its `verb`, trimmed and at most 40 characters, else "Go". */
export function verbOf(trait) {
  const v = typeof trait?.verb === "string" ? trait.verb.trim() : "";
  return v ? v.slice(0, VERB_MAX) : DEFAULT_VERB;
}

/**
 * The verb for a target, or null: an object (by id) with the trait that
 * leads somewhere. Reach is the stage's (the command says `reach: true`).
 * @param {{ objects?: object } | null} scene  the snapshot
 * @param {string | null} target
 * @param {{ here?: string | null }} o
 * @returns {{ label: string, to: string } | null}
 */
export function exitVerb(scene, target, { here = null } = {}) {
  if (typeof target !== "string") return null;
  const o = scene?.objects?.[target];
  if (!o || o.kind === "group") return null;
  const trait = o.traits?.[KEY];
  if (!trait) return null;
  const to = destinationOf(trait, here);
  if (!to) return null;
  return { label: verbOf(trait), to };
}
