import type { AutomergeUrl } from "@automerge/automerge-repo";

export type DocLink = {
  name: string;
  type: string;
  url: AutomergeUrl;
};

/** Standard folder doc, with optional BGG import settings stored on the folder. */
export type BoardgameFolderDoc = {
  "@patchwork"?: { type: string };
  title: string;
  docs: DocLink[];
  bggApiToken?: string;
  bggUsername?: string;
  lastImportedAt?: string;
};

/** Legacy index doc shape (pre-folder refactor). */
export type LegacyCollectionDoc = {
  games?: { url: AutomergeUrl }[];
  bggApiToken?: string;
  bggUsername?: string;
  lastImportedAt?: string;
};

export function boardgameLinks(
  doc: BoardgameFolderDoc & LegacyCollectionDoc,
): DocLink[] {
  const folderLinks = (doc.docs ?? []).filter((link) => link.type === "boardgame");
  if (folderLinks.length) return folderLinks;

  return (doc.games ?? []).map((entry, index) => ({
    name: `Game ${index + 1}`,
    type: "boardgame",
    url: entry.url,
  }));
}

export function boardgameUrls(
  doc: BoardgameFolderDoc & LegacyCollectionDoc,
): AutomergeUrl[] {
  return boardgameLinks(doc).map((link) => link.url);
}
