// Self-contained geo helpers for the map's search overlay. These deliberately
// duplicate (rather than import) the geocoding in the poi card and the routing
// in the route card, so the search interface stands on its own and shares no
// code with either feature. The one exception is the shared `ROUTE_PROVIDER`
// flag, a plain config value so the map and route card switch backends together.
import { ROUTE_PROVIDER } from "@embark/commands";

// A single geocoded place, flattened from a Nominatim result.
export type Place = {
  name: string;
  lat: number;
  lon: number;
  type?: string;
};

export type LatLon = { lat: number; lon: number };

// A decoded route: its geometry plus the headline distance/duration.
export type Route = {
  coords: LatLon[];
  distanceKm: number;
  durationS: number;
};

export type Mode = "drive" | "walk" | "bike" | "transit";

// The Valhalla costing model behind each travel mode the routes tab offers.
// OSRM's public demo server only has the driving profile, so on OSRM every mode
// falls back to a car route (see fetchRoute) and this table goes unused.
const VALHALLA_COSTING: Record<Mode, string> = {
  drive: "auto",
  walk: "pedestrian",
  bike: "bicycle",
  transit: "multimodal",
};

// Nominatim's usage policy asks for at most one request per second, so calls are
// serialized into 1s slots shared across every caller in this module.
const NOMINATIM_MIN_GAP_MS = 1000;
let nextNominatimSlot = 0;

type NominatimItem = {
  name?: string;
  addresstype?: string;
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
};

// Free-text place search against Nominatim, mapped to our flat `Place` shape.
// `jsonv2` returns a short `name` per result; `viewbox` (when given) biases
// results toward a region without restricting to it (no `bounded=1`).
export async function geocode(
  query: string,
  opts: { limit?: number; viewbox?: string } = {},
): Promise<Place[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  await reserveNominatimSlot();
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    trimmed,
  )}&format=jsonv2&addressdetails=1&limit=${opts.limit ?? 8}`;
  if (opts.viewbox) url += `&viewbox=${encodeURIComponent(opts.viewbox)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nominatim responded ${response.status}`);
  const items = (await response.json()) as NominatimItem[];
  return items.map((item) => ({
    name: shortPlaceName(item),
    lat: Number(item.lat),
    lon: Number(item.lon),
    type: item.addresstype ?? item.type,
  }));
}

// The single best geocoding hit for `query`, or null when nothing matches. Used
// by the routes tab to resolve each endpoint.
export async function geocodeOne(
  query: string,
  opts: { viewbox?: string } = {},
): Promise<Place | null> {
  const places = await geocode(query, { limit: 1, viewbox: opts.viewbox });
  return places[0] ?? null;
}

// A decoded route from whichever backend the `ROUTE_PROVIDER` flag selects. On
// OSRM, walk / bike / transit all fall back to the driving route the demo
// server can produce; on Valhalla each mode routes with its own costing model.
export async function fetchRoute(
  from: LatLon,
  to: LatLon,
  mode: Mode,
): Promise<Route> {
  return ROUTE_PROVIDER === "valhalla"
    ? fetchValhallaRoute(from, to, VALHALLA_COSTING[mode])
    : fetchOsrmRoute(from, to);
}

// A route from Valhalla (https://valhalla1.openstreetmap.de). The geometry comes
// back as an encoded polyline in each leg's `shape`, at precision 6 (polyline6),
// so decode accordingly and concatenate the legs.
async function fetchValhallaRoute(
  from: LatLon,
  to: LatLon,
  costing: string,
): Promise<Route> {
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
// pairs; `overview=full` returns the complete geometry and `geometries=polyline6`
// encodes it at precision 6, so decodePolyline(..., 6) still applies. The demo
// server only has the car profile, so this is the fallback for every mode.
async function fetchOsrmRoute(from: LatLon, to: LatLon): Promise<Route> {
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
export function decodePolyline(encoded: string, precision: number): LatLon[] {
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
export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return "";
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// Seconds as "5 h 12 m" / "12 m", or "" for an unknown duration.
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

// A short, human-friendly name: prefer the place's own `name` tag, falling back
// to the leading segment of `display_name`. Nominatim appends a parenthetical
// disambiguator in some locales (e.g. "Aachen (district)"), which people don't
// write, so drop it.
function shortPlaceName(item: NominatimItem): string {
  const raw =
    item.name?.trim() ||
    item.display_name.split(",")[0]?.trim() ||
    item.display_name;
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

// Reserve the next free 1s slot so concurrent queries don't exceed Nominatim's
// rate limit.
async function reserveNominatimSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextNominatimSlot);
  nextNominatimSlot = at + NOMINATIM_MIN_GAP_MS;
  const wait = at - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
