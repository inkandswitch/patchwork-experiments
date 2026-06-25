import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { z } from "zod";
import {
  findContextStore,
  type ContextStore,
  type ScopeHandle,
} from "../../lib/context";
import {
  CommandQueries,
  CommandSuggestions,
  SchemaMatches,
  SchemaQueries,
  SearchQueries,
  SearchResults,
  schemaKey,
} from "../../canvas/channels";
import type { JsonSchema } from "../../lib/schema";
import { fuzzyMatch } from "../../lib/fuzzy";
import { listFiles, writeFile } from "../../llm-card/folder";
import type { FolderDoc } from "../../llm-card/types";
import type { CardDoc } from "../../card/datatype";
import type { Suggestion } from "../../commands/datatype";
import type { WeatherProviderDoc } from "./datatype";
import { VIEW_SOURCE } from "./view-source";
import "./weather.css";

// Wait this long after the query last changed before resolving it (so each
// keystroke of `/weather berl…` doesn't fire a fetch), and give the search
// fallback this long to answer before giving up.
const DEBOUNCE_MS = 350;
const SEARCH_TIMEOUT_MS = 8000;

// The map's question, reused verbatim: "where, in any mounted document, is a
// {lat, lon} pair?" The schema travels as JSON Schema; the canvas resolver
// answers on SchemaMatches keyed by `schemaKey`.
const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JsonSchema;
const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

// A resolved place: coordinates plus a display name for the card and menu.
type Located = { lat: number; lon: number; place: string };

// Today's forecast for one location.
type DayWeather = {
  date: string;
  max: number;
  min: number;
  code: number;
  label: string;
  emoji: string;
};

// Tool entry point: a contributor that answers the canvas command channel with
// a `/weather <place>` command. It reads the active queries and, for each
// weather query, resolves the place to coordinates, fetches the day's forecast,
// mints a `card` document, and offers it as a suggestion whose inserted token
// renders an inline weather widget. The card itself only shows a title and a
// description of what it does — like a playing card in a game.
export const WeatherProviderTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <WeatherProvider
          handle={handle as DocHandle<WeatherProviderDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
};

