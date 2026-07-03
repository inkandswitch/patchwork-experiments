import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import {
  belongsToDoc,
  splitDocUrl,
  type ContextStore,
  type ContextVisualizer,
  type ScopeOwner,
} from "@embark/context";
import { EmbedToken, useDocTitles, useHighlight } from "@embark/selection/tokens";
import { Stickers } from "./channels";
import type { Sticker } from "./sticker";
import "./visualizer.css";

// Visualizer for the `stickers` channel, drawn the way stickers appear in the
// document. "contributes" groups the focused embed's stickers by target (where
// they landed); "uses" groups the stickers targeting the focused embed by owner
// (who added them).
export const stickersVisualizer: ContextVisualizer = (element, props) => {
  const focus = props.focusDocUrl as AutomergeUrl;
  return render(
    () => (
      <div class="embark-tokens-panel">
        <StickersView
          store={props.store}
          repo={props.repo}
          groupBy={props.mode === "contributes" ? "target" : "owner"}
          authoredBy={props.mode === "contributes" ? focus : undefined}
          targeting={props.mode === "uses" ? focus : undefined}
        />
      </div>
    ),
    element,
  );
};

// Sources publish into their own scope keyed by *target* document
// (`Record<targetDocUrl, Sticker[]>`), so each scope carries the source card as
// its owner. We flatten every scope into `{ owner, target, sticker }` items and
// group them: by `owner` for the "uses" view, or by `target` for the
// "contributes" view.
type Item = { owner?: ScopeOwner; target: AutomergeUrl; sticker: Sticker };
type Group = {
  key: string;
  owner?: ScopeOwner;
  target?: AutomergeUrl;
  items: Item[];
};

function StickersView(props: {
  store: ContextStore;
  repo: Repo;
  groupBy: "owner" | "target";
  // Contributes: keep only scopes owned by this document.
  authoredBy?: AutomergeUrl;
  // Uses: keep only stickers whose target is this document.
  targeting?: AutomergeUrl;
}) {
  const [tick, setTick] = createSignal(0);
  onCleanup(props.store.subscribe(Stickers, () => setTick((t) => t + 1)));

  const titles = useDocTitles(props.repo);
  const highlight = useHighlight(props.store);

  const groups = createMemo<Group[]>(() => {
    tick();
    const items: Item[] = [];
    for (const scope of props.store.scopes(Stickers)) {
      const owner = scope.owner;
      const ownerDoc = owner?.docUrl as AutomergeUrl | undefined;
      if (
        props.authoredBy &&
        (!ownerDoc || !belongsToDoc(ownerDoc, props.authoredBy))
      ) {
        continue;
      }
      for (const [target, stickers] of Object.entries(scope.slice)) {
        const targetUrl = target as AutomergeUrl;
        if (props.targeting && !belongsToDoc(targetUrl, props.targeting)) {
          continue;
        }
        if (!Array.isArray(stickers)) continue;
        for (const sticker of stickers as Sticker[]) {
          items.push({ owner, target: targetUrl, sticker });
        }
      }
    }
    return groupItems(items, props.groupBy);
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
                <Show
                  when={props.groupBy === "target" ? group.target : undefined}
                  fallback={
                    <span class="embark-stickers__card">
                      {cardLabel(group.owner)}
                    </span>
                  }
                >
                  {(target) => (
                    <EmbedToken url={target()} highlight={highlight} />
                  )}
                </Show>
              </div>
              <div class="embark-token-row">
                <For each={group.items}>
                  {(item) => stickerChip(item.sticker)}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );

  // A human name for the source card: its document title (resolved lazily via
  // the shared title cache), falling back to its tool id.
  function cardLabel(owner?: ScopeOwner): string {
    const doc = owner?.docUrl as AutomergeUrl | undefined;
    if (doc) {
      const { docUrl } = splitDocUrl(doc);
      titles.request(docUrl);
      return titles.titleOf(docUrl);
    }
    return owner?.toolId ?? "unknown";
  }
}

// Bucket flattened items by their source owner or their target document.
function groupItems(items: Item[], groupBy: "owner" | "target"): Group[] {
  const byKey = new Map<string, Group>();
  for (const item of items) {
    const key = groupBy === "owner" ? ownerKey(item.owner) : String(item.target);
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        owner: groupBy === "owner" ? item.owner : undefined,
        target: groupBy === "target" ? item.target : undefined,
        items: [],
      };
      byKey.set(key, group);
    }
    group.items.push(item);
  }
  return [...byKey.values()];
}

function ownerKey(owner?: ScopeOwner): string {
  return owner?.docUrl ?? owner?.embedId ?? owner?.toolId ?? "unknown";
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
