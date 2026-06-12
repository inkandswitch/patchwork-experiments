import {
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
  type DecorationSet,
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
import type { Point, SurfaceState } from "../surface/types";
import type { LinkFocusDoc } from "./types";

// Links to parts of automerge documents, written into the text as
// `[text]{automerge:url,...}`. The `{...}` span is never shown raw: it renders
// as an atomic widget (a link icon, plus a remove control while active).
//
// Clicking the icon "arms" the link: the editor publishes an `activeLink`
// entry into the shared focus doc, and the paper's arrow layer takes over —
// drawing arrows from the link to its targets and to the mouse, and appending
// the clicked shape's url to `activeLink.targets`. The editor mirrors that
// list back into the braces and ends the activation. One target per arming;
// click the icon again to add another.

// Wires the per-editor focus bridge (owns activations, mirrors targets into
// the link text, highlights a link's targets under the cursor), the inline
// button that creates a link from a selection, the widget decorations, the
// selection-driven link highlights, and their styling.
export function paperDocLinks(): Extension {
  return [
    activeLinkPos,
    focusBridge,
    selectedTargets,
    linkButton,
    linkDecorations,
    linkHighlights,
    linkTheme,
  ];
}

// The `from` position of the link currently armed from this editor, mapped
// through document changes so edits don't lose it. Kept in a state field so
// the widget decorations rebuild (and restyle the active icon) on activation
// changes.
const setActiveLink = StateEffect.define<number | null>();

const activeLinkPos = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (value !== null) value = tr.changes.mapPos(value);
    for (const effect of tr.effects) {
      if (effect.is(setActiveLink)) value = effect.value;
    }
    return value;
  },
});

