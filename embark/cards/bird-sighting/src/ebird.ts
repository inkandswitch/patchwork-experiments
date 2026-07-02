import type { BirdKind, BirdPeriod } from "./datatype";

// A map's visible geographic box, mirrored onto its document as `bounds` (lng/lat
// degrees). Declared locally rather than imported so this package carries no
// dependency on @embark/map — it only reads the shape off matched map docs.
export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

// eBird API 2.0. The token is bundled on purpose: this is a client-side card
// with no secret store, so anyone can read it from the built bundle — an
// accepted trade-off for a keyed but low-stakes, read-only public dataset.
const EBIRD_TOKEN = "fba10tt8jqke";
const EBIRD_BASE = "https://api.ebird.org/v2/data/obs/geo/recent";

// eBird's `dist` (search radius) tops out at 50 km and `back` (how far back to
// look) at 30 days, so "this month" is really "the last 30 days".
const MAX_DIST_KM = 50;
const BACK_DAYS: Record<BirdPeriod, number> = { today: 1, week: 7, month: 30 };
// Keep image lookups (and pins) bounded — the geo endpoint returns one row per
// species, which can still be well over a hundred in a rich area.
const MAX_SPECIES = 30;

// One recent observation, flattened from an eBird geo/recent row. The geo
// endpoints return only the single most-recent observation per species.
export type Sighting = {
  speciesCode: string;
  comName: string;
  sciName: string;
  lat: number;
  lon: number;
  locName?: string;
  obsDt?: string;
  howMany?: number;
};

type EbirdObs = {
  speciesCode: string;
  comName: string;
  sciName: string;
  lat: number;
  lng: number;
  locName?: string;
  obsDt?: string;
  howMany?: number;
};

// Ask eBird what's been seen recently within the map's view. The visible box is
// reduced to a centre + radius (eBird's geo query is a circle, not a box), and
// `kind`/`period` pick the endpoint and look-back window. Throws on a non-OK
// response so the caller can surface the failure.
export async function fetchSightings(
  bounds: MapBounds,
  kind: BirdKind,
  period: BirdPeriod,
): Promise<Sighting[]> {
  const { lat, lng, distKm } = boundsToCircle(bounds);
  const path = kind === "rare" ? `${EBIRD_BASE}/notable` : EBIRD_BASE;
  const url =
    `${path}?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}` +
    `&dist=${distKm}&back=${BACK_DAYS[period]}&maxResults=${MAX_SPECIES}`;
  const res = await fetch(url, {
    headers: { "X-eBirdApiToken": EBIRD_TOKEN, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`eBird responded ${res.status}`);
  const rows = (await res.json()) as EbirdObs[];
  return rows.map((row) => ({
    speciesCode: row.speciesCode,
    comName: row.comName,
    sciName: row.sciName,
    lat: row.lat,
    lon: row.lng,
    locName: row.locName,
    obsDt: row.obsDt,
    howMany: row.howMany,
  }));
}

// The authoritative eBird page for a species — used as the sighting's
// "learn more" link.
export function speciesUrl(speciesCode: string): string {
  return `https://ebird.org/species/${speciesCode}`;
}

// A representative photo for the species, from Wikipedia's keyless REST summary
// (CORS-enabled). Tries the scientific name first (least ambiguous), then the
// common name; returns undefined if neither has a thumbnail.
export async function lookupImage(
  sciName: string,
  comName: string,
): Promise<string | undefined> {
  for (const title of [sciName, comName]) {
    if (!title) continue;
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          title,
        )}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        thumbnail?: { source?: string };
      };
      if (json.thumbnail?.source) return json.thumbnail.source;
    } catch {
      // try the next title
    }
  }
  return undefined;
}

// Reduce the map's visible box to the circle eBird actually queries: the
// centre of the box and a radius reaching its corners (half the diagonal),
// clamped to eBird's 50 km ceiling. Zoomed out past that, results only cover
// 50 km around the centre.
function boundsToCircle(bounds: MapBounds): {
  lat: number;
  lng: number;
  distKm: number;
} {
  const lat = (bounds.north + bounds.south) / 2;
  const lng = (bounds.east + bounds.west) / 2;
  const radius = haversineKm(lat, lng, bounds.north, bounds.east);
  const distKm = Math.min(MAX_DIST_KM, Math.max(1, Math.round(radius)));
  return { lat, lng, distKm };
}

// Great-circle distance between two lng/lat points, in kilometres.
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
