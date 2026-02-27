import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { linter, type Diagnostic } from "@codemirror/lint";
import { LanguageSupport } from "@codemirror/language";
import { parseTheory } from "geolog";
import { geologLanguage } from "./geolog-language";

interface SchemaEditorProps {
  defaultValue: string;
  onCreateDatabase: (schema: string) => void;
}

/**
 * Schema authoring component.
 *
 * Wraps a CodeMirror editor with geolog syntax highlighting and a linter
 * that calls parseTheory() on debounced input. Shows parse errors inline
 * (using ParseError's line/column/offset fields) and elaboration errors
 * as a document-wide diagnostic.
 *
 * The "Create Database" button is enabled only when the current source
 * parses and elaborates successfully.
 */
export function SchemaEditor({ defaultValue, onCreateDatabase }: SchemaEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep a ref to the latest source so the "Create Database" button
  // can read it without depending on editor state.
  const sourceRef = useRef(defaultValue);

  const handleCreate = useCallback(() => {
    if (isValid) {
      onCreateDatabase(sourceRef.current);
    }
  }, [isValid, onCreateDatabase]);

  useEffect(() => {
    if (!containerRef.current) return;

    // The linter extension: calls parseTheory() and converts errors to
    // CodeMirror Diagnostic objects.
    const geologLinter = linter((view) => {
      const source = view.state.doc.toString();
      sourceRef.current = source;
      const diagnostics: Diagnostic[] = [];

      if (source.trim().length === 0) {
        setIsValid(false);
        setErrorMessage(null);
        return diagnostics;
      }

      try {
        parseTheory(source);
        setIsValid(true);
        setErrorMessage(null);
      } catch (e: unknown) {
        setIsValid(false);

        if (e instanceof Error && e.name === "ParseError") {
          // ParseError has line, column, offset, endOffset fields
          const pe = e as Error & {
            line: number;
            column: number;
            offset: number;
            endOffset: number;
          };

          // Use byte offsets directly as CodeMirror positions.
          // The geolog DSL is ASCII in practice so this is correct.
          // Clamp to document length for safety.
          const docLen = source.length;
          const from = Math.min(pe.offset, docLen);
          let to = Math.min(pe.endOffset, docLen);
          // Ensure at least 1 char is underlined so the diagnostic is visible
          if (to <= from) to = Math.min(from + 1, docLen);

          diagnostics.push({
            from,
            to,
            severity: "error",
            message: pe.message,
          });
          setErrorMessage(`Parse error (line ${pe.line}): ${pe.message}`);
        } else if (e instanceof Error) {
          // Elaboration error — no position info, underline whole document
          diagnostics.push({
            from: 0,
            to: source.length,
            severity: "error",
            message: e.message,
          });
          setErrorMessage(e.message);
        }
      }

      return diagnostics;
    });

    const view = new EditorView({
      doc: defaultValue,
      extensions: [
        basicSetup,
        new LanguageSupport(geologLanguage),
        geologLinter,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only run on mount/unmount — defaultValue is initial only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="schema-editor">
      <div className="schema-editor-header">
        <h2>Theory Editor</h2>
        <p className="description">
          Write a geolog theory below. The editor will check for errors as you type.
        </p>
      </div>

      <div className="schema-editor-cm" ref={containerRef} />

      <div className="schema-editor-footer">
        {errorMessage && (
          <div className="schema-error">{errorMessage}</div>
        )}
        {isValid && (
          <div className="schema-valid">Theory is valid</div>
        )}
        <button
          className="create-db-btn"
          disabled={!isValid}
          onClick={handleCreate}
        >
          Create Database
        </button>
      </div>
    </div>
  );
}
