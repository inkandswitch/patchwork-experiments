import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { assignAutomergeFields } from "./automerge-fields";
import type { BoardGameDoc } from "./datatype";
import {
  boardgameUrls,
  type BoardgameFolderDoc,
} from "./folder";

const BGG_COLLECTION_HEADERS = [
  "objectname",
  "objectid",
  "rating",
  "numplays",
  "weight",
  "own",
  "fortrade",
  "want",
  "wanttobuy",
  "wanttoplay",
  "prevowned",
  "preordered",
  "wishlist",
  "wishlistpriority",
  "wishlistcomment",
  "comment",
  "conditiontext",
  "haspartslist",
  "wantpartslist",
  "collid",
  "baverage",
  "average",
  "avgweight",
  "rank",
  "numowned",
  "objecttype",
  "originalname",
  "minplayers",
  "maxplayers",
  "playingtime",
  "maxplaytime",
  "minplaytime",
  "yearpublished",
  "bggrecplayers",
  "bggbestplayers",
  "bggrecagerange",
  "bgglanguagedependence",
  "publisherid",
  "imageid",
  "year",
  "language",
  "other",
  "itemtype",
  "barcode",
  "pricepaid",
  "pp_currency",
  "currvalue",
  "cv_currency",
  "acquisitiondate",
  "acquiredfrom",
  "quantity",
  "privatecomment",
  "invlocation",
  "invdate",
  "version_publishers",
  "version_languages",
  "version_yearpublished",
  "version_nickname",
] as const;

export type CsvImportResult = {
  imported: number;
  updated: number;
  skipped: number;
};

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csvText[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowToRecord(headers: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index]?.trim() ?? "";
  });
  return record;
}

export function recordToGame(record: Record<string, string>): BoardGameDoc | null {
  const bggId = parseNumber(record.objectid);
  const name = record.objectname?.trim();
  if (!bggId || !name) return null;

  const game: BoardGameDoc = { bggId, name, quantity: parseNumber(record.quantity) ?? 1 };

  const fields: Partial<BoardGameDoc> = {
    originalName: record.originalname,
    rating: parseNumber(record.rating),
    numPlays: parseNumber(record.numplays),
    comment: record.comment,
    privateComment: record.privatecomment,
    wishlistPriority: parseNumber(record.wishlistpriority),
    minPlayers: parseNumber(record.minplayers),
    maxPlayers: parseNumber(record.maxplayers),
    playingTime: parseNumber(record.playingtime),
    minPlayTime: parseNumber(record.minplaytime),
    maxPlayTime: parseNumber(record.maxplaytime),
    yearPublished: parseNumber(record.yearpublished),
    bggRating: parseNumber(record.average),
    bggWeight: parseNumber(record.avgweight),
    bggRank: parseNumber(record.rank),
    numOwned: parseNumber(record.numowned),
    recommendedPlayers: record.bggrecplayers,
    bestPlayers: record.bggbestplayers,
    recommendedAge: record.bggrecagerange,
    languageDependence: record.bgglanguagedependence,
    itemType: record.itemtype,
    invLocation: record.invlocation,
    pricePaid: parseNumber(record.pricepaid),
    acquiredFrom: record.acquiredfrom,
    acquisitionDate: record.acquisitiondate,
  };

  assignAutomergeFields(game, fields);
  return game;
}

export function mergeGameData(
  existing: BoardGameDoc,
  incoming: BoardGameDoc,
): void {
  assignAutomergeFields(existing, incoming, {
    skip: ["bggId", "name", "@patchwork"],
  });

  if (incoming.imageUrl) existing.imageUrl = incoming.imageUrl;
  if (incoming.thumbnailUrl) existing.thumbnailUrl = incoming.thumbnailUrl;
  if (incoming.description) existing.description = incoming.description;
  if (incoming.mechanics?.length) existing.mechanics = incoming.mechanics;
  if (incoming.categories?.length) existing.categories = incoming.categories;
  if (incoming.designers?.length) existing.designers = incoming.designers;
  if (incoming.artists?.length) existing.artists = incoming.artists;
  if (incoming.publishers?.length) existing.publishers = incoming.publishers;
  if (incoming.enrichedAt) existing.enrichedAt = incoming.enrichedAt;
}

async function loadExistingByBggId(
  folder: BoardgameFolderDoc,
  repo: Repo,
): Promise<Map<number, AutomergeUrl>> {
  const byBggId = new Map<number, AutomergeUrl>();

  await Promise.all(
    boardgameUrls(folder).map(async (url) => {
      try {
        const handle = await repo.find<BoardGameDoc>(url);
        const game = handle.doc();
        if (game?.bggId) {
          byBggId.set(game.bggId, url);
        }
      } catch {
        // Skip unavailable documents during import.
      }
    }),
  );

  return byBggId;
}

export async function importBggCollectionCsv(
  collectionHandle: DocHandle<BoardgameFolderDoc>,
  csvText: string,
  repo: Repo,
): Promise<CsvImportResult> {
  const rows = parseCsvRows(csvText.trim());
  if (rows.length < 2) {
    return { imported: 0, updated: 0, skipped: 0 };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const isBggExport = BGG_COLLECTION_HEADERS.every((header) =>
    headers.includes(header),
  );

  if (!isBggExport) {
    throw new Error(
      "This does not look like a BoardGameGeek collection CSV export.",
    );
  }

  const collection = collectionHandle.doc();
  if (!collection) {
    throw new Error("Collection document is not ready.");
  }

  const existingByBggId = await loadExistingByBggId(collection, repo);
  const newEntries: { url: AutomergeUrl; name: string }[] = [];

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const values of rows.slice(1)) {
    const record = rowToRecord(headers, values);
    const incoming = recordToGame(record);
    if (!incoming) {
      skipped++;
      continue;
    }

    const existingUrl = existingByBggId.get(incoming.bggId);
    if (existingUrl) {
      const handle = await repo.find<BoardGameDoc>(existingUrl);
      handle.change((doc) => {
        mergeGameData(doc, incoming);
      });
      updated++;
      continue;
    }

    const handle = repo.create<BoardGameDoc>();
    handle.change((doc) => {
      doc["@patchwork"] = { type: "boardgame" };
      doc.bggId = incoming.bggId;
      doc.name = incoming.name;
      mergeGameData(doc, incoming);
    });

    existingByBggId.set(incoming.bggId, handle.url);
    newEntries.push({ url: handle.url, name: incoming.name });
    imported++;
  }

  if (newEntries.length > 0 || updated > 0) {
    collectionHandle.change((doc) => {
      if (!doc.docs) doc.docs = [];
      for (const entry of newEntries) {
        doc.docs.push({
          name: entry.name,
          type: "boardgame",
          url: entry.url,
        });
      }
      doc.lastImportedAt = new Date().toISOString();
    });
  }

  return { imported, updated, skipped };
}
