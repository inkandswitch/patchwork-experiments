import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

// The map's current geographic viewport in lng/lat degrees, derived from
// center + zoom + the embed's pixel size. Mirrored to the doc so sibling embeds
// can run searches bound to the visible area and refresh as it pans/zooms —
// center/zoom alone aren't enough since the box also depends on the map's
// on-screen dimensions.
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// A geocoded place as persisted in the doc. Mirrors the search overlay's
// `Place` shape (see geo.ts) — duplicated here so the datatype module stays
// self-contained.
export type PersistedPlace = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

export type RouteMode = "drive" | "walk" | "bike" | "transit";

// A resolved directions route as persisted in the doc. Endpoints + mode
// identify the trip; the decoded geometry and headline stats are stored too so
// peers and reloads can draw the route without re-hitting the routing API (at
// the cost of some doc-history growth per route change).
export type PersistedRoute = {
  mode: RouteMode;
  from: PersistedPlace;
  to: PersistedPlace;
  coords: { lat: number; lon: number }[];
  distanceKm: number;
  durationS: number;
};

// A slippy map whose viewport lives in the document: `center` is [lng, lat]
// (maplibre's order) and `zoom` is the maplibre zoom level. Panning/zooming the
// map writes these back, so the view is shared like any other Automerge state.
// `bounds` is the derived visible box, kept in sync alongside center/zoom.
// The search overlay's selection state is shared the same way:
// `selectedDestination` is the place picked from a places search and
// `selectedRoute` the directions route currently on screen — both survive
// reloads and sync to peers (see SearchPanel).
export type MapDoc = {
  "@patchwork": { type: "map" };
  center: [number, number];
  zoom: number;
  bounds?: MapBounds;
  selectedDestination?: PersistedPlace;
  selectedRoute?: PersistedRoute;
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
