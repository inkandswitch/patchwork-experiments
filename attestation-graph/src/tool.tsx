import {
  For,
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
import { DEFAULT_TITLE } from "./datatype";
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
};

const EMPTY_VIEW: ViewState = { collapsed: [], zoom: [] };
const GRID = 10;
const snap = (v: number) => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

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

// ------------------------------------------------------------------ tool

export default function AttestationGraphTool(
  handle: Handle,
  element: HTMLElement,
) {
  return render(() => <App handle={handle} />, element);
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

function App(props: { handle: Handle }) {
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
  const diagram = createMemo<Diagram | undefined>(
    () => diagrams().find((d) => d.id === pageId()) ?? diagrams()[0],
  );

  /** Run an edit against the current page inside one change. */
  const mutate = (fn: (dg: Diagram, d: GraphDoc) => void) => {
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
    const b = boundsOf(view().nodes.map((n) => n.rect));
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
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const r = canvasEl.getBoundingClientRect();
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
  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest(".ag-zoomctl")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey)
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setVp((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    canvasEl.addEventListener("wheel", onWheel, { passive: false });
    // the host may lay us out after mount: fit once we have a real size
    const ro = new ResizeObserver(() => {
      if (!fitted && canvasEl.clientWidth > 0 && canvasEl.clientHeight > 0) {
        fitted = true;
        fit();
      }
    });
    ro.observe(canvasEl);
    onCleanup(() => {
      canvasEl.removeEventListener("wheel", onWheel);
      ro.disconnect();
    });
  });
  // refit whenever what is shown changes wholesale: another page, or a zoom
  createEffect(
    on(
      () =>
        `${diagram()?.id}|${view()
          .crumbs.map((c) => c.id)
          .join("/")}`,
      () => {
        const raf = requestAnimationFrame(fit);
        onCleanup(() => cancelAnimationFrame(raf));
      },
      { defer: true },
    ),
  );

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
    mutate((dg) => {
      id = addBlock(dg, kind, viewportCenter(), target);
    });
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
    mutate((dg) => {
      id = addLabel(
        dg,
        viewportCenter(),
        sel && sel.logic ? sel.id : undefined,
      );
    });
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
    if (t.closest("[contenteditable]") || t.closest(".ag-zoomctl")) return;
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
    return routeEdge(a, b, edge.style, stale ? [] : edge.points)
      .map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`)
      .join(" ");
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
          const st = (key: string) => styleGet(n().style, key);
          const fontStyle = () => Number(st("fontStyle") ?? 0) || 0;
          const align = () => st("align") ?? "center";
          const isEditing = () => editing() === p.id;
          return (
            <div
              class="ag-node"
              data-node-id={p.id}
              data-kind={n().kind}
              data-collapsed={n().collapsed ? "" : undefined}
              data-holds={n().collapsed && n().holds ? "" : undefined}
              data-virtual={n().virtual ? "" : undefined}
              data-path={n().onPath ? "" : undefined}
              data-selected={selected().has(p.id) ? "" : undefined}
              data-dragging={drag()?.ids.has(p.id) ? "" : undefined}
              data-drop-target={wire()?.over === p.id ? "" : undefined}
              data-dim={st("fontColor") ? "" : undefined}
              data-shaded={
                n().kind === "box" &&
                (st("fillColor") ?? "#ffffff").toLowerCase() !== "#ffffff"
                  ? ""
                  : undefined
              }
              data-mono={
                /courier|mono/i.test(st("fontFamily") ?? "") ? "" : undefined
              }
              title={
                n().choosable
                  ? n().chosen
                    ? "The chosen path at this OR · click to clear the choice"
                    : "Click to choose this path at the OR"
                  : undefined
              }
              style={{
                left: `${rect().x}px`,
                top: `${rect().y}px`,
                width: `${rect().w}px`,
                height: `${rect().h}px`,
                "font-size": `${n().collapsed ? 12 : Number(st("fontSize") ?? 12) || 12}px`,
                "font-weight":
                  !n().collapsed && fontStyle() & 1 ? "700" : undefined,
                "font-style":
                  !n().collapsed && fontStyle() & 2 ? "italic" : undefined,
                "text-decoration":
                  !n().collapsed && fontStyle() & 4 ? "underline" : undefined,
                "text-align": n().collapsed
                  ? "center"
                  : (align() as "left" | "center" | "right"),
              }}
            >
              <Show when={n().kind === "or" && !n().collapsed}>
                <svg
                  class="ag-diamond"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <polygon
                    points="50,0 100,50 50,100 0,50"
                    vector-effect="non-scaling-stroke"
                  />
                </svg>
              </Show>
              <Show when={n().caption}>
                <div class="ag-caption" innerHTML={sanitize(n().caption)} />
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
                    n().collapsed || st("whiteSpace") === "wrap"
                      ? "normal"
                      : "nowrap",
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
                  when={n().collapsed}
                  fallback={
                    <Show
                      when={isEditing()}
                      fallback={
                        <div class="ag-html" innerHTML={sanitize(n().html)} />
                      }
                    >
                      <Editor id={p.id} html={n().html} />
                    </Show>
                  }
                >
                  <div class="ag-heading">{n().heading}</div>
                  <Show
                    when={isEditing()}
                    fallback={
                      <div
                        class="ag-title"
                        data-title
                        data-untitled={n().title ? undefined : ""}
                        title="Double-click to rename"
                      >
                        {n().title || "Untitled"}
                      </div>
                    }
                  >
                    <Editor id={p.id} html={escapeHtml(n().title)} />
                  </Show>
                </Show>
              </div>
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
        class="ag-canvas"
        ref={canvasEl}
        data-gesture={gestureName() ?? undefined}
        data-dropping={dropping() ? "" : undefined}
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
        <div
          class="ag-world"
          style={{
            transform: `translate(${vp().x}px, ${vp().y}px) scale(${vp().k})`,
          }}
        >
          <svg class="ag-edges">
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 10 10"
                refX="9.5"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path class="ag-arrow" d="M0 0.5 L10 5 L0 9.5 L2.5 5 z" />
              </marker>
              <marker
                id={`${markerId}-path`}
                viewBox="0 0 10 10"
                refX="9.5"
                refY="5"
                markerWidth="13"
                markerHeight="13"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path
                  class="ag-arrow"
                  data-path
                  d="M0 0.5 L10 5 L0 9.5 L2.5 5 z"
                />
              </marker>
            </defs>
            <For each={edgeIds()}>
              {(id) => (
                <g
                  class="ag-edge"
                  data-edge-id={id}
                  data-selected={selected().has(id) ? "" : undefined}
                  data-virtual={
                    view().edgeById.get(id)?.virtual ? "" : undefined
                  }
                  data-path={view().pathEdges.has(id) ? "" : undefined}
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

        <Show when={!view().nodes.length}>
          <div class="ag-empty">
            <strong>This page is empty</strong>
            <span>
              Add blocks from the toolbar, or import a draw.io file (you can
              also drop one here).
            </span>
          </div>
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
                  class="ag-btn"
                  data-active={diagram()?.id === d.id ? "" : undefined}
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
