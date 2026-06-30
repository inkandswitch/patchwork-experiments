import type { AutomergeUrl } from "@automerge/automerge-repo";

// A deck holds a pile of cards you can fan out and gather back together. Unlike
// the parts bin (which hands out *clones* and keeps its examples pristine), a
// deck holds cards *by reference* and moves them: dragging a card in removes it
// from the canvas, dragging one out deals it back onto the canvas.
export type DeckDoc = {
  "@patchwork": { type: "deck" };
  // Shown on the covering card; editable by double-clicking it.
  title: string;
  // Folded (a neat pile) vs. fanned out. Synced rather than local because the
  // embed's size tracks the layout, so both must agree across clients.
  fanned: boolean;
  cards: DeckCard[];
};

export type DeckCard = {
  // Stable per-card identity, used to reconcile across changes and to splice a
  // dealt-out card from the pile.
  id: string;
  // A card points at an automerge document...
  url?: AutomergeUrl;
  // ...or at a standalone `patchwork:component` module (a head-less url).
  // Exactly one of `url` / `componentUrl` is set.
  componentUrl?: string;
  // Which tool renders the card's thumbnail (the host default is used on drop).
  toolId?: string;
  // The canvas footprint captured when the card was dragged in, so dealing it
  // back out recreates it at the size it had on the canvas.
  width?: number;
  height?: number;
};
