import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  findContextStore,
  type Channel,
  type ContextStore,
} from "@embark/core";
import { Highlight, Selection, Stickers } from "@embark/core";
import { SchemaView } from "./views/SchemaView";
import { SearchView } from "./views/SearchView";
import { CommandsView } from "./views/CommandsView";
import { UrlSetView } from "./views/UrlSetView";
import { ContributionsView } from "./views/ContributionsView";
import { UsedView } from "./views/UsedView";
import { useDocTitles } from "./views/tokens";
import "./context-viewer.css";

// The canvas channels still shown with the generic default view (raw merged
// JSON) in the collapsible full view. Most channels have a custom domain view.
const CHANNELS: Channel<Record<string, unknown>>[] = [Stickers];

// Tool entry point: a live, read-only view focused on the selected embed's
// slice of the canvas context.
export const ContextViewerTool: ToolRender = (_handle, element) => {
  return render(() => <ContextViewer element={element} />, element);
};

function ContextViewer(props: { element: ToolElement }) {
  const [store, setStore] = createSignal<ContextStore>();
  const [resolved, setResolved] = createSignal(false);

  onMount(() => {
    setStore(() => findContextStore(props.element));
    setResolved(true);
  });

  return (
    <div class="embark-context">
      <Show
        when={store()}
        fallback={
          <Show when={resolved()}>
            <div class="embark-context__empty">No canvas context here.</div>
          </Show>
        }
      >
        {(ctx) => <ContextBody store={ctx()} element={props.element} />}
      </Show>
    </div>
  );
}

// The body: the focused view for whatever embed is selected, plus a collapsible
// escape hatch onto the full, unfiltered canvas context.
function ContextBody(props: { store: ContextStore; element: ToolElement }) {
  const [selection, setSelection] = createSignal(props.store.read(Selection));
  onCleanup(props.store.subscribe(Selection, (next) => setSelection(() => next)));
  const selectedUrls = () => Object.keys(selection()) as AutomergeUrl[];

  const [showFull, setShowFull] = createSignal(false);

  return (
    <>
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
            <EmbedFocus
              store={props.store}
              element={props.element}
              docUrl={url}
            />
          )}
        </For>
      </Show>

      <div class="embark-context__full">
        <button
          type="button"
          class="embark-context__full-toggle"
          on:click={() => setShowFull((value) => !value)}
        >
          {showFull() ? "Hide full canvas context" : "Show full canvas context"}
        </button>
        <Show when={showFull()}>
          <SchemaView store={props.store} element={props.element} />
          <SearchView store={props.store} element={props.element} />
          <CommandsView store={props.store} element={props.element} />
          <UrlSetView
            store={props.store}
            element={props.element}
            channel={Selection}
          />
          <UrlSetView
            store={props.store}
            element={props.element}
            channel={Highlight}
          />
          <For each={CHANNELS}>
            {(channel) => <ChannelCard store={props.store} channel={channel} />}
          </For>
        </Show>
      </div>
    </>
  );
}

// The two focused sections for one selected embed: what it contributed to the
// shared context, and what other cards added that targets its document.
function EmbedFocus(props: {
  store: ContextStore;
  element: ToolElement;
  docUrl: AutomergeUrl;
}) {
  const titles = useDocTitles(props.element);
  titles.request(props.docUrl);

  return (
    <div class="embark-focus">
      <div class="embark-focus__title">{titles.titleOf(props.docUrl)}</div>

      <div class="embark-focus__section">
        <div class="embark-focus__heading">Contributed by this embed</div>
        <div class="embark-focus__body">
          <ContributionsView
            store={props.store}
            element={props.element}
            focusDocUrl={props.docUrl}
          />
        </div>
      </div>

      <div class="embark-focus__section">
        <div class="embark-focus__heading">Used by this embed</div>
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

// The generic fallback card used in the full view: a monospace channel name over
// its pretty-printed merged JSON value (or "empty").
function ChannelCard(props: {
  store: ContextStore;
  channel: Channel<Record<string, unknown>>;
}) {
  // `subscribe` only fires on change, so seed with the current value.
  const [value, setValue] = createSignal(props.store.read(props.channel));
  onCleanup(
    props.store.subscribe(props.channel, (next) => setValue(() => next)),
  );

  const isEmpty = () => Object.keys(value()).length === 0;

  return (
    <div
      class="embark-context__channel"
      classList={{ "embark-context__channel--empty": isEmpty() }}
    >
      <div class="embark-context__name">{props.channel.name}</div>
      <Show
        when={!isEmpty()}
        fallback={
          <div class="embark-context__value embark-context__value--empty">
            empty
          </div>
        }
      >
        <pre class="embark-context__value">
          {JSON.stringify(value(), null, 2)}
        </pre>
      </Show>
    </div>
  );
}
