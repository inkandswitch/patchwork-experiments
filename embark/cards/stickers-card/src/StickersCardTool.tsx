import type { DocHandle } from "@automerge/automerge-repo";
import type { Extension } from "@codemirror/state";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { CodemirrorExtensions } from "@embark/codemirror-extensions-host";
import { stickerRenderer } from "@embark/stickers";
import type { StickersCardDoc } from "./types";
import "./stickers-card.css";

// While this card sits on a canvas, it publishes the sticker renderer codemirror
// extension into that canvas's `CodemirrorExtensions` channel, so the host
// extension (installed in every editor) draws stickers there. Removing the card
// releases the slice and stops drawing them. Off-canvas there is no store to
// publish into, so it does nothing.
export const StickersCardTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <FeatureCard
        element={element}
        handle={handle as DocHandle<StickersCardDoc>}
      />
    ),
    element,
  );
};

function FeatureCard(props: {
  element: HTMLElement;
  handle: DocHandle<StickersCardDoc>;
}) {
  const [title, setTitle] = createSignal(props.handle.doc()?.title || "Stickers");
  const syncTitle = () => setTitle(props.handle.doc()?.title || "Stickers");
  props.handle.on("change", syncTitle);
  onCleanup(() => props.handle.off("change", syncTitle));

  onMount(() => {
    // Discovery must run once the card is mounted in the canvas subtree. The
    // extension is created ONCE and held by reference so the context store's
    // change-detection compares by identity rather than recursing into it.
    const scope = getContextHandle(props.element, CodemirrorExtensions);
    const extension: Extension = stickerRenderer();
    scope?.change((slice) => {
      slice["stickers"] = extension;
    });
    onCleanup(() => scope?.release());
  });

  return (
    <div class="embark-feature-card embark-feature-card--stickers">
      <div class="embark-feature-card__glyph">✦</div>
      <div class="embark-feature-card__title">{title()}</div>
      <p class="embark-feature-card__desc">
        Draws inline annotations from sticker sources (units, currency, timers,
        schedules) onto your notes.
      </p>
      <div class="embark-feature-card__status">Active on this canvas</div>
    </div>
  );
}
