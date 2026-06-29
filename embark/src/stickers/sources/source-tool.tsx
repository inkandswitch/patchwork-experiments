import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { runStickerSource, type StickerSourceConfig } from "./source-lib";
import "./sources.css";

// Builds a `ToolRender` for a sticker source: it runs the scanning engine and
// shows a small status panel (name + live sticker count), mirroring the POI
// provider's "contributor with a status readout" shape. Each example source is
// just metadata plus a `scan` function on top of this.
export function stickerSourceTool(
  meta: { title: string; subtitle: string },
  config: StickerSourceConfig,
): ToolRender {
  return (_handle, element) => {
    return render(
      () => <SourcePanel element={element} meta={meta} config={config} />,
      element,
    );
  };
}

function SourcePanel(props: {
  element: ToolElement;
  meta: { title: string; subtitle: string };
  config: StickerSourceConfig;
}) {
  const [count, setCount] = createSignal(0);

  onMount(() => {
    const { stop } = runStickerSource(props.element, props.config, setCount);
    onCleanup(stop);
  });

  return (
    <div class="embark-sticker-source">
      <div class="embark-sticker-source__header">
        <span class="embark-sticker-source__dot" />
        {props.meta.title}
      </div>
      <div class="embark-sticker-source__sub">{props.meta.subtitle}</div>
      <div class="embark-sticker-source__count">
        {count()} sticker{count() === 1 ? "" : "s"} published
      </div>
    </div>
  );
}
