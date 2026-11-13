import { StateEffect, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { subscribe } from "@inkandswitch/patchwork-providers";

import { HIGHLIGHTS_SELECTOR, type PatchHighlights } from "./folder.js";
import { patchHighlights, type PatchHighlight } from "./layers/index.js";

/** The runs of the string at `path` that patches decide, as shown. */
export function readPatchHighlights(
  handle: unknown,
  path: readonly (string | number)[]
): PatchHighlight[] {
  try {
    return patchHighlights(handle, path);
  } catch (err) {
    console.warn("[patchy] couldn't read patch highlights:", err);
    return [];
  }
}

// The patch's name, in a little tag at the start of what it changes.
class PatchTag extends WidgetType {
  readonly name: string;
  readonly fill: string;
  readonly replaced: string | undefined;
  readonly empty: boolean;

  constructor(
    name: string,
    fill: string,
    replaced: string | undefined,
    empty: boolean
  ) {
    super();
    this.name = name;
    this.fill = fill;
    this.replaced = replaced;
    this.empty = empty;
  }

  eq(other: PatchTag): boolean {
    return (
      other.name === this.name &&
      other.fill === this.fill &&
      other.replaced === this.replaced &&
      other.empty === this.empty
    );
  }

  toDOM(): HTMLElement {
    const tag = document.createElement("span");
    tag.className = "cm-patch-tag";
    tag.textContent = this.name;
    tag.style.cssText = [
      "display:inline-block",
      "font:11px/1.5 system-ui,sans-serif",
      "padding:0 5px",
      "margin-right:2px",
      "vertical-align:text-top",
      "background:#fff8c8",
      "color:#141414",
      `border:1px solid ${this.fill}`,
      "transform:skew(-8deg)",
      "user-select:none",
    ].join(";");
    tag.title = this.replaced
      ? `${this.name} · the document has: ${this.replaced}`
      : this.name;
    // A patch that only deletes shows what it took out, struck through.
    if (this.empty && this.replaced) {
      const gone = document.createElement("s");
      gone.textContent = ` ${this.replaced}`;
      gone.style.cssText = `text-decoration-color:${this.fill};opacity:.7`;
      tag.append(gone);
    }
    return tag;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** A wash over each patched run, and a tag naming its patch. */
export function buildPatchDecorations(
  highlights: PatchHighlight[],
  look: PatchHighlights
): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (const h of highlights) {
    const patch = look.patches[h.patch];
    if (!patch) continue;
    const empty = h.end <= h.start;
    out.push(
      Decoration.widget({
        widget: new PatchTag(patch.name, patch.fill, h.replaced, empty),
        side: -1,
      }).range(h.start)
    );
    if (empty) continue;
    out.push(
      Decoration.mark({
        attributes: {
          class: "cm-patched",
          style: `background:${patch.wash};box-shadow:inset 0 -2px 0 ${patch.fill}`,
          title: h.replaced
            ? `${patch.name} · the document has: ${h.replaced}`
            : patch.name,
        },
      }).range(h.start, h.end)
    );
  }
  return out;
}

const relook = StateEffect.define<null>();

type Host = HTMLElement & {
  repo?: { find(url: string): Promise<unknown> };
};

/**
 * Washes what laid patches change in a CodeMirror editor, while the patches
 * panel's Highlight is on. For codemirror-base, which hands `codemirror:extension`
 * plugins nothing but the editor: the handle is found again through the
 * editor's own `<patchwork-view>` (its overlay repo hands back the same
 * wrapper the tool has), and the look is asked of the providers above it.
 */
export function patchHighlightsExtension(
  path: readonly (string | number)[] = ["content"]
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      readonly #view: EditorView;
      #look: PatchHighlights = { on: false, patches: {} };
      #handle: unknown;
      #stop = () => {};
      #destroyed = false;

      constructor(view: EditorView) {
        this.#view = view;
        this.#connect();
      }

      update(update: ViewUpdate) {
        const asked = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(relook))
        );
        if (update.docChanged || asked) this.decorations = this.#build();
      }

      destroy() {
        this.#destroyed = true;
        this.#stop();
      }

      // The editor is made before it's put in the page, so its
      // <patchwork-view> may not be there yet.
      #connect = () => {
        if (this.#destroyed) return;
        const host = this.#view.dom.closest<Host>("patchwork-view");
        if (!host) {
          if (!this.#view.dom.isConnected) requestAnimationFrame(this.#connect);
          return;
        }
        const url = host.getAttribute("doc-url");
        if (!url) return;
        this.#stop = subscribe<PatchHighlights>(
          host,
          { type: HIGHLIGHTS_SELECTOR },
          (look) => {
            this.#look = look;
            this.#relook();
          }
        );
        host.repo?.find(url).then(
          (handle) => {
            this.#handle = handle;
            this.#relook();
          },
          () => {}
        );
      };

      #relook() {
        if (this.#destroyed) return;
        this.#view.dispatch({ effects: relook.of(null) });
      }

      #build(): DecorationSet {
        if (!this.#look.on || !this.#handle) return Decoration.none;
        return Decoration.set(
          buildPatchDecorations(
            readPatchHighlights(this.#handle, path),
            this.#look
          ),
          true
        );
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}
