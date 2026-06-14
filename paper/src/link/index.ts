import {
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
  type Command,
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
import { outlinePoints } from "../surface/geometry";
import type { Point, Shape, SurfaceState } from "../surface/types";

// Links from a text selection to shapes on a paper surface, written into the
// document as `[text]{automerge:url@dx:dy,...}`. The `{...}` span renders as a
// small circle widget; clicking it "focuses" the link and the editor itself
// draws the arrows to the targets (and, while drawing, to the cursor) on a
// body-mounted overlay above the canvas.
//
// Everything lives here, in the editor, on purpose: the link is the editor's
// own concept, so no link-specific state is published to any shared provider.
// The editor only *reads* the generic surface providers it already uses —
// `surface:state` (the stamped pointer: what shape is under the cursor, whether
// it is pressed) to drive hover/picking, and `surface:position` (a shape's
// screen-space center) to anchor the arrows — and writes its targets straight
// back into its own text. A focused link is either *drawing* (a live line
// follows the cursor; pressing a shape appends it, pressing empty canvas drops
// the live line back to expanded) or *expanded* (the existing lines show and
// each is clickable to delete). The session ends on a press that is neither the
// circle, an arrow, nor the canvas (a "blur"), or on Escape.

// The patchwork registration: a single CodeMirror extension. (No canvas tool —
// the editor owns the arrows now.)
export const plugins = [
  {
    type: "codemirror:extension",
    id: "paper-doc-links",
    name: "Paper Document Links",
    supportedDatatypes: ["essay", "markdown"],
    async load(): Promise<Extension> {
      return paperDocLinks();
    },
  },
];

function paperDocLinks(): Extension {
  return [
    activeLinkField,
    focusBridge,
    selectedTargets,
    linkButton,
    linkDecorations,
    linkHighlights,
    linkKeymap,
    linkTheme,
  ];
}

// "drawing": a live line follows the cursor and clicking a shape appends it.
// "expanded": the link's existing lines are shown and clickable for deletion.
type LinkMode = "drawing" | "expanded";

// One link target: the shape's url plus the anchor offset (screen delta from
// the shape's footprint center to where the line should land — the first point
// the line crossed the outline when it was picked). Persisted in the text so
// the line keeps hitting the same spot as the shape moves.
type Target = { url: AutomergeUrl; offset?: Point };

// The slice of the generic focus doc this feature reads/writes: shape selection
// (mirrored into link highlights) and highlight (set as the caret enters a
// link). Both are app-wide vocabulary, not link concepts.
type FocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
};

// The focused link as the editor sees it: the left-bracket position (mapped
// through edits) and the current mode. Kept in a state field so the widget
// decorations rebuild when focus or mode changes.
type ActiveState = { pos: number; mode: LinkMode };

const setActiveLink = StateEffect.define<ActiveState | null>();

const activeLinkField = StateField.define<ActiveState | null>({
  create: () => null,
  update(value, tr) {
    if (value) value = { pos: tr.changes.mapPos(value.pos), mode: value.mode };
    for (const effect of tr.effects) {
      if (effect.is(setActiveLink)) value = effect.value;
    }
    return value;
  },
});

