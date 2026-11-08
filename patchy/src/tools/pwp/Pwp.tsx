import "./pwp.css";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import {
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";

import { FOLDER_SELECTOR, type PatchFolder } from "../../folder.js";
import { useDoc, useHandles } from "../../reactive.js";
import {
  addLayer,
  deleteShape,
  isLayerDoc,
  moveLayer,
  putShape,
  redrawer,
  removeLayer,
  rename,
  restack,
  showLayer,
  type Canvas,
  type Layer,
  type LayerDoc,
} from "./layers.js";
import {
  CLIP_TYPE,
  bounds,
  dragBox,
  fromClip,
  toClip,
  fitTo,
  isEmpty,
  isStroke,
  newId,
  spanBox,
  thin,
  translate,
  type PictureShape,
  type Shape,
  type ShapeKind,
  type StrokeShape,
} from "./shapes.js";

/** The parts of a patternwitch doc pwp reads. It never writes one. */
type PatternWitchDoc = {
  width: number;
  height: number;
  palette: string[];
  pixels: number[][];
};

type Tool = "select" | "rect" | "ellipse" | "line" | "pen";

type Drag =
  | { mode: "create"; x0: number; y0: number }
  | { mode: "move"; layer: Layer; start: Shape; x0: number; y0: number }
  | {
      mode: "resize";
      layer: Layer;
      start: Shape;
      edges: [number, number];
      x0: number;
      y0: number;
    }
  | { mode: "end"; layer: Layer; start: StrokeShape; which: 0 | 1 };

// How long patternwitch gets to put its canvas up before pwp gives up.
const CANVAS_WAIT = 10_000;

const TOOLS: { tool: Tool; label: string; key: string; icon: () => JSX.Element }[] = [
  {
    tool: "select",
    label: "Select",
    key: "v",
    icon: () => <path d="M5 3l14 8-6 1.5L10 19z" />,
  },
  { tool: "rect", label: "Rectangle", key: "r", icon: () => <rect x="4" y="5" width="16" height="14" rx="1" /> },
  { tool: "ellipse", label: "Ellipse", key: "o", icon: () => <ellipse cx="12" cy="12" rx="8" ry="7" /> },
  { tool: "line", label: "Line", key: "l", icon: () => <path d="M5 19L19 5" /> },
  { tool: "pen", label: "Pen", key: "p", icon: () => <path d="M4 17c3-6 5 2 8-4s5-2 8-6" /> },
];

// The last shapes copied on this page, for when the clipboard loses our type.
let lastCopy: string | undefined;

const HANDLES: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
const CURSORS: Record<string, string> = {
  "-1,-1": "nwse-resize", "1,1": "nwse-resize",
  "1,-1": "nesw-resize", "-1,1": "nesw-resize",
  "0,-1": "ns-resize", "0,1": "ns-resize",
  "-1,0": "ew-resize", "1,0": "ew-resize",
};

export function Pwp(props: {
  handle: DocHandle<PatternWitchDoc>;
  element: ToolElement;
}) {
  // Layers live in the realm's own repo, beside the folder that lays them,
  // and are made against the document as it really is.
  const root = (window as { repo?: Repo }).repo;
  if (!root) throw new Error("[pwp] window.repo is not set; pwp can't make layers");
  const docUrl = stringifyAutomergeUrl({ documentId: props.handle.documentId });
  const { documentId } = parseAutomergeUrl(docUrl);

  // ---- the drawing, as shown (patches and all) and as it really is ----
  const [shown, setShownDoc] = createSignal(props.handle.doc(), { equals: false });
  const onShown = () => setShownDoc(() => props.handle.doc());
  props.handle.on("change", onShown);
  onCleanup(() => props.handle.off("change", onShown));

  const canvas = createMemo<Canvas | undefined>(
    (prev) => {
      const d = shown();
      if (!d || !d.width || !d.height || !Array.isArray(d.palette)) return undefined;
      const next = { width: d.width, height: d.height, palette: [...d.palette] };
      return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    },
    undefined
  );
  const W = () => canvas()?.width ?? 1;
  const H = () => canvas()?.height ?? 1;
  const palette = () => canvas()?.palette ?? [];

  const [, target] = useDoc<unknown>(root, () => docUrl as AutomergeUrl);

  // ---- the folder of patches the provider above lays ----
  const folderUrl = subscribe<AutomergeUrl>(props.element, { type: FOLDER_SELECTOR });
  const [noProvider, setNoProvider] = createSignal(false);
  const providerWait = setTimeout(() => setNoProvider(!folderUrl()), 2000);
  onCleanup(() => clearTimeout(providerWait));
  createEffect(() => folderUrl() && setNoProvider(false));
  const [folder, folderHandle] = useDoc<PatchFolder>(root, folderUrl);

  const links = createMemo(() =>
    (folder()?.docs ?? []).filter((l) => l?.type === "patch" && l.url)
  );
  const layerHandles = useHandles<LayerDoc>(root, () => links().map((l) => l.url));

  /** This drawing's pwp layers, back first. */
  const layers = createMemo<Layer[]>((prev) => {
    const handles = layerHandles();
    const out: Layer[] = [];
    for (const link of links()) {
      const handle = handles.get(link.url);
      const doc = handle?.doc();
      if (!handle || !isLayerDoc(doc) || !doc.on) continue;
      if (parseAutomergeUrl(doc.on).documentId !== documentId) continue;
      const shown = !link.off;
      const same = prev.find(
        (l) => l.link.url === link.url && l.shown === shown && l.link.name === link.name
      );
      out.push(same ?? { link: { ...link }, handle, shown });
    }
    return out;
  }, []);

  const shapesOf = (layer: Layer): Shape[] => {
    layerHandles();
    return layer.handle.doc()?.pwp?.shapes ?? [];
  };

  const [activeUrl, setActiveUrl] = createSignal<AutomergeUrl>();
  const active = () =>
    layers().find((l) => l.link.url === activeUrl()) ??
    [...layers()].reverse().find((l) => l.shown);

  // ---- keeping pixels in step with shapes ----
  const redraw = redrawer(target, canvas);
  const drawn = new Map<string, string>();
  const signature = (shapes: readonly Shape[]) =>
    JSON.stringify(
      shapes.map((s) => (s.kind === "picture" ? { ...s, bytes: s.bytes.length } : s))
    );
  createEffect(() => {
    const c = canvas();
    if (!c || !target()) return;
    const key = JSON.stringify(c);
    for (const layer of layers()) {
      const sig = key + signature(shapesOf(layer));
      if (drawn.get(layer.link.url) === sig) continue;
      drawn.set(layer.link.url, sig);
      redraw(layer.handle);
    }
  });

  // ---- tools ----
  const [tool, setTool] = createSignal<Tool>("select");
  const [colour, setColour] = createSignal(2);
  const [fill, setFill] = createSignal(true);
  const [stroke, setStroke] = createSignal(1);
  const [selected, setSelected] = createSignal<{ layer: AutomergeUrl; id: string }>();
  const [draft, setDraft] = createSignal<{ layer?: AutomergeUrl; shape: Shape }>();
  const [layersOpen, setLayersOpen] = createSignal(true);
  const pen = () => Math.min(colour(), Math.max(0, palette().length - 1));

  const selection = createMemo(() => {
    const sel = selected();
    if (!sel) return undefined;
    const layer = layers().find((l) => l.link.url === sel.layer);
    if (!layer || !layer.shown) return undefined;
    const shape = shapesOf(layer).find((s) => s.id === sel.id);
    return shape ? { layer, shape } : undefined;
  });

  // What the selection box and handles follow: the shape being dragged, if
  // that's the selected one.
  const framed = () => {
    const d = draft();
    const s = selection();
    if (d && s && d.shape.id === s.shape.id) return { layer: s.layer, shape: d.shape };
    return s;
  };

  /** The layer new shapes go in, made (or switched on) if need be. */
  const layerToDrawIn = (): Layer | DocHandle<LayerDoc> | undefined => {
    const a = active();
    if (a) {
      if (!a.shown) {
        const f = folderHandle();
        if (f) showLayer(f, a, true);
      }
      return a;
    }
    const t = target();
    const f = folderHandle();
    if (!t || !f) return undefined;
    const made = addLayer(root, t, f, `Layer ${layers().length + 1}`);
    setActiveUrl(made.url);
    return made;
  };

  const commitNew = (shape: Shape) => {
    const into = layerToDrawIn();
    if (!into) return;
    const handle = "link" in into ? into.handle : into;
    putShape(handle, shape);
    setSelected({ layer: handle.url, id: shape.id });
  };

  /** Change the selected shape, if there is one. */
  const editSelected = (fn: (s: Shape) => Shape | undefined) => {
    const s = selection();
    if (!s) return;
    const next = fn(s.shape);
    if (next) putShape(s.layer.handle, next);
  };

  // ---- finding patternwitch's canvas, and keeping over it ----
  let rootEl!: HTMLDivElement;
  let view!: HTMLElement;
  let svg!: SVGSVGElement;
  let fileInput!: HTMLInputElement;
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement>();
  const [missing, setMissing] = createSignal<string>();
  const [place, setPlace] = createSignal({ left: 0, top: 0, width: 0, height: 0 });

  const fail = (message: string) => {
    console.error(`[pwp] ${message}`);
    setMissing(message);
  };

  onMount(() => {
    const find = () => view.querySelector<HTMLCanvasElement>(".patternwitch canvas");
    let wait: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const c = canvasEl();
      if (c?.isConnected) return;
      const found = find();
      if (found) {
        clearTimeout(wait);
        wait = undefined;
        setMissing(undefined);
        setCanvasEl(found);
        return;
      }
      setCanvasEl(undefined);
      wait ??= setTimeout(
        () =>
          fail(
            c
              ? "patternwitch's canvas went away and didn't come back. pwp draws over " +
                  "`.patternwitch canvas` inside the embedded view; patternwitch may have changed."
              : `couldn't find patternwitch's canvas (\`.patternwitch canvas\`) inside the ` +
                  `embedded view after ${CANVAS_WAIT / 1000}s. Is the patternwitch tool ` +
                  `installed, and does it still render a <canvas>?`
          ),
        CANVAS_WAIT
      );
    };
    const observer = new MutationObserver(look);
    observer.observe(view, { childList: true, subtree: true });
    look();

    let frame = requestAnimationFrame(function track() {
      const c = canvasEl();
      if (c) {
        const r = c.getBoundingClientRect();
        const o = rootEl.getBoundingClientRect();
        const p = place();
        const next = {
          left: r.left - o.left,
          top: r.top - o.top,
          width: r.width,
          height: r.height,
        };
        if (
          next.left !== p.left ||
          next.top !== p.top ||
          next.width !== p.width ||
          next.height !== p.height
        ) {
          setPlace(next);
        }
      }
      frame = requestAnimationFrame(track);
    });

    onCleanup(() => {
      observer.disconnect();
      clearTimeout(wait);
      cancelAnimationFrame(frame);
    });
  });

  // One cell, in screen pixels.
  const scale = () => place().width / W() || 1;

  const cellAt = (e: PointerEvent | MouseEvent) => {
    const r = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W(),
      y: ((e.clientY - r.top) / r.height) * H(),
    };
  };
  // Box edges sit on cell edges; line ends in the middle of a cell.
  const edge = (v: number) => Math.round(v);
  const middle = (v: number) => Math.floor(v) + 0.5;

  // ---- dragging ----
  let drag: Drag | undefined;

  const shapeFor = (kind: ShapeKind, x0: number, y0: number, x: number, y: number, square: boolean): Shape => {
    const id = draft()?.shape.id ?? newId();
    if (kind === "line") {
      return {
        id,
        kind,
        points: [middle(x0), middle(y0), middle(x), middle(y)],
        color: pen(),
        stroke: stroke(),
      };
    }
    let bx = edge(x), by = edge(y);
    const ax = edge(x0), ay = edge(y0);
    if (square) {
      const side = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      bx = ax + Math.sign(bx - ax || 1) * side;
      by = ay + Math.sign(by - ay || 1) * side;
    }
    return {
      id,
      kind: kind as "rect" | "ellipse",
      ...spanBox(ax, ay, bx, by),
      color: pen(),
      fill: fill(),
      stroke: stroke(),
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const { x, y } = cellAt(e);
    if (drag.mode === "create") {
      const t = tool();
      if (t === "pen") {
        const d = draft();
        if (d && isStroke(d.shape)) {
          setDraft({ shape: { ...d.shape, points: [...d.shape.points, x, y] } });
        }
      } else if (t !== "select") {
        setDraft({ shape: shapeFor(t, drag.x0, drag.y0, x, y, e.shiftKey) });
      }
    } else if (drag.mode === "move") {
      const dx = Math.round(x - drag.x0);
      const dy = Math.round(y - drag.y0);
      setDraft({ layer: drag.layer.link.url, shape: translate(drag.start, dx, dy) });
    } else if (drag.mode === "resize") {
      const dx = Math.round(x - drag.x0);
      const dy = Math.round(y - drag.y0);
      const { box, flipX, flipY } = dragBox(bounds(drag.start), drag.edges, dx, dy);
      setDraft({ layer: drag.layer.link.url, shape: fitTo(drag.start, box, flipX, flipY) });
    } else if (drag.mode === "end") {
      const points = [...drag.start.points];
      points[drag.which * 2] = middle(x);
      points[drag.which * 2 + 1] = middle(y);
      setDraft({ layer: drag.layer.link.url, shape: { ...drag.start, points } });
    }
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    const d = draft();
    const was = drag;
    drag = undefined;
    setDraft(undefined);
    if (!d || !was) return;
    if (was.mode === "create") {
      let shape = d.shape;
      if (shape.kind === "pen") shape = { ...shape, points: thin(shape.points) };
      if (!isEmpty(shape)) commitNew(shape);
    } else {
      putShape(was.layer.handle, d.shape);
    }
  };

  const startDrag = (next: Drag) => {
    drag = next;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onBackground = (e: PointerEvent) => {
    if (e.button !== 0 || !canvas()) return;
    rootEl.focus({ preventScroll: true });
    e.preventDefault();
    const t = tool();
    if (t === "select") {
      setSelected(undefined);
      return;
    }
    const { x, y } = cellAt(e);
    if (t === "pen") {
      setDraft({
        shape: { id: newId(), kind: "pen", points: [x, y], color: pen(), stroke: stroke() },
      });
    } else {
      setDraft({ shape: shapeFor(t, x, y, x, y, false) });
    }
    startDrag({ mode: "create", x0: x, y0: y });
  };

  const onShape = (e: PointerEvent, layer: Layer, shape: Shape) => {
    if (e.button !== 0 || tool() !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    rootEl.focus({ preventScroll: true });
    setActiveUrl(layer.link.url);
    setSelected({ layer: layer.link.url, id: shape.id });
    const { x, y } = cellAt(e);
    startDrag({ mode: "move", layer, start: shape, x0: x, y0: y });
  };

  const onHandle = (e: PointerEvent, edges: [number, number]) => {
    const s = selection();
    if (e.button !== 0 || !s) return;
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = cellAt(e);
    startDrag({ mode: "resize", layer: s.layer, start: s.shape, edges, x0: x, y0: y });
  };

  const onEnd = (e: PointerEvent, which: 0 | 1) => {
    const s = selection();
    if (e.button !== 0 || !s || s.shape.kind !== "line") return;
    e.stopPropagation();
    e.preventDefault();
    startDrag({ mode: "end", layer: s.layer, start: s.shape, which });
  };

  onCleanup(() => onUp());

  // ---- pictures ----
  const addPicture = async (file: Blob) => {
    const c = canvas();
    if (!c) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(file);
    } catch (err) {
      console.error("[pwp] that image won't decode:", err);
      return;
    }
    const k = Math.min(c.width / image.width, c.height / image.height);
    const w = Math.max(1, Math.round(image.width * k));
    const h = Math.max(1, Math.round(image.height * k));
    image.close();
    const shape: PictureShape = {
      id: newId(),
      kind: "picture",
      x: Math.round((c.width - w) / 2),
      y: Math.round((c.height - h) / 2),
      w,
      h,
      bytes,
      mime: file.type || "image/png",
      dither: true,
    };
    commitNew(shape);
    setTool("select");
  };

  const imagesIn = (data: DataTransfer | null): File[] =>
    Array.from(data?.files ?? []).filter((f) => f.type.startsWith("image/"));

  // ---- the clipboard ----
  // Whether a clipboard event is pwp's: it's focused or under the pointer,
  // and not typing in a box.
  const ours = (e: ClipboardEvent) =>
    (rootEl.contains(document.activeElement) || rootEl.matches(":hover")) &&
    !(e.target as HTMLElement)?.closest?.("input, textarea");

  // Each paste of the same copy lands one cell further along.
  let pastes = 0;

  const onCopy = (e: ClipboardEvent) => {
    const s = selection();
    if (!s || !ours(e) || !e.clipboardData) return;
    e.preventDefault();
    const text = toClip([s.shape]);
    e.clipboardData.setData(CLIP_TYPE, text);
    e.clipboardData.setData("text/plain", text);
    lastCopy = text;
    pastes = 0;
    if (e.type === "cut") {
      deleteShape(s.layer.handle, s.shape.id);
      setSelected(undefined);
      // A cut pastes back where it was.
      pastes = -1;
    }
  };

  const pasteShapes = (text: string) => {
    const shapes = fromClip(text);
    if (shapes.length === 0) return false;
    pastes++;
    let last: Shape | undefined;
    for (const shape of shapes) {
      last = translate(shape, pastes, pastes);
      commitNew(last);
    }
    setTool("select");
    return true;
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!ours(e)) return;
    const data = e.clipboardData;
    const text = data?.getData(CLIP_TYPE) || data?.getData("text/plain") || "";
    if (text && pasteShapes(text)) {
      e.preventDefault();
      return;
    }
    const images = imagesIn(data);
    if (images.length > 0) {
      e.preventDefault();
      for (const f of images) void addPicture(f);
      return;
    }
    // Some browsers keep only plain text and files: fall back to the last
    // copy made on this page.
    if (lastCopy && pasteShapes(lastCopy)) e.preventDefault();
  };

  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCopy);
  document.addEventListener("paste", onPaste);
  onCleanup(() => {
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("cut", onCopy);
    document.removeEventListener("paste", onPaste);
  });

  const urls = new Map<string, string>();
  const urlOf = (s: PictureShape) => {
    let url = urls.get(s.id);
    if (!url) {
      url = URL.createObjectURL(new Blob([s.bytes as BlobPart], { type: s.mime }));
      urls.set(s.id, url);
    }
    return url;
  };
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)));

  // ---- keys ----
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = selection();
    if ((e.key === "Delete" || e.key === "Backspace") && s) {
      deleteShape(s.layer.handle, s.shape.id);
      setSelected(undefined);
    } else if (e.key === "Escape") {
      setSelected(undefined);
      setTool("select");
    } else if (e.key.startsWith("Arrow") && s) {
      const n = e.shiftKey ? 5 : 1;
      const dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0;
      const dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      putShape(s.layer.handle, translate(s.shape, dx, dy));
    } else {
      const t = TOOLS.find((t) => t.key === e.key);
      if (!t) return;
      setTool(t.tool);
    }
    e.preventDefault();
  };

  // ---- the selection's own settings ----
  const pickColour = (i: number) => {
    setColour(i);
    editSelected((s) => (s.kind === "picture" ? undefined : { ...s, color: i }));
  };
  const toggleFill = () => {
    const next = !fill();
    setFill(next);
    editSelected((s) => (s.kind === "rect" || s.kind === "ellipse" ? { ...s, fill: next } : undefined));
  };
  const nudgeStroke = (by: number) => {
    const next = Math.max(1, Math.min(20, stroke() + by));
    setStroke(next);
    editSelected((s) => (s.kind === "picture" ? undefined : { ...s, stroke: next }));
  };
  // The selection's settings show while it's selected.
  createEffect(() => {
    const s = selection()?.shape;
    if (!s || s.kind === "picture") return;
    setColour(s.color);
    setStroke(s.stroke);
    if (s.kind === "rect" || s.kind === "ellipse") setFill(s.fill);
  });

  const visible = () => layers().filter((l) => l.shown);

  return (
    <div
      class="pwp"
      ref={rootEl}
      tabIndex={-1}
      onKeyDown={onKey}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer?.items ?? []).some((i) => i.type.startsWith("image/"))) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        const images = imagesIn(e.dataTransfer);
        if (images.length === 0) return;
        e.preventDefault();
        for (const f of images) void addPicture(f);
      }}
    >
      <patchwork-view ref={view} doc-url={docUrl} tool-id="patternwitch" />

      <Show when={canvasEl() && canvas()}>
        <svg
          ref={svg}
          class="pwp-overlay"
          data-tool={tool()}
          viewBox={`0 0 ${W()} ${H()}`}
          preserveAspectRatio="none"
          style={{
            left: `${place().left}px`,
            top: `${place().top}px`,
            width: `${place().width}px`,
            height: `${place().height}px`,
          }}
          onPointerDown={onBackground}
        >
          <For each={visible()}>
            {(layer) => (
              <g class="pwp-layer" data-active={layer === active() ? "" : undefined}>
                <For each={shapesOf(layer)}>
                  {(shape) => (
                    <g class="pwp-shape" onPointerDown={(e) => onShape(e, layer, shape)}>
                      <Outline shape={shape} hit />
                      <Outline shape={shape} />
                    </g>
                  )}
                </For>
              </g>
            )}
          </For>

          <Show when={draft()}>
            {(d) => (
              <Preview shape={d().shape} palette={palette()} pictureUrl={urlOf} />
            )}
          </Show>

          <Show when={framed()}>
            {(f) => {
              const b = () => bounds(f().shape);
              const size = () => 9 / scale();
              return (
                <g class="pwp-selection">
                  <rect
                    class="pwp-frame"
                    x={b().x}
                    y={b().y}
                    width={b().w}
                    height={b().h}
                    vector-effect="non-scaling-stroke"
                  />
                  <Show
                    when={f().shape.kind === "line" && (f().shape as StrokeShape)}
                    fallback={
                      <For each={HANDLES}>
                        {(edges) => (
                          <rect
                            class="pwp-handle"
                            x={b().x + ((edges[0] + 1) / 2) * b().w - size() / 2}
                            y={b().y + ((edges[1] + 1) / 2) * b().h - size() / 2}
                            width={size()}
                            height={size()}
                            style={{ cursor: CURSORS[edges.join(",")] }}
                            vector-effect="non-scaling-stroke"
                            onPointerDown={(e) => onHandle(e, edges)}
                          />
                        )}
                      </For>
                    }
                  >
                    {(line) => (
                      <For each={[0, 1] as (0 | 1)[]}>
                        {(which) => (
                          <circle
                            class="pwp-handle"
                            cx={line().points[which * 2]}
                            cy={line().points[which * 2 + 1]}
                            r={size() / 2}
                            vector-effect="non-scaling-stroke"
                            onPointerDown={(e) => onEnd(e, which)}
                          />
                        )}
                      </For>
                    )}
                  </Show>
                </g>
              );
            }}
          </Show>
        </svg>
      </Show>

      <div class="pwp-tools" role="toolbar" aria-label="pwp">
        <For each={TOOLS}>
          {(t) => (
            <button
              type="button"
              title={`${t.label} (${t.key})`}
              aria-pressed={tool() === t.tool}
              onClick={() => setTool(t.tool)}
            >
              <svg viewBox="0 0 24 24">{t.icon()}</svg>
            </button>
          )}
        </For>
        <button type="button" title="Picture (or paste / drop an image)" onClick={() => fileInput.click()}>
          <svg viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="1" />
            <path d="M3 16l5-5 4 4 3-3 6 6" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            for (const f of Array.from(e.currentTarget.files ?? [])) void addPicture(f);
            e.currentTarget.value = "";
          }}
        />

        <hr />

        <div class="pwp-swatches">
          <For each={palette()}>
            {(c, i) => (
              <button
                type="button"
                class="pwp-swatch"
                style={{ background: c }}
                title={`Colour ${i() + 1}`}
                aria-pressed={pen() === i()}
                onClick={() => pickColour(i())}
              />
            )}
          </For>
        </div>
        <button
          type="button"
          title={fill() ? "Filled (click for outline)" : "Outline (click to fill)"}
          aria-pressed={fill()}
          onClick={toggleFill}
        >
          <svg viewBox="0 0 24 24">
            <rect x="5" y="5" width="14" height="14" rx="1" fill={fill() ? "currentColor" : "none"} />
          </svg>
        </button>
        <div class="pwp-stroke" title="Line width, in pixels">
          <button type="button" onClick={() => nudgeStroke(-1)} aria-label="Thinner">−</button>
          <span>{stroke()}</span>
          <button type="button" onClick={() => nudgeStroke(1)} aria-label="Thicker">+</button>
        </div>

        <Show when={selection()}>
          {(s) => (
            <>
              <hr />
              <Show when={s().shape.kind === "picture" && (s().shape as PictureShape)}>
                {(pic) => (
                  <button
                    type="button"
                    title={pic().dither ? "Dithered (click for flat)" : "Flat (click to dither)"}
                    aria-pressed={pic().dither}
                    onClick={() => putShape(s().layer.handle, { ...pic(), dither: !pic().dither })}
                  >
                    <svg viewBox="0 0 24 24">
                      <path d="M5 5h3v3H5zM11 5h3v3h-3zM8 8h3v3H8zM14 8h3v3h-3zM5 11h3v3H5zM11 11h3v3h-3zM8 14h3v3H8zM14 14h3v3h-3zM17 5h2v3h-2zM17 11h2v3h-2z" fill="currentColor" stroke="none" />
                    </svg>
                  </button>
                )}
              </Show>
              <button type="button" title="Forward" onClick={() => restack(s().layer.handle, s().shape.id, 1)}>
                <svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
              </button>
              <button type="button" title="Back" onClick={() => restack(s().layer.handle, s().shape.id, -1)}>
                <svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
              </button>
              <button
                type="button"
                title="Delete (⌫)"
                data-danger
                onClick={() => {
                  deleteShape(s().layer.handle, s().shape.id);
                  setSelected(undefined);
                }}
              >
                <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>
              </button>
            </>
          )}
        </Show>
      </div>

      <div class="pwp-layers" data-open={layersOpen() ? "" : undefined}>
        <header>
          <button
            type="button"
            class="pwp-layers-toggle"
            onClick={() => setLayersOpen(!layersOpen())}
            aria-expanded={layersOpen()}
          >
            Layers
          </button>
          <button
            type="button"
            title="New layer"
            disabled={!target() || !folderHandle()}
            onClick={() => {
              const t = target();
              const f = folderHandle();
              if (!t || !f) return;
              const made = addLayer(root, t, f, `Layer ${layers().length + 1}`);
              setActiveUrl(made.url);
            }}
          >
            +
          </button>
        </header>
        <Show when={layersOpen()}>
          <Show
            when={layers().length}
            fallback={<p class="pwp-empty">Draw something to make a layer.</p>}
          >
            <ol>
              <For each={[...layers()].reverse()}>
                {(layer) => (
                  <LayerRow
                    layer={layer}
                    active={layer === active()}
                    first={layer === layers()[layers().length - 1]}
                    last={layer === layers()[0]}
                    onSelect={() => setActiveUrl(layer.link.url)}
                    onShow={(on) => folderHandle() && showLayer(folderHandle()!, layer, on)}
                    onRename={(name) => folderHandle() && rename(layer, folderHandle()!, name)}
                    onMove={(by) => folderHandle() && moveLayer(folderHandle()!, layers(), layer, by)}
                    onRemove={() => {
                      if (!folderHandle()) return;
                      if (selected()?.layer === layer.link.url) setSelected(undefined);
                      removeLayer(folderHandle()!, layer);
                    }}
                  />
                )}
              </For>
            </ol>
          </Show>
        </Show>
      </div>

      <Show when={noProvider()}>
        <p class="pwp-banner" role="status">
          No patch layers provider above pwp, so its layers aren't laid on the drawing. Open it
          in a frame that has the Patches tool installed.
        </p>
      </Show>

      <Show when={missing()}>
        {(message) => (
          <div class="pwp-error" role="alert">
            <strong>pwp can't draw here.</strong>
            <p>{message()}</p>
          </div>
        )}
      </Show>
    </div>
  );
}

