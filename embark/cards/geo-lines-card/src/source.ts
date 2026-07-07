import { parseAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { getContextHandle, subscribeContext } from "@embark/context";
import { SchemaMatches } from "@embark/schema";
import { GeoShapes, type GeoLine, type GeoPoint } from "@embark/geo-shapes";
import { LATLNG_LINE_KEY } from "./latlng";

// Asks the canvas "where, in any open document, is an ordered list of
// {lat, lon} places?" (the declared key interest is the query, answered by the
// schema matcher card) and publishes a line geo shape for each answer, grouped
// under its owning document. A multi-line / polygon arrives as several matches
// (one per ring), so each is just another line. Rendering — including
// suppressing markers on a line's interior vertices — is the geo-shapes
// renderer's job.
export function runLineSource(element: ToolElement): () => void {
  const repo = element.repo;
  // Our own scoped slice of the GeoShapes channel; releasing it on teardown
  // drops every line we published.
  const shapes = getContextHandle(element, GeoShapes);
  // Matches resolve async, so a generation guard drops a pass superseded by a
  // newer emission.
  let epoch = 0;

  const publish = async (matches: AutomergeUrl[]) => {
    const generation = ++epoch;
    const byDoc = new Map<AutomergeUrl, GeoLine[]>();
    for (const match of matches) {
      try {
        const handle = await Promise.resolve(repo.find<unknown>(match));
        const points = toRing(handle.doc());
        // Skip the degenerate 1-point case — that's a marker, not a line.
        if (!points || points.length < 2) continue;
        const docUrl =
          `automerge:${parseAutomergeUrl(match).documentId}` as AutomergeUrl;
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
      for (const key of Object.keys(slice)) {
        delete slice[key as AutomergeUrl];
      }
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
function toRing(node: unknown): GeoPoint[] | null {
  if (!Array.isArray(node)) return null;
  const out: GeoPoint[] = [];
  for (const element of node) {
    if (element === null || typeof element !== "object") return null;
    const { lat, lon } = element as Record<string, unknown>;
    if (typeof lat !== "number" || typeof lon !== "number") return null;
    out.push({ lat, lon });
  }
  return out;
}
