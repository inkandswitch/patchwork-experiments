import { defineChannel } from "@embark/context";

// The shared `pointer` channel, published by the Pointer card. Its canonical
// definition lives in that card's bundleless package (channels.js next to the
// card behavior); this is a matching descriptor for bundled core code — the
// store dedupes channels by name, and the `definedBy`/`spec` urls keep
// attribution pointing at the card package either way.
const POINTER_PACKAGE_URL = "automerge:uMCUHr7SvWiwF1YtmZsWhnUhWY2";

// Where the pointer is right now (viewport coordinates), the document under
// it (closest `<patchwork-view>`), and whether a button is held. `pressed`
// flips on pointerdown/up — readers watch its rising edge for "a new press
// happened", since two presses on the same spot write identical state.
export type PointerState = {
  x?: number;
  y?: number;
  docUrl?: string;
  pressed?: boolean;
};

export const Pointer = defineChannel<PointerState>({
  name: "pointer",
  empty: {},
  definedBy: `${POINTER_PACKAGE_URL}/channels.js`,
  spec: `${POINTER_PACKAGE_URL}/spec.md`,
});