// Per-editor bridge to the `patchwork:focus` and `surface:state` providers. A
// CodeMirror plugin is not a Solid component, but it owns `view.dom`, which
// sits under the frame's providers once mounted — so it talks to them with
// the raw bubbling-event protocol. It owns the activation lifecycle: arming a
// link, keeping the activation's source point pinned to the widget, mirroring
// targets the arrow layer appends back into the braces, and writing
// `focus.highlight` as the cursor enters automerge links.
const focusBridge = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    private focusHandle: DocHandle<LinkFocusDoc> | undefined;
    private stateHandle: DocHandle<SurfaceState> | undefined;
    private unsubscribeFocus: (() => void) | undefined;
    private unsubscribeState: (() => void) | undefined;
    private destroyed = false;
    // The highlight we last wrote, so we only write `focus.highlight` on a
    // genuine transition (and never clobber another view's highlight while
    // the cursor sits outside every link).
    private lastHighlightKey = "";
    // The selected targets we last pushed into editor state, so a focus
    // change that didn't touch the shape selection doesn't dispatch.
    private lastSelectedKey = "";
    // Identity of this editor's live activation in the shared focus doc;
    // null while no link is armed from this editor.
    private sourceId: string | null = null;
    private sourceFrame: number | null = null;
    private lastSource: Point | null = null;

    constructor(view: EditorView) {
      this.view = view;
      this.connectWhenMounted();
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.writeHighlight();
    }

    destroy() {
      this.destroyed = true;
      // Withdraw a live activation so the arrow layer doesn't keep drawing
      // arrows for an editor that no longer exists.
      this.deactivate();
      this.unsubscribeFocus?.();
      this.unsubscribeState?.();
      if (this.focusHandle) this.focusHandle.off("change", this.onFocusChange);
    }

    // Arm `link`, or disarm it if it is the one currently armed. Called from
    // the link widget's icon.
    toggleActive(link: LinkMatch) {
      const pos = this.view.state.field(activeLinkPos);
      if (this.sourceId !== null && pos === link.from) {
        this.deactivate();
      } else {
        this.activate(link);
      }
    }

    private activate(link: LinkMatch) {
      const focus = this.focusHandle;
      if (!focus) return;

      const sourceId = crypto.randomUUID();
      this.sourceId = sourceId;
      // Set the field before the focus write: the change event's microtask
      // (trackActiveLink) reads it.
      this.view.dispatch({ effects: setActiveLink.of(link.from) });

      const source = this.sourcePoint() ?? { x: 0, y: 0 };
      this.lastSource = source;
      focus.change((doc) => {
        doc.activeLink = {
          sourceId,
          source,
          targets: parseLinkUrls(link.urls),
        };
      });

      // Claim the tool slot so the select tool doesn't also react to the
      // shape click that picks a target. Cleared again on deactivation;
      // SelectButton reclaims the empty slot as the default tool.
      this.stateHandle?.change((state) => {
        state.selectedToolId = "link";
      });

      this.startSourceLoop();
    }

    // Tear down an activation we own, removing it from the shared focus doc.
    private deactivate() {
      const sourceId = this.sourceId;
      if (sourceId === null) return;
      this.deactivateLocal(true);
      this.focusHandle?.change((doc) => {
        if (doc.activeLink?.sourceId === sourceId) delete doc.activeLink;
      });
    }

    // Local teardown only. `releaseTool` hands the tool slot back (select
    // reclaims it); skipped when a newer activation owns the slot now.
    private deactivateLocal(releaseTool: boolean) {
      this.sourceId = null;
      this.lastSource = null;
      if (this.sourceFrame !== null) {
        cancelAnimationFrame(this.sourceFrame);
        this.sourceFrame = null;
      }
      if (!this.destroyed) {
        this.view.dispatch({ effects: setActiveLink.of(null) });
      }
      if (releaseTool) {
        this.stateHandle?.change((state) => {
          if (state.selectedToolId === "link") state.selectedToolId = "";
        });
      }
    }

    // The screen position of the armed link's widget. coordsAtPos is null
    // while the link is scrolled out of the viewport; fall back to the
    // editor's own box so the arrow still points at the right document.
    private sourcePoint(): Point | null {
      const pos = this.view.state.field(activeLinkPos);
      if (pos === null) return null;
      const link = findLinks(this.view.state.doc.toString()).find(
        (l) => l.from === pos,
      );
      if (!link) return null;
      const coords = this.view.coordsAtPos(
        Math.min(link.braceFrom, this.view.state.doc.length),
      );
      if (coords) {
        return { x: coords.left, y: (coords.top + coords.bottom) / 2 };
      }
      const rect = this.view.dom.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    // While armed, keep `activeLink.source` pinned to the widget. Polling on
    // animation frames (with a dirty check, so a static editor writes
    // nothing) catches every way the widget can move on screen: typing,
    // editor scroll, and the embed being dragged on the paper.
    private startSourceLoop() {
      if (this.sourceFrame !== null) return;
      const tick = () => {
        this.sourceFrame = null;
        if (this.destroyed || this.sourceId === null) return;
        const source = this.sourcePoint();
        if (
          source &&
          (this.lastSource === null ||
            source.x !== this.lastSource.x ||
            source.y !== this.lastSource.y)
        ) {
          this.lastSource = source;
          const sourceId = this.sourceId;
          this.focusHandle?.change((doc) => {
            if (doc.activeLink?.sourceId === sourceId) {
              doc.activeLink.source = source;
            }
          });
        }
        this.sourceFrame = requestAnimationFrame(tick);
      };
      this.sourceFrame = requestAnimationFrame(tick);
    }

    // The subscribe events only reach the providers once `view.dom` is in the
    // document (they bubble to an ancestor). The plugin is constructed before
    // attachment, so retry on animation frames until connected.
    private connectWhenMounted() {
      if (this.destroyed || this.unsubscribeFocus) return;
      if (!this.view.dom.isConnected) {
        requestAnimationFrame(() => this.connectWhenMounted());
        return;
      }
      this.unsubscribeFocus = subscribe<AutomergeUrl>(
        this.view.dom,
        { type: "patchwork:focus" },
        (url) => this.adoptFocusHandle(url),
      );
      this.unsubscribeState = subscribe<AutomergeUrl>(
        this.view.dom,
        { type: "surface:state" },
        (url) => this.adoptStateHandle(url),
      );
    }

    // The focus provider answers once with the focus doc's url; recover the
    // live handle from the global repo so reads project and writes go
    // straight back, then track its changes.
    private adoptFocusHandle(url: AutomergeUrl) {
      if (this.focusHandle) return;
      const repo = (window as Window & { repo?: Repo }).repo;
      if (!repo) return;
      void Promise.resolve(repo.find<LinkFocusDoc>(url)).then((handle) => {
        if (this.destroyed) return;
        this.focusHandle = handle;
        handle.on("change", this.onFocusChange);
        this.syncSelectedTargets();
      });
    }

    // The surface provider can answer more than once (a fallback state doc
    // first, then the inherited one), so always adopt the latest.
    private adoptStateHandle(url: AutomergeUrl) {
      const repo = (window as Window & { repo?: Repo }).repo;
      if (!repo) return;
      void Promise.resolve(repo.find<SurfaceState>(url)).then((handle) => {
        if (this.destroyed) return;
        this.stateHandle = handle;
      });
    }

    // Deferred a tick: this fires synchronously from inside the focus doc's
    // own `change()` call, and the dispatches below can make codemirror-base
    // write `focus.selection` straight back — a re-entrant change on the same
    // doc, which trips automerge's wasm borrow ("recursive use of an
    // object"). After the microtask the original change has unwound.
    private onFocusChange = () => {
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.trackActiveLink();
        this.syncSelectedTargets();
      });
    };

    // React to the shared activation changing while we own it: mirror targets
    // the arrow layer appended into the braces (a grown list means the user
    // picked a shape, which completes the activation), and tear down when the
    // layer cancelled it or another editor took over.
    private trackActiveLink() {
      if (this.sourceId === null) return;
      const active = this.focusHandle?.doc()?.activeLink;

      if (!active) {
        // Cancelled by the arrow layer (empty-space click or Escape).
        this.deactivateLocal(true);
        return;
      }
      if (active.sourceId !== this.sourceId) {
        // A newer activation displaced ours; the tool slot is theirs now.
        this.deactivateLocal(false);
        return;
      }

      const pos = this.view.state.field(activeLinkPos);
      const link =
        pos === null
          ? undefined
          : findLinks(this.view.state.doc.toString()).find(
              (l) => l.from === pos,
            );
      if (!link) {
        // The link text vanished under us (deleted by an edit).
        this.deactivate();
        return;
      }

      const targets = [...(active.targets ?? [])];
      const grew = targets.length > parseLinkUrls(link.urls).length;
      const body = targets.join(",");
      if (body !== link.urls) {
        const urlsFrom = link.braceFrom + 1;
        this.view.dispatch({
          changes: {
            from: urlsFrom,
            to: urlsFrom + link.urls.length,
            insert: body,
          },
        });
      }
      if (grew) this.deactivate();
    }

    // Push the current shape selection into editor state so links pointing
    // at a selected target render highlighted (`linkHighlights`).
    private syncSelectedTargets() {
      const targets = targetUrls(this.focusHandle?.doc());
      const key = targets.join(",");
      if (key === this.lastSelectedKey) return;
      this.lastSelectedKey = key;
      this.view.dispatch({ effects: setSelectedTargets.of(targets) });
    }

    // The write is deferred out of the CodeMirror update cycle (this is
    // called from `update()`): the focus doc's change event fires
    // synchronously inside `change()`, and listeners reacting to it (this
    // bridge, codemirror-base) can dispatch or write back re-entrantly.
    private writeHighlight() {
      const handle = this.focusHandle;
      if (!handle) return;
      const urls = linkTargetsAtCursor(this.view.state);
      const key = urls.join(",");
      if (key === this.lastHighlightKey) return;
      this.lastHighlightKey = key;
      queueMicrotask(() => {
        if (this.destroyed) return;
        handle.change((doc) => {
          const next: Record<string, true> = {};
          for (const url of urls) next[url] = true;
          doc.highlight = next;
        });
      });
    }
  },
);

