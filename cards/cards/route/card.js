// Routes card behavior, loaded by the shared card shell as this package's
// `card.js`. A contributor that answers the canvas command channel with
// `/Drive`, `/Walk`, and `/Transit` commands. For each it resolves two places
// to coordinates — the explicit `<from> to <to>` form, or a separator-less
// `<from> <to>` / lone `<from>` fuzzy-matched against places already on the
// canvas (reusing the shared place resolver, so it biases toward canvas places
// just like weather) — fetches a route from the configured router, mints a
// route-card whose `route` is the decoded polyline (which the map then draws
// as a line), and offers it as a suggestion. The card's face is drawn by the
// shared card shell, so it renders nothing into the middle slot; all of its
// working state lives in the shared canvas context.
//
// The package also ships the `route-card` datatype it mints for each trip, a
// board tool, and a `"token"`-tagged tool for the inline chip. Those ride this
// module's `plugins` export: the card shell registers them while the card is
// face-up and retracts them when it flips down.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const COMMANDS_PACKAGE_URL = "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW";

const { findContextStore, requireOwner } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { CommandQueries, CommandSuggestions } = await import(
  getImportableUrlFromAutomergeUrl(COMMANDS_PACKAGE_URL, "channels.js")
);
const { createPlaceResolver } = await import(
  getImportableUrlFromAutomergeUrl(COMMANDS_PACKAGE_URL, "place-resolve.js")
);
const { ROUTE_PROVIDER } = await import(
  getImportableUrlFromAutomergeUrl(COMMANDS_PACKAGE_URL, "route-provider.js")
);

// The datatype/board/token tools that live and die with this card. Their
// implementations load lazily from sibling modules.
export const plugins = [
  {
    type: "patchwork:datatype",
    id: "route-card",
    name: "Route",
    icon: "Route",
    async load() {
      const { RouteCardDatatype } = await import("./datatype.js");
      return RouteCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "route-card",
    name: "Route",
    icon: "Route",
    supportedDatatypes: ["route-card"],
    async load() {
      const { RouteCardView } = await import("./view.js");
      return RouteCardView;
    },
  },
  {
    type: "patchwork:tool",
    id: "route-card-token",
    name: "Route token",
    icon: "Route",
    supportedDatatypes: ["route-card"],
    tags: ["token"],
    unlisted: true,
    async load() {
      const { RouteCardToken } = await import("./token.js");
      return RouteCardToken;
    },
  },
];

// Wait this long after the query last changed before resolving it, so each
// keystroke of `/Drive berl…` doesn't fire a routing request.
const DEBOUNCE_MS = 350;

// The three commands this one card answers, each mapped to a Valhalla costing
// model (used only when ROUTE_PROVIDER is "valhalla"; on OSRM every mode falls
// back to driving). Transit uses "multimodal"; the public OSM Valhalla server
// often has no GTFS loaded, so it may degrade to walking — fine for a demo.
const COMMANDS = [
  { name: "drive", mode: "Drive", costing: "auto", emoji: "\ud83d\ude97" },
  { name: "walk", mode: "Walk", costing: "pedestrian", emoji: "\ud83d\udeb6" },
  { name: "transit", mode: "Transit", costing: "multimodal", emoji: "\ud83d\ude86" },
];

export default function card(_handle, element) {
  const repo = element.repo;
  const store = findContextStore(element);
  const owner = requireOwner(element);
  const resolver = createPlaceResolver(store, repo, owner);
  const suggestions = store.handle(CommandSuggestions, owner);

  // Per-query debounce timers, the queries we've answered, and the ones
  // currently resolving. Resolved routes are cached so the same trip isn't
  // re-fetched or its card re-minted.
  const timers = new Map();
  const handled = new Set();
  const inFlight = new Set();
  const cardCache = new Map();
  let disposed = false;

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
    suggestions.change((slice) => {
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
  const resolve = async (query) => {
    if (disposed) return;
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

  // Turn a query into a mode and two located endpoints, or null when they
  // can't be found. Tries, in order: the explicit `<from> to <to>` form, a
  // separator-less `<from> <to>` segmented against the canvas's places, a lone
  // origin paired with one other canvas place, and — for a bare command
  // (discovery) — a sample trip between two canvas places.
  const resolveEndpoints = async (query) => {
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
  const inferEndpoints = async (args) => {
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
  const originWithSampleDestination = async (mode, args) => {
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
  const mintCard = (mode, from, to, route) => {
    return repo.create({
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

// Parse a `/`-command query into its mode and raw arguments. The first token
// must be a prefix of one command name (>= 3 chars, to avoid hijacking
// unrelated commands); `args` is everything after it, in whatever shape the
// user typed (`<from> to <to>`, or just place names). Null when it isn't a
// routing command or no arguments were typed yet (that's discovery's job).
function parseCommand(query) {
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
function splitOnTo(args) {
  const parts = args.split(/\s+to\s+/i);
  if (parts.length < 2) return null;
  const from = parts[0].trim();
  const to = parts.slice(1).join(" to ").trim();
  if (!from || !to) return null;
  return { from, to };
}

// Whether a `/` query should surface the eager route sample: the bare command
// (`/`, query "") or a partial command prefix with no args yet (`/d`, `/walk`).
// A query with arguments goes through `parseCommand` instead, and unrelated
// commands (whose prefix isn't part of any command name) are ignored.
function isRouteDiscovery(query) {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  if (/\s/.test(trimmed)) return false; // args typed → not discovery
  return COMMANDS.some((c) => c.name.startsWith(trimmed.toLowerCase()));
}

// The menu label for a route suggestion, e.g. "🚗 Berlin → Munich · 504 km · 5 h 12 m".
function menuLabel(mode, from, to, route) {
  return `${mode.emoji} ${from.place} \u2192 ${to.place} \u00b7 ${formatKm(
    route.distanceKm,
  )} \u00b7 ${formatDuration(route.durationS)}`;
}

const coordKey = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

// Fetch a route from whichever backend the `ROUTE_PROVIDER` flag selects. On
// OSRM the `costing` is ignored — the public demo server only knows driving, so
// walk/transit fall back to a car route (its distance and duration, even though
// the minted card keeps the mode the user typed).
async function fetchRoute(from, to, costing) {
  return ROUTE_PROVIDER === "valhalla"
    ? fetchValhallaRoute(from, to, costing)
    : fetchOsrmRoute(from, to);
}

// A route from Valhalla (https://valhalla1.openstreetmap.de). The geometry comes
// back as an encoded polyline in each leg's `shape`, at precision 6 (polyline6,
// not the standard 5), so decode accordingly and concatenate the legs.
async function fetchValhallaRoute(from, to, costing) {
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
  const data = await response.json();
  const coords = [];
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
async function fetchOsrmRoute(from, to) {
  const path = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${path}` +
    `?overview=full&geometries=polyline6`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OSRM responded ${response.status}`);
  const data = await response.json();
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
function decodePolyline(encoded, precision) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
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
function formatKm(km) {
  if (!Number.isFinite(km)) return "";
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// Seconds as "5 h 12 m" / "12 m", or "" for an unknown duration.
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
