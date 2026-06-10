import type { DocHandle } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import "@inkandswitch/patchwork-elements";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import { LineButton } from "../line/LineButton";
import { RectButton } from "../rect/RectButton";
import { SelectionOverlay } from "../select/SelectionOverlay";
import { SurfaceProvider } from "../surface/SurfaceProvider";
import { DocWithLayers } from "../surface/types";
import "./paper.css";
import type { PaperDoc } from "./types";

const VERSION = "0.0.30";

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
          <SelectionOverlay />
          <div class="paper-controls">
            {/*<SelectButton />*/}
            <RectButton />
            <LineButton />
          </div>
        </Show>
      </SurfaceProvider>
      <div class="paper-version">v{VERSION}</div>
    </div>
  );
}
