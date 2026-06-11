import {
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
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type TooltipView,
  type ViewUpdate,
} from "@codemirror/view";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import { subscribe } from "../vendor/providers";

// Links to parts of automerge documents, written into the text as
// `[text]{automerge:url,...}` with a trailing `?` while pending. The `{...}?`
// span is never shown raw: it renders as an atomic widget (a link icon, plus
// confirm/remove controls while pending). A pending link mirrors the shapes
// the user has shift-selected on a paper surface; confirming drops the `?`.
type FocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
};

// Wires the per-editor focus bridge (mirrors selection into pending links and
// highlights a link's targets under the cursor), the floating button that
// starts a pending link, the widget decorations, and their styling.
export function paperDocLinks(): Extension {
  return [focusBridge, linkButton, linkDecorations, linkTheme];
}

// Per-editor bridge to the `patchwork:focus` provider. A CodeMirror plugin is
// not a Solid component, but it owns `view.dom`, which sits under the frame's
// focus provider once mounted — so it talks to the provider with the raw
// bubbling-event protocol. It keeps pending links pointed at the current shape
// selection, and writes `focus.highlight` as the cursor enters automerge links.
const focusBridge = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;
    private handle: DocHandle<FocusDoc> | undefined;
    private unsubscribe: (() => void) | undefined;
    private destroyed = false;
    // The highlight we last wrote, so we only write `focus.highlight` on a
    // genuine transition (and never clobber another view's highlight while
    // the cursor sits outside every link).
    private lastHighlightKey = "";

    constructor(view: EditorView) {
      this.view = view;
      this.connectWhenMounted();
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.writeHighlight();
    }

    destroy() {
      this.destroyed = true;
      this.unsubscribe?.();
      if (this.handle) this.handle.off("change", this.onFocusChange);
    }

    // The subscribe event only reaches the provider once `view.dom` is in the
    // document (it bubbles to an ancestor). The plugin is constructed before
    // attachment, so retry on animation frames until connected.
    private connectWhenMounted() {
      if (this.destroyed || this.unsubscribe) return;
      if (!this.view.dom.isConnected) {
        requestAnimationFrame(() => this.connectWhenMounted());
        return;
      }
      this.unsubscribe = subscribe<AutomergeUrl>(
        this.view.dom,
        { type: "patchwork:focus" },
        (url) => this.adoptHandle(url),
      );
    }

    // The provider answers once with the focus doc's url; recover the live
    // handle from the global repo so reads project and writes go straight
    // back, then track its changes.
    private adoptHandle(url: AutomergeUrl) {
      if (this.handle) return;
      const repo = (window as Window & { repo?: Repo }).repo;
      if (!repo) return;
      void Promise.resolve(repo.find<FocusDoc>(url)).then((handle) => {
        if (this.destroyed) return;
        this.handle = handle;
        handle.on("change", this.onFocusChange);
        this.trackPendingLinks();
      });
    }

    private onFocusChange = () => this.trackPendingLinks();

    // Point every pending link at the current shape targets. Freeze-on-empty:
    // when no shapes are selected (e.g. the editor just regained focus, so the
    // selection is only its own text range) we leave the braces alone rather
    // than wiping the targets the user just picked. Dispatched as changes only
    // — an explicit selection would make `codemirror-base` overwrite
    // `focus.selection` and tear the shapes back out.
    private trackPendingLinks() {
      const targets = targetUrls(this.handle?.doc());
      if (targets.length === 0) return;
      const body = targets.join(",");
      const doc = this.view.state.doc.toString();
      const changes: { from: number; to: number; insert: string }[] = [];
      for (const link of findLinks(doc)) {
        if (!link.pending || link.urls === body) continue;
        const urlsFrom = link.braceFrom + 1;
        changes.push({
          from: urlsFrom,
          to: urlsFrom + link.urls.length,
          insert: body,
        });
      }
      if (changes.length > 0) this.view.dispatch({ changes });
    }

    private writeHighlight() {
      const handle = this.handle;
      if (!handle) return;
      const urls = linkTargetsAtCursor(this.view.state);
      const key = urls.join(",");
      if (key === this.lastHighlightKey) return;
      this.lastHighlightKey = key;
      handle.change((doc) => {
        const next: Record<string, true> = {};
        for (const url of urls) next[url] = true;
        doc.highlight = next;
      });
    }
  },
);

