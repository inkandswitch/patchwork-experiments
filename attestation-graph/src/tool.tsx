import {
  For,
  type JSX,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import { type Compare, useCompare } from "./compare";
import { type CellRef, cellIdsOn, cellRefUrl, cellsTargeted, threadsByCell, urlsKey } from "./comments";
import { useComments } from "./use-comments";
import { DEFAULT_TITLE } from "./datatype";
import { type Change, type CellDiff, type Mark, attribute, diffCells, diffPages } from "./diff";
import { wordDiff } from "./worddiff";
import { parseDrawio, serializeDrawio } from "./drawio";
import {
  type BlockKind,
  type Cell,
  type Choices,
  type Diagram,
  type GraphDoc,
  type Pt,
  type Rect,
  type VNode,
  type View,
  type ViewState,
  ancestors,
  boundsOf,
  buildGraph,
  computeView,
  escapeHtml,
  evidenceBundles,
  matchesChoices,
  isGate,
  newDiagram,
  plainText,
  routeEdge,
  styleGet,
  toggleChoice,
  uid,
} from "./model";
import {
  addBlock,
  addLabel,
  connect,
  deleteCells,
  insertGraph,
  moveCells,
  pasteCells,
  setTitle,
  setValue,
  toggleTrust,
} from "./ops";
import "./styles.css";

/** The slice of automerge-repo's DocHandle this tool uses. */
type Handle = {
  url: string;
  doc(): GraphDoc | undefined;
  change(fn: (doc: GraphDoc) => void): void;
  on(event: "change", fn: () => void): void;
  off(event: "change", fn: () => void): void;
  /** a handle on a path inside the doc (automerge-repo 2.6+); refs for comments */
  sub?(...segments: unknown[]): { url: string };
  isReadOnly?(): boolean;
};

const EMPTY_VIEW: ViewState = { collapsed: [], zoom: [] };
const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const NO_IDS: { nodes: string[]; edges: string[] } = { nodes: [], edges: [] };

// ------------------------------------------------------------- sanitizing
// Cell labels are HTML (draw.io's html=1) and may come from imported files,
// so only inert formatting tags are ever rendered.

const ALLOWED_TAGS = new Set([
  "B",
  "I",
  "U",
  "S",
  "EM",
  "STRONG",
  "BR",
  "SUB",
  "SUP",
  "DIV",
  "SPAN",
  "P",
  "FONT",
  "CODE",
]);
const DROPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "LINK",
  "META",
  "TITLE",
]);
const sanitizeCache = new Map<string, string>();

function sanitize(html: string): string {
  const hit = sanitizeCache.get(html);
  if (hit !== undefined) return hit;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (DROPPED_TAGS.has(el.tagName.toUpperCase())) {
          el.remove();
          continue;
        }
        walk(el);
        if (!ALLOWED_TAGS.has(el.tagName))
          el.replaceWith(...Array.from(el.childNodes));
        else
          for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      } else if (child.nodeType !== Node.TEXT_NODE) child.remove();
    }
  };
  walk(tpl.content);
  const out = tpl.innerHTML;
  if (sanitizeCache.size > 2000) sanitizeCache.clear();
  sanitizeCache.set(html, out);
  return out;
}

// -------------------------------------------------------------- clipboard
// Copies travel as JSON text on the system clipboard, so they paste into
// another page, document or tab. The last copy is also kept here for when
// the system clipboard can't be read.

const CLIP_TYPE = "attestation-graph/cells";
type Clip = { type: typeof CLIP_TYPE; page: string; cells: Cell[] };
let lastClip: Clip | null = null;

function readClip(text: string | undefined): Clip | null {
  if (text === undefined) return lastClip; // no clipboard access at all
  try {
    const data = JSON.parse(text);
    return data?.type === CLIP_TYPE && Array.isArray(data.cells)
      ? (data as Clip)
      : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ nodes

const fontStyleOf = (n: VNode) => Number(styleGet(n.style, "fontStyle") ?? 0) || 0;

/** A node's box, and the text settings its draw.io style gives it. */
function nodeStyle(n: VNode, rect: Rect): JSX.CSSProperties {
  const st = (key: string) => styleGet(n.style, key);
  const fontStyle = fontStyleOf(n);
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    "font-size": `${n.collapsed ? 12 : Number(st("fontSize") ?? 12) || 12}px`,
    "font-weight": !n.collapsed && fontStyle & 1 ? "700" : undefined,
    "font-style": !n.collapsed && fontStyle & 2 ? "italic" : undefined,
    "text-decoration": !n.collapsed && fontStyle & 4 ? "underline" : undefined,
    "text-align": n.collapsed
      ? "center"
      : ((st("align") ?? "center") as "left" | "center" | "right"),
    // the same, for what hugs the text: a marked label's highlight
    "--attg-align": n.collapsed
      ? "center"
      : st("align") === "left"
        ? "flex-start"
        : st("align") === "right"
          ? "flex-end"
          : "center",
  };
}

function nodeLooks(n: VNode) {
  const st = (key: string) => styleGet(n.style, key);
  return {
    dim: !!st("fontColor"),
    shaded:
      n.kind === "box" &&
      (st("fillColor") ?? "#ffffff").toLowerCase() !== "#ffffff",
    mono: /courier|mono/i.test(st("fontFamily") ?? ""),
  };
}

/**
 * What's inside a node: its shape, caption and text, or the heading and
 * title of a collapsed one. `editor` stands in for the text while editing.
 */
function NodeBody(p: {
  n: VNode;
  editing?: boolean;
  editor?: (html: string) => JSX.Element;
  /** the label with what changed in it marked word by word, in place of its own */
  marked?: string;
}) {
  const st = (key: string) => styleGet(p.n.style, key);
  const shown = () => p.marked ?? sanitize(p.n.html);
  // the editor is made once when editing starts (Show runs it untracked), so
  // changes arriving meanwhile don't replace what's being typed
  const text = (html: () => string, fallback: JSX.Element) => (
    <Show when={p.editing && p.editor} fallback={fallback}>
      {(editor) => editor()(html())}
    </Show>
  );
  return (
    <>
      <Show when={p.n.kind === "or" && !p.n.collapsed}>
        <svg class="ag-diamond" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points="50,0 100,50 50,100 0,50"
            vector-effect="non-scaling-stroke"
          />
        </svg>
      </Show>
      <Show when={p.n.caption}>
        <div class="ag-caption" innerHTML={sanitize(p.n.caption)} />
      </Show>
      <div
        class="ag-content"
        style={{
          "justify-content":
            st("verticalAlign") === "top"
              ? "flex-start"
              : st("verticalAlign") === "bottom"
                ? "flex-end"
                : "center",
          "white-space":
            p.n.collapsed || st("whiteSpace") === "wrap" ? "normal" : "nowrap",
          "padding-left": st("spacingLeft")
            ? `${Number(st("spacingLeft")) + 2}px`
            : undefined,
          "padding-right": st("spacingRight")
            ? `${Number(st("spacingRight")) + 2}px`
            : undefined,
          "padding-top": st("spacingTop")
            ? `${Number(st("spacingTop")) + 2}px`
            : undefined,
        }}
      >
        <Show
          when={p.n.collapsed}
          fallback={text(
            () => p.n.html,
            <div class="ag-html" innerHTML={shown()} />,
          )}
        >
          <div class="ag-heading">{p.n.heading}</div>
          {text(
            () => escapeHtml(p.n.title),
            <div
              class="ag-title"
              data-title
              data-untitled={p.n.title ? undefined : ""}
              title="Double-click to rename"
            >
              {p.n.title || "Untitled"}
            </div>,
          )}
        </Show>
      </div>
    </>
  );
}

/** The path an edge takes between two node boxes, as SVG. */
function edgeD(src: Rect, dst: Rect, style: string, points: Pt[]): string {
  return routeEdge(src, dst, style, points)
    .map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`)
    .join(" ");
}

/** An arrowhead marker, drawn with `.ag-arrow`. */
function ArrowMarker(p: { id: string; size: number; path?: boolean }) {
  return (
    <marker
      id={p.id}
      viewBox="0 0 10 10"
      refX="9.5"
      refY="5"
      markerWidth={p.size}
      markerHeight={p.size}
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path
        class="ag-arrow"
        data-path={p.path ? "" : undefined}
        d="M0 0.5 L10 5 L0 9.5 L2.5 5 z"
      />
    </marker>
  );
}

/**
 * Another version of the graph, read-only, laid out in the same world
 * coordinates as the one being edited so the two line up under one
 * viewport. `only` limits it to some cells; `mark` says how each differs.
 */
function StaticGraph(p: {
  view: View;
  only?: { nodes: string[]; edges: string[] };
  mark?: (id: string) => Mark | undefined;
}) {
  const markerId = uid("ag-arrow-");
  const nodeIds = () => p.only?.nodes ?? p.view.nodes.map((n) => n.id);
  const edgeIds = () => p.only?.edges ?? p.view.edges.map((e) => e.id);
  const edgePath = (id: string) => {
    const e = p.view.edgeById.get(id);
    const a = e && p.view.nodeById.get(e.source);
    const b = e && p.view.nodeById.get(e.target);
    return e && a && b ? edgeD(a.rect, b.rect, e.style, e.points) : "";
  };
  return (
    <>
      <svg class="ag-edges">
        <defs>
          <ArrowMarker id={markerId} size={9} />
          <ArrowMarker id={`${markerId}-path`} size={13} path />
        </defs>
        <For each={edgeIds()}>
          {(id) => (
            <g
              class="ag-edge"
              data-edge-id={id}
              data-virtual={p.view.edgeById.get(id)?.virtual ? "" : undefined}
              data-path={p.view.pathEdges.has(id) ? "" : undefined}
              data-diff={p.mark?.(id)?.change}
              data-by={p.mark?.(id)?.by}
            >
              <path
                class="ag-edge-line"
                d={edgePath(id)}
                marker-end={`url(#${markerId}${p.view.pathEdges.has(id) ? "-path" : ""})`}
              />
            </g>
          )}
        </For>
      </svg>
      <For each={nodeIds()}>
        {(id) => (
          <Show when={p.view.nodeById.get(id)}>
            {(n) => (
              <div
                class="ag-node"
                data-node-id={id}
                data-kind={n().kind}
                data-collapsed={n().collapsed ? "" : undefined}
                data-holds={n().collapsed && n().holds ? "" : undefined}
                data-virtual={n().virtual ? "" : undefined}
                data-path={n().onPath ? "" : undefined}
                data-diff={p.mark?.(id)?.change}
                data-by={p.mark?.(id)?.by}
                data-dim={nodeLooks(n()).dim ? "" : undefined}
                data-shaded={nodeLooks(n()).shaded ? "" : undefined}
                data-mono={nodeLooks(n()).mono ? "" : undefined}
                style={nodeStyle(n(), n().rect)}
              >
                <NodeBody n={n()} />
              </div>
            )}
          </Show>
        )}
      </For>
    </>
  );
}

