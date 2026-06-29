import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// One of the hard-coded "cards" (see ../). It is configuration-free: the
// document just marks an embed as a mention contributor so the canvas can
// render the card. It answers `@mention` searches by surfacing documents
// already reachable on the canvas whose title matches the query — it never
// mints new documents (unlike the POI card).
export type DocFinderProviderDoc = {
  "@patchwork": { type: "doc-finder-provider" };
};

export const DocFinderProviderDatatype: DatatypeImplementation<DocFinderProviderDoc> =
  {
    init(doc) {
      doc["@patchwork"] = { type: "doc-finder-provider" };
    },
    getTitle() {
      return "Mention Finder";
    },
  };
