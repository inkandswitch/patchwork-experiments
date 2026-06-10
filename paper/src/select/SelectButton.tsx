import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "../vendor/automerge-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type {
  DocWithLayers,
  Point,
  Shape,
  ShapeLayerDoc,
  SurfaceState,
} from "../surface/types";
import type { EmbedShape } from "../embed/EmbedLayerTool";
import { hitTestShape } from "./geometry";

// Mirrors the shared focus document the FocusProvider owns. We only touch
// `selection`; keys are shape sub-document URLs (`handle.sub(...).url`).
type FocusDoc = {
  selection: Record<string, true>;
};

type SurfacePointer = NonNullable<SurfaceState["pointer"]>;

// One shape participating in the current drag. `handle` is a sub-handle
// scoped to the shape inside its layer doc. `homeSurfaceUrl`/`grabOffset`
// are only known when the shape's home surface could be resolved from the
// pointer sample; without them the shape still drags but won't re-home on a
// cross-surface drop.
type DragShape = {
  handle: DocHandle<Shape>;
  homeSurfaceUrl?: AutomergeUrl;
  // Shape origin minus pointer-down position, in the shape's home space.
  // Constant for the whole drag (the shape moves exactly with the pointer),
  // which is what makes drop placement a single addition in the drop space.
  grabOffset?: Point;
};

