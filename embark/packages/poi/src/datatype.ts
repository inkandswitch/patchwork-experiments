import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A place found on OpenStreetMap: the canonical holder of a coordinate on the
// canvas. Coordinates live at the top level (not nested under `props`) so the
// schema-match resolver finds the `{ lat, lon }` shape directly, and so other
// cards (weather, route) can link to a poi-card rather than duplicating its
// name and coordinates.
export type PoiCardDoc = {
  "@patchwork": { type: "poi-card"; title?: string };
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

export const PoiCardDatatype: DatatypeImplementation<PoiCardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "poi-card" };
    doc.name = "";
    doc.lat = 0;
    doc.lon = 0;
  },
  getTitle(doc) {
    const title = doc["@patchwork"]?.title;
    if (typeof title === "string" && title) return title;
    return doc.name || "Place";
  },
  setTitle(doc, title) {
    doc["@patchwork"].title = title;
  },
};

// The Place Finder card itself: a document-backed search contributor. The doc
// is configuration-free — it just marks an embed as a place-finding contributor
// so the canvas renders the card and runs its search behaviour. State lives in
// the shared canvas context, not here; the backing document exists so the card
// has a stable url (e.g. for selection) rather than being a handle-less
// component. It answers searches by minting `poi-card` documents (above).
export type PlaceFinderDoc = {
  "@patchwork": { type: "place-finder" };
};

export const PlaceFinderDatatype: DatatypeImplementation<PlaceFinderDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "place-finder" };
  },
  getTitle() {
    return "Place Finder";
  },
};