/**
 * The version compared with, beside the one being edited: read-only, but
 * panned and zoomed like it, so both move as one.
 */
function OtherPane(p: {
  view: View;
  transform: string;
  /** the draft it shows */
  name: string;
  /** a merge is looked over: it shows the target before it */
  before: boolean;
  /** the other draft doesn't have this graph */
  missing: boolean;
  /** it has the graph, but not this page */
  absent: boolean;
  focus: boolean;
  mark: (id: string) => Mark | undefined;
  /** what it deleted since the common ancestor, drawn faintly from that */
  ghosts: { view: View; only: { nodes: string[]; edges: string[] } } | null;
  onWheel: (pane: () => HTMLElement) => (e: WheelEvent) => void;
  pan: () => (dx: number, dy: number) => void;
}) {
  let el!: HTMLDivElement;
  let drag: { sx: number; sy: number; to: (dx: number, dy: number) => void } | null = null;
  const [panning, setPanning] = createSignal(false);
  onMount(() => {
    const onWheel = p.onWheel(() => el);
    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => el.removeEventListener("wheel", onWheel));
  });
  const end = (e: PointerEvent) => {
    drag = null;
    setPanning(false);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  return (
    <div
      class="ag-canvas ag-other"
      ref={el}
      data-gesture={panning() ? "pan" : undefined}
      data-focus={p.focus ? "" : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== 1) return;
        el.setPointerCapture(e.pointerId);
        drag = { sx: e.clientX, sy: e.clientY, to: p.pan() };
        setPanning(true);
      }}
      onPointerMove={(e) => drag?.to(e.clientX - drag.sx, e.clientY - drag.sy)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div class="ag-world" style={{ transform: p.transform }}>
        <Show when={p.ghosts?.only.nodes.length || p.ghosts?.only.edges.length ? p.ghosts : null}>
          {(g) => (
            <div class="ag-ghosts">
              <StaticGraph view={g().view} only={g().only} mark={() => ({ change: "deleted" })} />
            </div>
          )}
        </Show>
        <StaticGraph view={p.view} mark={p.mark} />
      </div>
      <Show when={p.missing || p.absent}>
        <div class="ag-empty">
          <strong>
            {p.missing ? `Not in ${draftName(p.name)}` : `This page isn’t in ${draftName(p.name)}`}
          </strong>
        </div>
      </Show>
      <div class="ag-versions">
        <Show when={p.before} fallback={<VersionTag side="theirs" name={p.name} />}>
          <span class="ag-version">Before</span>
        </Show>
      </div>
    </div>
  );
}

/** The swipe line: the other version shows to its right. */
function SwipeDivider(p: { at: number; onMove: (at: number) => void }) {
  let el!: HTMLDivElement;
  const moveTo = (clientX: number) => {
    const box = el.parentElement!.getBoundingClientRect();
    if (box.width) p.onMove(clamp((clientX - box.left) / box.width, 0, 1));
  };
  return (
    <div
      ref={el}
      class="ag-swipe"
      role="slider"
      aria-label="Swipe between this version and the one compared with"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(p.at * 100)}
      tabindex="0"
      style={{ left: `${p.at * 100}%` }}
      onPointerDown={(e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (el.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
      }}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        p.onMove(clamp(p.at + step, 0, 1));
      }}
    />
  );
}

/** Which draft a pane shows: its colour, as the panel shows it, and its name if it has one. */
function VersionTag(p: { side: "ours" | "theirs"; name: string }) {
  const fallback = () => (p.side === "ours" ? "this draft" : "the compared draft");
  return (
    <span class="ag-version" data-side={p.side} title={p.name || fallback()}>
      <span class="ag-version-dot" aria-label={p.name ? undefined : fallback()} />
      {p.name}
    </span>
  );
}

/** The compared draft's name in a sentence. */
const draftName = (name: string | undefined) => name || "the compared draft";

// ------------------------------------------------------------------ tool

export default function AttestationGraphTool(
  handle: Handle,
  element: HTMLElement,
) {
  return render(() => <App handle={handle} element={element} />, element);
}

type Gesture =
  | {
      type: "pan";
      sx: number;
      sy: number;
      x0: number;
      y0: number;
      moved: boolean;
      background: boolean;
    }
  | {
      type: "node";
      id: string;
      sx: number;
      sy: number;
      moved: boolean;
      shift: boolean;
      onTitle: boolean;
    }
  | { type: "fold"; id: string }
  | { type: "edge"; id: string }
  | { type: "connect"; from: string };

