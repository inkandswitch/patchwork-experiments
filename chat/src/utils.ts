import { AutomergeUrl } from "@automerge/automerge-repo";
import { RepoContext } from "@automerge/automerge-repo-react-hooks";
import { ToolElement, ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: ToolElement;
};

export function toolify(editorComponent: React.FC<ReactToolProps>): ToolImplementation {
  return (handle, element) => {
    const root = createRoot(element);

    root.render(
      createElement(
        RepoContext.Provider,
        { value: element.repo },
        createElement(editorComponent, {
          docUrl: handle.url,
          element,
        })
      )
    );

    return () => {
      root.unmount();
    };
  };
}