// Selected urls a link can point at: everything except text ranges. A text
// range url ends in a cursor segment (`automerge:<id>/content/[a-b]`); a shape
// url ends in a key segment (`automerge:<id>/shapes/<uuid>`).
function targetUrls(doc: LinkFocusDoc | undefined): AutomergeUrl[] {
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

// The shape selection mirrored into editor state by the focus bridge, as a
// set of target urls. `linkHighlights` reads it to mark the links pointing
// at a selected shape.
const setSelectedTargets = StateEffect.define<AutomergeUrl[]>();

const selectedTargets = StateField.define<Set<string>>({
  create: () => new Set(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSelectedTargets)) return new Set(effect.value);
    }
    return value;
  },
});

// A `[text]{urls}` link with its absolute positions. `braceFrom`/`braceTo`
// bound the `{...}` (plus a legacy trailing `?`) — the span the widget
// replaces.
type LinkMatch = {
  from: number;
  text: string;
  braceFrom: number;
  braceTo: number;
  urls: string;
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
    });
  }
  return matches;
}

// The "make this a link" button: an inline widget at the end of any non-empty
// text selection, styled exactly like a link's icon so it previews what the
// selection turns into. Hidden while the selection overlaps an existing link
// — the link's own controls apply there, and nesting links is not a thing.
// Pressing it wraps the selection as an empty link and immediately arms it,
// so the arrow starts following the mouse right away.
const linkButton = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkButton(view.state);
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        this.decorations = buildLinkButton(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function buildLinkButton(state: EditorState): DecorationSet {
  const sel = state.selection.main;
  if (sel.empty) return Decoration.none;
  const overlapsLink = findLinks(state.doc.toString()).some(
    (link) => sel.from < link.braceTo && sel.to > link.from,
  );
  if (overlapsLink) return Decoration.none;
  return Decoration.set([
    Decoration.widget({ widget: new LinkButtonWidget(), side: 1 }).range(
      sel.to,
    ),
  ]);
}

class LinkButtonWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-doc-link cm-doc-link-button";
    button.title = "Link selection";
    button.innerHTML = LINK_ICON;

    // mousedown inside the editor's DOM would otherwise collapse the
    // selection before the click lands; swallow it so the range survives.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      startLink(view);
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function startLink(view: EditorView) {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const replacement = `[${text}]{}`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: replacement },
    selection: { anchor: sel.from + replacement.length },
  });
  // Arm the freshly written link so the arrow appears immediately.
  const link = findLinks(view.state.doc.toString()).find(
    (l) => l.from === sel.from,
  );
  if (link) view.plugin(focusBridge)?.toggleActive(link);
  view.focus();
}

