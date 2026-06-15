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

// One shape participating in the current drag. `handle` is a sub-handle
// scoped to the shape inside its layer doc; `homeSurfaceUrl` is the surface
// whose layer currently holds it. Both are rewritten in place when the drag
// crosses into another surface (see `reparentDrag`).
type DragShape = {
  handle: DocHandle<Shape>;
  homeSurfaceUrl: AutomergeUrl;
  // Shape origin minus pointer-down position, in the home surface's local
  // space. Constant while the shape stays on one surface; when the drag
  // crosses into a surface with a different scale, `reparentDrag` rescales it
  // (and the shape's own `scale`) by the surface scale ratio so the shape
  // keeps both its on-screen size and its position under the cursor.
  grabOffset: Point;
  // The home surface's current scale (screen px per local unit), captured at
  // pointer-down and updated on each crossing. Paired with the drop sample's
  // scale to compute the reparenting ratio.
  homeScale: number;
};

// Mirrors the shared focus document the FocusProvider owns. We only touch
// `selection`; keys are shape sub-document URLs (`handle.sub(...).url`).
type FocusDoc = {
  selection: Record<string, true>;
};

type SurfacePointer = NonNullable<SurfaceState["pointer"]>;

// The select tool. The button toggles select mode, but the component also owns
// all selection interaction: it hit-tests the pointer against the layers of
// the surface that stamped the sample, writes the selection into the shared
// focus doc, drags selected shapes by mutating `x`/`y`, re-homes shapes the
// moment a drag crosses into another surface, and deletes on
// Backspace/Delete. SelectionOverlay renders the highlights. Embedded
// surfaces are grabbed via their drag handle (see EmbedLayerTool): the top
// strip of the embed's outline, owned by the parent surface's DOM — pressing
// it stamps parent coordinates and the embed shape is hit like any other.
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

  // Select is the default tool: whenever no tool is selected (initial state,
  // or another tool toggled itself off), claim the slot. Runs only once the
  // state doc has loaded, so it never clobbers a real selection. Deferred a
  // tick: the effect fires synchronously from the state doc's own change
  // event (e.g. inside another button's toggle), and writing the same doc
  // re-entrantly trips automerge's wasm borrow ("recursive use of an
  // object"). The condition is re-checked after the tick.
  createEffect(() => {
    const state = surfaceState();
    if (!state || state.selectedToolId) return;
    queueMicrotask(() => {
      const handle = surfaceStateHandle();
      if (!handle || handle.doc()?.selectedToolId) return;
      handle.change((doc) => {
        doc.selectedToolId = "select";
      });
    });
  });

  let shiftDown = false;
  let wasPressed = false;

  // The shapes being dragged. Placement is absolute, not incremental: each
  // move places a shape at the stamped pointer position plus its constant
  // grab offset. Shapes are re-homed into the surface under the cursor as
  // soon as the drag crosses a boundary (reparentDrag), so a shape's home is
  // always the surface stamping the sample and the single position is always
  // in the right space.
  let drag: DragShape[] | null = null;
  // Reparenting is async (doc copy + remove); this guards against a second
  // overlapping pass duplicating a shape on rapid move samples.
  let reparenting = false;

  // The drag set is the selected shapes homed in the pressed surface: the
  // single pointer sample is in that surface's space, so only those have a
  // meaningful grab offset. Shapes selected on other surfaces stay selected
  // but hold still. Sub-document URLs are prefixed by their document's URL,
  // so "shape is inside this layer" is a prefix check.
  const resolveDragShapes = async (
    urls: AutomergeUrl[],
    pointer: SurfacePointer,
  ): Promise<DragShape[]> => {
    const surfaceHandle = await repo.find<DocWithLayers>(pointer.surfaceUrl);
    const layerUrls = Object.values(surfaceHandle.doc()?.layers ?? {});

    const shapes: DragShape[] = [];
    for (const url of urls) {
      if (!layerUrls.some((layerUrl) => url.startsWith(layerUrl))) continue;

      // The url points at the shape inside its layer doc, so find returns a
      // handle scoped to the shape itself.
      const handle = await repo.find<Shape>(url);
      const shape = handle.doc();
      if (!shape) continue;

      shapes.push({
        handle,
        homeSurfaceUrl: pointer.surfaceUrl,
        grabOffset: {
          x: shape.x - pointer.position.x,
          y: shape.y - pointer.position.y,
        },
        homeScale: pointer.scale,
      });
    }
    return shapes;
  };

  // Place every dragged shape homed in the sampling surface at the pointer
  // position plus its grab offset. Shapes mid-reparent (home not yet the
  // sampling surface) hold still until reparentDrag catches them up.
  const applyMove = (shapes: DragShape[], pointer: SurfacePointer) => {
    for (const dragShape of shapes) {
      const { handle, homeSurfaceUrl, grabOffset } = dragShape;
      if (homeSurfaceUrl !== pointer.surfaceUrl) continue;
      if (handle.doc() === undefined) continue;
      queueMicrotask(() => {
        handle.change((shape) => {
          shape.x = pointer.position.x + grabOffset.x;
          shape.y = pointer.position.y + grabOffset.y;
        });
      });
    }
  };

  // Re-home any dragged shape into the surface now under the cursor, so the
  // drag invariant (home === sampling surface) is restored as soon as a drag
  // crosses a boundary and the shape keeps following the pointer.
  const reparentDrag = async (shapes: DragShape[], pointer: SurfacePointer) => {
    if (reparenting) return;
    const movers = shapes.filter(
      (shape) => shape.homeSurfaceUrl !== pointer.surfaceUrl,
    );
    if (movers.length === 0) return;

    reparenting = true;
    try {
      for (const dragShape of movers) {
        await rehome(
          dragShape,
          pointer.surfaceUrl,
          pointer.position,
          pointer.scale,
        );
      }
    } finally {
      reparenting = false;
    }
  };

  // Move a dragged shape into the target surface: same layer key as at home
  // (created on demand), placed at `position + grabOffset`, removed from the
  // source layer, selection url rewritten, and the drag entry repointed at
  // the new sub-handle. The shape keeps its id across the move (ids are
  // uuids, so they can't collide in the target layer). The shape's `scale`
  // and the grab offset are multiplied by the source/target scale ratio so it
  // keeps its on-screen size and stays under the cursor when the surfaces zoom
  // differently (e.g. paper <-> a zoomed map).
  const rehome = async (
    dragShape: DragShape,
    dropSurfaceUrl: AutomergeUrl,
    dropPosition: Point,
    dropScale: number,
  ) => {
    const { handle, homeSurfaceUrl, grabOffset, homeScale } = dragShape;

    const shape = handle.doc();
    if (!shape) return;
    // An embed can't be dropped into its own document. Refusing here means a
    // pointer that slipped off the embed's drag handle onto the embed itself
    // just stalls the embed until the cursor moves back out.
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
      queueMicrotask(() => {
        dropSurfaceHandle.change(
          (surface) => (surface.layers[layerKey] = dropLayerHandle.url),
        );
      });
    }

    // Screen px per local unit at home vs. at the drop. Geometry is stored in
    // logical px so it ports as-is; only the shape's scale and the grab offset
    // (in world units) need converting by the ratio so nothing visibly jumps.
    const ratio = homeScale / dropScale;

    const moved = JSON.parse(JSON.stringify(shape)) as Shape;
    moved.scale = shape.scale * ratio;
    moved.x = dropPosition.x + grabOffset.x * ratio;
    moved.y = dropPosition.y + grabOffset.y * ratio;

    queueMicrotask(() => {
      dropLayerHandle.change(({ shapes }) => {
        shapes[id] = moved;
      });
    });
    handle.remove();

    focusHandle()?.change((doc) => {
      if (doc.selection?.[handle.url]) {
        delete doc.selection[handle.url];
        doc.selection[dropLayerHandle.sub("shapes", id).url] = true;
      }
    });

    // Repoint the drag entry so subsequent moves keep following the pointer
    // in the new surface, and rebase its scale/offset to the new home so a
    // further crossing computes its ratio correctly.
    dragShape.handle = dropLayerHandle.sub("shapes", id) as DocHandle<Shape>;
    dragShape.homeSurfaceUrl = dropSurfaceUrl;
    dragShape.homeScale = dropScale;
    dragShape.grabOffset = {
      x: grabOffset.x * ratio,
      y: grabOffset.y * ratio,
    };
  };

  const onPointerDown = async (pointer: SurfacePointer) => {
    const focus = focusHandle();
    if (!focus) return;

    // The surface already hit-tested as it stamped the sample.
    const hit = pointer.shapeUrl;

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

  // Reparenting happens during the drag, so the release is just a final move
  // plus a catch-up pass for shapes the last crossing hadn't re-homed yet.
  const onPointerUp = async (pointer: SurfacePointer) => {
    const finished = drag;
    drag = null;
    if (!finished) return;

    applyMove(finished, pointer);
    await reparentDrag(finished, pointer);
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
    } else if (isPressed && drag) {
      applyMove(drag, pointer);
      void reparentDrag(drag, pointer);
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

  // Select is the default tool, so clicking it never toggles it off — it
  // only switches back from another tool (toggling off would immediately be
  // undone by the default-selection effect anyway).
  const select = (event: Event) => {
    event.stopPropagation();

    surfaceStateHandle()?.change((state) => {
      state.selectedToolId = "select";
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
      onClick={select}
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
