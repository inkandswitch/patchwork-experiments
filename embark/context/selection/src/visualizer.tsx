import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  contributedSlice,
  type Channel,
  type ContextStore,
  type ContextVisualizer,
} from "@embark/context";
import { Highlight, Selection } from "./channels";
import { EmbedToken, useHighlight } from "./tokens";

// Visualizer for the `selection` and `highlight` channels: the referenced
// documents drawn as their real embed faces. "contributes" shows the docs the
// focused embed pointed at; "uses" shows the merged set it reads.
export const selectionVisualizer: ContextVisualizer = (element, props) => {
  const channel = props.channel === Highlight.name ? Highlight : Selection;
  return render(
    () => (
      <TokenChannel
        store={props.store}
        channel={channel}
        mode={props.mode}
        focusDocUrl={props.focusDocUrl as AutomergeUrl}
      />
    ),
    element,
  );
};

function TokenChannel(props: {
  store: ContextStore;
  channel: Channel<Record<AutomergeUrl, true>>;
  mode: "contributes" | "uses";
  focusDocUrl: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribe(props.channel, () => setTick((t) => t + 1)));
  const highlight = useHighlight(props.store);

  const urls = createMemo(() => {
    tick();
    const value =
      props.mode === "contributes"
        ? contributedSlice(props.store, props.channel, props.focusDocUrl)
        : props.store.read(props.channel);
    return Object.keys(value) as AutomergeUrl[];
  });

  return (
    <div class="embark-tokens-panel">
      <Show
        when={urls().length > 0}
        fallback={<div class="embark-token-row__empty">nothing</div>}
      >
        <div class="embark-token-row">
          <For each={urls()}>
            {(url) => <EmbedToken url={url} highlight={highlight} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