// Replaces each link's `{...}` span with an atomic widget, falling back to raw
// text while the selection overlaps that span (so it can still be edited
// directly). The same ranges are registered as atomic so the caret skips them.
const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.field(activeLinkPos) !==
          update.state.field(activeLinkPos)
      ) {
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
  const activePos = view.state.field(activeLinkPos);
  const ranges: Range<Decoration>[] = [];
  for (const link of findLinks(view.state.doc.toString())) {
    if (sel.from < link.braceTo && sel.to > link.braceFrom) continue;
    ranges.push(
      Decoration.replace({
        widget: new LinkWidget(link, link.from === activePos),
      }).range(link.braceFrom, link.braceTo),
    );
  }
  return Decoration.set(ranges, true);
}

// Marks the `[text]` of every link pointing at a currently selected shape,
// mirroring the canvas selection back into the editor: the shape carries its
// selection outline, the links naming it light up in the same blue. Kept out
// of `linkDecorations` because those ranges double as atomic ranges, and a
// mark must not make its text atomic.
const linkHighlights = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkHighlights(view.state);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.startState.field(selectedTargets) !==
          update.state.field(selectedTargets)
      ) {
        this.decorations = buildLinkHighlights(update.state);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const linkHighlightMark = Decoration.mark({ class: "cm-doc-link-selected" });

function buildLinkHighlights(state: EditorState): DecorationSet {
  const selected = state.field(selectedTargets);
  if (selected.size === 0) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const link of findLinks(state.doc.toString())) {
    if (!parseLinkUrls(link.urls).some((url) => selected.has(url))) continue;
    ranges.push(linkHighlightMark.range(link.from, link.braceFrom));
  }
  return Decoration.set(ranges);
}

// The rendered link control. The icon arms/disarms the link's arrow mode; an
// armed link also shows a remove button that unwraps it back to plain text.
class LinkWidget extends WidgetType {
  constructor(
    private readonly link: LinkMatch,
    private readonly active: boolean,
  ) {
    super();
  }

  eq(other: LinkWidget) {
    return (
      other.link.urls === this.link.urls &&
      other.link.from === this.link.from &&
      other.link.braceTo === this.link.braceTo &&
      other.active === this.active
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-doc-link";
    if (this.active) wrap.classList.add("cm-doc-link-active");
    const count = parseLinkUrls(this.link.urls).length;
    wrap.title = `${count} linked ${count === 1 ? "target" : "targets"}`;

    wrap.appendChild(
      controlButton(
        LINK_ICON,
        "cm-doc-link-icon",
        this.active ? "Stop linking" : "Add link target",
        () => view.plugin(focusBridge)?.toggleActive(this.link),
      ),
    );
    if (this.active) {
      wrap.appendChild(
        controlButton(X_ICON, "cm-doc-link-remove", "Remove link", () =>
          this.remove(view),
        ),
      );
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }

  // Unwrap the whole link back to its plain text.
  private remove(view: EditorView) {
    view.dispatch({
      changes: {
        from: this.link.from,
        to: this.link.braceTo,
        insert: this.link.text,
      },
    });
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

const LINK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const X_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

const linkTheme = EditorView.baseTheme({
  // Inherits the link pill look from `.cm-doc-link`; only undoes the native
  // button chrome.
  ".cm-doc-link-button": {
    font: "inherit",
    padding: "1px 2px",
    border: "none",
    cursor: "pointer",
  },
  ".cm-doc-link-button:hover": { background: "rgba(37, 99, 235, 0.25)" },
  // The `[text]` of a link pointing at a selected shape, matching the blue
  // selection outline the shape gets on the canvas.
  ".cm-doc-link-selected": {
    background: "rgba(37, 99, 235, 0.16)",
    borderRadius: "3px",
  },
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
  // An armed link, matching the amber of the in-flight arrows on the canvas.
  ".cm-doc-link-active": {
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
  ".cm-doc-link-remove:hover": { color: "#dc2626" },
});
