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
} from "@automerge/automerge-repo";
import {
  findContextStore,
  getContextHandle,
  subscribeContext,
  type ScopeHandle,
} from "../lib/context";
import {
  Highlight,
  SearchQueries,
  SearchResults,
  Selection,
} from "../canvas/channels";
import "./mention.css";

// The mention token literal `[Name]{automerge-url}`. The url is stored
// verbatim (it may be an extended sub-url such as
// `automerge:<id>/contextToolIds/@0`), validated with `isValidAutomergeUrl`
// before it's rendered as a pill.
const MENTION_RE = /\[([^\]\n]+)\]\{([^}\n]+)\}/g;

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

// Stays dormant until a canvas context is reachable from this editor (so a
// markdown editor opened outside a canvas leaves `@` inert). Discovery is a
// synchronous one-shot, retried on updates until the editor is connected; the
// activation dispatch is deferred to a microtask so it never runs mid-update.
const brokerProbe = ViewPlugin.fromClass(
  class {
    private activated = false;
    private destroyed = false;

    constructor(view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      this.schedule(update.view);
    }

    private schedule(view: EditorView) {
      if (this.activated || this.destroyed) return;
      if (!findContextStore(view.dom)) return;
      this.activated = true;
      queueMicrotask(() => {
        if (this.destroyed) return;
        view.dispatch({ effects: activation.reconfigure(mentionFeature()) });
      });
    }

    destroy() {
      this.destroyed = true;
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
// follow whitespace so emails and the like don't trigger it. The query may
// contain spaces — only a newline ends it (and `before` is already a single
// line, so the menu closes the moment the user presses Enter).
function activeMention(
  state: EditorState,
): { from: number; to: number; query: string } | null {
  const range = state.selection.main;
  if (!range.empty) return null;
  const head = range.head;
  const line = state.doc.lineAt(head);
  const before = state.doc.sliceString(line.from, head);
  const match = /(?:^|\s)@([^@\n]*)$/.exec(before);
  if (!match) return null;
  const query = match[1];
  return { from: head - query.length - 1, to: head, query };
}

// Drives the search system over the shared context: publishes the active query
// into `SearchQueries` (its own scoped slice) and reads back whatever
// contributors surfaced for it from `SearchResults`, resolving result urls to
// displayable titles for the menu.
const searchController = ViewPlugin.fromClass(
  class {
    private queries?: ScopeHandle<Record<string, true>>;
    private unsubscribe?: () => void;
    private latestResults: Record<string, AutomergeUrl[]> = {};
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
        if (this.query !== null) {
          this.query = null;
          this.publishQuery(null);
        }
        return;
      }
      if (!this.queries) {
        this.queries = getContextHandle(this.view.dom, SearchQueries);
      }
      if (!this.unsubscribe) {
        this.unsubscribe = subscribeContext(
          this.view.dom,
          SearchResults,
          (all) => {
            this.latestResults = all;
            this.publishResults();
          },
        );
      }
      if (active.query !== this.query) {
        this.query = active.query;
        this.publishQuery(active.query);
      }
    }

    // A single-key slice: the active (trimmed) query, or nothing when closed.
    private publishQuery(query: string | null) {
      const trimmed = query?.trim();
      this.queries?.change((slice) => {
        for (const key of Object.keys(slice)) delete slice[key];
        if (trimmed) slice[trimmed] = true;
      });
    }

    private publishResults() {
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) return;
      const query = active.query.trim();
      const urls = (query && this.latestResults[query]) || [];
      void Promise.all(urls.map(resolveResult)).then((results) => {
        const current = this.view.state.field(menuState, false)?.active;
        if (!current || current.query.trim() !== query) return; // stale/closed
        this.view.dispatch({
          effects: setResults.of({
            results,
            index: wrapIndex(current.index, results.length),
          }),
        });
      });
    }

    destroy() {
      this.unsubscribe?.();
      this.queries?.release();
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
// into the canvas `Highlight` channel so the target's own views light up too.
// Focus is read from the union of the `Selection` and `Highlight` channels.
// Degrades to a no-op when no canvas context is reachable.
// ---------------------------------------------------------------------------

const EMPTY_FOCUS = new Set<string>();

// The set of focused document ids (Selection ∪ Highlight), normalized to bare
// documentIds so a token matches whether the channel holds a plain url or a
// sub-url for its target.
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
    private unsubscribeSelection?: () => void;
    private unsubscribeHighlight?: () => void;
    private highlight?: ScopeHandle<Record<string, true>>;
    private destroyed = false;
    private selectionUrls: Record<string, true> = {};
    private highlightUrls: Record<string, true> = {};
    // The highlight entries this editor currently owns (the targets of every
    // token the caret/selection touches), cleared when focus moves off them.
    private written = new Set<AutomergeUrl>();

    constructor(private readonly view: EditorView) {
      this.unsubscribeSelection = subscribeContext(
        view.dom,
        Selection,
        (all) => {
          this.selectionUrls = all;
          this.publishFocus();
        },
      );
      this.unsubscribeHighlight = subscribeContext(
        view.dom,
        Highlight,
        (all) => {
          this.highlightUrls = all;
          this.publishFocus();
        },
      );
      // The editor's own slice of the Highlight channel.
      this.highlight = getContextHandle(view.dom, Highlight);
    }

    update(update: ViewUpdate) {
      // The active autocomplete result is previewed in Highlight too, so the
      // menu's selection (changed by arrow keys or freshly-arrived results)
      // also needs to retrigger a write.
      const previewChanged =
        activeResultUrl(update.startState) !== activeResultUrl(update.state);
      if (update.selectionSet || update.docChanged || previewChanged) {
        // Defer: writing the channel emits back into the editor, which must not
        // happen mid-update.
        queueMicrotask(() => this.syncWrite());
      }
    }

    // Project Selection ∪ Highlight to a set of documentIds and push it in.
    private publishFocus() {
      const ids = new Set<string>();
      for (const url of [
        ...Object.keys(this.selectionUrls),
        ...Object.keys(this.highlightUrls),
      ]) {
        if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
      }
      queueMicrotask(() => {
        if (this.destroyed) return;
        const current = this.view.state.field(focusedUrls, false);
        if (current && sameSet(current, ids)) return;
        this.view.dispatch({ effects: setFocusUrls.of(ids) });
      });
    }

    // Reflect every token the caret/selection touches — plus the active
    // autocomplete result, so navigating the menu previews its target — into
    // the editor's own Highlight slice.
    private syncWrite() {
      if (this.destroyed) return;
      const targets = focusedMentionUrls(this.view.state);
      const previewing = activeResultUrl(this.view.state);
      if (previewing) targets.add(previewing);
      if (sameSet(this.written, targets)) return;
      this.written = targets;
      this.highlight?.change((slice) => writeHighlightSlice(slice, targets));
    }

    destroy() {
      this.destroyed = true;
      this.unsubscribeSelection?.();
      this.unsubscribeHighlight?.();
      // Releasing the slice drops every highlight this editor owned.
      this.highlight?.release();
    }
  },
);

// Rewrite the editor's own Highlight slice to exactly `targets`. The editor
// owns this slice outright (other writers — the canvas selection, the map's
// hover — keep their own), so this is a plain clear-and-set.
function writeHighlightSlice(
  slice: Record<string, true>,
  targets: Set<AutomergeUrl>,
): void {
  for (const key of Object.keys(slice)) delete slice[key];
  for (const url of targets) slice[url] = true;
}

// The urls of every mention token the selection is focused on: the caret
// sitting anywhere inside a token, or a non-empty selection overlapping one (a
// range can cover several). Scans only the lines spanning the selection, so it
// stays cheap.
function focusedMentionUrls(state: EditorState): Set<AutomergeUrl> {
  const sel = state.selection.main;
  const base = state.doc.lineAt(sel.from).from;
  const text = state.doc.sliceString(base, state.doc.lineAt(sel.to).to);
  const urls = new Set<AutomergeUrl>();
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = match[2].trim();
    if (!isValidAutomergeUrl(raw)) continue;
    const start = base + (match.index ?? 0);
    const end = start + match[0].length;
    const caretInside = sel.empty && sel.head >= start && sel.head <= end;
    const selectionOverlaps = !sel.empty && sel.from < end && sel.to > start;
    if (caretInside || selectionOverlaps) urls.add(raw);
  }
  return urls;
}

// The target of the result currently highlighted in the autocomplete menu, if
// the menu is open with results. Used to preview that document's emphasis
// before the user commits the mention. Undefined when the menu feature isn't
// installed (no broker yet) or there's nothing to preview.
function activeResultUrl(state: EditorState): AutomergeUrl | undefined {
  const active = state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return undefined;
  const url = active.results[active.index]?.url;
  return url && isValidAutomergeUrl(url) ? url : undefined;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