function App(props: { handle: Handle; element: HTMLElement }) {
  const handle = props.handle;
  const markerId = uid("ag-arrow-");

  // ---- document
  const [doc, setDoc] = createSignal<GraphDoc | undefined>(handle.doc(), {
    equals: false,
  });
  const onChange = () => setDoc(handle.doc());
  handle.on("change", onChange);
  onCleanup(() => handle.off("change", onChange));

  const diagrams = () => doc()?.diagrams ?? [];
  const [pageId, setPageId] = createSignal<string | null>(null);

  // ---- the version compared with, when the panel compares drafts
  const compare = useCompare(props.element, handle);
  const otherPages = () => compare()?.other.diagrams ?? [];
  const basePages = () => compare()?.base.diagrams ?? [];
  /** a page this version hasn't: one the other added, or this one deleted, picked to see what was there */
  const isGhostPage = (id: string | null) =>
    !!id &&
    !!compare() &&
    !diagrams().some((d) => d.id === id) &&
    (otherPages().some((d) => d.id === id) || basePages().some((d) => d.id === id));

  const diagram = createMemo<Diagram | undefined>(() => {
    const id = pageId();
    return (
      diagrams().find((d) => d.id === id) ??
      (isGhostPage(id) ? undefined : diagrams()[0])
    );
  });
  const onGhostPage = () => !diagram() && isGhostPage(pageId());
  /** the other version's copy of the page shown, if it has one */
  const otherDiagram = createMemo<Diagram | undefined>(() => {
    const id = diagram()?.id ?? pageId();
    return otherPages().find((d) => d.id === id);
  });
  /** the common ancestor's copy of the page shown, if it had one */
  const baseDiagram = createMemo<Diagram | undefined>(() => {
    const id = diagram()?.id ?? pageId();
    return basePages().find((d) => d.id === id);
  });
  /** what each version did to the pages since the common ancestor */
  const pageDiffs = createMemo(() => {
    const c = compare();
    return {
      ours: c ? diffPages(doc(), c.base) : new Map<string, Change>(),
      theirs: c ? diffPages(c.other, c.base) : new Map<string, Change>(),
    };
  });
  /**
   * A page tab's mark: what either version did to the page since the
   * ancestor; combined, by which draft too.
   */
  const pageMark = (id: string): Mark | undefined => {
    if (!compare()) return undefined;
    const { ours, theirs } = pageDiffs();
    const mark = attribute(ours.get(id), theirs.get(id));
    return mark && (mode() === "inline" ? mark : { change: mark.change });
  };
  /** tabs for the pages this version hasn't: added by the other, or deleted here */
  const ghostPages = () => {
    const seen = new Set(diagrams().map((d) => d.id));
    const out: Diagram[] = [];
    for (const d of [...otherPages(), ...basePages()])
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
      }
    return out;
  };
  /** what a page this version hasn't is */
  const ghostPageNote = (id: string | null) =>
    otherPages().some((d) => d.id === id)
      ? `Only in ${draftName(compare()?.theirs)}`
      : "Deleted in this draft";
  /** what each version did to the page shown since the common ancestor */
  const cellDiffs = createMemo<{ ours: CellDiff; theirs: CellDiff } | null>(() => {
    if (!compare()) return null;
    const base = baseDiagram()?.cells ?? [];
    return {
      ours: diffCells(diagram()?.cells ?? [], base),
      theirs: diffCells(otherDiagram()?.cells ?? [], base),
    };
  });

  /** Run an edit against the current page inside one change; false if there's no page to edit. */
  const mutate = (fn: (dg: Diagram, d: GraphDoc) => void): boolean => {
    if (onGhostPage()) {
      setStatus({
        text: `${ghostPageNote(pageId())}: there’s nothing here to edit.`,
        tone: "error",
      });
      return false;
    }
    const id = diagram()?.id;
    handle.change((d) => {
      if (!d.diagrams) d.diagrams = [];
      let dg = d.diagrams.find((x) => x.id === id);
      if (!dg) {
        d.diagrams.push(newDiagram("Page-1"));
        dg = d.diagrams[d.diagrams.length - 1];
      }
      fn(dg, d);
    });
    return true;
  };

  // ---- view state (collapse / zoom): per viewer, remembered locally
  const storageKey = `attestation-graph:view:${handle.url}`;
  const loadStates = (): Record<string, ViewState> => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const [viewStates, setViewStates] =
    createSignal<Record<string, ViewState>>(loadStates());
  const viewState = (): ViewState => {
    const s = viewStates()[diagram()?.id ?? ""];
    return s && Array.isArray(s.collapsed) && Array.isArray(s.zoom)
      ? s
      : EMPTY_VIEW;
  };
  const updateViewState = (fn: (s: ViewState) => ViewState) => {
    const id = diagram()?.id;
    if (!id) return;
    const next = { ...viewStates(), [id]: fn(viewState()) };
    setViewStates(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* private mode etc: view state just isn't remembered */
    }
  };

  // ---- evidence bundles: every valid path; hovering one previews it
  const [preview, setPreview] = createSignal<Choices | null>(null);
  const bundleTable = createMemo(() =>
    evidenceBundles(buildGraph(diagram()?.cells ?? [])),
  );
  const bundlesOpen = () => !!viewState().bundles;
  const toggleBundles = () => {
    setPreview(null);
    updateViewState((s) => ({ ...s, bundles: !s.bundles }));
  };
  const chooseBundle = (choices: Choices) =>
    updateViewState((s) => ({ ...s, chosen: { ...choices } }));
  createEffect(
    on(
      () => diagram()?.id,
      () => setPreview(null),
      { defer: true },
    ),
  );

  const view = createMemo(() => {
    const p = preview();
    return computeView(
      diagram()?.cells ?? [],
      p ? { ...viewState(), chosen: p } : viewState(),
    );
  });
  const nodeIds = createMemo(() => view().nodes.map((n) => n.id));
  const edgeIds = createMemo(() => view().edges.map((e) => e.id));

  /** The other version, laid out with this one's collapse, zoom and path. */
  const otherView = createMemo<View | null>(() => {
    if (!compare()) return null;
    const p = preview();
    return computeView(
      otherDiagram()?.cells ?? [],
      p ? { ...viewState(), chosen: p } : viewState(),
    );
  });
  /** The common ancestor, laid out the same: where what was deleted is drawn from. */
  const baseView = createMemo<View | null>(() => {
    if (!compare()) return null;
    const p = preview();
    return computeView(
      baseDiagram()?.cells ?? [],
      p ? { ...viewState(), chosen: p } : viewState(),
    );
  });
  const mode = () => compare()?.mode;
  /** marks on this version: inline and next to the other one */
  const marking = () =>
    mode() === "inline" || mode() === "side-by-side" || mode() === "stacked";
  const beside = () => mode() === "side-by-side" || mode() === "stacked";
  const overlaid = () => mode() === "onion-skin" || mode() === "swipe";

  /**
   * How a node or edge drawn in `shown` changed since the common ancestor,
   * in the draft `diff` is of. A collapsed node that looks the same but
   * hides a change says so with "inside".
   */
  const markIn = (
    diff: CellDiff,
    shown: View | null | undefined,
    id: string,
  ): Change | "inside" | undefined => {
    const own = diff.get(id);
    if (own) return own;
    const hidden = [
      ...(shown?.hiddenIn.get(id) ?? []),
      ...(baseView()?.hiddenIn.get(id) ?? []),
    ];
    return hidden.some((h) => diff.has(h)) ? "inside" : undefined;
  };
  /**
   * A mark on this version. Side by side: what this draft did since the
   * ancestor. Combined: what either did, and which.
   */
  const markHere = (id: string): Mark | undefined => {
    const d = cellDiffs();
    if (!marking() || !d) return undefined;
    const ours = markIn(d.ours, view(), id);
    if (beside()) return ours && { change: ours };
    return attribute(ours, markIn(d.theirs, view(), id));
  };
  /** A mark on the other version, beside this one: what it did since the ancestor. */
  const markThere = (id: string): Mark | undefined => {
    const d = cellDiffs();
    if (!beside() || !d) return undefined;
    const theirs = markIn(d.theirs, otherView(), id);
    return theirs && { change: theirs };
  };
  /** The real cells in `v` that `diff` says are `change`, to draw faintly. */
  const ghostsOf = (v: View | null, diff: CellDiff | undefined, change: Change) => {
    if (!v || !diff) return NO_IDS;
    const is = (id: string) => diff.get(id) === change;
    return {
      nodes: v.nodes.filter((n) => !n.virtual && is(n.id)).map((n) => n.id),
      edges: v.edges.filter((e) => !e.virtual && is(e.id)).map((e) => e.id),
    };
  };
  /** what this draft deleted since the ancestor, drawn faintly from it, where it was */
  const deletedHere = createMemo(() =>
    marking() ? ghostsOf(baseView(), cellDiffs()?.ours, "deleted") : NO_IDS,
  );
  /** side by side: what the other draft deleted, drawn faintly in its pane */
  const deletedThere = createMemo(() =>
    beside() ? ghostsOf(baseView(), cellDiffs()?.theirs, "deleted") : NO_IDS,
  );
  /** combined: what only the other draft added, drawn faintly from it */
  const addedThere = createMemo(() =>
    mode() === "inline" ? ghostsOf(otherView(), cellDiffs()?.theirs, "added") : NO_IDS,
  );
  /** a faint cell's mark: side by side, deleted; combined, by which draft */
  const markGhost = (id: string): Mark | undefined => {
    const d = cellDiffs();
    if (!d) return undefined;
    return beside() ? { change: "deleted" } : attribute(d.ours.get(id), d.theirs.get(id));
  };
  // the swipe divider: starts where the panel says, then follows the pointer
  const [swipeAt, setSwipeAt] = createSignal(0.5);
  createEffect(
    on(
      () => compare()?.mode === "swipe" && compare()!.at,
      (at) => typeof at === "number" && setSwipeAt(at),
    ),
  );

  // ---- interaction state
  let rootEl!: HTMLDivElement;
  let canvasEl!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  const [vp, setVp] = createSignal({ x: 40, y: 40, k: 1 });
  const [selection, setSelection] = createSignal<string[]>([]);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [drag, setDrag] = createSignal<{
    ids: Set<string>;
    dx: number;
    dy: number;
  } | null>(null);
  const [wire, setWire] = createSignal<{
    from: string;
    to: Pt;
    over: string | null;
  } | null>(null);
  const [gestureName, setGestureName] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    text: string;
    tone?: "error";
  } | null>(null);
  const [dropping, setDropping] = createSignal(false);
  let gesture: Gesture | null = null;
  let lastClick = { id: "", t: 0 };
  /** the choice as it was before the last click, in case that click starts a double-click */
  let choiceBefore: Choices | null = null;

  const selected = createMemo(() => new Set(selection()));
  /** the single selected node, if exactly one real node is selected */
  const selNode = createMemo<VNode | undefined>(() => {
    const ids = selection();
    if (ids.length !== 1) return undefined;
    const n = view().nodeById.get(ids[0]);
    return n && !n.virtual ? n : undefined;
  });

  const nodeRect = (id: string): Rect | undefined => {
    const n = view().nodeById.get(id);
    if (!n) return undefined;
    const d = drag();
    return d && d.ids.has(id)
      ? { ...n.rect, x: n.rect.x + d.dx, y: n.rect.y + d.dy }
      : n.rect;
  };

  const toWorld = (clientX: number, clientY: number): Pt => {
    const r = canvasEl.getBoundingClientRect();
    const v = vp();
    return {
      x: (clientX - r.left - v.x) / v.k,
      y: (clientY - r.top - v.y) / v.k,
    };
  };
  const viewportCenter = (): Pt => {
    const r = canvasEl.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  // ---- viewport
  const fit = () => {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    // comparing, both versions share the viewport: frame them both
    const b = boundsOf([
      ...view().nodes.map((n) => n.rect),
      ...(otherView()?.nodes.map((n) => n.rect) ?? []),
      ...(baseView()?.nodes.map((n) => n.rect) ?? []),
    ]);
    if (!b || !r.width || !r.height) {
      setVp({ x: 40, y: 40, k: 1 });
      return;
    }
    const pad = 48;
    const k = clamp(
      Math.min((r.width - 2 * pad) / b.w, (r.height - 2 * pad) / b.h),
      0.08,
      1.25,
    );
    setVp({
      k,
      x: (r.width - b.w * k) / 2 - b.x * k,
      y: (r.height - b.h * k) / 2 - b.y * k,
    });
  };
  /** zoom about a point, in the canvas or the pane beside it (same size) */
  const zoomAt = (
    factor: number,
    clientX?: number,
    clientY?: number,
    pane: HTMLElement = canvasEl,
  ) => {
    const r = pane.getBoundingClientRect();
    const cx = (clientX ?? r.left + r.width / 2) - r.left;
    const cy = (clientY ?? r.top + r.height / 2) - r.top;
    const v = vp();
    const k = clamp(v.k * factor, 0.08, 4);
    setVp({
      k,
      x: cx - ((cx - v.x) / v.k) * k,
      y: cy - ((cy - v.y) / v.k) * k,
    });
  };
  /** pan just enough to bring a world rect on screen */
  const reveal = (rect: Rect) => {
    const r = canvasEl.getBoundingClientRect();
    const v = vp();
    const left = rect.x * v.k + v.x;
    const top = rect.y * v.k + v.y;
    const visible =
      left >= 0 &&
      top >= 0 &&
      left + rect.w * v.k <= r.width &&
      top + rect.h * v.k <= r.height;
    if (!visible)
      setVp({
        k: v.k,
        x: r.width / 2 - (rect.x + rect.w / 2) * v.k,
        y: r.height / 2 - (rect.y + rect.h / 2) * v.k,
      });
  };

  let fitted = false;
  const worldTransform = () => {
    const v = vp();
    return `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
  };
  /** a drag that pans, from wherever the viewport is when it starts */
  const panFrom = () => {
    const { x, y } = vp();
    return (dx: number, dy: number) => setVp((v) => ({ ...v, x: x + dx, y: y + dy }));
  };
  /** scroll pans, pinch or ⌘/Ctrl-scroll zooms, in whichever pane it's over */
  const wheelIn = (pane: () => HTMLElement) => (e: WheelEvent) => {
    if ((e.target as Element).closest(".ag-zoomctl")) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey)
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY, pane());
    else setVp((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  onMount(() => {
    const onWheel = wheelIn(() => canvasEl);
    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    // the host may lay us out after mount: fit once we have a real size
    const ro = new ResizeObserver(() => {
      if (!fitted && canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0) {
        fitted = true;
        fit();
        flushReveal();
      }
    });
    ro.observe(canvasEl);
    onCleanup(() => {
      canvasEl.removeEventListener("wheel", onWheel);
      ro.disconnect();
    });
  });
  // refit whenever what is shown changes wholesale: another page, a zoom, or
  // starting or stopping a compare. A memo, so an edit, which recomputes the
  // key to the same string, doesn't refit.
  const shown = createMemo(
    () =>
      `${diagram()?.id ?? pageId()}|${view()
        .crumbs.map((c) => c.id)
        .join("/")}|${!!compare()}|${beside()}`,
  );
  createEffect(
    on(
      shown,
      () => {
        const raf = requestAnimationFrame(fit);
        onCleanup(() => cancelAnimationFrame(raf));
      },
      { defer: true },
    ),
  );

  // ---- comments: threads on cells, and the sidebar's focus (see comments.ts)
  const comments = useComments(props.element, handle);
  const readOnly = () => !!handle.isReadOnly?.();
  const cellUrl = (diagramId: string, cellId: string) =>
    comments.subUrl(
      cellRefUrl(handle.url, diagramId, cellId),
      "diagrams",
      { id: diagramId },
      "cells",
      { id: cellId },
    );
  /** the selected cells that are in the document (not a zoomed view's stand-ins) */
  const selectedCells = createMemo(() => {
    const v = view();
    return selection().filter((id) => {
      const n = v.nodeById.get(id) ?? v.edgeById.get(id);
      return !!n && !n.virtual;
    });
  });
  const selectionRefs = createMemo(
    () => {
      const d = diagram();
      return d ? selectedCells().map((id) => cellUrl(d.id, id)) : [];
    },
    [],
    { equals: (a, b) => urlsKey(a) === urlsKey(b) },
  );
  // a selection the tool changed to itself while revealing: not written back
  let adopt: string | null = null;
  createEffect(
    on(
      selectionRefs,
      (refs) => {
        if (adopt !== null && urlsKey(refs) === adopt) comments.adopt(refs);
        else comments.writeSelection(refs);
        adopt = null;
      },
      { defer: true },
    ),
  );

  /** the cells on this page the sidebar has focused */
  const emphasised = createMemo(() => {
    const d = diagram();
    return d ? cellIdsOn(comments.emphasised(), handle.url, d.id) : new Set<string>();
  });
  /** a cell is emphasised itself, or something collapsed inside it is */
  const isEmphasised = (id: string) =>
    emphasised().has(id) || !!view().hiddenIn.get(id)?.some((h) => emphasised().has(h));

  /** the cells on this page with unresolved threads (collapsed: or inside), outlined in yellow */
  const commentedCells = createMemo(() => {
    const d = diagram();
    if (!d) return [];
    const byCell = threadsByCell(comments.entries(), handle.url, d.id);
    if (!byCell.size) return [];
    const v = view();
    const out: { id: string; n: number; threads: string[] }[] = [];
    for (const n of v.nodes) {
      if (n.virtual) continue;
      const threads = new Set(byCell.get(n.id));
      for (const h of v.hiddenIn.get(n.id) ?? [])
        for (const t of byCell.get(h) ?? []) threads.add(t);
      if (threads.size) out.push({ id: n.id, n: threads.size, threads: [...threads] });
    }
    for (const e of v.edges) {
      const threads = e.virtual ? undefined : byCell.get(e.id);
      if (threads?.size) out.push({ id: e.id, n: threads.size, threads: [...threads] });
    }
    return out;
  });
  const commented = createMemo(() => new Set(commentedCells().map((c) => c.id)));
  const edgeRoute = (id: string): Pt[] => {
    const edge = view().edgeById.get(id);
    const a = edge && nodeRect(edge.source);
    const b = edge && nodeRect(edge.target);
    return edge && a && b ? routeEdge(a, b, edge.style, edge.points) : [];
  };
  // reveal: when someone else (the sidebar) focuses cells of this graph, go
  // to their page and pan them into view; the selection is left alone
  let pendingReveal: CellRef[] | null = null;
  /** the on-screen box of these cells on this page (a hidden one: what it's collapsed into) */
  const cellsBox = (ids: Set<string>): Rect | null => {
    const v = view();
    const rects: Rect[] = [];
    for (const id of ids) {
      const r = nodeRect(id);
      if (r) rects.push(r);
      else if (v.edgeById.has(id)) {
        const b = boundsOf(edgeRoute(id).map((p) => ({ ...p, w: 0, h: 0 })));
        if (b) rects.push(b);
      } else
        for (const [holder, hidden] of v.hiddenIn)
          if (hidden.includes(id)) {
            const hr = nodeRect(holder);
            if (hr) rects.push(hr);
          }
    }
    return boundsOf(rects);
  };
  const panTo = (ids: Set<string>, retry = true) => {
    const box = cellsBox(ids);
    if (box) {
      const pad = 24;
      reveal({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad });
    } else if (retry && view().zoomRoot) {
      // zoomed into a part of the graph they aren't in: back out to all of it
      updateViewState((s) => ({ ...s, zoom: [] }));
      requestAnimationFrame(() => requestAnimationFrame(() => panTo(ids, false)));
    }
  };
  const revealCells = (targets: CellRef[]) => {
    const here = diagram()?.id;
    const page =
      diagrams().find((d) => d.id === here && targets.some((t) => t.diagramId === d.id)) ??
      diagrams().find((d) => targets.some((t) => t.diagramId === d.id));
    if (!page) return;
    const ids = new Set(targets.filter((t) => t.diagramId === page.id).map((t) => t.cellId));
    if (page.id !== here) {
      if (selectionRefs().length) adopt = "";
      batch(() => {
        setPageId(page.id);
        setSelection([]);
      });
    }
    if (!fitted) {
      pendingReveal = targets;
      return;
    }
    // a page switch refits a frame later: pan after that
    if (page.id !== here) requestAnimationFrame(() => requestAnimationFrame(() => panTo(ids)));
    else panTo(ids);
  };
  const flushReveal = () => {
    const targets = pendingReveal;
    pendingReveal = null;
    if (targets) revealCells(targets);
  };
  comments.onForeignSelection((urls) => {
    const targets = cellsTargeted(urls, handle.url);
    if (targets.length) revealCells(targets);
  });

  /** why the Comment button can't be used, if it can't */
  const commentBlocker = (): string | null =>
    readOnly()
      ? "This graph is read-only"
      : !comments.contact()
        ? "Commenting needs a signed-in contact"
        : !selectedCells().length
          ? "Select one or more nodes or edges to comment on them"
          : null;
  const commentOnSelection = async () => {
    if (commentBlocker()) return;
    const threadUrl = await comments.createThread(selectionRefs());
    if (!threadUrl) setStatus({ text: "Couldn’t start a comment thread.", tone: "error" });
  };
  // ---- collapse / zoom
  const setCollapsed = (ids: string[], collapsed: boolean) =>
    updateViewState((s) => {
      const set = new Set(s.collapsed);
      for (const id of ids) collapsed ? set.add(id) : set.delete(id);
      return { ...s, collapsed: [...set] };
    });
  const toggleCollapsed = (id: string) => {
    const n = view().nodeById.get(id);
    if (
      !n ||
      n.virtual ||
      !(n.collapsed || (n.logic && n.hasInputs && id !== view().zoomRoot))
    )
      return;
    if (editing() === id) setEditing(null);
    setCollapsed([id], !n.collapsed);
  };
  /** Choose this OR input as the path (or clear it if it already is). */
  const toggleChosen = (id: string) =>
    updateViewState((s) => ({
      ...s,
      chosen: toggleChoice(view().graph, s.chosen ?? {}, id),
    }));
  const zoomInto = (id: string) => {
    updateViewState((s) => ({
      ...s,
      zoom: [
        ...view()
          .crumbs.map((c) => c.id)
          .filter((c) => c !== id),
        id,
      ],
    }));
    setSelection([]);
  };
  const zoomTo = (depth: number) => {
    updateViewState((s) => ({
      ...s,
      zoom: view()
        .crumbs.map((c) => c.id)
        .slice(0, depth),
    }));
    setSelection([]);
  };
  const zoomOut = () => zoomTo(view().crumbs.length - 1);

  // ---- editing actions
  const addNew = (kind: BlockKind) => {
    const sel = selNode();
    let target: string | undefined;
    if (kind !== "output") {
      if (
        sel &&
        sel.logic &&
        !sel.collapsed &&
        sel.kind !== "trusted" &&
        sel.kind !== "untrusted"
      )
        target = sel.id;
      else if (view().zoomRoot) target = view().zoomRoot!;
    }
    let id = "";
    const added = mutate((dg) => {
      id = addBlock(dg, kind, viewportCenter(), target);
    });
    if (!added) return;
    setSelection([id]);
    const r = view().nodeById.get(id)?.rect;
    if (r) reveal(r);
    setStatus(
      target ? { text: "Added as an input of the selected node." } : null,
    );
  };

  const addNewLabel = () => {
    const sel = selNode();
    let id = "";
    const added = mutate((dg) => {
      id = addLabel(
        dg,
        viewportCenter(),
        sel && sel.logic ? sel.id : undefined,
      );
    });
    if (!added) return;
    setSelection([id]);
    const r = view().nodeById.get(id)?.rect;
    if (r) reveal(r);
    // a collapsed node carries its label as its title, so there is nothing to edit in place
    if (view().nodeById.has(id)) startEditing(id);
    setStatus(
      sel && sel.logic
        ? {
            text: "Label added beside the selected node; it stays attached to it.",
          }
        : null,
    );
  };

  // ---- copy / cut / paste
  /** the selected nodes and labels, with what belongs to them, and the edges among them */
  const selectionCells = (): Cell[] => {
    const v = view();
    const ids = new Set<string>();
    for (const id of selection()) {
      const n = v.nodeById.get(id);
      if (!n || n.virtual) continue;
      ids.add(id);
      for (const t of v.graph.owned.get(id) ?? []) ids.add(t);
      for (const h of v.hiddenIn.get(id) ?? []) ids.add(h); // a collapsed node is copied whole
    }
    const cells = diagram()?.cells ?? [];
    return plain(
      cells.filter((c) =>
        c.vertex
          ? ids.has(c.id)
          : !!c.edge && ids.has(c.source ?? "") && ids.has(c.target ?? ""),
      ),
    );
  };
  const inTextField = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return (
      !!el &&
      (el.isContentEditable ||
        ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
    );
  };
  const onCopy = (e: ClipboardEvent) => {
    if (inTextField(e.target)) return;
    const cells = selectionCells();
    if (!cells.length) return;
    lastClip = { type: CLIP_TYPE, page: diagram()?.id ?? "", cells };
    e.clipboardData?.setData("text/plain", JSON.stringify(lastClip));
    e.preventDefault();
    const n = cells.filter((c) => c.vertex).length;
    setStatus({ text: `Copied ${n} item${n === 1 ? "" : "s"}.` });
  };
  const onCut = (e: ClipboardEvent) => {
    if (inTextField(e.target) || !selectionCells().length) return;
    onCopy(e);
    deleteSelection();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (inTextField(e.target)) return;
    const clip = readClip(e.clipboardData?.getData("text/plain"));
    const vertices = clip?.cells.filter((c) => c.vertex) ?? [];
    const box = boundsOf(
      vertices.map((c) => ({
        x: c.x ?? 0,
        y: c.y ?? 0,
        w: c.width ?? 0,
        h: c.height ?? 0,
      })),
    );
    if (!clip || !box) return;
    e.preventDefault();
    let dx = GRID * 2;
    let dy = GRID * 2;
    if (clip.page !== diagram()?.id) {
      // from elsewhere: drop it in the middle of the view
      const c = viewportCenter();
      dx = snap(c.x - (box.x + box.w / 2));
      dy = snap(c.y - (box.y + box.h / 2));
    }
    // step aside from an earlier paste of the same thing
    const first = vertices[0];
    const taken = (x: number, y: number) =>
      (diagram()?.cells ?? []).some((c) => c.vertex && c.x === x && c.y === y);
    while (taken((first.x ?? 0) + dx, (first.y ?? 0) + dy)) {
      dx += GRID * 2;
      dy += GRID * 2;
    }
    let ids: string[] = [];
    mutate((dg) => {
      ids = pasteCells(dg, clip.cells, dx, dy);
    });
    setSelection(ids.filter((id) => view().nodeById.has(id)));
    const pasted = boundsOf(
      ids
        .map((id) => view().nodeById.get(id)?.rect)
        .filter((r): r is Rect => !!r),
    );
    if (pasted) reveal(pasted);
    setStatus({
      text: `Pasted ${ids.length} item${ids.length === 1 ? "" : "s"}. Drag to place.`,
    });
  };

  const deleteSelection = () => {
    const v = view();
    const ids = new Set<string>();
    for (const id of selection()) {
      if (v.edgeById.get(id)?.virtual || v.nodeById.get(id)?.virtual) continue;
      ids.add(id);
      const label = v.graph.topLabel.get(id);
      if (label) ids.add(label);
      for (const h of v.hiddenIn.get(id) ?? []) ids.add(h); // a collapsed node goes with its contents
    }
    if (!ids.size) return;
    mutate((dg) => deleteCells(dg, ids));
    setSelection([]);
  };

  const toggleSelectedTrust = () => {
    const ids = selection().filter((id) => {
      const n = view().nodeById.get(id);
      return (
        n && !n.collapsed && (n.kind === "trusted" || n.kind === "untrusted")
      );
    });
    if (ids.length) mutate((dg) => ids.forEach((id) => toggleTrust(dg, id)));
  };
  const canToggleTrust = () =>
    selection().some((id) => {
      const n = view().nodeById.get(id);
      return (
        n && !n.collapsed && (n.kind === "trusted" || n.kind === "untrusted")
      );
    });

  const startEditing = (id: string) => {
    const n = view().nodeById.get(id);
    if (n && !n.virtual) setEditing(id);
  };
  const commitEdit = (id: string, html: string) => {
    const clean = sanitize(html).replace(/(<br>\s*)+$/i, "");
    // a collapsed node shows its title, which lives in the label beside it
    const node = view().nodeById.get(id);
    const asTitle = !!node?.collapsed;
    if (editing() === id) setEditing(null);
    if (node?.kind === "text" && !plainText(clean)) {
      // a label with no text would be invisible: remove it instead
      mutate((dg) => deleteCells(dg, [id]));
      setSelection((s) => s.filter((x) => x !== id));
      return;
    }
    mutate((dg) =>
      asTitle ? setTitle(dg, id, plainText(clean)) : setValue(dg, id, clean),
    );
  };

  // ---- pages
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const addPage = () => {
    const page = newDiagram(`Page-${diagrams().length + 1}`);
    handle.change((d) => {
      if (!d.diagrams) d.diagrams = [];
      d.diagrams.push(page);
    });
    setPageId(page.id);
    setSelection([]);
  };
  const deletePage = (id: string) => {
    const page = diagrams().find((d) => d.id === id);
    if (!page || diagrams().length < 2) return;
    if (
      !window.confirm(
        `Delete the page “${page.name}”? This cannot be undone here.`,
      )
    )
      return;
    handle.change((d) => {
      const i = d.diagrams.findIndex((x) => x.id === id);
      if (i >= 0) d.diagrams.splice(i, 1);
    });
    setPageId(null);
    setSelection([]);
  };
  const renamePage = (id: string, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    handle.change((d) => {
      const page = d.diagrams.find((x) => x.id === id);
      if (page && page.name !== trimmed) page.name = trimmed;
    });
  };

  // ---- import / export
  const importFile = async (file: File) => {
    try {
      const incoming = await parseDrawio(await file.text());
      const wasEmpty = diagrams().every((d) => !d.cells?.length);
      handle.change((d) => {
        if (!d.diagrams) d.diagrams = [];
        if (wasEmpty) {
          d.diagrams.splice(0, d.diagrams.length);
          if (!d.title || d.title === DEFAULT_TITLE)
            d.title = file.name.replace(/\.(drawio|xml)$/i, "");
        }
        for (const dg of incoming) {
          if (d.diagrams.some((x) => x.id === dg.id)) dg.id = uid("d");
          d.diagrams.push(dg);
        }
      });
      batch(() => {
        setPageId(incoming[0].id);
        setSelection([]);
      });
      requestAnimationFrame(fit);
      const n = incoming.length;
      setStatus({
        text: `Imported ${n} page${n === 1 ? "" : "s"} from ${file.name}${wasEmpty ? "" : " (added after the existing pages)"}.`,
      });
    } catch (err) {
      setStatus({
        text: `Import failed: ${(err as Error).message}`,
        tone: "error",
      });
    }
  };
  const exportFile = () => {
    const xml = serializeDrawio(plain(diagrams()));
    const url = URL.createObjectURL(
      new Blob([xml], { type: "application/xml" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(doc()?.title || DEFAULT_TITLE).replace(/[\\/:*?"<>|]+/g, "-")}.drawio`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ---- insert an existing graph by automerge URL
  const [insertOpen, setInsertOpen] = createSignal(false);
  const [insertUrl, setInsertUrl] = createSignal("");
  const [insertPages, setInsertPages] = createSignal<Diagram[] | null>(null);
  const [insertPage, setInsertPage] = createSignal("");
  const [insertBusy, setInsertBusy] = createSignal(false);
  const [insertMsg, setInsertMsg] = createSignal<{
    text: string;
    tone?: "error";
  } | null>(null);
  let loadSeq = 0;

  const loadInsertSource = async (text: string) => {
    const seq = ++loadSeq;
    setInsertPages(null);
    const url = /automerge:[A-Za-z0-9]+/.exec(text)?.[0];
    if (!url) {
      setInsertMsg(
        text.trim()
          ? { text: "That doesn’t contain an automerge: URL.", tone: "error" }
          : null,
      );
      return;
    }
    const repo = (window as any).repo;
    if (!repo) {
      setInsertMsg({
        text: "No document repo is available here.",
        tone: "error",
      });
      return;
    }
    setInsertBusy(true);
    setInsertMsg({ text: "Loading…" });
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("timed out — is the URL right, and are you online?"),
            ),
          20000,
        ),
      );
      const source = await Promise.race([repo.find(url), timeout]);
      const data = source.doc();
      let pages: Diagram[];
      if (Array.isArray(data?.diagrams)) pages = plain(data.diagrams);
      else if (data?.content != null) {
        // a raw .drawio file document
        const c = data.content;
        pages = await parseDrawio(
          c instanceof Uint8Array ? new TextDecoder().decode(c) : String(c),
        );
      } else
        throw new Error(
          "that document is not an attestation graph or a .drawio file",
        );
      if (seq !== loadSeq) return;
      const withGraph = pages.filter((p) => p.cells?.some((c) => c.edge));
      if (!pages.length) throw new Error("that graph has no pages");
      setInsertPages(pages);
      setInsertPage((withGraph[0] ?? pages[0]).id);
      setInsertMsg({
        text: `${data?.title || data?.name || "Graph"} — ${pages.length} page${pages.length === 1 ? "" : "s"}`,
      });
    } catch (err) {
      if (seq === loadSeq)
        setInsertMsg({
          text: `Couldn’t load: ${(err as Error).message}`,
          tone: "error",
        });
    } finally {
      if (seq === loadSeq) setInsertBusy(false);
    }
  };

  const insertTargetText = () => {
    const sel = selNode();
    if (!sel || !sel.logic)
      return "Nothing selected: it will be placed in the middle of the view.";
    if ((sel.kind === "trusted" || sel.kind === "untrusted") && !sel.hasInputs)
      return "It will replace the selected input block.";
    return "It will become a new input of the selected node.";
  };

  const doInsert = () => {
    const source = insertPages()?.find((p) => p.id === insertPage());
    if (!source) return;
    const sel = selNode();
    const target = sel && sel.logic ? sel.id : undefined;
    if (target && sel!.collapsed) setCollapsed([target], false);
    let result = { ids: [] as string[], note: "" };
    mutate((dg) => {
      result = insertGraph(dg, source, viewportCenter(), target);
    });
    if (!result.ids.length) {
      setInsertMsg({
        text: result.note || "Nothing to insert.",
        tone: "error",
      });
      return;
    }
    batch(() => {
      setSelection(result.ids.filter((id) => view().nodeById.has(id)));
      setInsertOpen(false);
      setStatus({ text: result.note });
    });
    if (target) requestAnimationFrame(fit);
  };

  // ---- pointer gestures
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target as Element;
    if (
      t.closest("[contenteditable]") ||
      t.closest(".ag-zoomctl") ||
      t.closest(".ag-swipe")
    )
      return;
    rootEl.focus({ preventScroll: true });
    const portEl = t.closest("[data-port]");
    const nodeEl = t.closest<HTMLElement>("[data-node-id]");
    const edgeEl = t.closest<SVGElement>("[data-edge-id]");
    const nodeId = nodeEl?.dataset.nodeId;
    const node = nodeId ? view().nodeById.get(nodeId) : undefined;
    canvasEl.setPointerCapture(e.pointerId);
    if (e.button === 0 && node && t.closest("[data-fold]")) {
      gesture = { type: "fold", id: node.id };
    } else if (e.button === 0 && portEl && node) {
      gesture = { type: "connect", from: node.id };
      setWire({ from: node.id, to: toWorld(e.clientX, e.clientY), over: null });
    } else if (e.button === 0 && node && !node.virtual) {
      gesture = {
        type: "node",
        id: node.id,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        shift: e.shiftKey,
        onTitle: !!t.closest("[data-title]"),
      };
    } else if (
      e.button === 0 &&
      edgeEl &&
      !view().edgeById.get(edgeEl.dataset.edgeId!)?.virtual
    ) {
      gesture = { type: "edge", id: edgeEl.dataset.edgeId! };
    } else {
      const v = vp();
      gesture = {
        type: "pan",
        sx: e.clientX,
        sy: e.clientY,
        x0: v.x,
        y0: v.y,
        moved: false,
        background: !node && !edgeEl,
      };
    }
    setGestureName(gesture.type);
  };

  /** which real node (if any) is under the pointer, ignoring `except` */
  const nodeUnder = (
    clientX: number,
    clientY: number,
    except: string,
  ): string | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const id = (el as Element).closest<HTMLElement>("[data-node-id]")?.dataset
        .nodeId;
      if (!id || id === except || !canvasEl.contains(el)) continue;
      const n = view().nodeById.get(id);
      if (n && n.logic && !n.virtual && !n.collapsed) return id;
    }
    return null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture;
    if (!g) return;
    if (g.type === "pan") {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      setVp((v) => ({ ...v, x: g.x0 + dx, y: g.y0 + dy }));
    } else if (g.type === "node") {
      const k = vp().k;
      const dx = (e.clientX - g.sx) / k;
      const dy = (e.clientY - g.sy) / k;
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 4) return;
        g.moved = true;
        if (!selected().has(g.id)) setSelection([g.id]);
        // what travels together: the selection, each node's labels, the
        // contents of collapsed nodes, and (with Alt) everything upstream
        const v = view();
        const ids = new Set<string>();
        const add = (id: string) => {
          ids.add(id);
          for (const t of v.graph.owned.get(id) ?? []) ids.add(t);
        };
        for (const id of selection()) {
          if (!v.nodeById.has(id)) continue;
          add(id);
          for (const h of v.hiddenIn.get(id) ?? []) ids.add(h);
          if (e.altKey) for (const a of ancestors(v.graph, id)) add(a);
        }
        setDrag({ ids, dx, dy });
      } else setDrag((d) => (d ? { ...d, dx, dy } : d));
    } else if (g.type === "connect") {
      setWire({
        from: g.from,
        to: toWorld(e.clientX, e.clientY),
        over: nodeUnder(e.clientX, e.clientY, g.from),
      });
    }
  };

  const clickNode = (id: string, shift: boolean, onTitle: boolean) => {
    const n = view().nodeById.get(id);
    if (!n) return;
    if (shift) {
      setSelection((s) =>
        s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
      );
      return;
    }
    const now = performance.now();
    const double = lastClick.id === id && now - lastClick.t < 380;
    lastClick = { id, t: double ? 0 : now };
    setSelection([id]);
    const zoomable = n.collapsed || (isGate(n.kind) && n.hasInputs);
    if (double) {
      // the first click of the pair chose a path: that wasn't the intent
      const before = choiceBefore;
      if (before) updateViewState((s) => ({ ...s, chosen: before }));
      choiceBefore = null;
      // double-click: rename a collapsed node by its title, zoom into a
      // subgraph, edit anything else
      if (n.collapsed && onTitle) startEditing(id);
      else if (zoomable) zoomInto(id);
      else startEditing(id);
      return;
    }
    // a single click on an input of an OR chooses that path
    choiceBefore = n.choosable ? (viewState().chosen ?? {}) : null;
    if (n.choosable) toggleChosen(id);
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = gesture;
    gesture = null;
    setGestureName(null);
    if (canvasEl.hasPointerCapture(e.pointerId))
      canvasEl.releasePointerCapture(e.pointerId);
    if (!g) return;
    if (g.type === "pan") {
      if (!g.moved && g.background) setSelection([]);
    } else if (g.type === "edge") {
      setSelection([g.id]);
    } else if (g.type === "fold") {
      if (e.type !== "pointercancel") toggleCollapsed(g.id);
    } else if (g.type === "node") {
      const d = drag();
      if (g.moved && d && e.type !== "pointercancel") {
        const dx = snap(d.dx);
        const dy = snap(d.dy);
        batch(() => {
          if (dx || dy) mutate((dg) => moveCells(dg, d.ids, dx, dy));
          setDrag(null);
        });
      } else {
        setDrag(null);
        if (!g.moved) clickNode(g.id, g.shift, g.onTitle);
      }
    } else if (g.type === "connect") {
      const target =
        e.type === "pointercancel"
          ? null
          : nodeUnder(e.clientX, e.clientY, g.from);
      setWire(null);
      if (target) {
        let edge: string | null = null;
        mutate((dg) => {
          edge = connect(dg, g.from, target);
        });
        if (edge) setSelection([edge]);
        else
          setStatus({
            text: "Can’t connect those: the link already exists or would form a loop.",
            tone: "error",
          });
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (
      t.isContentEditable ||
      t.tagName === "INPUT" ||
      t.tagName === "SELECT" ||
      t.tagName === "TEXTAREA"
    )
      return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (t.closest(".ag-drawer")) return; // the bundles table handles its own keys
    if (e.key === "b" || e.key === "B") {
      toggleBundles();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selection().length) {
        e.preventDefault();
        deleteSelection();
      }
    } else if (e.key === "Escape") {
      if (insertOpen()) setInsertOpen(false);
      else if (selection().length) setSelection([]);
      else if (view().zoomRoot) zoomOut();
    } else if (e.key === "c" || e.key === "C") {
      const sel = selNode();
      if (sel) toggleCollapsed(sel.id);
    } else if (e.key === "t" || e.key === "T") {
      toggleSelectedTrust();
    } else if (e.key === "Enter" || e.key === "F2") {
      const sel = selNode();
      if (sel) {
        e.preventDefault();
        startEditing(sel.id);
      }
    }
  };

  // ---- rendering helpers
  const edgePath = (id: string): string => {
    const edge = view().edgeById.get(id);
    if (!edge) return "";
    const a = nodeRect(edge.source);
    const b = nodeRect(edge.target);
    if (!a || !b) return "";
    const d = drag();
    // while an end is being dragged its old waypoints no longer apply
    const stale = !!d && (d.ids.has(edge.source) || d.ids.has(edge.target));
    return edgeD(a, b, edge.style, stale ? [] : edge.points);
  };
  const wirePath = () => {
    const w = wire();
    const a = w && nodeRect(w.from);
    if (!w || !a) return "";
    return `M${a.x + a.w / 2} ${a.y + a.h} L${w.to.x} ${w.to.y}`;
  };

  const NodeView = (p: { id: string }) => {
    const node = () => view().nodeById.get(p.id);
    return (
      <Show when={node()}>
        {(n) => {
          const rect = () => nodeRect(p.id) ?? n().rect;
          const isEditing = () => editing() === p.id;
          // combined: what each draft did to the label, word by word
          const marked = () => {
            const mark = markHere(p.id);
            if (mode() !== "inline" || n().collapsed || mark?.change !== "changed") return undefined;
            const label = (v: View | null) => {
              const m = v?.nodeById.get(p.id);
              return m && !m.collapsed ? sanitize(m.html) : undefined;
            };
            const ours = sanitize(n().html);
            const theirs = label(otherView());
            const base = label(baseView()) ?? "";
            if (mark.by === "ours") return wordDiff(ours, base, "ours") ?? undefined;
            if (mark.by === "theirs")
              return theirs === undefined ? undefined : (wordDiff(theirs, base, "theirs") ?? undefined);
            // both: each one's words against the other's, or, said alike, against the ancestor
            if (theirs === undefined || theirs === ours) return wordDiff(ours, base, "both") ?? undefined;
            return wordDiff(ours, theirs) ?? undefined;
          };
          return (
            <div
              class="ag-node"
              data-node-id={p.id}
              data-kind={n().kind}
              data-collapsed={n().collapsed ? "" : undefined}
              data-holds={n().collapsed && n().holds ? "" : undefined}
              data-virtual={n().virtual ? "" : undefined}
              data-path={n().onPath ? "" : undefined}
              data-diff={markHere(p.id)?.change}
              data-by={markHere(p.id)?.by}
              data-selected={selected().has(p.id) ? "" : undefined}
              data-comment-focus={isEmphasised(p.id) ? "" : undefined}
              data-commented={commented().has(p.id) ? "" : undefined}
              data-dragging={drag()?.ids.has(p.id) ? "" : undefined}
              data-drop-target={wire()?.over === p.id ? "" : undefined}
              data-dim={nodeLooks(n()).dim ? "" : undefined}
              data-shaded={nodeLooks(n()).shaded ? "" : undefined}
              data-mono={nodeLooks(n()).mono ? "" : undefined}
              title={
                n().choosable
                  ? n().chosen
                    ? "The chosen path at this OR · click to clear the choice"
                    : "Click to choose this path at the OR"
                  : undefined
              }
              style={nodeStyle(n(), rect())}
            >
              <NodeBody
                n={n()}
                editing={isEditing()}
                editor={(html) => <Editor id={p.id} html={html} />}
                marked={marked()}
              />
              <Show when={n().foldable && !isEditing()}>
                <div
                  class="ag-fold"
                  data-fold
                  title={
                    n().collapsed
                      ? "Expand: show what feeds this node (C)"
                      : "Collapse into a single node (C)"
                  }
                >
                  {n().collapsed ? "+" : "−"}
                </div>
              </Show>
              <Show when={n().logic && !n().virtual && !isEditing()}>
                <div
                  class="ag-port"
                  data-port
                  title="Drag onto another node to connect"
                />
              </Show>
            </div>
          );
        }}
      </Show>
    );
  };

  const Editor = (p: { id: string; html: string }) => {
    let cancelled = false;
    let done = false;
    const finish = (el: HTMLElement) => {
      if (done) return;
      done = true;
      if (cancelled) setEditing(null);
      else commitEdit(p.id, el.innerHTML);
    };
    return (
      <div
        class="ag-html"
        contentEditable
        ref={(el) => {
          el.innerHTML = sanitize(p.html);
          queueMicrotask(() => {
            el.focus();
            const range = document.createRange();
            range.selectNodeContents(el);
            const s = window.getSelection();
            s?.removeAllRanges();
            s?.addRange(range);
          });
        }}
        onBlur={(e) => finish(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            cancelled = true;
            e.currentTarget.blur();
            rootEl.focus({ preventScroll: true });
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.blur();
            rootEl.focus({ preventScroll: true });
          }
        }}
      />
    );
  };

  const blockButton = (kind: BlockKind, label: string) => (
    <button
      class="ag-btn"
      title={`Add a new ${label} block`}
      onClick={() => addNew(kind)}
    >
      <span class="ag-swatch" data-kind={kind} />
      {label}
    </button>
  );

  const canFold = () => {
    const n = selNode();
    return !!n && n.logic && n.hasInputs && n.id !== view().zoomRoot;
  };

  return (
    <div
      class="attestation-graph"
      data-compare={mode()}
      tabindex="0"
      ref={rootEl}
      onKeyDown={onKeyDown}
      on:copy={onCopy}
      on:cut={onCut}
      on:paste={onPaste}
    >
      <div class="ag-bar">
        <div class="ag-group">
          <span class="ag-group-label">Add</span>
          {blockButton("trusted", "Trusted")}
          {blockButton("untrusted", "Untrusted")}
          {blockButton("and", "AND")}
          {blockButton("or", "OR")}
          {blockButton("output", "Output")}
          <button
            class="ag-btn"
            title="Add a text label; with a node selected, it is attached beside that node"
            onClick={addNewLabel}
          >
            <span class="ag-swatch" data-kind="label">
              T
            </span>
            Label
          </button>
          <button
            class="ag-btn"
            data-active={insertOpen() ? "" : undefined}
            title="Insert a copy of another graph, by its automerge URL"
            onClick={() => setInsertOpen(!insertOpen())}
          >
            Existing graph…
          </button>
        </div>
        <div class="ag-group">
          <button
            class="ag-btn"
            disabled={!canToggleTrust()}
            title="Switch between trusted and untrusted (T)"
            onClick={toggleSelectedTrust}
          >
            Trusted ⇄ Untrusted
          </button>
          <button
            class="ag-btn"
            disabled={!selNode()}
            title="Edit the text, or the title of a collapsed node (Enter, or double-click)"
            onClick={() => selNode() && startEditing(selNode()!.id)}
          >
            Edit text
          </button>
          <button
            class="ag-btn"
            disabled={!canFold()}
            title="Show this node and everything feeding it as a single node, or open it again (C)"
            onClick={() =>
              selNode() && setCollapsed([selNode()!.id], !selNode()!.collapsed)
            }
          >
            {selNode()?.collapsed ? "Expand" : "Collapse"}
          </button>
          <button
            class="ag-btn"
            disabled={!selNode()?.choosable}
            data-active={selNode()?.chosen ? "" : undefined}
            title="Take this input of the OR as the chosen path (or clear the choice)"
            onClick={() => selNode() && toggleChosen(selNode()!.id)}
          >
            {selNode()?.chosen ? "Clear choice" : "Choose path"}
          </button>
          <button
            class="ag-btn"
            disabled={!canFold()}
            title="Show only this node and what feeds it"
            onClick={() => selNode() && zoomInto(selNode()!.id)}
          >
            Zoom in
          </button>
          <button
            class="ag-btn"
            disabled={!selection().length}
            title="Delete the selection (Delete)"
            onClick={deleteSelection}
          >
            Delete
          </button>
        </div>
        <div class="ag-spacer" />
        <div class="ag-group">
          <button
            class="ag-btn ag-comment-btn"
            disabled={!!commentBlocker()}
            title={
              commentBlocker() ??
              `Comment on the selected ${selectedCells().length === 1 ? "cell" : `${selectedCells().length} cells`}`
            }
            onClick={commentOnSelection}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
            </svg>
            Comment
          </button>
        </div>
        <div class="ag-group">
          <button
            class="ag-btn"
            data-active={bundlesOpen() ? "" : undefined}
            title="Show or hide the table of valid paths through this graph (B)"
            onClick={toggleBundles}
          >
            Evidence bundles ({bundleTable().bundles.length})
          </button>
        </div>
        <div class="ag-group">
          <button
            class="ag-btn"
            title="Import a draw.io file"
            onClick={() => fileInput.click()}
          >
            Import .drawio
          </button>
          <button
            class="ag-btn"
            title="Download as a draw.io file"
            onClick={exportFile}
          >
            Export .drawio
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".drawio,.xml,application/xml,text/xml"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (f) void importFile(f);
            }}
          />
        </div>
      </div>

      <Show when={insertOpen()}>
        <div class="ag-bar">
          <input
            class="ag-input"
            data-wide
            placeholder="automerge:… URL of an attestation graph (or a .drawio file)"
            value={insertUrl()}
            ref={(el) => queueMicrotask(() => el.focus())}
            onInput={(e) => {
              setInsertUrl(e.currentTarget.value);
              void loadInsertSource(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && insertPages()) doInsert();
            }}
          />
          <Show when={(insertPages()?.length ?? 0) > 1}>
            <select
              class="ag-input"
              value={insertPage()}
              onChange={(e) => setInsertPage(e.currentTarget.value)}
            >
              <For each={insertPages()!}>
                {(p) => <option value={p.id}>{p.name}</option>}
              </For>
            </select>
          </Show>
          <button
            class="ag-btn"
            data-variant="primary"
            disabled={!insertPages() || insertBusy()}
            onClick={doInsert}
          >
            Insert
          </button>
          <button class="ag-btn" onClick={() => setInsertOpen(false)}>
            Cancel
          </button>
          <span class="ag-status" data-tone={insertMsg()?.tone}>
            {insertMsg()?.text ?? ""}
          </span>
          <span class="ag-status">{insertTargetText()}</span>
        </div>
      </Show>

      <Show when={view().zoomRoot}>
        <div class="ag-bar">
          <button
            class="ag-btn"
            title="Zoom out one level (Esc)"
            onClick={zoomOut}
          >
            ← Out one level
          </button>
          <button
            class="ag-btn"
            title="Back to the whole graph"
            onClick={() => zoomTo(0)}
          >
            ⇤ All the way out
          </button>
          <div class="ag-group">
            <button class="ag-btn" onClick={() => zoomTo(0)}>
              Whole graph
            </button>
            <For each={view().crumbs}>
              {(c, i) => (
                <>
                  <span class="ag-crumb-sep">›</span>
                  <button
                    class="ag-btn ag-crumb"
                    data-active={
                      i() === view().crumbs.length - 1 ? "" : undefined
                    }
                    title={c.title}
                    onClick={() => zoomTo(i() + 1)}
                  >
                    {c.title}
                  </button>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div
        class="ag-stage"
        data-layout={beside() ? mode() : undefined}
        data-merging={beside() && compare()?.merging ? "" : undefined}
      >
      <div
        class="ag-canvas"
        ref={canvasEl}
        data-gesture={gestureName() ?? undefined}
        data-dropping={dropping() ? "" : undefined}
        data-focus={compare()?.collapsed && marking() ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => {
          if (e.dataTransfer?.types.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) {
            e.preventDefault();
            void importFile(f);
          }
        }}
      >
        <div class="ag-world" style={{ transform: worldTransform() }}>
          <Show when={deletedHere().nodes.length || deletedHere().edges.length || addedThere().nodes.length || addedThere().edges.length}>
            <div class="ag-ghosts">
              <Show when={baseView()}>
                {(v) => <StaticGraph view={v()} only={deletedHere()} mark={markGhost} />}
              </Show>
              <Show when={otherView()}>
                {(v) => <StaticGraph view={v()} only={addedThere()} mark={markGhost} />}
              </Show>
            </div>
          </Show>
          <svg class="ag-edges">
            <defs>
              <ArrowMarker id={markerId} size={9} />
              <ArrowMarker id={`${markerId}-path`} size={13} path />
            </defs>
            <For each={edgeIds()}>
              {(id) => (
                <g
                  class="ag-edge"
                  data-edge-id={id}
                  data-selected={selected().has(id) ? "" : undefined}
                  data-comment-focus={emphasised().has(id) ? "" : undefined}
                  data-commented={commented().has(id) ? "" : undefined}
                  data-virtual={
                    view().edgeById.get(id)?.virtual ? "" : undefined
                  }
                  data-path={view().pathEdges.has(id) ? "" : undefined}
                  data-diff={markHere(id)?.change}
                  data-by={markHere(id)?.by}
                >
                  <path class="ag-edge-hit" d={edgePath(id)} />
                  <path
                    class="ag-edge-line"
                    d={edgePath(id)}
                    marker-end={`url(#${markerId}${view().pathEdges.has(id) ? "-path" : ""})`}
                  />
                </g>
              )}
            </For>
            <Show when={wire()}>
              <path class="ag-wire" d={wirePath()} />
            </Show>
          </svg>
          <For each={nodeIds()}>{(id) => <NodeView id={id} />}</For>
        </div>

        <Show when={!view().nodes.length && !deletedHere().nodes.length && !addedThere().nodes.length}>
          <div class="ag-empty">
            <Show
              when={onGhostPage()}
              fallback={
                <>
                  <strong>This page is empty</strong>
                  <span>
                    Add blocks from the toolbar, or import a draw.io file (you
                    can also drop one here).
                  </span>
                </>
              }
            >
              <strong>{ghostPageNote(pageId())}</strong>
            </Show>
          </div>
        </Show>

        <Show when={overlaid() && otherView()}>
          <div
            class="ag-overlay"
            style={{
              opacity:
                mode() === "onion-skin" ? String(compare()!.mix) : undefined,
              "clip-path":
                mode() === "swipe"
                  ? `inset(0 0 0 ${swipeAt() * 100}%)`
                  : undefined,
            }}
          >
            <div class="ag-world" style={{ transform: worldTransform() }}>
              <StaticGraph view={otherView()!} />
            </div>
          </div>
        </Show>
        <Show when={mode() === "swipe" && otherView()}>
          <SwipeDivider at={swipeAt()} onMove={setSwipeAt} />
        </Show>
        {/* which version is which: not combined, where the marks say it */}
        <Show when={compare()?.mode !== "inline" && compare()}>
          {(c) => (
            <>
              <div class="ag-versions">
                <Show
                  when={beside() && c().merging}
                  fallback={<VersionTag side="ours" name={c().ours} />}
                >
                  <span class="ag-version">After</span>
                </Show>
                <Show when={!beside() && mode() !== "swipe"}>
                  <VersionTag side="theirs" name={c().theirs} />
                </Show>
              </div>
              <Show when={mode() === "swipe"}>
                <div class="ag-versions" data-at="right">
                  <VersionTag side="theirs" name={c().theirs} />
                </div>
              </Show>
            </>
          )}
        </Show>

        <div class="ag-zoomctl">
          <button
            class="ag-btn"
            title="Smaller"
            onClick={() => zoomAt(1 / 1.25)}
          >
            −
          </button>
          <span class="ag-pct">{Math.round(vp().k * 100)}%</span>
          <button class="ag-btn" title="Larger" onClick={() => zoomAt(1.25)}>
            +
          </button>
          <button class="ag-btn" title="Fit everything in view" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
      <Show when={beside() && otherView()}>
        <OtherPane
          view={otherView()!}
          transform={worldTransform()}
          name={compare()!.theirs}
          before={compare()!.merging}
          missing={!!compare()?.missing}
          absent={!otherDiagram() && !compare()?.missing}
          focus={!!compare()?.collapsed}
          mark={markThere}
          ghosts={baseView() && { view: baseView()!, only: deletedThere() }}
          onWheel={wheelIn}
          pan={panFrom}
        />
      </Show>
      </div>

      <Show when={bundlesOpen()}>
        <div class="ag-drawer">
          <Show
            when={bundleTable().bundles.length}
            fallback={
              <div class="ag-drawer-note">
                No paths yet: this page has no node with inputs to end on.
              </div>
            }
          >
            <table class="ag-bundles">
              <thead>
                <tr>
                  <th>
                    Evidence bundle
                    <span class="ag-drawer-hint">
                      hover to preview · click to choose
                    </span>
                  </th>
                  <For each={bundleTable().inputs}>
                    {(input, i) => (
                      <th
                        data-bit
                        data-gap={i() > 0 && i() % 5 === 0 ? "" : undefined}
                        title={input.title}
                        innerHTML={sanitize(input.label)}
                      />
                    )}
                  </For>
                  <th data-close>
                    <button
                      class="ag-btn"
                      title="Hide the evidence bundles (B)"
                      onClick={toggleBundles}
                    >
                      ×
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody onPointerLeave={() => setPreview(null)}>
                <For each={bundleTable().bundles}>
                  {(b) => (
                    <tr
                      tabindex="0"
                      data-active={
                        matchesChoices(viewState().chosen ?? {}, b.choices)
                          ? ""
                          : undefined
                      }
                      data-preview={preview() === b.choices ? "" : undefined}
                      onPointerEnter={() => setPreview(b.choices)}
                      onFocus={() => setPreview(b.choices)}
                      onBlur={() => setPreview(null)}
                      onClick={() => chooseBundle(b.choices)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          chooseBundle(b.choices);
                        }
                      }}
                    >
                      <td>{b.title}</td>
                      <For each={b.bits}>
                        {(bit, i) => (
                          <td
                            data-bit
                            data-on={bit ? "" : undefined}
                            data-gap={i() > 0 && i() % 5 === 0 ? "" : undefined}
                          >
                            {bit ? "1" : "0"}
                          </td>
                        )}
                      </For>
                      <td />
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={bundleTable().truncated}>
              <div class="ag-drawer-note">
                Showing only the first {bundleTable().bundles.length} paths.
              </div>
            </Show>
          </Show>
        </div>
      </Show>

      <div class="ag-bar" data-position="bottom">
        <For each={diagrams()}>
          {(d) => (
            <Show
              when={renaming() === d.id}
              fallback={
                <button
                  class="ag-btn ag-page"
                  data-active={diagram()?.id === d.id ? "" : undefined}
                  data-diff={pageMark(d.id)?.change}
                  data-by={pageMark(d.id)?.by}
                  title="Double-click to rename"
                  onClick={() => {
                    if (diagram()?.id !== d.id) {
                      setPageId(d.id);
                      setSelection([]);
                    }
                  }}
                  onDblClick={() => setRenaming(d.id)}
                >
                  {d.name}
                </button>
              }
            >
              <input
                class="ag-input"
                value={d.name}
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus();
                    el.select();
                  })
                }
                onBlur={(e) =>
                  renaming() === d.id && renamePage(d.id, e.currentTarget.value)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    renamePage(d.id, e.currentTarget.value);
                  else if (e.key === "Escape") setRenaming(null);
                }}
              />
            </Show>
          )}
        </For>
        <For each={ghostPages()}>
          {(d) => (
            <button
              class="ag-btn ag-page"
              data-active={pageId() === d.id && onGhostPage() ? "" : undefined}
              data-ghost=""
              data-diff={pageMark(d.id)?.change}
              data-by={pageMark(d.id)?.by}
              title={ghostPageNote(d.id)}
              onClick={() => {
                setPageId(d.id);
                setSelection([]);
              }}
            >
              {d.name}
            </button>
          )}
        </For>
        <button class="ag-btn" title="Add a page" onClick={addPage}>
          +
        </button>
        <Show when={diagrams().length > 1 && diagram()}>
          <button
            class="ag-btn"
            title="Delete the current page"
            onClick={() => deletePage(diagram()!.id)}
          >
            Delete page
          </button>
        </Show>
        <div class="ag-spacer" />
        <span class="ag-status" data-tone={status()?.tone}>
          {status()?.text ?? ""}
        </span>
        <span class="ag-hint">
          Click an input of an OR to choose that path · − / + collapses or
          expands a gate · double-click to zoom in · drag ● to connect ·
          ⌘/Ctrl+C, V to copy and paste
        </span>
      </div>
    </div>
  );
}
