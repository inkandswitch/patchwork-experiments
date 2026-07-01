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
  SchemaQueries,
  SearchQueries,
  SearchResults,
  Stickers,
} from "@embark/core";
import { belongsToDoc, useDocTitles, useHighlight } from "./tokens";
import { ChannelValue } from "./ChannelValue";

// "Contributed by this embed": every channel a card can *write* to, showing —
// per channel — the slice(s) authored by scopes the store attributed to the
// focused embed's document (see resolveOwner in @embark/core). Read-only.
const CONTRIBUTION_CHANNELS: Channel<Record<string, unknown>>[] = [
  SchemaQueries,
  SearchQueries,
  SearchResults,
  CommandQueries,
  CommandSuggestions,
  Stickers,
  Highlight,
  CodemirrorExtensions,
];

type Contribution = { channel: string; slice: Record<string, unknown> };

export function ContributionsView(props: {
  store: ContextStore;
  element: ToolElement;
  focusDocUrl: AutomergeUrl;
}) {
  // The scope snapshot is pull-based (`store.scopes`), so recompute whenever any
  // contribution channel emits — enough to catch a scope appearing, changing, or
  // being released.
  const [tick, setTick] = createSignal(0);
  for (const channel of CONTRIBUTION_CHANNELS) {
    onCleanup(props.store.subscribe(channel, () => setTick((t) => t + 1)));
  }

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);

  const contributions = createMemo<Contribution[]>(() => {
    tick();
    const out: Contribution[] = [];
    for (const channel of CONTRIBUTION_CHANNELS) {
      const merged: Record<string, unknown> = {};
      for (const scope of props.store.scopes(channel)) {
        const ownerDoc = scope.owner?.docUrl as AutomergeUrl | undefined;
        if (!ownerDoc || !belongsToDoc(ownerDoc, props.focusDocUrl)) continue;
        Object.assign(merged, scope.slice);
      }
      if (Object.keys(merged).length > 0) {
        out.push({ channel: channel.name, slice: merged });
      }
    }
    return out;
  });

  return (
    <Show
      when={contributions().length > 0}
      fallback={
        <div class="embark-focus__empty">
          This embed hasn't contributed anything.
        </div>
      }
    >
      <For each={contributions()}>
        {(entry) => (
          <div class="embark-context__channel">
            <div class="embark-context__name">{entry.channel}</div>
            <div class="embark-tokens-panel">
              <ChannelValue
                channel={entry.channel}
                value={entry.slice}
                titles={titles}
                highlight={highlight}
              />
            </div>
          </div>
        )}
      </For>
    </Show>
  );
}