// The per-editor hub. A CodeMirror plugin is not a Solid component, but it owns
// `view.dom`, which sits under the frame's providers once mounted, so it talks
// to them with the raw bubbling-event protocol. It owns the whole link
// lifecycle: focusing a link, switching mode, drawing the arrows on the
// overlay, reading the surface pointer for hover/picking, writing targets back
// into the braces, blurring on an outside press, and writing `focus.highlight`
// as the cursor enters automerge links.
const focusBridge = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    private focusHandle: DocHandle<FocusDoc> | undefined;
    private stateHandle: DocHandle<SurfaceState> | undefined;
    private unsubscribeFocus: (() => void) | undefined;
    private unsubscribeState: (() => void) | undefined;
    private destroyed = false;
    private lastHighlightKey = "";
    private lastSelectedKey = "";

    // Identity of this editor's focused link; null while none is focused.
    private sourceId: string | null = null;
    // Shape urls the link is nested inside (its containing embeds) — never
    // linkable, so a document can't point at a shape that contains it.
    private excluded: string[] = [];

    // Overlay rendering state.
    private overlay: HTMLDivElement | undefined;
    private glyphStyle: HTMLStyleElement | undefined;
    private frame: number | null = null;
    private cursor: Point | null = null; // screen coordinates
    private wasPressed = false;
    // Live screen positions of target/hovered shapes, from `surface:position`.
    private positions = new Map<
      AutomergeUrl,
      { point: Point | null; unsubscribe: () => void }
    >();
    // Resolved shape handles, for their outline geometry. `null` marks a find
    // in flight so it only fires once.
    private shapes = new Map<AutomergeUrl, DocHandle<Shape> | null>();

    constructor(view: EditorView) {
      this.view = view;
      this.connectWhenMounted();
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.writeHighlight();
    }

    destroy() {
      this.destroyed = true;
      this.deactivate();
      this.unsubscribeFocus?.();
      this.unsubscribeState?.();
      this.focusHandle?.off("change", this.onFocusChange);
      this.stateHandle?.off("change", this.onStateChange);
    }

    // The circle was clicked. Walk the focus ladder: an unfocused link focuses
    // (empty -> drawing, linked -> expanded); expanded -> drawing; drawing ->
    // expanded when it has targets, else blurs.
    onIconClick(link: LinkMatch) {
      const active = this.view.state.field(activeLinkField);
      const isActive = this.sourceId !== null && active?.pos === link.from;
      const hasTargets = parseTargets(link.urls).length > 0;
      if (!isActive) {
        this.activate(link, hasTargets ? "expanded" : "drawing");
      } else if (active!.mode === "expanded") {
        this.setMode("drawing");
      } else if (hasTargets) {
        this.setMode("expanded");
      } else {
        this.deactivate();
      }
    }

    private activate(link: LinkMatch, mode: LinkMode) {
      this.sourceId = this.linkId(link.from);
      this.excluded = this.containerShapeUrls();
      this.view.dispatch({
        effects: setActiveLink.of({ pos: link.from, mode }),
      });

      // Claim the tool slot under a stable, link-specific id so other tools
      // (e.g. select) stand down. Cleared on blur; SelectButton reclaims the
      // empty slot as the default tool.
      this.stateHandle?.change((state) => {
        state.selectedToolId = `link:${this.sourceId}`;
      });

      this.wasPressed = this.stateHandle?.doc()?.pointer?.isPressed ?? false;
      this.ensureOverlay();
      this.addListeners();
      this.startRenderLoop();
    }

    private setMode(mode: LinkMode) {
      const pos = this.activePos();
      if (pos === null) return;
      this.view.dispatch({ effects: setActiveLink.of({ pos, mode }) });
    }

    // Tear down the whole session.
    private deactivate() {
      const hadFocus = this.sourceId !== null;
      const sourceId = this.sourceId;
      this.sourceId = null;
      this.excluded = [];
      this.removeListeners();
      this.stopRenderLoop();
      this.removeOverlay();
      this.clearSubscriptions();
      if (hadFocus && !this.destroyed) {
        this.view.dispatch({ effects: setActiveLink.of(null) });
      }
      if (sourceId !== null) {
        this.stateHandle?.change((state) => {
          if (state.selectedToolId === `link:${sourceId}`) {
            state.selectedToolId = "";
          }
        });
      }
    }

    // A press that isn't the circle, an arrow, or the canvas ends the session.
    // Native focus/blur can't be used: pressing a shape to pick it moves DOM
    // focus off the button too, so the pointer-down target is inspected
    // instead. Canvas presses (picks, empty-clicks) and arrow presses (line
    // deletes) keep the session; presses into editor text or other UI blur it.
    private onGlobalPointerDown = (event: PointerEvent) => {
      if (this.sourceId === null) return;
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".cm-doc-link")) return;
      if (target.closest(".link-arrow-overlay")) return;
      if (target.closest(".cm-editor")) {
        this.deactivate();
        return;
      }
      if (target.closest("[data-surface-root]")) return;
      this.deactivate();
    };

    private onPointerMove = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      this.cursor = { x: event.clientX, y: event.clientY };
    };

    private onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.sourceId !== null) this.deactivate();
    };

    private addListeners() {
      window.addEventListener("pointerdown", this.onGlobalPointerDown, true);
      window.addEventListener("pointermove", this.onPointerMove, true);
      window.addEventListener("keydown", this.onKeyDown, true);
    }

    private removeListeners() {
      window.removeEventListener("pointerdown", this.onGlobalPointerDown, true);
      window.removeEventListener("pointermove", this.onPointerMove, true);
      window.removeEventListener("keydown", this.onKeyDown, true);
    }

    // --- picking, driven by the stamped surface pointer --------------------

    // The surface stamps each pointer sample with what's under it; we react to
    // pressed transitions. While drawing, a press on a new allowed shape
    // appends it (staying in drawing so several can be added in a row); a press
    // on empty canvas drops the live line back to expanded.
    private onStateChange = () => {
      if (this.sourceId === null) return;
      const pointer = this.stateHandle?.doc()?.pointer;
      if (!pointer) {
        this.wasPressed = false;
        return;
      }
      const startedPress = !this.wasPressed && pointer.isPressed;
      this.wasPressed = pointer.isPressed;
      if (!startedPress) return;
      if (this.activeMode() !== "drawing") return;

      const url = pointer.shapeUrl;
      if (!url || this.excluded.includes(url)) {
        this.setMode("expanded");
        return;
      }
      const link = this.currentLink();
      if (!link) return;
      const targets = parseTargets(link.urls);
      if (targets.some((t) => t.url === url)) return;
      const offset = this.crossingFor(
        url,
        this.sourcePoint(),
        this.cursor,
      )?.offset;
      this.writeTargets(link, [...targets, { url, offset }]);
    };

    private removeTarget(url: string) {
      const link = this.currentLink();
      if (!link) return;
      this.writeTargets(
        link,
        parseTargets(link.urls).filter((t) => t.url !== url),
      );
    }

    // Rewrite the `{...}` body to `targets`, leaving the rest of the token (and
    // the caret, which sits before the braces) untouched.
    private writeTargets(link: LinkMatch, targets: Target[]) {
      const body = serializeTargets(targets);
      if (body === link.urls) return;
      const urlsFrom = link.braceFrom + 1;
      this.view.dispatch({
        changes: {
          from: urlsFrom,
          to: urlsFrom + link.urls.length,
          insert: body,
        },
      });
    }

    // --- the overlay -------------------------------------------------------

    private ensureOverlay() {
      if (this.overlay) return;
      ensureArrowStyles();
      const overlay = document.createElement("div");
      overlay.className = "link-arrow-overlay";
      // One delegated handler: a press on an arrow's hit-line deletes it.
      overlay.addEventListener("click", (event) => {
        const group = (event.target as Element | null)?.closest(
          "[data-link-target]",
        );
        const url = group?.getAttribute("data-link-target");
        if (url) this.removeTarget(url);
      });
      document.body.appendChild(overlay);
      this.overlay = overlay;

      const style = document.createElement("style");
      document.head.appendChild(style);
      this.glyphStyle = style;
    }

    private removeOverlay() {
      this.overlay?.remove();
      this.overlay = undefined;
      this.glyphStyle?.remove();
      this.glyphStyle = undefined;
    }

    private startRenderLoop() {
      if (this.frame !== null) return;
      const tick = () => {
        this.frame = null;
        if (this.destroyed || this.sourceId === null) return;
        this.renderFrame();
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }

    private stopRenderLoop() {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
        this.frame = null;
      }
    }

    // Redraw the arrows from current geometry. Runs every frame while focused,
    // so the lines follow the token (typing, scrolling, the embed being
    // dragged), the targets (shapes moving), and the cursor (while drawing)
    // without wiring an observer to each.
    private renderFrame() {
      const overlay = this.overlay;
      if (!overlay) return;
      const link = this.currentLink();
      if (!link) {
        // The link text was deleted out from under us.
        this.deactivate();
        return;
      }
      const from = this.sourcePoint();
      const mode = this.activeMode();
      const targets = parseTargets(link.urls);

      const drawing = mode === "drawing";
      const hovered = drawing ? this.hoveredUrl() : undefined;
      const needed = new Set<AutomergeUrl>(targets.map((t) => t.url));
      if (hovered) needed.add(hovered);
      this.syncSubscriptions(needed);

      const parts: string[] = [];
      if (from) {
        for (const target of targets) {
          const center = this.positions.get(target.url)?.point;
          if (!center) continue;
          const end = target.offset
            ? { x: center.x + target.offset.x, y: center.y + target.offset.y }
            : center;
          parts.push(
            `<g class="link-arrow-target" data-link-target="${target.url}">` +
              line("link-arrow-line link-arrow-committed", from, end) +
              (mode === "expanded" ? line("link-arrow-hit", from, end) : "") +
              `</g>`,
          );
        }
        if (drawing) {
          const crossing = hovered
            ? this.crossingFor(hovered, from, this.cursor)
            : null;
          const end = crossing?.point ?? this.cursor;
          if (end) {
            const cls =
              "link-arrow-line link-arrow-live" +
              (crossing ? " link-arrow-snapped" : "");
            parts.push(line(cls, from, end));
          }
        }
      }
      overlay.innerHTML = parts.length ? `<svg>${parts.join("")}</svg>` : "";

      // Glow the hovered shape, the same hook the selection overlay uses.
      const glyphStyle = this.glyphStyle;
      if (glyphStyle) {
        glyphStyle.textContent = hovered
          ? `[data-automerge-url="${hovered}"] { filter: ${HOVER_GLOW}; }`
          : "";
      }
    }

    // The shape under the cursor, excluding container shapes. Only meaningful
    // while drawing.
    private hoveredUrl(): AutomergeUrl | undefined {
      const url = this.stateHandle?.doc()?.pointer?.shapeUrl;
      if (!url || this.excluded.includes(url)) return undefined;
      return url;
    }

    // Where a line from `from` toward `toward` first crosses `url`'s outline,
    // in screen space, plus the offset (from the shape's footprint center) to
    // persist. Built from the shape's stored outline anchored at its screen
    // center, so it follows the real outline, not a bounding box. Null until
    // both the outline and the center are known, or when the line misses.
    private crossingFor(
      url: AutomergeUrl,
      from: Point | null,
      toward: Point | null,
    ): { point: Point; offset: Point } | null {
      if (!from || !toward) return null;
      const center = this.positions.get(url)?.point;
      const shape = this.shapes.get(url)?.doc();
      if (!center || !shape) return null;
      const outline = screenOutline(shape, center);
      const closed = shape.outline.type !== "line";
      const point = firstCrossing(from, toward, outline, closed);
      if (!point) return null;
      return {
        point,
        offset: { x: point.x - center.x, y: point.y - center.y },
      };
    }

    // Keep one `surface:position` subscription and one shape handle per needed
    // url; drop the rest.
    private syncSubscriptions(needed: Set<AutomergeUrl>) {
      for (const [url, entry] of this.positions) {
        if (!needed.has(url)) {
          entry.unsubscribe();
          this.positions.delete(url);
        }
      }
      for (const url of needed) {
        if (!this.positions.has(url)) {
          const unsubscribe = subscribe<Point>(
            this.view.dom,
            { type: "surface:position", url },
            (point) => {
              const entry = this.positions.get(url);
              if (entry) entry.point = point;
            },
          );
          this.positions.set(url, { point: null, unsubscribe });
        }
        if (!this.shapes.has(url)) {
          this.shapes.set(url, null);
          const repo = getRepo();
          if (repo) {
            void Promise.resolve(repo.find<Shape>(url))
              .then((handle) => this.shapes.set(url, handle))
              .catch(() => this.shapes.delete(url));
          }
        }
      }
    }

    private clearSubscriptions() {
      for (const entry of this.positions.values()) entry.unsubscribe();
      this.positions.clear();
      this.shapes.clear();
    }

    // --- helpers -----------------------------------------------------------

    private activePos(): number | null {
      return this.view.state.field(activeLinkField)?.pos ?? null;
    }

    private activeMode(): LinkMode | null {
      return this.view.state.field(activeLinkField)?.mode ?? null;
    }

    private currentLink(): LinkMatch | undefined {
      const pos = this.activePos();
      if (pos === null) return undefined;
      return findLinks(this.view.state.doc.toString()).find(
        (l) => l.from === pos,
      );
    }

    // A stable id for the link at `from`: its document url plus the bracket
    // offset. Deterministic, so re-renders and re-activations agree, and two
    // editors can't collide on the shared tool slot.
    private linkId(from: number): string {
      const docUrl =
        this.view.dom.closest("patchwork-view")?.getAttribute("doc-url") ?? "";
      return `${docUrl}:${from}`;
    }

    private containerShapeUrls(): string[] {
      const urls: string[] = [];
      let el: Element | null = this.view.dom.parentElement;
      while (el) {
        const host = el.closest("[data-automerge-url]");
        if (!host) break;
        const url = host.getAttribute("data-automerge-url");
        if (url) urls.push(url);
        el = host.parentElement;
      }
      return urls;
    }

    // The screen position lines start from: the center of the focused link's
    // token (its node — the blue dot — when expanded into a pill). Measured off
    // the rendered element so it tracks exactly. Null while the widget isn't in
    // the DOM (e.g. scrolled out of the viewport).
    private sourcePoint(): Point | null {
      const token = this.view.dom.querySelector<HTMLElement>(
        ".cm-doc-link-active",
      );
      if (!token) return null;
      const node = token.querySelector<HTMLElement>(".cm-doc-link-node");
      const anchor =
        node && node.getBoundingClientRect().width > 0 ? node : token;
      const rect = anchor.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    // --- provider plumbing -------------------------------------------------

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

    private adoptFocusHandle(url: AutomergeUrl) {
      if (this.focusHandle) return;
      const repo = getRepo();
      if (!repo) return;
      void Promise.resolve(repo.find<FocusDoc>(url)).then((handle) => {
        if (this.destroyed) return;
        this.focusHandle = handle;
        handle.on("change", this.onFocusChange);
        this.syncSelectedTargets();
      });
    }

    private adoptStateHandle(url: AutomergeUrl) {
      if (this.stateHandle) return;
      const repo = getRepo();
      if (!repo) return;
      void Promise.resolve(repo.find<SurfaceState>(url)).then((handle) => {
        if (this.destroyed) return;
        this.stateHandle = handle;
        handle.on("change", this.onStateChange);
      });
    }

    // Deferred a tick: this fires synchronously from inside the focus doc's own
    // `change()`, and the dispatch below can make codemirror-base write
    // `focus.selection` straight back — a re-entrant change on the same doc,
    // which trips automerge's wasm borrow. After the microtask the original
    // change has unwound.
    private onFocusChange = () => {
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.syncSelectedTargets();
      });
    };

    // Push the current shape selection into editor state so links pointing at a
    // selected target render highlighted (`linkHighlights`).
    private syncSelectedTargets() {
      const targets = selectedShapeUrls(this.focusHandle?.doc());
      const key = targets.join(",");
      if (key === this.lastSelectedKey) return;
      this.lastSelectedKey = key;
      this.view.dispatch({ effects: setSelectedTargets.of(targets) });
    }

    // Write `focus.highlight` as the cursor enters/leaves a link, deferred out
    // of the CodeMirror update cycle (re-entrant focus-doc writes otherwise
    // trip automerge's wasm borrow).
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

