import type { AutomergeUrl } from "@automerge/automerge-repo";

// A sticker annotates a target with some UI. What's shared across all kinds is
// a `target` — an automerge url (now path-aware, so it can point at a range
// inside a document via `handle.sub(...).url`) naming where the sticker lands.
//
// `slot` is a target-specific hint for *where* in that target's UI the sticker
// renders. The component drawing the target owns the slot vocabulary; an
// unknown slot falls back to the target's default. `style` is the exception —
// it decorates the target range itself and carries no slot.
//
// `emphasized` is set by a sticker source on *every* sticker it publishes while
// its own card embed is selected on the canvas, so the renderer can make that
// source's annotations stand out at a glance (see runStickerSource). It's a
// presentation hint, not part of a sticker's identity.
export type StyleSticker = {
  type: "style";
  styles: Record<string, string>;
  target: AutomergeUrl;
  emphasized?: boolean;
};

export type TextSticker = {
  type: "text";
  text: string;
  target: AutomergeUrl;
  slot: string;
  // Optional inline styles for the rendered chip itself (e.g. a red computed
  // time). Merged onto the widget's default look; absent means the default.
  styles?: Record<string, string>;
  emphasized?: boolean;
};

export type ToolSticker = {
  type: "tool";
  toolId: string;
  docUrl: AutomergeUrl;
  target: AutomergeUrl;
  slot: string;
  emphasized?: boolean;
};

export type Sticker = StyleSticker | TextSticker | ToolSticker;
