// The `stickers` channel and the sticker vocabulary, owned by the Stickers
// card. Sticker sources write their slice keyed by target *document* url; the
// renderer (./renderer.js, published by this card into `codemirror:extensions`
// while it is face-up) reads `stickers[docUrl]`. Sticker values live inline
// (plain JSON).
//
// This module is the canonical definition — source cards import it (by this
// package's automerge url) instead of restating the shape. The scanning engine
// they build on lives in ./engine.js.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy";

/**
 * A sticker annotates a target with some UI. What's shared across all kinds is
 * a `target` — an automerge url (path-aware, so it can point at a range inside
 * a document via `handle.sub(...).url`) naming where the sticker lands.
 *
 * `slot` is a target-specific hint for *where* in that target's UI the sticker
 * renders ("before", "after", "replace"; unknown slots fall back to the
 * target's default). `style` is the exception — it decorates the target range
 * itself and carries no slot.
 *
 * @typedef {{ type: "style", styles: Record<string, string>, target: string }} StyleSticker
 * @typedef {{ type: "text", text: string, target: string, slot: string,
 *   styles?: Record<string, string> }} TextSticker
 * @typedef {{ type: "tool", toolId: string, docUrl: string, target: string,
 *   slot: string }} ToolSticker
 * @typedef {StyleSticker | TextSticker | ToolSticker} Sticker
 */

/** The shared stickers channel: `{ [docUrl]: Sticker[] }`. */
export const Stickers = {
  name: "stickers",
  empty: {},
  key: "doc-url",
  value: "sticker",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
