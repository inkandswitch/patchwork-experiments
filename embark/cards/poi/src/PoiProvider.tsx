import { type AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { createEffect, onCleanup } from "solid-js";
import { readContext, useContextHandle } from "@embark/context";
import { SearchQueries, SearchResults } from "@embark/search";
import { OpenDocuments, SchemaMatches } from "@embark/schema";
import { LATLNG_KEY } from "./latlng";
import type { PoiCardDoc } from "./datatype";

// A single OpenStreetMap place, flattened from a Nominatim result. Minted into a
// `poi-card` document with top-level coordinates so the schema matcher can find
// its `{lat, lon}`.
type Place = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

const DEBOUNCE_MS = 350;
// Nominatim's usage policy asks for at most one request per second, so calls
// are serialized into 1s slots shared across every provider instance.
const NOMINATIM_MIN_GAP_MS = 1000;
let nextNominatimSlot = 0;

type NominatimItem = {
  // jsonv2 adds `name` (the place's own name tag, e.g. "Aachen") and
  // `addresstype` (a human-ish kind like "city"/"county"). `display_name` is
  // the long comma-joined string kept only as a fallback.
  name?: string;
  addresstype?: string;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
};

// A contributor that answers the canvas search channel with OpenStreetMap
// places. It reads the active queries and writes a result document url back
// under each. Its backing `card` document carries no search state; all working
// state lives in the shared canvas context.
export function PoiProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;
  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query effect.
  const searchQueries = readContext(props.element, SearchQueries);
  const results = useContextHandle(props.element, SearchResults);

  // Find places already in the canvas the same way the map does: read the
  // {lat, lon} key of SchemaMatches (the declared interest is the query). Each
  // match url resolves straight to the matched `{lat, lon}` subtree. We keep
  // their coordinates so the search can be biased toward the region the canvas
  // is already about.
  const placeCoords = new Map<string, [number, number]>();
  let matchEpoch = 0;

  const reconcilePlaces = async (matches: AutomergeUrl[]) => {
    const generation = ++matchEpoch;
    const wanted = new Set<string>(matches);
    for (const key of [...placeCoords.keys()]) {
      if (!wanted.has(key)) placeCoords.delete(key);
    }
    for (const match of matches) {
      if (placeCoords.has(match)) continue;
      try {
        const docHandle = await Promise.resolve(repo.find<unknown>(match));
        if (generation !== matchEpoch) return;
        const coords = toLngLat(docHandle.doc());
        if (coords) placeCoords.set(match, coords);
      } catch {
        // ignore docs that fail to load
      }
    }
  };

  // A padded bounding box around the existing places, as Nominatim's `viewbox`
  // (x1,y1,x2,y2 = west,north,east,south). Used WITHOUT `bounded=1`, so it only
  // biases results toward the box rather than restricting to it. `undefined`
  // when the canvas has no places yet (an unbiased search).
  const biasViewbox = (): string | undefined => {
    if (placeCoords.size === 0) return undefined;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of placeCoords.values()) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const padLon = Math.max((maxLon - minLon) * 0.5, 0.5);
    const padLat = Math.max((maxLat - minLat) * 0.5, 0.5);
    return [
      minLon - padLon,
      maxLat + padLat,
      maxLon + padLon,
      minLat - padLat,
    ].join(",");
  };

  // The declared key interest is the {lat, lon} query the schema matcher
  // answers; no separate query channel.
  const schemaMatches = readContext(props.element, SchemaMatches, () => [
    LATLNG_KEY,
  ]);
  createEffect(() => {
    void reconcilePlaces(schemaMatches()[LATLNG_KEY] ?? []);
  });

  // Per-query debounce timers, the queries we've already answered, and the card
  // urls minted per query (so they can be unmounted when the query goes away).
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const cardsByQuery = new Map<string, AutomergeUrl[]>();

  const queries = (): string[] => Object.keys(searchQueries());

  createEffect(() => {
    const active = new Set(queries());

    for (const query of active) {
      if (handled.has(query) || timers.has(query)) continue;
      const timer = setTimeout(() => {
        timers.delete(query);
        void runSearch(query);
      }, DEBOUNCE_MS);
      timers.set(query, timer);
    }

    // Forget queries the search dropped: cancel pending fetches and unmount the
    // cards we created for them.
    for (const query of [...handled]) {
      if (!active.has(query)) handled.delete(query);
    }
    for (const [query, timer] of [...timers]) {
      if (active.has(query)) continue;
      clearTimeout(timer);
      timers.delete(query);
    }
    for (const query of [...cardsByQuery.keys()]) {
      if (!active.has(query)) unmountCards(query);
    }
    // Drop our result slice entries for queries that are gone.
    results.change((slice) => {
      for (const query of Object.keys(slice)) {
        if (!active.has(query)) delete slice[query];
      }
    });
  });

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const query of [...cardsByQuery.keys()]) unmountCards(query);
  });

  const runSearch = async (query: string) => {
    // The query may have been dropped while it sat in the debounce; skip it.
    if (!(query in searchQueries())) return;
    try {
      const places = await fetchPois(query, biasViewbox());
      // The query may have been dropped while we were fetching; don't resurrect
      // a stale key.
      if (!(query in searchQueries())) return;
      // One poi-card document per place so each can be linked and matched
      // separately. Coordinates live at the top level for the schema matcher.
      const urls = places.map(
        (place) =>
          repo.create<PoiCardDoc>({
            "@patchwork": { type: "poi-card", title: place.name },
            name: place.name,
            lat: place.lat,
            lon: place.lon,
            ...(place.type ? { type: place.type } : {}),
          }).url,
      );
      results.change((slice) => {
        slice[query] = urls;
      });
      handled.add(query);
      mountCards(query, urls);
    } catch {
      // Leave the query unanswered; a later edit re-queues it.
    }
  };

  // Announce the cards minted for a query through the `OpenDocuments` channel
  // so the schema matcher discovers them — they're never put in a
  // `<patchwork-view>`, so this scoped slice is their only signal. The handle
  // is released with the component, dropping every minted doc from the set.
  const openDocs = useContextHandle(props.element, OpenDocuments);

  const mountCards = (query: string, urls: AutomergeUrl[]) => {
    unmountCards(query); // replace any previous generation for this query
    cardsByQuery.set(query, urls);
    openDocs.change((slice) => {
      for (const url of urls) slice[url] = true;
    });
  };

  const unmountCards = (query: string) => {
    const urls = cardsByQuery.get(query);
    if (!urls) return;
    cardsByQuery.delete(query);
    openDocs.change((slice) => {
      for (const url of urls) delete slice[url];
    });
  };

  // The card face (title, description, corner pips) is drawn by the shared card
  // shell from the card document; this contributor renders nothing into the
  // middle slot.
  return null;
}