/** A shape's outline, or (`hit`) the invisible area that picks it. */
function Outline(props: { shape: Shape; hit?: boolean }) {
  const attrs = (): Record<string, string | number> => {
    const s = props.shape;
    if (!props.hit) return { class: "pwp-outline", "vector-effect": "non-scaling-stroke" };
    const solid = filled(s);
    return {
      class: "pwp-hit",
      "stroke-width": Math.max(1.5, solid ? 0 : (s as { stroke: number }).stroke),
      "pointer-events": solid ? "all" : "stroke",
    };
  };
  return (
    <>
      {(() => {
        const shape = props.shape;
        if (isStroke(shape)) {
          return <polyline {...(attrs() as object)} points={shape.points.join(" ")} />;
        }
        if (shape.kind === "ellipse") {
          return (
            <ellipse
              {...(attrs() as object)}
              cx={shape.x + shape.w / 2}
              cy={shape.y + shape.h / 2}
              rx={shape.w / 2}
              ry={shape.h / 2}
            />
          );
        }
        return (
          <rect {...(attrs() as object)} x={shape.x} y={shape.y} width={shape.w} height={shape.h} />
        );
      })()}
    </>
  );
}

function filled(s: Shape) {
  return s.kind === "picture" || ((s.kind === "rect" || s.kind === "ellipse") && s.fill);
}

