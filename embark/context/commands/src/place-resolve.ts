import {
  parseAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import { z } from "zod";
import {
  SchemaMatches,
  SchemaQueries,
  schemaKey,
  type JsonSchema,
} from "@embark/schema";
import { SearchQueries, SearchResults } from "@embark/search";
import type { ContextStore, ScopeOwner } from "@embark/context";
import { fuzzyMatch } from "./fuzzy";

// A `{ lat, lon }` pair — the shared notion of "a place". Packages now define
// their own schemas and correlate purely by structural identity: the map, the
// POI card, and this resolver all build the schema from the *same* zod
// expression, so `schemaKey` gives them one shared `SchemaQueries`/`SchemaMatches`
// slot without a central registry.
const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JsonSchema;
const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

// Shared place resolution for the command cards (weather, route). It answers
// "where is the place the user typed?" the same way the map asks "where are the
// {lat, lon} pairs?": match the canvas's existing places first (fuzzily, by
// name), then fall back to a one-off search. Factored out of the weather card
// so every command resolves places identically.

// Give the search fallback this long to answer before giving up.
const SEARCH_TIMEOUT_MS = 8000;

// A resolved place: coordinates, a display name for the card and menu, and —
// when known — the url of the document the place came from, so a minted card
// can link its place pill back to the real place document.
export type Located = {
  lat: number;
  lon: number;
  place: string;
  url?: AutomergeUrl;
};

export type PlaceResolver = {
  // Locate a typed place: among the canvas's {lat, lon} pairs first (matched by
  // name), then via a one-off search. Null when nothing matches.
  resolveLatLon(place: string): Promise<Located | null>;
  // Up to `count` distinct places already on the canvas, for the eager command
  // samples shown before the user has typed anything.
  resolveSamples(count: number): Promise<Located[]>;
  // Drop the scoped channel slices this resolver owns.
  release(): void;
};

// Build a resolver bound to one canvas context. It owns scoped slices of the
// SchemaQueries channel (asking where {lat, lon} pairs live, exactly like the
// map) and the SearchQueries channel (the search fallback), reading the answers
// back from SchemaMatches / SearchResults. `owner` attributes those slices and
// reads to the card running the resolver.
export function createPlaceResolver(
  store: ContextStore,
  repo: Repo,
  owner: ScopeOwner,
): PlaceResolver {
  const schemaQueries = store.handle(SchemaQueries, owner);
  const searchQueries = store.handle(SearchQueries, owner);
  schemaQueries.change((slice) => {
    slice[LATLNG_KEY] = true;
  });

  const resolveLatLon = async (place: string): Promise<Located | null> => {
    const matches = store.read(SchemaMatches)[LATLNG_KEY] ?? [];
    for (const match of matches) {
      const found = await locatedFromMatch(match);
      if (found && fuzzyMatch(found.place, place)) return found;
    }
    return resolveViaSearch(place);
  };

  // The first `count` distinct (by coordinate) places already on the canvas
  // with a usable name — used to showcase a command before any input.
  const resolveSamples = async (count: number): Promise<Located[]> => {
    const matches = store.read(SchemaMatches)[LATLNG_KEY] ?? [];
    const out: Located[] = [];
    const seen = new Set<string>();
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
  // it lives in. The owner url lets a card link its place pill back to the real
  // place document.
  const locatedFromMatch = async (
    match: AutomergeUrl,
  ): Promise<Located | null> => {
    try {
      const node = (await Promise.resolve(repo.find<unknown>(match))).doc() as
        | { lat?: unknown; lon?: unknown; name?: unknown }
        | undefined;
      const lat = node?.lat;
      const lon = node?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      const ownerUrl =
        `automerge:${parseAutomergeUrl(match).documentId}` as AutomergeUrl;
      // The matched node is often a card's `props` (which carries `name`); if
      // not, fall back to the owning document's title.
      let name = typeof node?.name === "string" ? node.name : "";
      if (!name) {
        name = docTitle(
          (await Promise.resolve(repo.find<unknown>(ownerUrl))).doc(),
        );
      }
      if (!name) return null;
      return { lat, lon, place: name, url: ownerUrl };
    } catch {
      return null; // ignore matches that fail to load
    }
  };

  // Drive the search channel for `place` and keep the first result document that
  // carries coordinates (a poi-card's top-level `lat`/`lon`). The query is
  // cleared again afterwards so it doesn't linger on the canvas.
  const resolveViaSearch = async (place: string): Promise<Located | null> => {
    searchQueries.change((slice) => {
      slice[place] = true;
    });
    try {
      const urls = await waitForResults(store, place, SEARCH_TIMEOUT_MS, owner);
      for (const url of urls) {
        try {
          const card = (
            await Promise.resolve(repo.find<unknown>(url))
          ).doc() as
            | { name?: unknown; lat?: unknown; lon?: unknown }
            | undefined;
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
    resolveSamples,
    release() {
      schemaQueries.release();
      searchQueries.release();
    },
  };
}

// Resolve with the first non-empty results for `place`, or [] after `timeoutMs`.
function waitForResults(
  store: ContextStore,
  place: string,
  timeoutMs: number,
  owner: ScopeOwner,
): Promise<AutomergeUrl[]> {
  const current = store.read(SearchResults)[place];
  if (current && current.length) return Promise.resolve(current);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (urls: AutomergeUrl[]) => {
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
function docTitle(doc: unknown): string {
  const record = (doc ?? {}) as {
    "@patchwork"?: { title?: unknown };
    title?: unknown;
    content?: unknown;
    props?: { name?: unknown };
  };
  const metaTitle = record["@patchwork"]?.title;
  if (typeof metaTitle === "string" && metaTitle) return metaTitle;
  if (typeof record.props?.name === "string" && record.props.name) {
    return record.props.name;
  }
  if (typeof record.title === "string" && record.title) return record.title;
  if (typeof record.content === "string" && record.content)
    return record.content;
  return "";
}