// Selected urls a link can point at: everything except text ranges. A text
// range url ends in a cursor segment (`automerge:<id>/content/[a-b]`); a shape
// url ends in a key segment (`automerge:<id>/shapes/<uuid>`).
function targetUrls(doc: FocusDoc | undefined): AutomergeUrl[] {
  if (!doc) return [];
  return (Object.keys(doc.selection ?? {}) as AutomergeUrl[]).filter(
    (url) => !isTextRangeUrl(url),
  );
}

function isTextRangeUrl(url: AutomergeUrl): boolean {
  try {
    const { segments } = parseAutomergeUrl(url);
    const last = segments?.[segments.length - 1];
    return !!last && "start" in last && "end" in last;
  } catch {
    return false;
  }
}

// The automerge urls of the link whose range contains the caret, if any.
// Links never span lines, so a scan of the caret's line is enough.
function linkTargetsAtCursor(state: EditorState): AutomergeUrl[] {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const offset = sel.head - line.from;
  const regex = /\[[^\]\n]*\]\{([^}\n]*)\}\??/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return parseLinkUrls(match[1]);
  }
  return [];
}

function parseLinkUrls(urlPart: string): AutomergeUrl[] {
  return urlPart
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is AutomergeUrl => isValidAutomergeUrl(part));
}

// A `[text]{urls}` link with its absolute positions. `braceFrom`/`braceTo`
// bound the `{...}` plus the trailing `?` — the span the widget replaces.
type LinkMatch = {
  from: number;
  text: string;
  braceFrom: number;
  braceTo: number;
  urls: string;
  pending: boolean;
};

function findLinks(doc: string): LinkMatch[] {
  const matches: LinkMatch[] = [];
  const regex = /\[([^\]\n]*)\]\{([^}\n]*)\}(\?)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(doc)) !== null) {
    const from = match.index;
    const text = match[1];
    const urls = match[2];
    matches.push({
      from,
      text,
      braceFrom: from + 1 + text.length + 1,
      braceTo: from + match[0].length,
      urls,
      pending: match[3] === "?",
    });
  }
  return matches;
}

// The floating "Link" button, shown on any non-empty text selection. Pressing
// it wraps the selection as an empty pending link that then tracks the shape
// selection.
const linkButton = showTooltip.compute(["selection"], (state): Tooltip | null => {
  const sel = state.selection.main;
  if (sel.empty) return null;
  return {
    pos: sel.to,
    above: true,
    strictSide: false,
    arrow: true,
    create: createLinkButton,
  };
});

function createLinkButton(view: EditorView): TooltipView {
  const dom = document.createElement("button");
  dom.type = "button";
  dom.className = "cm-doc-link-button";
  dom.textContent = "Link";

  // mousedown inside the editor's DOM would otherwise collapse the selection
  // before the click lands; swallow it so the anchor range survives.
  dom.addEventListener("mousedown", (event) => event.preventDefault());
  dom.addEventListener("click", (event) => {
    event.preventDefault();
    startPendingLink(view);
  });

  return { dom };
}

function startPendingLink(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const replacement = `[${text}]{}?`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: replacement },
    selection: { anchor: sel.from + replacement.length },
  });
  view.focus();
}

// Replaces each link's `{...}?` span with an atomic widget, falling back to raw
// text while the selection overlaps that span (so it can still be edited
// directly). The same ranges are registered as atomic so the caret skips them.
const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLinkDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
      ),
  },
);

