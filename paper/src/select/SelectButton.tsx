import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
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
import { hitTestShape, shapeRef } from "./geometry";

// Mirrors the shared focus document the FocusProvider owns. We only touch
// `selection`; keys are composite `layerUrl#index` strings.
type FocusDoc = {
  selection: Record<string, true>;
};

type SurfacePointer = NonNullable<SurfaceState["pointer"]>;

// One shape participating in the current drag. `homeSurfaceUrl`/`grabOffset`
// are only known when the shape's home surface could be resolved from the
// pointer sample; without them the shape still drags but won't re-home on a
// cross-surface drop.
type DragShape = {
  ref: string;
  layerHandle: DocHandle<ShapeLayerDoc>;
  index: number;
  homeSurfaceUrl?: AutomergeUrl;
  // Shape origin minus pointer-down position, in the shape's home space.
  // Constant for the whole drag (the shape moves exactly with the pointer),
  // which is what makes drop placement a single addition in the drop space.
  grabOffset?: Point;
};

function parseRef(ref: string): { layerUrl: AutomergeUrl; index: number } {
  const i = ref.lastIndexOf("#");
  return {
    layerUrl: ref.slice(0, i) as AutomergeUrl,
    index: Number(ref.slice(i + 1)),
  };
}

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

  // Deltas are computed in screen coordinates: dragging an embed moves the
  // surface that stamps the samples, so local deltas would feed back into
  // themselves (the shape lagging and oscillating behind the cursor). The
  // screen frame is immune, and translation is the same in every frame.
  let drag: {
    shapes: DragShape[];
    last: Point;
  } | null = null;

  // The ref of the shape with the greatest `z` under the local point, if any.
  const topmostHit = async (
    surfaceUrl: AutomergeUrl,
    x: number,
    y: number,
  ): Promise<string | undefined> => {
    const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
    const layers = surfaceHandle.doc()?.layers ?? {};

    let best: { ref: string; z: number } | undefined;
    for (const layerUrl of Object.values(layers)) {
      const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
      const shapes = layerHandle.doc()?.shapes ?? [];
      shapes.forEach((shape: Shape, index: number) => {
        if (!hitTestShape(x, y, shape)) return;
        const z = shape.z ?? 0;
        if (!best || z >= best.z) best = { ref: shapeRef(layerUrl, index), z };
      });
    }
    return best?.ref;
  };

  // A miss on a nested surface resolves to that surface's embed shape in its
  // parent: find the embed pointing at `surfaceUrl` that contains the point
  // (`embed.origin + local` in parent coordinates), highest `z` wins.
  const embedHit = async (
    surfaceUrl: AutomergeUrl,
    parentSurfaceUrl: AutomergeUrl,
    x: number,
    y: number,
  ): Promise<string | undefined> => {
    const parentHandle = await repo.find<DocWithLayers>(parentSurfaceUrl);
    const layers = parentHandle.doc()?.layers ?? {};

    let best: { ref: string; z: number } | undefined;
    for (const layerUrl of Object.values(layers)) {
      const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
      const shapes = (layerHandle.doc()?.shapes ?? []) as EmbedShape[];
      shapes.forEach((shape, index) => {
        if (shape.docUrl !== surfaceUrl) return;
        if (!hitTestShape(shape.x + x, shape.y + y, shape)) return;
        const z = shape.z ?? 0;
        if (!best || z >= best.z) best = { ref: shapeRef(layerUrl, index), z };
      });
    }
    return best?.ref;
  };

  // Which of the two surfaces in the pointer sample owns `layerUrl`, if any.
  const findHomeSurface = async (
    layerUrl: AutomergeUrl,
    pointer: SurfacePointer,
  ): Promise<AutomergeUrl | undefined> => {
    const candidates = [pointer.surfaceUrl, pointer.parentSurfaceUrl];
    for (const surfaceUrl of candidates) {
      if (!surfaceUrl) continue;
      const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
      const layers = surfaceHandle.doc()?.layers ?? {};
      if (Object.values(layers).includes(layerUrl)) return surfaceUrl;
    }
    return undefined;
  };

  const resolveDragShapes = async (
    refs: string[],
    pointer: SurfacePointer,
    hitRef: string,
    hitSurfaceUrl: AutomergeUrl,
  ): Promise<DragShape[]> => {
    const { x, y } = pointer.position;
    const shapes: DragShape[] = [];

    for (const ref of refs) {
      const { layerUrl, index } = parseRef(ref);
      const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
      const shape = layerHandle.doc()?.shapes?.[index];
      if (!shape) continue;

      const dragShape: DragShape = { ref, layerHandle, index };

      const homeSurfaceUrl = await findHomeSurface(layerUrl, pointer);
      if (homeSurfaceUrl) {
        dragShape.homeSurfaceUrl = homeSurfaceUrl;
        if (ref === hitRef && hitSurfaceUrl !== pointer.surfaceUrl) {
          // Embed hit: the shape lives in the parent, the down sample is
          // local to the embedded surface. Parent-space down position is
          // `shape.origin + local`, so the offset collapses to `-local`.
          dragShape.grabOffset = { x: -x, y: -y };
        } else if (homeSurfaceUrl === pointer.surfaceUrl) {
          dragShape.grabOffset = { x: shape.x - x, y: shape.y - y };
        }
        // Other combinations (e.g. a leftover selection on another surface)
        // have no known transform into the down sample's space: drag them,
        // but skip re-homing.
      }

      shapes.push(dragShape);
    }
    return shapes;
  };

  const applyDelta = (pointer: SurfacePointer) => {
    if (!drag) return;
    const { x, y } = pointer.screenPosition;

    const dx = x - drag.last.x;
    const dy = y - drag.last.y;
    if (dx !== 0 || dy !== 0) {
      for (const dragShape of drag.shapes) {
        dragShape.layerHandle.change(({ shapes }) => {
          const shape = shapes[dragShape.index];
          if (!shape) return;
          shape.x += dx;
          shape.y += dy;
        });
      }
    }

    drag.last = { x, y };
  };

  // Move a dropped shape into the drop surface: same layer key as at home
  // (created on demand), placed at `drop + grabOffset`, removed from the
  // source layer, selection ref rewritten.
  const rehome = async (
    dragShape: DragShape,
    dropSurfaceUrl: AutomergeUrl,
    dropPosition: Point,
  ) => {
    const { layerHandle, index, homeSurfaceUrl, grabOffset } = dragShape;
    if (!homeSurfaceUrl || !grabOffset) return;

    const shape = layerHandle.doc()?.shapes?.[index];
    if (!shape) return;
    // An embed can't be dropped into its own document.
    if ((shape as EmbedShape).docUrl === dropSurfaceUrl) return;

    const homeHandle = await repo.find<DocWithLayers>(homeSurfaceUrl);
    const layerKey = Object.entries(homeHandle.doc()?.layers ?? {}).find(
      ([, url]) => url === layerHandle.url,
    )?.[0];
    if (!layerKey) return;

    const dropSurfaceHandle = await repo.find<DocWithLayers>(dropSurfaceUrl);
    const dropLayerUrl = dropSurfaceHandle.doc()?.layers[layerKey];
    let dropLayerHandle: DocHandle<ShapeLayerDoc>;
    if (dropLayerUrl) {
      dropLayerHandle = await repo.find<ShapeLayerDoc>(dropLayerUrl);
    } else {
      dropLayerHandle = await repo.create2<ShapeLayerDoc>({
        "@patchwork": { type: "shape-layer" },
        title: layerHandle.doc()?.title ?? "Layer",
        shapes: [],
      });
      dropSurfaceHandle.change(
        (surface) => (surface.layers[layerKey] = dropLayerHandle.url),
      );
    }

    const moved = JSON.parse(JSON.stringify(shape)) as Shape;
    moved.x = dropPosition.x + grabOffset.x;
    moved.y = dropPosition.y + grabOffset.y;

    let newIndex = 0;
    dropLayerHandle.change(({ shapes }) => {
      newIndex = shapes.length;
      shapes.push(moved);
    });
    layerHandle.change(({ shapes }) => {
      shapes.splice(index, 1);
    });

    focusHandle()?.change((doc) => {
      if (doc.selection?.[dragShape.ref]) {
        // Replace the whole map instead of deleting the key: map-key `del`
        // patches crash the projection's patch replay (automerge fragments
        // prerelease only handles array/string deletes).
        const next = { ...doc.selection };
        delete next[dragShape.ref];
        next[shapeRef(dropLayerHandle.url, newIndex)] = true;
        doc.selection = next;
      }
    });
  };

  const onPointerDown = async (pointer: SurfacePointer) => {
    const focus = focusHandle();
    if (!focus) return;

    const { x, y } = pointer.position;

    let hit = await topmostHit(pointer.surfaceUrl, x, y);
    let hitSurfaceUrl = pointer.surfaceUrl;
    if (!hit && pointer.parentSurfaceUrl) {
      hit = await embedHit(pointer.surfaceUrl, pointer.parentSurfaceUrl, x, y);
      hitSurfaceUrl = pointer.parentSurfaceUrl;
    }

    if (shiftDown) {
      focus.change((doc) => {
        // Same map-key delete workaround as in `rehome`.
        const next = { ...(doc.selection ?? {}) };
        if (!hit) {
          if (!doc.selection) doc.selection = next;
          return;
        }
        if (next[hit]) delete next[hit];
        else next[hit] = true;
        doc.selection = next;
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
    let refs: string[];
    if (current[hit]) {
      // Clicking an already-selected shape drags the whole selection.
      refs = Object.keys(current);
    } else {
      refs = [hit];
      focus.change((doc) => {
        doc.selection = { [hit]: true };
      });
    }

    drag = {
      shapes: await resolveDragShapes(refs, pointer, hit, hitSurfaceUrl),
      last: { ...pointer.screenPosition },
    };
  };

  const onPointerUp = async (pointer: SurfacePointer) => {
    const finished = drag;
    drag = null;
    if (!finished) return;

    // Apply the release sample like a final move before re-homing.
    drag = finished;
    applyDelta(pointer);
    drag = null;

    const dropSurfaceUrl = pointer.surfaceUrl;
    // Descending index order so splices don't shift the indices of shapes
    // still waiting to be re-homed from the same layer.
    const candidates = finished.shapes
      .filter(
        (shape) =>
          shape.homeSurfaceUrl &&
          shape.grabOffset &&
          shape.homeSurfaceUrl !== dropSurfaceUrl,
      )
      .sort((a, b) => b.index - a.index);
    for (const shape of candidates) {
      await rehome(shape, dropSurfaceUrl, pointer.position);
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
      applyDelta(pointer);
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

  // Remove every selected shape from every layer, splicing from the highest
  // index down so earlier indices stay valid.
  async function deleteSelected(selected: Record<string, true>) {
    const byLayer = new Map<AutomergeUrl, number[]>();
    for (const ref of Object.keys(selected)) {
      const { layerUrl, index } = parseRef(ref);
      const indices = byLayer.get(layerUrl) ?? [];
      indices.push(index);
      byLayer.set(layerUrl, indices);
    }
    for (const [layerUrl, indices] of byLayer) {
      const layerHandle = await repo.find<ShapeLayerDoc>(layerUrl);
      indices.sort((a, b) => b - a);
      layerHandle.change(({ shapes }) => {
        for (const index of indices) shapes.splice(index, 1);
      });
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
