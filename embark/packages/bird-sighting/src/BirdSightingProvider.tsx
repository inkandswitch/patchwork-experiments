import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import {
  Highlight,
  SchemaMatches,
  SchemaQueries,
  Selection,
  jsonSchemaToZod,
  readContext,
  schemaKey,
  useContextHandle,
  type JsonSchema,
  type SchemaQuery,
} from "@embark/core";
import type {
  BirdCardDoc,
  BirdKind,
  BirdPeriod,
  BirdSightingDoc,
} from "./datatype";
import {
  fetchSightings,
  lookupImage,
  speciesUrl,
  type MapBounds,
  type Sighting,
} from "./ebird";
import "./bird.css";

// Re-search 500ms after the last map move / setting change, so a drag that emits
// a burst of bounds updates only fires one lookup.
const DEBOUNCE_MS = 500;

// The map documents to watch: any `{ "@patchwork": { type: "map" }, bounds }`.
// Hand-written (rather than derived from zod) so the correlation key is stable
// and the canvas resolver — which hydrates this back to zod — sees exactly the
// shape the map-search skill established.
const MAP_JSON_SCHEMA: JsonSchema = {
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
const MAP_QUERY: SchemaQuery = { name: "Maps", schema: MAP_JSON_SCHEMA };

type MapDocLike = { bounds?: MapBounds };

// Where the card is in its lifecycle, shown on its face.
type Status =
  | { state: "nomap" }
  | { state: "searching" }
  | { state: "done"; count: number }
  | { state: "empty" }
  | { state: "error" };

// Tool entry point for the `bird-sighting` datatype: a document-backed card that
// watches the canvas for an open map, reads its visible box, and asks eBird
// what's been seen there — minting a `bird-card` per species so the map pins
// them. `element.repo` is the embed contract; the context store is found by DOM
// discovery from `element`.
export const BirdSightingTool: ToolRender = (handle, element) =>
  render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <BirdSighting
          element={element}
          handle={handle as DocHandle<BirdSightingDoc>}
          selfUrl={handle.url}
        />
      </RepoContext.Provider>
    ),
    element,
  );

