import type { AutomergeUrl } from "@automerge/automerge-repo";

// A card stack is the ordered list document behind the Cards sidebar tabs.
// Two provenances share this one shape: the per-browser *global* stack (its
// url lives in localStorage) and a *per-document* stack linked from a
// document's `@patchwork.cardStackUrl` (minted lazily on first drop). Cards
// in a stack are live — they mount on the page-global body store and their
// behavior applies to every open editor — unlike parts-bin examples, which
// are inert previews.
export type CardStackDoc = {
  "@patchwork": { type: "card-stack" };
  title: string;
  // Ordered; reordering is a splice inside handle.change.
  cards: CardStackEntry[];
  // Which parts-bin catalog the full-frame card-stack tool offers next to this
  // stack: "browser" is the extension side panel's single current-page card;
  // unset (the in-app stacks) means the standard set. See parts-bin/catalog.ts.
  binPreset?: string;
};

export type CardStackEntry = {
  // Stable per-entry identity, used to reconcile rows across changes and to
  // splice during reorders.
  id: string;
  // The card (or any document) shown in the row. Always present — drops that
  // carry no url are skipped rather than inserted.
  url: AutomergeUrl;
  // Which tool renders the row (the document's default tool when unset).
  toolId?: string;
  // Optional canvas footprint carried over from a drag, kept for parity with
  // DocumentDragItem so dragging back onto a canvas can recreate the size.
  width?: number;
  height?: number;
};

// Widening for any document's `@patchwork` metadata: the per-document card
// stack is linked from here. Deliberately under `@patchwork` — `linkedUrls`
// (see @embark/schema) skips that subtree, so the plumbing doc never enters
// the Open Documents closure.
export type WithCardStack = {
  "@patchwork"?: {
    type?: string;
    title?: string;
    cardStackUrl?: AutomergeUrl;
  };
};