function getRepo(): Repo | undefined {
  return (window as Window & { repo?: Repo }).repo;
}

// Selected urls a link can point at: everything except text ranges. A text
// range url ends in a cursor segment (`automerge:<id>/content/[a-b]`); a shape
// url ends in a key segment (`automerge:<id>/shapes/<uuid>`).
function selectedShapeUrls(doc: FocusDoc | undefined): AutomergeUrl[] {
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

// Just the urls of a `{...}` body, dropping any `@dx:dy` offset suffix.
function parseLinkUrls(urlPart: string): AutomergeUrl[] {
  return parseTargets(urlPart).map((target) => target.url);
}

// The full targets of a `{...}` body: comma-separated `url` or `url@dx:dy`
// entries. Offsets use `:` (and entries `,`), neither of which appears in an
// automerge url, so both separators are unambiguous.
function parseTargets(urlPart: string): Target[] {
  const targets: Target[] = [];
  for (const entry of urlPart.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("@");
    const url = at === -1 ? trimmed : trimmed.slice(0, at);
    if (!isValidAutomergeUrl(url)) continue;
    let offset: Point | undefined;
    if (at !== -1) {
      const [dx, dy] = trimmed.slice(at + 1).split(":");
      const x = Number(dx);
      const y = Number(dy);
      if (Number.isFinite(x) && Number.isFinite(y)) offset = { x, y };
    }
    targets.push({ url, offset });
  }
  return targets;
}

function serializeTargets(targets: Target[]): string {
  return targets
    .map((target) =>
      target.offset
        ? `${target.url}@${Math.round(target.offset.x)}:${Math.round(target.offset.y)}`
        : target.url,
    )
    .join(",");
}

// The shape selection mirrored into editor state by the focus bridge.
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

// Backspace just after a link circle, or Delete just before it, removes the
// whole `[text]{urls}` at once (leaving the plain text) — so the token deletes
// atomically rather than peeling off the braces and stranding the brackets.
const linkKeymap = Prec.high(
  keymap.of([
    { key: "Backspace", run: deleteAdjacentLink(-1) },
    { key: "Delete", run: deleteAdjacentLink(1) },
  ]),
);

function deleteAdjacentLink(dir: -1 | 1): Command {
  return (view) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const link = findLinks(view.state.doc.toString()).find((l) =>
      dir === -1 ? sel.head === l.braceTo : sel.head === l.braceFrom,
    );
    if (!link) return false;
    view.dispatch({
      changes: { from: link.from, to: link.braceTo, insert: link.text },
      selection: { anchor: link.from + link.text.length },
    });
    return true;
  };
}

