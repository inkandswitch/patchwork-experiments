import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import {
  findContextStore,
  type ContextStore,
  type ScopeHandle,
} from "@embark/context";
import {
  CommandQueries,
  CommandSuggestions,
  createPlaceResolver,
  type Located,
  type PlaceResolver,
  type Suggestion,
} from "@embark/commands";
import type { WeatherCardDoc } from "./datatype";
import "./weather.css";

// Wait this long after the query last changed before resolving it (so each
// keystroke of `/weather berl…` doesn't fire a fetch).
const DEBOUNCE_MS = 350;

// Today's forecast for one location.
type DayWeather = {
  date: string;
  max: number;
  min: number;
  code: number;
  label: string;
  emoji: string;
};

// A contributor that answers the canvas command channel with a `/weather
// <place>` command. It reads the active queries and, for each weather query,
// resolves the place to coordinates, fetches the day's forecast, mints a `card`
// document, and offers it as a suggestion whose inserted token renders an inline
// weather widget. The component itself only shows a title and a description of
// what it does — like a playing card in a game. It is handle-less: there is no
// backing document, so all of its state lives in the shared canvas context.
export function WeatherProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;

  // Per-query debounce timers, the queries we've already answered, and the ones
  // currently resolving (so the same query isn't fetched twice). Resolved
  // locations are cached so a place isn't re-fetched or its card re-minted.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const inFlight = new Set<string>();
  const cardCache = new Map<string, { url: AutomergeUrl; label: string }>();

  let store: ContextStore | undefined;
  let resolver: PlaceResolver | undefined;
  let suggestions: ScopeHandle<Record<string, Suggestion[]>> | undefined;
  let unsubscribeQueries: (() => void) | undefined;
  let disposed = false;

  onMount(() => {
    store = findContextStore(props.element);
    if (!store) return; // opened outside a canvas — nothing to contribute to
    // Shared place resolution (canvas {lat, lon} matches first, then search).
    resolver = createPlaceResolver(store, repo);
    suggestions = store.handle(CommandSuggestions);
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
    resolver?.release();
  });

  // Reconcile our scheduled work against the currently active command queries:
  // debounce a resolve for each new weather query, and forget the ones that
  // disappeared (cancel timers, drop our answered set, prune our suggestions).
  const onQueries = () => {
    if (!store) return;
    const active = new Set(Object.keys(store.read(CommandQueries)));

    for (const query of active) {
      // We answer two kinds of query: one with a typed place (`/weather berlin`),
      // and — for discoverability — the bare or partial command (`/`, `/weath`),
      // for which we offer one eager sample built from a place already on the
      // canvas so the user sees what the command does.
      if (!parseWeather(query) && !isWeatherDiscovery(query)) continue;
      if (handled.has(query) || inFlight.has(query) || timers.has(query)) {
        continue;
      }
      const timer = setTimeout(() => {
        timers.delete(query);
        void resolve(query);
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
  // -> suggestion. A query with a typed place is geocoded; a discovery query
  // (`/`, `/weath`) instead showcases one place already on the canvas. Bails out
  // (leaving the query unanswered, so a later edit re-queues it) if no place can
  // be located or the query is dropped mid-way.
  const resolve = async (query: string) => {
    if (!store || disposed || !resolver) return;
    inFlight.add(query);
    try {
      const place = parseWeather(query);
      const located = place
        ? await resolver.resolveLatLon(place)
        : (await resolver.resolveSamples(1))[0] ?? null;
      if (disposed || !located) return;
      if (!(query in store.read(CommandQueries))) return; // dropped while resolving

      const key = `${located.lat.toFixed(2)},${located.lon.toFixed(2)}`;
      let cached = cardCache.get(key);
      if (!cached) {
        const weather = await fetchWeather(located.lat, located.lon);
        if (disposed || !(query in store.read(CommandQueries))) return;
        cached = {
          url: mintCard(located, weather),
          label: menuLabel(located, weather),
        };
        cardCache.set(key, cached);
      }

      const entry = cached;
      suggestions?.change((slice) => {
        slice[query] = [{ label: entry.label, url: entry.url }];
      });
      handled.add(query);
    } catch {
      // Leave the query unanswered; a later edit re-queues it.
    } finally {
      inFlight.delete(query);
    }
  };

  // One weather-card per forecast. The place isn't duplicated — `place` links to
  // the poi-card the resolver located (its canonical name + coordinates), which
  // the card's faces resolve live. The display name lives in `@patchwork.title`,
  // and the datatype's registered tools paint the board and token faces.
  const mintCard = (located: Located, weather: DayWeather): AutomergeUrl => {
    return repo.create<WeatherCardDoc>({
      "@patchwork": { type: "weather-card", title: `Weather in ${located.place}` },
      ...(located.url ? { place: located.url } : {}),
      date: weather.date,
      tempMax: weather.max,
      tempMin: weather.min,
      emoji: weather.emoji,
      summary: weather.label,
    }).url;
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
  const command = (
    space === -1 ? trimmed : trimmed.slice(0, space)
  ).toLowerCase();
  const place = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const isWeather = command.length >= 4 && "weather".startsWith(command);
  if (!isWeather || !place) return null;
  return place;
}

// Whether a `/` query should surface the eager weather sample: the bare command
// (`/`, query "") or a partial command prefix with no place yet (`/w`,
// `/weather`). A query with a typed place goes through `parseWeather` instead,
// and unrelated commands (whose prefix isn't part of "weather") are ignored.
function isWeatherDiscovery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (/\s/.test(trimmed)) return false; // a place was typed → not discovery
  return "weather".startsWith(trimmed.toLowerCase());
}

// The menu label for a forecast suggestion, e.g. "Weather: Berlin ☀️ 12°/5°".
function menuLabel(located: Located, weather: DayWeather): string {
  return `Weather: ${located.place} ${weather.emoji} ${weather.max}\u00b0/${weather.min}\u00b0`;
}

// Today's forecast for a coordinate from Open-Meteo (keyless). `forecast_days=1`
// and `timezone=auto` keep it to the location's current day.
async function fetchWeather(lat: number, lon: number): Promise<DayWeather> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
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
  if (!daily?.time?.length)
    throw new Error("Open-Meteo returned no daily data");
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
