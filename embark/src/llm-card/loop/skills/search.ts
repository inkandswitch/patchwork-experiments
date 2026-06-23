import type { Skill } from "./index";

// The search capability: act as a contributor to the canvas search broker.
// Listen for the active queries, fetch results, mint a card per result, and
// report the card urls back. Modeled on embark's POI provider.
export const SEARCH_SKILL: Skill = {
  name: "search",
  summary:
    "answer canvas searches: turn live queries into result cards (e.g. via a public web API)",
  doc: `# Skill: search

Act as a search contributor. The canvas runs a search broker: search-box embeds publish a query, and contributors like you answer it with result documents. The box renders whatever cards you report. The effect renders nothing itself - it is pure behavior.

You have exactly one provider:
  search:responses - join as a contributor and answer the active queries.

## How the broker works

  subscribe(element, { type: "search:responses" }, (responseDocUrl) => { ... })

The callback is invoked once with the url of a fresh response document minted for you. That document is a plain map:

  { [query: string]: AutomergeUrl[] }

The broker OWNS the keys: it writes the current set of active query strings (value []), adding and removing keys as search boxes come and go. You OWN the values: for each query key, write the array of result-document urls you want to surface. Watch the response document for key changes and (re)answer:

  const handle = await repo.find(responseDocUrl);
  const answer = () => { /* read handle.doc() keys, fill values */ };
  handle.on("change", answer);
  answer();

## Producing results

For each active query, run your search and mint one card document per result, then write their urls under that query key. A card is the generic result shape the search box knows how to render:

  const url = repo.create({
    "@patchwork": { type: "card" },
    props: { name: "<display name>", type: "<optional kind/tag>" },
    content: "<display name>",
  }).url;

The search box shows each result's props.name (falling back to content) plus props.type as a small tag, so always set a human name. Write the urls back, guarding against queries the broker dropped while you were fetching:

  handle.change((doc) => { if (query in doc) doc[query] = urls; });

Re-run when the broker adds a query; when it removes one, stop answering it. In the returned teardown, unsubscribe from the provider and remove your "change" listener.

## API access (IMPORTANT - check this before writing effect.js)

effect.js runs standalone in the browser and has NO access to secrets, env vars, or an API-key store. So:

- Use only PUBLIC, keyless HTTP endpoints (for example OpenStreetMap's Nominatim search at https://nominatim.openstreetmap.org/search?q=...&format=jsonv2 needs no key). Respect each service's usage policy (rate limits, required headers).
- Before you write effect.js, PROBE your chosen endpoint with a <script> fetch to confirm it returns usable data WITHOUT authentication. If it 401/403s or requires a key, you have no way to supply one.
- If the requested search genuinely requires an API key you cannot obtain, do NOT guess or hardcode a placeholder - call giveUp("...the X API requires a key that isn't available to the card...") and stop.
- At runtime, throw a clear Error if a fetch fails (e.g. \`if (!res.ok) throw new Error(\\\`<service> responded \${res.status}\\\`)\`) so the failure is visible rather than silent.

## Example effect.js (place search via Nominatim)

  import { subscribe } from "https://esm.sh/@inkandswitch/patchwork-providers@0.2.2";

  export default function activate(element) {
    const repo = element.repo;
    const answered = new Set();

    const stop = subscribe(element, { type: "search:responses" }, async (responseDocUrl) => {
      const handle = await repo.find(responseDocUrl);

      const answer = async () => {
        const queries = Object.keys(handle.doc() ?? {});
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
            if (query in (handle.doc() ?? {})) handle.change((doc) => { doc[query] = urls; });
          } catch (err) {
            answered.delete(query); // allow a retry on the next change
            console.error(err);
          }
        }
        // forget queries the broker dropped so they can be re-answered later
        for (const q of [...answered]) if (!(q in (handle.doc() ?? {}))) answered.delete(q);
      };

      handle.on("change", answer);
      answer();
    });

    return () => stop();
  }

(Optional, advanced: you can additionally dispatch a mounted event for each result card if you want OTHER cards to discover them via schema:matches - it is NOT needed for results to appear in the search box.)`,
};
