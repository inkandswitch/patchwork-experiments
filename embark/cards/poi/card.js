// Place Finder card behavior, loaded by the shared card shell as this
// package's `card.js`. A contributor that answers the canvas search channel
// with OpenStreetMap places: it reads the active queries and writes a result
// document url back under each. Its backing `card` document carries no search
// state; all working state lives in the shared canvas context. The card's face
// is drawn by the shell, so it renders nothing into the middle slot.
//
// The package also ships the `poi-card` datatype it mints for each found place,
// a board tool that renders a poi-card full-size, and a `"token"`-tagged tool
// that paints the compact inline chip used wherever a poi-card is embedded in
// text. Those ride this module's `plugins` export: the card shell registers
// them while the card is face-up and retracts them when it flips down.
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
const { OpenDocuments, SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);

// The datatype/board/token tools that live and die with this card. Their
// implementations load lazily from sibling modules.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    async load() {
      const { PoiCardDatatype } = await import("./datatype.js");
      return PoiCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card",
    name: "Place",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    async load() {
      const { PoiCardView } = await import("./view.js");
      return PoiCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "poi-card-token",
    name: "Place token",
    icon: "MapPin",
    supportedDatatypes: ["poi-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { PoiCardToken } = await import("./token.js");
      return PoiCardToken;
    },
  },
];

// A `{ lat, lon }` pair — this card's notion of "a place". Packages define
// their own schemas and correlate purely by structural identity: the map, the
// place resolver, and this card all write the same literal (what zod 4's
// `z.toJSONSchema(z.object({ lat: z.number(), lon: z.number() }))` emits), so
// `schemaKey` gives them one shared SchemaMatches slot without a central
// registry.
const LATLNG_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { lat: { type: "number" }, lon: { type: "number" } },
  required: ["lat", "lon"],
  additionalProperties: false,
};
const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

const DEBOUNCE_MS = 350;
// Nominatim's usage policy asks for at most one request per second, so calls
// are serialized into 1s slots shared across every provider instance.
const NOMINATIM_MIN_GAP_MS = 1000;
let nextNominatimSlot = 0;

export default function card(_handle, element) {
  const repo = element.repo;
  // Read the active queries from the context and write results back as our own
  // scoped slice. The two are separate channels, so writing results never
  // retriggers the query subscription.
  const results = getContextHandle(element, SearchResults);
  // Announce the cards minted for a query through the `OpenDocuments` channel
  // so the schema matcher discovers them — they're never put in a
  // `<patchwork-view>`, so this scoped slice is their only signal. The handle
  // is released on teardown, dropping every minted doc from the set.
  const openDocs = getContextHandle(element, OpenDocuments);

  // Find places already in the canvas the same way the map does: read the
  // {lat, lon} key of SchemaMatches (the declared interest is the query). Each
  // match url resolves straight to the matched `{lat, lon}` subtree. We keep
  // their coordinates so the search can be biased toward the region the canvas
  // is already about.
  const placeCoords = new Map();
  let matchEpoch = 0;

  const reconcilePlaces = async (matches) => {
    const generation = ++matchEpoch;
    const wanted = new Set(matches);
    for (const key of [...placeCoords.keys()]) {
      if (!wanted.has(key)) placeCoords.delete(key);
    }
    for (const match of matches) {
      if (placeCoords.has(match)) continue;
      try {
        const docHandle = await Promise.resolve(repo.find(match));
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
  const biasViewbox = () => {
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

  // Per-query debounce timers, the queries we've already answered, and the card
  // urls minted per query (so they can be unmounted when the query goes away).
  const timers = new Map();
  const handled = new Set();
  const cardsByQuery = new Map();
  let queriesValue = {};

  const mountCards = (query, urls) => {
    unmountCards(query); // replace any previous generation for this query
    cardsByQuery.set(query, urls);
    openDocs.change((slice) => {
      for (const url of urls) slice[url] = true;
    });
  };

  const unmountCards = (query) => {
    const urls = cardsByQuery.get(query);
    if (!urls) return;
    cardsByQuery.delete(query);
    openDocs.change((slice) => {
      for (const url of urls) delete slice[url];
    });
  };

  const runSearch = async (query) => {
    // The query may have been dropped while it sat in the debounce; skip it.
    if (!(query in queriesValue)) return;
    try {
      const places = await fetchPois(query, biasViewbox());
      // The query may have been dropped while we were fetching; don't resurrect
      // a stale key.
      if (!(query in queriesValue)) return;
      // One poi-card document per place so each can be linked and matched
      // separately. Coordinates live at the top level for the schema matcher.
      const urls = places.map(
        (place) =>
          repo.create({
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

  const onQueries = (all) => {
    queriesValue = all;
    const active = new Set(Object.keys(all));

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
  };

  const unsubscribeQueries = subscribeContext(element, SearchQueries, onQueries);

  // The declared key interest is the {lat, lon} query the schema matcher
  // answers; no separate query channel.
  const unsubscribeMatches = subscribeContext(
    element,
    SchemaMatches,
    (all) => {
      void reconcilePlaces(all[LATLNG_KEY] ?? []);
    },
    [LATLNG_KEY],
  );

  return () => {
    unsubscribeQueries();
    unsubscribeMatches();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const query of [...cardsByQuery.keys()]) unmountCards(query);
    results.release();
    openDocs.release();
  };
}

// Read a [lng, lat] tuple from a matched node shaped like `{ lat, lon }` (the
// same shape the map reads off its pin matches).
function toLngLat(node) {
  if (node === null || typeof node !== "object") return null;
  const { lat, lon } = node;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lon, lat];
}

// Query Nominatim for a free-text place search, mapped to a flat
// `{ name, lat, lon, type? }` place. `jsonv2` is requested specifically because
// it returns a short `name` per result; `addressdetails=1` is cheap and handy
// for future disambiguation. `viewbox` (when given) biases results toward the
// canvas's existing places; it is deliberately passed without `bounded=1` so
// far-away matches still surface.
async function fetchPois(query, viewbox) {
  await reserveNominatimSlot();
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query,
  )}&format=jsonv2&addressdetails=1&limit=10`;
  if (viewbox) url += `&viewbox=${encodeURIComponent(viewbox)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  const items = await response.json();
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
function shortPlaceName(item) {
  const raw =
    item.name?.trim() || item.display_name.split(",")[0]?.trim() || item.display_name;
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

// Reserve the next free 1s slot so concurrent queries don't exceed Nominatim's
// rate limit.
async function reserveNominatimSlot() {
  const now = Date.now();
  const at = Math.max(now, nextNominatimSlot);
  nextNominatimSlot = at + NOMINATIM_MIN_GAP_MS;
  const wait = at - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