// The "make this a link" button: an inline circle at the end of any non-empty
// text selection. Hidden while the selection overlaps an existing link.
// Pressing it wraps the selection as an empty link and focuses it straight into
// drawing, so the line starts following the mouse right away.
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
    const button = makeToken("Link selection");
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
  // Focus the freshly written (empty) link so it drops straight into drawing.
  const link = findLinks(view.state.doc.toString()).find(
    (l) => l.from === sel.from,
  );
  if (link) view.plugin(focusBridge)?.onIconClick(link);
  view.focus();
}

// Replaces each link's `{...}` span with the circle widget, falling back to raw
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
        update.startState.field(activeLinkField) !==
          update.state.field(activeLinkField)
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
  const active = view.state.field(activeLinkField);
  const ranges: Range<Decoration>[] = [];
  for (const link of findLinks(view.state.doc.toString())) {
    if (sel.from < link.braceTo && sel.to > link.braceFrom) continue;
    const mode = active?.pos === link.from ? active.mode : null;
    ranges.push(
      Decoration.replace({ widget: new LinkWidget(link, mode) }).range(
        link.braceFrom,
        link.braceTo,
      ),
    );
  }
  return Decoration.set(ranges, true);
}

// Marks the `[text]` of every link pointing at a currently selected shape,
// mirroring the canvas selection back into the editor.
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

