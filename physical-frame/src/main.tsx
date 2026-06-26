import { render } from "solid-js/web";
import { RepoContext } from "@automerge/automerge-repo-solid-primitives";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { App } from "./App";
import type { SpatialHostDoc } from "./folder-datatype";
import "./styles.css";

type ToolElement = HTMLElement & { repo: Repo };

/**
 * Tool render contract: (handle, element) => cleanup. Mounts the Solid App and
 * returns the disposer.
 */
export const HostTool = (
  handle: DocHandle<SpatialHostDoc>,
  element: ToolElement,
) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  if (!element.style.height) element.style.height = "100%";

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <App handle={handle} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};
