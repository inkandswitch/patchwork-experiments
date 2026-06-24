import type { AutomergeUrl } from "@automerge/automerge-repo";
import { DEFAULT_DECK_ID } from "./ops/deck";

/** Root document URL for a (possibly) path-addressed automerge URL. */
export function rootDocUrl(url: AutomergeUrl): AutomergeUrl {
  return url.split("/")[0] as AutomergeUrl;
}

export function subZoneUrl(
  tableUrl: AutomergeUrl,
  zoneId: string,
): AutomergeUrl {
  return `${tableUrl}/zones/${JSON.stringify({ id: zoneId })}` as AutomergeUrl;
}

export function subDeckUrl(
  tableUrl: AutomergeUrl,
  deckId: string = DEFAULT_DECK_ID,
): AutomergeUrl {
  return subZoneUrl(tableUrl, deckId);
}

export function isSubZoneUrl(url: AutomergeUrl): boolean {
  return url.includes("/zones/");
}

/** Parse the zone id from a path-addressed zone sub-doc URL. */
export function zoneIdFromSubUrl(url: AutomergeUrl): string | null {
  const marker = "/zones/";
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const encoded = url.slice(index + marker.length).split("?")[0];
  try {
    const parsed = JSON.parse(encoded) as { id?: string };
    return parsed.id ?? null;
  } catch {
    return null;
  }
}

export function isRootTableUrl(url: AutomergeUrl): boolean {
  return !isSubZoneUrl(url);
}

/** Strip `?tool=` query params before resolving automerge URLs. */
export function automergeUrlFromDrag(raw: string): AutomergeUrl {
  const idx = raw.indexOf("?tool=");
  if (idx === -1) return raw as AutomergeUrl;
  return raw.slice(0, idx) as AutomergeUrl;
}

export function toolIdFromDrag(raw: string): string | undefined {
  const idx = raw.indexOf("?tool=");
  if (idx === -1) return undefined;
  return decodeURIComponent(raw.slice(idx + 6));
}
