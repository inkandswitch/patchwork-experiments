import type { Skill } from "./index";

// The search capability: act as a search contributor on the shared context.
// Read the active queries from search:queries, fetch results, mint a card per
// result, and write the card urls into search:results. Modeled on embark's POI
// provider.
export const SEARCH_SKILL: Skill = {
  name: "search",
  summary:
    "answer typed search-box queries: turn the live text query into result cards (e.g. via a public web API)",
  doc: `# Skill: search

Act as a search contributor driven by a TEXT query. Search-box embeds publish a typed query string onto the shared context, and contributors like you answer it with result documents. The box renders whatever cards you report. The effect renders nothing itself - it is pure behavior.

(If instead the search should be driven by a region the user is looking at - e.g. "show X in the current map view, updating as I pan" - that is the map-search skill. The two compose: load both to bound a typed query by the map's view.)

You use two channels:
  search:queries   { [query]: true }            - the active queries. The boxes write these; you READ them (the keys are the query strings).
  search:results   { [query]: AutomergeUrl[] }  - the result urls per query. You WRITE your own slice.

## How it works

Reach the store with getStore(element), then watch the active queries and answer each one:

  const SearchQueries = { name: "search:queries", empty: {} };
  const SearchResults = { name: "search:results", empty: {} };
  const store = getStore(element);
  const results = store.handle(SearchResults);
  const answer = () => { /* for each q in Object.keys(store.read(SearchQueries)): fill results */ };
  const unsubscribe = store.subscribe(SearchQueries, answer);
  answer(); // subscribe does not fire an initial call, so seed once

The active queries are the KEYS of search:queries (each value is just true). You OWN your slice of search:results: for each query, write the array of result-document urls you want to surface with results.change((s) => { s[query] = urls; }), and delete the entry when the query goes away.

## Producing results

For each active query, run your search and mint one card document per result, then write their urls under that query key. A card is the generic result shape the search box knows how to render:

  const url = repo.create({
    "@patchwork": { type: "card" },
    props: { name: "<display name>", type: "<optional kind/tag>" },
    content: "<display name>",
  }).url;

The search box shows each result's props.name (falling back to content) plus props.type as a small tag, so always set a human name. Write the urls back, guarding against queries dropped while you were fetching:

  if (query in store.read(SearchQueries)) results.change((s) => { s[query] = urls; });

Re-run when a query appears; when it's removed, stop answering it and delete its entry. In the returned teardown, unsubscribe and call results.release() to drop everything you published.

## API access (IMPORTANT - check this before writing effect.js)

effect.js runs standalone in the browser and has NO access to secrets, env vars, or an API-key store. So:

- Use only PUBLIC, keyless HTTP endpoints (for example OpenStreetMap's Nominatim search at https://nominatim.openstreetmap.org/search?q=...&format=jsonv2 needs no key). Respect each service's usage policy (rate limits, required headers).
- Before you write effect.js, PROBE your chosen endpoint with a <script> fetch to confirm it returns usable data WITHOUT authentication. If it 401/403s or requires a key, you have no way to supply one.
- If the requested search genuinely requires an API key you cannot obtain, do NOT guess or hardcode a placeholder - call giveUp("...the X API requires a key that isn't available to the card...") and stop.
- At runtime, throw a clear Error if a fetch fails (e.g. if (!res.ok) throw new Error("<service> responded " + res.status)) so the failure is visible rather than silent.

## Example effect.js (place search via Nominatim)

  function getStore(node) {
    const detail = {};
    node.dispatchEvent(new CustomEvent("patchwork:context-request", { detail, bubbles: true, composed: true }));
    return detail.store;
  }
  const SearchQueries = { name: "search:queries", empty: {} };
  const SearchResults = { name: "search:results", empty: {} };

  export default function activate(element) {
    const repo = element.repo;
    const store = getStore(element);
    if (!store) return () => {};
    const results = store.handle(SearchResults);
    const answered = new Set();

    const answer = async () => {
      const queries = Object.keys(store.read(SearchQueries));
      for (const query of queries) {
        if (!query || answered.has(query)) continue;
        answered.add(query);
        try {
          const res = await fetch(
            "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&q=" + encodeURIComponent(query),
            { headers: { Accept: "application/json" } },
          );
          if (!res.ok) throw new Error("Nominatim responded " + res.status);
          const items = await res.json();
          const urls = items.map((item) => repo.create({
            "@patchwork": { type: "card" },
            props: { name: item.name || item.display_name.split(",")[0], type: item.addresstype || item.type },
            content: item.name || item.display_name.split(",")[0],
          }).url);
          if (query in store.read(SearchQueries)) results.change((s) => { s[query] = urls; });
        } catch (err) {
          answered.delete(query); // allow a retry on the next change
          console.error(err);
        }
      }
      // forget queries that were dropped so they can be re-answered later
      const active = store.read(SearchQueries);
      for (const q of [...answered]) {
        if (!(q in active)) { answered.delete(q); results.change((s) => { delete s[q]; }); }
      }
    };

    const unsubscribe = store.subscribe(SearchQueries, answer);
    answer();

    return () => { unsubscribe(); results.release(); };
  }

(Optional, advanced: you can additionally dispatch a mounted event for each result card if you want OTHER cards to discover them via schema:matches - it is NOT needed for results to appear in the search box.)`,
};