function BirdSighting(props: {
  element: ToolElement;
  handle: DocHandle<BirdSightingDoc>;
  selfUrl: AutomergeUrl;
}) {
  const repo = props.element.repo;

  // The two madlib choices live on the backing doc, read reactively so the card
  // face re-renders — and the search re-runs — when either changes.
  const [doc] = useDocument<BirdSightingDoc>(() => props.handle.url);
  const kind = (): BirdKind => doc()?.kind ?? "all";
  const period = (): BirdPeriod => doc()?.period ?? "week";

  const [status, setStatus] = createSignal<Status>({ state: "nomap" });

  // One found species plus the url of the bird-card minted for it, so a list row
  // can light its own pin on hover. Replaced wholesale on each new search.
  type Row = Sighting & { url: AutomergeUrl };
  const [rows, setRows] = createSignal<Row[]>([]);

  // Publish the map schema query and read its matches back (a live set of map
  // document urls, usually one).
  const schemaQueries = useContextHandle(props.element, SchemaQueries);
  schemaQueries.change((slice) => {
    slice[MAP_KEY] = MAP_QUERY;
  });
  const schemaMatches = readContext(props.element, SchemaMatches);
  const mapUrls = createMemo(() => schemaMatches()[MAP_KEY] ?? []);

  // The map we currently track and its "change" listener (fires on pan/zoom/
  // resize, since the map mirrors its box into `bounds`).
  const [mapUrl, setMapUrl] = createSignal<AutomergeUrl | undefined>();
  let mapHandle: DocHandle<MapDocLike> | undefined;
  let mapChange: (() => void) | undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bumped per search so a slow fetch from an old view can't overwrite a newer.
  let generation = 0;

  // Offer our minted bird-cards to the canvas by writing them straight into
  // SchemaMatches — under whichever *published* schema they satisfy — rather
  // than announcing them as mounted docs for the resolver to rediscover. Each
  // bird-card carries top-level { lat, lon }, so it satisfies the map's geo
  // query; the map reads the union of every SchemaMatches slice, so ours merges
  // in and its pins appear alongside everything else. Compiled schemas are
  // cached by key (schemas are stable per key).
  const matchesOut = useContextHandle(props.element, SchemaMatches);
  const publishedQueries = readContext(props.element, SchemaQueries);
  const compiled = new Map<string, ReturnType<typeof jsonSchemaToZod>>();
  // A representative bird-card (they all share this shape), tested against each
  // published schema so we don't have to inspect every minted card.
  const probe = {
    "@patchwork": { type: "bird-card" },
    name: "",
    sciName: "",
    lat: 0,
    lon: 0,
  };
  const matchingKeys = (queries: Record<string, SchemaQuery>): string[] => {
    const keys: string[] = [];
    for (const [key, query] of Object.entries(queries)) {
      let schema = compiled.get(key);
      if (!schema) {
        schema = jsonSchemaToZod(querySchema(query));
        compiled.set(key, schema);
      }
      if (schema.safeParse(probe).success) keys.push(key);
    }
    return keys;
  };

  // Auxiliary emphasis we contribute on hover: the bird-card under a hovered
  // list row (lighting its map pin) or the map(s) under the hovered "map" word
  // (glowing their embeds). We own this slice, so each hover is a clear-and-set.
  const highlight = useContextHandle(props.element, Highlight);
  const setHighlight = (urls: AutomergeUrl[]) => {
    highlight.change((slice) => {
      const entries = slice as Record<string, true>;
      for (const key of Object.keys(entries)) delete entries[key];
      for (const url of urls) entries[url] = true;
    });
  };

  // A subtle ring on the card itself while it's the selected embed — purely the
  // card's own affordance; it no longer lights its pins.
  const selection = readContext(props.element, Selection);
  const isSelected = createMemo(() => {
    if (!isValidAutomergeUrl(props.selfUrl)) return false;
    const selfId = parseAutomergeUrl(props.selfUrl).documentId;
    return Object.keys(selection()).some(
      (url) =>
        isValidAutomergeUrl(url) &&
        parseAutomergeUrl(url).documentId === selfId,
    );
  });

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
      const nextRows: Row[] = results.map((r, i) => {
        const image = images[i];
        const url = repo.create<BirdCardDoc>({
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

  const setKind = (next: BirdKind) =>
    props.handle.change((d) => {
      d.kind = next;
    });
  const setPeriod = (next: BirdPeriod) =>
    props.handle.change((d) => {
      d.period = next;
    });

  // (Re)publish our matches whenever the found cards or the set of published
  // schemas change: clear our whole slice, then list our card urls under every
  // schema they satisfy.
  createEffect(() => {
    const urls = rows().map((r) => r.url);
    const keys = matchingKeys(publishedQueries());
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
    void Promise.resolve(repo.find<MapDocLike>(next)).then((h) => {
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
    schemaQueries.release();
    matchesOut.release();
    highlight.release();
  });

  return (
    <div class="embark-bird-card" classList={{ "is-selected": isSelected() }}>
      <span class="embark-bird-card__pip embark-bird-card__pip--tl">
        <BirdIcon />
      </span>
      <div class="embark-bird-card__body">
        <div class="embark-bird-card__title">Bird Sightings</div>
        <p class="embark-bird-card__madlib">
          {"Showing "}
          <select
            class="embark-bird-card__swap"
            value={kind()}
            onChange={(e) => setKind(e.currentTarget.value as BirdKind)}
          >
            <option value="all">all birds</option>
            <option value="rare">rare birds</option>
          </select>
          {" spotted "}
          <select
            class="embark-bird-card__swap"
            value={period()}
            onChange={(e) => setPeriod(e.currentTarget.value as BirdPeriod)}
          >
            <option value="today">today</option>
            <option value="week">this week</option>
            <option value="month">this month</option>
          </select>
          {" on any "}
          <span
            class="embark-bird-card__maplink"
            onMouseEnter={() => setHighlight(mapUrls())}
            onMouseLeave={() => setHighlight([])}
          >
            map
          </span>
          {"."}
        </p>

        <div
          class="embark-bird-card__status"
          classList={{
            "is-error": status().state === "error",
            "is-busy": status().state === "searching",
          }}
        >
          {statusText(status())}
        </div>

        <Show when={rows().length > 0}>
          <ul class="embark-bird-card__list">
            <For each={rows()}>
              {(s) => (
                <li
                  class="embark-bird-card__row"
                  onMouseEnter={() => setHighlight([s.url])}
                  onMouseLeave={() => setHighlight([])}
                >
                  <span class="embark-bird-card__row-name">{s.comName}</span>
                  <Show when={s.locName}>
                    <span class="embark-bird-card__row-sub">{s.locName}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      <span class="embark-bird-card__pip embark-bird-card__pip--br">
        <BirdIcon />
      </span>
    </div>
  );
}

// The schema to match from a published query. Consumers publish `{ name, schema
// }`, but a bare JSON Schema is unwrapped defensively too (JSON Schema's own
// keyword is `$schema`, never bare `schema`, so this discrimination is safe).
function querySchema(query: SchemaQuery | JsonSchema): JsonSchema {
  if (
    query !== null &&
    typeof query === "object" &&
    !Array.isArray(query) &&
    "schema" in query
  ) {
    return (query as SchemaQuery).schema;
  }
  return query as JsonSchema;
}

function statusText(status: Status): string {
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

// A small bird glyph used as the card's corner "pips", mirroring the poi card's
// map-pin suit marks.
function BirdIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M16 7h.01" />
      <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L3.4 18Z" />
      <path d="m20 7 2 .5-2 .5" />
      <path d="M10 18v3" />
      <path d="M14 17.75V21" />
      <path d="M7 18a6 6 0 0 0 3.84-10.61" />
    </svg>
  );
}
