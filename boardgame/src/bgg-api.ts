import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { BoardGameDoc } from "./datatype";

export type BggEnrichment = {
  thumbnailUrl?: string;
  imageUrl?: string;
  description?: string;
  mechanics?: string[];
  categories?: string[];
  designers?: string[];
  artists?: string[];
  publishers?: string[];
};

const BGG_THING_URL = "https://boardgamegeek.com/xmlapi2/thing";
const BATCH_SIZE = 20;
const REQUEST_DELAY_MS = 5500;
const POLL_DELAY_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectLinks(item: Element, type: string): string[] {
  return [...item.querySelectorAll(`link[type="${type}"]`)]
    .map((link) => link.getAttribute("value"))
    .filter((value): value is string => Boolean(value));
}

function parseItemElement(item: Element): BggEnrichment {
  const description = item.querySelector("description")?.textContent?.trim();
  const decodedDescription = description
    ? new DOMParser().parseFromString(description, "text/html").documentElement
        .textContent ?? undefined
    : undefined;

  return {
    thumbnailUrl: item.querySelector("thumbnail")?.textContent?.trim(),
    imageUrl: item.querySelector("image")?.textContent?.trim(),
    description: decodedDescription,
    mechanics: collectLinks(item, "boardgamemechanic"),
    categories: collectLinks(item, "boardgamecategory"),
    designers: collectLinks(item, "boardgamedesigner"),
    artists: collectLinks(item, "boardgameartist"),
    publishers: collectLinks(item, "boardgamepublisher"),
  };
}

export function parseThingXml(xml: string): BggEnrichment {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const item = doc.querySelector("item");
  if (!item) {
    throw new Error("No game data found in BGG response.");
  }
  return parseItemElement(item);
}

export function parseThingsXml(xml: string): Map<number, BggEnrichment> {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const enrichments = new Map<number, BggEnrichment>();

  for (const item of doc.querySelectorAll("item")) {
    const bggId = Number(item.getAttribute("id"));
    if (!Number.isFinite(bggId)) continue;
    enrichments.set(bggId, parseItemElement(item));
  }

  return enrichments;
}

function parseBggError(xml: string): string | null {
  if (!xml.includes("<error")) return null;
  return (
    new DOMParser()
      .parseFromString(xml, "text/xml")
      .querySelector("error")
      ?.textContent?.trim() ?? "BGG returned an error."
  );
}

async function fetchThingsXml(bggIds: number[], token: string): Promise<string> {
  if (!token.trim()) {
    throw new Error(
      "BGG API token required. Add one in Settings (from boardgamegeek.com/applications).",
    );
  }

  const url = `${BGG_THING_URL}?id=${bggIds.join(",")}&stats=1`;
  const headers: HeadersInit = { Authorization: `Bearer ${token.trim()}` };

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetch(url, { headers });

    if (response.status === 202) {
      await sleep(POLL_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      throw new Error(`BGG request failed (${response.status}).`);
    }

    const xml = await response.text();
    const error = parseBggError(xml);
    if (error) {
      throw new Error(error);
    }

    return xml;
  }

  throw new Error("BGG request timed out while waiting for queued response.");
}

export async function enrichGameFromBgg(
  game: BoardGameDoc,
  token: string,
): Promise<BoardGameDoc> {
  const xml = await fetchThingsXml([game.bggId], token);
  const enrichment = parseThingXml(xml);

  return {
    ...game,
    ...enrichment,
    enrichedAt: new Date().toISOString(),
  };
}

export type EnrichProgress = {
  completed: number;
  total: number;
  currentName?: string;
};

export type EnrichTarget = {
  url: AutomergeUrl;
  doc: BoardGameDoc;
};

export async function enrichGamesFromBgg(
  targets: EnrichTarget[],
  token: string | undefined,
  onProgress: (progress: EnrichProgress) => void,
  onEnriched: (target: EnrichTarget, enrichment: BggEnrichment) => void,
): Promise<{ enriched: number; errors: string[] }> {
  if (!token?.trim()) {
    throw new Error(
      "BGG API token required. Open Settings and paste a token from boardgamegeek.com/applications.",
    );
  }

  const errors: string[] = [];
  let enriched = 0;
  let completed = 0;

  for (let batchStart = 0; batchStart < targets.length; batchStart += BATCH_SIZE) {
    const batch = targets.slice(batchStart, batchStart + BATCH_SIZE);
    const batchIds = batch.map((target) => target.doc.bggId);

    onProgress({
      completed,
      total: targets.length,
      currentName: batch[0]?.doc.name,
    });

    try {
      const xml = await fetchThingsXml(batchIds, token);
      const enrichments = parseThingsXml(xml);

      for (const target of batch) {
        const enrichment = enrichments.get(target.doc.bggId);
        if (!enrichment) {
          errors.push(`${target.doc.name}: not found in BGG response.`);
          completed++;
          continue;
        }

        onEnriched(target, enrichment);
        enriched++;
        completed++;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown BGG error.";
      for (const target of batch) {
        errors.push(`${target.doc.name}: ${message}`);
        completed++;
      }
    }

    if (batchStart + BATCH_SIZE < targets.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  onProgress({ completed: targets.length, total: targets.length });
  return { enriched, errors };
}

export function gamesNeedingEnrichment(games: BoardGameDoc[]): BoardGameDoc[] {
  return games.filter(
    (game) =>
      !game.enrichedAt ||
      !game.thumbnailUrl ||
      !game.mechanics?.length ||
      !game.categories?.length,
  );
}
