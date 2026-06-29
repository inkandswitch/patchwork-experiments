import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";
import {
  runStickerSource,
  type StickerSource,
  type StickerSourceConfig,
} from "./source-lib";
import "./source-card.css";

// Presents a sticker source as a playing card, the way the POI and weather
// providers present themselves (../poi/PoiProvider.tsx). The card runs the
// shared scanning engine and shows a live count of the stickers it has on the
// canvas; everything specific to a source is the `meta` (face) plus its `scan`.
export type SourceCardMeta = {
  title: string;
  description: string;
  // A short footer line, like the POI card's data-source credit.
  source: string;
  // The corner pip glyph (drawn twice, mirrored), and its color.
  icon: () => JSX.Element;
  accent: string;
};

// Build a `ToolRender` for a source card. `onReady` hands back the running
// engine so a source can kick off async work (e.g. fetch exchange rates) and
// call `rescanAll()` once it lands.
export function stickerSourceCard(
  meta: SourceCardMeta,
  config: StickerSourceConfig,
  onReady?: (source: StickerSource, element: ToolElement) => void,
): ToolRender {
  return (_handle, element) => {
    return render(
      () => (
        <SourceCard
          element={element}
          meta={meta}
          config={config}
          onReady={onReady}
        />
      ),
      element,
    );
  };
}

function SourceCard(props: {
  element: ToolElement;
  meta: SourceCardMeta;
  config: StickerSourceConfig;
  onReady?: (source: StickerSource, element: ToolElement) => void;
}) {
  const [count, setCount] = createSignal(0);

  onMount(() => {
    const source = runStickerSource(props.element, props.config, setCount);
    props.onReady?.(source, props.element);
    onCleanup(source.stop);
  });

  return (
    <div
      class="embark-source-card"
      style={{ "--embark-source-accent": props.meta.accent }}
    >
      <span class="embark-source-card__pip embark-source-card__pip--tl">
        {props.meta.icon()}
      </span>
      <div class="embark-source-card__body">
        <div class="embark-source-card__title">{props.meta.title}</div>
        <p class="embark-source-card__desc">{props.meta.description}</p>
        <div class="embark-source-card__count">
          {count()} sticker{count() === 1 ? "" : "s"} on the canvas
        </div>
        <div class="embark-source-card__source">{props.meta.source}</div>
      </div>
      <span class="embark-source-card__pip embark-source-card__pip--br">
        {props.meta.icon()}
      </span>
    </div>
  );
}
