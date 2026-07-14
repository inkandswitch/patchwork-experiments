import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { EdgeHandle } from "@inkandswitch/edge-handles";
import type {
  ToolElement,
  ToolImplementation,
} from "@inkandswitch/patchwork-plugins";
import {
  Cable,
  Download,
  LocateFixed,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Sigma,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import { latex } from "codemirror-lang-latex";

import {
  compileLatexToPdf,
  downloadBlob,
  onCompilerProgress,
  pdfSupported,
  prewarmCompiler,
} from "./compile";
import {
  forwardSearch,
  inverseSearch,
  parseSyncTex,
  type SyncTexData,
} from "./synctex";
import { getDocTitle, type LaTeXDoc } from "./datatype";
import {
  addTarget,
  createPdfFileDoc,
  ensureOutputEdge,
  findOutputEdge,
  isFileLikeDoc,
  publishPdf,
  removeTarget,
  resolveTargets,
  type FileDocShape,
  type OutputTarget,
} from "./outputs";
import { OutputsPanel } from "./OutputsPanel";
import { PdfPreview, type PdfPreviewHandle } from "./PdfPreview";
import "./styles.css";

const MAIN_TEX_FILE = "document.tex"; // what the engine names the source

// ─── CodeMirror setup ────────────────────────────────────────────────────────

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "'SF Mono', ui-monospace, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "16px 0" },
  ".cm-gutters": { border: "none", background: "transparent" },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 14px",
    minWidth: "36px",
  },
  "&.cm-focused": { outline: "none" },
});

const cmDarkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#16161a", color: "#e7e7ea" },
    ".cm-cursor": { borderLeftColor: "#e7e7ea" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-activeLineGutter": { backgroundColor: "#ffffff08" },
    ".cm-selectionBackground": { backgroundColor: "#ffffff22 !important" },
    ".cm-gutters": { color: "#55555c" },
  },
  { dark: true }
);

type EditorActions = { forwardSync: () => void };

