// Geo Lines card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it asks "where, in any
// open document, is an ordered list of {lat, lon} places?" (the declared key
// interest is the query, answered by the schema matcher card) and publishes a
// line geo shape for each answer into the canvas `GeoShapes` channel, grouped
// under its owning document. A multi-line / polygon arrives as several matches
// (one per ring), so each is just another line. Flipping or removing the card
// releases the slice and the lines disappear. It renders nothing into the
// middle slot — the face is drawn by the shell. Drawing needs the geo-shapes
// card on the same canvas (rendering — including suppressing markers on a
// line's interior vertices — is the geo-shapes renderer's job).
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions and the context-store client are imported with plain relative paths (all cards share one package).

import { parseAutomergeUrl } from "@automerge/automerge-repo";

import { getContextHandle, subscribeContext } from "../platform.js";
import { SchemaMatches, schemaKey } from "../schema-matcher/channels.js";
import { GeoShapes } from "../geo-shapes-card/channels.js";

// An ordered list of `{ lat, lon }` places — a path / route. Packages define
// their own schemas and correlate purely by structural identity: this card and
// the route card describe the *same* shape, so `schemaKey` gives them one
// shared SchemaMatches slot without a central registry. (This literal is
// exactly what zod 4's
// `z.toJSONSchema(z.array(z.object({ lat: z.number(), lon: z.number() })))`
// emits.)
const LATLNG_LINE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "array",
  items: {
    type: "object",
    properties: { lat: { type: "number" }, lon: { type: "number" } },
    required: ["lat", "lon"],
    additionalProperties: false,
  },
};
const LATLNG_LINE_KEY = schemaKey(LATLNG_LINE_JSON_SCHEMA);

export default function card(_handle, element) {
  const repo = element.repo;
  // Our own scoped slice of the GeoShapes channel; releasing it on teardown
  // drops every line we published.
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
        const points = toRing(handle.doc());
        // Skip the degenerate 1-point case — that's a marker, not a line.
        if (!points || points.length < 2) continue;
        const docUrl = `automerge:${parseAutomergeUrl(match).documentId}`;
        const list = byDoc.get(docUrl) ?? [];
        list.push({ type: "line", points, target: match });
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
    (all) => void publish(all[LATLNG_LINE_KEY] ?? []),
    [LATLNG_LINE_KEY],
  );

  return () => {
    epoch++;
    unsubscribe();
    shapes.release();
  };
}

// Read a ring of points from an array of `{ lat, lon }` nodes. Returns null
// for a non-array or any malformed element, so a partial ring is dropped
// rather than drawn wrong.
function toRing(node) {
  if (!Array.isArray(node)) return null;
  const out = [];
  for (const element of node) {
    if (element === null || typeof element !== "object") return null;
    const { lat, lon } = element;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    out.push({ lat, lon });
  }
  return out;
}
