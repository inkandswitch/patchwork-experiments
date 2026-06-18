import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type Place = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

// The POI provider is configuration-free for now; the document just marks an
// embed as a POI contributor so the canvas can render the provider tool. It
// answers searches by minting `card` documents (see ../card/datatype).
export type PoiProviderDoc = {
  "@patchwork": { type: "poi-provider" };
};

export const PoiProviderDatatype: DatatypeImplementation<PoiProviderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "poi-provider" };
  },
  getTitle() {
    return "POI Provider";
  },
};
