import {
  isValidAutomergeUrl,
  type AutomergeUrl,
} from "@automerge/automerge-repo";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { type ContextStore, type ScopeOwner } from "@embark/context";
import { SearchQueries, SearchResults } from "@embark/search";
import {
  EmbedToken,
  belongsToDoc,
  splitDocUrl,
  type DocTitles,
  type HighlightController,
} from "./tokens";

// The `search:results` channel as a `search → results` table. Results are
// grouped by the card that produced them (each contributing scope carries its
// owner, so provider cards stay distinct even after the store merges their
// slices). Every active query gets a row — including queries no card answered,
// which show "no results" — by unioning the live SearchQueries keys with the
// queries present in the result scopes.
type Group = { owner?: ScopeOwner; urls: AutomergeUrl[] };
type Row = { query: string; groups: Group[] };

export function SearchResultsTable(props: {
  store: ContextStore;
  titles: DocTitles;
  highlight: HighlightController;
  // When set (the "Contributed" view), keep only groups from this document, so
  // the table shows just what the focused card produced.
  focusDocUrl?: AutomergeUrl;
}) {
  // Scopes are pull-based, so recompute whenever either search channel emits.
  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((t) => t + 1);
  onCleanup(props.store.subscribe(SearchResults, bump));
  onCleanup(props.store.subscribe(SearchQueries, bump));

  const rows = createMemo<Row[]>(() => {
    tick();
    const queries = new Set<string>(Object.keys(props.store.read(SearchQueries)));
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
                                <EmbedToken
                                  url={url}
                                  highlight={props.highlight}
                                />
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
      props.titles.request(docUrl);
      return props.titles.titleOf(docUrl);
    }
    return owner?.toolId ?? "unknown";
  }
}
