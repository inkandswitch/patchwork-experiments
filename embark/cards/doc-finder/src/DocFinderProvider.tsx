import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { readContext, useContextHandle } from "@embark/context";
import { SearchQueries, SearchResults } from "@embark/search";
import {
  SchemaMatches,
  SchemaQueries,
  schemaKey,
  type JsonSchema,
} from "@embark/schema";

// A JSON Schema that matches only document *roots*: `@patchwork.type` (a string)
// lives at the top of every patchwork document and nowhere else, so the schema
// resolver returns one bare document url per reachable doc rather than a sub-url
// for every nested object. The "has a title" part isn't expressed here — we keep
// the schema loose and decide it later by resolving each doc's display title.
const ROOT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { type: "string" } },
      required: ["type"],
    },
  },
  required: ["@patchwork"],
};

const ROOT_KEY = schemaKey(ROOT_SCHEMA);

// A contributor that answers the canvas search channel with documents already
// on the canvas. It reads the active queries and the set of reachable
// documents, and writes back the urls of those whose (fuzzily resolved) title
// contains the query. The card's face is drawn by the shared card shell, so it
// renders nothing into the middle slot.
export function DocFinderProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;
  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query effect.
  const searchQueries = readContext(props.element, SearchQueries);
  const results = useContextHandle(props.element, SearchResults);

  // Ask the canvas "which documents are reachable here?" by publishing the root
  // schema and reading its matches. Each match url is a bare document url.
  const schemaQueries = useContextHandle(props.element, SchemaQueries);
  schemaQueries.change((slice) => {
    slice[ROOT_KEY] = true;
  });
  const schemaMatches = readContext(props.element, SchemaMatches);
  const candidates = createMemo(() => schemaMatches()[ROOT_KEY] ?? []);

  // A lazily-populated cache of resolved display titles, keyed by doc url. A
  // signal so the search effect re-runs as titles arrive. An empty string means
  // "resolved, but the doc carries no title" — such docs are never surfaced.
  const [titles, setTitles] = createSignal<Record<AutomergeUrl, string>>({});
  const pending = new Set<string>();
  const ensureTitle = (url: AutomergeUrl) => {
    if (pending.has(url) || titles()[url] !== undefined) return;
    pending.add(url);
    void repo
      .find<unknown>(url)
      .then((handle) => {
        setTitles((prev) => ({ ...prev, [url]: docTitle(handle.doc()) }));
      })
      .catch(() => {})
      .finally(() => pending.delete(url));
  };
  createEffect(() => candidates().forEach(ensureTitle));

  // Answer each active query with the reachable docs whose title contains it
  // (case-insensitive). We own this result slice outright, so it's a plain
  // clear-and-rebuild on every change of the queries, matches, or titles.
  createEffect(() => {
    const active = Object.keys(searchQueries());
    const known = titles();
    const urls = candidates();
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const query of active) {
        const needle = query.toLowerCase();
        slice[query] = urls.filter((url) => {
          const title = known[url];
          return !!title && title.toLowerCase().includes(needle);
        });
      }
    });
  });

  onCleanup(() => {
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
    });
  });

  // The card face (title, description, corner pips) is drawn by the shared card
  // shell; this contributor renders nothing into the middle slot.
  return null;
}

// Datatypes Find Docs must never surface, even when they carry a title. They
// each belong to another card, so returning them here would just duplicate
// (and clutter) what that card already handles. Three groups:
//   1. every card — the `card` datatype is shared by all of them (Place Finder,
//      Weather, converters, …). They carry titles for their own chrome, but
//      they're UI controls you'd never `@mention`.
//   2. the result cards those finders auto-mint — a place, a bird sighting, a
//      forecast, a route. Each has a dedicated card that owns it (Place Finder,
//      Bird Sightings, Weather, Route), so they're noise in a document search.
//   3. canvas plumbing (the parts bin, the context viewer) — anchors, not
//      documents a user refers to by name.
const BLACKLISTED_TYPES = new Set<string>([
  // 1. Every card
  "card",
  // 2. Results minted by finder cards
  "poi-card",
  "bird-card",
  "weather-card",
  "route-card",
  // 3. Canvas plumbing, not user content
  "parts-bin",
  "context-viewer",
]);

// A document's display title, read *strictly* from `@patchwork.title` — the one
// field a document sets when it explicitly wants to be found by name. Returns
// "" when it's missing, blank, or owned by a blacklisted card type, which the
// caller treats as "untitled, don't surface". There is deliberately no fallback
// to content/name/etc., so only intentionally-titled documents are matched.
function docTitle(doc: unknown): string {
  const patchwork = (
    doc as { "@patchwork"?: { type?: unknown; title?: unknown } } | null
  )?.["@patchwork"];
  const type = patchwork?.type;
  if (typeof type === "string" && BLACKLISTED_TYPES.has(type)) return "";
  const title = patchwork?.title;
  return typeof title === "string" && title.trim() ? title : "";
}
