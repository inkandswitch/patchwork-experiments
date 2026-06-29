import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createEffect } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import {
  readContext,
  useContextHandle,
  SearchQueries,
  SearchResults,
} from "@embark/core";
import type { SearchDoc } from "./datatype";
import "./search.css";

// What the search box knows how to display about a result document. Kept
// structural (rather than importing a contributor's doc type) so the box can
// render any result doc — cards (`content`/`props`), POI places, or anything
// else with a title.
type SearchResultDoc = {
  title?: string;
  content?: string;
  props?: { name?: string; type?: string };
  place?: { name?: string; type?: string };
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

  // Publish the active query into the shared context (a single-key slice) and
  // read back whatever contributors surfaced for it. Contributors own the
  // values; the box only ever writes its query.
  const queries = useContextHandle(props.element, SearchQueries);
  createEffect(() => {
    const q = query().trim();
    queries.change((slice) => {
      for (const key of Object.keys(slice)) delete slice[key];
      if (q) slice[q] = true;
    });
  });
  const allResults = readContext(props.element, SearchResults);
  const results = (): AutomergeUrl[] => allResults()[query().trim()] ?? [];

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

// One result document — typically a card. Renders its display name (a card's
// `props.name`/`content`, or a POI place name, or a title) with an optional
// type tag.
function ResultRow(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<SearchResultDoc>(() => props.url);
  const name = () =>
    doc()?.props?.name ?? doc()?.place?.name ?? doc()?.content ?? doc()?.title;
  const type = () => doc()?.props?.type ?? doc()?.place?.type;

  return (
    <Show when={doc() && name()}>
      <div class="embark-search__result">
        <span class="embark-search__result-name">{name()}</span>
        <Show when={type()}>
          <span class="embark-search__result-type">{type()}</span>
        </Show>
      </div>
    </Show>
  );
}
