import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { Repo } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "./automerge-fields";
import type { BoardGameDoc } from "./datatype";

export type KaggleEnrichmentEntry = {
  mechanics?: string[];
  categories?: string[];
  designers?: string[];
  artists?: string[];
  publishers?: string[];
  thumbnailUrl?: string;
  imageUrl?: string;
  source?: string;
};

export type KaggleEnrichmentFile = {
  dataset: string;
  datasetUpdatedAt?: string;
  builtAt?: string;
  notes?: string;
  stats?: {
    collectionGames?: number;
    enriched?: number;
    fromBgg?: number;
    fromWikidata?: number;
    missing?: number;
  };
  games: Record<string, KaggleEnrichmentEntry>;
};

export type KaggleImportResult = {
  enriched: number;
  skipped: number;
  missing: number;
  alreadyComplete: number;
};

function hasEnrichmentData(game: BoardGameDoc): boolean {
  return Boolean(
    game.mechanics?.length ||
      game.categories?.length ||
      game.designers?.length ||
      game.artists?.length ||
      game.publishers?.length,
  );
}

function needsEnrichment(game: BoardGameDoc): boolean {
  return !game.mechanics?.length || !game.categories?.length;
}

export function parseKaggleEnrichmentFile(raw: string): KaggleEnrichmentFile {
  const parsed = JSON.parse(raw) as KaggleEnrichmentFile;
  if (!parsed?.games || typeof parsed.games !== "object") {
    throw new Error("Invalid Kaggle enrichment file: missing games map.");
  }
  return parsed;
}

export async function importKaggleEnrichment(
  gameUrls: AutomergeUrl[],
  repo: Repo,
  data: KaggleEnrichmentFile,
  onApply: (
    url: AutomergeUrl,
    enrichment: KaggleEnrichmentEntry,
  ) => void,
): Promise<KaggleImportResult> {
  let enriched = 0;
  let skipped = 0;
  let missing = 0;
  let alreadyComplete = 0;

  await Promise.all(
    gameUrls.map(async (url) => {
      try {
        const handle = await repo.find<BoardGameDoc>(url);
        const game = handle.doc();
        if (!game?.bggId) {
          skipped++;
          return;
        }

        if (!needsEnrichment(game) && hasEnrichmentData(game)) {
          alreadyComplete++;
          return;
        }

        const entry = data.games[String(game.bggId)];
        if (!entry) {
          missing++;
          return;
        }

        onApply(url, entry);
        enriched++;
      } catch {
        skipped++;
      }
    }),
  );

  return { enriched, skipped, missing, alreadyComplete };
}

export function applyKaggleEnrichment(
  doc: BoardGameDoc,
  entry: KaggleEnrichmentEntry,
): void {
  assignAutomergeFields(doc, {
    mechanics: entry.mechanics,
    categories: entry.categories,
    designers: entry.designers,
    artists: entry.artists,
    publishers: entry.publishers,
    thumbnailUrl: entry.thumbnailUrl,
    imageUrl: entry.imageUrl ?? entry.thumbnailUrl,
  });
  doc.enrichedAt = new Date().toISOString();
}
