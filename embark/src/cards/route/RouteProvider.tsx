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
import {
  findContextStore,
  type ContextStore,
  type ScopeHandle,
} from "../../lib/context";
import { CommandQueries, CommandSuggestions } from "../../canvas/channels";
import { listFiles, writeFile } from "../../llm-card/folder";
import type { FolderDoc } from "../../llm-card/types";
import type { CardDoc } from "../../card/datatype";
import type { Suggestion } from "../../commands/datatype";
import {
  createPlaceResolver,
  type Located,
  type PlaceResolver,
} from "../place-resolve";
import type { RouteProviderDoc } from "./datatype";
import { VIEW_SOURCE } from "./view-source";
import "./route.css";

// Wait this long after the query last changed before resolving it, so each
// keystroke of `/Drive berl…` doesn't fire a routing request.
const DEBOUNCE_MS = 350;

// The three commands this one card answers, each mapped to a Valhalla costing
// model. Transit uses "multimodal"; the public OSM Valhalla server often has no
// GTFS loaded, so it may degrade to walking — fine for a demo.
type Mode = { name: string; mode: string; costing: string; emoji: string };
const COMMANDS: Mode[] = [
  { name: "drive", mode: "Drive", costing: "auto", emoji: "\ud83d\ude97" },
  { name: "walk", mode: "Walk", costing: "pedestrian", emoji: "\ud83d\udeb6" },
  { name: "transit", mode: "Transit", costing: "multimodal", emoji: "\ud83d\ude86" },
];

type LatLon = { lat: number; lon: number };
type RouteResult = { coords: LatLon[]; distanceKm: number; durationS: number };

// Tool entry point: a contributor that answers the canvas command channel with
// `/Drive`, `/Walk`, and `/Transit` commands. For each it resolves the two
// places (`<from> to <to>`) to coordinates — reusing the shared place resolver,
// so it biases toward places already on the canvas just like weather — fetches a
// route from Valhalla, mints a `card` whose `props.route` is the decoded
// polyline (which the map then draws as a line), and offers it as a suggestion.
export const RouteProviderTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <RouteProvider
          handle={handle as DocHandle<RouteProviderDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
};

