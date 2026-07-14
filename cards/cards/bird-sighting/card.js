// Bird Sightings card behavior, loaded by the shared card shell as this
// package's `card.js`. The card watches the canvas for an open map, reads its
// visible box, and asks eBird what's been seen there — minting a `bird-card`
// per species so the map pins them. It renders the madlib controls and species
// list into the middle slot; the card's face (title, description, pips) is
// drawn by the shell from the card document.
//
// The package also ships the `bird-card` datatype it mints per species, a
// board tool (also used in the map's hover popup), and a `"token"`-tagged tool
// for the inline chip. Those ride this module's `plugins` export: the card
// shell registers them while the card is face-up and retracts them when it
// flips down.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions (`SchemaMatches` from the schema matcher, `Highlight` from the
// selection card), the structural schema matcher, and the context-store client
// are imported by their packages' automerge urls.

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";
import { fetchSightings, lookupImage, speciesUrl } from "./ebird.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SCHEMA_MATCHER_PACKAGE_URL = "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

const { findContextStore, subscribeContext, getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { SchemaMatches, schemaKey } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "channels.js")
);
const { jsonSchemaMatches } = await import(
  getImportableUrlFromAutomergeUrl(SCHEMA_MATCHER_PACKAGE_URL, "match.js")
);
const { Highlight } = await import(
  getImportableUrlFromAutomergeUrl(SELECTION_PACKAGE_URL, "channels.js")
);

// The datatype/board/token tools that live and die with this card. Their
// implementations load lazily from sibling modules.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "bird-card",
    name: "Bird",
    icon: "Bird",
    async load() {
      const { BirdCardDatatype } = await import("./datatype.js");
      return BirdCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "bird-card",
    name: "Bird",
    icon: "Bird",
    supportedDatatypes: ["bird-card"],
    async load() {
      const { BirdCardView } = await import("./view.js");
      return BirdCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "bird-card-token",
    name: "Bird token",
    icon: "Bird",
    supportedDatatypes: ["bird-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { BirdCardToken } = await import("./token.js");
      return BirdCardToken;
    },
  },
];

// Re-search 500ms after the last map move / setting change, so a drag that
// emits a burst of bounds updates only fires one lookup.
const DEBOUNCE_MS = 500;

// The map documents to watch: any `{ "@patchwork": { type: "map" }, bounds }`.
// Hand-written so the correlation key is stable and the schema matcher sees
// exactly the shape the map-search skill established.
const MAP_JSON_SCHEMA = {
  type: "object",
  properties: {
    "@patchwork": {
      type: "object",
      properties: { type: { const: "map" } },
      required: ["type"],
    },
    bounds: {
      type: "object",
      properties: {
        west: { type: "number" },
        south: { type: "number" },
        east: { type: "number" },
        north: { type: "number" },
      },
      required: ["west", "south", "east", "north"],
    },
  },
  required: ["@patchwork", "bounds"],
};
const MAP_KEY = schemaKey(MAP_JSON_SCHEMA);

export default function card(handle, element) {
  injectStyles();
  const dispose = render(() => BirdSighting({ handle, element }), element);
  return () => dispose();
}

