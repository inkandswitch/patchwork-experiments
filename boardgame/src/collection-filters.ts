import type { BoardGameDoc } from "./datatype";

export type ItemTypeFilter = "all" | "standalone" | "expansion";
export type PlayersFilter = "all" | "1" | "2" | "3+" | "4+";
export type TimeFilter = "all" | "30" | "60" | "120";
export type WeightFilter = "all" | "light" | "medium" | "heavy";
export type RatedFilter = "all" | "rated" | "unrated";

export type SortKey =
  | "name"
  | "rating"
  | "bggRating"
  | "bggWeight"
  | "yearPublished"
  | "numPlays"
  | "bggRank"
  | "playingTime"
  | "minPlayers"
  | "itemType"
  | "category"
  | "mechanic"
  | "designer";

export type SortDirection = "asc" | "desc";

export type SortState = {
  key: SortKey;
  direction: SortDirection;
};

export const defaultSort: SortState = {
  key: "bggRank",
  direction: "desc",
};

export function defaultDirectionForKey(key: SortKey): SortDirection {
  if (
    key === "name" ||
    key === "itemType" ||
    key === "minPlayers" ||
    key === "category" ||
    key === "mechanic" ||
    key === "designer"
  ) {
    return "asc";
  }
  if (key === "bggRank") {
    return "desc";
  }
  return "desc";
}

export function toggleSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return { key, direction: defaultDirectionForKey(key) };
}

export type TagGroup = "category" | "mechanic" | "designer";

export type TagOption = {
  label: string;
  group: TagGroup;
};

export type CollectionFilters = {
  query: string;
  itemType: ItemTypeFilter;
  players: PlayersFilter;
  maxTime: TimeFilter;
  weight: WeightFilter;
  rated: RatedFilter;
  tags: string[];
};

export const defaultFilters: CollectionFilters = {
  query: "",
  itemType: "all",
  players: "all",
  maxTime: "all",
  weight: "all",
  rated: "all",
  tags: [],
};

export type FilterOptions = {
  tags: TagOption[];
};

export function collectFilterOptions(games: BoardGameDoc[]): FilterOptions {
  const categories = new Set<string>();
  const mechanics = new Set<string>();
  const designers = new Set<string>();

  for (const game of games) {
    for (const value of game.categories ?? []) categories.add(value);
    for (const value of game.mechanics ?? []) mechanics.add(value);
    for (const value of game.designers ?? []) designers.add(value);
  }

  const sortValues = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  const tags: TagOption[] = [
    ...sortValues(categories).map((label) => ({ label, group: "category" as const })),
    ...sortValues(mechanics).map((label) => ({ label, group: "mechanic" as const })),
    ...sortValues(designers).map((label) => ({ label, group: "designer" as const })),
  ];

  return { tags };
}

