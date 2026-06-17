import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createEffect, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import { coreSubscribe } from "../lib/providers-solid";
import { QUERY_SELECTOR } from "../canvas/providers/SearchProvider";
import type { SearchDoc } from "./datatype";
import "./search.css";

// What the search box knows how to display about a result document. Kept
// structural (rather than importing the POI doc type) so the box can render any
// contributor's result docs, not just POIs.
type SearchResultDoc = {
  title?: string;
  place?: { name: string; type?: string };
};

// Tool entry point: a query box that publishes its query to the canvas search
// broker and lists whatever result documents the broker writes back into its
// own doc.
export const SearchBoxTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <SearchBox handle={handle as DocHandle<SearchDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function SearchBox(props: { handle: DocHandle<SearchDoc>; element: ToolElement }) {
  const [doc] = useDocument<SearchDoc>(() => props.handle.url);
  const query = () => doc()?.query ?? "";
  const results = () => doc()?.results ?? [];

  // Register with the broker whenever the query changes. The broker learns the
  // active query from this subscription and writes aggregated results straight
  // into our doc, so there's nothing to read off the channel here.
  createEffect(() => {
    const q = query().trim();
    const unsubscribe = coreSubscribe(
      props.element,
      { type: QUERY_SELECTOR, query: q, doc: props.handle.url },
      () => {},
    );
    onCleanup(unsubscribe);
  });

  const onInput = (event: InputEvent & { currentTarget: HTMLInputElement }) => {
    const value = event.currentTarget.value;
    props.handle.change((d) => {
      d.query = value;
    });
  };

  return (
    <div class="embark-search">
      <input
        class="embark-search__input"
        type="text"
        placeholder="Search for places..."
        value={query()}
        on:input={onInput}
      />
      <div class="embark-search__results">
        <Show
          when={query().trim()}
          fallback={<div class="embark-search__hint">Type to search</div>}
        >
          <Show
            when={results().length > 0}
            fallback={<div class="embark-search__hint">No results yet</div>}
          >
            <For each={results()}>{(url) => <ResultRow url={url} />}</For>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// One result document. Each result is its own doc now, so this renders the
// single place it carries (or its title as a fallback for non-POI results).
function ResultRow(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<SearchResultDoc>(() => props.url);
  const place = () => doc()?.place;

  return (
    <Show when={doc()}>
      <Show
        when={place()}
        fallback={
          <Show when={doc()?.title}>
            <div class="embark-search__result">{doc()?.title}</div>
          </Show>
        }
      >
        <div class="embark-search__result">
          <span class="embark-search__result-name">{place()!.name}</span>
          <Show when={place()!.type}>
            <span class="embark-search__result-type">{place()!.type}</span>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
