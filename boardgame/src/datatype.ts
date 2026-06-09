import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type BoardGameDoc = {
  "@patchwork"?: { type: "boardgame" };
  bggId: number;
  name: string;
  originalName?: string;

  rating?: number;
  numPlays?: number;
  comment?: string;
  privateComment?: string;
  wishlistPriority?: number;

  minPlayers?: number;
  maxPlayers?: number;
  playingTime?: number;
  minPlayTime?: number;
  maxPlayTime?: number;
  yearPublished?: number;
  bggRating?: number;
  bggWeight?: number;
  bggRank?: number;
  numOwned?: number;
  recommendedPlayers?: string;
  bestPlayers?: string;
  recommendedAge?: string;
  languageDependence?: string;
  itemType?: string;

  imageUrl?: string;
  thumbnailUrl?: string;
  description?: string;
  mechanics?: string[];
  categories?: string[];
  designers?: string[];
  artists?: string[];
  publishers?: string[];
  enrichedAt?: string;

  quantity?: number;
  invLocation?: string;
  pricePaid?: number;
  acquiredFrom?: string;
  acquisitionDate?: string;
};

export const BoardgameDatatype: DatatypeImplementation<BoardGameDoc> = {
  init(doc: BoardGameDoc, _repo: Repo) {
    doc["@patchwork"] = { type: "boardgame" };
    doc.bggId = 0;
    doc.name = "Untitled Game";
  },

  getTitle(doc: BoardGameDoc) {
    return doc.name || "Board Game";
  },

  setTitle(doc: BoardGameDoc, title: string) {
    doc.name = title;
  },
};

export const bggGameUrl = (bggId: number) =>
  `https://boardgamegeek.com/boardgame/${bggId}`;

export const formatPlayerCount = (game: BoardGameDoc): string => {
  const { minPlayers, maxPlayers } = game;
  if (minPlayers == null && maxPlayers == null) return "—";
  if (minPlayers != null && maxPlayers != null && minPlayers === maxPlayers) {
    return `${minPlayers}`;
  }
  if (minPlayers != null && maxPlayers != null) {
    return `${minPlayers}–${maxPlayers}`;
  }
  return `${minPlayers ?? maxPlayers}`;
};

export const formatPlayTime = (game: BoardGameDoc): string => {
  const time = game.playingTime ?? game.maxPlayTime ?? game.minPlayTime;
  if (time == null || time <= 0) return "—";
  return `${time} min`;
};

export const formatRating = (value?: number): string => {
  if (value == null || value <= 0) return "—";
  return value.toFixed(1);
};

export const formatBggRank = (value?: number): string => {
  if (value == null || value <= 0) return "—";
  return `#${value}`;
};

export const placeholderColor = (bggId: number): string => {
  const hue = (bggId * 47) % 360;
  return `hsl(${hue} 35% 32%)`;
};

export const gameTags = (game: BoardGameDoc): string[] => {
  const tags: string[] = [];
  if (game.itemType) tags.push(game.itemType);
  if (game.categories?.length) tags.push(...game.categories.slice(0, 3));
  if (game.mechanics?.length) tags.push(...game.mechanics.slice(0, 2));
  if (game.recommendedAge) tags.push(game.recommendedAge);
  if (game.bestPlayers) tags.push(`Best: ${game.bestPlayers}`);
  if (game.languageDependence && !game.mechanics?.length) {
    const short = game.languageDependence.replace(
      /No necessary in-game text/i,
      "No text needed",
    );
    if (short.length <= 28) tags.push(short);
  }
  return tags;
};