// Read a [lng, lat] tuple from a matched node shaped like `{ lat, lon }` (the
// same shape the map reads off its pin matches).
function toLngLat(node: unknown): [number, number] | null {
  if (node === null || typeof node !== "object") return null;
  const { lat, lon } = node as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lon, lat];
}

// Query Nominatim for a free-text place search, mapped to our flat `Place`
// shape. `jsonv2` is requested specifically because it returns a short `name`
// per result; `addressdetails=1` is cheap and handy for future disambiguation.
// `viewbox` (when given) biases results toward the canvas's existing places; it
// is deliberately passed without `bounded=1` so far-away matches still surface.
async function fetchPois(query: string, viewbox?: string): Promise<Place[]> {
  await reserveNominatimSlot();
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query,
  )}&format=jsonv2&addressdetails=1&limit=10`;
  if (viewbox) url += `&viewbox=${encodeURIComponent(viewbox)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => ({
    name: shortPlaceName(item),
    lat: Number(item.lat),
    lon: Number(item.lon),
    type: item.addresstype ?? item.type,
  }));
}

// A short, human-friendly name: prefer the place's own `name` tag, falling back
// to the leading segment of `display_name` for results without one (raw
// addresses, etc.). Nominatim appends a parenthetical disambiguator in some
// locales (e.g. "Aachen (district)") which people don't write, so drop it.
function shortPlaceName(item: NominatimItem): string {
  const raw =
    item.name?.trim() || item.display_name.split(",")[0]?.trim() || item.display_name;
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

// Reserve the next free 1s slot so concurrent queries don't exceed Nominatim's
// rate limit.
async function reserveNominatimSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextNominatimSlot);
  nextNominatimSlot = at + NOMINATIM_MIN_GAP_MS;
  const wait = at - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
