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
import { subscribeContext } from "@embark/context";
import { Stickers } from "./channels";
import type { Sticker } from "./sticker";
import "./stickers.css";

// CodeMirror renderer for stickers (see ./types). The editor reads the canvas
// `Stickers` context channel and takes the array filed under its own document
// url — plain `Sticker[]`, no per-sticker documents to resolve. Each sticker's
// `target` is still resolved to a live range handle so its `rangePositions()`
// can be tracked. This is the only target that exists today, so it owns the
// slot vocabulary: "before", "after", "replace" (and "after" as the fallback
// for unknown slots). `style` stickers decorate the target range itself.
//
// Built as a vanilla CodeMirror extension (no Solid) so it can be registered as
// a `codemirror:extension` and loaded into any markdown editor, mirroring the
// mention extension. It recovers handles from the global `window.repo`.
export function stickerRenderer(): Extension {
  return [stickerItemsField, stickerController, stickerDecorations];
}

// A sticker paired with a handle to its target range, whose `rangePositions()`
// gives the live `[from, to]` in the document.
type ResolvedSticker = {
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

// Discovers this editor's document url, reads the `Stickers` channel, and
// resolves the inline stickers filed under that url into live
// `ResolvedSticker`s. Sticker content edits arrive as fresh channel emissions
// (the values are inline, so there are no separate sticker documents to watch);
// target repositioning rides the editor's own `docChanged`.
const stickerController = ViewPlugin.fromClass(
  class {
    private unsubscribe?: () => void;
    private stickers: Sticker[] = [];
    private generation = 0;

    constructor(private readonly view: EditorView) {
      const url = documentUrl(view);
      if (!url) return;
      this.unsubscribe = subscribeContext(
        view.dom,
        Stickers,
        (all) => {
          this.stickers = all[url] ?? [];
          void this.resolve();
        },
        [url],
      );
    }

    private async resolve() {
      const repo = window.repo;
      if (!repo) return;
      const generation = ++this.generation;
      const resolved: ResolvedSticker[] = [];
      for (const sticker of this.stickers) {
        try {
          const target = await Promise.resolve(
            repo.find<unknown>(sticker.target),
          );
          resolved.push({ sticker, target });
        } catch {
          // skip stickers whose target fails to load
        }
      }
      if (generation !== this.generation) return;
      this.view.dispatch({ effects: setStickers.of(resolved) });
    }

    destroy() {
      this.unsubscribe?.();
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
      ? new TextStickerWidget(sticker.text, sticker.styles)
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
  constructor(
    readonly text: string,
    readonly styles?: Record<string, string>,
  ) {
    super();
  }

  eq(other: TextStickerWidget): boolean {
    return other.text === this.text && sameStyles(other.styles, this.styles);
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-sticker cm-sticker--text";
    span.textContent = this.text;
    if (this.styles) span.style.cssText = cssText(this.styles);
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function sameStyles(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
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
