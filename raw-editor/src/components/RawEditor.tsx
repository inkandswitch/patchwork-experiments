import { AutomergeUrl, DocHandle, isValidAutomergeUrl } from "@automerge/automerge-repo";
import { useDocument, RepoContext } from "@automerge/automerge-repo-react-hooks";
import ReactJson, { InteractionProps } from "@microlink/react-json-view";
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../rawEditor.css";

// TODO: element.repo is not ideal
export const TinyTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <div className="raw-editor-wrapper">
        <RawEditor docUrl={handle.url} element={element} />
      </div>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

function usePrefersDarkMode() {
  const getPref = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [isDark, setIsDark] = useState(getPref);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setIsDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isDark;
}

export const RawEditor = ({ docUrl, element }: { docUrl: AutomergeUrl; element: HTMLElement }) => {
  const [doc, changeDoc] = useDocument(docUrl);

  const isDark = usePrefersDarkMode();

  const onSelectAutomergeUrl = useCallback(
    (url: AutomergeUrl) => {
      element.dispatchEvent(
        new OpenDocumentEvent({
          url,
          toolId: "raw",
        }),
      );
    },
    [element],
  );

  // Mark automerge URLs with a class for styling
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerNode) return;

    const markAutomergeUrls = () => {
      const stringElements = containerNode.querySelectorAll(".string-value");
      stringElements.forEach((el) => {
        const text = el.textContent || "";
        if (isValidAutomergeUrl(text.slice(1, -1)) && !el.classList.contains("automerge-url")) {
          el.classList.add("automerge-url");
        }
      });
    };

    markAutomergeUrls();

    // Watch for DOM changes (e.g., when editing and canceling in react-json-view)
    const observer = new MutationObserver(markAutomergeUrls);
    observer.observe(containerNode, { childList: true, subtree: true });

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const urlEl = target.closest(".automerge-url");
      if (!urlEl) return;
      const text = urlEl.textContent || "";
      const url = text.slice(1, -1); // strip surrounding quotes rendered by react-json-view
      if (isValidAutomergeUrl(url)) {
        e.preventDefault();
        e.stopPropagation();
        onSelectAutomergeUrl(url);
      }
    };

    containerNode.addEventListener("click", handleClick);

    return () => {
      observer.disconnect();
      containerNode.removeEventListener("click", handleClick);
    };
  }, [containerNode, onSelectAutomergeUrl]);

  const onEdit = useCallback(
    ({ namespace, new_value, name }: InteractionProps) => {
      changeDoc(function (doc) {
        let current: any = doc;

        for (const key of namespace) {
          if (key === null) {
            console.error("failed to update property");
            return;
          }
          current = current[key];
        }

        if (!name) {
          console.error("failed to update property");
          return;
        }

        current[name] = new_value;
      });
    },
    [changeDoc],
  );

  const onAdd = useCallback(function () {
    return true;
  }, []);

  const onDelete = useCallback(
    function ({ namespace, name }: InteractionProps) {
      changeDoc(function (doc) {
        let current: any = doc;

        for (const key of namespace) {
          if (key === null) {
            console.error("failed to delete property");
            return;
          }
          current = current[key];
        }

        if (!name) {
          console.error("failed to delete property");
          return;
        }

        delete current[name];
      });
    },
    [changeDoc],
  );

  if (!doc) {
    return <div>Loading {docUrl}...</div>;
  }

  return (
    <div className="raw-editor-container">
      <div ref={setContainerNode}>
        <ReactJson collapsed={3} src={doc} onEdit={onEdit} onAdd={onAdd} onDelete={onDelete} theme={isDark ? "monokai" : "rjv-default"} style={{ backgroundColor: "transparent" }} />
      </div>
    </div>
  );
};