/** The shape being drawn or dragged, roughly as it'll land. */
function Preview(props: {
  shape: Shape;
  palette: string[];
  pictureUrl: (s: PictureShape) => string;
}) {
  const colourOf = (i: number) => props.palette[i] ?? props.palette[0] ?? "#000";
  return (
    <g class="pwp-preview">
      {(() => {
        const s = props.shape;
        if (s.kind === "picture") {
          return (
            <image
              href={props.pictureUrl(s)}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              preserveAspectRatio="none"
            />
          );
        }
        if (isStroke(s)) {
          return (
            <polyline
              points={s.points.join(" ")}
              fill="none"
              stroke={colourOf(s.color)}
              stroke-width={s.stroke}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          );
        }
        const paint = s.fill
          ? { fill: colourOf(s.color) }
          : { fill: "none", stroke: colourOf(s.color), "stroke-width": s.stroke };
        const i = s.fill ? 0 : s.stroke / 2;
        return s.kind === "ellipse" ? (
          <ellipse
            {...paint}
            cx={s.x + s.w / 2}
            cy={s.y + s.h / 2}
            rx={Math.max(0, s.w / 2 - i)}
            ry={Math.max(0, s.h / 2 - i)}
          />
        ) : (
          <rect
            {...paint}
            x={s.x + i}
            y={s.y + i}
            width={Math.max(0, s.w - 2 * i)}
            height={Math.max(0, s.h - 2 * i)}
          />
        );
      })()}
    </g>
  );
}

