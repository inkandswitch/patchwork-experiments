import type { Skill } from "./index";

// The reactive-region search capability: instead of answering a typed query,
// watch a live input on the canvas - the bounding box a map is currently
// showing - and surface results inside it, refreshing as the view moves.
export const MAP_SEARCH_SKILL: Skill = {
  name: "map-search",
  summary:
    "search the area a map is currently showing and drop results as pins, refreshing as the map pans/zooms",
  doc: `# Skill: map-search

Drive a search from a LIVE REGION instead of typed text. A map embed publishes the geographic box it is currently showing; you read that box, search inside it, and drop the results onto the canvas as map pins - then refresh whenever the user pans, zooms, or resizes the map. The effect renders nothing itself - it is pure behavior.

(If instead the search should be driven by what the user TYPES into a search box, that is the \`search\` skill. The two compose: load both to bound a typed query by the map's current view.)

You use:
  1. schema:matches  - find the map embed(s) on the canvas and read their live bounds.
  2. the mounted/unmounted events - announce your result cards so the map plots them as pins (and other cards can discover them). There is no search box in this flow.

## Provider 1: schema:matches - find the map and read its bounds

  subscribe(element, { type: "schema:matches", schema: MAP_SCHEMA }, (urls) => { ... })

A map document looks like { "@patchwork": { type: "map" }, center, zoom, bounds }. The \`bounds\` field is the live visible box in lng/lat degrees - { west, south, east, north } - and the map rewrites it on every pan, zoom, and resize. Match maps that have published bounds with:

  const MAP_SCHEMA = { type: "object", properties: { "@patchwork": { type: "object", properties: { type: { const: "map" } }, required: ["type"] }, bounds: { type: "object", properties: { west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" } }, required: ["west", "south", "east", "north"] } }, required: ["@patchwork", "bounds"] };

The callback receives an AutomergeUrl[] of matching map documents and is re-invoked as maps come and go - treat it as a live set. Usually there is one map; track the first. \`await repo.find(url)\` then read \`handle.doc().bounds\`, and listen on the handle's "change" to re-search when the box moves:

  const handle = await repo.find(mapUrl);
  handle.on("change", () => rerun()); // bounds changed -> search again

If there is no map on the canvas, do nothing until one appears.

## Output: mint result cards and mount them so the map pins them

The map plots a pin for any document it can reach shaped like { lat, lon } (numbers). So produce one card per result with its coordinates, and ANNOUNCE each card as mounted so the canvas discovers it (the cards are never placed in a view, so this event is their only signal). Use a plain CustomEvent - no import needed:

  const mount = (url) => element.dispatchEvent(new CustomEvent("patchwork:mounted", { detail: { url, toolId: "card" }, bubbles: true, composed: true }));
  const unmount = (url) => element.dispatchEvent(new CustomEvent("patchwork:unmounted", { detail: { url, toolId: "card" }, bubbles: true, composed: true }));

A result card carries its name (for the pin / any list) and its coordinates so the map can place it:

  repo.create({ "@patchwork": { type: "card" }, props: { name: "<display name>", type: "<optional kind>", lat: <number>, lon: <number> }, content: "<display name>" })

On every refresh, unmount the previous generation's cards before mounting the new ones, so stale pins disappear. Debounce re-searches (the box can change rapidly) and guard against an in-flight fetch from an older view overwriting a newer one.

## API access (IMPORTANT - check this before writing effect.js)

effect.js runs standalone in the browser with NO secrets, env vars, or API-key store. So:

- Use only PUBLIC, keyless HTTP endpoints. OpenStreetMap's Nominatim supports a bounding-box search with no key: add \`viewbox=<west>,<north>,<east>,<south>\` and \`bounded=1\` to restrict results to the box (https://nominatim.openstreetmap.org/search?format=jsonv2&bounded=1&q=cafe&viewbox=...). For richer "what is in this box" queries, the Overpass API is also keyless. Respect each service's usage policy (Nominatim asks for <= 1 request/second, so keep \`limit\` modest and debounce).
- Before you write effect.js, PROBE your chosen endpoint with a <script> fetch using a real box to confirm it returns usable data WITHOUT authentication.
- If the requested data genuinely requires an API key you cannot obtain (e.g. eBird), do NOT hardcode a placeholder - call giveUp("...the X API requires a key that isn't available to the card...") and stop.
- At runtime, throw a clear Error if a fetch fails (e.g. \`if (!res.ok) throw new Error("Nominatim responded " + res.status)\`) so the failure is visible.

## Example effect.js (places of a kind, inside the current map view)

  import { subscribe } from "https://esm.sh/@inkandswitch/patchwork-providers@0.2.2";

  const TERM = "cafe"; // whatever this card is meant to find
  const MAP_SCHEMA = { type: "object", properties: { "@patchwork": { type: "object", properties: { type: { const: "map" } }, required: ["type"] }, bounds: { type: "object", properties: { west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" } }, required: ["west", "south", "east", "north"] } }, required: ["@patchwork", "bounds"] };

  export default function activate(element) {
    const repo = element.repo;
    let mapUrl;        // the map we're tracking
    let mapHandle;     // its handle
    let onChange;      // its "change" listener
    let mounted = [];  // card urls placed on the canvas this generation
    let timer;         // debounce for re-searching as the view moves
    let generation = 0; // so a slow fetch from an old view can't overwrite a new one

    const mount = (url) => element.dispatchEvent(new CustomEvent("patchwork:mounted", { detail: { url, toolId: "card" }, bubbles: true, composed: true }));
    const unmount = (url) => element.dispatchEvent(new CustomEvent("patchwork:unmounted", { detail: { url, toolId: "card" }, bubbles: true, composed: true }));
    const clear = () => { for (const url of mounted) unmount(url); mounted = []; };

    const search = async () => {
      const bounds = mapHandle && mapHandle.doc() && mapHandle.doc().bounds;
      if (!bounds) return;
      const mine = ++generation;
      const viewbox = bounds.west + "," + bounds.north + "," + bounds.east + "," + bounds.south;
      const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&bounded=1&limit=20&viewbox=" + viewbox + "&q=" + encodeURIComponent(TERM), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Nominatim responded " + res.status);
      const items = await res.json();
      if (mine !== generation) return; // a newer view already superseded this
      clear();
      for (const item of items) {
        const name = item.name || item.display_name.split(",")[0];
        const url = repo.create({ "@patchwork": { type: "card" }, props: { name, type: item.addresstype || item.type, lat: Number(item.lat), lon: Number(item.lon) }, content: name }).url;
        mounted.push(url);
        mount(url);
      }
    };

    const scheduleSearch = () => { clearTimeout(timer); timer = setTimeout(() => { search().catch(console.error); }, 500); };

    const stop = subscribe(element, { type: "schema:matches", schema: MAP_SCHEMA }, async (urls) => {
      const next = urls[0]; // track the first map on the canvas
      if (next === mapUrl) return;
      if (mapHandle && onChange) mapHandle.off("change", onChange);
      mapHandle = undefined; onChange = undefined; mapUrl = next;
      clear();
      if (!next) return; // map went away
      const handle = await repo.find(next);
      if (mapUrl !== next) return; // changed again while resolving
      mapHandle = handle;
      onChange = () => scheduleSearch(); // bounds moved -> re-search
      mapHandle.on("change", onChange);
      scheduleSearch();
    });

    return () => {
      stop();
      clearTimeout(timer);
      if (mapHandle && onChange) mapHandle.off("change", onChange);
      clear();
    };
  }

## General pattern

The same shape works for any live input on the canvas, not just maps: subscribe with schema:matches to find the document that holds the input, read the field you care about, and re-run on its "change". The map's \`bounds\` is the concrete reactive input available today.`,
};
