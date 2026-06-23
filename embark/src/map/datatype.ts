import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The map's current geographic viewport in lng/lat degrees, derived from
// center + zoom + the embed's pixel size. Mirrored to the doc so sibling embeds
// (e.g. an llm-card) can run searches bound to the visible area and refresh as
// it pans/zooms — center/zoom alone aren't enough since the box also depends on
// the map's on-screen dimensions.
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// A slippy map whose viewport lives in the document: `center` is [lng, lat]
// (maplibre's order) and `zoom` is the maplibre zoom level. Panning/zooming the
// map writes these back, so the view is shared like any other Automerge state.
// `bounds` is the derived visible box, kept in sync alongside center/zoom.
export type MapDoc = {
  "@patchwork": { type: "map" };
  center: [number, number];
  zoom: number;
  bounds?: MapBounds;
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