function WeatherProvider(props: {
  handle: DocHandle<WeatherProviderDoc>;
  element: ToolElement;
}) {
  const repo = props.element.repo;

  // Per-query debounce timers, the queries we've already answered, and the ones
  // currently resolving (so the same query isn't fetched twice). Resolved
  // locations are cached so a place isn't re-fetched or its card re-minted.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const inFlight = new Set<string>();
  const cardCache = new Map<string, { url: AutomergeUrl; label: string }>();

  let store: ContextStore | undefined;
  let suggestions: ScopeHandle<Record<string, Suggestion[]>> | undefined;
  let schemaQueries: ScopeHandle<Record<string, JsonSchema>> | undefined;
  let searchQueries: ScopeHandle<Record<string, true>> | undefined;
  let unsubscribeQueries: (() => void) | undefined;
  // The import url of our inline renderer, served by the host service worker out
  // of a folder doc. Resolved async on mount; suggestions made before it lands
  // fall back to a plain mention pill.
  let viewUrl: string | undefined;
  let disposed = false;

  onMount(() => {
    store = findContextStore(props.element);
    if (!store) return; // opened outside a canvas — nothing to contribute to
    suggestions = store.handle(CommandSuggestions);
    schemaQueries = store.handle(SchemaQueries);
    searchQueries = store.handle(SearchQueries);
    // Ask the canvas where {lat, lon} pairs live, exactly like the map.
    schemaQueries.change((slice) => {
      slice[LATLNG_KEY] = LATLNG_JSON_SCHEMA;
    });
    void ensureViewUrl().then((url) => {
      viewUrl = url;
    });
    // Re-answer whenever the active commands change. `subscribe` doesn't fire an
    // initial call, so seed once.
    unsubscribeQueries = store.subscribe(CommandQueries, onQueries);
    onQueries();
  });

  onCleanup(() => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeQueries?.();
    suggestions?.release();
    schemaQueries?.release();
    searchQueries?.release();
  });

  // Reconcile our scheduled work against the currently active command queries:
  // debounce a resolve for each new weather query, and forget the ones that
  // disappeared (cancel timers, drop our answered set, prune our suggestions).
  const onQueries = () => {
    if (!store) return;
    const active = new Set(Object.keys(store.read(CommandQueries)));

    for (const query of active) {
      const place = parseWeather(query);
      if (!place) continue; // not our command, or no place typed yet
      if (handled.has(query) || inFlight.has(query) || timers.has(query)) {
        continue;
      }
      const timer = setTimeout(() => {
        timers.delete(query);
        void resolve(query, place);
      }, DEBOUNCE_MS);
      timers.set(query, timer);
    }

    for (const query of [...handled]) {
      if (!active.has(query)) handled.delete(query);
    }
    for (const [query, timer] of [...timers]) {
      if (active.has(query)) continue;
      clearTimeout(timer);
      timers.delete(query);
    }
    suggestions?.change((slice) => {
      for (const query of Object.keys(slice)) {
        if (!active.has(query)) delete slice[query];
      }
    });
  };

  // Resolve a weather query end to end: place -> coordinates -> forecast -> card
  // -> suggestion. Bails out (leaving the query unanswered, so a later edit
  // re-queues it) if the place can't be located or the query is dropped mid-way.
  const resolve = async (query: string, place: string) => {
    if (!store || disposed) return;
    inFlight.add(query);
    try {
      const located = await resolveLatLon(place);
      if (disposed || !located) return;
      if (!(query in store.read(CommandQueries))) return; // dropped while resolving

      const key = `${located.lat.toFixed(2)},${located.lon.toFixed(2)}`;
      let cached = cardCache.get(key);
      if (!cached) {
        const weather = await fetchWeather(located.lat, located.lon);
        if (disposed || !(query in store.read(CommandQueries))) return;
        cached = { url: mintCard(located, weather), label: menuLabel(located, weather) };
        cardCache.set(key, cached);
      }

      const entry = cached;
      suggestions?.change((slice) => {
        slice[query] = [
          { label: entry.label, url: entry.url, ...(viewUrl ? { viewUrl } : {}) },
        ];
      });
      handled.add(query);
    } catch {
      // Leave the query unanswered; a later edit re-queues it.
    } finally {
      inFlight.delete(query);
    }
  };

  // Locate a place: first among the {lat, lon} pairs already on the canvas
  // (matched by the canvas schema resolver, like the map sees), then — if none
  // of those names fuzzily match — via a one-off search.
  const resolveLatLon = async (place: string): Promise<Located | null> => {
    if (!store) return null;
    const matches = store.read(SchemaMatches)[LATLNG_KEY] ?? [];
    for (const match of matches) {
      const found = await locationFromMatch(match, place);
      if (found) return found;
    }
    return resolveViaSearch(place);
  };

  // Read a {lat, lon} match's coordinates and the name of the document it lives
  // in, returning it only when that name fuzzily matches the requested place.
  const locationFromMatch = async (
    match: AutomergeUrl,
    place: string,
  ): Promise<Located | null> => {
    try {
      const node = (await Promise.resolve(repo.find<unknown>(match))).doc() as
        | { lat?: unknown; lon?: unknown; name?: unknown }
        | undefined;
      const lat = node?.lat;
      const lon = node?.lon;
      if (typeof lat !== "number" || typeof lon !== "number") return null;
      // The matched node is often a card's `props` (which carries `name`); if
      // not, fall back to the owning document's title.
      let name = typeof node?.name === "string" ? node.name : "";
      if (!name) {
        const ownerUrl =
          `automerge:${parseAutomergeUrl(match).documentId}` as AutomergeUrl;
        name = docTitle((await Promise.resolve(repo.find<unknown>(ownerUrl))).doc());
      }
      if (name && fuzzyMatch(name, place)) return { lat, lon, place: name };
    } catch {
      // ignore matches that fail to load
    }
    return null;
  };

  // Drive the search channel for `place` and keep the first result document
  // that carries coordinates (e.g. a POI card's `props.lat`/`props.lon`). The
  // query is cleared again once we're done so it doesn't linger on the canvas.
  const resolveViaSearch = async (place: string): Promise<Located | null> => {
    if (!store) return null;
    searchQueries?.change((slice) => {
      slice[place] = true;
    });
    try {
      const urls = await waitForResults(store, place, SEARCH_TIMEOUT_MS);
      for (const url of urls) {
        try {
          const card = (await Promise.resolve(repo.find<unknown>(url))).doc() as
            | { props?: { lat?: unknown; lon?: unknown; name?: unknown } }
            | undefined;
          const lat = card?.props?.lat;
          const lon = card?.props?.lon;
          if (typeof lat === "number" && typeof lon === "number") {
            const name =
              typeof card?.props?.name === "string" ? card.props.name : place;
            return { lat, lon, place: name };
          }
        } catch {
          // skip results that fail to load
        }
      }
      return null;
    } finally {
      searchQueries?.change((slice) => {
        delete slice[place];
      });
    }
  };

  // One generic card per forecast, with the weather flattened into `props` so
  // both our inline renderer and the standalone CardTool can read it.
  const mintCard = (located: Located, weather: DayWeather): AutomergeUrl =>
    repo.create<CardDoc>({
      "@patchwork": { type: "card" },
      props: {
        name: `Weather: ${located.place}`,
        place: located.place,
        lat: located.lat,
        lon: located.lon,
        date: weather.date,
        tempMax: weather.max,
        tempMin: weather.min,
        code: weather.code,
        emoji: weather.emoji,
        summary: weather.label,
      },
      content: `${located.place}: ${weather.label}, ${weather.max}\u00b0/${weather.min}\u00b0 (${weather.date})`,
    }).url;

  // Ensure the renderer folder exists (persisted on the provider doc so the url
  // is stable across reloads), write view.js once, and pin the import url to the
  // folder's current heads — matching ../../llm-card/effect-loader.ts so the
  // service worker resolves it.
  const ensureViewUrl = async (): Promise<string | undefined> => {
    try {
      let folderUrl = props.handle.doc()?.folderUrl;
      if (!folderUrl) {
        const folder = repo.create<FolderDoc>({
          "@patchwork": { type: "folder", title: "weather card view" },
          title: "weather card view",
          docs: [],
        });
        folderUrl = folder.url;
        props.handle.change((doc) => {
          doc.folderUrl = folder.url;
        });
      }
      const names = await listFiles(repo, folderUrl);
      if (!names.includes("view.js")) {
        await writeFile(repo, folderUrl, "view.js", VIEW_SOURCE);
      }
      const folder = await repo.find<FolderDoc>(folderUrl);
      const pinned = stringifyAutomergeUrl({
        documentId: folder.documentId,
        heads: folder.heads(),
      });
      return `/${encodeURIComponent(pinned)}/view.js`;
    } catch {
      return undefined; // degrade to a plain pill if the renderer can't be set up
    }
  };

  return (
    <div class="embark-weather-card">
      <span class="embark-weather-card__pip embark-weather-card__pip--tl">
        <SunIcon />
      </span>
      <div class="embark-weather-card__body">
        <div class="embark-weather-card__title">Weather</div>
        <p class="embark-weather-card__desc">
          Adds a <code>/weather</code> command. Type{" "}
          <code>/weather berlin</code> in a note to drop today's forecast,
          resolved from places already on the canvas or a quick search.
        </p>
        <div class="embark-weather-card__source">Open-Meteo</div>
      </div>
      <span class="embark-weather-card__pip embark-weather-card__pip--br">
        <SunIcon />
      </span>
    </div>
  );
}

