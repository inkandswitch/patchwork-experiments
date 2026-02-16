import { AutomergeUrl, isValidAutomergeUrl } from "@automerge/automerge-repo";
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

export function extractAutomergeUrls(text: string): AutomergeUrl[] {
  const docUrls: AutomergeUrl[] = [];

  // First, match automerge:... URLs as before
  const automergePattern = /automerge:[a-zA-Z0-9]{28}/g;
  const automergeMatches = text.match(automergePattern) || [];
  for (const match of automergeMatches) {
    if (isValidAutomergeUrl(match)) {
      docUrls.push(match);
    }
  }

  // Second, match any URL containing /#doc=<id>
  // Example: http://localhost:5173/#doc=45oVmqdzjpcYMD5WJUFoNYcgnzEw&title=...
  // We'll extract the "doc" parameter value (should be 28 chars, likely automerge id)
  // Accepts http(s) or plain domain as well
  const docParamPattern =
    /(?:https?:\/\/[^\s]*|[^\s]+)?\/#doc=([a-zA-Z0-9]+)\b/g;
  let match: RegExpExecArray | null;
  while ((match = docParamPattern.exec(text))) {
    const foundId = match[1];
    const possibleUrl = `automerge:${foundId}`;
    if (isValidAutomergeUrl(possibleUrl) && !docUrls.includes(possibleUrl)) {
      docUrls.push(possibleUrl);
    }
  }

  return docUrls;
}
