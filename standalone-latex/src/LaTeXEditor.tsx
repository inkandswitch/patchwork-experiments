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
  PanelRightClose,
  PanelRightOpen,
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
  loadLatexJs,
  pdfSupported,
  renderLatexToHtml,
} from "./compile";
import { getDocTitle, type LaTeXDoc } from "./datatype";
import {
  addTarget,
  createHtmlFileDoc,
  createPdfFileDoc,
  ensureOutputEdge,
  findOutputEdge,
  isFileLikeDoc,
  publishHtml,
  publishPdf,
  removeTarget,
  resolveTargets,
  type FileDocShape,
  type OutputKind,
  type OutputTarget,
} from "./outputs";
import { DocPathPicker } from "./DocPathPicker";
import { OutputsPanel } from "./OutputsPanel";
import "./styles.css";

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

function useCodeMirror(handle: DocHandle<LaTeXDoc>) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    return () => view.destroy();
  }, [handle]);

  return containerRef;
}

// ─── output wiring ───────────────────────────────────────────────────────────

type PendingPick = { url: AutomergeUrl; title: string; doc: unknown };

function useOutputs(
  handle: DocHandle<LaTeXDoc>,
  hive: ToolElement["hive"],
  htmlRef: { current: string | null },
  pdfRef: { current: Uint8Array | null }
) {
  const repo = useRepo();
  const [htmlEdge, setHtmlEdge] = useState<EdgeHandle<string> | null>(null);
  const [pdfEdge, setPdfEdge] = useState<EdgeHandle<Uint8Array> | null>(null);
  const [htmlTargets, setHtmlTargets] = useState<OutputTarget[]>([]);
  const [pdfTargets, setPdfTargets] = useState<OutputTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);

  // Open the recorded edges (if any) on mount.
  useEffect(() => {
    let cancelled = false;
    findOutputEdge<string>(repo, handle, "html").then((e) => {
      if (!cancelled && e) setHtmlEdge(e);
    });
    findOutputEdge<Uint8Array>(repo, handle, "pdf").then((e) => {
      if (!cancelled && e) setPdfEdge(e);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, handle]);

  // Track membership per edge: refresh the chip list and push the latest
  // compiled output into freshly-connected targets.
  useEffect(() => {
    if (!htmlEdge) return;
    let cancelled = false;
    const unsub = htmlEdge.onMembersChange(() => {
      resolveTargets(repo, htmlEdge, "html").then((t) => {
        if (!cancelled) setHtmlTargets(t);
      });
      if (htmlRef.current != null) publishHtml(htmlEdge, htmlRef.current);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [htmlEdge, repo, htmlRef]);

  useEffect(() => {
    if (!pdfEdge) return;
    let cancelled = false;
    const unsub = pdfEdge.onMembersChange(() => {
      resolveTargets(repo, pdfEdge, "pdf").then((t) => {
        if (!cancelled) setPdfTargets(t);
      });
      if (pdfRef.current != null) publishPdf(pdfEdge, pdfRef.current);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [pdfEdge, repo, pdfRef]);

  const withEdge = useCallback(
    async (
      kind: OutputKind,
      fn: (edge: EdgeHandle<unknown>) => Promise<void>
    ) => {
      setBusy(true);
      try {
        let e: EdgeHandle<unknown> | null =
          kind === "html"
            ? (htmlEdge as EdgeHandle<unknown> | null)
            : (pdfEdge as EdgeHandle<unknown> | null);
        if (!e) {
          e = await ensureOutputEdge<unknown>(repo, handle, kind);
          if (kind === "html") setHtmlEdge(e as EdgeHandle<string>);
          else setPdfEdge(e as EdgeHandle<Uint8Array>);
        }
        await fn(e);
      } catch (err) {
        console.error("[latex] output wiring failed", err);
      } finally {
        setBusy(false);
      }
    },
    [htmlEdge, pdfEdge, repo, handle]
  );

  const newDocument = useCallback(
    (kind: OutputKind) => {
      void withEdge(kind, async (e) => {
        const title = getDocTitle(handle.doc()?.content ?? "");
        const fileHandle =
          kind === "html"
            ? await createHtmlFileDoc(repo, title, htmlRef.current ?? "", hive)
            : await createPdfFileDoc(
                repo,
                title,
                pdfRef.current ?? new Uint8Array(),
                hive
              );
        await addTarget(repo, e, fileHandle.url, ["content"]);
      });
    },
    [withEdge, repo, handle, hive, htmlRef, pdfRef]
  );

  // Drops always connect to the html edge — we never write PDF bytes into
  // an arbitrary slot of an existing document.
  const dropDoc = useCallback(
    (url: AutomergeUrl, name?: string) => {
      void (async () => {
        try {
          const docHandle = await repo.find<FileDocShape>(url);
          const doc = docHandle.doc();
          if (isFileLikeDoc(doc)) {
            await withEdge("html", (e) => addTarget(repo, e, url, ["content"]));
          } else {
            setPendingPick({
              url,
              title: name || doc?.title || doc?.name || "Document",
              doc,
            });
          }
        } catch (err) {
          console.error(`[latex] failed to load dropped doc ${url}`, err);
        }
      })();
    },
    [repo, withEdge]
  );

  const resolvePick = useCallback(
    (path: string[] | null) => {
      const pick = pendingPick;
      setPendingPick(null);
      if (!pick || !path) return;
      void withEdge("html", (e) => addTarget(repo, e, pick.url, path));
    },
    [pendingPick, withEdge, repo]
  );

  const remove = useCallback(
    (target: OutputTarget) => {
      const e = target.kind === "html" ? htmlEdge : pdfEdge;
      if (e) removeTarget(e as EdgeHandle<unknown>, target.key);
    },
    [htmlEdge, pdfEdge]
  );

  const targets = useMemo(
    () => [...htmlTargets, ...pdfTargets],
    [htmlTargets, pdfTargets]
  );

  return {
    htmlEdge,
    pdfEdge,
    targets,
    pdfTargetCount: pdfTargets.length,
    busy,
    pendingPick,
    newDocument,
    dropDoc,
    resolvePick,
    remove,
  };
}

// ─── component ───────────────────────────────────────────────────────────────

type PreviewMode = "html" | "pdf";

const LaTeXEditorInner = ({
  docUrl,
  hive,
}: {
  docUrl: AutomergeUrl;
  hive: ToolElement["hive"];
}) => {
  const [doc] = useDocument<LaTeXDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<LaTeXDoc>(docUrl, { suspense: true });

  const editorRef = useCodeMirror(handle);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [previewMode, setPreviewMode] = useState<PreviewMode>("html");
  const [previewOpen, setPreviewOpen] = useState(true);
  const [outputsOpen, setOutputsOpen] = useState(false);

  // HTML pipeline (preview + outputs share one render)
  const [latexjsReady, setLatexjsReady] = useState(false);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const htmlRef = useRef<string | null>(null);

  // PDF state
  const [pdfStatus, setPdfStatus] = useState<
    "idle" | "working" | "ready" | "error" | "unsupported"
  >("idle");
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const pdfBlobUrlRef = useRef<string | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const lastCompiledRef = useRef("");
  const pdfGenRef = useRef(0);

  const outputs = useOutputs(handle, hive, htmlRef, pdfBytesRef);

  // Effects and the render pump read live values through refs so they
  // don't have to re-run (or capture stale closures) when these change.
  const previewModeRef = useRef<PreviewMode>(previewMode);
  previewModeRef.current = previewMode;
  const edgesRef = useRef<{
    html: EdgeHandle<string> | null;
    pdf: EdgeHandle<Uint8Array> | null;
  }>({ html: null, pdf: null });
  edgesRef.current = { html: outputs.htmlEdge, pdf: outputs.pdfEdge };

  useEffect(() => {
    loadLatexJs().then(() => setLatexjsReady(true));
  }, []);

  // ── HTML render pump ──
  // Latest-wins, no debounce: render as you type, but never queue more
  // than the head. While a render is in flight new content just replaces
  // the head; when the render finishes the pump picks up whatever is
  // newest and yields a tick between renders so typing stays responsive.
  const headRef = useRef<string | null>(null);
  const pumpingRef = useRef(false);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      const mod = await loadLatexJs();
      while (headRef.current != null) {
        const content = headRef.current;
        headRef.current = null;
        const result = renderLatexToHtml(content, mod);
        if (result.ok) {
          htmlRef.current = result.html;
          setHtmlError(null);
          if (iframeRef.current && previewModeRef.current === "html") {
            iframeRef.current.removeAttribute("src");
            iframeRef.current.srcdoc = result.html;
          }
          const edge = edgesRef.current.html;
          if (edge) publishHtml(edge, result.html);
        } else {
          setHtmlError(result.error);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      pumpingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (doc?.content == null) return;
    headRef.current = doc.content;
    void pump();
  }, [doc?.content, pump]);

  // Publish the current render when the html edge finishes loading.
  useEffect(() => {
    if (outputs.htmlEdge && htmlRef.current != null) {
      publishHtml(outputs.htmlEdge, htmlRef.current);
    }
  }, [outputs.htmlEdge]);

  // ── PDF compile loop ──
  // Runs while the PDF tab is visible or any PDF target is connected. PDF
  // keeps a real debounce: each compile is expensive, and each publish
  // writes a full binary blob into automerge history.
  const wantPdf =
    (previewOpen && previewMode === "pdf") || outputs.pdfTargetCount > 0;

  useEffect(() => {
    if (!wantPdf || doc?.content == null) return;
    if (!pdfSupported()) {
      setPdfStatus("unsupported");
      setPdfMessage(
        "PDF compilation requires SharedArrayBuffer (cross-origin isolation headers)."
      );
      return;
    }
    const content = doc.content;
    if (content === lastCompiledRef.current) return;

    const timer = setTimeout(async () => {
      const gen = ++pdfGenRef.current;
      setPdfStatus("working");
      setPdfMessage("Loading TeX engine…");
      const result = await compileLatexToPdf(content, setPdfMessage);
      if (gen !== pdfGenRef.current) return; // superseded by a newer compile
      if (result.ok) {
        pdfBytesRef.current = result.bytes;
        const url = URL.createObjectURL(
          new Blob([result.bytes.buffer as ArrayBuffer], {
            type: "application/pdf",
          })
        );
        // Swap first, revoke the old URL later — revoking the URL the
        // iframe is showing blanks it, which was one half of the flicker.
        const old = pdfBlobUrlRef.current;
        pdfBlobUrlRef.current = url;
        if (iframeRef.current && previewModeRef.current === "pdf") {
          iframeRef.current.removeAttribute("srcdoc");
          iframeRef.current.src = url;
        }
        if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
        lastCompiledRef.current = content;
        setPdfStatus("ready");
        setPdfMessage(null);
        const edge = edgesRef.current.pdf;
        if (edge) publishPdf(edge, result.bytes);
      } else {
        setPdfStatus("error");
        setPdfMessage(result.error);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [doc?.content, wantPdf]);

  // ── populate the iframe when it (re)mounts or the view changes ──
  // The iframe only mounts once latex.js is ready, which can race the
  // first render pump finishing — so on first open the pump may have
  // produced HTML before the iframe existed. Re-running when the iframe
  // appears (latexjsReady) closes that gap without needing a manual kick.
  useEffect(() => {
    if (!previewOpen) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    if (previewMode === "html" && htmlRef.current != null) {
      iframe.removeAttribute("src");
      iframe.srcdoc = htmlRef.current;
    } else if (previewMode === "pdf" && pdfBlobUrlRef.current) {
      iframe.removeAttribute("srcdoc");
      iframe.src = pdfBlobUrlRef.current;
    }
  }, [previewMode, previewOpen, latexjsReady]);

  useEffect(() => {
    return () => {
      if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
    };
  }, []);

  // ── download ──
  const download = useCallback(() => {
    const title = getDocTitle(doc?.content ?? "");
    if (previewMode === "html" && htmlRef.current != null) {
      downloadBlob(
        new Blob([htmlRef.current], { type: "text/html" }),
        `${title}.html`
      );
    } else if (previewMode === "pdf" && pdfBlobUrlRef.current) {
      // Reuse the blob URL the iframe is already showing — minting (and
      // later revoking) a fresh one made the PDF viewer repaint.
      const a = document.createElement("a");
      a.href = pdfBlobUrlRef.current;
      a.download = `${title}.pdf`;
      a.click();
    }
  }, [doc?.content, previewMode]);

  const title = useMemo(() => getDocTitle(doc?.content ?? ""), [doc?.content]);

  const previewError =
    previewMode === "html"
      ? htmlError
      : pdfStatus === "error" || pdfStatus === "unsupported"
        ? pdfMessage
        : null;

  const canDownload =
    previewMode === "html" ? htmlRef.current != null : !!pdfBlobUrlRef.current;

  const liveTargets = outputs.targets.length;
  const pdfWorking = previewMode === "pdf" && pdfStatus === "working";

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

        <div className="ltx-toolbar-spacer" />

        <button
          className={`ltx-btn ghost outputs-toggle${outputsOpen ? " active" : ""}${liveTargets > 0 ? " live" : ""}`}
          onClick={() => setOutputsOpen((o) => !o)}
          title="Write compiled output to other documents"
        >
          <Cable size={13} />
          Outputs
          {liveTargets > 0 && <span className="count">{liveTargets}</span>}
        </button>

        {previewOpen && (
          <>
            <div className="ltx-seg">
              <button
                className={previewMode === "html" ? "active" : ""}
                onClick={() => setPreviewMode("html")}
              >
                HTML
              </button>
              <button
                className={previewMode === "pdf" ? "active" : ""}
                onClick={() => setPreviewMode("pdf")}
              >
                PDF
              </button>
            </div>

            <button
              className="ltx-icon-btn"
              onClick={download}
              disabled={!canDownload}
              title={previewMode === "html" ? "Download HTML" : "Download PDF"}
            >
              <Download size={14} />
            </button>
          </>
        )}

        {!previewOpen && previewError && (
          <span className="ltx-toolbar-warn" title={previewError}>
            !
          </span>
        )}

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
            {!latexjsReady && previewMode === "html" ? (
              <div className="ltx-placeholder">Loading renderer…</div>
            ) : (
              <iframe
                ref={iframeRef}
                className="ltx-preview-iframe"
                title="LaTeX Preview"
              />
            )}

            {/* Full overlay only before the first PDF exists; afterwards a
                quiet corner badge — the old overlay was the other half of
                the recompile flicker. */}
            {pdfWorking && !pdfBlobUrlRef.current && (
              <div className="ltx-progress">
                <div className="ltx-spinner" />
                <span>{pdfMessage}</span>
              </div>
            )}
            {pdfWorking && pdfBlobUrlRef.current && (
              <div className="ltx-compiling-badge">
                <div className="ltx-spinner small" />
                <span>Compiling…</span>
              </div>
            )}

            {previewError && (
              <div className="ltx-error">
                <span className="badge">!</span>
                <span className="text">{previewError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Anchored to the root, not the preview pane, so it stays usable
          while the preview is collapsed. */}
      {outputsOpen && (
        <OutputsPanel
          targets={outputs.targets}
          busy={outputs.busy}
          onNewDocument={outputs.newDocument}
          onDropDoc={outputs.dropDoc}
          onRemove={outputs.remove}
        />
      )}

      {outputs.pendingPick && (
        <DocPathPicker
          title={outputs.pendingPick.title}
          doc={outputs.pendingPick.doc}
          onPick={(path) => outputs.resolvePick(path)}
          onCancel={() => outputs.resolvePick(null)}
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
