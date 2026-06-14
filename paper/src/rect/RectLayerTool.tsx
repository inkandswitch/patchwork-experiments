import { render } from "solid-js/web";
import { For } from "solid-js";
import { RepoContext, useDocument } from "../vendor/automerge-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Shape, ShapeLayerDoc } from "../surface/types";
import "./rect.css";

// Geometry lives in `shape.outline` (a "rectangle" variant); only the visual
// properties sit on the shape itself.
export type RectShape = Shape & {
  outline: { type: "rectangle"; width: number; height: number };
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

// Read width/height from the rectangle outline.
function rectSize(rect: RectShape): { width: number; height: number } {
  return { width: rect.outline.width, height: rect.outline.height };
}

// A self-contained layer tool. The mount target is the enclosing
// <patchwork-view> content, so we make it a full-canvas overlay. Each shape
// gets its own absolutely positioned svg with a z-index driven by `shape.z`,
// which is what lets shapes interlace across layers.
export const RectLayerTool: ToolRender = (handle, element) => {
  element.classList.add("rect-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <RectLayer handle={handle as DocHandle<ShapeLayerDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function RectLayer(props: { handle: DocHandle<ShapeLayerDoc> }) {
  const [doc] = useDocument<ShapeLayerDoc>(() => props.handle.url);
  const shapes = () => Object.values(doc()?.shapes ?? {}) as RectShape[];

  // data-automerge-url carries the shape's sub-document url — the same key
  // the focus doc's selection/highlight maps use — so the SelectionOverlay's
  // generated stylesheet can target the shape's own element.
  return (
    <For each={shapes()}>
      {(rect) => (
        <svg
          class="rect-svg"
          data-automerge-url={props.handle.sub("shapes", rect.id).url}
          width="100%"
          height="100%"
          style={{ "z-index": rect.z }}
        >
          {/* Size/stroke are in logical pixels; translate to the world anchor
              and scale by the shape's draw-time scale so the rectangle renders
              uniformly (geometry and stroke width alike). */}
          <rect
            transform={`translate(${rect.x} ${rect.y}) scale(${rect.scale})`}
            x={0}
            y={0}
            width={rectSize(rect).width}
            height={rectSize(rect).height}
            fill={rect.fill ?? "#9bb3cc"}
            stroke={rect.stroke ?? "#6f8aa6"}
            stroke-width={rect.strokeWidth ?? 2}
            rx={6}
          />
        </svg>
      )}
    </For>
  );
}
