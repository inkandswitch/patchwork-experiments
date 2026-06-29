import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type Place = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

// One of the hard-coded "cards" (see ../). It is configuration-free: the
// document just marks an embed as a place-finding contributor so the canvas can
// render the card. It answers searches by minting `card` documents (see
// ../../card/datatype).
export type PoiProviderDoc = {
  "@patchwork": { type: "poi-provider" };
};

export const PoiProviderDatatype: DatatypeImplementation<PoiProviderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "poi-provider" };
  },
  getTitle() {
    return "Place Finder";
  },
};
