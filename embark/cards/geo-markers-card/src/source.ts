import { parseAutomergeUrl, type AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { getContextHandle, subscribeContext } from "@embark/context";
import { SchemaMatches } from "@embark/schema";
import { GeoShapes, type GeoMarker, type GeoPoint } from "@embark/geo-shapes";
import { LATLNG_KEY } from "./latlng";

// Asks the canvas "where, in any open document, is a {lat, lon} pair?" (the
// declared key interest is the query, answered by the schema matcher card)
// and publishes a marker geo shape for each answer, grouped under its owning
// document. Each match url is a native automerge sub-url (`<docUrl>/seg/seg`);
// `repo.find` resolves it straight to the matched subtree, so its `.doc()` is
// the coordinate. Rendering is someone else's job (the geo-shapes card).
export function runMarkerSource(element: ToolElement): () => void {
  const repo = element.repo;
  // Our own scoped slice of the GeoShapes channel; releasing it on teardown
  // drops every marker we published.
  const shapes = getContextHandle(element, GeoShapes);
  // Matches resolve async, so a generation guard drops a pass superseded by a
  // newer emission.
  let epoch = 0;

  const publish = async (matches: AutomergeUrl[]) => {
    const generation = ++epoch;
    const byDoc = new Map<AutomergeUrl, GeoMarker[]>();
    for (const match of matches) {
      try {
        const handle = await Promise.resolve(repo.find<unknown>(match));
        const at = toLatLon(handle.doc());
        if (!at) continue;
        const docUrl =
          `automerge:${parseAutomergeUrl(match).documentId}` as AutomergeUrl;
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
      for (const key of Object.keys(slice)) {
        delete slice[key as AutomergeUrl];
      }
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
function toLatLon(node: unknown): GeoPoint | null {
  if (node === null || typeof node !== "object") return null;
  const { lat, lon } = node as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return { lat, lon };
}