// The rendered link control, in one of three static states:
//   - empty:             a grey circle holding the glyph;
//   - linked, unfocused: the same circle in blue;
//   - linked, focused:   a pill — the glyph on the left, a blue node on the
//                        right (the node is where the lines start).
// An empty link that is focused (drawing) keeps the empty look. Clicking the
// control walks the focus ladder.
class LinkWidget extends WidgetType {
  constructor(
    private readonly link: LinkMatch,
    private readonly mode: LinkMode | null,
  ) {
    super();
  }

  eq(other: LinkWidget) {
    return (
      other.link.urls === this.link.urls &&
      other.link.from === this.link.from &&
      other.link.braceTo === this.link.braceTo &&
      this.state() === other.state()
    );
  }

  // The three visual states collapse drawing/expanded into one "focused" look,
  // so the DOM only rebuilds when the appearance actually changes.
  private state(): "empty" | "linked" | "pill" {
    const linked = parseLinkUrls(this.link.urls).length > 0;
    if (this.mode && linked) return "pill";
    return linked ? "linked" : "empty";
  }

  toDOM(view: EditorView) {
    const count = parseLinkUrls(this.link.urls).length;
    const title =
      count === 0
        ? "Link to shapes"
        : `${count} linked ${count === 1 ? "target" : "targets"}`;
    const token = makeToken(title);
    const state = this.state();
    if (state === "linked") token.classList.add("cm-doc-link-linked");
    if (state === "pill") token.classList.add("cm-doc-link-pill");
    if (this.mode) token.classList.add("cm-doc-link-active");
    token.addEventListener("click", () =>
      view.plugin(focusBridge)?.onIconClick(this.link),
    );
    return token;
  }

