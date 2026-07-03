import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type Repo,
} from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  belongsToDoc,
  contributedSlice,
  splitDocUrl,
  type ContextStore,
  type ContextVisualizer,
  type ScopeOwner,
} from "@embark/context";
import {
  Chips,
  EmbedToken,
  useDocTitles,
  useHighlight,
} from "@embark/selection/tokens";
import { SearchQueries, SearchResults } from "./channels";
import "./visualizer.css";

// Visualizer for the search channels: `search:queries` as quoted chips, and
// `search:results` as a `search -> results` table grouped by the card that
// produced each result.
export const searchVisualizer: ContextVisualizer = (element, props) => {
  return render(() => {
    if (props.channel === SearchResults.name) {
      return (
        <div class="embark-tokens-panel">
          <ResultsTable
            store={props.store}
            repo={props.repo}
            focusDocUrl={
              props.mode === "contributes"
                ? (props.focusDocUrl as AutomergeUrl)
                : undefined
            }
          />
        </div>
      );
    }
    return (
      <div class="embark-tokens-panel">
        <QueryChips
          store={props.store}
          mode={props.mode}
          focusDocUrl={props.focusDocUrl as AutomergeUrl}
        />
      </div>
    );
  }, element);
};

function QueryChips(props: {
  store: ContextStore;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribe(SearchQueries, () => setTick((t) => t + 1)));
  const labels = createMemo(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, SearchQueries, props.focusDocUrl)
        : props.store.read(SearchQueries);
    return Object.keys(value).map((key) => JSON.stringify(key));
  });
  return <Chips labels={labels()} />;
}

// The `search:results` channel as a table. Results are grouped by the card that
// produced them (each contributing scope carries its owner). Every active query
// gets a row — including queries no card answered — by unioning the live
// SearchQueries keys with the queries present in the result scopes.
type Group = { owner?: ScopeOwner; urls: AutomergeUrl[] };
type Row = { query: string; groups: Group[] };

function ResultsTable(props: {
  store: ContextStore;
  repo: Repo;
  // When set (the "contributes" view), keep only groups from this document, so
  // the table shows just what the focused card produced.
  focusDocUrl?: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((t) => t + 1);
  onCleanup(props.store.subscribe(SearchResults, bump));
  onCleanup(props.store.subscribe(SearchQueries, bump));

  const titles = useDocTitles(props.repo);
  const highlight = useHighlight(props.store);

  const rows = createMemo<Row[]>(() => {
    tick();
    const queries = new Set<string>(
      Object.keys(props.store.read(SearchQueries)),
    );
    const byQuery = new Map<string, Group[]>();
    for (const scope of props.store.scopes(SearchResults)) {
      const owner = scope.owner;
      const doc = owner?.docUrl as AutomergeUrl | undefined;
      if (props.focusDocUrl && (!doc || !belongsToDoc(doc, props.focusDocUrl))) {
        continue;
      }
      for (const [query, value] of Object.entries(scope.slice)) {
        queries.add(query);
        const urls = (Array.isArray(value) ? value : []).filter(
          (url): url is AutomergeUrl =>
            typeof url === "string" && isValidAutomergeUrl(url),
        );
        if (urls.length === 0) continue;
        const groups = byQuery.get(query) ?? [];
        groups.push({ owner, urls });
        byQuery.set(query, groups);
      }
    }
    return [...queries].map((query) => ({
      query,
      groups: byQuery.get(query) ?? [],
    }));
  });

  return (
    <Show
      when={rows().length > 0}
      fallback={<div class="embark-token-row__empty">no active searches</div>}
    >
      <table class="embark-results">
        <thead>
          <tr>
            <th>search</th>
            <th>results</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => (
              <tr>
                <td class="embark-results__query">{JSON.stringify(row.query)}</td>
                <td class="embark-results__cell">
                  <Show
                    when={row.groups.length > 0}
                    fallback={
                      <span class="embark-token-row__empty">no results</span>
                    }
                  >
                    <For each={row.groups}>
                      {(group) => (
                        <div class="embark-results__group">
                          <div class="embark-results__card">
                            {cardLabel(group.owner)}
                          </div>
                          <div class="embark-token-row">
                            <For each={group.urls}>
                              {(url) => (
                                <EmbedToken url={url} highlight={highlight} />
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );

  // A human name for the contributing card: its document title (resolved lazily
  // via the shared title cache), falling back to its tool id.
  function cardLabel(owner?: ScopeOwner): string {
    const doc = owner?.docUrl as AutomergeUrl | undefined;
    if (doc) {
      const { docUrl } = splitDocUrl(doc);
      titles.request(docUrl);
      return titles.titleOf(docUrl);
    }
    return owner?.toolId ?? "unknown";
  }
}
