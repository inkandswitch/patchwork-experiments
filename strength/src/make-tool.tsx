import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

export type ToolComponentProps = {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
};

/**
 * Standard tool bootstrap shared by every strength tool: React root +
 * repo context + unmount cleanup. Components that don't need
 * `hostElement` can simply not declare it.
 */
export function makeTool(
  Component: ComponentType<ToolComponentProps>,
): ToolRender {
  return (handle, element) => {
    const root = createRoot(element);
    root.render(
      <RepoContext.Provider value={element.repo}>
        <Component docUrl={handle.url} hostElement={element} />
      </RepoContext.Provider>,
    );
    return () => root.unmount();
  };
}
