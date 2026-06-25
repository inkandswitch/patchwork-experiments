import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup } from "solid-js";
import type { ContextStore } from "../../lib/context";
import { SearchQueries, SearchResults } from "../../canvas/channels";
import { DocToken, useDocTitles, useHighlight } from "./tokens";

// The search request/response pair as boxes: one box per active query, with its
// result documents rendered below as mention-style tokens.
export function SearchView(props: {
  store: ContextStore;
  element: ToolElement;
}) {
  const [queries, setQueries] = createSignal(props.store.read(SearchQueries));
  const [results, setResults] = createSignal(props.store.read(SearchResults));
  onCleanup(props.store.subscribe(SearchQueries, (q) => setQueries(() => q)));
  onCleanup(props.store.subscribe(SearchResults, (r) => setResults(() => r)));

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);
  const active = () => Object.keys(queries());

  return (
    <div class="embark-context__channel">
      <div class="embark-context__name">search</div>
      <div class="embark-tokens-panel">
        <Show
          when={active().length > 0}
          fallback={<div class="embark-token-row__empty">no active searches</div>}
        >
          <For each={active()}>
            {(query) => {
              const urls = (): AutomergeUrl[] => results()[query] ?? [];
              return (
                <div class="embark-querybox">
                  <div class="embark-querybox__query">{query}</div>
                  <Show
                    when={urls().length > 0}
                    fallback={
                      <div class="embark-token-row__empty">no results</div>
                    }
                  >
                    <div class="embark-token-row">
                      <For each={urls()}>
                        {(url) => (
                          <DocToken
                            url={url}
                            titles={titles}
                            highlight={highlight}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