function BirdSighting(props) {
  const repo = props.element.repo;
  const store = findContextStore(props.element);

  // The two madlib choices live on the card document, read reactively so the
  // middle slot re-renders — and the search re-runs — when either changes.
  const [doc, setDoc] = createSignal(props.handle.doc());
  const syncDoc = () => setDoc(props.handle.doc());
  props.handle.on("change", syncDoc);
  onCleanup(() => props.handle.off("change", syncDoc));
  const kind = () => doc()?.kind ?? "all";
  const period = () => doc()?.period ?? "week";

  // Where the card is in its lifecycle, shown on its face: nomap | searching
  // | { done, count } | empty | error.
  const [status, setStatus] = createSignal({ state: "nomap" });

  // One found species plus the url of the bird-card minted for it, so a list
  // row can light its own pin on hover. Replaced wholesale on each new search.
  const [rows, setRows] = createSignal([]);

  // Read the map schema's matches (a live set of map document urls, usually
  // one). The declared key interest is itself the query the schema matcher
  // answers.
  const [schemaMatches, setSchemaMatches] = createSignal({});
  onCleanup(
    subscribeContext(props.element, SchemaMatches, setSchemaMatches, [MAP_KEY]),
  );
  const mapUrls = createMemo(() => schemaMatches()[MAP_KEY] ?? []);

  // The map we currently track and its "change" listener (fires on pan/zoom/
  // resize, since the map mirrors its box into `bounds`).
  const [mapUrl, setMapUrl] = createSignal(undefined);
  let mapHandle;
  let mapChange;

  let timer;
  // Bumped per search so a slow fetch from an old view can't overwrite a newer.
  let generation = 0;

  // Offer our minted bird-cards to the canvas by writing them straight into
  // SchemaMatches — under whichever *queried* schema they satisfy — rather
  // than announcing them as mounted docs for the resolver to rediscover. Each
  // bird-card carries top-level { lat, lon }, so it satisfies the map's geo
  // query; the map reads the union of every SchemaMatches slice, so ours
  // merges in and its pins appear alongside everything else.
  const matchesOut = getContextHandle(props.element, SchemaMatches);

  // The demand we answer: the union of keys SchemaMatches readers declare —
  // the same reader registry the schema matcher watches; a query is a declared
  // read interest, not a channel entry. Our own MAP_KEY interest shows up here
  // too, harmlessly (the bird-card probe never satisfies the map schema).
  const [queriedKeys, setQueriedKeys] = createSignal([], {
    equals: (a, b) => a.length === b.length && a.every((key, i) => key === b[i]),
  });
  const readKeys = () => {
    const keys = new Set();
    for (const interest of store.interests(SchemaMatches)) {
      for (const key of interest.keys ?? []) keys.add(key);
    }
    return [...keys].sort();
  };
  setQueriedKeys(readKeys());
  onCleanup(store.subscribeReaders(() => setQueriedKeys(readKeys())));

  // Parsed queried schemas, cached by key (schemas are stable per key). A
  // representative bird-card (they all share this shape) is tested against
  // each so we don't have to inspect every minted card.
  const parsedSchemas = new Map();
  const probe = {
    "@patchwork": { type: "bird-card" },
    name: "",
    sciName: "",
    lat: 0,
    lon: 0,
  };
  const matchingKeys = (queried) => {
    const keys = [];
    for (const key of queried) {
      let schema = parsedSchemas.get(key);
      if (schema === undefined) {
        schema = parseSchemaKey(key);
        if (schema === undefined) continue;
        parsedSchemas.set(key, schema);
      }
      if (jsonSchemaMatches(schema, probe)) keys.push(key);
    }
    return keys;
  };

  // Auxiliary emphasis we contribute on hover: the bird-card under a hovered
  // list row (lighting its map pin) or the map(s) under the hovered "map" word
  // (glowing their embeds). We own this slice, so each hover is a clear-and-set.
  const highlight = getContextHandle(props.element, Highlight);
  const setHighlight = (urls) => {
    highlight.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      for (const url of urls) slice[url] = true;
    });
  };

  const clearCards = () => {
    setRows([]);
  };

  // Read the tracked map's box, ask eBird, then mint a card per species
  // (resolving each photo first) and record it as a row. Publishing to
  // SchemaMatches is left to the effect below. Guarded so a superseded view is
  // discarded.
  const runSearch = async () => {
    const bounds = mapHandle?.doc()?.bounds;
    if (!bounds) {
      setStatus({ state: "nomap" });
      return;
    }
    const mine = ++generation;
    setStatus({ state: "searching" });
    try {
      const results = await fetchSightings(bounds, kind(), period());
      if (mine !== generation) return;
      const images = await Promise.all(
        results.map((r) => lookupImage(r.sciName, r.comName)),
      );
      if (mine !== generation) return;
      const nextRows = results.map((r, i) => {
        const image = images[i];
        const url = repo.create({
          "@patchwork": { type: "bird-card", title: r.comName },
          name: r.comName,
          sciName: r.sciName,
          lat: r.lat,
          lon: r.lon,
          ...(r.locName ? { locName: r.locName } : {}),
          ...(r.obsDt ? { obsDt: r.obsDt } : {}),
          ...(typeof r.howMany === "number" ? { howMany: r.howMany } : {}),
          ...(image ? { imageUrl: image } : {}),
          learnMoreUrl: speciesUrl(r.speciesCode),
        }).url;
        return { ...r, url };
      });
      setRows(nextRows);
      setStatus(
        nextRows.length
          ? { state: "done", count: nextRows.length }
          : { state: "empty" },
      );
    } catch {
      if (mine !== generation) return;
      clearCards();
      setStatus({ state: "error" });
    }
  };

  const scheduleSearch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSearch(), DEBOUNCE_MS);
  };

  const setKind = (next) =>
    props.handle.change((d) => {
      d.kind = next;
    });
  const setPeriod = (next) =>
    props.handle.change((d) => {
      d.period = next;
    });

  // (Re)publish our matches whenever the found cards or the set of queried
  // schemas change: clear our whole slice, then list our card urls under every
  // schema they satisfy.
  createEffect(() => {
    const urls = rows().map((r) => r.url);
    const keys = matchingKeys(queriedKeys());
    matchesOut.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      if (urls.length === 0) return;
      for (const key of keys) slice[key] = urls;
    });
  });

  // Adopt the first matched map as the tracked one.
  createEffect(() => {
    setMapUrl(mapUrls()[0]);
  });

  // (Re)wire the tracked map's change listener and kick off a search. When the
  // map goes away, clear our pins.
  createEffect(() => {
    const next = mapUrl();
    if (mapHandle && mapChange) mapHandle.off("change", mapChange);
    mapHandle = undefined;
    mapChange = undefined;
    if (!next) {
      clearCards();
      setStatus({ state: "nomap" });
      return;
    }
    void Promise.resolve(repo.find(next)).then((h) => {
      if (mapUrl() !== next) return; // changed again while resolving
      mapHandle = h;
      mapChange = () => scheduleSearch();
      h.on("change", mapChange);
      scheduleSearch();
    });
  });

  // Re-search when the madlib choices change (once a map is tracked).
  createEffect(() => {
    kind();
    period();
    if (mapHandle) scheduleSearch();
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    if (mapHandle && mapChange) mapHandle.off("change", mapChange);
    matchesOut.release();
    highlight.release();
  });

  // The middle-slot content: the madlib sentence, a status line, and the list
  // of found species. The card face (title, description, corner pips) is drawn
  // by the shared card shell.
  return html`<div class="embark-bird">
    <p class="embark-bird__madlib">
      Showing${" "}
      <select
        class="embark-bird__swap"
        prop:value=${kind}
        on:change=${(e) => setKind(e.currentTarget.value)}
      >
        <option value="all">all birds</option>
        <option value="rare">rare birds</option></select
      >${" "}spotted${" "}
      <select
        class="embark-bird__swap"
        prop:value=${period}
        on:change=${(e) => setPeriod(e.currentTarget.value)}
      >
        <option value="today">today</option>
        <option value="week">this week</option>
        <option value="month">this month</option></select
      >${" "}on any${" "}
      <span
        class="embark-bird__maplink"
        on:mouseenter=${() => setHighlight(mapUrls())}
        on:mouseleave=${() => setHighlight([])}
        >map</span
      >.
    </p>

    <div
      class="embark-bird__status"
      classList=${() => ({
        "is-error": status().state === "error",
        "is-busy": status().state === "searching",
      })}
    >
      ${() => statusText(status())}
    </div>

    <${Show} when=${() => rows().length > 0}>
      <ul class="embark-bird__list">
        <${For} each=${rows}>
          ${(s) =>
            html`<li
              class="embark-bird__row"
              on:mouseenter=${() => setHighlight([s.url])}
              on:mouseleave=${() => setHighlight([])}
            >
              <span class="embark-bird__row-name">${s.comName}</span>
              <${Show} when=${s.locName}>
                <span class="embark-bird__row-sub">${s.locName}</span>
              <//>
            </li>`}
        <//>
      </ul>
    <//>
  </div>`;
}

