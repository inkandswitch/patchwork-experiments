// The plain keeper's container: a document anyone who opens it can read.
//
//   { "@patchwork": { type: "keep-plain" }, title,
//     items: any[],      // what is kept: any JSON (a scene puts { sourceUrl, name } here)
//     at: number[] }     // slot k holds items[at[k]]
//
// A scene object names a slot (trait keep.plain: { by: <this doc>, slot }),
// so which object is which item is `at`, and a shuffle is a new `at`,
// assigned whole: written index by index, two shuffles at once could merge
// into a mix of both (one item twice, another gone); as one value the merge
// keeps one shuffle whole and drops the other. `items` is never rewritten.
//
// Pure, but for the handle a shuffle writes through.

export const PLAIN = "keep-plain";
export const DEFAULT_TITLE = "Kept things";

/** A new container doc, whole (for repo.create2): slot k holds item k. */
export function newPlain({ title = DEFAULT_TITLE, items = [] } = {}) {
  const list = JSON.parse(JSON.stringify(items ?? []));
  return { "@patchwork": { type: PLAIN }, title: String(title || DEFAULT_TITLE), items: list, at: list.map((_, k) => k) };
}

/** Is `at` a permutation of the items' indices? (A doc someone edited by hand may not be.) */
export function wellFormed(doc) {
  const n = Array.isArray(doc?.items) ? doc.items.length : -1;
  if (n < 0 || !Array.isArray(doc.at) || doc.at.length !== n) return false;
  const seen = new Set();
  for (const i of doc.at) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

/** What slot `k` holds, or undefined (no such slot, or a doc that isn't well formed). */
export function itemAt(doc, k) {
  if (!wellFormed(doc) || !Number.isInteger(k) || k < 0 || k >= doc.at.length) return undefined;
  return doc.items[doc.at[k]];
}

/**
 * `at` with these slots' items permuted among themselves (Fisher–Yates with
 * the caller's random numbers); every other slot as it was. Pure.
 * @param {number[]} at  @param {Iterable<number>} slots  @param {() => number} random
 */
export function shuffled(at, slots, random = Math.random) {
  const which = [...new Set(slots)].filter((k) => Number.isInteger(k) && k >= 0 && k < at.length).sort((a, b) => a - b);
  const held = which.map((k) => at[k]);
  for (let i = held.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [held[i], held[j]] = [held[j], held[i]];
  }
  const next = [...at];
  which.forEach((k, i) => (next[k] = held[i]));
  return next;
}

/** Shuffle these slots' items among themselves, in the doc: how many (0: fewer than two, or a doc that isn't well formed). */
export function shuffleSlots(handle, slots, random = Math.random) {
  const doc = handle.doc();
  if (!wellFormed(doc)) return 0;
  const which = [...new Set(slots)].filter((k) => Number.isInteger(k) && k >= 0 && k < doc.at.length);
  if (which.length < 2) return 0;
  handle.change((d) => {
    d.at = shuffled([...d.at], which, random);
  });
  return which.length;
}

export const PlainDatatype = {
  init(doc) {
    doc.title = DEFAULT_TITLE;
    doc.items = [];
    doc.at = [];
  },
  getTitle(doc) {
    return doc?.title || DEFAULT_TITLE;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
