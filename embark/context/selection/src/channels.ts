import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineSetChannel } from "@embark/context";

// Focus channels, promoted from per-tool local state to shared context so embeds
// and decorators can read them without prop-drilling. `Selection` is the
// canvas's selected embed; `Highlight` is auxiliary emphasis any view
// contributes (hovered map pins, caret-touched mention tokens). Each is a set
// of document urls; readers render the union across every scope.
export const Selection = defineSetChannel<AutomergeUrl>({
  name: "selection",
  key: "doc-url",
});

export const Highlight = defineSetChannel<AutomergeUrl>({
  name: "highlight",
  key: "doc-url",
});
