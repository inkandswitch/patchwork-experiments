import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The "Convert to imperial" card: a document-backed sticker source. The doc is a
// configuration-free marker — all working state lives in the shared canvas
// context; the document exists only so the card has a stable url instead of
// being a handle-less component.
export type ConvertToImperialDoc = {
  "@patchwork": { type: "convert-to-imperial" };
};

export const ConvertToImperialDatatype: DatatypeImplementation<ConvertToImperialDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "convert-to-imperial" };
    },
    getTitle() {
      return "Convert to imperial";
    },
  };