// A small sun glyph used as the card's corner "pips", the way a playing card
// carries its suit in opposite corners.
function SunIcon() {
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
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

// Parse a `/`-command query into the place to look up, or null when it isn't a
// weather command. The first token must be a prefix of "weather" (so `/weath…`
// surfaces it) and at least 4 chars to avoid hijacking unrelated commands; the
// rest is the place (empty until the user types one).
function parseWeather(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const space = trimmed.search(/\s/);
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const place = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const isWeather = command.length >= 4 && "weather".startsWith(command);
  if (!isWeather || !place) return null;
  return place;
}

// Resolve with the first non-empty results for `place`, or [] after `timeoutMs`.
function waitForResults(
  store: ContextStore,
  place: string,
  timeoutMs: number,
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
    const unsubscribe = store.subscribe(SearchResults, (all) => {
      const urls = all[place];
      if (urls && urls.length) finish(urls);
    });
    const timer = setTimeout(() => finish([]), timeoutMs);
  });
}

// The menu label for a forecast suggestion, e.g. "Weather: Berlin ☀️ 12°/5°".
function menuLabel(located: Located, weather: DayWeather): string {
  return `Weather: ${located.place} ${weather.emoji} ${weather.max}\u00b0/${weather.min}\u00b0`;
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
  if (typeof record.content === "string" && record.content) return record.content;
  return "";
}

