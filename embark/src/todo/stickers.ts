import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { coreSubscribe } from "../lib/providers-solid";
import { STICKERS_ON_DOCUMENT, type Sticker } from "../stickers/types";
import type { TodoItem } from "./datatype";

// The todo tool's sticker controller and grouping logic — the Solid analog of
// the markdown editor's `stickers/renderer.ts`. The controller asks the canvas
// sticker broker "what targets this document?" and resolves each url to a live
// `Sticker` plus a handle to its target. `groupByItem` then reads each target's
// path (and cursor range, if any) to bucket the stickers per item: around the
// whole item (before / after / replace, plus `style`) or inline at a sub-range
// of the item's text.

// A sticker resolved against the repo: its value plus a handle to the target,
// whose `path` names the item and whose `rangePositions()` gives an inline span.
export type ResolvedSticker = {
  url: AutomergeUrl;
  sticker: Sticker;
  target: DocHandle<unknown>;
};

// Subscribe to the broker for `docUrl`, resolve the emitted sticker urls into
// live `ResolvedSticker`s, and re-resolve whenever the url set changes or any
// resolved sticker's own document changes (the broker only re-emits on
// add/remove, so content edits are caught by the per-sticker listeners).
export function useItemStickers(
  element: ToolElement,
  docUrl: AutomergeUrl,
): Accessor<ResolvedSticker[]> {
  const [resolved, setResolved] = createSignal<ResolvedSticker[]>([]);
  const listeners = new Map<DocHandle<unknown>, () => void>();
  let urls: AutomergeUrl[] = [];
  let generation = 0;

  const resolve = async () => {
    const repo = element.repo;
    const current = ++generation;
    const out: ResolvedSticker[] = [];
    for (const url of urls) {
      try {
        const handle = await Promise.resolve(repo.find<Sticker>(url));
        const sticker = handle.doc();
        if (!sticker) continue;
        const target = await Promise.resolve(repo.find<unknown>(sticker.target));
        out.push({ url, sticker, target });
      } catch {
        // skip stickers that fail to load
      }
    }
    if (current !== generation) return;
    watch(out);
    setResolved(out);
  };

  // Listen for content changes on each sticker's own document so edits to a
  // sticker (e.g. updated text) redraw even when the url set is unchanged.
  const watch = (items: ResolvedSticker[]) => {
    detach();
    const repo = element.repo;
    for (const item of items) {
      void Promise.resolve(repo.find(item.url))
        .then((handle) => {
          if (listeners.has(handle)) return;
          const onChange = () => void resolve();
          handle.on("change", onChange);
          listeners.set(handle, onChange);
        })
        .catch(() => {});
    }
  };

  const detach = () => {
    for (const [handle, onChange] of listeners) handle.off("change", onChange);
    listeners.clear();
  };

  onMount(() => {
    const unsubscribe = coreSubscribe<AutomergeUrl[]>(
      element,
      { type: STICKERS_ON_DOCUMENT, url: docUrl },
      (next) => {
        urls = next;
        void resolve();
      },
    );
    onCleanup(() => {
      unsubscribe();
      detach();
    });
  });

  return resolved;
}

// Stickers that land on a whole item: the slotted widgets (before / after /
// replace) plus any merged `style` decoration for the item's text.
export type WholeItemStickers = {
  before: Sticker[];
  after: Sticker[];
  replace: Sticker | null;
  styles: Record<string, string>;
};

// A sticker that lands on a sub-range of the item's text.
export type InlineSticker = { from: number; to: number; sticker: Sticker };

export type ItemStickerGroup = {
  whole: WholeItemStickers;
  inline: InlineSticker[];
};

// Bucket resolved stickers by the item they target. Reads each target handle's
// live `path` / `rangePositions()` so the result tracks reordering and edits;
// call it from a reactive scope that depends on the doc so it recomputes.
export function groupByItem(
  items: TodoItem[],
  resolved: ResolvedSticker[],
): Map<string, ItemStickerGroup> {
  const groups = new Map<string, ItemStickerGroup>();
  for (const { sticker, target } of resolved) {
    const path = target.path;
    if (!path[0] || path[0].prop !== "items") continue;
    const item = locateItem(items, path[1]);
    if (!item) continue;

    const group = ensureGroup(groups, item.id);
    const onText = path[2]?.prop === "text";
    const range = onText ? target.rangePositions() : undefined;
    if (range) {
      group.inline.push({ from: range[0], to: range[1], sticker });
    } else {
      placeWhole(group.whole, sticker);
    }
  }
  for (const group of groups.values()) {
    group.inline.sort((a, b) => a.from - b.from || a.to - b.to);
  }
  return groups;
}

// Resolve the item a target's second path segment names: by stable `id` when
// the segment is a pattern match (`sub("items", { id })`), otherwise by index
// (`sub("items", 0)`). The match's resolved index is also available as `prop`,
// but matching on `id` survives reordering.
function locateItem(
  items: TodoItem[],
  segment: { prop?: string | number; match?: Record<string, unknown> } | undefined,
): TodoItem | undefined {
  if (!segment) return undefined;
  const id = segment.match?.id;
  if (typeof id === "string") return items.find((item) => item.id === id);
  if (typeof segment.prop === "number") return items[segment.prop];
  return undefined;
}

function ensureGroup(
  groups: Map<string, ItemStickerGroup>,
  id: string,
): ItemStickerGroup {
  let group = groups.get(id);
  if (!group) {
    group = {
      whole: { before: [], after: [], replace: null, styles: {} },
      inline: [],
    };
    groups.set(id, group);
  }
  return group;
}

// Place a whole-item sticker by kind/slot, mirroring `decorationFor` in the
// markdown renderer: `style` merges onto the item's text, `replace` overrides,
// `before`/`after` (the default for any unknown slot) collect in order.
function placeWhole(whole: WholeItemStickers, sticker: Sticker): void {
  if (sticker.type === "style") {
    Object.assign(whole.styles, sticker.styles);
    return;
  }
  if (sticker.slot === "replace") {
    whole.replace = sticker;
    return;
  }
  if (sticker.slot === "before") {
    whole.before.push(sticker);
    return;
  }
  whole.after.push(sticker);
}
