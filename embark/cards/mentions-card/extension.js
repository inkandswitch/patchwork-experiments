// The @mention CodeMirror extension the Mentions card publishes into the
// canvas `codemirror:extensions` channel: the `@` search menu (driven over the
// search channels this package owns), the `{automerge:url}` token renderer,
// and the focus-highlight wiring that ties tokens to the shared selection /
// highlight channels.
//
// Plain-JS bundleless module: bare imports are importmap-provided; sibling
// cards and the core platform are imported by their automerge urls. The shared
// token face is resolved through the plugin registry (`patchwork:tool` /
// "token-view") instead of a direct class import, so this module carries no
// dependency on the token-view package.

import { Compartment, Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  showTooltip,
  tooltips,
} from "@codemirror/view";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
} from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { SearchQueries, SearchResults } from "./channels.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { Highlight, Selection } = await import(
  getImportableUrlFromAutomergeUrl(SELECTION_PACKAGE_URL, "channels.js")
);

// The shared token face, resolved from the registry once it registers (the
// token-view module may load after this one). Until then menu rows fall back
// to plain title text; committed tokens are unaffected (they render through
// `<patchwork-view tool-id="token-view">`, which upgrades on its own).
let tokenViewRender;
void getRegistry("patchwork:tool")
  .loadWhenReady("token-view")
  .then((plugin) => {
    tokenViewRender = plugin.module;
  });

// The embed token literal `{automerge-url}`. The url is stored verbatim (it may
// be an extended sub-url such as `automerge:<id>/contextToolIds/@0`), validated
// with `isValidAutomergeUrl` before it's rendered. The token carries no name and
// no renderer: the resolved document supplies both (its title for the pill, and
// an optional custom inline face via its datatype's token tool).
const MENTION_RE = /\{(automerge:[^}\n]+)\}/g;

// State shapes (plain objects, described here once):
// - One search result: `{ url, title, handle? }` — the document it points at
//   (used verbatim as the link target), a resolved title (the fallback face +
//   accessibility label), and the resolved handle so the menu can paint the
//   result's real inline token face.
// - An in-progress `@mention`: `{ from, to, query, results, index }` — the
//   document span being replaced, the query typed after the `@`, and the
//   results/highlight currently shown.
// - The feature's whole state: `{ active, dismissed }` — the active mention
//   (or null) plus the trigger key the user last dismissed with Escape, so the
//   menu stays shut until they edit the token into something new.

// Entry point. The token renderer and focus wiring are always installed (they
// only act on tokens already in the document, rendering each as a live-title
// pill or a custom inline face). The `@mention` search menu, by contrast,
// stays dormant until a search broker is discovered: the empty compartment
// plus a probe fill it in once a provider answers. Until then (possibly
// forever) typing `@` does nothing special.
export function mentionSearch() {
  injectStyles();
  return [mentionTokens(), focusHighlight(), activation.of([]), brokerProbe];
}

const activation = new Compartment();

