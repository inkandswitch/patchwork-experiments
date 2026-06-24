import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension, Range } from "@codemirror/state";
import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import "./command-embed.css";

// Inline renderer for command embeds. A `/`-command inserts a mention-style
// token that points at a card document AND names a render module:
//
//   [Route: Aachen→Berlin]{automerge:<cardId>?view=<encoded import url>}
//
// This extension finds those tokens, replaces each with an atomic widget, and
// renders the card by importing the named module and running its default export
// against a live handle — exactly the `(element, handle) => cleanup` contract
// the generation loop also uses for effect.js, but for the *view* this time.
// It deliberately bypasses the plugin registry (no tool-id lookup): the
// renderer travels with the token.
//
// Plain mentions (`[name]{url}` with no `?view=`) are left untouched here — the
// mention extension already renders those as pills, which is the fallback when a
// command has no custom renderer.
export function commandEmbeds(): Extension {
  return [commandEmbedPlugin];
}

// Same token shape the mention extension uses; we only claim the ones carrying a
// `?view=` renderer so the two extensions never decorate the same range.
const EMBED_RE = /\[([^\]\n]+)\]\{([^}\n]+)\}/g;
const VIEW_PARAM = "?view=";

// The shape a render module must default-export. Mirrors the effect contract but
// also receives the card handle so it can read and write the card's data.
type ViewModule = {
  default: (
    element: ToolElement,
    handle: DocHandle<unknown>,
  ) => (() => void) | void;
};

const commandEmbedPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildEmbeds(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildEmbeds(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Treat each embed as one unit: the caret skips over it and Backspace
    // deletes the whole token rather than peeling off the trailing `}`.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

function buildEmbeds(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of text.matchAll(EMBED_RE)) {
      const parsed = parseEmbed(match[2].trim());
      if (!parsed) continue; // not a command embed — leave it for the mention pill
      const start = from + (match.index ?? 0);
      const end = start + match[0].length;
      widgets.push(
        Decoration.replace({
          widget: new CommandEmbedWidget(
            match[1],
            parsed.cardUrl,
            parsed.viewUrl,
          ),
        }).range(start, end),
      );
    }
  }
  return Decoration.set(widgets, true);
}

// Split a token url into its card url and renderer url. Returns null for tokens
// without a `?view=` part (plain mentions) or with a malformed card url, so they
// fall through to the mention renderer.
function parseEmbed(
  raw: string,
): { cardUrl: AutomergeUrl; viewUrl: string } | null {
  const at = raw.indexOf(VIEW_PARAM);
  if (at < 0) return null;
  const cardUrl = raw.slice(0, at);
  if (!isValidAutomergeUrl(cardUrl)) return null;
  let viewUrl: string;
  try {
    viewUrl = decodeURIComponent(raw.slice(at + VIEW_PARAM.length));
  } catch {
    return null;
  }
  if (!viewUrl) return null;
  return { cardUrl, viewUrl };
}

class CommandEmbedWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly cardUrl: AutomergeUrl,
    readonly viewUrl: string,
  ) {
    super();
  }

  eq(other: CommandEmbedWidget): boolean {
    return (
      other.cardUrl === this.cardUrl &&
      other.viewUrl === this.viewUrl &&
      other.label === this.label
    );
  }

  toDOM(): HTMLElement {
    const host = document.createElement("span");
    host.className = "cm-command-embed";
    const repo = window.repo;
    if (!repo) {
      host.textContent = this.label;
      return host;
    }
    // The view module reads `element.repo` and may open provider subscriptions
    // that bubble up to the canvas brokers, so hand it this in-tree host with
    // the repo stamped on — exactly like a ToolElement.
    (host as unknown as { repo: typeof repo }).repo = repo;

    let cleanup: (() => void) | void;
    let disposed = false;
    void (async () => {
      try {
        const handle = await Promise.resolve(repo.find(this.cardUrl));
        if (disposed) return;
        const mod = (await import(
          /* @vite-ignore */ this.viewUrl
        )) as ViewModule;
        if (disposed) return;
        if (typeof mod.default !== "function") {
          host.textContent = this.label;
          return;
        }
        cleanup = mod.default(
          host as unknown as ToolElement,
          handle as DocHandle<unknown>,
        );
      } catch (err) {
        host.textContent = this.label;
        host.title = err instanceof Error ? err.message : String(err);
      }
    })();

    (host as unknown as { __embedTeardown?: () => void }).__embedTeardown =
      () => {
        disposed = true;
        if (typeof cleanup === "function") {
          try {
            cleanup();
          } catch {
            // ignore teardown errors
          }
        }
      };
    return host;
  }

  destroy(dom: HTMLElement): void {
    (dom as unknown as { __embedTeardown?: () => void }).__embedTeardown?.();
  }

  // Let the embedded view handle its own pointer/key events.
  ignoreEvent(): boolean {
    return true;
  }
}
