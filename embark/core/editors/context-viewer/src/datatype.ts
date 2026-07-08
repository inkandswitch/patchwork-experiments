import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The anchor document for a context inspector. It holds almost no state:
// embedding it in a canvas surfaces a live view of that canvas's shared context
// channels. `inspectedDocUrl`, when set, narrows the view to a single embed's
// contributions and reads (persisted here so the focus survives reloads and
// syncs to every peer viewing the same card); absent means "whole context".
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
