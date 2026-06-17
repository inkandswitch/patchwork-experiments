import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { TilingLayoutDoc } from "./types";

export const TilingLayoutDatatype: DatatypeImplementation<TilingLayoutDoc> = {
  init(doc) {
    doc.layout = null;
    doc.activeLeafId = null;
    doc.focusOrder = [];
  },
  getTitle: () => "Tiling Layout",
};
