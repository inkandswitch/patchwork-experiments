import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import {
  findContextStore,
  type Channel,
  type ContextStore,
} from "../lib/context";
import {
  CommandQueries,
  CommandSuggestions,
  Highlight,
  SearchQueries,
  SearchResults,
  Selection,
  Stickers,
} from "../canvas/channels";
import { SchemaView } from "./views/SchemaView";
import "./context-viewer.css";

// The canvas channels shown with the generic default view (raw merged JSON).
// Empty channels still render (as "empty"), so this doubles as a list of what's
// available. The schema channels (`schema:queries` / `schema:matches`) are
// deliberately omitted — the custom SchemaView renders them instead.
const CHANNELS: Channel<Record<string, unknown>>[] = [
  Selection,
  Highlight,
  Stickers,
  SearchQueries,
  SearchResults,
  CommandQueries,
  CommandSuggestions,
];

// Tool entry point: a live, read-only view of every canvas context channel.
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
        {(ctx) => (
          <>
            <SchemaView store={ctx()} element={props.element} />
            <For each={CHANNELS}>
              {(channel) => <ChannelCard store={ctx()} channel={channel} />}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}

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