// Activates once the editor's DOM is in the document. This whole extension is
// only installed in an editor when a Mentions card publishes it into that
// editor's `CodemirrorExtensions` channel, so the on/off gating already happened
// upstream; here we just wait for the DOM to connect (a synchronous one-shot
// retried on updates) before activating, deferring the dispatch to a microtask
// so it never runs mid-update.
const brokerProbe = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.activated = false;
      this.destroyed = false;
      this.schedule(view);
    }

    update(update) {
      this.schedule(update.view);
    }

    schedule(view) {
      if (this.activated || this.destroyed) return;
      if (!view.dom.isConnected) return;
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
function mentionFeature() {
  return [
    menuState,
    searchController,
    menuKeymap,
    tooltips({ parent: document.body }),
  ];
}

// Async result arrival (the broker writes them into the results channel over
// time).
const setResults = StateEffect.define();
// Keyboard navigation within the menu.
const moveIndex = StateEffect.define();
// Escape: hide the menu for the current token.
const dismiss = StateEffect.define();

// Tracks the mention purely from the document + selection (so it follows edits
// for free) and layers async results / navigation / dismissal on top via
// effects. Provides the menu tooltip.
const menuState = StateField.define({
  create: (state) => deriveFromDoc({ active: null, dismissed: null }, state),
  update(value, tr) {
    let next = deriveFromDoc(value, tr.state);
    for (const effect of tr.effects) {
      if (effect.is(setResults) && next.active) {
        next = {
          ...next,
          active: {
            ...next.active,
            results: effect.value.results,
            index: effect.value.index,
          },
        };
      } else if (effect.is(moveIndex) && next.active) {
        const index = wrapIndex(
          next.active.index + effect.value,
          next.active.results.length,
        );
        next = { ...next, active: { ...next.active, index } };
      } else if (effect.is(dismiss) && next.active) {
        next = { active: null, dismissed: triggerKey(next.active) };
      }
    }
    return next;
  },
  provide: (field) =>
    showTooltip.from(field, (value) =>
      value.active ? buildMenu(value.active) : null,
    ),
});

// Recompute the trigger from the doc, preserving results when the token is
// unchanged and honouring an outstanding Escape dismissal.
function deriveFromDoc(prev, state) {
  const found = activeMention(state);
  if (!found) return { active: null, dismissed: null };
  const key = triggerKey(found);
  if (prev.dismissed === key) return { active: null, dismissed: key };
  if (prev.active && triggerKey(prev.active) === key) {
    return {
      active: {
        ...found,
        results: prev.active.results,
        index: prev.active.index,
      },
      dismissed: null,
    };
  }
  return { active: { ...found, results: [], index: 0 }, dismissed: null };
}

// Detects `@query` immediately before a caret. The `@` must start a line or
// follow whitespace so emails and the like don't trigger it. The query may
// contain spaces — only a newline ends it (and `before` is already a single
// line, so the menu closes the moment the user presses Enter).
function activeMention(state) {
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
    constructor(view) {
      this.view = view;
      this.queries = undefined;
      this.unsubscribe = undefined;
      this.latestResults = {};
      this.query = null;
      this.sync();
    }

    update(update) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(dismiss)))
      ) {
        this.sync();
      }
    }

    sync() {
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
    publishQuery(query) {
      const trimmed = query?.trim();
      this.queries?.change((slice) => {
        for (const key of Object.keys(slice)) delete slice[key];
        if (trimmed) slice[trimmed] = true;
      });
    }

    publishResults() {
      const active = this.view.state.field(menuState, false)?.active;
      if (!active) return;
      const query = active.query.trim();
      const urls = (query && this.latestResults[query]) || [];
      const repo = repoFromEditor(this.view);
      void Promise.all(urls.map((url) => resolveResult(url, repo))).then(
        (results) => {
          const current = this.view.state.field(menuState, false)?.active;
          if (!current || current.query.trim() !== query) return; // stale/closed
          this.view.dispatch({
            effects: setResults.of({
              results,
              index: wrapIndex(current.index, results.length),
            }),
          });
        },
      );
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

function navigate(view, delta) {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return false;
  view.dispatch({ effects: moveIndex.of(delta) });
  return true;
}

// Replaces the `@query` span with an embed token for the chosen result:
// `{automerge-url}`. The url is stored verbatim (native automerge url, possibly a
// sub-url); the renderer below turns it into an atomic chip whose label is the
// document's live title.
function applySelected(view, index) {
  const active = view.state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return false;
  const result = active.results[index ?? active.index];
  if (!result) return false;
  const token = `{${result.url}}`;
  view.dispatch({
    changes: { from: active.from, to: active.to, insert: token },
    selection: { anchor: active.from + token.length },
  });
  view.focus();
  return true;
}

function closeMenu(view) {
  if (!view.state.field(menuState, false)?.active) return false;
  view.dispatch({ effects: dismiss.of(null) });
  return true;
}

// Builds the popup. A fresh tooltip is produced whenever the field changes, so
// rendering is one-shot per state. Each row paints the result's real inline
// token (the same face it gets when embedded in text), so those views must be
// torn down when the tooltip is replaced — hence the `destroy` handler.
function buildMenu(active) {
  return {
    pos: active.from,
    above: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-mention-menu";
      const teardowns = renderMenu(dom, view, active);
      return {
        dom,
        destroy: () => {
          for (const teardown of teardowns) teardown();
        },
      };
    },
  };
}

// Render the menu rows, returning the teardown for every embed view it mounts.
function renderMenu(dom, view, active) {
  if (active.results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cm-mention-empty";
    empty.textContent = active.query ? "Searching…" : "Type to search";
    dom.appendChild(empty);
    return [];
  }
  const teardowns = [];
  const repo = repoFromEditor(view);
  active.results.forEach((result, i) => {
    const row = document.createElement("div");
    row.className = "cm-mention-row";
    if (i === active.index) row.classList.add("cm-mention-row--active");

    // Preview the result with its real inline token by calling the shared
    // token-view render (resolved from the registry) directly with the
    // already-resolved handle. (A <patchwork-view> won't do here: the tooltip
    // is parented to document.body, outside the repo-provider tree, so it can
    // never resolve its repo and would only ever show plain text.)
    // `fallback-label` is what the token view shows if the datatype has no
    // token tool. pointer-events are off so the row owns the click.
    const content = document.createElement("span");
    content.className = "cm-mention-row__content";
    content.style.pointerEvents = "none";
    if (tokenViewRender && result.handle && repo) {
      content.setAttribute("fallback-label", result.title);
      const host = Object.assign(content, { repo });
      teardowns.push(tokenViewRender(result.handle, host));
    } else {
      content.textContent = result.title;
    }
    row.appendChild(content);
    teardowns.push(() => content.remove());

    // mousedown (not click) + preventDefault so the editor keeps its selection.
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applySelected(view, i);
    });
    dom.appendChild(row);
  });
  return teardowns;
}

