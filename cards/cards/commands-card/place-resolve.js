// Shared place resolution for the command cards (weather, route). It answers
// "where is the place the user typed?" the same way the map asks "where are
// the {lat, lon} pairs?": match the canvas's existing places first (fuzzily,
// by name), then fall back to a one-off search. Factored out of the weather
// card so every command resolves places identically.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { parseAutomergeUrl } from "@automerge/automerge-repo";
import { fuzzyMatch } from "./fuzzy.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";
const MENTIONS_PACKAGE_URL = "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh";

const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);
const { SearchQueries, SearchResults } = await import(
  getImportableUrlFromAutomergeUrl(MENTIONS_PACKAGE_URL, "channels.js")
);

// A `{ lat, lon }` pair — the shared notion of "a place". Packages define
// their own schemas and correlate purely by structural identity: the map, the
// POI card, and this resolver all build the *same* JSON Schema literal, so
// `schemaKey` gives them one shared `SchemaMatches` slot without a central
// registry. (This literal is exactly what zod 4's
// `z.toJSONSchema(z.object({ lat: z.number(), lon: z.number() }))` emits.)
const LATLNG_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { lat: { type: "number" }, lon: { type: "number" } },
  required: ["lat", "lon"],
  additionalProperties: false,
};
const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

// Give the search fallback this long to answer before giving up.
const SEARCH_TIMEOUT_MS = 8000;

/**
 * A resolved place: coordinates, a display name for the card and menu, and —
 * when known — the url of the document the place came from, so a minted card
 * can link its place pill back to the real place document.
 * @typedef {{ lat: number, lon: number, place: string, url?: string }} Located
 *
 * @typedef {{
 *   resolveLatLon: (place: string) => Promise<Located | null>,
 *   matchOnCanvas: (place: string) => Promise<Located | null>,
 *   resolveSamples: (count: number) => Promise<Located[]>,
 *   release: () => void,
 * }} PlaceResolver
 */

/**
 * Build a resolver bound to one canvas context. It asks where {lat, lon}
 * pairs live the same way the map does — by holding a `SchemaMatches`
 * subscription whose declared key interest *is* the query (a bare `read()`
 * registers no interest, so the matcher would never answer a mere poll) — and
 * owns a scoped slice of the SearchQueries channel (the search fallback),
 * reading the answers back from SearchResults. `owner` attributes those
 * slices and reads to the card running the resolver.
 * @returns {PlaceResolver}
 */
export function createPlaceResolver(store, repo, owner) {
  const searchQueries = store.handle(SearchQueries, owner);

  // The live {lat, lon} matches, cached for the resolve calls below. The
  // subscription is held for the resolver's lifetime so the query stays alive.
  let latLonMatches = store.read(SchemaMatches)[LATLNG_KEY] ?? [];
  const unsubscribeMatches = store.subscribe(
    SchemaMatches,
    (all) => {
      latLonMatches = all[LATLNG_KEY] ?? [];
    },
    { owner, keys: [LATLNG_KEY] },
  );

  const resolveLatLon = async (place) => {
    return (await matchOnCanvas(place)) ?? resolveViaSearch(place);
  };

  const matchOnCanvas = async (place) => {
    for (const match of latLonMatches) {
      const found = await locatedFromMatch(match);
      if (found && fuzzyMatch(found.place, place)) return found;
    }
    return null;
  };

  // The first `count` distinct (by coordinate) places already on the canvas
  // with a usable name — used to showcase a command before any input.
  const resolveSamples = async (count) => {
    const matches = latLonMatches;
    const out = [];
    const seen = new Set();
    for (const match of matches) {
      if (out.length >= count) break;
      const found = await locatedFromMatch(match);
      if (!found) continue;
      const key = `${found.lat.toFixed(4)},${found.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(found);
    }
    return out;
  };

  // Read a {lat, lon} match's coordinates and the display name of the document
  // it lives in. The owner url lets a card link its place pill back to the
  // real place document.
  const locatedFromMatch = async (match) => {
    try {
      const node = (await Promise.resolve(repo.find(match))).doc();
      const lat = node?.lat;
      const lon = node?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      const ownerUrl = `automerge:${parseAutomergeUrl(match).documentId}`;
      // The matched node is often a card's `props` (which carries `name`); if
      // not, fall back to the owning document's title.
      let name = typeof node?.name === "string" ? node.name : "";
      if (!name) {
        name = docTitle((await Promise.resolve(repo.find(ownerUrl))).doc());
      }
      if (!name) return null;
      return { lat, lon, place: name, url: ownerUrl };
    } catch {
      return null; // ignore matches that fail to load
    }
  };

  // Drive the search channel for `place` and keep the first result document
  // that carries coordinates (a poi-card's top-level `lat`/`lon`). The query
  // is cleared again afterwards so it doesn't linger on the canvas.
  const resolveViaSearch = async (place) => {
    searchQueries.change((slice) => {
      slice[place] = true;
    });
    try {
      const urls = await waitForResults(store, place, SEARCH_TIMEOUT_MS, owner);
      for (const url of urls) {
        try {
          const card = (await Promise.resolve(repo.find(url))).doc();
          const lat = card?.lat;
          const lon = card?.lon;
          if (typeof lat === "number" && typeof lon === "number") {
            const name = typeof card?.name === "string" ? card.name : place;
            return { lat, lon, place: name, url };
          }
        } catch {
          // skip results that fail to load
        }
      }
      return null;
    } finally {
      searchQueries.change((slice) => {
        delete slice[place];
      });
    }
  };

  return {
    resolveLatLon,
    matchOnCanvas,
    resolveSamples,
    release() {
      unsubscribeMatches();
      searchQueries.release();
    },
  };
}

// Resolve with the first non-empty results for `place`, or [] after `timeoutMs`.
function waitForResults(store, place, timeoutMs, owner) {
  const current = store.read(SearchResults)[place];
  if (current && current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (urls) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(urls);
    };
    const unsubscribe = store.subscribe(
      SearchResults,
      (all) => {
        const urls = all[place];
        if (urls && urls.length) finish(urls);
      },
      { owner, keys: [place] },
    );
    const timer = setTimeout(() => finish([]), timeoutMs);
  });
}

// A best-effort display title for a document: its patchwork title, a card's
// name, or its content.
function docTitle(doc) {
  const record = doc ?? {};
  const metaTitle = record["@patchwork"]?.title;
  if (typeof metaTitle === "string" && metaTitle) return metaTitle;
  if (typeof record.props?.name === "string" && record.props.name) {
    return record.props.name;
  }
  if (typeof record.title === "string" && record.title) return record.title;
  if (typeof record.content === "string" && record.content) {
    return record.content;
  }
  return "";
}
