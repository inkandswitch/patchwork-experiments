import {
  useDocument,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import type { SiglumCompiler as SiglumCompilerType } from "@siglum/engine";
import { toolify, ReactToolProps } from "./react-util";
import { LaTeXDoc, getDocTitle } from "./datatype";
import type { HtmlGenerator as HtmlGeneratorType } from "latex.js";
import "./styles.css";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const LATEXJS_BASE_URL = "https://cdn.jsdelivr.net/npm/latex.js/dist/";
const SIGLUM_TEXLIVE_URL = "https://cdn.siglum.org/tl2025";

// ---------------------------------------------------------------------------
// LaTeX.js (HTML preview)
// ---------------------------------------------------------------------------

type LatexJsModule = typeof import("latex.js");
let latexjsModule: LatexJsModule | null = null;

async function loadLatexJs(): Promise<LatexJsModule> {
  if (latexjsModule) return latexjsModule;
  latexjsModule = await import("latex.js");
  return latexjsModule;
}

function renderLatexToHtml(content: string, mod: LatexJsModule): string {
  const generator = new mod.HtmlGenerator({ hyphenate: false });
  const parsed = mod.parse(content, { generator }) as HtmlGeneratorType;
  const htmlDoc = parsed.htmlDocument(LATEXJS_BASE_URL);
  return "<!DOCTYPE html>\n" + htmlDoc.documentElement.outerHTML;
}

// ---------------------------------------------------------------------------
// Siglum (PDF compilation) -- loaded from CDN to avoid WASM bundling issues
// ---------------------------------------------------------------------------

const SIGLUM_VERSION = "0.1.4";
const SIGLUM_MODULE_URL = `https://esm.sh/@siglum/engine@${SIGLUM_VERSION}`;
const SIGLUM_WORKER_URL = `https://cdn.jsdelivr.net/npm/@siglum/engine@${SIGLUM_VERSION}/src/worker.js`;

async function fetchWorkerBlobUrl(): Promise<string> {
  const resp = await fetch(SIGLUM_WORKER_URL);
  const text = await resp.text();
  const blob = new Blob([text], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

let compilerInstance: SiglumCompilerType | null = null;

async function getOrCreateCompiler(
  onProgress?: (stage: string, detail: string) => void
): Promise<SiglumCompilerType> {
  if (compilerInstance?.isReady()) return compilerInstance;

  if (compilerInstance) {
    await compilerInstance.init();
    return compilerInstance;
  }

  const [{ SiglumCompiler }, workerUrl] = await Promise.all([
    import(/* @vite-ignore */ SIGLUM_MODULE_URL) as Promise<
      typeof import("@siglum/engine")
    >,
    fetchWorkerBlobUrl(),
  ]);

  compilerInstance = new SiglumCompiler({
    bundlesUrl: `${SIGLUM_TEXLIVE_URL}/bundles`,
    wasmUrl: `${SIGLUM_TEXLIVE_URL}/busytex.wasm`,
    workerUrl,
    onProgress,
    verbose: false,
  });

  await compilerInstance.init();
  return compilerInstance;
}

// ---------------------------------------------------------------------------
// CodeMirror themes
// ---------------------------------------------------------------------------

type PreviewMode = "html" | "pdf";

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { border: "none", background: "transparent" },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 12px",
    minWidth: "32px",
  },
  "&.cm-focused": { outline: "none" },
});

const cmDarkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#1a1a1a", color: "#e5e5e5" },
    ".cm-cursor": { borderLeftColor: "#e5e5e5" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-activeLineGutter": { backgroundColor: "#ffffff08" },
    ".cm-selectionBackground": {
      backgroundColor: "#ffffff20 !important",
    },
    ".cm-gutters": { color: "#555" },
  },
  { dark: true }
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const LaTeXEditor: React.FC<ReactToolProps> = ({ docUrl }) => {
  const [doc] = useDocument<LaTeXDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<LaTeXDoc>(docUrl, { suspense: true });

  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Preview state
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("html");
  const [latexjsMod, setLatexjsMod] = useState<LatexJsModule | null>(null);

  // HTML preview
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const htmlRenderTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastRenderedHtml = useRef("");

  // PDF preview
  const [pdfStatus, setPdfStatus] = useState<
    "idle" | "init" | "compiling" | "ready" | "error" | "unsupported"
  >("idle");
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const pdfBlobUrlRef = useRef<string | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const pdfCompileTimeout = useRef<ReturnType<typeof setTimeout>>();
  const lastCompiledPdf = useRef("");

  // Load LaTeX.js on mount
  useEffect(() => {
    loadLatexJs().then(setLatexjsMod);
  }, []);

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorContainerRef.current || !handle) return;

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

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    return () => view.destroy();
  }, [handle]);

  // ------ HTML preview ------

  const renderHtmlPreview = useCallback(
    (content: string) => {
      if (!latexjsMod || previewMode !== "html") return;
      if (content === lastRenderedHtml.current) return;
      lastRenderedHtml.current = content;

      try {
        const html = renderLatexToHtml(content, latexjsMod);
        if (iframeRef.current) {
          iframeRef.current.removeAttribute("src");
          iframeRef.current.srcdoc = html;
        }
        setHtmlError(null);
      } catch (e: any) {
        const msg = e.location
          ? `Line ${e.location.start.line}, Col ${e.location.start.column}: ${e.message}`
          : e.message || "Failed to render LaTeX";
        setHtmlError(msg);
      }
    },
    [latexjsMod, previewMode]
  );

  useEffect(() => {
    if (!doc?.content || !latexjsMod || previewMode !== "html") return;

    if (htmlRenderTimeout.current) clearTimeout(htmlRenderTimeout.current);
    htmlRenderTimeout.current = setTimeout(() => {
      renderHtmlPreview(doc.content);
    }, 400);

    return () => {
      if (htmlRenderTimeout.current) clearTimeout(htmlRenderTimeout.current);
    };
  }, [doc?.content, latexjsMod, previewMode, renderHtmlPreview]);

  // ------ PDF compilation ------

  const compilePdf = useCallback(
    async (content: string) => {
      if (content === lastCompiledPdf.current) return;

      if (typeof SharedArrayBuffer === "undefined") {
        setPdfStatus("unsupported");
        setPdfMessage(
          "PDF compilation requires SharedArrayBuffer, which is not available. " +
            "The server must send Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers."
        );
        return;
      }

      try {
        setPdfStatus("init");
        setPdfMessage("Loading TeX engine...");

        const compiler = await getOrCreateCompiler((stage, detail) => {
          setPdfMessage(`${stage}${detail ? `: ${detail}` : ""}`);
        });

        setPdfStatus("compiling");
        setPdfMessage("Compiling...");

        const result = await compiler.compile(content);

        if (result.success && result.pdf) {
          // Revoke previous blob
          if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);

          // Copy into a plain ArrayBuffer so Blob accepts it
          const buf = new ArrayBuffer(result.pdf.byteLength);
          new Uint8Array(buf).set(result.pdf);

          pdfBytesRef.current = new Uint8Array(buf);
          const blob = new Blob([buf], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          pdfBlobUrlRef.current = url;

          if (iframeRef.current) {
            iframeRef.current.removeAttribute("srcdoc");
            iframeRef.current.src = url;
          }

          lastCompiledPdf.current = content;
          setPdfStatus("ready");
          setPdfMessage(null);
        } else {
          setPdfStatus("error");
          setPdfMessage(result.error || result.log || "Compilation failed");
        }
      } catch (e: any) {
        setPdfStatus("error");
        setPdfMessage(e.message || "PDF compilation failed");
      }
    },
    []
  );

  // Trigger PDF compilation on mode switch or content change
  useEffect(() => {
    if (!doc?.content || previewMode !== "pdf") return;

    if (pdfCompileTimeout.current) clearTimeout(pdfCompileTimeout.current);
    pdfCompileTimeout.current = setTimeout(() => {
      compilePdf(doc.content);
    }, 1500);

    return () => {
      if (pdfCompileTimeout.current) clearTimeout(pdfCompileTimeout.current);
    };
  }, [doc?.content, previewMode, compilePdf]);

  // Switch preview content when mode changes
  useEffect(() => {
    if (previewMode === "html" && latexjsMod && doc?.content) {
      lastRenderedHtml.current = "";
      renderHtmlPreview(doc.content);
    }
    if (previewMode === "pdf" && pdfBlobUrlRef.current && iframeRef.current) {
      iframeRef.current.removeAttribute("srcdoc");
      iframeRef.current.src = pdfBlobUrlRef.current;
    }
  }, [previewMode]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current);
    };
  }, []);

  // ------ Download ------

  const downloadCurrent = useCallback(() => {
    if (!doc?.content) return;
    const title = getDocTitle(doc.content);

    if (previewMode === "html" && latexjsMod) {
      try {
        const html = renderLatexToHtml(doc.content, latexjsMod);
        downloadBlob(new Blob([html], { type: "text/html" }), `${title}.html`);
      } catch (e: any) {
        alert("Export failed: " + e.message);
      }
    } else if (previewMode === "pdf" && pdfBytesRef.current) {
      downloadBlob(
        new Blob([pdfBytesRef.current.buffer as ArrayBuffer], {
          type: "application/pdf",
        }),
        `${title}.pdf`
      );
    }
  }, [doc?.content, latexjsMod, previewMode]);

  // ------ Render ------

  if (!doc) return <div className="latex-loading">Loading...</div>;

  const showError =
    previewMode === "html"
      ? htmlError
      : pdfStatus === "error" || pdfStatus === "unsupported"
        ? pdfMessage
        : null;

  const showProgress =
    previewMode === "pdf" &&
    (pdfStatus === "init" || pdfStatus === "compiling");

  const canDownload =
    (previewMode === "html" && latexjsMod) ||
    (previewMode === "pdf" && pdfBytesRef.current);

  return (
    <div className="latex-container">
      {showError && (
        <div className="latex-error">
          <span className="latex-error-icon">!</span>
          <span className="latex-error-text">{showError}</span>
        </div>
      )}
      <div className="latex-split">
        <div className="latex-editor-pane">
          <div ref={editorContainerRef} className="latex-cm-container" />
        </div>
        <div className="latex-preview-pane">
          <div className="latex-preview-controls">
            <div className="latex-mode-toggle">
              <button
                className={`latex-mode-btn ${previewMode === "html" ? "active" : ""}`}
                onClick={() => setPreviewMode("html")}
              >
                HTML
              </button>
              <button
                className={`latex-mode-btn ${previewMode === "pdf" ? "active" : ""}`}
                onClick={() => setPreviewMode("pdf")}
              >
                PDF
              </button>
            </div>
            <button
              onClick={downloadCurrent}
              className="latex-download-btn"
              disabled={!canDownload}
              title={
                previewMode === "html" ? "Download HTML" : "Download PDF"
              }
            >
              <Download size={14} />
            </button>
          </div>

          {showProgress && (
            <div className="latex-progress">
              <div className="latex-progress-spinner" />
              <span>{pdfMessage}</span>
            </div>
          )}

          {!latexjsMod && previewMode === "html" ? (
            <div className="latex-preview-loading">Loading renderer...</div>
          ) : (
            <iframe
              ref={iframeRef}
              className="latex-preview-iframe"
              title="LaTeX Preview"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const renderLaTeXEditor = toolify(LaTeXEditor);
