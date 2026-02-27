import { useEffect, useRef, useCallback, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { linter, type Diagnostic } from '@codemirror/lint';
import { LanguageSupport } from '@codemirror/language';
import { parseTheory } from 'geolog';
import { geologLanguage } from './geolog-language';

interface SchemaEditorProps {
  defaultValue: string;
  onSaveTheory: (schema: string) => void;
}

/**
 * Theory authoring component.
 *
 * Wraps a CodeMirror editor with geolog syntax highlighting and a linter
 * that calls parseTheory() on debounced input. The "Save Theory" button is
 * enabled only when the current source parses and elaborates successfully.
 */
export function SchemaEditor({ defaultValue, onSaveTheory }: SchemaEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sourceRef = useRef(defaultValue);

  const handleSave = useCallback(() => {
    if (isValid) {
      onSaveTheory(sourceRef.current);
    }
  }, [isValid, onSaveTheory]);

  useEffect(() => {
    if (!containerRef.current) return;

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

        if (e instanceof Error && e.name === 'ParseError') {
          const pe = e as Error & {
            line: number;
            column: number;
            offset: number;
            endOffset: number;
          };

          const docLen = source.length;
          const from = Math.min(pe.offset, docLen);
          let to = Math.min(pe.endOffset, docLen);
          if (to <= from) to = Math.min(from + 1, docLen);

          diagnostics.push({
            from,
            to,
            severity: 'error',
            message: pe.message,
          });
          setErrorMessage(`Parse error (line ${pe.line}): ${pe.message}`);
        } else if (e instanceof Error) {
          diagnostics.push({
            from: 0,
            to: source.length,
            severity: 'error',
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
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
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
        <p className="description">Write a geolog theory. The editor checks for errors as you type.</p>
      </div>

      <div className="schema-editor-cm" ref={containerRef} />

      <div className="schema-editor-footer">
        {errorMessage && <div className="schema-error">{errorMessage}</div>}
        {isValid && <div className="schema-valid">Theory is valid</div>}
        <button className="create-db-btn" disabled={!isValid} onClick={handleSave}>
          Save Theory
        </button>
      </div>
    </div>
  );
}
