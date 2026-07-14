// CodeMirror renderer for stickers (see ./channels.js). The editor reads the
// canvas `Stickers` context channel and takes the array filed under its own
// document url — plain `Sticker[]`, no per-sticker documents to resolve. Each
// sticker's `target` is still resolved to a live range handle so its
// `rangePositions()` can be tracked. This is the only target that exists
// today, so it owns the slot vocabulary: "before", "after", "replace" (and
// "after" as the fallback for unknown slots). `style` stickers decorate the
// target range itself.
//
// Built as a vanilla CodeMirror extension (no Solid) so the Stickers card can
// publish it into the canvas `codemirror:extensions` channel, mirroring the
// mention extension. It recovers handles from the repo stamped on the
// enclosing `<patchwork-view>`.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls.

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { isValidAutomergeUrl } from "@automerge/automerge-repo";
import { Stickers } from "./channels.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

/** The sticker renderer as a CodeMirror extension. */
export function stickerRenderer() {
  injectStyles();
  return [stickerItemsField, stickerController, stickerDecorations];
}

// A sticker paired with a handle to its target range, whose `rangePositions()`
// gives the live `[from, to]` in the document:
// `{ sticker: Sticker, target: DocHandle }`.

// The resolved stickers for this editor's document, fed in by the controller.
const setStickers = StateEffect.define();

const stickerItemsField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setStickers)) return effect.value;
    }
    return value;
  },
});

// Discovers this editor's document url, reads the `Stickers` channel, and
// resolves the inline stickers filed under that url into live resolved
// stickers. Sticker content edits arrive as fresh channel emissions (the
// values are inline, so there are no separate sticker documents to watch);
// target repositioning rides the editor's own `docChanged`.
//
// Setup is one-shot: the renderer is only ever installed by the extensions
// host into a connected editor, so the enclosing `<patchwork-view>` (with its
// document url and repo) must be discoverable right now — a failure is a
// broken invariant, not a timing issue, and throws.
const stickerController = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.stickers = [];
      this.generation = 0;
      const url = documentUrl(view);
      this.repo = repoFromEditor(view);
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

    async resolve() {
      const repo = this.repo;
      const generation = ++this.generation;
      const resolved = [];
      for (const sticker of this.stickers) {
        try {
          const target = await Promise.resolve(repo.find(sticker.target));
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
// document changes (positions shift), the viewport changes, or the resolved
// set changes.
const stickerDecorations = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildStickers(view);
    }

    update(update) {
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

function buildStickers(view) {
  const items = view.state.field(stickerItemsField, false) ?? [];
  const docLength = view.state.doc.length;
  const ranges = [];
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
function decorationFor(sticker, from, to) {
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

function cssText(styles) {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function clamp(value, max) {
  return Math.max(0, Math.min(value, max));
}

// The editor's document url, read from the enclosing `<patchwork-view>` (which
// carries `doc-url` in legacy mode, `url` in component mode).
function documentUrl(view) {
  const host = view.dom.closest("patchwork-view");
  if (!host) {
    throw new Error(
      "[stickers] sticker renderer installed in an editor with no enclosing <patchwork-view>",
    );
  }
  const raw = host.getAttribute("doc-url") ?? host.getAttribute("url");
  if (!raw || !isValidAutomergeUrl(raw)) {
    throw new Error(
      `[stickers] enclosing <patchwork-view> carries no valid doc-url/url attribute (got ${JSON.stringify(raw)})`,
    );
  }
  return raw;
}

// The repo stamped on the enclosing `<patchwork-view>` that hosts this editor.
function repoFromEditor(view) {
  const repo = view.dom.closest("patchwork-view")?.repo;
  if (!repo) {
    throw new Error(
      "[stickers] enclosing <patchwork-view> has no repo stamped on it",
    );
  }
  return repo;
}

class TextStickerWidget extends WidgetType {
  constructor(text, styles) {
    super();
    this.text = text;
    this.styles = styles;
  }

  eq(other) {
    return other.text === this.text && sameStyles(other.styles, this.styles);
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-sticker cm-sticker--text";
    span.textContent = this.text;
    if (this.styles) span.style.cssText = cssText(this.styles);
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

function sameStyles(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

class ToolStickerWidget extends WidgetType {
  constructor(docUrl, toolId) {
    super();
    this.docUrl = docUrl;
    this.toolId = toolId;
  }

  eq(other) {
    return other.docUrl === this.docUrl && other.toolId === this.toolId;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-sticker cm-sticker--tool";
    const view = document.createElement("patchwork-view");
    view.setAttribute("doc-url", this.docUrl);
    view.setAttribute("tool-id", this.toolId);
    span.appendChild(view);
    return span;
  }

  // Let the embedded view handle its own pointer/key events.
  ignoreEvent() {
    return true;
  }
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-stickers-renderer-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.cm-sticker {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
}

.cm-sticker--text {
  margin-left: 0.25em;
  padding: 0 0.35em;
  border-radius: 0.5em;
  font-size: 0.85em;
  line-height: 1.4;
  color: #1f2937;
  background: #e5e7eb;
  white-space: nowrap;
}

.cm-sticker--tool {
  vertical-align: middle;
}

.cm-sticker--tool patchwork-view {
  display: inline-block;
  width: 5.5em;
  height: 1.6em;
  vertical-align: middle;
}
`;
