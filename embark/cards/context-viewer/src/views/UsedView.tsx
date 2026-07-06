import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { splitDocUrl, type Channel, type ContextStore } from "@embark/context";
import { ChannelView } from "../ChannelView";
import { useChannels } from "./ContributionsView";

// "Used by this embed": the channels the focused embed subscribes to, each
// drawn by the generic ChannelView showing the merged value the embed reads.
// Channel-agnostic — it enumerates the store's live channels and keeps the
// ones whose reader set includes the focused document. Reader attribution is
// per-channel (the store can't see which keys a reader consumes), so this
// answers "what does this embed subscribe to, and what does it currently get".
export function UsedView(props: {
  store: ContextStore;
  focusDocUrl: AutomergeUrl;
}) {
  const channels = useChannels(props.store);

  // The reader set decides which channels show; recompute when a reader
  // (un)subscribes or a channel first appears.
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribeReaders(() => setTick((t) => t + 1)));

  const shown = createMemo<Channel<Record<string, unknown>>[]>(() => {
    tick();
    const focusId = splitDocUrl(props.focusDocUrl).docId;
    return channels().filter((channel) =>
      props.store.readers(channel).some((owner) => {
        const docUrl = owner.docUrl as AutomergeUrl | undefined;
        return docUrl != null && splitDocUrl(docUrl).docId === focusId;
      }),
    );
  });

  return (
    <Show
      when={shown().length > 0}
      fallback={
        <div class="embark-focus__empty">This embed doesn't read anything.</div>
      }
    >
      <For each={shown()}>
        {(channel) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{channel.name}</div>
            <ChannelView context={props.store} channel={channel} />
          </div>
        )}
      </For>
    </Show>
  );
}
