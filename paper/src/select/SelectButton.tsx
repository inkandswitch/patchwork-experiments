import {
  createEffect,
  createSignal,
  mapArray,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { useDocument, useRepo } from "@automerge/automerge-repo-solid-primitives";
import { subscribeDoc } from "@inkandswitch/patchwork-providers-solid";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type {
  DocWithLayers,
  Point,
  ShapeLayerDoc,
  SurfacePointer,
  SurfaceTool,
} from "../surface/types";
import { hitTestShape, shapeRef } from "./geometry";

// A live view of one layer the select tool reads on demand. `getDoc` returns
// the handle's current document (read imperatively at event time), so no
// reactive snapshot is needed.
type LayerEntry = {
  url: AutomergeUrl;
  getDoc: () => ShapeLayerDoc | undefined;
  getHandle: () => DocHandle<ShapeLayerDoc> | undefined;
};

// One layer's worth of an in-progress drag: the handle to mutate plus, per
// selected shape, its index and the origin it had when the drag began.
type DragGroup = {
  handle: DocHandle<ShapeLayerDoc>;
  items: { index: number; x0: number; y0: number }[];
};

// The select tool. The button toggles select mode, but the component also owns
// all selection interaction: it reads every layer (from the surface doc that
// `surface:pointer` points to), hit-tests the pointer, writes the selection
// into the shared focus doc, deletes on Backspace/Delete, and drags selected
// shapes by mutating their `x`/`y`. SelectionOverlay only renders the
// highlights for whatever is here.
export function SelectButton(): JSX.Element {
  let root!: HTMLButtonElement;

  const [tool, toolHandle] = subscribeDoc<SurfaceTool>(() => root, {
    type: "surface:tool",
  });
  const [getPointer] = subscribeDoc<SurfacePointer>(() => root, {
    type: "surface:pointer",
  });
  const [surface] = useDocument<DocWithLayers>(() => getPointer()?.surfaceUrl);
  const layers = () => surface()?.layers ?? {};
  const [focusDoc, focusHandle] = subscribeDoc<{
    selection: Record<string, true>;
    highlight: Record<string, true>;
  }>(() => root, {
    type: "patchwork:focus",
  });

  const active = () => tool()?.toolId === "select";
  const [hovered, setHovered] = createSignal(false);

  // Hit detection, deletion, and dragging read layers imperatively at event
  // time. The registry keeps a live handle/doc accessor per layer, tracking the
  // layer list from the paper doc.
  const registry = getLayerDocs(layers);
  let shiftDown = false;

  // Drag state: null snapshot means "not dragging".
  let dragStart: Point = { x: 0, y: 0 };
  let snapshot: DragGroup[] = [];
  let dragging = false;

  // Turn the stream of `surface:pointer` snapshots into discrete down / move /
  // up calls by watching the `isPressed` edge, mirroring LineButton.
  let wasPressed = false;
  createEffect(() => {
    const pointer = getPointer();
    if (!pointer) return;
    const position = pointer.position;
    if (!wasPressed && pointer.isPressed) {
      if (position) pointerDown(position);
    } else if (wasPressed && !pointer.isPressed) {
      pointerUp();
    } else if (position) {
      pointerMove(position);
    }
    wasPressed = pointer.isPressed;
  });

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  });

  const toggle = () => {
    toolHandle()?.change((doc) => {
      doc.toolId = doc.toolId === "select" ? "" : "select";
    });
  };

  // On press: shift-click toggles the hit shape (no drag); a plain click on
  // empty space clears the selection; a plain click on a shape selects it (if
  // not already) and begins dragging the whole selection.
  function pointerDown(point: Point) {
    if (!active()) return;
    const focus = focusHandle();
    if (!focus) return;

    const hit = topmostHit(point);
    if (shiftDown) {
      focus.change((doc) => {
        if (!doc.selection) doc.selection = {};
        if (!hit) return;
        if (doc.selection[hit]) delete doc.selection[hit];
        else doc.selection[hit] = true;
      });
      return;
    }
    if (!hit) {
      focus.change((doc) => {
        doc.selection = {};
      });
      return;
    }

    const current = focusDoc()?.selection ?? {};
    let keys: string[];
    if (current[hit]) {
      keys = Object.keys(current);
    } else {
      keys = [hit];
      focus.change((doc) => {
        doc.selection = { [hit]: true };
      });
    }
    beginDrag(point, keys);
  }

  // Snapshot the origin of every selected shape, grouped by layer so each move
  // issues one `change()` per layer. Indices are stable for the drag's
  // duration (we never add/remove shapes mid-drag).
  function beginDrag(point: Point, keys: string[]) {
    const selected = new Set(keys);
    const groups: DragGroup[] = [];
    for (const entry of registry.values()) {
      const handle = entry.getHandle();
      if (!handle) continue;
      const items: DragGroup["items"] = [];
      (entry.getDoc()?.shapes ?? []).forEach((shape, index) => {
        if (selected.has(shapeRef(entry.url, index))) {
          items.push({ index, x0: shape.x, y0: shape.y });
        }
      });
      if (items.length) groups.push({ handle, items });
    }
    if (groups.length === 0) return;
    dragStart = point;
    snapshot = groups;
    dragging = true;
  }

  function pointerMove(point: Point) {
    if (!dragging || !active()) return;
    const dx = point.x - dragStart.x;
    const dy = point.y - dragStart.y;
    for (const group of snapshot) {
      group.handle.change((doc) => {
        for (const { index, x0, y0 } of group.items) {
          const shape = doc.shapes[index];
          if (!shape) continue;
          shape.x = x0 + dx;
          shape.y = y0 + dy;
        }
      });
    }
  }

  function pointerUp() {
    dragging = false;
    snapshot = [];
  }

  // The ref of the shape with the greatest `z` under `point`, if any.
  function topmostHit(point: Point): string | undefined {
    let best: { ref: string; z: number } | undefined;
    for (const entry of registry.values()) {
      const shapes = entry.getDoc()?.shapes ?? [];
      shapes.forEach((shape, index) => {
        if (!hitTestShape(shape, point)) return;
        const z = shape.z ?? 0;
        if (!best || z >= best.z) best = { ref: shapeRef(entry.url, index), z };
      });
    }
    return best?.ref;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Shift") {
      shiftDown = true;
      return;
    }
    if (!active()) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const focus = focusHandle();
    const selected = focusDoc()?.selection;
    if (!focus || !selected || Object.keys(selected).length === 0) return;
    event.preventDefault();
    deleteSelected(selected);
    focus.change((doc) => {
      doc.selection = {};
    });
  }

  // Remove every selected shape from every layer, splicing from the highest
  // index down so earlier indices stay valid.
  function deleteSelected(selected: Record<string, true>) {
    for (const entry of registry.values()) {
      const handle = entry.getHandle();
      if (!handle) continue;
      const shapes = entry.getDoc()?.shapes ?? [];
      const indices: number[] = [];
      for (let i = 0; i < shapes.length; i++) {
        if (selected[shapeRef(entry.url, i)]) indices.push(i);
      }
      if (indices.length === 0) continue;
      handle.change((doc) => {
        for (let k = indices.length - 1; k >= 0; k--)
          doc.shapes.splice(indices[k], 1);
      });
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === "Shift") shiftDown = false;
  }
  function onBlur() {
    shiftDown = false;
  }

  const buttonStyle = (): JSX.CSSProperties => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    width: "34px",
    height: "34px",
    padding: "0",
    border: `1px solid ${active() ? "#1c1917" : "rgba(28, 25, 23, 0.1)"}`,
    "border-radius": "10px",
    background: active()
      ? "#1c1917"
      : hovered()
        ? "#ffffff"
        : "rgba(255, 255, 255, 0.9)",
    "box-shadow": "0 1px 3px rgba(28, 25, 23, 0.18)",
    "backdrop-filter": "blur(6px)",
    color: active() ? "#fafaf9" : "#44403c",
    cursor: "pointer",
    "pointer-events": "auto",
    transition:
      "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
  });

  return (
    <button
      ref={root}
      type="button"
      style={buttonStyle()}
      title="Select"
      aria-label="Select"
      aria-pressed={active()}
      data-surface-no-draw
      onClick={toggle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path
          d="M4 3 L4 16 L8 12.5 L10.5 17 L12.5 16 L10 11.5 L15 11.5 Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}

// Builds a live registry of every layer doc the select tool reads imperatively
// (for hit-testing, deletion, and dragging). It tracks the layer list with
// `mapArray` — the same diffing `<For>` uses, but without rendering — resolving
// each layer's handle from the repo and subscribing to it, then unsubscribing
// and unregistering when the layer leaves the list (or the owner is disposed).
function getLayerDocs(
  layers: () => Record<string, AutomergeUrl>,
): Map<AutomergeUrl, LayerEntry> {
  const repo = useRepo();
  const registry = new Map<AutomergeUrl, LayerEntry>();

  const tracked = mapArray(
    () => Object.values(layers()),
    (url) => {
      let handle: DocHandle<ShapeLayerDoc> | undefined;
      let alive = true;
      // The tool reads `handle.doc()` on demand, so the listener has no work to
      // do today; it is the hook point for reacting to live layer edits.
      const onChange = () => {};

      registry.set(url, {
        url,
        getDoc: () => {
          try {
            return handle?.isReady() ? handle.doc() : undefined;
          } catch {
            return undefined;
          }
        },
        getHandle: () => handle,
      });

      void repo.find<ShapeLayerDoc>(url).then((resolved) => {
        if (!alive) return;
        handle = resolved;
        resolved.on("change", onChange);
      });

      onCleanup(() => {
        alive = false;
        handle?.off("change", onChange);
        registry.delete(url);
      });

      return url;
    },
  );

  // `mapArray` is lazy: read it inside an effect so each layer's setup runs and
  // stays alive for the component's lifetime.
  createEffect(() => tracked());

  return registry;
}
