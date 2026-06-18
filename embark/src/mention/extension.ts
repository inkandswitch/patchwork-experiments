import {
  Compartment,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  showTooltip,
  tooltips,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import { subscribe } from "@inkandswitch/patchwork-providers";
import type { SearchDoc } from "../search/datatype";
import "./mention.css";

// The mention token literal `[Name]{automerge-url}`. The url is stored
// verbatim (it may be an extended sub-url such as
// `automerge:<id>/contextToolIds/@0`), validated with `isValidAutomergeUrl`
// before it's rendered as a pill.
const MENTION_RE = /\[([^\]\n]+)\]\{([^}\n]+)\}/g;

// The shared focus store ([providers/src/FocusProvider.ts]) keyed by url.
// Defined locally so the (vanilla CodeMirror) extension needn't depend on the
// Solid provider package.
type FocusDoc = {
  selection: Record<AutomergeUrl, true>;
  highlight: Record<AutomergeUrl, true>;
};

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

// Entry point. The pill renderer and focus wiring are always installed (they
// only act on tokens already in the document). The `@mention` search menu,
// by contrast, stays dormant until a search broker is discovered: the empty
// compartment plus a probe fill it in once a provider answers. Until then
// (possibly forever) typing `@` does nothing special.
export function mentionSearch(): Extension {
  return [mentionTokens(), focusHighlight(), activation.of([]), brokerProbe];
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

// Replaces the `@query` span with a mention token for the chosen result:
// `[Name]{automerge-url}`. The url is stored verbatim (native automerge url,
// possibly a sub-url); the pill renderer below turns it into an atomic chip.
function applySelected(view: EditorView, index?: number): boolean {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return false;
  const result = active.results[index ?? active.index];
  if (!result) return false;
  // `]` and newlines would prematurely close the name part of the token.
  const name = result.title.replace(/[\]\n]/g, " ").trim() || shortUrl(result.url);
  const token = `[${name}]{${result.url}}`;
  view.dispatch({
    changes: { from: active.from, to: active.to, insert: token },
    selection: { anchor: active.from + token.length },
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
  const record = (doc ?? {}) as {
    title?: unknown;
    content?: unknown;
    props?: { name?: unknown };
    place?: { name?: unknown };
  };
  if (typeof record.title === "string" && record.title) return record.title;
  if (typeof record.props?.name === "string" && record.props.name) return record.props.name;
  if (typeof record.content === "string" && record.content) return record.content;
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

// ---------------------------------------------------------------------------
// Pill renderer
//
// Every `[Name]{url}` whose url validates is replaced by an atomic chip. The
// raw source is never revealed for editing — to change a mention, delete it
// (Backspace removes the whole token) and mention again. Always on, regardless
// of whether a search broker was ever found.
// ---------------------------------------------------------------------------

function mentionTokens(): Extension {
  return [mentionPlugin];
}

const mentionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMentions(view);
    }

    update(update: ViewUpdate) {
      // Selection never affects rendering (we always show the pill); only the
      // text, the viewport, or the focus set can change what's drawn.
      const focusChanged =
        update.startState.field(focusedUrls, false) !==
        update.state.field(focusedUrls, false);
      if (update.docChanged || update.viewportChanged || focusChanged) {
        this.decorations = buildMentions(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Treat each pill as one unit: the caret skips over it and Backspace
    // deletes the whole token rather than peeling off the trailing `}`.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

// Replace each valid mention token over the visible ranges with a pill.
function buildMentions(view: EditorView): DecorationSet {
  const focused = view.state.field(focusedUrls, false) ?? EMPTY_FOCUS;
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of text.matchAll(MENTION_RE)) {
      const raw = match[2].trim();
      if (!isValidAutomergeUrl(raw)) continue; // leave malformed tokens as text
      const start = from + (match.index ?? 0);
      const end = start + match[0].length;
      const isFocused = focused.has(parseAutomergeUrl(raw).documentId);
      widgets.push(
        Decoration.replace({
          widget: new MentionWidget(match[1], raw, isFocused),
        }).range(start, end),
      );
    }
  }
  return Decoration.set(widgets, true);
}

class MentionWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly url: AutomergeUrl,
    readonly focused: boolean,
  ) {
    super();
  }

  eq(other: MentionWidget): boolean {
    return (
      other.url === this.url &&
      other.name === this.name &&
      other.focused === this.focused
    );
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.focused ? "cm-mention cm-mention--focused" : "cm-mention";
    span.textContent = this.name;
    span.title = this.url;
    span.addEventListener("click", (event) => {
      event.preventDefault();
      // Open the target document via the app's hash route (`#doc=<id>`).
      const params = new URLSearchParams();
      params.set("doc", parseAutomergeUrl(this.url).documentId);
      window.location.hash = params.toString();
    });
    return span;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

// ---------------------------------------------------------------------------
// Focus highlight
//
// Tokens light up when their target *document* is in focus, and focusing a
// token (caret inside it, or a selection overlapping it) writes that document
// into the shared focus store so the target's own views light up too. This
// mirrors `searchController`'s plumbing rather than the Solid helper, because
// the extension is vanilla CodeMirror. Degrades to a no-op when no
// FocusProvider is reachable.
// ---------------------------------------------------------------------------

const EMPTY_FOCUS = new Set<string>();

// The set of focused document ids (selection ∪ highlight from the FocusDoc),
// normalized to bare documentIds so a token matches whether the store holds a
// plain url or a sub-url for its target.
const setFocusUrls = StateEffect.define<Set<string>>();

const focusedUrls = StateField.define<Set<string>>({
  create: () => EMPTY_FOCUS,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusUrls)) return effect.value;
    }
    return value;
  },
});

