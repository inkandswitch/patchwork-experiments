import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import {
  findContextStore,
  requireOwner,
  type ContextStore,
  type ScopeHandle,
} from "@embark/context";
import {
  CommandQueries,
  CommandSuggestions,
  ROUTE_PROVIDER,
  createPlaceResolver,
  type Located,
  type PlaceResolver,
  type Suggestion,
} from "@embark/commands";
import type { RouteCardDoc } from "./datatype";

// Wait this long after the query last changed before resolving it, so each
// keystroke of `/Drive berl…` doesn't fire a routing request.
const DEBOUNCE_MS = 350;

// The three commands this one card answers, each mapped to a Valhalla costing
// model (used only when ROUTE_PROVIDER is "valhalla"; on OSRM every mode falls
// back to driving). Transit uses "multimodal"; the public OSM Valhalla server
// often has no GTFS loaded, so it may degrade to walking — fine for a demo.
type Mode = { name: string; mode: string; costing: string; emoji: string };
const COMMANDS: Mode[] = [
  { name: "drive", mode: "Drive", costing: "auto", emoji: "\ud83d\ude97" },
  { name: "walk", mode: "Walk", costing: "pedestrian", emoji: "\ud83d\udeb6" },
  { name: "transit", mode: "Transit", costing: "multimodal", emoji: "\ud83d\ude86" },
];

type LatLon = { lat: number; lon: number };
type RouteResult = { coords: LatLon[]; distanceKm: number; durationS: number };

