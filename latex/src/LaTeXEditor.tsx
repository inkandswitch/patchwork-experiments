import { useDocument } from "@automerge/automerge-repo-react-hooks";
import { updateText } from "@automerge/automerge";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { toolify, ReactToolProps } from "./react-util";
import { LaTeXDoc } from "./datatype";
import "./styles.css";

const LATEX_JS_CDN = "https://cdn.jsdelivr.net/npm/latex.js/dist/";

type LatexJsModule = {
  parse: (
    input: string,
    options: { generator: any }
  ) => { htmlDocument: (baseURL?: string) => Document };
  HtmlGenerator: new (options?: { hyphenate?: boolean }) => any;
};

let latexjsModule: LatexJsModule | null = null;

async function loadLatexJs(): Promise<LatexJsModule> {
  if (latexjsModule) return latexjsModule;
  latexjsModule = (await import("latex.js")) as unknown as LatexJsModule;
  return latexjsModule;
}

function renderLatexToHtml(
  content: string,
  latexjs: LatexJsModule
): string {
  const generator = new latexjs.HtmlGenerator({ hyphenate: false });
  const parsed = latexjs.parse(content, { generator });
  const htmlDoc = parsed.htmlDocument(LATEX_JS_CDN);
  return "<!DOCTYPE html>\n" + htmlDoc.documentElement.outerHTML;
}

export const LaTeXEditor = ({ docUrl }: ReactToolProps) => {
  const [doc, changeDoc] = useDocument<LaTeXDoc>(docUrl, { suspense: true });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [latexjs, setLatexjs] = useState<LatexJsModule | null>(null);
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastRenderedRef = useRef<string>("");

  useEffect(() => {
    loadLatexJs().then(setLatexjs);
  }, []);

  const renderPreview = useCallback(
    (content: string) => {
      if (!latexjs) return;
      if (content === lastRenderedRef.current) return;
      lastRenderedRef.current = content;

      setRendering(true);
      try {
        const html = renderLatexToHtml(content, latexjs);
        if (iframeRef.current) {
          iframeRef.current.srcdoc = html;
        }
        setError(null);
      } catch (e: any) {
        const msg =
          e.location
            ? `Line ${e.location.start.line}, Col ${e.location.start.column}: ${e.message}`
            : e.message || "Failed to render LaTeX";
        setError(msg);
      } finally {
        setRendering(false);
      }
    },
    [latexjs]
  );

  useEffect(() => {
    if (!doc?.content || !latexjs) return;

    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current);
    }

    renderTimeoutRef.current = setTimeout(() => {
      renderPreview(doc.content);
    }, 400);

    return () => {
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
    };
  }, [doc?.content, latexjs, renderPreview]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    changeDoc((doc) => {
      updateText(doc, ["content"], newContent);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newContent =
        doc!.content.substring(0, start) + "  " + doc!.content.substring(end);
      changeDoc((doc) => {
        updateText(doc, ["content"], newContent);
      });
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  };

  const exportHTML = useCallback(() => {
    if (!doc?.content || !latexjs) return;
    try {
      const html = renderLatexToHtml(doc.content, latexjs);
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
  }, [doc?.content, latexjs]);

  const exportPDF = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.print();
  }, []);

  if (!doc) return <div className="latex-loading">Loading...</div>;

  return (
    <div className="latex-container">
      <div className="latex-toolbar">
        <span className="latex-toolbar-label">LaTeX</span>
        <div className="latex-toolbar-actions">
          {rendering && <span className="latex-status">Rendering...</span>}
          <button
            onClick={exportHTML}
            className="latex-btn"
            title="Export as HTML"
          >
            <FileText size={14} />
            <span>HTML</span>
          </button>
          <button
            onClick={exportPDF}
            className="latex-btn"
            title="Print / Save as PDF"
          >
            <Printer size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>
      {error && (
        <div className="latex-error">
          <span className="latex-error-icon">!</span>
          {error}
        </div>
      )}
      <div className="latex-split">
        <div className="latex-editor-pane">
          <textarea
            className="latex-textarea"
            value={doc.content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <div className="latex-preview-pane">
          {!latexjs ? (
            <div className="latex-preview-loading">Loading renderer...</div>
          ) : (
            <iframe
              ref={iframeRef}
              className="latex-preview-iframe"
              title="LaTeX Preview"
              sandbox="allow-same-origin allow-scripts"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const renderLaTeXEditor = toolify(LaTeXEditor);
