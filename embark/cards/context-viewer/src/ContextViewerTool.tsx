import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { findContextStore, type ContextStore } from "@embark/context";
import { Selection } from "@embark/selection";
import { ContributionsView } from "./views/ContributionsView";
import { UsedView } from "./views/UsedView";
import "./context-viewer.css";

// Tool entry point: a live, read-only view focused on the selected embed's
// slice of the canvas context.
export const ContextViewerTool: ToolRender = (_handle, element) => {
  return render(() => <ContextViewer element={element} />, element);
};

function ContextViewer(props: { element: ToolElement }) {
  // Always resolves a store (the enclosing context, or the page-global body
  // store); it just isn't known until mount, so it starts undefined.
  const [store, setStore] = createSignal<ContextStore>();

  onMount(() => setStore(() => findContextStore(props.element)));

  return (
    <div class="embark-context">
      <Show when={store()}>
        {(ctx) => <ContextBody store={ctx()} element={props.element} />}
      </Show>
    </div>
  );
}

// The body: the focused view for whatever embed is selected on the canvas.
function ContextBody(props: { store: ContextStore; element: ToolElement }) {
  const [selection, setSelection] = createSignal(props.store.read(Selection));
  onCleanup(props.store.subscribe(Selection, (next) => setSelection(() => next)));
  const selectedUrls = () => Object.keys(selection()) as AutomergeUrl[];

  return (
    <Show
      when={selectedUrls().length > 0}
      fallback={
        <div class="embark-context__empty">
          Select an embed to inspect its context.
        </div>
      }
    >
      <For each={selectedUrls()}>
        {(url) => (
          <EmbedFocus store={props.store} element={props.element} docUrl={url} />
        )}
      </For>
    </Show>
  );
}

// The two focused sections for one selected embed: what it contributed to the
// shared context, and what it reads back out of it.
function EmbedFocus(props: {
  store: ContextStore;
  element: ToolElement;
  docUrl: AutomergeUrl;
}) {
  return (
    <div class="embark-focus">
      <div class="embark-focus__section">
        <div class="embark-focus__heading">Contributes</div>
        <div class="embark-focus__body">
          <ContributionsView
            store={props.store}
            element={props.element}
            focusDocUrl={props.docUrl}
          />
        </div>
      </div>

      <div class="embark-focus__section">
        <div class="embark-focus__heading">Uses</div>
        <div class="embark-focus__body">
          <UsedView
            store={props.store}
            element={props.element}
            focusDocUrl={props.docUrl}
          />
        </div>
      </div>
    </div>
  );
}
