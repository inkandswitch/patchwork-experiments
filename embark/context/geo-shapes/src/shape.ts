import type { AutomergeUrl } from "@automerge/automerge-repo";

// A geographic coordinate, in the same shape as the shared LATLNG schema the
// source cards match on — the renderer converts to maplibre's [lng, lat] order
// internally.
export type GeoPoint = { lat: number; lon: number };

// A geo shape stands for a document on the map. Shapes are grouped under the
// document they belong to (the `GeoShapes` channel key), which is what focus,
// hover, and the popup all operate on. `target` is the path-aware sub-url of
// the node the shape was derived from (the `{lat, lon}` subtree, or the point
// array) — the shape's stable identity, used for reconciliation, feature-state
// and interior-vertex suppression (a marker whose target is an interior vertex
// of a published line is not drawn).
export type GeoMarker = {
  type: "marker";
  at: GeoPoint;
  target: AutomergeUrl;
  color?: string;
};

export type GeoLine = {
  type: "line";
  points: GeoPoint[];
  target: AutomergeUrl;
  color?: string;
};

export type GeoShape = GeoMarker | GeoLine;
