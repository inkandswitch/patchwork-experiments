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
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import { JsonEditor } from "json-edit-react";
import { Download, PenLine, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Uint8ArrayInspector } from "./Uint8ArrayInspector";
import {
  makeIcons,
  darkIconColors,
  lightIconColors,
  nordDarkTheme,
  nordLightTheme,
} from "./theme";
import "../rawEditor.css";

export const TinyTool = (handle: DocHandle<unknown>, element: HTMLElement) => {
  const repo = (element as any).repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <RawEditor docUrl={handle.url} element={element} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getAtPath(obj: any, path: (string | number)[]): unknown {
  let node = obj;
  for (const key of path) {
    if (node == null) return undefined;
    node = node[key];
  }
  return node;
}

// ─── Uint8Array display ──────────────────────────────────────────────────────

/** Sentinel value replacing Uint8Arrays in display data */
const U8_SENTINEL = "\x00__uint8array__\x00";

function prepareForDisplay(value: unknown): unknown {
  if (value instanceof Uint8Array) return U8_SENTINEL;
  if (Array.isArray(value)) return value.map(prepareForDisplay);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = prepareForDisplay(v);
    return out;
  }
  return value;
}

function containsSentinel(value: unknown): boolean {
  if (value === U8_SENTINEL) return true;
  if (Array.isArray(value)) return value.some(containsSentinel);
  if (value !== null && typeof value === "object")
    return Object.values(value as Record<string, unknown>).some(
      containsSentinel,
    );
  return false;
}

/** Convert Uint8Arrays to plain number arrays for JSON export */
function prepareForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(prepareForJson);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = prepareForJson(v);
    return out;
  }
  return value;
}

// ─── Custom nodes for json-edit-react ─────────────────────────────────────────

function Uint8ArrayCustomNode({ nodeData, customNodeProps }: any) {
  const bytes = getAtPath(customNodeProps.doc, nodeData.path);
  if (!(bytes instanceof Uint8Array)) return null;
  return <Uint8ArrayInspector bytes={bytes} />;
}

function AutomergeUrlNode({ value, customNodeProps }: any) {
  return (
    <span
      className="re-automerge-url"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        customNodeProps.element.dispatchEvent(
          new OpenDocumentEvent({
            url: value as AutomergeUrl,
            toolId: "raw",
          }),
        );
      }}
    >
      {value}
    </span>
  );
}

function BinaryDataHint({ nodeData }: { nodeData: any }) {
  if (!nodeData.value || typeof nodeData.value !== "object") return null;
  if (!containsSentinel(nodeData.value)) return null;
  return (
    <span
      title="Contains binary data — text editing disabled"
      style={{
        opacity: 0.25,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 2,
      }}
      onClick={(e) => {
        e.stopPropagation();
        alert(
          "This collection contains Uint8Array (binary) data and cannot be edited as text.\n\nYou can still edit individual non-binary values within it.",
        );
      }}
    >
      <PenLine size={13} strokeWidth={2} />
    </span>
  );
}

// ─── Automerge doc mutation helpers ───────────────────────────────────────────

function applyAtPath(doc: any, path: (string | number)[], value: unknown) {
  let node = doc;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]];
    if (node == null) return;
  }
  node[path[path.length - 1]] = value;
}

function deleteAtPath(doc: any, path: (string | number)[]) {
  let node = doc;
  for (let i = 0; i < path.length - 1; i++) {
    node = node[path[i]];
    if (node == null) return;
  }
  const key = path[path.length - 1];
  if (Array.isArray(node) && typeof key === "number") {
    node.splice(key, 1);
  } else {
    delete node[key];
  }
}

// ─── Undo / Redo ─────────────────────────────────────────────────────────────

type UndoEntry =
  | {
      type: "edit";
      path: (string | number)[];
      oldValue: unknown;
      newValue: unknown;
    }
  | { type: "delete"; path: (string | number)[]; oldValue: unknown }
  | { type: "add"; path: (string | number)[]; newValue: unknown };

