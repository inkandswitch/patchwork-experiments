import type { Extension } from "@codemirror/state";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { CodemirrorExtensions } from "@embark/codemirror-extensions-host";
import { slashCommands } from "./extension";

// Commands card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the
// slash-command codemirror extension into that canvas's `CodemirrorExtensions`
// channel, so the host extension (installed in every editor) turns the `/` menu
// on there; flipping or removing the card releases the slice and turns it back
// off. It renders nothing into the middle slot — the face is drawn by the shell.
const card: ToolRender = (_handle, element) =>
  render(() => <Commands element={element} />, element);

function Commands(props: { element: HTMLElement }) {
  onMount(() => {
    // Discovery must run once mounted in the canvas subtree. The extension is
    // created ONCE and held by reference so the context store's change-detection
    // compares by identity rather than recursing into it.
    const scope = getContextHandle(props.element, CodemirrorExtensions);
    const extension: Extension = slashCommands();
    scope?.change((slice) => {
      slice["commands"] = extension;
    });
    onCleanup(() => scope?.release());
  });

  return null;
}

export default card;