// A contributor that answers the canvas command channel with `/Drive`, `/Walk`,
// and `/Transit` commands. For each it resolves two places to coordinates —
// the explicit `<from> to <to>` form, or a separator-less `<from> <to>` /
// lone `<from>` fuzzy-matched against places already on the canvas (reusing
// the shared place resolver, so it biases toward canvas places just like
// weather) — fetches a route from the configured router, mints a route-card
// whose `route` is the decoded polyline
// (which the map then draws as a line), and offers it as a suggestion. The
// card's face is drawn by the shared card shell, so it renders nothing into the
// middle slot; all of its working state lives in the shared canvas context.
export function RouteProvider(props: { element: ToolElement }) {
  const repo = props.element.repo;

  // Per-query debounce timers, the queries we've answered, and the ones
  // currently resolving. Resolved routes are cached so the same trip isn't
  // re-fetched or its card re-minted.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const inFlight = new Set<string>();
  const cardCache = new Map<string, { url: AutomergeUrl; label: string }>();

  // Resolved on mount (always a store now: the enclosing context, or the
  // page-global body store). Assigned before any of the callbacks below run.
  let store!: ContextStore;
  let resolver: PlaceResolver | undefined;
  let suggestions: ScopeHandle<Record<string, Suggestion[]>> | undefined;
  let unsubscribeQueries: (() => void) | undefined;
  let disposed = false;

  onMount(() => {
    store = findContextStore(props.element);
    const owner = requireOwner(props.element);
    resolver = createPlaceResolver(store, repo, owner);
    suggestions = store.handle(CommandSuggestions, owner);
    unsubscribeQueries = store.subscribe(CommandQueries, onQueries, { owner });
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

  // Reconcile scheduled work against the active command queries: debounce a
  // resolve for each new routing query, and forget the ones that disappeared.
  const onQueries = () => {
    const active = new Set(Object.keys(store.read(CommandQueries)));

    for (const query of active) {
      if (!parseCommand(query) && !isRouteDiscovery(query)) continue;
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

  // Resolve a routing query end to end: places -> coordinates -> route
  // -> card -> suggestion. Bails out (leaving the query unanswered) if the
  // places can't be located, the route fails, or the query is dropped mid-way.
  // Whatever shape the query takes, at most one route is fetched per query, so
  // typing never fans out into a batch of routing requests.
  const resolve = async (query: string) => {
    if (disposed || !resolver) return;
    inFlight.add(query);
    try {
      const endpoints = await resolveEndpoints(query);
      if (disposed || !endpoints) return;
      const { mode, from, to } = endpoints;
      if (!(query in store.read(CommandQueries))) return; // dropped while resolving

      const key = `${mode.costing}|${coordKey(from)}|${coordKey(to)}`;
      let cached = cardCache.get(key);
      if (!cached) {
        const route = await fetchRoute(from, to, mode.costing);
        if (disposed || !(query in store.read(CommandQueries))) return;
        cached = {
          url: mintCard(mode, from, to, route),
          label: menuLabel(mode, from, to, route),
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

  // Turn a query into a mode and two located endpoints, or null when they
  // can't be found. Tries, in order: the explicit `<from> to <to>` form, a
  // separator-less `<from> <to>` segmented against the canvas's places, a lone
  // origin paired with one other canvas place, and — for a bare command
  // (discovery) — a sample trip between two canvas places.
  const resolveEndpoints = async (
    query: string,
  ): Promise<{ mode: Mode; from: Located; to: Located } | null> => {
    if (!resolver) return null;
    const parsed = parseCommand(query);
    if (!parsed) {
      const samples = await resolver.resolveSamples(2);
      if (!samples[0] || !samples[1]) return null;
      return { mode: COMMANDS[0], from: samples[0], to: samples[1] };
    }
    const { mode, args } = parsed;
    const explicit = splitOnTo(args);
    if (explicit) {
      const from = await resolver.resolveLatLon(explicit.from);
      const to = from ? await resolver.resolveLatLon(explicit.to) : null;
      return from && to ? { mode, from, to } : null;
    }
    const inferred = await inferEndpoints(args);
    if (inferred) return { mode, ...inferred };
    return originWithSampleDestination(mode, args);
  };

  // Segment a separator-less "<from> <to>" by trying every token split
  // (longest origin first) and keeping the first where both halves fuzzy-match
  // places already on the canvas at distinct coordinates. Canvas-only matching
  // — speculative fragments must not fire one-off searches. Segments under 2
  // chars are skipped so a lone letter doesn't substring-match half the canvas.
  const inferEndpoints = async (
    args: string,
  ): Promise<{ from: Located; to: Located } | null> => {
    if (!resolver) return null;
    const tokens = args.split(/\s+/).filter(Boolean);
    for (let split = tokens.length - 1; split >= 1; split--) {
      const fromText = tokens.slice(0, split).join(" ");
      const toText = tokens.slice(split).join(" ");
      if (fromText.length < 2 || toText.length < 2) continue;
      const from = await resolver.matchOnCanvas(fromText);
      if (!from) continue;
      const to = await resolver.matchOnCanvas(toText);
      if (to && coordKey(to) !== coordKey(from)) return { from, to };
    }
    return null;
  };

  // A lone place ("/drive 71A"): use it as the origin and pair it with the
  // first other place on the canvas, so the menu offers one plausible route
  // before a destination has been typed.
  const originWithSampleDestination = async (
    mode: Mode,
    args: string,
  ): Promise<{ mode: Mode; from: Located; to: Located } | null> => {
    if (!resolver) return null;
    const from = await resolver.matchOnCanvas(args);
    if (!from) return null;
    const to = (await resolver.resolveSamples(5)).find(
      (sample) => coordKey(sample) !== coordKey(from),
    );
    return to ? { mode, from, to } : null;
  };

  // One route-card per trip. The endpoints aren't duplicated — `from` and `to`
  // link to the poi-cards the place search located (their canonical names +
  // coordinates), which the card's faces resolve live. `route` is the decoded
  // polyline (an array of {lat, lon}); the schema matcher surfaces it as a
  // "geo line" so the map draws it. The datatype's registered tools paint the
  // board and token faces.
  const mintCard = (
    mode: Mode,
    from: Located,
    to: Located,
    route: RouteResult,
  ): AutomergeUrl => {
    return repo.create<RouteCardDoc>({
      "@patchwork": {
        type: "route-card",
        title: `${mode.mode}: ${from.place} \u2192 ${to.place}`,
      },
      mode: mode.mode,
      emoji: mode.emoji,
      ...(from.url ? { from: from.url } : {}),
      ...(to.url ? { to: to.url } : {}),
      distanceKm: route.distanceKm,
      duration: route.durationS,
      route: route.coords,
    }).url;
  };

  // The card face (title, description, corner pips) is drawn by the shared card
  // shell; this contributor renders nothing into the middle slot.
  return null;
}

// Parse a `/`-command query into its mode and raw arguments. The first token
// must be a prefix of one command name (>= 3 chars, to avoid hijacking
// unrelated commands); `args` is everything after it, in whatever shape the
// user typed (`<from> to <to>`, or just place names). Null when it isn't a
// routing command or no arguments were typed yet (that's discovery's job).
function parseCommand(query: string): { mode: Mode; args: string } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const space = trimmed.search(/\s/);
  if (space === -1) return null; // command only, no args → discovery
  const command = trimmed.slice(0, space).toLowerCase();
  const args = trimmed.slice(space + 1).trim();
  const mode = COMMANDS.find(
    (c) => command.length >= 3 && c.name.startsWith(command),
  );
  if (!mode || !args) return null;
  return { mode, args };
}

// Split "<from> to <to>" on the word "to" (the explicit separator), so
// multi-word place names work. Null when the args carry no separator — the
// caller then falls back to fuzzy segmentation against the canvas's places.
function splitOnTo(args: string): { from: string; to: string } | null {
  const parts = args.split(/\s+to\s+/i);
  if (parts.length < 2) return null;
  const from = parts[0].trim();
  const to = parts.slice(1).join(" to ").trim();
  if (!from || !to) return null;
  return { from, to };
}

// Whether a `/` query should surface the eager route sample: the bare command
// (`/`, query "") or a partial command prefix with no args yet (`/d`, `/walk`).
// A query with arguments goes through `parseRoute` instead, and unrelated
// commands (whose prefix isn't part of any command name) are ignored.
function isRouteDiscovery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (/\s/.test(trimmed)) return false; // args typed → not discovery
  return COMMANDS.some((c) => c.name.startsWith(trimmed.toLowerCase()));
}

// The menu label for a route suggestion, e.g. "🚗 Berlin → Munich · 504 km · 5 h 12 m".
function menuLabel(
  mode: Mode,
  from: Located,
  to: Located,
  route: RouteResult,
): string {
  return `${mode.emoji} ${from.place} \u2192 ${to.place} \u00b7 ${formatKm(
    route.distanceKm,
  )} \u00b7 ${formatDuration(route.durationS)}`;
}

const coordKey = (p: Located): string =>
  `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

// Fetch a route from whichever backend the `ROUTE_PROVIDER` flag selects. On
// OSRM the `costing` is ignored — the public demo server only knows driving, so
// walk/transit fall back to a car route (its distance and duration, even though
// the minted card keeps the mode the user typed).
async function fetchRoute(
  from: LatLon,
  to: LatLon,
  costing: string,
): Promise<RouteResult> {
  return ROUTE_PROVIDER === "valhalla"
    ? fetchValhallaRoute(from, to, costing)
    : fetchOsrmRoute(from, to);
}

// A route from Valhalla (https://valhalla1.openstreetmap.de). The geometry comes
// back as an encoded polyline in each leg's `shape`, at precision 6 (polyline6,
// not the standard 5), so decode accordingly and concatenate the legs.
async function fetchValhallaRoute(
  from: LatLon,
  to: LatLon,
  costing: string,
): Promise<RouteResult> {
  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing,
    directions_options: { units: "km" },
  };
  const response = await fetch("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Valhalla responded ${response.status}`);
  const data = (await response.json()) as {
    trip?: {
      legs?: { shape?: string }[];
      summary?: { length?: number; time?: number };
    };
  };
  const coords: LatLon[] = [];
  for (const leg of data.trip?.legs ?? []) {
    if (leg.shape) coords.push(...decodePolyline(leg.shape, 6));
  }
  if (coords.length < 2) throw new Error("Valhalla returned no route geometry");
  return {
    coords,
    distanceKm: data.trip?.summary?.length ?? Number.NaN,
    durationS: data.trip?.summary?.time ?? Number.NaN,
  };
}

// A driving route from the public OSRM demo server
// (https://router.project-osrm.org). Coordinates go in the URL as `lon,lat`
// pairs; `overview=full` returns the full geometry and `geometries=polyline6`
// encodes it at precision 6, so decodePolyline(..., 6) still applies. Distance
// arrives in metres (Valhalla gave km), so scale it down.
async function fetchOsrmRoute(
  from: LatLon,
  to: LatLon,
): Promise<RouteResult> {
  const path = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${path}` +
    `?overview=full&geometries=polyline6`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
  const data = (await response.json()) as {
    code?: string;
    routes?: { geometry?: string; distance?: number; duration?: number }[];
  };
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.geometry) {
    throw new Error("OSRM returned no route");
  }
  const coords = decodePolyline(route.geometry, 6);
  if (coords.length < 2) throw new Error("OSRM returned no route geometry");
  return {
    coords,
    distanceKm: (route.distance ?? Number.NaN) / 1000,
    durationS: route.duration ?? Number.NaN,
  };
}

// Decode a Google-style encoded polyline into {lat, lon} pairs. `precision` is
// the number of decimal digits the coordinates were encoded at — both routers
// here encode at 6 (Valhalla natively, OSRM via `geometries=polyline6`), so the
// divisor is 1e6 rather than the usual 1e5.
function decodePolyline(encoded: string, precision: number): LatLon[] {
  const factor = 10 ** precision;
  const coords: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push({ lat: lat / factor, lon: lon / factor });
  }
  return coords;
}

// "504 km" / "3.2 km" (one decimal under 10 km), or "" for an unknown distance.
function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "";
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// Seconds as "5 h 12 m" / "12 m", or "" for an unknown duration.
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
