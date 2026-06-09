import { useRepo } from "@automerge/automerge-repo-solid-primitives";
import { subscribeDoc } from "@inkandswitch/patchwork-providers-solid";
import { createEffect, createSignal, type JSX } from "solid-js";
import type {
  DocWithLayers,
  Point,
  ShapeLayerDoc,
  SurfacePointer,
  SurfaceTool,
} from "../surface/types";
import type { LineShape } from "./LineLayerTool";
import { DocHandle } from "@automerge/automerge-repo";

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
  let root!: HTMLButtonElement;

  const [tool, toolHandle] = subscribeDoc<SurfaceTool>(() => root, {
    type: "surface:tool",
  });
  const active = () => tool()?.toolId === "line-shape-layer";
  const [hovered, setHovered] = createSignal(false);
  const repo = useRepo();

  const [getPointer] = subscribeDoc<SurfacePointer>(() => root, {
    type: "surface:pointer",
  });

  const getLayerHandle = async () => {
    const surfaceUrl = getPointer()?.surfaceUrl;
    if (!surfaceUrl) {
      return;
    }

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

  let currentLineIndex: number | null = null;

  const onPointerDown = async (
    x: number,
    y: number,
    layerHandle: DocHandle<ShapeLayerDoc>,
  ) => {
    layerHandle.change(({ shapes }) => {
      currentLineIndex = shapes.length;

      shapes.push({
        x,
        y,
        z: 1,
        outline: { type: "line", points: [{ x: 0, y: 0 }] },
        stroke: STROKE,
        strokeWidth: SIZE,
      } as LineShape);
    });
  };

  const onPointerMove = async (
    x: number,
    y: number,
    layerHandle: DocHandle<ShapeLayerDoc>,
  ) => {
    if (currentLineIndex === null) {
      return;
    }

    layerHandle.change(({ shapes }) => {
      const currentShape = shapes[currentLineIndex!] as LineShape;

      currentShape.outline?.points.push({
        x: x - currentShape.x,
        y: y - currentShape.y,
      });
    });
  };

  const onPointerUp = (
    x: number,
    y: number,
    layer: DocHandle<ShapeLayerDoc>,
  ) => {
    currentLineIndex = null;
  };

  let wasPressed = false;

  createEffect(async () => {
    const pointer = getPointer();
    if (!pointer || !pointer.position) {
      return;
    }

    const { x, y } = pointer.position;

    if (tool()?.toolId !== "line-shape-layer") {
      return;
    }

    const layerHandle = await getLayerHandle();
    if (!layerHandle) {
      return;
    }

    if (!wasPressed && pointer.isPressed) {
      onPointerDown(x, y, layerHandle);
    } else if (wasPressed && !pointer.isPressed) {
      onPointerUp(x, y, layerHandle);
    } else {
      onPointerMove(x, y, layerHandle);
    }

    wasPressed = pointer.isPressed;
  });

  const toggle = () => {
    toolHandle()?.change((doc) => {
      doc.toolId = doc.toolId === "line-shape-layer" ? "" : "line-shape-layer";
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
      ref={root}
      type="button"
      style={buttonStyle()}
      title="Draw"
      aria-label="Draw freehand"
      aria-pressed={active()}
      data-surface-no-draw
      onClick={toggle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
