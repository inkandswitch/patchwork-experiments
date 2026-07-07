import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "@embark/context";

// The shared pointer: the Pointer card publishes where the pointer is, which
// embed it is over, and whether a button is held. Single-writer (one card), so
// the merged value is just that card's slice; with no pointer card on the
// canvas the channel rests at its empty value. `docUrl`/`embedId` are absent
// while the pointer is over empty canvas or outside it. Defined here — in the
// card's own package — and imported by readers (the context viewer follows it
// as a hands-free alternative to its target button).
export type PointerState = {
  x?: number;
  y?: number;
  docUrl?: AutomergeUrl;
  embedId?: string;
  pressed?: boolean;
};

export const Pointer = defineChannel<PointerState>({
  name: "pointer",
  empty: {},
});