function LayerRow(props: {
  layer: Layer;
  active: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onShow: (on: boolean) => void;
  onRename: (name: string) => void;
  onMove: (by: 1 | -1) => void;
  onRemove: () => void;
}) {
  const name = () => props.layer.handle.doc()?.title || props.layer.link.name;
  return (
    <li
      class="pwp-layer-row"
      data-active={props.active ? "" : undefined}
      data-off={props.layer.shown ? undefined : ""}
      onClick={props.onSelect}
    >
      <button
        type="button"
        class="pwp-eye"
        title={props.layer.shown ? "Hide" : "Show"}
        aria-pressed={props.layer.shown}
        onClick={(e) => {
          e.stopPropagation();
          props.onShow(!props.layer.shown);
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <Show when={props.layer.shown} fallback={<path d="M4 4l16 16" />}>
            <circle cx="12" cy="12" r="3" />
          </Show>
        </svg>
      </button>
      <input
        value={name()}
        aria-label="Layer name"
        onFocus={props.onSelect}
        onChange={(e) => {
          const v = e.currentTarget.value.trim();
          if (v && v !== name()) props.onRename(v);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <button
        type="button"
        title="Forward"
        disabled={props.first}
        onClick={(e) => {
          e.stopPropagation();
          props.onMove(1);
        }}
      >
        ↑
      </button>
      <button
        type="button"
        title="Back"
        disabled={props.last}
        onClick={(e) => {
          e.stopPropagation();
          props.onMove(-1);
        }}
      >
        ↓
      </button>
      <button
        type="button"
        title="Remove from this browser's patches (the patch doc is kept)"
        data-danger
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        ×
      </button>
    </li>
  );
}
