import type { Extension } from "@codemirror/state";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { CodemirrorExtensions } from "@embark/codemirror-extensions-host";
import { stickerRenderer } from "@embark/stickers";

// Stickers card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the sticker
// renderer codemirror extension into that canvas's `CodemirrorExtensions`
// channel, so the host extension (installed in every editor) draws stickers
// there; flipping or removing the card releases the slice and stops drawing
// them. It renders nothing into the middle slot — the face is drawn by the
// shell.
const card: ToolRender = (_handle, element) =>
  render(() => <Stickers element={element} />, element);

function Stickers(props: { element: HTMLElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree. The extension is
    // created ONCE and held by reference so the context store's change-detection
    // compares by identity rather than recursing into it.
    const scope = getContextHandle(props.element, CodemirrorExtensions);
    const extension: Extension = stickerRenderer();
    scope?.change((slice) => {
      slice["stickers"] = extension;
    });
    onCleanup(() => scope?.release());
  });

  return null;
}

export default card;
