import { type Prop } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { clearHighlightStyle } from "./extension";
import {
  applySearchHighlights,
  clearSearchHighlights,
  computeSearchMatches,
} from "./search";
import "./debug-tool.css";

type MarkdownDoc = {
  content: string;
};

const PATH: Prop[] = ["content"];

export function CodeMirrorHighlightsDebugTool(
  handle: DocHandle<unknown>,
  element: HTMLElement,
) {
  const dispose = render(() => <DebugTool handle={handle as DocHandle<MarkdownDoc>} />, element);

  return function cleanup() {
    dispose();
  };
}

function DebugTool(props: { handle: DocHandle<MarkdownDoc> }) {
  const [content, setContent] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const matches = createMemo(() => computeSearchMatches(content(), query()));
  const selectedIndex = createMemo(() => {
    const currentMatches = matches();
    if (currentMatches.length === 0) return -1;
    return normalizeIndex(activeIndex(), currentMatches.length);
  });

  onMount(() => {
    const onChange = function onChange() {
      syncContent();
    };

    void props.handle.whenReady().then(syncContent);
    props.handle.on("change", onChange);

    onCleanup(() => {
      props.handle.off("change", onChange);
    });
  });

  onCleanup(() => {
    clearHighlightStyle(props.handle);
  });

  createEffect(() => {
    const currentMatches = matches();
    const currentSelectedIndex = selectedIndex();

    if (currentMatches.length === 0) {
      clearSearchHighlights(props.handle);
      return;
    }

    applySearchHighlights(
      props.handle,
      PATH,
      content(),
      query(),
      currentSelectedIndex,
    );
  });

  createEffect(() => {
    const currentMatches = matches();
    if (currentMatches.length === 0) {
      if (activeIndex() !== 0) {
        setActiveIndex(0);
      }
      return;
    }

    const normalizedIndex = normalizeIndex(activeIndex(), currentMatches.length);
    if (normalizedIndex !== activeIndex()) {
      setActiveIndex(normalizedIndex);
    }
  });

  return (
    <div class="cm-highlight-debug-root">
      <div class="cm-highlight-debug-pane cm-highlight-debug-editor">
        <div class="cm-highlight-debug-header">Markdown view</div>
        <patchwork-view
          class="cm-highlight-debug-view"
          doc-url={props.handle.url}
          tool-id="codemirror-base"
        />
      </div>
      <div class="cm-highlight-debug-pane cm-highlight-debug-sidebar">
        <div class="cm-highlight-debug-header">Search</div>
        <label class="cm-highlight-debug-label" for="cm-highlight-debug-input">
          Query
        </label>
        <input
          id="cm-highlight-debug-input"
          class="cm-highlight-debug-input"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
          }}
          placeholder="Search markdown content"
        />
        <div class="cm-highlight-debug-summary">
          {matches().length === 0
            ? "No matches"
            : `${selectedIndex() + 1} of ${matches().length} matches`}
        </div>
        <div class="cm-highlight-debug-actions">
          <button
            class="cm-highlight-debug-button"
            disabled={matches().length === 0}
            onClick={() => setActiveIndex((index) => index - 1)}
            type="button"
          >
            Previous
          </button>
          <button
            class="cm-highlight-debug-button"
            disabled={matches().length === 0}
            onClick={() => setActiveIndex((index) => index + 1)}
            type="button"
          >
            Next
          </button>
          <button
            class="cm-highlight-debug-button cm-highlight-debug-button-secondary"
            onClick={() => {
              setQuery("");
              setActiveIndex(0);
              clearSearchHighlights(props.handle);
            }}
            type="button"
          >
            Clear
          </button>
        </div>
        <div class="cm-highlight-debug-inspector">
          <div class="cm-highlight-debug-inspector-title">Content length</div>
          <div>{content().length} characters</div>
        </div>
        <div class="cm-highlight-debug-inspector">
          <div class="cm-highlight-debug-inspector-title">Visible matches</div>
          <For each={matches()}>
            {(match, index) => (
              <div
                classList={{
                  "cm-highlight-debug-match": true,
                  "is-active": index() === selectedIndex(),
                }}
              >
                <span>{match.from}</span>
                <span>{match.to}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );

  function syncContent() {
    const doc = props.handle.doc();
    setContent(typeof doc?.content === "string" ? doc.content : "");
  }
}

function normalizeIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
