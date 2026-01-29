import * as Automerge from "@automerge/automerge";
import {
  AutomergeUrl,
  DocHandle,
  isValidAutomergeUrl,
} from "@automerge/automerge-repo";
import {
  useDocument,
  useDocHandle,
  RepoContext,
} from "@automerge/automerge-repo-react-hooks";
import type { OpenDocumentEventDetail } from "@inkandswitch/patchwork-elements";
import ReactJson, { InteractionProps } from "@microlink/react-json-view";
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
  const getPref = () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [isDark, setIsDark] = useState(getPref);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setIsDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isDark;
}

function createOpenEvent(detail: OpenDocumentEventDetail) {
  const openEvent = new CustomEvent("patchwork:open-document", {
    detail,
    bubbles: true,
    composed: true,
  });
  return openEvent;
}

export const RawEditor = ({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement;
}) => {
  const [doc, changeDoc] = useDocument(docUrl);
  const handle = useDocHandle(docUrl);

  const isDark = usePrefersDarkMode();

  // Mark automerge URLs with a class for styling
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(
    null,
  );

  useEffect(() => {
    if (!containerNode) return;

    const markAutomergeUrls = () => {
      const stringElements = containerNode.querySelectorAll(".string-value");
      stringElements.forEach((el) => {
        const text = el.textContent || "";
        if (
          isValidAutomergeUrl(text.slice(1, -1)) &&
          !el.classList.contains("automerge-url")
        ) {
          el.classList.add("automerge-url");
        }
      });
    };

    // Initial mark
    markAutomergeUrls();

    // Watch for DOM changes (e.g., when editing and canceling in react-json-view)
    const observer = new MutationObserver(markAutomergeUrls);
    observer.observe(containerNode, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [containerNode, doc]);

  const onSelectAutomergeUrl = useCallback(
    (url: AutomergeUrl) => {
      element.dispatchEvent(createOpenEvent({ url, toolId: "raw" }));
    },
    [element],
  );

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

  const onSelect = useCallback(function (arg: unknown) {
    if (typeof arg !== "object" || arg === null || !("value" in arg)) {
      return;
    }
    const { value } = arg;
    if (!(typeof value === "string")) {
      return;
    }

    if (isValidAutomergeUrl(value)) {
      onSelectAutomergeUrl(value);
      // } else if (isServiceWorkerUrl(value)) {
      //   onSelectAutomergeUrl(parseServiceWorkerUrl(value));
    }
  }, []);

  // lifted from https://gist.github.com/davalapar/d0a5ba7cce4bc599f54800da22926da2
  const onDownloadDoc = useCallback(
    function () {
      if (!doc || !handle) {
        throw new Error("No document or handle found");
      }
      const data = Automerge.save(doc);
      const filename = `${handle.documentId}.automerge`;
      const blobURL = URL.createObjectURL(
        new Blob([data as BlobPart], { type: "application/octet-stream" }),
      );

      const tempLink = document.createElement("a");
      tempLink.style.display = "none";
      tempLink.href = blobURL;
      tempLink.setAttribute("download", filename);

      if (typeof tempLink.download === "undefined") {
        tempLink.setAttribute("target", "_blank");
      }

      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      setTimeout(() => {
        window.URL.revokeObjectURL(blobURL);
      }, 100);
    },
    [doc],
  );

  if (!doc) {
    return <div>Loading {docUrl}...</div>;
  }

  return (
    <div className="raw-editor-container">
      <div ref={setContainerNode}>
        <ReactJson
          collapsed={3}
          src={doc}
          onEdit={onEdit}
          onAdd={onAdd}
          onDelete={onDelete}
          onSelect={onSelect}
          theme={isDark ? "monokai" : "rjv-default"}
          style={{ backgroundColor: "transparent" }}
        />
      </div>
    </div>
  );
};