function focusHighlight(): Extension {
  return [focusedUrls, focusController];
}

const focusController = ViewPlugin.fromClass(
  class {
    private handle?: DocHandle<FocusDoc>;
    private onDocChange?: () => void;
    private discover?: () => void;
    private destroyed = false;
    // The highlight entry this editor currently owns (its focused token's
    // target), cleared when focus moves elsewhere.
    private written?: AutomergeUrl;

    constructor(private readonly view: EditorView) {
      // One-shot discovery of the shared focus doc, like `brokerProbe`.
      this.discover = subscribe(
        view.dom,
        { type: "patchwork:focus" },
        (url: AutomergeUrl) => {
          if (this.handle || !url) return;
          const repo = window.repo;
          if (!repo) return;
          void Promise.resolve(repo.find<FocusDoc>(url)).then((handle) => {
            if (this.destroyed) return;
            this.handle = handle;
            this.onDocChange = () => this.publishFocus();
            handle.on("change", this.onDocChange);
            this.publishFocus();
            this.syncWrite();
          });
        },
      );
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        // Defer: writing the focus doc emits a "change" that dispatches back
        // into the editor, which must not happen mid-update.
        queueMicrotask(() => this.syncWrite());
      }
    }

    // Project selection ∪ highlight to a set of documentIds and push it in.
    private publishFocus() {
      const doc = this.handle?.doc();
      if (!doc) return;
      const ids = new Set<string>();
      const urls = [
        ...Object.keys(doc.selection ?? {}),
        ...Object.keys(doc.highlight ?? {}),
      ];
      for (const url of urls) {
        if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
      }
      queueMicrotask(() => {
        if (this.destroyed) return;
        const current = this.view.state.field(focusedUrls, false);
        if (current && sameSet(current, ids)) return;
        this.view.dispatch({ effects: setFocusUrls.of(ids) });
      });
    }

    // Reflect the token under the caret into the shared `highlight` map.
    private syncWrite() {
      if (this.destroyed) return;
      const target = focusedMentionUrl(this.view.state);
      if (target === this.written) return;
      const handle = this.handle;
      const previous = this.written;
      this.written = target;
      if (!handle) return;
      handle.change((doc) => rewriteHighlight(doc, previous, target));
    }

    destroy() {
      this.destroyed = true;
      this.discover?.();
      if (this.handle && this.onDocChange) {
        this.handle.off("change", this.onDocChange);
      }
      const handle = this.handle;
      const previous = this.written;
      if (handle && previous) {
        handle.change((doc) => rewriteHighlight(doc, previous, undefined));
      }
    }
  },
);

// Swap this editor's owned highlight entry by reassigning the whole map (a
// `put`) rather than deleting a key in place. The host editor projects this
// doc via automerge-repo-solid-primitives, whose patch reconciler throws
// ("index is not a number for patch") on map-key `del` patches.
function rewriteHighlight(
  doc: FocusDoc,
  remove: AutomergeUrl | undefined,
  add: AutomergeUrl | undefined,
): void {
  const next: Record<AutomergeUrl, true> = {};
  for (const url of Object.keys(doc.highlight ?? {}) as AutomergeUrl[]) {
    if (url !== remove) next[url] = true;
  }
  if (add) next[add] = true;
  doc.highlight = next;
}

// The url of the mention token the selection is focused on: the caret sitting
// anywhere inside a token, or a non-empty selection overlapping one. Scans only
// the lines spanning the selection, so it stays cheap.
function focusedMentionUrl(state: EditorState): AutomergeUrl | undefined {
  const sel = state.selection.main;
  const base = state.doc.lineAt(sel.from).from;
  const text = state.doc.sliceString(base, state.doc.lineAt(sel.to).to);
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = match[2].trim();
    if (!isValidAutomergeUrl(raw)) continue;
    const start = base + (match.index ?? 0);
    const end = start + match[0].length;
    const caretInside = sel.empty && sel.head >= start && sel.head <= end;
    const selectionOverlaps = !sel.empty && sel.from < end && sel.to > start;
    if (caretInside || selectionOverlaps) return raw;
  }
  return undefined;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