function gameHaystack(game: BoardGameDoc): string {
  return [
    game.name,
    game.originalName,
    game.comment,
    game.privateComment,
    game.itemType,
    game.description,
    ...(game.mechanics ?? []),
    ...(game.categories ?? []),
    ...(game.designers ?? []),
    ...(game.artists ?? []),
    ...(game.publishers ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function gameTagValues(game: BoardGameDoc): string[] {
  return [
    ...(game.categories ?? []),
    ...(game.mechanics ?? []),
    ...(game.designers ?? []),
  ];
}

function matchesSelectedTags(game: BoardGameDoc, selected: string[]): boolean {
  if (!selected.length) return true;
  const values = new Set(gameTagValues(game));
  return selected.every((tag) => values.has(tag));
}

function matchesPlayers(game: BoardGameDoc, filter: PlayersFilter): boolean {
  if (filter === "all") return true;
  const min = game.minPlayers ?? 0;
  const max = game.maxPlayers ?? 99;
  const target = filter === "3+" ? 3 : filter === "4+" ? 4 : Number(filter);
  return min <= target && max >= target;
}

function matchesMaxTime(game: BoardGameDoc, filter: TimeFilter): boolean {
  if (filter === "all") return true;
  const limit = Number(filter);
  const time = game.playingTime ?? game.maxPlayTime ?? game.minPlayTime;
  return time != null && time > 0 && time <= limit;
}

function matchesWeight(game: BoardGameDoc, filter: WeightFilter): boolean {
  if (filter === "all") return true;
  const weight = game.bggWeight;
  if (weight == null || weight <= 0) return false;
  if (filter === "light") return weight < 2;
  if (filter === "medium") return weight >= 2 && weight <= 3.5;
  return weight > 3.5;
}

export function filterGames(
  games: BoardGameDoc[],
  filters: CollectionFilters,
): BoardGameDoc[] {
  const query = filters.query.trim().toLowerCase();

  return games.filter((game) => {
    if (query && !gameHaystack(game).includes(query)) return false;
    if (
      filters.itemType !== "all" &&
      game.itemType?.toLowerCase() !== filters.itemType
    ) {
      return false;
    }
    if (!matchesPlayers(game, filters.players)) return false;
    if (!matchesMaxTime(game, filters.maxTime)) return false;
    if (!matchesWeight(game, filters.weight)) return false;
    if (filters.rated === "rated" && !(game.rating != null && game.rating > 0)) {
      return false;
    }
    if (filters.rated === "unrated" && game.rating != null && game.rating > 0) {
      return false;
    }
    if (!matchesSelectedTags(game, filters.tags)) return false;
    return true;
  });
}

function compareSortValues(
  left: BoardGameDoc,
  right: BoardGameDoc,
  sortKey: SortKey,
  direction: SortDirection,
): number {
  if (sortKey === "name") {
    const cmp = left.name.localeCompare(right.name);
    return direction === "asc" ? cmp : -cmp;
  }

  if (sortKey === "itemType") {
    const cmp = (left.itemType ?? "").localeCompare(right.itemType ?? "");
    return direction === "asc" ? cmp : -cmp;
  }

  if (sortKey === "category") {
    const cmp = (left.categories?.[0] ?? "").localeCompare(right.categories?.[0] ?? "");
    return direction === "asc" ? cmp : -cmp;
  }

  if (sortKey === "mechanic") {
    const cmp = (left.mechanics?.[0] ?? "").localeCompare(right.mechanics?.[0] ?? "");
    return direction === "asc" ? cmp : -cmp;
  }

  if (sortKey === "designer") {
    const cmp = (left.designers?.[0] ?? "").localeCompare(right.designers?.[0] ?? "");
    return direction === "asc" ? cmp : -cmp;
  }

  if (sortKey === "bggRank") {
    const leftRank = left.bggRank != null && left.bggRank > 0 ? left.bggRank : Infinity;
    const rightRank =
      right.bggRank != null && right.bggRank > 0 ? right.bggRank : Infinity;
    const cmp = leftRank - rightRank;
    return direction === "desc" ? cmp : -cmp;
  }

  const leftValue = left[sortKey] ?? -1;
  const rightValue = right[sortKey] ?? -1;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    const cmp = leftValue - rightValue;
    return direction === "asc" ? cmp : -cmp;
  }

  return 0;
}

export function sortGames(
  games: BoardGameDoc[],
  sort: SortState,
): BoardGameDoc[] {
  return [...games].sort((left, right) =>
    compareSortValues(left, right, sort.key, sort.direction),
  );
}

export function activeFilterCount(filters: CollectionFilters): number {
  let count = 0;
  if (filters.query.trim()) count++;
  if (filters.itemType !== "all") count++;
  if (filters.players !== "all") count++;
  if (filters.maxTime !== "all") count++;
  if (filters.weight !== "all") count++;
  if (filters.rated !== "all") count++;
  if (filters.tags.length) count++;
  return count;
}