  ignoreEvent() {
    return true;
  }
}

// The shared control: a flex box (plain HTML) holding the glyph and a node. By
// default only the glyph shows, centered in the box; the `cm-doc-link-pill`
// state reveals the node beside it. mousedown is swallowed so a press in the
// editor's DOM doesn't collapse the selection or move the caret before the
// click lands.
function makeToken(title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-doc-link cm-doc-link-token";
  button.title = title;
  button.appendChild(makeGlyph());
  const node = document.createElement("span");
  node.className = "cm-doc-link-node";
  button.appendChild(node);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  return button;
}

// A small chain-link glyph (the Feather "link-2" icon).
function makeGlyph(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "cm-doc-link-glyph");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const parts: [string, Record<string, string>][] = [
    ["path", { d: "M9 17H7A5 5 0 0 1 7 7h2" }],
    ["path", { d: "M15 7h2a5 5 0 0 1 0 10h-2" }],
    ["line", { x1: "8", y1: "12", x2: "16", y2: "12" }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs))
      el.setAttribute(name, value);
    svg.appendChild(el);
  }
  return svg;
}

const BOX = 16;

const linkTheme = EditorView.baseTheme({
  // State 1 (empty): a grey circle, just big enough for the glyph.
  ".cm-doc-link-token": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "text-bottom",
    boxSizing: "border-box",
    height: `${BOX}px`,
    width: `${BOX}px`,
    margin: "0 2px",
    padding: "0",
    border: "1.5px solid #94a3b8",
    borderRadius: "50%",
    background: "transparent",
    color: "#94a3b8",
    cursor: "pointer",
    lineHeight: "0",
  },
  ".cm-doc-link-glyph": {
    width: "10px",
    height: "10px",
    display: "block",
    flex: "0 0 auto",
    pointerEvents: "none",
  },
  // The pill's right-hand node; hidden until the pill state reveals it.
  ".cm-doc-link-node": { display: "none" },
  ".cm-doc-link-token:hover": { borderColor: "#1d4ed8" },
  // State 2 (linked, unfocused): the circle turns solid blue with a white glyph.
  ".cm-doc-link-linked": {
    borderColor: "#2563eb",
    background: "#2563eb",
    color: "#fff",
  },
  // State 3 (linked, focused): a grey pill with the glyph on the left and a
  // blue node on the right (the line anchor).
  ".cm-doc-link-pill": {
    width: "auto",
    gap: "5px",
    padding: "0 6px",
    borderColor: "#94a3b8",
    background: "transparent",
    color: "#94a3b8",
    borderRadius: "999px",
  },
  ".cm-doc-link-pill .cm-doc-link-node": {
    display: "block",
    width: "13px",
    height: "13px",
    borderRadius: "50%",
    background: "#2563eb",
    flex: "0 0 auto",
  },
  // The `[text]` of a link pointing at a selected shape, matching the blue
  // selection outline the shape gets on the canvas.
  ".cm-doc-link-selected": {
    background: "rgba(37, 99, 235, 0.16)",
    borderRadius: "3px",
  },
});

