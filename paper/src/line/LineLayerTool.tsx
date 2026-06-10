import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For } from "solid-js";
import { render } from "solid-js/web";
import { resolveOutline } from "../select/geometry";
import { freehandPath } from "./freehand";
import "./line.css";
import { Point, Shape, ShapeLayerDoc } from "../surface/types";

// A freehand stroke. Its full path lives in `shape.outline` (a "line" variant
// whose points are relative to the shape origin); `strokeWidth` is the pen
// size and `stroke` the fill color. Only visual properties sit on the shape.
export type LineShape = Shape & {
  outline?: { type: "line"; points: Point[] };
  stroke?: string;
  strokeWidth?: number;
};

// The stroke's input points in absolute canvas coordinates, derived from the
// outline (falling back to legacy `x2`/`y2` for pre-outline shapes).
function strokePoints(line: LineShape): Point[] {
  const outline = resolveOutline(line);
  const points = outline?.type === "line" ? outline.points : [];
  return points.map((p) => ({ x: line.x + p.x, y: line.y + p.y }));
}

// A self-contained layer tool. The mount target is the enclosing
// <patchwork-view> content, so we make it a full-canvas overlay. Each shape
// gets its own absolutely positioned svg with a z-index driven by `shape.z`,
// which is what lets shapes interlace across layers.
export const LineLayerTool: ToolRender = (handle, element) => {
  element.classList.add("line-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LineLayer url={(handle as DocHandle<ShapeLayerDoc>).url} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function LineLayer(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<ShapeLayerDoc>(() => props.url);
  const shapes = () => Object.values(doc()?.shapes ?? {}) as LineShape[];

  return (
    <For each={shapes()}>
      {(line) => (
        <svg
          class="line-svg"
          width="100%"
          height="100%"
          style={{ "z-index": line.z }}
        >
          <path
            d={freehandPath(strokePoints(line), line.strokeWidth)}
            fill={line.stroke ?? "#64748b"}
          />
        </svg>
      )}
    </For>
  );
}