// The repo stamped on the enclosing `<patchwork-view>` that hosts this editor.
function repoFromEditor(view) {
  const host = view.dom.closest("patchwork-view");
  return host?.repo;
}

// Resolves a result document to a displayable title and its handle. Neither is
// guaranteed in cache, so this awaits the handle; the row shows a short url
// fallback if it can't be resolved.
async function resolveResult(url, repo) {
  if (!repo) return { url, title: shortUrl(url) };
  try {
    const handle = await Promise.resolve(repo.find(url));
    return { url, title: docTitle(handle.doc(), url), handle };
  } catch {
    return { url, title: shortUrl(url) };
  }
}

// A display title for a document, preferring the patchwork display title
// (`@patchwork.title`) and falling back through the other common title-bearing
// fields, then a short url. Mirrors the convention used elsewhere so tokens
// read the same name as the rest of the app.
function docTitle(doc, url) {
  const record = doc ?? {};
  const candidates = [
    record["@patchwork"]?.title,
    record.props?.name,
    record.place?.name,
    record.content,
    record.title,
    record.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return shortUrl(url);
}

function shortUrl(url) {
  return url.replace(/^automerge:/, "").slice(0, 8);
}

function triggerKey(t) {
  return `${t.from}:${t.query}`;
}

function wrapIndex(index, length) {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

// ---------------------------------------------------------------------------
// Token renderer
//
// Every `{automerge:url}` whose url validates is replaced by an atomic chip.
// The chip's content is decided by the resolved document: its datatype's token
// tool paints a custom inline face, otherwise the chip is a pill showing the
// doc's live title. The raw source is never revealed for editing — to change a
// token, delete it (Backspace removes the whole token) and re-insert. Always
// on, regardless of whether a search broker was ever found.
//
// Focus is *not* baked into the widget: the decoration set is rebuilt only on
// text/viewport changes, and focus is applied as a class toggle on the rendered
// pill DOM (see `applyFocus`). This keeps view modules from being torn down and
// re-run every time the caret moves.
// ---------------------------------------------------------------------------

function mentionTokens() {
  return [mentionPlugin];
}

const mentionPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildMentions(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMentions(update.view);
      }
      // Focus only changes a class on existing pills, never the widget set, so
      // view modules survive caret moves. Defer so the DOM patch is in place.
      const focusChanged =
        update.startState.field(focusedUrls, false) !==
        update.state.field(focusedUrls, false);
      if (focusChanged || update.docChanged || update.viewportChanged) {
        queueMicrotask(() => applyFocus(update.view));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // Treat each token as one unit: the caret skips over it and Backspace
    // deletes the whole token rather than peeling off the trailing `}`.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

// Replace each valid token over the visible ranges with an atomic widget.
function buildMentions(view) {
  const widgets = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const match of text.matchAll(MENTION_RE)) {
      const raw = match[1].trim();
      if (!isValidAutomergeUrl(raw)) continue; // leave malformed tokens as text
      const start = from + (match.index ?? 0);
      const end = start + match[0].length;
      widgets.push(
        Decoration.replace({ widget: new MentionWidget(raw) }).range(start, end),
      );
    }
  }
  return Decoration.set(widgets, true);
}

// Reflect the current focus set onto rendered pills. Only pills carry the
// `cm-mention` class, so view-module hosts are never touched.
function applyFocus(view) {
  const focused = view.state.field(focusedUrls, false) ?? EMPTY_FOCUS;
  const nodes = view.contentDOM.querySelectorAll(".cm-mention[data-embark-doc]");
  nodes.forEach((node) => {
    const id = node.dataset.embarkDoc ?? "";
    node.classList.toggle("cm-mention--focused", focused.has(id));
  });
}

// One token, identified solely by its url. Resolving the document (and thus
// deciding pill vs custom view) happens asynchronously in `toDOM`, so identity
// must not depend on the title, focus, or which face it ends up drawing.
class MentionWidget extends WidgetType {
  constructor(url) {
    super();
    this.url = url;
  }

  eq(other) {
    return other.url === this.url;
  }

  toDOM() {
    const host = document.createElement("span");
    const documentId = parseAutomergeUrl(this.url).documentId;
    host.dataset.embarkDoc = documentId;
    host.className = "cm-mention";
    host.title = this.url;

    // The token's face is always a <patchwork-view> rendering the generic
    // `token-view` tool (which delegates to the datatype's token tool, or draws
    // a title pill). The host span carries only behavior: click-to-open and the
    // focus-highlight hook (`applyFocus` toggles `cm-mention--focused` on it).
    const face = document.createElement("patchwork-view");
    face.setAttribute("tool-id", "token-view");
    face.setAttribute("doc-url", this.url);
    host.appendChild(face);

    const onClick = (event) => {
      event.preventDefault();
      // Open the target document via the app's hash route (`#doc=<id>`).
      const params = new URLSearchParams();
      params.set("doc", documentId);
      window.location.hash = params.toString();
    };
    host.addEventListener("click", onClick);

    host.__embedTeardown = () => {
      host.removeEventListener("click", onClick);
      face.remove();
    };
    return host;
  }

  destroy(dom) {
    dom.__embedTeardown?.();
  }

  // Ignore all editor handling inside the chip: pills navigate via their own DOM
  // click listener, and view modules own their pointer/key events entirely.
  ignoreEvent() {
    return true;
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

const EMPTY_FOCUS = new Set();

// The set of focused document ids (Selection ∪ Highlight), normalized to bare
// documentIds so a token matches whether the channel holds a plain url or a
// sub-url for its target.
const setFocusUrls = StateEffect.define();

const focusedUrls = StateField.define({
  create: () => EMPTY_FOCUS,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocusUrls)) return effect.value;
    }
    return value;
  },
});

