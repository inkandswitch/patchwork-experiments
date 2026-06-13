import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "../vendor/automerge-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import { createEffect, createSignal, type JSX } from "solid-js";
import type {
  DocWithLayers,
  Point,
  ShapeLayerDoc,
  SurfaceState,
} from "../surface/types";
import type { RectShape } from "./RectLayerTool";

const FILL = "#9bb3cc";
const STROKE = "#6f8aa6";
// Discard rects smaller than this so a stray click leaves nothing behind.
const MIN_SIZE = 3;

// Selects the rectangle tool and draws rectangles into the rect layer.
// Selection and the drag pointer come over `surface:state`; the layer is read
// (and created on first draw) from the paper doc that `surface:state` points
// to. The drag anchors at the pointer-down origin so dragging in any
// direction grows the rect.
export function RectButton(): JSX.Element {
  const [root, setRoot] = createSignal<HTMLButtonElement>();

  const [surfaceState, surfaceStateHandle] = subscribeDoc<SurfaceState>(root, {
    type: "surface:state",
  });

  const active = () => surfaceState()?.selectedToolId === "rect-shape-layer";
  const [hovered, setHovered] = createSignal(false);
  const repo = useRepo();

  const getLayerHandle = async (surfaceUrl: AutomergeUrl) => {
    const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
    const rectShapeLayerUrl = surfaceHandle.doc()?.layers["rect-shape-layer"];

    if (rectShapeLayerUrl) {
      return repo.find<ShapeLayerDoc>(rectShapeLayerUrl);
    }

    const rectShapeLayerHandle = await repo.create2<ShapeLayerDoc>({
      "@patchwork": {
        type: "shape-layer",
      },
      title: "Rectangles",
      shapes: {},
    });
    surfaceHandle.change(
      (surface) =>
        (surface.layers["rect-shape-layer"] = rectShapeLayerHandle.url),
    );

    return rectShapeLayerHandle;
  };

  // The in-progress rect: a sub-handle scoped to the shape itself, pinned to
  // the surface it started on. Without pointer capture, samples can come from
  // other surfaces mid-gesture (the pointer crossing an embed), and those
  // must not resize this rect; the sub-handle can't supply the surface (its
  // document is the layer), so it is tracked alongside.
  let rect: {
    surfaceUrl: AutomergeUrl;
    handle: DocHandle<RectShape>;
    start: Point;
  } | null = null;

  // Anchor at the drag origin so dragging in any direction grows the rect.
  const resize = (shape: RectShape, start: Point, x: number, y: number) => {
    shape.x = Math.min(start.x, x);
    shape.y = Math.min(start.y, y);
    shape.outline.width = Math.abs(x - start.x);
    shape.outline.height = Math.abs(y - start.y);
  };

  let wasPressed = false;

  createEffect(async () => {
    const state = surfaceState();
    const pointer = state?.pointer;
    if (!pointer) {
      return;
    }

    if (state?.selectedToolId !== "rect-shape-layer") {
      // Tool inactive: drop any in-progress rect and keep the pressed
      // bookkeeping current, so re-enabling the tool mid-press or with a
      // stale pressed pointer doesn't spawn a rect at the old position.
      rect = null;
      wasPressed = pointer.isPressed;
      return;
    }

    // The pointer location in the stamping surface's own space; that surface
    // is where a fresh rect is drawn.
    const { x, y } = pointer.position;
    const isPressed = pointer.isPressed;
    const startedRect = !wasPressed && isPressed;
    const endedRect = wasPressed && !isPressed;
    // Update before the await: effect re-runs triggered during the await must
    // see the new value, otherwise every queued run looks like a pointer down.
    wasPressed = isPressed;

    if (startedRect) {
      const layerHandle = await getLayerHandle(pointer.surfaceUrl);
      if (!layerHandle) {
        return;
      }

      const id = crypto.randomUUID();
      layerHandle.change(({ shapes }) => {
        const z =
          Object.values(shapes).reduce((max, s) => Math.max(max, s.z ?? 0), 0) +
          1;

        shapes[id] = {
          id,
          x,
          y,
          z,
          outline: { type: "rectangle", width: 0, height: 0 },
          fill: FILL,
          stroke: STROKE,
        } as RectShape;
      });
      rect = {
        surfaceUrl: pointer.surfaceUrl,
        handle: layerHandle.sub("shapes", id) as DocHandle<RectShape>,
        start: { x, y },
      };
    } else if (endedRect) {
      if (
        rect &&
        pointer.surfaceUrl === rect.surfaceUrl &&
        rect.handle.doc() !== undefined
      ) {
        const { handle, start } = rect;
        handle.change((shape) => resize(shape, start, x, y));
        const outline = handle.doc()?.outline;
        if (
          outline &&
          (outline.width < MIN_SIZE || outline.height < MIN_SIZE)
        ) {
          handle.remove();
        }
      }
      rect = null;
    } else if (isPressed) {
      if (!rect || pointer.surfaceUrl !== rect.surfaceUrl) {
        return;
      }

      // The shape can vanish mid-gesture (deleted by another client).
      if (rect.handle.doc() === undefined) {
        return;
      }
      const { handle, start } = rect;
      handle.change((shape) => resize(shape, start, x, y));
    }
  });

  const toggle = (event: Event) => {
    event.stopPropagation();

    surfaceStateHandle()?.change((state) => {
      state.selectedToolId =
        state.selectedToolId === "rect-shape-layer" ? "" : "rect-shape-layer";
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
      title="Rectangle"
      aria-label="Draw rectangle"
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
        <rect
          x="3.5"
          y="5"
          width="13"
          height="10"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        />
      </svg>
    </button>
  );
}
