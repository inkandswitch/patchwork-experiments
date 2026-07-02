import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup } from "solid-js";
import { type Channel, type ContextStore } from "@embark/context";
import { Highlight } from "@embark/selection";
import { SearchQueries, SearchResults } from "@embark/search";
import { SchemaQueries } from "@embark/schema";
import { CommandQueries, CommandSuggestions } from "@embark/commands";
import { Stickers } from "@embark/stickers";
import { CodemirrorExtensions } from "@embark/codemirror-extensions-host";
import { belongsToDoc, useDocTitles, useHighlight } from "./tokens";
import { ChannelValue } from "./ChannelValue";
import { SearchResultsTable } from "./SearchResultsTable";
import { StickersView } from "./StickersView";

// "Contributed by this embed": every channel a card can *write* to, showing —
// per channel — the slice(s) authored by scopes the store attributed to the
// focused embed's document (see resolveOwner in @embark/context). Read-only.
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
              <Switch
                fallback={
                  <ChannelValue
                    channel={entry.channel}
                    value={entry.slice}
                    highlight={highlight}
                  />
                }
              >
                <Match when={entry.channel === SearchResults.name}>
                  <SearchResultsTable
                    store={props.store}
                    titles={titles}
                    highlight={highlight}
                    focusDocUrl={props.focusDocUrl}
                  />
                </Match>
                <Match when={entry.channel === Stickers.name}>
                  <StickersView
                    store={props.store}
                    titles={titles}
                    highlight={highlight}
                    groupBy="target"
                    authoredBy={props.focusDocUrl}
                  />
                </Match>
              </Switch>
            </div>
          </div>
        )}
      </For>
    </Show>
  );
}
