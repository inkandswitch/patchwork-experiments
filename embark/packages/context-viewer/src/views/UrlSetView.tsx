import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal, onCleanup } from "solid-js";
import type { Channel, ContextStore } from "@embark/core";
import { DocToken, useDocTitles, useHighlight } from "./tokens";

// A channel that is just a set of document urls (selection, highlight). Renders
// each url as a mention-style document token instead of raw JSON.
export function UrlSetView(props: {
  store: ContextStore;
  element: ToolElement;
  channel: Channel<Record<AutomergeUrl, true>>;
}) {
  const [value, setValue] = createSignal(props.store.read(props.channel));
  onCleanup(props.store.subscribe(props.channel, (next) => setValue(() => next)));

  const titles = useDocTitles(props.element);
  const highlight = useHighlight(props.store);
  const urls = () => Object.keys(value()) as AutomergeUrl[];

  return (
    <div class="embark-context__channel">
      <div class="embark-context__name">{props.channel.name}</div>
      <div class="embark-tokens-panel">
        <Show
          when={urls().length > 0}
          fallback={<div class="embark-token-row__empty">empty</div>}
        >
          <div class="embark-token-row">
            <For each={urls()}>
              {(url) => (
                <DocToken url={url} titles={titles} highlight={highlight} />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
