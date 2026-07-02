import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "@embark/context";

// Focus channels, promoted from per-tool local state to shared context so embeds
// and decorators can read them without prop-drilling. `Selection` is the
// canvas's selected embed; `Highlight` is auxiliary emphasis any view
// contributes (hovered map pins, caret-touched mention tokens). Each value is a
// record keyed by document url so it is always mergeable; readers render the
// union across every scope.
export const Selection = defineChannel<Record<AutomergeUrl, true>>({
  name: "selection",
  empty: {},
});

export const Highlight = defineChannel<Record<AutomergeUrl, true>>({
  name: "highlight",
  empty: {},
});
