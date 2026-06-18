import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// A slippy map whose viewport lives in the document: `center` is [lng, lat]
// (maplibre's order) and `zoom` is the maplibre zoom level. Panning/zooming the
// map writes these back, so the view is shared like any other Automerge state.
export type MapDoc = {
  "@patchwork": { type: "map" };
  center: [number, number];
  zoom: number;
};

// Berlin, matching the openfreemap demo, so a fresh map opens somewhere.
export const DEFAULT_CENTER: [number, number] = [13.388, 52.517];
export const DEFAULT_ZOOM = 9.5;

export const MapDatatype: DatatypeImplementation<MapDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "map" };
    doc.center = [...DEFAULT_CENTER];
    doc.zoom = DEFAULT_ZOOM;
  },
  getTitle() {
    return "Map";
  },
};
