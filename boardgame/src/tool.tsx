import {
  RepoContext,
  useDocHandle,
  useDocuments,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState } from "react";
import {
  enrichGamesFromBgg,
  gamesNeedingEnrichment,
  type EnrichProgress,
} from "./bgg-api";
import {
  GameDetail,
  GameListRow,
  SortableHeader,
  TagMultiPicker,
} from "./components";
import {
  activeFilterCount,
  collectFilterOptions,
  defaultFilters,
  defaultSort,
  filterGames,
  sortGames,
  toggleSort,
  type CollectionFilters,
  type FilterOptions,
  type SortState,
} from "./collection-filters";
import { assignAutomergeFields, setAutomergeString } from "./automerge-fields";
import { importBggCollectionCsv } from "./csv-importer";
import type { BoardGameDoc } from "./datatype";
import { boardgameUrls, type BoardgameFolderDoc } from "./folder";
import kaggleEnrichment from "./kaggle-enrichment.json";
import {
  applyKaggleEnrichment,
  importKaggleEnrichment,
  type KaggleImportResult,
} from "./kaggle-importer";

type LoadedGame = {
  url: AutomergeUrl;
  doc: BoardGameDoc;
};

const filterSelectClass =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700";

function FilterBar({
  filters,
  filterOptions,
  resultCount,
  totalCount,
  onFiltersChange,
  onClearFilters,
}: {
  filters: CollectionFilters;
  filterOptions: FilterOptions;
  resultCount: number;
  totalCount: number;
  onFiltersChange: (patch: Partial<CollectionFilters>) => void;
  onClearFilters: () => void;
}) {
  const activeCount = activeFilterCount(filters);

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.query}
          onChange={(event) => onFiltersChange({ query: event.target.value })}
          placeholder="Search name, designer, mechanic, category..."
          className="min-w-[200px] flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-amber-400"
        />
        <span className="text-xs text-slate-500">
          {resultCount} of {totalCount}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.itemType}
          onChange={(event) =>
            onFiltersChange({
              itemType: event.target.value as CollectionFilters["itemType"],
            })
          }
          className={filterSelectClass}
        >
          <option value="all">All types</option>
          <option value="standalone">Base games</option>
          <option value="expansion">Expansions</option>
        </select>

        <select
          value={filters.players}
          onChange={(event) =>
            onFiltersChange({
              players: event.target.value as CollectionFilters["players"],
            })
          }
          className={filterSelectClass}
        >
          <option value="all">Any players</option>
          <option value="1">Solo</option>
          <option value="2">2 players</option>
          <option value="3+">3+ players</option>
          <option value="4+">4+ players</option>
        </select>

        <select
          value={filters.maxTime}
          onChange={(event) =>
            onFiltersChange({
              maxTime: event.target.value as CollectionFilters["maxTime"],
            })
          }
          className={filterSelectClass}
        >
          <option value="all">Any length</option>
          <option value="30">≤ 30 min</option>
          <option value="60">≤ 60 min</option>
          <option value="120">≤ 120 min</option>
        </select>

        <select
          value={filters.weight}
          onChange={(event) =>
            onFiltersChange({
              weight: event.target.value as CollectionFilters["weight"],
            })
          }
          className={filterSelectClass}
        >
          <option value="all">Any weight</option>
          <option value="light">Light (&lt;2)</option>
          <option value="medium">Medium (2–3.5)</option>
          <option value="heavy">Heavy (&gt;3.5)</option>
        </select>

        <select
          value={filters.rated}
          onChange={(event) =>
            onFiltersChange({
              rated: event.target.value as CollectionFilters["rated"],
            })
          }
          className={filterSelectClass}
        >
          <option value="all">All ratings</option>
          <option value="rated">Rated by me</option>
          <option value="unrated">Unrated</option>
        </select>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <TagMultiPicker
        options={filterOptions.tags}
        selected={filters.tags}
        onChange={(tags) => onFiltersChange({ tags })}
      />
    </div>
  );
}

