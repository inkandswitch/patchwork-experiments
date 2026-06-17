import {
  Compartment,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  keymap,
  showTooltip,
  tooltips,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { subscribe } from "@inkandswitch/patchwork-providers";
import type { SearchDoc } from "../search/datatype";
import "./mention.css";

// One result the broker surfaced for the active query: the document it points
// at (`automerge:…`, used verbatim as the link target) and a resolved title.
type Result = { url: AutomergeUrl; title: string };

// An in-progress `@mention`: the document span being replaced, the query the
// user typed after the `@`, and the results/highlight currently shown.
type Mention = {
  from: number;
  to: number;
  query: string;
  results: Result[];
  index: number;
};

// The feature's whole state: the active mention (if any) plus the trigger key
// the user last dismissed with Escape, so the menu stays shut until they edit
// the token into something new.
type MenuState = { active: Mention | null; dismissed: string | null };

// Entry point. The `@mention` feature stays dormant until a search broker is
// discovered, so this returns just an empty compartment plus a probe that fills
// it in once a provider answers. Until then (possibly forever) typing `@` does
// nothing special.
export function mentionSearch(): Extension {
  return [activation.of([]), brokerProbe];
}

const activation = new Compartment();

// Opens a discovery subscription on mount. The broker only answers
// `search:responses` over the channel, so a first emission is proof that a
// search provider is reachable from this editor; at that point we install the
// real feature and stop probing.
const brokerProbe = ViewPlugin.fromClass(
  class {
    private unsubscribe?: () => void;

    constructor(view: EditorView) {
      this.unsubscribe = subscribe(view.dom, { type: "search:responses" }, () => {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        view.dispatch({ effects: activation.reconfigure(mentionFeature()) });
      });
    }

    destroy() {
      this.unsubscribe?.();
    }
  },
);

// The actual behaviour, installed only after a broker is found.
function mentionFeature(): Extension {
  return [
    menuState,
    searchController,
    menuKeymap,
    tooltips({ parent: document.body }),
  ];
}

// Async result arrival (the broker writes them into the SearchDoc over time).
const setResults = StateEffect.define<{ results: Result[]; index: number }>();
// Keyboard navigation within the menu.
const moveIndex = StateEffect.define<number>();
// Escape: hide the menu for the current token.
const dismiss = StateEffect.define<null>();

// Tracks the mention purely from the document + selection (so it follows edits
// for free) and layers async results / navigation / dismissal on top via
// effects. Provides the menu tooltip.
const menuState = StateField.define<MenuState>({
  create: (state) => deriveFromDoc({ active: null, dismissed: null }, state),
  update(value, tr) {
    let next = deriveFromDoc(value, tr.state);
    for (const effect of tr.effects) {
      if (effect.is(setResults) && next.active) {
        next = {
          ...next,
          active: { ...next.active, results: effect.value.results, index: effect.value.index },
        };
      } else if (effect.is(moveIndex) && next.active) {
        const index = wrapIndex(next.active.index + effect.value, next.active.results.length);
        next = { ...next, active: { ...next.active, index } };
      } else if (effect.is(dismiss) && next.active) {
        next = { active: null, dismissed: triggerKey(next.active) };
      }
    }
    return next;
  },
  provide: (field) =>
    showTooltip.from(field, (value) => (value.active ? buildMenu(value.active) : null)),
});

// Recompute the trigger from the doc, preserving results when the token is
// unchanged and honouring an outstanding Escape dismissal.
function deriveFromDoc(prev: MenuState, state: EditorState): MenuState {
  const found = activeMention(state);
  if (!found) return { active: null, dismissed: null };
  const key = triggerKey(found);
  if (prev.dismissed === key) return { active: null, dismissed: key };
  if (prev.active && triggerKey(prev.active) === key) {
    return {
      active: { ...found, results: prev.active.results, index: prev.active.index },
      dismissed: null,
    };
  }
  return { active: { ...found, results: [], index: 0 }, dismissed: null };
}

// Detects `@query` immediately before a caret. The `@` must start a line or
// follow whitespace so emails and the like don't trigger it.
function activeMention(
  state: EditorState,
): { from: number; to: number; query: string } | null {
  const range = state.selection.main;
  if (!range.empty) return null;
  const head = range.head;
  const line = state.doc.lineAt(head);
  const before = state.doc.sliceString(line.from, head);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { from: head - query.length - 1, to: head, query };
}

// Drives the search system: lazily creates a throwaway SearchDoc to receive
// results into, (re)subscribes to the broker whenever the query changes, and
// pushes resolved results back into the editor as the broker fills the doc.
const searchController = ViewPlugin.fromClass(
  class {
    private handle?: DocHandle<SearchDoc>;
    private onDocChange?: () => void;
    private unsubscribe?: () => void;
    private query: string | null = null;

    constructor(private readonly view: EditorView) {
      this.sync();
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(dismiss)))
      ) {
        this.sync();
      }
    }

    private sync() {
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) {
        this.query = null;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        return;
      }
      const repo = window.repo;
      if (!repo) return;
      if (!this.handle) {
        // Intentionally never deleted — it's scratch state for receiving
        // results, and leaking it is acceptable here.
        this.handle = repo.create<SearchDoc>({
          "@patchwork": { type: "search" },
          query: "",
          results: [],
        });
        this.onDocChange = () => this.publishResults();
        this.handle.on("change", this.onDocChange);
      }
      if (active.query !== this.query) {
        this.query = active.query;
        this.unsubscribe?.();
        // Same selector SearchBox registers; the broker writes aggregated
        // result urls straight into our SearchDoc.results.
        this.unsubscribe = subscribe(
          this.view.dom,
          { type: "search:query", query: active.query, doc: this.handle.url },
          () => {},
        );
      }
    }

    private publishResults() {
      const handle = this.handle;
      if (!handle) return;
      if (!this.view.state.field(menuState, false)?.active) return;
      const query = this.query;
      const urls = handle.doc()?.results ?? [];
      void Promise.all(urls.map(resolveResult)).then((results) => {
        const active = this.view.state.field(menuState, false)?.active;
        if (!active || this.query !== query) return; // stale or closed
        this.view.dispatch({
          effects: setResults.of({ results, index: wrapIndex(active.index, results.length) }),
        });
      });
    }

    destroy() {
      this.unsubscribe?.();
      if (this.handle && this.onDocChange) this.handle.off("change", this.onDocChange);
    }
  },
);