// Today's forecast for a coordinate from Open-Meteo (keyless). `forecast_days=1`
// and `timezone=auto` keep it to the location's current day.
async function fetchWeather(lat: number, lon: number): Promise<DayWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=1`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  const daily = data.daily;
  if (!daily?.time?.length) throw new Error("Open-Meteo returned no daily data");
  const code = daily.weather_code?.[0] ?? 0;
  const { label, emoji } = describeWeather(code);
  return {
    date: daily.time[0],
    max: Math.round(daily.temperature_2m_max?.[0] ?? Number.NaN),
    min: Math.round(daily.temperature_2m_min?.[0] ?? Number.NaN),
    code,
    label,
    emoji,
  };
}

// Map a WMO weather-interpretation code to a short label and emoji.
function describeWeather(code: number): { label: string; emoji: string } {
  const table: Record<number, { label: string; emoji: string }> = {
    0: { label: "Clear sky", emoji: "\u2600\ufe0f" },
    1: { label: "Mainly clear", emoji: "\ud83c\udf24\ufe0f" },
    2: { label: "Partly cloudy", emoji: "\u26c5" },
    3: { label: "Overcast", emoji: "\u2601\ufe0f" },
    45: { label: "Fog", emoji: "\ud83c\udf2b\ufe0f" },
    48: { label: "Rime fog", emoji: "\ud83c\udf2b\ufe0f" },
    51: { label: "Light drizzle", emoji: "\ud83c\udf26\ufe0f" },
    53: { label: "Drizzle", emoji: "\ud83c\udf26\ufe0f" },
    55: { label: "Dense drizzle", emoji: "\ud83c\udf26\ufe0f" },
    56: { label: "Freezing drizzle", emoji: "\ud83c\udf27\ufe0f" },
    57: { label: "Freezing drizzle", emoji: "\ud83c\udf27\ufe0f" },
    61: { label: "Light rain", emoji: "\ud83c\udf27\ufe0f" },
    63: { label: "Rain", emoji: "\ud83c\udf27\ufe0f" },
    65: { label: "Heavy rain", emoji: "\ud83c\udf27\ufe0f" },
    66: { label: "Freezing rain", emoji: "\ud83c\udf27\ufe0f" },
    67: { label: "Freezing rain", emoji: "\ud83c\udf27\ufe0f" },
    71: { label: "Light snow", emoji: "\ud83c\udf28\ufe0f" },
    73: { label: "Snow", emoji: "\ud83c\udf28\ufe0f" },
    75: { label: "Heavy snow", emoji: "\u2744\ufe0f" },
    77: { label: "Snow grains", emoji: "\ud83c\udf28\ufe0f" },
    80: { label: "Rain showers", emoji: "\ud83c\udf26\ufe0f" },
    81: { label: "Rain showers", emoji: "\ud83c\udf26\ufe0f" },
    82: { label: "Violent showers", emoji: "\u26c8\ufe0f" },
    85: { label: "Snow showers", emoji: "\ud83c\udf28\ufe0f" },
    86: { label: "Snow showers", emoji: "\ud83c\udf28\ufe0f" },
    95: { label: "Thunderstorm", emoji: "\u26c8\ufe0f" },
    96: { label: "Thunderstorm", emoji: "\u26c8\ufe0f" },
    99: { label: "Thunderstorm with hail", emoji: "\u26c8\ufe0f" },
  };
  return table[code] ?? { label: "Unknown", emoji: "\u26c5" };
}
