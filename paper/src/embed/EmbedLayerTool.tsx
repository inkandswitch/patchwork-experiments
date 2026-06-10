import { render } from "solid-js/web";
import { For } from "solid-js";
import {
  RepoContext,
  useDocument,
} from "../vendor/automerge-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import "@inkandswitch/patchwork-elements";
import type { Shape, ShapeLayerDoc } from "../surface/types";
import { resolveOutline } from "../select/geometry";
import "./embed.css";

// An embed places another document on the canvas. Its geometry is a rectangle
// outline (so the selection tool hit-tests it like any other shape); `docUrl`
// is the embedded document and `toolId` optionally pins which tool renders it.
export type EmbedShape = Shape & {
  outline?: { type: "rectangle"; width: number; height: number };
  docUrl: AutomergeUrl;
  toolId?: string;
};

// Read width/height from the rectangle outline, falling back to legacy fields.
function embedSize(shape: EmbedShape): { width: number; height: number } {
  const outline = resolveOutline(shape);
  if (outline?.type === "rectangle")
    return { width: outline.width, height: outline.height };
  return { width: shape.width ?? 320, height: shape.height ?? 240 };
}

// A self-contained layer tool that mounts one <patchwork-view> per embed shape,
// positioned and sized from the shape. Like the other layer tools its host is a
// full-canvas overlay; per-shape views are absolutely positioned within it.
export const EmbedLayerTool: ToolRender = (handle, element) => {
  element.classList.add("paper-embed-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <EmbedLayer url={handle.url} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function EmbedLayer(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<ShapeLayerDoc>(() => props.url);
  const shapes = () => Object.values(doc()?.shapes ?? {}) as EmbedShape[];

  // Embeds are always interactive: an embedded surface handles its own
  // pointer input (it stamps the shared surface:state with its url and
  // parent), which is what lets tools draw into it and drags drop onto it.
  // hide-controls keeps nested papers from rendering their own toolbar, so
  // there is exactly one instance of each tool button.
  return (
    <For each={shapes()}>
      {(embed) => (
        <patchwork-view
          class="paper-embed-item"
          doc-url={embed.docUrl}
          tool-id={embed.toolId}
          hide-controls=""
          style={{
            position: "absolute",
            left: `${embed.x}px`,
            top: `${embed.y}px`,
            width: `${embedSize(embed).width}px`,
            height: `${embedSize(embed).height}px`,
            right: "auto",
            bottom: "auto",
            "z-index": embed.z,
            "pointer-events": "auto",
          }}
        />
      )}
    </For>
  );
}