function focusHighlight() {
  return [focusedUrls, focusController];
}

const focusController = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.destroyed = false;
      this.selectionUrls = {};
      this.highlightUrls = {};
      // The highlight entries this editor currently owns (the targets of every
      // token the caret/selection touches), cleared when focus moves off them.
      this.written = new Set();

      this.unsubscribeSelection = subscribeContext(view.dom, Selection, (all) => {
        this.selectionUrls = all;
        this.publishFocus();
      });
      this.unsubscribeHighlight = subscribeContext(view.dom, Highlight, (all) => {
        this.highlightUrls = all;
        this.publishFocus();
      });
      // The editor's own slice of the Highlight channel.
      this.highlight = getContextHandle(view.dom, Highlight);
    }

    update(update) {
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
    publishFocus() {
      const ids = new Set();
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
    syncWrite() {
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
function writeHighlightSlice(slice, targets) {
  for (const key of Object.keys(slice)) delete slice[key];
  for (const url of targets) slice[url] = true;
}

// The urls of every mention token the selection is focused on: the caret
// sitting anywhere inside a token, or a non-empty selection overlapping one (a
// range can cover several). Scans only the lines spanning the selection, so it
// stays cheap.
function focusedMentionUrls(state) {
  const sel = state.selection.main;
  const base = state.doc.lineAt(sel.from).from;
  const text = state.doc.sliceString(base, state.doc.lineAt(sel.to).to);
  const urls = new Set();
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = match[1].trim();
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
function activeResultUrl(state) {
  const active = state.field(menuState, false)?.active;
  if (!active || active.results.length === 0) return undefined;
  const url = active.results[active.index]?.url;
  return url && isValidAutomergeUrl(url) ? url : undefined;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-mentions-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* Behavioral wrapper around the token's <patchwork-view> face. The face owns
   its own representation (via `token-view`); the .cm-mention span only makes
   the chip flow inline with surrounding text and carries the click/focus
   affordances. */
const CSS = `
.cm-mention {
  display: inline-flex;
  align-items: center;
  vertical-align: baseline;
  max-width: 100%;
  border-radius: 999px;
  cursor: pointer;
  transition: box-shadow 0.12s ease;
}

/* Lit when the token's target document is in focus (selection ∪ highlight in
   the shared focus store): a ring around the face, no change to its fill. */
.cm-mention--focused {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.6);
}

/* The mention menu renders inside CodeMirror's .cm-tooltip wrapper. Neutralize
   the wrapper's chrome so only our own surface shows. */
.cm-tooltip:has(.cm-mention-menu) {
  border: none;
  background: transparent;
}

.cm-mention-menu {
  min-width: 200px;
  max-width: 360px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 13px;
  line-height: 1.4;
}

.cm-mention-row {
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #111827;
}

.cm-mention-row--active,
.cm-mention-row:hover {
  background: rgba(59, 130, 246, 0.15);
}

/* Wraps the result's inline token (or its title-pill fallback) so the row can
   own padding/selection while the embed view owns its own chrome. */
.cm-mention-row__content {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.cm-mention-empty {
  padding: 6px 8px;
  color: #6b7280;
  font-style: italic;
}

@media (prefers-color-scheme: dark) {
  .cm-mention--focused {
    box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.7);
  }

  .cm-mention-menu {
    border-color: rgba(255, 255, 255, 0.12);
    background: #1f2937;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .cm-mention-row {
    color: #e5e7eb;
  }

  .cm-mention-row--active,
  .cm-mention-row:hover {
    background: rgba(96, 165, 250, 0.25);
  }

  .cm-mention-empty {
    color: #9ca3af;
  }
}
`;
