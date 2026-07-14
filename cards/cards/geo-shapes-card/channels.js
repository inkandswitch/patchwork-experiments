// The `geo:shapes` channel and the shape vocabulary, owned by the Geo Shapes
// card. Modeled on the `stickers` channel: source cards write their slice
// keyed by owning *document* url, values are plain JSON shapes. The renderer
// (./renderer.js, published by this card into `map:extensions` while face-up)
// draws the union on every map — it knows nothing about where shapes come
// from, so any card can put things on the map by writing here. Focus
// (selection ∪ highlight of the key's document), hover highlighting, and the
// popup all key off the document url.
//
// This module is the canonical definition — source cards (geo-lines,
// geo-markers) import it by this package's automerge url.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:7tDif9cz12ZQXv55Yo73io1UUw4";

/**
 * A geographic coordinate, in the same shape as the shared LATLNG schema the
 * source cards match on — the renderer converts to maplibre's [lng, lat]
 * order internally.
 * @typedef {{ lat: number, lon: number }} GeoPoint
 *
 * A geo shape stands for a document on the map. Shapes are grouped under the
 * document they belong to (the channel key), which is what focus, hover, and
 * the popup all operate on. `target` is the path-aware sub-url of the node
 * the shape was derived from (the `{lat, lon}` subtree, or the point array) —
 * the shape's stable identity, used for reconciliation, feature-state and
 * interior-vertex suppression (a marker whose target is an interior vertex of
 * a published line is not drawn).
 * @typedef {{ type: "marker", at: GeoPoint, target: string, color?: string }} GeoMarker
 * @typedef {{ type: "line", points: GeoPoint[], target: string, color?: string }} GeoLine
 * @typedef {GeoMarker | GeoLine} GeoShape
 */

/** The shared geo-shapes channel: `{ [docUrl]: GeoShape[] }`. */
export const GeoShapes = {
  name: "geo:shapes",
  empty: {},
  key: "doc-url",
  value: "geo-shape",
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
