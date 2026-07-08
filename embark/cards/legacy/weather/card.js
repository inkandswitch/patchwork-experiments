// Weather card behavior, loaded by the shared card shell as this package's
// `card.js`. A contributor that answers the canvas command channel with a
// `/weather <place>` command: it reads the active queries and, for each
// weather query, resolves the place to coordinates, fetches the day's
// forecast, mints a weather-card document, and offers it as a suggestion whose
// inserted token renders an inline weather widget. The card's face is drawn by
// the shared card shell, so it renders nothing into the middle slot; all of
// its working state lives in the shared canvas context.
//
// The package also ships the `weather-card` datatype it mints for each
// forecast, a board tool, and a `"token"`-tagged tool for the inline chip.
// Those ride this module's `plugins` export: the card shell registers them
// while the card is face-up and retracts them when it flips down.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards are imported with relative paths (every card lives in the one shared
// cards package) and the core platform comes from ../platform.js.

import { findContextStore, requireOwner } from "../platform.js";
import { CommandQueries, CommandSuggestions } from "../commands-card/channels.js";
import { createPlaceResolver } from "../commands-card/place-resolve.js";

// The datatype/board/token tools that live and die with this card. Their
// implementations load lazily from sibling modules.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "weather-card",
    name: "Weather",
    icon: "CloudSun",
    async load() {
      const { WeatherCardDatatype } = await import("./datatype.js");
      return WeatherCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "weather-card",
    name: "Weather",
    icon: "CloudSun",
    supportedDatatypes: ["weather-card"],
    async load() {
      const { WeatherCardView } = await import("./view.js");
      return WeatherCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "weather-card-token",
    name: "Weather token",
    icon: "CloudSun",
    supportedDatatypes: ["weather-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { WeatherCardToken } = await import("./token.js");
      return WeatherCardToken;
    },
  },
];

// Wait this long after the query last changed before resolving it (so each
// keystroke of `/weather berl…` doesn't fire a fetch).
const DEBOUNCE_MS = 350;

export default function card(_handle, element) {
  const repo = element.repo;
  const store = findContextStore(element);
  const owner = requireOwner(element);
  // Shared place resolution (canvas {lat, lon} matches first, then search).
  const resolver = createPlaceResolver(store, repo, owner);
  const suggestions = store.handle(CommandSuggestions, owner);

  // Per-query debounce timers, the queries we've already answered, and the ones
  // currently resolving (so the same query isn't fetched twice). Resolved
  // locations are cached so a place isn't re-fetched or its card re-minted.
  const timers = new Map();
  const handled = new Set();
  const inFlight = new Set();
  const cardCache = new Map();
  let disposed = false;

  // Reconcile our scheduled work against the currently active command queries:
  // debounce a resolve for each new weather query, and forget the ones that
  // disappeared (cancel timers, drop our answered set, prune our suggestions).
  const onQueries = () => {
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
    suggestions.change((slice) => {
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
  const resolve = async (query) => {
    if (disposed) return;
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
      suggestions.change((slice) => {
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
  const mintCard = (located, weather) => {
    return repo.create({
      "@patchwork": { type: "weather-card", title: `Weather in ${located.place}` },
      ...(located.url ? { place: located.url } : {}),
      date: weather.date,
      tempMax: weather.max,
      tempMin: weather.min,
      emoji: weather.emoji,
      summary: weather.label,
    }).url;
  };

  // Re-answer whenever the active commands change. `subscribe` doesn't fire an
  // initial call, so seed once.
  const unsubscribeQueries = store.subscribe(CommandQueries, onQueries, { owner });
  onQueries();

  return () => {
    disposed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeQueries();
    suggestions.release();
    resolver.release();
  };
}

// Parse a `/`-command query into the place to look up, or null when it isn't a
// weather command. The first token must be a prefix of "weather" (so `/weath…`
// surfaces it) and at least 4 chars to avoid hijacking unrelated commands; the
// rest is the place (empty until the user types one).
function parseWeather(query) {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const space = trimmed.search(/\s/);
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const place = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const isWeather = command.length >= 4 && "weather".startsWith(command);
  if (!isWeather || !place) return null;
  return place;
}

// Whether a `/` query should surface the eager weather sample: the bare command
// (`/`, query "") or a partial command prefix with no place yet (`/w`,
// `/weather`). A query with a typed place goes through `parseWeather` instead,
// and unrelated commands (whose prefix isn't part of "weather") are ignored.
function isWeatherDiscovery(query) {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (/\s/.test(trimmed)) return false; // a place was typed → not discovery
  return "weather".startsWith(trimmed.toLowerCase());
}

// The menu label for a forecast suggestion, e.g. "Weather: Berlin ☀️ 12°/5°".
function menuLabel(located, weather) {
  return `Weather: ${located.place} ${weather.emoji} ${weather.max}\u00b0/${weather.min}\u00b0`;
}

// Today's forecast for a coordinate from Open-Meteo (keyless). `forecast_days=1`
// and `timezone=auto` keep it to the location's current day.
async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=1`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
  const data = await response.json();
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
function describeWeather(code) {
  const table = {
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
