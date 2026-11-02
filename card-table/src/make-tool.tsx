import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";

export type ToolComponentProps = {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
};

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