// --- arrow overlay rendering ------------------------------------------------

const HOVER_GLOW =
  "drop-shadow(0 0 3px rgba(37, 99, 235, 0.95)) " +
  "drop-shadow(0 0 6px rgba(37, 99, 235, 0.6))";

// The overlay's stylesheet lives outside the editor (it is body-mounted, above
// the canvas), so it is injected once on its own rather than through the editor
// theme. Idempotent.
const ARROW_STYLE_ID = "paper-link-arrow-styles";

function ensureArrowStyles() {
  if (document.getElementById(ARROW_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = ARROW_STYLE_ID;
  style.textContent = `
.link-arrow-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483640;
}
.link-arrow-overlay svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.link-arrow-line { fill: none; }
.link-arrow-committed { stroke: #2563eb; stroke-width: 2; }
.link-arrow-live {
  stroke: #94a3b8;
  stroke-width: 2;
  stroke-dasharray: 6 4;
}
.link-arrow-live.link-arrow-snapped {
  stroke: #2563eb;
  stroke-dasharray: none;
}
.link-arrow-hit {
  stroke: transparent;
  stroke-width: 14;
  fill: none;
  pointer-events: stroke;
  cursor: pointer;
}
.link-arrow-target:hover .link-arrow-committed { stroke: #dc2626; }
`;
  document.head.appendChild(style);
}

function line(cls: string, from: Point, to: Point): string {
  return `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
}

// --- geometry ---------------------------------------------------------------

// A shape's outline in screen space: its local outline points re-centered on
// the shape's screen footprint center (what `surface:position` reports). The
// shape's own origin cancels out, so this needs only the outline and the
// center — no per-axis scale, which is exact on paper (no zoom) and a good
// approximation elsewhere.
function screenOutline(shape: Shape, center: Point): Point[] {
  const points = outlinePoints(shape.outline);
  const bbox = bboxCenter(points);
  return points.map((p) => ({
    x: center.x + (p.x - bbox.x),
    y: center.y + (p.y - bbox.y),
  }));
}

function bboxCenter(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// The point on `outline` nearest `from` where the segment `from`->`toward`
// first crosses it, or null when it doesn't.
function firstCrossing(
  from: Point,
  toward: Point,
  outline: Point[],
  closed: boolean,
): Point | null {
  if (outline.length < 2) return null;
  const edges = closed ? outline.length : outline.length - 1;
  let nearest: Point | null = null;
  let nearestDist = Infinity;
  for (let i = 0; i < edges; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const hit = segmentIntersection(from, toward, a, b);
    if (!hit) continue;
    const dist = Math.hypot(hit.x - from.x, hit.y - from.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = hit;
    }
  }
  return nearest;
}

// Intersection point of segments p1p2 and p3p4, or null if they don't cross.
function segmentIntersection(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): Point | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}
