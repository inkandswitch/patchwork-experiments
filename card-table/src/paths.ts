import type { AutomergeUrl } from "@automerge/automerge-repo";
import { DEFAULT_DECK_ID } from "./ops/deck";

/** Root document URL for a (possibly) path-addressed automerge URL. */
export function rootDocUrl(url: AutomergeUrl): AutomergeUrl {
  return url.split("/")[0] as AutomergeUrl;
}

export function subDeckUrl(
  tableUrl: AutomergeUrl,
  deckId: string = DEFAULT_DECK_ID,
): AutomergeUrl {
  return `${tableUrl}/decks/${JSON.stringify({ id: deckId })}` as AutomergeUrl;
}

export function subHandUrl(
  tableUrl: AutomergeUrl,
  handId: string,
): AutomergeUrl {
  return `${tableUrl}/hands/${JSON.stringify({ id: handId })}` as AutomergeUrl;
}

export function subPileUrl(
  tableUrl: AutomergeUrl,
  pileId: string,
): AutomergeUrl {
  return `${tableUrl}/piles/${JSON.stringify({ id: pileId })}` as AutomergeUrl;
}

export function isSubDeckUrl(url: AutomergeUrl): boolean {
  return url.includes("/decks/");
}

export function isSubHandUrl(url: AutomergeUrl): boolean {
  return url.includes("/hands/");
}

/** Parse hand id from a path-addressed hand sub-doc URL. */
export function handIdFromSubUrl(url: AutomergeUrl): string | null {
  const marker = "/hands/";
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

export function isSubPileUrl(url: AutomergeUrl): boolean {
  return url.includes("/piles/");
}

export function isRootTableUrl(url: AutomergeUrl): boolean {
  return !isSubDeckUrl(url) && !isSubHandUrl(url) && !isSubPileUrl(url);
}

export function zoneKind(url: AutomergeUrl): "table" | "deck" | "hand" | "pile" {
  if (isSubDeckUrl(url)) return "deck";
  if (isSubHandUrl(url)) return "hand";
  if (isSubPileUrl(url)) return "pile";
  return "table";
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
