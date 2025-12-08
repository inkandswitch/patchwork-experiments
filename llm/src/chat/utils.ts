import { AutomergeUrl } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import {
  ToolElement,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: ToolElement;
};

export function toolify(
  editorComponent: React.FC<ReactToolProps>
): ToolImplementation {
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

// Format timestamp for display
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function useCurrentContactUrl() {
  const [accountDoc] = useDocument<{ contactUrl: AutomergeUrl }>(
    (window as any).accountDocHandle.url,
    {
      suspense: true,
    }
  );

  return accountDoc.contactUrl;
}
