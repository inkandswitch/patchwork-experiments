import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import { createEffect, createSignal, type JSX } from "solid-js";
import type {
  DocWithLayers,
  ShapeLayerDoc,
  SurfaceState,
} from "../surface/types";
import type { LineShape } from "./LineLayerTool";

const STROKE = "#64748b";
const SIZE = 8;
// Skip pointer samples closer than this (px) to the last one: keeps the stored
// path — and the Automerge change log — from exploding while staying smooth.
const MIN_POINT_DISTANCE = 2;
// Discard strokes shorter than this so a stray click/tap leaves nothing behind.
const MIN_LENGTH = 4;

// Selects the freehand tool and draws strokes into the line layer. Selection
// and the drag pointer come over `surface:state`; the layer is read (and
// created on first draw) from the paper doc that `surface:state` points to.
// Every pointer sample becomes a point in the stroke's outline; rendering
// expands it with perfect-freehand. The button dispatches from its own
// element, so there's no Solid context.
export function LineButton(): JSX.Element {
  const [root, setRoot] = createSignal<HTMLDivElement>();

  const [surfaceState, surfaceStateHandle] = subscribeDoc<SurfaceState>(root, {
    type: "surface:state",
  });

  const active = () => surfaceState()?.selectedToolId === "line-shape-layer";
  const [hovered, setHovered] = createSignal(false);
  const repo = useRepo();

  const getLayerHandle = async (surfaceUrl: AutomergeUrl) => {
    const surfaceHandle = await repo.find<DocWithLayers>(surfaceUrl);
    const lineShapeLayerUrl = surfaceHandle.doc()?.layers["line-shape-layer"];

    if (lineShapeLayerUrl) {
      return repo.find<ShapeLayerDoc>(lineShapeLayerUrl);
    }

    const lineShapeLayerHandle = await repo.create2<ShapeLayerDoc>({
      "@patchwork": {
        type: "shape-layer",
      },
      title: "Lines",
      shapes: [],
    });
    surfaceHandle.change(
      (surface) =>
        (surface.layers["line-shape-layer"] = lineShapeLayerHandle.url),
    );

    return lineShapeLayerHandle;
  };

  // The in-progress stroke is pinned to the surface it started on: without
  // pointer capture, samples can come from other surfaces mid-gesture (the
  // pointer crossing an embed), and those must not extend this stroke.
  let stroke: {
    surfaceUrl: AutomergeUrl;
    layerHandle: DocHandle<ShapeLayerDoc>;
    index: number;
  } | null = null;

  let wasPressed = false;

  createEffect(async () => {
    const state = surfaceState();
    const pointer = state?.pointer;
    if (!pointer) {
      return;
    }

    if (state?.selectedToolId !== "line-shape-layer") {
      // Tool inactive: drop any in-progress stroke and keep the pressed
      // bookkeeping current, so re-enabling the tool mid-press or with a
      // stale pressed pointer doesn't spawn a line at the old position.
      stroke = null;
      wasPressed = pointer.isPressed;
      return;
    }

    const { x, y } = pointer.position;
    const isPressed = pointer.isPressed;
    const startedStroke = !wasPressed && isPressed;
    const endedStroke = wasPressed && !isPressed;
    // Update before the await: effect re-runs triggered during the await must
    // see the new value, otherwise every queued run looks like a pointer down.
    wasPressed = isPressed;

    if (startedStroke) {
      const layerHandle = await getLayerHandle(pointer.surfaceUrl);
      if (!layerHandle) {
        return;
      }

      layerHandle.change(({ shapes }) => {
        stroke = { surfaceUrl: pointer.surfaceUrl, layerHandle, index: shapes.length };

        shapes.push({
          x,
          y,
          z: 1,
          outline: { type: "line", points: [{ x: 0, y: 0 }] },
          stroke: STROKE,
          strokeWidth: SIZE,
        } as LineShape);
      });
    } else if (endedStroke) {
      stroke = null;
    } else if (isPressed) {
      if (!stroke || pointer.surfaceUrl !== stroke.surfaceUrl) {
        return;
      }

      const { layerHandle, index } = stroke;
      layerHandle.change(({ shapes }) => {
        const currentShape = shapes[index] as LineShape;

        currentShape.outline?.points.push({
          x: x - currentShape.x,
          y: y - currentShape.y,
        });
      });
    }
  });

  const toggle = (event: Event) => {
    event.stopPropagation();

    surfaceStateHandle()?.change((state) => {
      state.selectedToolId =
        state.selectedToolId === "line-shape-layer" ? "" : "line-shape-layer";
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
      title="Draw"
      aria-label="Draw freehand"
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
          d="M3 13c2.5 0 2.5-6 5-6s2.5 6 5 6 2.5-3 4-3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  );
}
