import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import {
  type Channel,
  type ContextStore,
  CodemirrorExtensions,
  CommandQueries,
  CommandSuggestions,
  Highlight,
  SchemaMatches,
  SchemaQueries,
  SearchQueries,
  SearchResults,
  Selection,
  Stickers,
} from "@embark/core";
import { splitDocUrl, useDocTitles, useHighlight } from "./tokens";
import { ChannelValue } from "./ChannelValue";
import { SearchResultsTable } from "./SearchResultsTable";

// Every channel a card can *read* from. For the focused embed we show the ones
// it currently subscribes to (see resolveOwner attribution on the read path in
// @embark/core) together with the value it sees.
const READABLE_CHANNELS: Channel<Record<string, unknown>>[] = [
  Selection,
  Highlight,
  Stickers,
  CodemirrorExtensions,
  SearchQueries,
  SearchResults,
  CommandQueries,
  CommandSuggestions,
  SchemaQueries,
  SchemaMatches,
];

// "Used by this embed": the channels the selected embed reads, each shown with
// the current value it sees. Reader attribution is per-channel (the store can't
// see which keys a reader consumes internally), so this answers "what does this
// embed subscribe to, and what does it currently get".
export function UsedView(props: {
  store: ContextStore;
  element: ToolElement;
  focusDocUrl: AutomergeUrl;
}) {
  // Recompute when the reader registry changes (a reader mounting/unmounting,
  // even against an empty channel) or when any readable channel's value emits.
  const [tick, setTick] = createSignal(0);
  const bump = () => setTick((t) => t + 1);
  onCleanup(props.store.subscribeReaders(bump));
  for (const channel of READABLE_CHANNELS) {
    onCleanup(props.store.subscribe(channel, bump));
  }

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);

  const used = createMemo(() => {
    tick();
    const focusId = splitDocUrl(props.focusDocUrl).docId;
    return READABLE_CHANNELS.filter((channel) =>
      props.store.readers(channel).some((owner) => {
        const docUrl = owner.docUrl as AutomergeUrl | undefined;
        return docUrl && splitDocUrl(docUrl).docId === focusId;
      }),
    );
  });

  return (
    <Show
      when={used().length > 0}
      fallback={
        <div class="embark-focus__empty">This embed doesn't read anything.</div>
      }
    >
      <For each={used()}>
        {(channel) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{channel.name}</div>
            <div class="embark-tokens-panel">
              <Show
                when={channel.name === SearchResults.name}
                fallback={
                  <ChannelValue
                    channel={channel.name}
                    value={valueFor(channel)}
                    highlight={highlight}
                  />
                }
              >
                <SearchResultsTable
                  store={props.store}
                  titles={titles}
                  highlight={highlight}
                />
              </Show>
            </div>
          </div>
        )}
      </For>
    </Show>
  );

  // The current merged value the embed reads on this channel.
  function valueFor(channel: Channel<Record<string, unknown>>) {
    tick();
    return props.store.read(channel);
  }
}
