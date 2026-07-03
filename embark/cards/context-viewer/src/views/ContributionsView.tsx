import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  contributedSlice,
  filterChannel,
  ownedBy,
  type Channel,
  type ContextStore,
} from "@embark/context";
import { VisualizerHost } from "../VisualizerHost";

// "Contributed by this embed": every channel the focused embed authored a slice
// on. Channel-agnostic — it enumerates the store's live channels (no hardcoded
// list) and keeps the ones with a non-empty contributed slice. Each kept
// channel is handed a `filterChannel` lens restricting it to the focused embed's
// contributions, so the visualizer draws only that slice without knowing it was
// filtered.
export function ContributionsView(props: {
  store: ContextStore;
  repo: Repo;
  focusDocUrl: AutomergeUrl;
}) {
  const channels = useChannels(props.store);
  const writes = useChannelWrites(props.store, channels);

  const shown = createMemo<Channel<Record<string, unknown>>[]>(() => {
    writes();
    return channels().filter(
      (channel) =>
        Object.keys(contributedSlice(props.store, channel, props.focusDocUrl))
          .length > 0,
    );
  });

  return (
    <Show
      when={shown().length > 0}
      fallback={
        <div class="embark-focus__empty">
          This embed hasn't contributed anything.
        </div>
      }
    >
      <For each={shown()}>
        {(channel) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{channel.name}</div>
            <VisualizerHost
              context={filterChannel(
                props.store,
                channel.name,
                ownedBy(props.focusDocUrl),
              )}
              channel={channel}
              repo={props.repo}
            />
          </div>
        )}
      </For>
    </Show>
  );
}

// The store's live channel set as a signal, refreshed whenever a channel first
// appears.
export function useChannels(store: ContextStore) {
  const [channels, setChannels] = createSignal(store.channels());
  onCleanup(store.subscribeChannels(() => setChannels(store.channels())));
  return channels;
}

// A tick that bumps whenever any live channel emits. Re-subscribes to the whole
// channel set when it changes so writes on newly-appeared channels count too.
// Subscribes without an owner, so the viewer never registers itself as a reader.
function useChannelWrites(
  store: ContextStore,
  channels: () => Channel<Record<string, unknown>>[],
) {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubs = channels().map((channel) =>
      store.subscribe(channel, () => setTick((t) => t + 1)),
    );
    onCleanup(() => unsubs.forEach((unsub) => unsub()));
  });
  return tick;
}