function useCodeMirror(
  handle: DocHandle<LaTeXDoc>,
  actionsRef: { current: EditorActions }
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current || !handle) return;
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const state = EditorState.create({
      doc: handle.doc()?.content ?? "",
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        foldGutter(),
        autocompletion(),
        highlightSelectionMatches(),
        history(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: "Mod-j",
            preventDefault: true,
            run: () => {
              actionsRef.current.forwardSync();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        latex(),
        automergeSyncPlugin({ handle: handle as any, path: ["content"] }),
        cmTheme,
        ...(isDark ? [cmDarkTheme] : []),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [handle, actionsRef]);

  return { containerRef, viewRef };
}

function cursorLine(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

function jumpToLine(view: EditorView, line: number) {
  const clamped = Math.min(Math.max(1, line), view.state.doc.lines);
  const info = view.state.doc.line(clamped);
  view.dispatch({
    selection: { anchor: info.from },
    scrollIntoView: true,
  });
  view.focus();
}

// ─── output wiring ───────────────────────────────────────────────────────────

function useOutputs(
  handle: DocHandle<LaTeXDoc>,
  hive: ToolElement["hive"],
  pdfRef: { current: Uint8Array | null }
) {
  const repo = useRepo();
  const [edge, setEdge] = useState<EdgeHandle<Uint8Array> | null>(null);
  const [targets, setTargets] = useState<OutputTarget[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findOutputEdge(repo, handle).then((e) => {
      if (!cancelled && e) setEdge(e);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, handle]);

  useEffect(() => {
    if (!edge) return;
    let cancelled = false;
    const refresh = () => {
      resolveTargets(repo, edge).then((t) => {
        if (!cancelled) setTargets(t);
      });
    };
    refresh();
    const unsub = edge.onMembersChange(() => {
      refresh();
      if (pdfRef.current != null) publishPdf(edge, pdfRef.current);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [edge, repo, pdfRef]);

  const withEdge = useCallback(
    async (fn: (e: EdgeHandle<Uint8Array>) => Promise<void>) => {
      setBusy(true);
      try {
        let e = edge;
        if (!e) {
          e = await ensureOutputEdge(repo, handle);
          setEdge(e);
        }
        await fn(e);
      } catch (err) {
        console.error("[latex] output wiring failed", err);
      } finally {
        setBusy(false);
      }
    },
    [edge, repo, handle]
  );

  const newDocument = useCallback(() => {
    void withEdge(async (e) => {
      const title = getDocTitle(handle.doc()?.content ?? "");
      const fileHandle = await createPdfFileDoc(
        repo,
        title,
        pdfRef.current ?? new Uint8Array(),
        hive
      );
      await addTarget(repo, e, fileHandle.url, ["content"]);
    });
  }, [withEdge, repo, handle, hive, pdfRef]);

  const dropDoc = useCallback(
    (url: AutomergeUrl) => {
      void (async () => {
        try {
          const docHandle = await repo.find<FileDocShape>(url);
          if (isFileLikeDoc(docHandle.doc())) {
            await withEdge((e) => addTarget(repo, e, url, ["content"]));
          }
          // Non file-like docs can't hold raw PDF bytes; ignore the drop.
        } catch (err) {
          console.error(`[latex] failed to load dropped doc ${url}`, err);
        }
      })();
    },
    [repo, withEdge]
  );

  const remove = useCallback(
    (target: OutputTarget) => {
      if (edge) removeTarget(edge, target.key);
    },
    [edge]
  );

  return { edge, targets, busy, newDocument, dropDoc, remove };
}

// ─── component ───────────────────────────────────────────────────────────────

type Status = "warming" | "compiling" | "ready" | "error" | "unsupported";

const LaTeXEditorInner = ({
  docUrl,
  hive,
}: {
  docUrl: AutomergeUrl;
  hive: ToolElement["hive"];
}) => {
  const [doc] = useDocument<LaTeXDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<LaTeXDoc>(docUrl, { suspense: true });

  const actionsRef = useRef<EditorActions>({ forwardSync: () => {} });
  const { containerRef: editorRef, viewRef } = useCodeMirror(handle, actionsRef);
  const pdfRef = useRef<PdfPreviewHandle>(null);

  const [previewOpen, setPreviewOpen] = useState(true);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const syncTexRef = useRef<SyncTexData | null>(null);

  const [status, setStatus] = useState<Status>(
    pdfSupported() ? "warming" : "unsupported"
  );
  const [progress, setProgress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);

  const lastCompiledRef = useRef<string | null>(null);
  // Coalescing compile pump: `head` is the newest source waiting to be
  // compiled, `pumping` guards a single in-flight compile.
  const headRef = useRef<string | null>(null);
  const pumpingRef = useRef(false);
  const mountedRef = useRef(true);

  const outputs = useOutputs(handle, hive, pdfBytesRef);
  const edgeRef = useRef<EdgeHandle<Uint8Array> | null>(null);
  edgeRef.current = outputs.edge;

  // Warm the engine the moment the editor opens, so the first compile
  // pays only the compile cost, not the ~45MB engine download.
  useEffect(() => {
    if (pdfSupported()) prewarmCompiler();
  }, []);

  // Surface the engine's detailed download/format progress while busy.
  useEffect(() => {
    return onCompilerProgress((stage, detail) => {
      setProgress(detail ? `${stage}: ${detail}` : stage);
    });
  }, []);

  // Publish the latest PDF once the output edge finishes loading.
  useEffect(() => {
    if (outputs.edge && pdfBytesRef.current) {
      publishPdf(outputs.edge, pdfBytesRef.current);
    }
  }, [outputs.edge]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── compile pump ──
  // Latest-wins, no debounce: compile starts as soon as something changes.
  // While a compile is in flight new edits just overwrite the head; when it
  // finishes the pump immediately picks up the freshest source. So results
  // arrive as soon as possible, yet at most one compile ever runs and edits
  // never queue up — the same buildup-safety a debounce gives, without the
  // wait. A `setTimeout(0)` between runs yields to React so typing stays
  // responsive.
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    if (!pdfSupported()) {
      setStatus("unsupported");
      return;
    }
    pumpingRef.current = true;
    try {
      while (headRef.current != null) {
        const content = headRef.current;
        headRef.current = null;
        if (content === lastCompiledRef.current) continue;

        setStatus("compiling");
        const result = await compileLatexToPdf(content, setProgress);
        if (!mountedRef.current) return;

        if (result.ok) {
          lastCompiledRef.current = content;
          pdfBytesRef.current = result.bytes;
          setPdfBytes(result.bytes);
          syncTexRef.current = parseSyncTex(result.syncTex, MAIN_TEX_FILE);
          setLogText(result.log ?? null);
          setErrorMessage(null);
          setStatus("ready");
          setProgress(null);
          if (edgeRef.current) publishPdf(edgeRef.current, result.bytes);
        } else {
          // Keep showing the last good PDF; just report the error.
          setErrorMessage(result.error);
          setLogText(result.log ?? null);
          setStatus("error");
          setProgress(null);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      pumpingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (doc?.content == null) return;
    if (doc.content === lastCompiledRef.current) return;
    headRef.current = doc.content;
    void pump();
  }, [doc?.content, pump]);

  // ── SyncTeX: forward (cursor → PDF) ──
  const forwardSync = useCallback(() => {
    const view = viewRef.current;
    const parsed = syncTexRef.current;
    if (!view || !parsed) return;
    const rect = forwardSearch(parsed, cursorLine(view));
    if (rect) {
      if (!previewOpen) setPreviewOpen(true);
      pdfRef.current?.scrollToRect(rect);
    }
  }, [viewRef, previewOpen]);
  actionsRef.current.forwardSync = forwardSync;

  // ── SyncTeX: inverse (PDF click → cursor) ──
  const inverseSync = useCallback(
    (page: number, xPt: number, yPt: number) => {
      const view = viewRef.current;
      const parsed = syncTexRef.current;
      if (!view || !parsed) return;
      const hit = inverseSearch(parsed, page, xPt, yPt);
      if (hit) jumpToLine(view, hit.line);
    },
    [viewRef]
  );

  // ── download ──
  const download = useCallback(() => {
    const title = getDocTitle(doc?.content ?? "");
    if (pdfBytesRef.current) {
      downloadBlob(
        new Blob([pdfBytesRef.current.buffer as ArrayBuffer], {
          type: "application/pdf",
        }),
        `${title}.pdf`
      );
    }
  }, [doc?.content]);

  const title = useMemo(() => getDocTitle(doc?.content ?? ""), [doc?.content]);

  const liveTargets = outputs.targets.length;
  const compiling = status === "compiling" || status === "warming";
  const hasPdf = pdfBytes != null;
  const canSync = syncTexRef.current != null && hasPdf;

  return (
    <div className="ltx-root">
      {/* ── toolbar ── */}
      <header className="ltx-toolbar">
        <div className="ltx-brand">
          <Sigma size={14} />
          <span className="ltx-title" title={title}>
            {title}
          </span>
        </div>

        {compiling && (
          <span className="ltx-status">
            <span className="ltx-spinner small" />
            {status === "warming" ? "Loading engine…" : "Compiling…"}
          </span>
        )}

        <div className="ltx-toolbar-spacer" />

        <button
          className={`ltx-btn ghost${logsOpen ? " active" : ""}${status === "error" ? " warn" : ""}`}
          onClick={() => setLogsOpen((o) => !o)}
          title="Compilation log"
        >
          <ScrollText size={13} />
          Log
        </button>

        <button
          className={`ltx-btn ghost outputs-toggle${outputsOpen ? " active" : ""}${liveTargets > 0 ? " live" : ""}`}
          onClick={() => setOutputsOpen((o) => !o)}
          title="Write the compiled PDF to other documents"
        >
          <Cable size={13} />
          Outputs
          {liveTargets > 0 && <span className="count">{liveTargets}</span>}
        </button>

        <button
          className="ltx-icon-btn"
          onClick={forwardSync}
          disabled={!canSync}
          title="Show cursor position in PDF (⌘J)"
        >
          <LocateFixed size={14} />
        </button>

        <button
          className="ltx-icon-btn"
          onClick={download}
          disabled={!hasPdf}
          title="Download PDF"
        >
          <Download size={14} />
        </button>

        <button
          className="ltx-icon-btn"
          onClick={() => setPreviewOpen((o) => !o)}
          title={previewOpen ? "Collapse preview" : "Show preview"}
        >
          {previewOpen ? (
            <PanelRightClose size={14} />
          ) : (
            <PanelRightOpen size={14} />
          )}
        </button>
      </header>

      {/* ── panes ── */}
      <div className="ltx-split">
        <div className={`ltx-editor-pane${previewOpen ? "" : " solo"}`}>
          <div ref={editorRef} className="ltx-cm-container" />
        </div>

        {previewOpen && (
          <div className="ltx-preview-pane">
            {status === "unsupported" ? (
              <div className="ltx-placeholder ltx-unsupported">
                <Sigma size={28} />
                <p>
                  This browser can't run the TeX engine. It needs cross-origin
                  isolation (SharedArrayBuffer) — try a recent Chrome, Edge, or
                  Firefox.
                </p>
              </div>
            ) : (
              <>
                <PdfPreview
                  ref={pdfRef}
                  bytes={pdfBytes}
                  onInverseClick={inverseSync}
                />

                {/* Full overlay only until the first PDF exists; after that a
                    quiet corner badge so recompiles don't strobe the view. */}
                {compiling && !hasPdf && (
                  <div className="ltx-progress">
                    <div className="ltx-spinner" />
                    <span>{progress ?? "Compiling…"}</span>
                  </div>
                )}
                {compiling && hasPdf && (
                  <div className="ltx-compiling-badge">
                    <div className="ltx-spinner small" />
                    <span>{progress ?? "Compiling…"}</span>
                  </div>
                )}

                {!hasPdf && !compiling && status === "error" && (
                  <div className="ltx-placeholder">
                    Couldn’t compile — see the log.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── log drawer ── */}
      {logsOpen && (
        <div className="ltx-logs">
          <div className="ltx-logs-head">
            <span className={status === "error" ? "err" : ""}>
              {status === "error"
                ? (errorMessage ?? "Compilation error")
                : "Compiled successfully"}
            </span>
            <button
              className="ltx-icon-btn small"
              onClick={() => setLogsOpen(false)}
              title="Close log"
            >
              <PanelRightClose size={12} />
            </button>
          </div>
          <pre className="ltx-logs-body">
            {logText || "No log output yet."}
          </pre>
        </div>
      )}

      {/* Anchored to the root so it stays usable while the preview is
          collapsed. */}
      {outputsOpen && (
        <OutputsPanel
          targets={outputs.targets}
          busy={outputs.busy}
          onNewDocument={outputs.newDocument}
          onDropDoc={outputs.dropDoc}
          onRemove={outputs.remove}
        />
      )}
    </div>
  );
};

// ─── mount ───────────────────────────────────────────────────────────────────

export function renderLaTeXEditor(
  handle: DocHandle<LaTeXDoc>,
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <Suspense fallback={<div className="ltx-placeholder">Loading…</div>}>
        <LaTeXEditorInner docUrl={handle.url} hive={element.hive} />
      </Suspense>
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