// A published query key back to its schema: keys are `schemaKey(schema)` —
// canonical JSON — so parsing recovers the schema exactly. An unparseable key
// (a rogue writer) simply matches nothing.
function parseSchemaKey(key) {
  try {
    return JSON.parse(key);
  } catch {
    return undefined;
  }
}

function statusText(status) {
  switch (status.state) {
    case "nomap":
      return "Open a map on the canvas to see what's flying nearby.";
    case "searching":
      return "Looking for birds\u2026";
    case "empty":
      return "No sightings reported here yet.";
    case "error":
      return "Couldn't reach eBird.";
    case "done":
      return `${status.count} species seen recently`;
  }
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-bird-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* The Bird Sightings card's middle-slot content: a madlib sentence, a status
   line, and a compact list of found species. The card frame, title, and pips
   are drawn by the shared card shell. */
const CSS = `
.embark-bird {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

/* The "map" word in the sentence: an underlined affordance that, on hover,
   glows the map(s) this card searches. */
.embark-bird__maplink {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  font-weight: 600;
  color: #0369a1;
  cursor: pointer;
}

.embark-bird__maplink:hover {
  color: #0ea5e9;
}

/* The madlib sentence: normal prose with the two choices rendered as editable
   "blanks" rather than obvious form controls. */
.embark-bird__madlib {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #292524;
}

.embark-bird__swap {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  border-bottom: 2px dotted #0ea5e9;
  border-radius: 0;
  background: transparent;
  padding: 0 2px;
  margin: 0 1px;
  font: inherit;
  font-weight: 700;
  color: #0369a1;
  cursor: pointer;
}

.embark-bird__swap:focus {
  outline: none;
  background: #e0f2fe;
}

.embark-bird__status {
  font-size: 12px;
  color: #78716c;
}

.embark-bird__status.is-error {
  color: #dc2626;
}

.embark-bird__status.is-busy {
  color: #0284c7;
}

/* The compact list of found species (the full cards live on the map as pins). */
.embark-bird__list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  max-height: 180px;
}

.embark-bird__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 1px 4px;
  margin: 0 -4px;
  border-radius: 4px;
  cursor: pointer;
}

/* Hovering a row glows its pin on the map; tint the row so the link is felt. */
.embark-bird__row:hover {
  background: #e0f2fe;
}

.embark-bird__row-name {
  font-size: 13px;
  font-weight: 600;
  color: #1c1917;
  white-space: nowrap;
}

.embark-bird__row-sub {
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