function CollectionBrowser({ docUrl }: { docUrl: AutomergeUrl }) {
  const handle = useDocHandle<BoardgameFolderDoc>(docUrl, { suspense: true });
  const repo = useRepo();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<CollectionFilters>(defaultFilters);
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [kaggleMessage, setKaggleMessage] = useState<string | null>(null);
  const [kaggleImporting, setKaggleImporting] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(
    null,
  );
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [importing, setImporting] = useState(false);

  const doc = handle.doc();
  const gameUrls = useMemo(
    () => (doc ? boardgameUrls(doc) : []),
    [doc],
  );
  const [gameDocsMap, changeGameDoc] = useDocuments<BoardGameDoc>(gameUrls, {
    suspense: false,
  });

  const loadedGames = useMemo<LoadedGame[]>(() => {
    return gameUrls.flatMap((url) => {
      const gameDoc = gameDocsMap.get(url);
      return gameDoc ? [{ url, doc: gameDoc }] : [];
    });
  }, [gameUrls, gameDocsMap]);

  const filteredGames = useMemo(() => {
    const docs = loadedGames.map((entry) => entry.doc);
    const filtered = filterGames(docs, filters);
    const sorted = sortGames(filtered, sort);
    const byUrl = new Map(loadedGames.map((entry) => [entry.doc.bggId, entry]));
    return sorted.flatMap((gameDoc) => {
      const entry = byUrl.get(gameDoc.bggId);
      return entry ? [entry] : [];
    });
  }, [loadedGames, filters, sort]);

  const selectedGame = selectedUrl
    ? (loadedGames.find((game) => game.url === selectedUrl) ?? null)
    : null;

  const filterOptions = useMemo(
    () => collectFilterOptions(loadedGames.map((entry) => entry.doc)),
    [loadedGames],
  );

  const stats = useMemo(() => {
    const games = loadedGames.map((entry) => entry.doc);
    const rated = games.filter((game) => (game.rating ?? 0) > 0);
    const avgRating =
      rated.length > 0
        ? rated.reduce((sum, game) => sum + (game.rating ?? 0), 0) / rated.length
        : null;
    const standalones = games.filter(
      (game) => game.itemType === "standalone",
    ).length;
    return { count: gameUrls.length, loaded: loadedGames.length, avgRating, standalones };
  }, [gameUrls.length, loadedGames]);

  if (!doc) return null;

  const updateTitle = (title: string) => {
    handle.change((draft) => {
      draft.title = title;
    });
  };

  const updateApiToken = (token: string) => {
    handle.change((draft) => {
      setAutomergeString(draft, "bggApiToken", token);
    });
  };

  const handleCsvImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const csvText = await file.text();
    setImporting(true);
    setImportMessage(null);

    try {
      const result = await importBggCollectionCsv(handle, csvText, repo);
      setImportMessage(
        `Imported ${result.imported} new games, updated ${result.updated}, skipped ${result.skipped}.`,
      );
    } catch (error) {
      setImportMessage(
        error instanceof Error ? error.message : "Import failed.",
      );
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleKaggleImport = async () => {
    if (!loadedGames.length) {
      setKaggleMessage("Import your collection CSV first.");
      return;
    }

    setKaggleImporting(true);
    setKaggleMessage(null);

    try {
      const result: KaggleImportResult = await importKaggleEnrichment(
        gameUrls,
        repo,
        kaggleEnrichment,
        (url, entry) => {
          changeGameDoc(url, (draft) => {
            applyKaggleEnrichment(draft, entry);
          });
        },
      );

      const thumbCount = kaggleEnrichment.stats?.withThumbnails;
      const parts = [`Enriched ${result.enriched} games from Kaggle snapshot.`];
      if (typeof thumbCount === "number" && thumbCount > 0) {
        parts.push(`${thumbCount} include Wikipedia cover art.`);
      }
      if (result.alreadyComplete) {
        parts.push(`${result.alreadyComplete} already had metadata.`);
      }
      if (result.missing) {
        parts.push(`${result.missing} not found in the June 2023 snapshot.`);
      }
      setKaggleMessage(parts.join(" "));
    } catch (error) {
      setKaggleMessage(
        error instanceof Error ? error.message : "Kaggle import failed.",
      );
    } finally {
      setKaggleImporting(false);
    }
  };

  const handleEnrich = async () => {
    const targets = loadedGames.filter(({ doc: game }) =>
      gamesNeedingEnrichment([game]).length > 0,
    );
    if (!targets.length) {
      setEnrichMessage("All games already have BGG metadata.");
      return;
    }

    if (!doc.bggApiToken?.trim()) {
      setShowSettings(true);
      setEnrichMessage(
        "Add a BGG API token in Settings first (boardgamegeek.com/applications).",
      );
      return;
    }

    setEnrichMessage(null);
    setEnrichProgress({ completed: 0, total: targets.length });

    try {
      const { enriched, errors } = await enrichGamesFromBgg(
        targets,
        doc.bggApiToken,
        setEnrichProgress,
        (target, enrichment) => {
          changeGameDoc(target.url, (draft) => {
            assignAutomergeFields(draft, enrichment);
            draft.enrichedAt = new Date().toISOString();
          });
        },
      );

      if (errors.length) {
        setEnrichMessage(
          `Enriched ${enriched} games. ${errors.length} failed — check your API token or try again later.`,
        );
      } else {
        setEnrichMessage(`Enriched ${enriched} games from BGG.`);
      }
    } catch (error) {
      setEnrichMessage(
        error instanceof Error ? error.message : "Enrichment failed.",
      );
    } finally {
      setEnrichProgress(null);
    }
  };

  const loadingGames = gameUrls.length > loadedGames.length;

  return (
    <div className="boardgame-collection flex h-full flex-col overflow-hidden bg-slate-50">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 p-3">
        <header className="shrink-0 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <input
                value={doc.title}
                onChange={(event) => updateTitle(event.target.value)}
                className="w-full border-none bg-transparent text-xl font-semibold text-slate-900 outline-none"
              />
              <p className="mt-0.5 text-xs text-slate-600">
                {stats.count} games
                {loadingGames
                  ? ` · loading ${stats.loaded}/${stats.count}`
                  : ""}
                {stats.standalones ? ` · ${stats.standalones} base` : ""}
                {stats.avgRating != null
                  ? ` · avg ${stats.avgRating.toFixed(1)}`
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvImport}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {importing ? "Importing..." : "Import CSV"}
              </button>
              <button
                type="button"
                onClick={handleKaggleImport}
                disabled={
                  kaggleImporting ||
                  enrichProgress != null ||
                  loadedGames.length === 0 ||
                  importing
                }
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {kaggleImporting ? "Importing..." : "Kaggle metadata"}
              </button>
              <button
                type="button"
                onClick={handleEnrich}
                disabled={
                  enrichProgress != null ||
                  loadedGames.length === 0 ||
                  importing ||
                  kaggleImporting
                }
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                BGG enrich
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((value) => !value)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Settings
              </button>
            </div>
          </div>

          {showSettings ? (
            <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 p-2.5">
              <label className="block text-xs font-medium text-slate-700">
                BGG API token (optional)
              </label>
              <input
                type="password"
                value={doc.bggApiToken ?? ""}
                onChange={(event) => updateApiToken(event.target.value)}
                placeholder="Bearer token from boardgamegeek.com/applications"
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
              />
            </div>
          ) : null}

          {importMessage ? (
            <p className="mt-2 text-xs text-emerald-700">{importMessage}</p>
          ) : null}
          {kaggleMessage ? (
            <p className="mt-2 text-xs text-slate-600">{kaggleMessage}</p>
          ) : null}
          {enrichMessage ? (
            <p className="mt-2 text-xs text-slate-600">{enrichMessage}</p>
          ) : null}
          {enrichProgress ? (
            <p className="mt-2 text-xs text-slate-600">
              Enriching {enrichProgress.completed}/{enrichProgress.total}
              {enrichProgress.currentName
                ? ` · ${enrichProgress.currentName}`
                : ""}
            </p>
          ) : null}
        </header>

        {gameUrls.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                No games yet
              </h2>
              <p className="mt-2 max-w-md text-sm text-slate-600">
                Import your BoardGameGeek collection CSV to get started.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Import BGG CSV
              </button>
            </div>
          </div>
        ) : (
          <>
            <FilterBar
              filters={filters}
              filterOptions={filterOptions}
              resultCount={filteredGames.length}
              totalCount={loadedGames.length}
              onFiltersChange={(patch) =>
                setFilters((current) => ({ ...current, ...patch }))
              }
              onClearFilters={() => setFilters(defaultFilters)}
            />

            <div className="flex min-h-0 flex-1 gap-3">
              <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[960px] border-collapse text-left">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs">
                  <tr>
                    <SortableHeader
                      label="Name"
                      sortKey="name"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Year"
                      sortKey="yearPublished"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Players"
                      sortKey="minPlayers"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Time"
                      sortKey="playingTime"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Weight"
                      sortKey="bggWeight"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Category"
                      sortKey="category"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Mechanic"
                      sortKey="mechanic"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Designer"
                      sortKey="designer"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Mine"
                      sortKey="rating"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Rank"
                      sortKey="bggRank"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                    <SortableHeader
                      label="Type"
                      sortKey="itemType"
                      activeKey={sort.key}
                      direction={sort.direction}
                      onSort={(key) => setSort((current) => toggleSort(current, key))}
                    />
                  </tr>
                </thead>
                <tbody>
                  {filteredGames.map(({ url, doc: game }) => (
                    <GameListRow
                      key={url}
                      game={game}
                      selected={selectedUrl === url}
                      onSelect={() =>
                        setSelectedUrl((current) =>
                          current === url ? null : url,
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
              {filteredGames.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">
                  No games match these filters.
                </p>
              ) : null}
              </div>

              {selectedGame ? (
                <div className="flex w-[min(380px,38%)] min-h-0 shrink-0 flex-col">
                  <GameDetail
                    game={selectedGame.doc}
                    compact
                    onClose={() => setSelectedUrl(null)}
                    onUpdateComment={(comment) =>
                      changeGameDoc(selectedGame.url, (draft) => {
                        setAutomergeString(draft, "comment", comment);
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const BoardgameCollectionTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <CollectionBrowser docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
