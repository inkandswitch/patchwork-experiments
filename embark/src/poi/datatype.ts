import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type Place = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

// The POI provider is configuration-free for now; the document just marks an
// embed as a POI contributor so the canvas can render the provider tool.
export type PoiProviderDoc = {
  "@patchwork": { type: "poi-provider" };
};

// A result document a search box can display: a single place found for one
// query. One doc per place so each result can be linked separately.
export type PoiResultDoc = {
  "@patchwork": { type: "poi-result" };
  query: string;
  place: Place;
};

export const PoiProviderDatatype: DatatypeImplementation<PoiProviderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "poi-provider" };
  },
  getTitle() {
    return "POI Provider";
  },
};

export const PoiResultDatatype: DatatypeImplementation<PoiResultDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "poi-result" };
    doc.query = "";
  },
  getTitle(doc) {
    return doc.place?.name ?? "POI";
  },
};
