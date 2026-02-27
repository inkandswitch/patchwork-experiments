import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { EditorView, basicSetup } from 'codemirror';
import { LanguageSupport } from '@codemirror/language';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useCallback, useState } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { GeologAutomerge, type GeologDoc } from './geolog-automerge';
import { SchemaEditor } from './SchemaEditor';
import { GenericEditor } from './GenericEditor';
import { geologLanguage } from './geolog-language';
import './index.css';

export const GeologTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo as any}>
      <GeologViewer docUrl={handle.url} handle={handle as any} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ============================================================================
// Read-only theory panel
// ============================================================================

function TheoryPanel({
  src,
  theoryName,
  onEdit,
}: {
  src: string;
  theoryName: string;
  onEdit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: src,
      extensions: [
        basicSetup,
        new LanguageSupport(geologLanguage),
        EditorView.editable.of(false),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
      parent: containerRef.current,
    });

    return () => view.destroy();
    // Re-create only when src changes (theory was replaced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div className="theory-panel">
      <div className="theory-panel-header">
        <span className="theory-name">{theoryName}</span>
        <button className="edit-schema-btn" onClick={onEdit}>
          Edit Theory
        </button>
      </div>
      <div className="schema-editor-cm theory-readonly" ref={containerRef} />
    </div>
  );
}

// ============================================================================
// Main viewer component
// ============================================================================

function GeologViewer({
  docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: Parameters<typeof GeologAutomerge.load>[0];
}) {
  const [doc] = useDocument<GeologDoc>(docUrl);
  const [geolog, setGeolog] = useState<GeologAutomerge | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditingTheory, setIsEditingTheory] = useState(false);
  const initializedRef = useRef(false);

  // Initialize GeologAutomerge once when the doc is first available with a theory.
  useEffect(() => {
    if (initializedRef.current) return;
    if (!doc?.theory) return;

    initializedRef.current = true;
    setIsLoading(true);

    GeologAutomerge.load(handle).then((g) => {
      setGeolog(g);
      setIsLoading(false);
    });
  }, [doc, handle]);

  const handleSaveTheory = useCallback(
    (src: string) => {
      // Dispose old instance's change listener before replacing.
      geolog?.dispose();

      const g = GeologAutomerge.create(handle, src);
      setGeolog(g);
      setIsEditingTheory(false);
      initializedRef.current = true;
    },
    [geolog, handle],
  );

  const handleEditTheory = useCallback(() => {
    setIsEditingTheory(true);
  }, []);

  // Setup or editing: show the theory editor.
  if (!doc?.theory || isEditingTheory) {
    return (
      <div className="geolog-tool">
        <SchemaEditor
          defaultValue={doc?.theorySrc ?? ''}
          onSaveTheory={handleSaveTheory}
        />
      </div>
    );
  }

  if (isLoading || !geolog) {
    return (
      <div className="loading">
        <span className="loading-spinner">Loading database…</span>
      </div>
    );
  }

  return (
    <div className="geolog-tool">
      <TheoryPanel
        src={doc.theorySrc}
        theoryName={geolog.theoryName}
        onEdit={handleEditTheory}
      />
      <div className="data-panel">
        <GenericEditor geolog={geolog} />
      </div>
    </div>
  );
}