// The select tool. The button toggles select mode, but the component also owns
// all selection interaction: it hit-tests the pointer against the layers of
// the surface that stamped the sample (ascending to the parent's embed shape
// on a miss), writes the selection into the shared focus doc, drags selected
// shapes by mutating `x`/`y`, re-homes shapes dropped on another surface, and
// deletes on Backspace/Delete. SelectionOverlay renders the highlights.
export function SelectButton(): JSX.Element {
  const [root, setRoot] = createSignal<HTMLButtonElement>();

  const [surfaceState, surfaceStateHandle] = subscribeDoc<SurfaceState>(root, {
    type: "surface:state",
  });

  const [focusDoc, focusHandle] = subscribeDoc<FocusDoc>(root, {
    type: "patchwork:focus",
  });

  const active = () => surfaceState()?.selectedToolId === "select";
  const [hovered, setHovered] = createSignal(false);
  const repo = useRepo();

  let shiftDown = false;
  let wasPressed = false;

  // The shapes being dragged. Placement is absolute, not incremental: each
  // move reads the pointer position in a shape's home surface space (from the
  // pointer's per-surface `positions`) and adds the constant grab offset.
  // This needs no screen frame: a shape's home surface is never moved by
  // dragging that shape, so its stamped position is a stable reference. A
  // shape whose home isn't under the cursor this sample simply holds still
  // until it can be placed (e.g. on drop, via rehome).
  let drag: DragShape[] | null = null;

  // The sub-document URL of the shape with the greatest `z` under the local
  // point, if any.
  const topmostHit = async (
    surfaceUrl: AutomergeUrl,
    x: number,
    y: number,
  ): Promise<AutomergeUrl | undefined> => {
    const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
    const layers = surfaceHandle.doc()?.layers ?? {};

    let bestUrl: AutomergeUrl | undefined;
    let bestZ: number | undefined;
    for (const layerUrl of Object.values(layers)) {
      const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
      const shapes = layerHandle.doc()?.shapes ?? {};
      for (const shape of Object.values(shapes)) {
        if (!hitTestShape(x, y, shape)) continue;
        const z = shape.z ?? 0;
        if (bestZ === undefined || z >= bestZ) {
          bestUrl = layerHandle.sub("shapes", shape.id).url;
          bestZ = z;
        }
      }
    }
    return bestUrl;
  };

  // A miss on the innermost surface resolves to that surface's embed shape in
  // an ancestor. The ancestor candidates are simply the other surfaces under
  // the cursor (the other keys in `positions`); for each, look for an embed
  // pointing at the innermost surface that contains that ancestor's own
  // stamped position. No coordinate conversion: each surface already supplied
  // its own-space point, so this works even when the inner surface (e.g. a
  // map) uses different units than the parent. Highest `z` wins.
  const embedHit = async (
    pointer: SurfacePointer,
  ): Promise<AutomergeUrl | undefined> => {
    const innerUrl = pointer.surfaceUrl;

    let bestUrl: AutomergeUrl | undefined;
    let bestZ: number | undefined;
    for (const [candidateUrl, position] of Object.entries(pointer.positions)) {
      if (candidateUrl === innerUrl) continue;
      const parentHandle = await repo.find<DocWithLayers>(
        candidateUrl as AutomergeUrl,
      );
      const layers = parentHandle.doc()?.layers ?? {};
      for (const layerUrl of Object.values(layers)) {
        const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
        const shapes = (layerHandle.doc()?.shapes ?? {}) as Record<
          string,
          EmbedShape
        >;
        for (const shape of Object.values(shapes)) {
          if (shape.docUrl !== innerUrl) continue;
          if (!hitTestShape(position.x, position.y, shape)) continue;
          const z = shape.z ?? 0;
          if (bestZ === undefined || z >= bestZ) {
            bestUrl = layerHandle.sub("shapes", shape.id).url;
            bestZ = z;
          }
        }
      }
    }
    return bestUrl;
  };

  // Which surface under the cursor owns the layer the shape url lives in, if
  // any. The candidates are every surface in the pointer sample. Sub-document
  // URLs are prefixed by their document's URL, so "url is inside this layer"
  // is a prefix check.
  const findHomeSurface = async (
    shapeUrl: AutomergeUrl,
    pointer: SurfacePointer,
  ): Promise<AutomergeUrl | undefined> => {
    for (const surfaceUrl of Object.keys(pointer.positions) as AutomergeUrl[]) {
      const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
      const layers = surfaceHandle.doc()?.layers ?? {};
      if (
        Object.values(layers).some((layerUrl) => shapeUrl.startsWith(layerUrl))
      ) {
        return surfaceUrl;
      }
    }
    return undefined;
  };

  const resolveDragShapes = async (
    urls: AutomergeUrl[],
    pointer: SurfacePointer,
  ): Promise<DragShape[]> => {
    const shapes: DragShape[] = [];

    for (const url of urls) {
      // The url points at the shape inside its layer doc, so find returns a
      // handle scoped to the shape itself.
      const handle = await repo.find<Shape>(url);
      const shape = handle.doc();
      if (!shape) continue;

      const dragShape: DragShape = { handle };

      const homeSurfaceUrl = await findHomeSurface(url, pointer);
      if (homeSurfaceUrl) {
        dragShape.homeSurfaceUrl = homeSurfaceUrl;
        // The grab offset is the shape origin minus the pointer position in
        // the shape's home space — the same space the shape's x/y live in, so
        // no conversion. Constant for the whole drag. A home surface that
        // isn't under the cursor at press time has no stamped position; that
        // shape drags only once its home comes under the cursor.
        const home = pointer.positions[homeSurfaceUrl];
        if (home) {
          dragShape.grabOffset = { x: shape.x - home.x, y: shape.y - home.y };
        }
      }

      shapes.push(dragShape);
    }
    return shapes;
  };

  // Place every dragged shape at its home-space pointer position plus the
  // constant grab offset. Shapes whose home surface isn't under the cursor
  // this sample (no stamped position, or no resolved offset) hold still.
  const applyMove = (pointer: SurfacePointer) => {
    if (!drag) return;

    for (const dragShape of drag) {
      const { handle, homeSurfaceUrl, grabOffset } = dragShape;
      if (!homeSurfaceUrl || !grabOffset) continue;
      const home = pointer.positions[homeSurfaceUrl];
      if (!home) continue;
      if (handle.doc() === undefined) continue;
      handle.change((shape) => {
        shape.x = home.x + grabOffset.x;
        shape.y = home.y + grabOffset.y;
      });
    }
  };

  // Move a dropped shape into the drop surface: same layer key as at home
  // (created on demand), placed at `drop + grabOffset`, removed from the
  // source layer, selection url rewritten. The shape keeps its id across the
  // move (ids are uuids, so they can't collide in the drop layer).
  const rehome = async (
    dragShape: DragShape,
    dropSurfaceUrl: AutomergeUrl,
    dropPosition: Point,
  ) => {
    const { handle, homeSurfaceUrl, grabOffset } = dragShape;
    if (!homeSurfaceUrl || !grabOffset) return;

    const shape = handle.doc();
    if (!shape) return;
    // An embed can't be dropped into its own document.
    if ((shape as EmbedShape).docUrl === dropSurfaceUrl) return;

    // The shape's map key is the last segment of the sub-handle's path.
    const id = String(handle.path.at(-1)?.prop);

    const homeHandle = await repo.find<DocWithLayers>(homeSurfaceUrl);
    const sourceLayer = Object.entries(homeHandle.doc()?.layers ?? {}).find(
      ([, layerUrl]) => handle.url.startsWith(layerUrl),
    );
    if (!sourceLayer) return;
    const [layerKey, sourceLayerUrl] = sourceLayer;

    const dropSurfaceHandle = await repo.find<DocWithLayers>(dropSurfaceUrl);
    const dropLayerUrl = dropSurfaceHandle.doc()?.layers[layerKey];
    let dropLayerHandle: DocHandle<ShapeLayerDoc>;
    if (dropLayerUrl) {
      dropLayerHandle = await repo.find<ShapeLayerDoc>(dropLayerUrl);
    } else {
      const sourceLayerHandle = await repo.find<ShapeLayerDoc>(sourceLayerUrl);
      dropLayerHandle = await repo.create2<ShapeLayerDoc>({
        "@patchwork": { type: "shape-layer" },
        title: sourceLayerHandle.doc()?.title ?? "Layer",
        shapes: {},
      });
      dropSurfaceHandle.change(
        (surface) => (surface.layers[layerKey] = dropLayerHandle.url),
      );
    }

    const moved = JSON.parse(JSON.stringify(shape)) as Shape;
    moved.x = dropPosition.x + grabOffset.x;
    moved.y = dropPosition.y + grabOffset.y;

    dropLayerHandle.change(({ shapes }) => {
      shapes[id] = moved;
    });
    handle.remove();

    focusHandle()?.change((doc) => {
      if (doc.selection?.[handle.url]) {
        delete doc.selection[handle.url];
        doc.selection[dropLayerHandle.sub("shapes", id).url] = true;
      }
    });
  };

  const onPointerDown = async (pointer: SurfacePointer) => {
    const focus = focusHandle();
    if (!focus) return;

    const innermost = pointer.positions[pointer.surfaceUrl];
    if (!innermost) return;
    const { x, y } = innermost;

    let hit = await topmostHit(pointer.surfaceUrl, x, y);
    if (!hit) {
      hit = await embedHit(pointer);
    }

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
    let urls: AutomergeUrl[];
    if (current[hit]) {
      // Clicking an already-selected shape drags the whole selection.
      urls = Object.keys(current) as AutomergeUrl[];
    } else {
      urls = [hit];
      focus.change((doc) => {
        doc.selection = { [hit]: true };
      });
    }

    drag = await resolveDragShapes(urls, pointer);
  };

  const onPointerUp = async (pointer: SurfacePointer) => {
    const finished = drag;
    drag = null;
    if (!finished) return;

    // Apply the release sample like a final move before re-homing.
    drag = finished;
    applyMove(pointer);
    drag = null;

    const dropSurfaceUrl = pointer.surfaceUrl;
    const dropPosition = pointer.positions[dropSurfaceUrl];
    if (!dropPosition) return;

    const candidates = finished.filter(
      (shape) =>
        shape.homeSurfaceUrl &&
        shape.grabOffset &&
        shape.homeSurfaceUrl !== dropSurfaceUrl,
    );
    for (const shape of candidates) {
      await rehome(shape, dropSurfaceUrl, dropPosition);
    }
  };

  createEffect(async () => {
    const state = surfaceState();
    const pointer = state?.pointer;
    if (!pointer) {
      return;
    }

    if (state?.selectedToolId !== "select") {
      // Tool inactive: drop any in-progress drag and keep the pressed
      // bookkeeping current, so re-enabling the tool with a stale pressed
      // pointer doesn't start a drag at the old position.
      drag = null;
      wasPressed = pointer.isPressed;
      return;
    }

    const isPressed = pointer.isPressed;
    const startedPress = !wasPressed && isPressed;
    const endedPress = wasPressed && !isPressed;
    // Update before any await: effect re-runs triggered while a handler is
    // pending must see the new value.
    wasPressed = isPressed;

    if (startedPress) {
      await onPointerDown(pointer);
    } else if (endedPress) {
      await onPointerUp(pointer);
    } else if (isPressed) {
      applyMove(pointer);
    }
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
    void deleteSelected(selected);
    focus.change((doc) => {
      doc.selection = {};
    });
  }

  // Remove every selected shape: each url resolves to a handle scoped to the
  // shape, and `remove` deletes it from its layer.
  async function deleteSelected(selected: Record<string, true>) {
    for (const url of Object.keys(selected)) {
      const handle = await repo.find<Shape>(url as AutomergeUrl);
      if (handle.doc() === undefined) continue;
      handle.remove();
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === "Shift") shiftDown = false;
  }
  function onBlur() {
    shiftDown = false;
  }

  const toggle = (event: Event) => {
    event.stopPropagation();

    surfaceStateHandle()?.change((state) => {
      state.selectedToolId = state.selectedToolId === "select" ? "" : "select";
    });
  };

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
      ref={setRoot}
      type="button"
      style={buttonStyle()}
      title="Select"
      aria-label="Select"
      aria-pressed={active()}
      onClick={toggle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Native (non-delegated) listeners: they run while the event bubbles
      // through the button, before the surface root's own listeners, so
      // pressing the button never reads as drawing on the surface.
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
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
