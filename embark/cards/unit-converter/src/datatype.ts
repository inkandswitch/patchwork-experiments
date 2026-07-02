import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The "Convert to metric" card: a document-backed sticker source. The doc is a
// configuration-free marker — all working state lives in the shared canvas
// context; the document exists only so the card has a stable url instead of
// being a handle-less component.
export type ConvertToMetricDoc = {
  "@patchwork": { type: "convert-to-metric" };
};

export const ConvertToMetricDatatype: DatatypeImplementation<ConvertToMetricDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "convert-to-metric" };
    },
    getTitle() {
      return "Convert to metric";
    },
  };
