import type { DocHandle } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
  useRepo,
} from "../vendor/automerge-solid-primitives";
import "@inkandswitch/patchwork-elements";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { LineButton } from "../line/LineButton";
import { RectButton } from "../rect/RectButton";
import { SelectButton } from "../select/SelectButton";
import { SelectionOverlay } from "../select/SelectionOverlay";
import { SurfaceProvider } from "../surface/SurfaceProvider";
import { DocWithLayers, ShapeLayerDoc } from "../surface/types";
import "./paper.css";
import type { PaperDoc } from "./types";

const VERSION = "0.0.34";

// The surface tool: wraps the stack of layer <patchwork-view>s in a
// SurfaceProvider so the layer buttons can drive the canvas purely through the
// provider protocol.
export const PaperTool: ToolRender = (handle, element) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PaperSurface
          handle={handle as DocHandle<PaperDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function PaperSurface(props: {
  handle: DocHandle<PaperDoc>;
  element: ToolElement;
}) {
  const [doc] = useDocument<PaperDoc>(() => props.handle.url);
  const [isMounted, setIsMounted] = createSignal(false);
  const layers = () => Object.entries(doc()?.layers ?? {});
  const repo = useRepo();
  // Embedded papers are rendered with hide-controls so only the outermost
  // paper shows a toolbar — one instance of each tool button drives the
  // whole surface hierarchy through the shared surface:state.
  const showControls = !props.element.hasAttribute("hide-controls");

  // Papers created before the link arrow layer existed don't have it; add it
  // on view so armed links can draw their arrows here. Only the outermost
  // paper needs it (the arrow layer renders nothing when nested), which also
  // keeps this from recursing into embedded papers.
  createEffect(() => {
    if (!showControls) return;
    const currentLayers = doc()?.layers;
    if (!currentLayers || currentLayers["link-arrow-layer"]) return;
    void (async () => {
      const layerHandle = await repo.create2<ShapeLayerDoc>({
        "@patchwork": { type: "shape-layer" },
        title: "Link Arrows",
        shapes: {},
      });
      props.handle.change((paper) => {
        if (!paper.layers["link-arrow-layer"]) {
          paper.layers["link-arrow-layer"] = layerHandle.url;
        }
      });
    })();
  });

  return (
    <div class="paper-canvas">
      <SurfaceProvider
        handle={props.handle as DocHandle<DocWithLayers>}
        onMounted={() => setIsMounted(true)}
      >
        <Show when={isMounted()}>
          <For each={layers()}>
            {([toolId, url]) => (
              <patchwork-view doc-url={url} tool-id={toolId} />
            )}
          </For>
          <SelectionOverlay surfaceUrl={props.handle.url} />
          <Show when={showControls}>
            <div class="paper-controls">
              <SelectButton />
              <RectButton />
              <LineButton />
            </div>
          </Show>
        </Show>
      </SurfaceProvider>
      <div class="paper-version">v{VERSION}</div>
    </div>
  );
}
