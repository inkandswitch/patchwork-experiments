// Geo Markers card behavior, loaded by the shared card shell as this
// package's `card.js`. While the card sits face-up on a canvas it asks
// "where, in any open document, is a {lat, lon} pair?" (the declared key
// interest is the query, answered by the schema matcher card) and publishes a
// marker geo shape for each answer into the canvas `GeoShapes` channel,
// grouped under its owning document. Each match url is a native automerge
// sub-url (`<docUrl>/seg/seg`); `repo.find` resolves it straight to the
// matched subtree, so its `.doc()` is the coordinate. Flipping or removing
// the card releases the slice and the markers disappear. It renders nothing
// into the middle slot — the face is drawn by the shell. Drawing needs the
// geo-shapes card on the same canvas.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions and the context-store client are imported by automerge url.

import { parseAutomergeUrl } from "@automerge/automerge-repo";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";
const GEO_SHAPES_PACKAGE_URL = "automerge:7tDif9cz12ZQXv55Yo73io1UUw4";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);
const { GeoShapes } = await import(
  getImportableUrlFromAutomergeUrl(GEO_SHAPES_PACKAGE_URL, "channels.js")
);

// A `{ lat, lon }` pair — the shared notion of "a place". Packages define
// their own schemas and correlate purely by structural identity: the map, the
// POI card, and this card all describe the *same* shape, so `schemaKey` gives
// them one shared SchemaMatches slot without a central registry. (This
// literal is exactly what zod 4's
// `z.toJSONSchema(z.object({ lat: z.number(), lon: z.number() }))` emits.)
const LATLNG_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { lat: { type: "number" }, lon: { type: "number" } },
  required: ["lat", "lon"],
  additionalProperties: false,
};
const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

export default function card(_handle, element) {
  const repo = element.repo;
  // Our own scoped slice of the GeoShapes channel; releasing it on teardown
  // drops every marker we published.
  const shapes = getContextHandle(element, GeoShapes);
  // Matches resolve async, so a generation guard drops a pass superseded by a
  // newer emission.
  let epoch = 0;

  const publish = async (matches) => {
    const generation = ++epoch;
    const byDoc = new Map();
    for (const match of matches) {
      try {
        const handle = await Promise.resolve(repo.find(match));
        const at = toLatLon(handle.doc());
        if (!at) continue;
        const docUrl = `automerge:${parseAutomergeUrl(match).documentId}`;
        const list = byDoc.get(docUrl) ?? [];
        list.push({ type: "marker", at, target: match });
        byDoc.set(docUrl, list);
      } catch {
        // ignore docs that fail to load
      }
    }
    if (generation !== epoch) return;
    // Rebuild the whole slice from this emission, so removed matches drop out.
    shapes.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const [docUrl, list] of byDoc) slice[docUrl] = list;
    });
  };

  const unsubscribe = subscribeContext(
    element,
    SchemaMatches,
    (all) => void publish(all[LATLNG_KEY] ?? []),
    [LATLNG_KEY],
  );

  return () => {
    epoch++;
    unsubscribe();
    shapes.release();
  };
}

// Read a point from a matched node shaped like `{ lat, lon }`.
function toLatLon(node) {
  if (node === null || typeof node !== "object") return null;
  const { lat, lon } = node;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return { lat, lon };
}
