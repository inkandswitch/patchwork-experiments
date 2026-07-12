// Find Docs card behavior, loaded by the shared card shell as this package's
// `card.js`. A contributor that answers the canvas search channel with
// documents already on the canvas: it reads the active queries and the set of
// reachable documents, and writes back the urls of those whose (resolved)
// title contains the query. The card's face is drawn by the shared card shell,
// so it renders nothing into the middle slot.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions and the context-store client are imported by automerge url.

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const MENTIONS_PACKAGE_URL = "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SearchQueries, SearchResults } = await import(
  getImportableUrlFromAutomergeUrl(MENTIONS_PACKAGE_URL, "channels.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);

// A JSON Schema that matches only document *roots*: `@patchwork.type` (a string)
// lives at the top of every patchwork document and nowhere else, so the schema
// resolver returns one bare document url per reachable doc rather than a sub-url
// for every nested object. The "has a title" part isn't expressed here — we keep
// the schema loose and decide it later by resolving each doc's display title.
const ROOT_SCHEMA = {
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

export default function card(_handle, element) {
  const repo = element.repo;

  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query subscription.
  const results = getContextHandle(element, SearchResults);

  // The current inputs; any change to queries, candidates, or resolved titles
  // recomputes the whole result slice (we own it outright, so it's a plain
  // clear-and-rebuild).
  let queries = [];
  let candidates = [];
  // Resolved display titles by doc url. An empty string means "resolved, but
  // the doc carries no title" — such docs are never surfaced.
  const titles = new Map();
  const pending = new Set();
  let stopped = false;

  const ensureTitle = (url) => {
    if (pending.has(url) || titles.has(url)) return;
    pending.add(url);
    void Promise.resolve(repo.find(url))
      .then((handle) => {
        titles.set(url, docTitle(handle.doc()));
        if (!stopped) answer();
      })
      .catch(() => {})
      .finally(() => pending.delete(url));
  };

  // Answer each active query with the reachable docs whose title contains it
  // (case-insensitive).
  const answer = () => {
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const query of queries) {
        const needle = query.toLowerCase();
        slice[query] = candidates.filter((url) => {
          const title = titles.get(url);
          return !!title && title.toLowerCase().includes(needle);
        });
      }
    });
  };

  const unsubscribeQueries = subscribeContext(element, SearchQueries, (all) => {
    queries = Object.keys(all);
    answer();
  });

  // Ask the canvas "which documents are reachable here?" by reading the root
  // schema's key of SchemaMatches — the declared interest is the query the
  // schema matcher answers. Each match url is a bare document url.
  const unsubscribeMatches = subscribeContext(
    element,
    SchemaMatches,
    (all) => {
      candidates = all[ROOT_KEY] ?? [];
      for (const url of candidates) ensureTitle(url);
      answer();
    },
    [ROOT_KEY],
  );

  return () => {
    stopped = true;
    unsubscribeQueries();
    unsubscribeMatches();
    results.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
    });
    results.release();
  };
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
const BLACKLISTED_TYPES = new Set([
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
function docTitle(doc) {
  const patchwork = doc?.["@patchwork"];
  const type = patchwork?.type;
  if (typeof type === "string" && BLACKLISTED_TYPES.has(type)) return "";
  const title = patchwork?.title;
  return typeof title === "string" && title.trim() ? title : "";
}
