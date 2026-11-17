// The bag datatype: a token bag as a document. README.md has the shape; the
// contents are read and written only through contents.js.

import { BAG } from "./contents.js";
import { DEFAULT_RULE } from "./draw.js";

/** What a new bag looks like: a cloth sack 20 cm across (metres, at real size). */
export const DEFAULT_LOOK = Object.freeze({ color: "#7a5a3a", size: 0.2 });
export const DEFAULT_TITLE = "Token bag";

/** A bag doc's look, every field filled in and within reason. */
export function lookOf(doc) {
  const l = doc?.look ?? {};
  const size = Number(l.size);
  return {
    color: /^#[0-9a-f]{6}$/i.test(String(l.color ?? "")) ? String(l.color).toLowerCase() : DEFAULT_LOOK.color,
    size: Number.isFinite(size) && size > 0 ? Math.min(2, Math.max(0.02, size)) : DEFAULT_LOOK.size,
  };
}

/** A new bag doc, whole (for repo.create2). `items` is made here and nowhere else. */
export function newBag(over = {}) {
  return { "@patchwork": { type: BAG }, title: DEFAULT_TITLE, look: { ...DEFAULT_LOOK }, rule: DEFAULT_RULE, items: {}, ...over };
}

export const BagDatatype = {
  init(doc) {
    const fresh = newBag();
    for (const [k, v] of Object.entries(fresh)) if (k !== "@patchwork") doc[k] = v;
  },
  getTitle(doc) {
    return doc?.title || DEFAULT_TITLE;
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  // a copy is another bag, and an item is in one place: the copy starts empty
  // (the same items in two bags would be two of each)
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || DEFAULT_TITLE}`;
    doc.items = {};
  },
};
