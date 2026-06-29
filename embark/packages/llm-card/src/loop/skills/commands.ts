import type { Skill } from "./index";

// The slash-command capability: offer `/` command suggestions into editors, and
// have each chosen command drop a LIVE, self-rendering card into the note. It is
// the search skill's sibling (it mints cards and reports their urls) plus a
// companion render module that draws each card inline — replacing the older
// "insert a text snippet, then sticker it" approach.
export const COMMANDS_SKILL: Skill = {
  name: "commands",
  summary:
    "offer /-commands that each drop a live, self-rendering card into the note (e.g. /Route → an interactive route widget)",
  doc: `# Skill: commands

Give the user slash commands that each drop a LIVE, self-rendering card into their note. When they type \`/\` you offer suggestions; picking one inserts an interactive embed (e.g. a route widget) bound to its own copy of a card document.

You ship TWO modules (write both with writeFile), plus the spec:
  1. effect.js - the command CONTRIBUTOR: answer the live \`/\` query with suggestions. Each suggestion points at a prototype card you mint; the card itself carries the url of your renderer (its \`viewUrl\` field).
  2. view.js   - the RENDERER: a default-export \`(element, handle) => cleanup\` that draws ONE card inline and lets the user interact with it.

(This replaces the older "insert a {Command(...)} text snippet and decorate it with a sticker" approach. Now the embed renders itself and owns its data.)

## How a command flows

- effect.js mints ONE prototype card per command — a normal card doc \`{ "@patchwork": { type: "card", title }, props, content, viewUrl }\` — with sensible default args. The \`viewUrl\` is the url of your renderer; \`@patchwork.title\` is the name the token pill shows.
- When the user picks the suggestion, the HOST deep-clones your prototype (so every insertion is independent) and inserts a token \`{cloneUrl}\` into the note. The renderer travels on the doc (the clone keeps your \`viewUrl\`), so the token needs nothing but the url.
- That token is rendered by importing the clone's \`viewUrl\` and calling \`default(element, handle)\` with a handle to the CLONE. The user changes the command through the widget's own UI (which writes to the handle) — NOT by editing text. (A card with no \`viewUrl\` just renders as a title pill.)

## Half 1: effect.js — answer the active /-query (commands:queries / commands:suggestions)

You use two channels:
  commands:queries      { [query]: true }                                        - the active /-queries. The editor writes these; you READ them (the keys). The empty string "" means the user typed "/" with nothing after it.
  commands:suggestions  { [query]: { label, url }[] }                            - the suggestions per query. You WRITE your own slice.

Reach the store with getStore(element), then for each active query write the array of suggestions you offer. Each suggestion is:
  - label   - what the menu shows
  - url     - a card you minted (repo.create(...).url): the command's prototype. Bake your renderer's url onto that card's \`viewUrl\` field (see "Getting your renderer's url") — it is NOT part of the suggestion.

Mint each prototype card ONCE and cache it (a module-level variable) — do NOT create a new card on every keystroke. Offer the SAME url across queries so the host dedupes it. Match the query loosely (case-insensitive prefix/substring on the label or command name), return [] when nothing fits, and offer your full list for the empty query.

  const CommandQueries = { name: "commands:queries", empty: {} };
  const CommandSuggestions = { name: "commands:suggestions", empty: {} };
  const store = getStore(element);
  const suggestions = store.handle(CommandSuggestions);
  const answer = () => suggestions.change((s) => {
    for (const key of Object.keys(s)) delete s[key]; // clear stale queries
    for (const query of Object.keys(store.read(CommandQueries))) s[query] = suggestionsFor(query);
  });
  const unsubscribe = store.subscribe(CommandQueries, answer); // re-answer as queries change
  answer(); // subscribe does not fire an initial call, so seed once

In the returned teardown, unsubscribe and call suggestions.release().

### Getting your renderer's url (IMPORTANT)

effect.js and view.js live in the SAME folder, so derive view.js's url from your own module url at runtime — never hardcode it:

  const VIEW_URL = new URL("./view.js", import.meta.url).pathname;

Store that exact string on the prototype card's \`viewUrl\` field (\`repo.create({ ..., viewUrl: VIEW_URL })\`), NOT on the suggestion. The host clones the card on insert, and the path-string \`viewUrl\` is copied verbatim onto the clone, so each embed keeps your renderer.

## Half 2: view.js — render ONE card inline

view.js is loaded standalone by the service worker, exactly like effect.js, but it RENDERS (effect.js renders nothing). It receives the card's host element and a handle to that card's own clone:

  export default function view(element, handle) {
    const repo = element.repo; // the repo is on the element; no import needed
    const render = () => {
      const card = handle.doc();
      element.replaceChildren(/* build DOM from card.props, attach inputs */);
    };
    const onChange = () => render();
    handle.on("change", onChange);
    render();
    return () => { handle.off("change", onChange); element.replaceChildren(); };
  }

- Plain JavaScript, render into \`element\`. No React/Solid. Every import MUST be a full https://esm.sh/... url. Do NOT import @automerge/automerge-repo (use \`element.repo\` and the handle).
- Read the card's data from \`handle.doc()\`; write the user's edits back with \`handle.change(...)\`. Each embed has its OWN clone, so mutate freely.
- If the command computes a result from the network, compute it IN view.js, store it on the card (\`handle.change\`), and re-render. The API rules below apply.

## API access (IMPORTANT — applies to view.js)

view.js runs standalone in the browser with NO access to secrets, env vars, or an API-key store. So:

- Use only PUBLIC, keyless HTTP endpoints (e.g. OpenStreetMap Nominatim, OSRM). Respect each service's usage policy.
- Before writing view.js, PROBE your chosen endpoint with a \`<script>\` fetch to confirm it returns usable data WITHOUT a key.
- If the request genuinely needs a key you cannot obtain, do NOT hardcode a placeholder — call giveUp("...") and stop.
- Throw a clear Error if a fetch fails (e.g. \`if (!res.ok) throw new Error("OSRM " + res.status)\`). Debounce recomputation and guard against a stale in-flight fetch overwriting a newer result.

## Example: a /Route command

effect.js (the contributor):

  function getStore(node) {
    const detail = {};
    node.dispatchEvent(new CustomEvent("patchwork:context-request", { detail, bubbles: true, composed: true }));
    return detail.store;
  }
  const CommandQueries = { name: "commands:queries", empty: {} };
  const CommandSuggestions = { name: "commands:suggestions", empty: {} };
  const VIEW_URL = new URL("./view.js", import.meta.url).pathname;

  export default function activate(element) {
    const repo = element.repo;
    const store = getStore(element);
    if (!store) return () => {};
    const suggestions = store.handle(CommandSuggestions);

    let proto; // cache the prototype card so we don't mint one per keystroke
    const prototypeUrl = () => {
      if (!proto) proto = repo.create({
        "@patchwork": { type: "card", title: "Route" },
        props: { command: "Route", from: "Aachen", to: "Berlin" },
        content: "Route",
        viewUrl: VIEW_URL, // the renderer rides on the card, not the suggestion
      });
      return proto.url;
    };
    const suggestionsFor = (query) => {
      const q = query.toLowerCase();
      if (q && !"route".startsWith(q)) return [];
      return [{ label: "Route from … to …", url: prototypeUrl() }];
    };

    const answer = () => suggestions.change((s) => {
      for (const key of Object.keys(s)) delete s[key];
      for (const query of Object.keys(store.read(CommandQueries))) s[query] = suggestionsFor(query);
    });
    const unsubscribe = store.subscribe(CommandQueries, answer);
    answer();

    return () => { unsubscribe(); suggestions.release(); };
  }

view.js (the renderer):

  const geocode = async (place) => {
    const res = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(place), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Nominatim " + res.status);
    const hits = await res.json();
    return hits[0] && { lat: Number(hits[0].lat), lon: Number(hits[0].lon) };
  };
  const routeKm = async (from, to) => {
    const a = await geocode(from), b = await geocode(to);
    if (!a || !b) return null;
    const res = await fetch("https://router.project-osrm.org/route/v1/driving/" + a.lon + "," + a.lat + ";" + b.lon + "," + b.lat + "?overview=false");
    if (!res.ok) throw new Error("OSRM " + res.status);
    const data = await res.json();
    const r = data.routes && data.routes[0];
    return r ? Math.round(r.distance / 1000) : null;
  };

  export default function view(element, handle) {
    let token = 0; // guards against a stale fetch overwriting a newer one
    const recompute = async () => {
      const mine = ++token;
      const { from, to } = handle.doc().props;
      try {
        const km = await routeKm(from, to);
        if (mine === token) handle.change((d) => { d.props.km = km; });
      } catch (err) { if (mine === token) handle.change((d) => { d.props.km = null; }); }
    };

    const render = () => {
      const { from, to, km } = handle.doc().props;
      element.replaceChildren();
      const box = document.createElement("span");
      box.className = "route-embed";
      const fromI = document.createElement("input"); fromI.value = from;
      const toI = document.createElement("input"); toI.value = to;
      fromI.addEventListener("change", () => { handle.change((d) => { d.props.from = fromI.value; }); recompute(); });
      toI.addEventListener("change", () => { handle.change((d) => { d.props.to = toI.value; }); recompute(); });
      const result = document.createElement("span");
      result.textContent = km == null ? " → …" : " → " + km + " km";
      box.append(fromI, document.createTextNode(" → "), toI, result);
      element.append(box);
    };

    const onChange = () => render();
    handle.on("change", onChange);
    render();
    if (handle.doc().props.km === undefined) recompute();

    return () => { handle.off("change", onChange); element.replaceChildren(); };
  }

(Half 1 and Half 2 are one command: effect.js advertises it, view.js is what the user actually sees and interacts with. Write BOTH files, then write the spec.)`,
};
