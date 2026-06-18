import type { AutomergeUrl } from "@automerge/automerge-repo";

// A sticker annotates a target with some UI. What's shared across all kinds is
// a `target` — an automerge url (now path-aware, so it can point at a range
// inside a document via `handle.sub(...).url`) naming where the sticker lands.
//
// `slot` is a target-specific hint for *where* in that target's UI the sticker
// renders. The component drawing the target owns the slot vocabulary; an
// unknown slot falls back to the target's default. `style` is the exception —
// it decorates the target range itself and carries no slot.
export type StyleSticker = {
  type: "style";
  styles: Record<string, string>;
  target: AutomergeUrl;
};

export type TextSticker = {
  type: "text";
  text: string;
  target: AutomergeUrl;
  slot: string;
};

export type ToolSticker = {
  type: "tool";
  toolId: string;
  docUrl: AutomergeUrl;
  target: AutomergeUrl;
  slot: string;
};

export type Sticker = StyleSticker | TextSticker | ToolSticker;

// An ephemeral contributor document the StickerProvider mints per contributor
// (see `STICKERS_REGISTRY`). It's keyed by the *target document* url; each
// entry's stickers carry a `target` that's a range sub-url within that
// document. The provider owns the doc's lifecycle; the contributor owns its
// contents.
export type StickerRegistryDoc = Record<AutomergeUrl, Sticker[]>;

// Renderer side: "what stickers target this document?". Subscribe with
// `{ type: STICKERS_ON_DOCUMENT, url }` and receive an `AutomergeUrl[]` of
// sticker sub-urls (each resolvable via `repo.find` to a live `Sticker`).
export const STICKERS_ON_DOCUMENT = "stickers:on-document";

// Contributor side: "give me somewhere to publish stickers". Subscribe with
// `{ type: STICKERS_REGISTRY }` and receive the `AutomergeUrl` of a fresh
// registry document to write into.
export const STICKERS_REGISTRY = "stickers:registry";
