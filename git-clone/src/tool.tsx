import {
  RepoContext,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { cloneRepo } from "./clone";
import { DEFAULT_CORS_PROXY } from "./datatype";
import { buildFolderFromFiles } from "./folder";
import type { GitCloneDoc } from "./types";
import "./index.css";

function openDocument(element: HTMLElement, url: AutomergeUrl) {
  element.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail: { url, type: "folder" },
      bubbles: true,
      composed: true,
    }),
  );
}

function GitCloneEditor({
  handle,
  element,
}: {
  handle: DocHandle<GitCloneDoc>;
  element: HTMLElement;
}) {
  const repo = useRepo();
  const [doc] = useDocument<GitCloneDoc>(handle.url);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!doc) return null;

  const setField = <K extends keyof GitCloneDoc>(
    key: K,
    value: GitCloneDoc[K],
  ) => {
    handle.change((d) => {
      d[key] = value;
    });
  };

  const runClone = async () => {
    if (busy || !doc.url.trim()) return;
    setBusy(true);
    setLog([]);
    const append = (m: string) => setLog((l) => [...l, m]);
    handle.change((d) => {
      d.status = "cloning";
      d.message = "Cloning…";
    });

    try {
      const { files, repoName } = await cloneRepo({
        url: doc.url,
        ref: doc.ref,
        corsProxy: doc.corsProxy || DEFAULT_CORS_PROXY,
        onProgress: append,
      });
      append(`Building ${files.length} files into a Patchwork folder…`);
      const folderUrl = buildFolderFromFiles(repo, files, repoName);
      handle.change((d) => {
        d.status = "done";
        d.message = `Cloned ${files.length} files`;
        d.resultUrl = folderUrl;
        d.resultTitle = repoName;
        d.fileCount = files.length;
        d.clonedAt = Date.now();
      });
      append(`Done. Opening ${repoName}…`);
      openDocument(element, folderUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      append(`Error: ${message}`);
      handle.change((d) => {
        d.status = "error";
        d.message = message;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-clone">
      <h2 className="git-clone__heading">Clone a git repository</h2>
      <p className="git-clone__subtitle">
        Fetches a repo in your browser and writes it as a pushwork-compatible
        Patchwork folder.
      </p>

      <label className="git-clone__label">
        Repository URL
        <input
          className="git-clone__input"
          type="text"
          placeholder="https://github.com/owner/repo"
          value={doc.url}
          disabled={busy}
          onChange={(e) => setField("url", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runClone();
          }}
        />
      </label>

      <div className="git-clone__row">
        <label className="git-clone__label git-clone__label--grow">
          Branch / ref <span className="git-clone__hint">(optional)</span>
          <input
            className="git-clone__input"
            type="text"
            placeholder="default branch"
            value={doc.ref}
            disabled={busy}
            onChange={(e) => setField("ref", e.target.value)}
          />
        </label>
        <button
          className="git-clone__button"
          onClick={runClone}
          disabled={busy || !doc.url.trim()}
        >
          {busy ? "Cloning…" : "Clone"}
        </button>
      </div>

      <details className="git-clone__advanced">
        <summary>Advanced</summary>
        <label className="git-clone__label">
          CORS proxy
          <input
            className="git-clone__input"
            type="text"
            value={doc.corsProxy}
            disabled={busy}
            onChange={(e) => setField("corsProxy", e.target.value)}
          />
        </label>
        <p className="git-clone__hint">
          Browsers can't talk to git hosts directly; requests are routed through
          this proxy.
        </p>
      </details>

      {doc.status === "done" && doc.resultUrl && (
        <div className="git-clone__result git-clone__result--ok">
          <span>
            Cloned <strong>{doc.resultTitle}</strong> ({doc.fileCount} files)
          </span>
          <button
            className="git-clone__link"
            onClick={() => openDocument(element, doc.resultUrl!)}
          >
            Open folder
          </button>
        </div>
      )}

      {doc.status === "error" && (
        <div className="git-clone__result git-clone__result--error">
          {doc.message}
        </div>
      )}

      {log.length > 0 && (
        <pre className="git-clone__log">{log.join("\n")}</pre>
      )}
    </div>
  );
}

export const GitCloneTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <GitCloneEditor
        handle={handle as DocHandle<GitCloneDoc>}
        element={element}
      />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
