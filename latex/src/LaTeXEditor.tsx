import {
  useDocument,
  useDocHandle,
} from "@automerge/automerge-repo-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import { automergeSyncPlugin } from "@automerge/automerge-codemirror";
import { toolify, ReactToolProps } from "./react-util";
import { LaTeXDoc } from "./datatype";
import type { HtmlGenerator as HtmlGeneratorType } from "latex.js";
import "./styles.css";

const LATEX_JS_CDN = "https://cdn.jsdelivr.net/npm/latex.js/dist/";

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
  const htmlDoc = parsed.htmlDocument(LATEX_JS_CDN);
  return "<!DOCTYPE html>\n" + htmlDoc.documentElement.outerHTML;
}

type PreviewMode = "html" | "pdf";

const cmTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace" },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { border: "none", background: "transparent" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "32px" },
  "&.cm-focused": { outline: "none" },
});

const cmDarkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#1a1a1a", color: "#e5e5e5" },
    ".cm-cursor": { borderLeftColor: "#e5e5e5" },
    ".cm-activeLine": { backgroundColor: "#ffffff08" },
    ".cm-activeLineGutter": { backgroundColor: "#ffffff08" },
    ".cm-selectionBackground": { backgroundColor: "#ffffff20 !important" },
    ".cm-gutters": { color: "#555" },
  },
  { dark: true }
);

export const LaTeXEditor = ({ docUrl }: ReactToolProps) => {
  const [doc] = useDocument<LaTeXDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<LaTeXDoc>(docUrl, { suspense: true });
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [latexjsMod, setLatexjsMod] = useState<LatexJsModule | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("html");
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastRenderedRef = useRef<string>("");

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

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [handle]);

  // Render preview
  const renderPreview = useCallback(
    (content: string) => {
      if (!latexjsMod) return;
      if (content === lastRenderedRef.current) return;
      lastRenderedRef.current = content;

      try {
        const html = renderLatexToHtml(content, latexjsMod);
        if (iframeRef.current) {
          iframeRef.current.srcdoc = html;
        }
        setError(null);
      } catch (e: any) {
        const msg = e.location
          ? `Line ${e.location.start.line}, Col ${e.location.start.column}: ${e.message}`
          : e.message || "Failed to render LaTeX";
        setError(msg);
      }
    },
    [latexjsMod]
  );

  // Debounced preview updates
  useEffect(() => {
    if (!doc?.content || !latexjsMod) return;

    if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);

    renderTimeoutRef.current = setTimeout(() => {
      renderPreview(doc.content);
    }, 400);

    return () => {
      if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);
    };
  }, [doc?.content, latexjsMod, renderPreview]);

  const downloadCurrent = useCallback(() => {
    if (!doc?.content || !latexjsMod) return;

    if (previewMode === "pdf") {
      iframeRef.current?.contentWindow?.print();
      return;
    }

    try {
      const html = renderLatexToHtml(doc.content, latexjsMod);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.html";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Export failed: " + e.message);
    }
  }, [doc?.content, latexjsMod, previewMode]);

  if (!doc) return <div className="latex-loading">Loading...</div>;

  return (
    <div className="latex-container">
      {error && (
        <div className="latex-error">
          <span className="latex-error-icon">!</span>
          {error}
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
              title={previewMode === "html" ? "Download HTML" : "Print / Save as PDF"}
            >
              <Download size={14} />
            </button>
          </div>
          {!latexjsMod ? (
            <div className="latex-preview-loading">Loading renderer...</div>
          ) : (
            <iframe
              ref={iframeRef}
              className="latex-preview-iframe"
              title="LaTeX Preview"
              sandbox="allow-same-origin allow-scripts allow-modals"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const renderLaTeXEditor = toolify(LaTeXEditor);
