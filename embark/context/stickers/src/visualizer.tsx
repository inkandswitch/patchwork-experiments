import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { type ContextView, type ContextVisualizer } from "@embark/context";
import { EmbedToken, useHighlight } from "@embark/selection/tokens";
import { Stickers } from "./channels";
import type { Sticker } from "./sticker";
import "./visualizer.css";

// Visualizer for the `stickers` channel, drawn the way stickers appear in the
// document: grouped by the *target* document they landed on ("stickers on X").
// The `context` is already scoped by the viewer — the whole canvas, or just the
// inspected embed's contributed stickers — so this draws whatever scopes it
// reports without knowing which.
export const stickersVisualizer: ContextVisualizer = (element, props) => {
  return render(
    () => (
      <div class="embark-tokens-panel">
        <StickersView context={props.context} />
      </div>
    ),
    element,
  );
};

// Sources publish into their own scope keyed by *target* document
// (`Record<targetDocUrl, Sticker[]>`). We flatten every scope's slice into
// per-target sticker lists and group by target.
type Group = { target: AutomergeUrl; stickers: Sticker[] };

function StickersView(props: { context: ContextView }) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.context.subscribe(Stickers, () => setTick((t) => t + 1)));

  const highlight = useHighlight(props.context);

  const groups = createMemo<Group[]>(() => {
    tick();
    const byTarget = new Map<AutomergeUrl, Sticker[]>();
    for (const scope of props.context.scopes(Stickers)) {
      for (const [target, stickers] of Object.entries(scope.slice)) {
        if (!Array.isArray(stickers)) continue;
        const list = byTarget.get(target as AutomergeUrl) ?? [];
        list.push(...(stickers as Sticker[]));
        byTarget.set(target as AutomergeUrl, list);
      }
    }
    return [...byTarget.entries()].map(([target, stickers]) => ({
      target,
      stickers,
    }));
  });

  return (
    <Show
      when={groups().length > 0}
      fallback={<div class="embark-token-row__empty">no stickers</div>}
    >
      <div class="embark-stickers">
        <For each={groups()}>
          {(group) => (
            <div class="embark-stickers__group">
              <div class="embark-stickers__label">
                <EmbedToken url={group.target} highlight={highlight} />
              </div>
              <div class="embark-token-row">
                <For each={group.stickers}>
                  {(sticker) => stickerChip(sticker)}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

// One sticker drawn as it appears in the document (mirroring the CodeMirror
// widgets in this package and TodoTool's stickerNode): `text` as a chip, `tool`
// as an embedded view, `style` as a small swatch (it normally decorates a text
// range, so standalone we show sample glyphs carrying its styles).
function stickerChip(sticker: Sticker): JSX.Element {
  if (sticker.type === "text") {
    return (
      <span
        class="cm-sticker cm-sticker--text"
        style={sticker.styles ? cssText(sticker.styles) : undefined}
      >
        {sticker.text}
      </span>
    );
  }
  if (sticker.type === "tool") {
    return (
      <span class="cm-sticker cm-sticker--tool">
        <patchwork-view doc-url={sticker.docUrl} tool-id={sticker.toolId} />
      </span>
    );
  }
  return (
    <span class="cm-sticker cm-sticker--style" style={cssText(sticker.styles)}>
      Aa
    </span>
  );
}

function cssText(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}