function buildLinkDecorations(view: EditorView): DecorationSet {
  const sel = view.state.selection.main;
  const ranges: Range<Decoration>[] = [];
  for (const link of findLinks(view.state.doc.toString())) {
    if (sel.from < link.braceTo && sel.to > link.braceFrom) continue;
    ranges.push(
      Decoration.replace({ widget: new LinkWidget(link) }).range(
        link.braceFrom,
        link.braceTo,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

// The rendered link control. Confirmed links show a single clickable icon that
// re-opens the link for editing; pending links add confirm and remove buttons.
class LinkWidget extends WidgetType {
  constructor(private readonly link: LinkMatch) {
    super();
  }

  eq(other: LinkWidget) {
    return (
      other.link.urls === this.link.urls &&
      other.link.pending === this.link.pending &&
      other.link.from === this.link.from &&
      other.link.braceTo === this.link.braceTo
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-doc-link";
    if (this.link.pending) wrap.classList.add("cm-doc-link-pending");
    const count = parseLinkUrls(this.link.urls).length;
    wrap.title = `${count} linked ${count === 1 ? "target" : "targets"}`;

    if (this.link.pending) {
      wrap.appendChild(iconSpan(LINK_ICON, "cm-doc-link-icon"));
      wrap.appendChild(
        controlButton(CHECK_ICON, "cm-doc-link-confirm", "Confirm link", () =>
          this.confirm(view),
        ),
      );
      wrap.appendChild(
        controlButton(X_ICON, "cm-doc-link-remove", "Remove link", () =>
          this.remove(view),
        ),
      );
    } else {
      wrap.appendChild(
        controlButton(LINK_ICON, "cm-doc-link-icon", "Edit link", () =>
          this.reopen(view),
        ),
      );
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }

  // Drop the trailing `?`, turning the pending link into a confirmed one.
  private confirm(view: EditorView) {
    view.dispatch({ changes: { from: this.link.braceTo - 1, to: this.link.braceTo } });
  }

  // Unwrap the whole link back to its plain text.
  private remove(view: EditorView) {
    view.dispatch({
      changes: { from: this.link.from, to: this.link.braceTo, insert: this.link.text },
    });
  }

  // Re-add the `?`, reopening the link so it tracks the selection again.
  private reopen(view: EditorView) {
    view.dispatch({ changes: { from: this.link.braceTo, insert: "?" } });
  }
}

function controlButton(
  icon: string,
  className: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = title;
  button.innerHTML = icon;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

function iconSpan(icon: string, className: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = icon;
  return span;
}

const LINK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const X_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

const linkTheme = EditorView.baseTheme({
  ".cm-doc-link-button": {
    font: "inherit",
    fontSize: "12px",
    fontWeight: "500",
    lineHeight: "1",
    padding: "4px 8px",
    color: "#fff",
    background: "#2563eb",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.25)",
  },
  ".cm-doc-link-button:hover": { background: "#1d4ed8" },
  ".cm-doc-link": {
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    verticalAlign: "text-bottom",
    margin: "0 1px",
    padding: "0 2px",
    borderRadius: "4px",
    background: "rgba(37, 99, 235, 0.12)",
    color: "#2563eb",
  },
  ".cm-doc-link-pending": {
    background: "rgba(180, 83, 9, 0.14)",
    color: "#b45309",
  },
  ".cm-doc-link span, .cm-doc-link button": {
    display: "inline-flex",
    alignItems: "center",
  },
  ".cm-doc-link button": {
    padding: "1px",
    color: "inherit",
    background: "none",
    border: "none",
    borderRadius: "3px",
    cursor: "pointer",
  },
  ".cm-doc-link button:hover": { background: "rgba(0, 0, 0, 0.1)" },
  ".cm-doc-link-confirm:hover": { color: "#16a34a" },
  ".cm-doc-link-remove:hover": { color: "#dc2626" },
});
