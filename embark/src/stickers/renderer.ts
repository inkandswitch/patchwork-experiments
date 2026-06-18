import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { STICKERS_ON_DOCUMENT, type Sticker } from "./types";
import "./stickers.css";

// CodeMirror renderer for stickers (see ./types). The editor asks the canvas
// sticker broker "what targets this document?" via `STICKERS_ON_DOCUMENT`, gets
// back the sub-urls of every sticker, resolves each to a live `Sticker` plus a
// handle to its target range, and draws decorations. This is the only target
// that exists today, so it owns the slot vocabulary: "before", "after",
// "replace" (and "after" as the fallback for unknown slots). `style` stickers
// decorate the target range itself.
//
// Built as a vanilla CodeMirror extension (no Solid) so it can be registered as
// a `codemirror:extension` and loaded into any markdown editor, mirroring the
// mention extension. It recovers handles from the global `window.repo`.
export function stickerRenderer(): Extension {
  return [stickerItemsField, stickerController, stickerDecorations];
}

// A sticker resolved against the repo: its value plus a handle to the target
// range, whose `rangePositions()` gives the live `[from, to]` in the document.
type ResolvedSticker = {
  url: AutomergeUrl;
  sticker: Sticker;
  target: DocHandle<unknown>;
};

// The resolved stickers for this editor's document, fed in by the controller.
const setStickers = StateEffect.define<ResolvedSticker[]>();

const stickerItemsField = StateField.define<ResolvedSticker[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setStickers)) return effect.value;
    }
    return value;
  },
});

// Discovers this editor's document url, subscribes to the broker, and resolves
// the emitted sticker urls into live `ResolvedSticker`s. Re-resolves whenever
// the url set changes or any resolved sticker's own document changes (the
// broker only re-emits on add/remove, so content edits are caught here).
const stickerController = ViewPlugin.fromClass(
  class {
    private unsubscribe?: () => void;
    private urls: AutomergeUrl[] = [];
    private generation = 0;
    private listeners = new Map<DocHandle<unknown>, () => void>();

    constructor(private readonly view: EditorView) {
      const url = documentUrl(view);
      if (!url) return;
      this.unsubscribe = subscribe<AutomergeUrl[]>(
        view.dom,
        { type: STICKERS_ON_DOCUMENT, url },
        (urls) => {
          this.urls = urls;
          void this.resolve();
        },
      );
    }

    private async resolve() {
      const repo = window.repo;
      if (!repo) return;
      const generation = ++this.generation;
      const resolved: ResolvedSticker[] = [];
      for (const url of this.urls) {
        try {
          const handle = await Promise.resolve(repo.find<Sticker>(url));
          const sticker = handle.doc();
          if (!sticker) continue;
          const target = await Promise.resolve(
            repo.find<unknown>(sticker.target),
          );
          resolved.push({ url, sticker, target });
        } catch {
          // skip stickers that fail to load
        }
      }
      if (generation !== this.generation) return;
      this.watchStickers(resolved);
      this.view.dispatch({ effects: setStickers.of(resolved) });
    }

    // Listen for content changes on each sticker's own document so edits to a
    // sticker (e.g. an updated converted value) redraw even when the url set is
    // unchanged. Target repositioning rides the editor's own `docChanged`.
    private watchStickers(resolved: ResolvedSticker[]) {
      this.detachStickers();
      for (const item of resolved) {
        const repo = window.repo;
        if (!repo) continue;
        void Promise.resolve(repo.find(item.url))
          .then((handle) => {
            if (this.listeners.has(handle)) return;
            const onChange = () => void this.resolve();
            handle.on("change", onChange);
            this.listeners.set(handle, onChange);
          })
          .catch(() => {});
      }
    }

    private detachStickers() {
      for (const [handle, onChange] of this.listeners) {
        handle.off("change", onChange);
      }
      this.listeners.clear();
    }

    destroy() {
      this.unsubscribe?.();
      this.detachStickers();
    }
  },
);

// Builds the decorations from the resolved stickers, rebuilding when the
// document changes (positions shift), the viewport changes, or the resolved set
// changes.
const stickerDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildStickers(view);
    }

    update(update: ViewUpdate) {
      const itemsChanged =
        update.startState.field(stickerItemsField) !==
        update.state.field(stickerItemsField);
      if (update.docChanged || update.viewportChanged || itemsChanged) {
        this.decorations = buildStickers(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildStickers(view: EditorView): DecorationSet {
  const items = view.state.field(stickerItemsField, false) ?? [];
  const docLength = view.state.doc.length;
  const ranges: Range<Decoration>[] = [];
  for (const item of items) {
    const positions = item.target.rangePositions();
    if (!positions) continue;
    const from = clamp(positions[0], docLength);
    const to = clamp(positions[1], docLength);
    if (from > to) continue;
    const decoration = decorationFor(item.sticker, from, to);
    if (decoration) ranges.push(decoration);
  }
  return Decoration.set(ranges, true);
}

// Map a sticker onto a CodeMirror decoration. `style` decorates the range
// itself (and no-ops on a collapsed range); the others render a widget placed
// by their slot, defaulting to "after" for any unrecognized slot.
function decorationFor(
  sticker: Sticker,
  from: number,
  to: number,
): Range<Decoration> | null {
  if (sticker.type === "style") {
    if (from === to) return null;
    return Decoration.mark({
      attributes: { style: cssText(sticker.styles) },
    }).range(from, to);
  }

  const widget =
    sticker.type === "text"
      ? new TextStickerWidget(sticker.text)
      : new ToolStickerWidget(sticker.docUrl, sticker.toolId);

  if (sticker.slot === "replace") {
    return Decoration.replace({ widget }).range(from, to);
  }
  if (sticker.slot === "before") {
    return Decoration.widget({ widget, side: -1 }).range(from);
  }
  return Decoration.widget({ widget, side: 1 }).range(to);
}

function cssText(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

// The editor's document url, read from the enclosing `<patchwork-view>` (which
// carries `doc-url` in legacy mode, `url` in component mode).
function documentUrl(view: EditorView): AutomergeUrl | undefined {
  const host = view.dom.closest("patchwork-view");
  const raw = host?.getAttribute("doc-url") ?? host?.getAttribute("url");
  return raw && isValidAutomergeUrl(raw) ? (raw as AutomergeUrl) : undefined;
}

class TextStickerWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: TextStickerWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-sticker cm-sticker--text";
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class ToolStickerWidget extends WidgetType {
  constructor(
    readonly docUrl: AutomergeUrl,
    readonly toolId: string,
  ) {
    super();
  }

  eq(other: ToolStickerWidget): boolean {
    return other.docUrl === this.docUrl && other.toolId === this.toolId;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-sticker cm-sticker--tool";
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", this.docUrl);
    view.setAttribute("tool-id", this.toolId);
    span.appendChild(view);
    return span;
  }

  // Let the embedded view handle its own pointer/key events.
  ignoreEvent(): boolean {
    return true;
  }
}
