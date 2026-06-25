import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A near-empty anchor document. The doc itself holds no state; embedding it in a
// canvas surfaces a live view of that canvas's shared context channels.
export type ContextViewerDoc = {
  "@patchwork": { type: "context-viewer" };
};

export const ContextViewerDatatype: DatatypeImplementation<ContextViewerDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "context-viewer" };
  },
  getTitle() {
    return "Context";
  },
};