function useUndoRedo() {
  const [past, setPast] = useState<UndoEntry[]>([]);
  const [future, setFuture] = useState<UndoEntry[]>([]);

  const push = useCallback((entry: UndoEntry) => {
    setPast((p) => [...p, entry]);
    setFuture([]);
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return { push, past, setPast, future, setFuture, canUndo, canRedo };
}

// ─── Main component ───────────────────────────────────────────────────────────

export const RawEditor = ({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement;
}) => {
  const [doc, changeDoc] = useDocument<Record<string, unknown>>(docUrl);
  const handle = useDocHandle(docUrl);
  const isDark = usePrefersDarkMode();

  const [editorData, setEditorData] = useState<any>({});
  const contentRef = useRef<HTMLDivElement>(null);

  const { push: pushUndo, past, setPast, future, setFuture, canUndo, canRedo } =
    useUndoRedo();

  const displayDoc = useMemo(() => {
    if (!doc) return null;
    return prepareForDisplay(doc) as object;
  }, [doc]);

  useEffect(() => {
    if (displayDoc) setEditorData(displayDoc);
  }, [displayDoc]);

  // Global Escape handler to cancel edit even when blurred
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = contentRef.current;
      if (!el) return;
      const cancelBtn = el.querySelector(
        ".jer-confirm-buttons > div:last-child",
      ) as HTMLElement | null;
      if (cancelBtn) {
        e.preventDefault();
        e.stopPropagation();
        cancelBtn.click();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const entry = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, entry]);
    changeDoc((d: any) => {
      switch (entry.type) {
        case "edit":
          applyAtPath(d, entry.path, entry.oldValue);
          break;
        case "delete":
          applyAtPath(d, entry.path, entry.oldValue);
          break;
        case "add":
          deleteAtPath(d, entry.path);
          break;
      }
    });
  }, [past, setPast, setFuture, changeDoc]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const entry = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, entry]);
    changeDoc((d: any) => {
      switch (entry.type) {
        case "edit":
          applyAtPath(d, entry.path, entry.newValue);
          break;
        case "delete":
          deleteAtPath(d, entry.path);
          break;
        case "add":
          applyAtPath(d, entry.path, entry.newValue);
          break;
      }
    });
  }, [future, setPast, setFuture, changeDoc]);

  // Undo/Redo keyboard shortcuts — refs keep the document listener stable
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  useEffect(() => {
    handleUndoRef.current = handleUndo;
  }, [handleUndo]);
  useEffect(() => {
    handleRedoRef.current = handleRedo;
  }, [handleRedo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) {
        handleRedoRef.current();
      } else {
        handleUndoRef.current();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const theme = isDark ? nordDarkTheme : nordLightTheme;
  const icons = useMemo(
    () => makeIcons(isDark ? darkIconColors : lightIconColors),
    [isDark],
  );

  const customNodeDefs = useMemo(
    () => [
      {
        condition: ({ value }: any) => value === U8_SENTINEL,
        element: Uint8ArrayCustomNode,
        customNodeProps: { doc },
        showEditTools: false,
        showOnEdit: true,
        showOnView: true,
      },
      {
        condition: ({ value }: any) =>
          typeof value === "string" && isValidAutomergeUrl(value),
        element: AutomergeUrlNode,
        customNodeProps: { element },
        showEditTools: true,
        showOnView: true,
        showOnEdit: false,
      },
    ],
    [element, doc],
  );

  const customButtons = useMemo(
    () => [{ Element: BinaryDataHint, onClick: () => {} }],
    [],
  );

  const restrictEditFn = useCallback(({ value }: any) => {
    if (value && typeof value === "object") return containsSentinel(value);
    return false;
  }, []);

  const onEdit = useCallback(
    ({ path, newValue, currentValue }: any) => {
      pushUndo({ type: "edit", path, oldValue: currentValue, newValue });
      changeDoc((d: any) => applyAtPath(d, path, newValue));
    },
    [changeDoc, pushUndo],
  );

  const onDelete = useCallback(
    ({ path, currentValue }: any) => {
      pushUndo({ type: "delete", path, oldValue: currentValue });
      changeDoc((d: any) => deleteAtPath(d, path));
    },
    [changeDoc, pushUndo],
  );

  const onAdd = useCallback(
    ({ path, newValue }: any) => {
      pushUndo({ type: "add", path, newValue });
      changeDoc((d: any) => applyAtPath(d, path, newValue));
    },
    [changeDoc, pushUndo],
  );

  const onDownloadAutomerge = useCallback(() => {
    if (!doc || !handle) return;
    downloadBlob(
      new Blob([Automerge.save(doc) as BlobPart], {
        type: "application/octet-stream",
      }),
      `${handle.documentId}.automerge`,
    );
  }, [doc, handle]);

  const onDownloadJson = useCallback(() => {
    if (!doc) return;
    downloadBlob(
      new Blob([JSON.stringify(prepareForJson(doc), null, 2)], {
        type: "application/json",
      }),
      `${handle?.documentId ?? "document"}.json`,
    );
  }, [doc, handle]);

  const [urlCopied, setUrlCopied] = useState(false);
  const urlCopyTimeout = useRef<ReturnType<typeof setTimeout>>();
  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(docUrl).then(() => {
      setUrlCopied(true);
      clearTimeout(urlCopyTimeout.current);
      urlCopyTimeout.current = setTimeout(() => setUrlCopied(false), 1500);
    });
  }, [docUrl]);

  if (!doc || !displayDoc) {
    return (
      <div className="raw-editor-wrapper">
        <div className="re-loading">Loading {docUrl}…</div>
      </div>
    );
  }

  return (
    <div className="raw-editor-wrapper">
      <div className="re-toolbar">
        <span
          className={`re-url${urlCopied ? " re-url--copied" : ""}`}
          title="Click to copy"
          onClick={copyUrl}
        >
          {urlCopied ? "Copied!" : docUrl}
        </span>
        <div className="re-actions">
          <button
            className="re-btn"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={12} strokeWidth={2.5} />
          </button>
          <button
            className="re-btn"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={12} strokeWidth={2.5} />
          </button>
          <button
            className="re-btn"
            onClick={onDownloadJson}
            title="Download as JSON"
          >
            <Download size={12} strokeWidth={2.5} />
            JSON
          </button>
          <button
            className="re-btn"
            onClick={onDownloadAutomerge}
            title="Download Automerge binary"
          >
            <Download size={12} strokeWidth={2.5} />
            .automerge
          </button>
        </div>
      </div>

      <div className="re-content" ref={contentRef}>
        <JsonEditor
          data={editorData}
          setData={setEditorData}
          rootName=""
          theme={theme}
          icons={icons}
          collapse={3}
          collapseAnimationTime={0}
          indent={3}
          showStringQuotes
          showCollectionCount="when-closed"
          showIconTooltips
          enableClipboard
          minWidth="100%"
          maxWidth="100%"
          customNodeDefinitions={customNodeDefs}
          customButtons={customButtons}
          restrictEdit={restrictEditFn}
          onEdit={onEdit}
          onDelete={onDelete}
          onAdd={onAdd}
        />
      </div>
    </div>
  );
};