// Menu keys take precedence over the editor's defaults, but only while the menu
// is actually open with something to act on — otherwise they fall through.
const menuKeymap = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: (view) => navigate(view, 1) },
    { key: "ArrowUp", run: (view) => navigate(view, -1) },
    { key: "Enter", run: (view) => applySelected(view) },
    { key: "Escape", run: closeMenu },
  ]),
);

function navigate(view: EditorView, delta: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return false;
  view.dispatch({ effects: moveIndex.of(delta) });
  return true;
}

// Replaces the `@query` span with a Markdown link to the chosen result:
// `[title](automerge:…)`.
function applySelected(view: EditorView, index?: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return false;
  const result = active.results[index ?? active.index];
  if (!result) return false;
  const link = `[${result.title}](${result.url})`;
  view.dispatch({
    changes: { from: active.from, to: active.to, insert: link },
    selection: { anchor: active.from + link.length },
  });
  view.focus();
  return true;
}

function closeMenu(view: EditorView): boolean {
  if (!view.state.field(menuState, false)?.active) return false;
  view.dispatch({ effects: dismiss.of(null) });
  return true;
}

// Builds the popup. A fresh tooltip is produced whenever the field changes, so
// rendering is one-shot per state.
function buildMenu(active: Mention): Tooltip {
  return {
    pos: active.from,
    above: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-mention-menu";
      renderMenu(dom, view, active);
      return { dom };
    },
  };
}

function renderMenu(dom: HTMLElement, view: EditorView, active: Mention) {
  if (active.results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cm-mention-empty";
    empty.textContent = active.query ? "Searching…" : "Type to search";
    dom.appendChild(empty);
    return;
  }
  active.results.forEach((result, i) => {
    const row = document.createElement("div");
    row.className = "cm-mention-row";
    if (i === active.index) row.classList.add("cm-mention-row--active");
    row.textContent = result.title;
    // mousedown (not click) + preventDefault so the editor keeps its selection.
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySelected(view, i);
    });
    dom.appendChild(row);
  });
}

// Resolves a result document to a displayable title. Titles aren't guaranteed
// in cache, so this awaits the handle; the row shows a short url fallback if it
// can't be resolved.
async function resolveResult(url: AutomergeUrl): Promise<Result> {
  const repo = window.repo;
  if (!repo) return { url, title: shortUrl(url) };
  try {
    const handle = await Promise.resolve(repo.find(url));
    return { url, title: docTitle(handle.doc(), url) };
  } catch {
    return { url, title: shortUrl(url) };
  }
}

function docTitle(doc: unknown, url: AutomergeUrl): string {
  const record = (doc ?? {}) as { title?: unknown; place?: { name?: unknown } };
  if (typeof record.title === "string" && record.title) return record.title;
  if (typeof record.place?.name === "string" && record.place.name) return record.place.name;
  return shortUrl(url);
}

function shortUrl(url: AutomergeUrl): string {
  return url.replace(/^automerge:/, "").slice(0, 8);
}

function triggerKey(t: { from: number; query: string }): string {
  return `${t.from}:${t.query}`;
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
