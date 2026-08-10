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
import "./index.css";
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

const filterSelectClass = "bg-select";

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
    <div className="bg-filters">
      <div className="bg-filters__row">
        <input
          value={filters.query}
          onChange={(event) => onFiltersChange({ query: event.target.value })}
          placeholder="Search name, designer, mechanic, category..."
          className="bg-search"
        />
        <span className="bg-count">
          {resultCount} of {totalCount}
        </span>
      </div>

      <div className="bg-filters__row">
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
            className="bg-button bg-button--quiet"
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
    <div className="boardgame-collection">
      <div className="bg-shell">
        <header className="bg-header">
          <div className="bg-header__row">
            <div className="bg-header__title">
              <input
                value={doc.title}
                onChange={(event) => updateTitle(event.target.value)}
                className="bg-title-input"
              />
              <p className="bg-stats">
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

            <div className="bg-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="bg-hidden"
                onChange={handleCsvImport}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="bg-button bg-button--primary"
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
                className="bg-button"
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
                className="bg-button"
              >
                BGG enrich
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((value) => !value)}
                className="bg-button"
              >
                Settings
              </button>
            </div>
          </div>

          {showSettings ? (
            <div className="bg-settings">
              <label className="bg-settings__label">
                BGG API token (optional)
              </label>
              <input
                type="password"
                value={doc.bggApiToken ?? ""}
                onChange={(event) => updateApiToken(event.target.value)}
                placeholder="Bearer token from boardgamegeek.com/applications"
                className="bg-settings__input"
              />
            </div>
          ) : null}

          {importMessage ? (
            <p className="bg-message bg-message--ok">{importMessage}</p>
          ) : null}
          {kaggleMessage ? (
            <p className="bg-message">{kaggleMessage}</p>
          ) : null}
          {enrichMessage ? (
            <p className="bg-message">{enrichMessage}</p>
          ) : null}
          {enrichProgress ? (
            <p className="bg-message">
              Enriching {enrichProgress.completed}/{enrichProgress.total}
              {enrichProgress.currentName
                ? ` · ${enrichProgress.currentName}`
                : ""}
            </p>
          ) : null}
        </header>

        {gameUrls.length === 0 ? (
          <div className="bg-empty">
            <div>
              <h2 className="bg-empty__title">
                No games yet
              </h2>
              <p className="bg-empty__hint">
                Import your BoardGameGeek collection CSV to get started.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-button bg-button--primary bg-button--lg"
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

            <div className="bg-body">
              <div className="bg-table-scroll">
              <table className="bg-table">
                <thead>
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
                <p className="bg-table-empty">
                  No games match these filters.
                </p>
              ) : null}
              </div>

              {selectedGame ? (
                <div className="bg-detail-pane">
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
