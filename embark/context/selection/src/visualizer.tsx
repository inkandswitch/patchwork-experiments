import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  type Channel,
  type ContextView,
  type ContextVisualizer,
} from "@embark/context";
import { Highlight, Selection } from "./channels";
import { EmbedToken, useHighlight } from "./tokens";

// Visualizer for the `selection` and `highlight` channels: the referenced
// documents drawn as their real embed faces. The `context` is already scoped by
// the viewer (whole canvas, or just the inspected embed's slice), so this simply
// draws whatever documents the context reports for the channel.
export const selectionVisualizer: ContextVisualizer = (element, props) => {
  const channel = props.channel === Highlight.name ? Highlight : Selection;
  return render(
    () => <TokenChannel context={props.context} channel={channel} />,
    element,
  );
};

function TokenChannel(props: {
  context: ContextView;
  channel: Channel<Record<AutomergeUrl, true>>;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(props.channel, () => setTick((t) => t + 1)));
  const highlight = useHighlight(props.context);

  const urls = createMemo(() => {
    tick();
    return Object.keys(props.context.read(props.channel)) as AutomergeUrl[];
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
