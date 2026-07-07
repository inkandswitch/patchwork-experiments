import type { AutomergeUrl } from "@automerge/automerge-repo";
import { defineChannel } from "@embark/context";
import type { GeoShape } from "./shape";

// Geo shapes contributed by cards on the canvas, modeled on the `Stickers`
// channel: sources write their slice keyed by owning *document* url, values
// are plain JSON shapes. The renderer (published by the geo-shapes card into
// `map:extensions`, see ./renderer) draws the union on every map — it knows
// nothing about where shapes come from, so any card can put things on the map
// by writing here. Focus (selection ∪ highlight of the key's document), hover
// highlighting, and the popup all key off the document url.
export const GeoShapes = defineChannel<Record<AutomergeUrl, GeoShape[]>>({
  name: "geo:shapes",
  empty: {},
  key: "doc-url",
  value: "geo-shape",
});
