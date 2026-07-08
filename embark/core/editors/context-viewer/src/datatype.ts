import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The anchor document for a context inspector. It holds almost no state:
// embedding it in a canvas surfaces a live view of that canvas's shared context
// channels. `inspectedDocUrl`, when set, narrows the view to a single embed's
// contributions and reads; absent means "whole context". It is set externally,
// never interactively: the inspect tool's Context tab mirrors the inspected
// document's url into this field on its own (duck-typed) doc — the viewer
// itself only reads it.
export type ContextViewerDoc = {
  "@patchwork": { type: "context-viewer" };
  inspectedDocUrl?: AutomergeUrl;
};

export const ContextViewerDatatype: DatatypeImplementation<ContextViewerDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "context-viewer" };
  },
  getTitle() {
    return "Context";
  },
};