function RouteProvider(props: {
  handle: DocHandle<RouteProviderDoc>;
  element: ToolElement;
}) {
  const repo = props.element.repo;

  // Per-query debounce timers, the queries we've answered, and the ones
  // currently resolving. Resolved routes are cached so the same trip isn't
  // re-fetched or its card re-minted.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const handled = new Set<string>();
  const inFlight = new Set<string>();
  const cardCache = new Map<string, { url: AutomergeUrl; label: string }>();

  let store: ContextStore | undefined;
  let resolver: PlaceResolver | undefined;
  let suggestions: ScopeHandle<Record<string, Suggestion[]>> | undefined;
  let unsubscribeQueries: (() => void) | undefined;
  // The import url of our inline renderer, served by the host service worker out
  // of a folder doc. Minted cards await it (so the folder is created at most
  // once) and bake it onto the card doc.
  let viewUrlPromise: Promise<string | undefined> | undefined;
  let disposed = false;

  onMount(() => {
    store = findContextStore(props.element);
    if (!store) return; // opened outside a canvas — nothing to contribute to
    resolver = createPlaceResolver(store, repo);
    suggestions = store.handle(CommandSuggestions);
    viewUrlPromise = ensureViewUrl();
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

  // Reconcile scheduled work against the active command queries: debounce a
  // resolve for each new routing query, and forget the ones that disappeared.
  const onQueries = () => {
    if (!store) return;
    const active = new Set(Object.keys(store.read(CommandQueries)));

    for (const query of active) {
      if (!parseRoute(query) && !isRouteDiscovery(query)) continue;
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

  // Resolve a routing query end to end: places -> coordinates -> Valhalla route
  // -> card -> suggestion. A typed query routes `<from>` to `<to>`; a discovery
  // query (`/`, `/Dri`) instead showcases a drive between two places already on
  // the canvas. Bails out (leaving the query unanswered) if a place can't be
  // located, the route fails, or the query is dropped mid-way.
  const resolve = async (query: string) => {
    if (!store || disposed || !resolver) return;
    inFlight.add(query);
    try {
      const parsed = parseRoute(query);
      let mode: Mode;
      let from: Located | null;
      let to: Located | null;
      if (parsed) {
        mode = parsed.mode;
        from = await resolver.resolveLatLon(parsed.from);
        to = from ? await resolver.resolveLatLon(parsed.to) : null;
      } else {
        mode = COMMANDS[0]; // discovery → a sample Drive
        const samples = await resolver.resolveSamples(2);
        [from, to] = [samples[0] ?? null, samples[1] ?? null];
      }
      if (disposed || !from || !to) return;
      if (!(query in store.read(CommandQueries))) return; // dropped while resolving

      const key = `${mode.costing}|${coordKey(from)}|${coordKey(to)}`;
      let cached = cardCache.get(key);
      if (!cached) {
        const route = await fetchRoute(from, to, mode.costing);
        if (disposed || !(query in store.read(CommandQueries))) return;
        const viewUrl = viewUrlPromise ? await viewUrlPromise : undefined;
        if (disposed || !(query in store.read(CommandQueries))) return;
        cached = {
          url: mintCard(mode, from, to, route, viewUrl),
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

  // One generic card per route, with the trip flattened into `props` so both our
  // inline renderer and the standalone CardTool can read it. `props.route` is
  // the decoded polyline (an array of {lat, lon}); the canvas schema resolver
  // surfaces it as a "geo line" so the map draws it (markers only at the
  // endpoints). The endpoint document ids are stored *bare* (no `automerge:`
  // prefix) so `deepCloneDocument` leaves them alone — cloning a route card
  // keeps its place pills pointing at the real places.
  const mintCard = (
    mode: Mode,
    from: Located,
    to: Located,
    route: RouteResult,
    viewUrl: string | undefined,
  ): AutomergeUrl => {
    const fromId = from.url ? parseAutomergeUrl(from.url).documentId : undefined;
    const toId = to.url ? parseAutomergeUrl(to.url).documentId : undefined;
    return repo.create<CardDoc>({
      "@patchwork": {
        type: "card",
        title: `${mode.mode}: ${from.place} \u2192 ${to.place}`,
      },
      props: {
        name: `${mode.mode}: ${from.place} \u2192 ${to.place}`,
        mode: mode.mode,
        emoji: mode.emoji,
        from: from.place,
        to: to.place,
        ...(fromId ? { fromId } : {}),
        ...(toId ? { toId } : {}),
        distanceKm: route.distanceKm,
        durationS: route.durationS,
        route: route.coords,
      },
      content: `${mode.mode}: ${from.place} \u2192 ${to.place} (${formatKm(
        route.distanceKm,
      )}, ${formatDuration(route.durationS)})`,
      ...(viewUrl ? { viewUrl } : {}),
    }).url;
  };

  // Ensure the renderer folder exists (persisted on the provider doc so the url
  // is stable across reloads), write view.js once, and pin the import url to the
  // folder's current heads — matching ../../llm-card/effect-loader.ts so the
  // service worker resolves it.
  const ensureViewUrl = async (): Promise<string | undefined> => {
    try {
      let folderUrl = props.handle.doc()?.folderUrl;
      if (!folderUrl) {
        const folder = repo.create<FolderDoc>({
          "@patchwork": { type: "folder", title: "route card view" },
          title: "route card view",
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
    <div class="embark-route-card">
      <span class="embark-route-card__pip embark-route-card__pip--tl">
        <RouteIcon />
      </span>
      <div class="embark-route-card__body">
        <div class="embark-route-card__title">Routes</div>
        <p class="embark-route-card__desc">
          Adds <code>/Drive</code>, <code>/Walk</code>, and{" "}
          <code>/Transit</code> commands. Type{" "}
          <code>/Drive berlin to munich</code> in a note to drop a route,
          resolved from places already on the canvas or a quick search.
        </p>
        <div class="embark-route-card__source">Valhalla</div>
      </div>
      <span class="embark-route-card__pip embark-route-card__pip--br">
        <RouteIcon />
      </span>
    </div>
  );
}

// A small route glyph used as the card's corner "pips", the way a playing card
// carries its suit in opposite corners.
function RouteIcon() {
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
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H14a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h5.5" />
    </svg>
  );
}

// Parse a `/`-command query into its mode and the two places. The first token
// must be a prefix of one command name (>= 3 chars, to avoid hijacking unrelated
// commands); the rest is `<from> to <to>`, split on the word "to" so multi-word
// place names work. Null when it isn't a routing command or a place is missing.
function parseRoute(
  query: string,
): { mode: Mode; from: string; to: string } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const space = trimmed.search(/\s/);
  if (space === -1) return null; // command only, no args → discovery
  const command = trimmed.slice(0, space).toLowerCase();
  const rest = trimmed.slice(space + 1).trim();
  const mode = COMMANDS.find(
    (c) => command.length >= 3 && c.name.startsWith(command),
  );
  if (!mode || !rest) return null;
  const parts = rest.split(/\s+to\s+/i);
  if (parts.length < 2) return null; // need both a from and a to
  const from = parts[0].trim();
  const to = parts.slice(1).join(" to ").trim();
  if (!from || !to) return null;
  return { mode, from, to };
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

// A route from Valhalla (https://valhalla1.openstreetmap.de). The geometry comes
// back as an encoded polyline in each leg's `shape`, at precision 6 (polyline6,
// not the standard 5), so decode accordingly and concatenate the legs.
async function fetchRoute(
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

// Decode a Google-style encoded polyline into {lat, lon} pairs. `precision` is
// the number of decimal digits the coordinates were encoded at — Valhalla uses
// 6, so the divisor is 1e6 rather than the usual 1e5.
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
