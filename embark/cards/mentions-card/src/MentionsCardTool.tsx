import type { DocHandle } from "@automerge/automerge-repo";
import type { Extension } from "@codemirror/state";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { getContextHandle } from "@embark/context";
import { CodemirrorExtensions } from "@embark/codemirror-extensions-host";
import { mentionSearch } from "./extension";
import type { MentionsCardDoc } from "./types";
import "./mentions-card.css";

// While this card sits on a canvas, it publishes the @mention codemirror
// extension into that canvas's `CodemirrorExtensions` channel, so the host
// extension (installed in every editor) turns mentions on there. Removing the
// card releases the slice and turns them back off. Off-canvas there is no store
// to publish into, so it does nothing.
export const MentionsCardTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <FeatureCard
        element={element}
        handle={handle as DocHandle<MentionsCardDoc>}
      />
    ),
    element,
  );
};

function FeatureCard(props: {
  element: HTMLElement;
  handle: DocHandle<MentionsCardDoc>;
}) {
  const [title, setTitle] = createSignal(props.handle.doc()?.title || "Mentions");
  const syncTitle = () => setTitle(props.handle.doc()?.title || "Mentions");
  props.handle.on("change", syncTitle);
  onCleanup(() => props.handle.off("change", syncTitle));

  onMount(() => {
    // Discovery must run once the card is mounted in the canvas subtree. The
    // extension is created ONCE and held by reference so the context store's
    // change-detection compares by identity rather than recursing into it.
    const scope = getContextHandle(props.element, CodemirrorExtensions);
    const extension: Extension = mentionSearch();
    scope?.change((slice) => {
      slice["mentions"] = extension;
    });
    onCleanup(() => scope?.release());
  });

  return (
    <div class="embark-feature-card embark-feature-card--mentions">
      <div class="embark-feature-card__glyph">@</div>
      <div class="embark-feature-card__title">{title()}</div>
      <p class="embark-feature-card__desc">
        Type <code>@</code> to link documents; mention tokens render as live
        pills.
      </p>
      <div class="embark-feature-card__status">Active on this canvas</div>
    </div>
  );
}
