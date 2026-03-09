import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { automergeSyncPlugin } from '@automerge/automerge-codemirror';
import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import type { DatalogDoc } from './datatype';
import { type StoredFact, parseProgram, factKey, evaluate } from './datalog';
import { useEffect, useMemo, useRef } from 'react';
import './index.css';

export const DatalogTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <DatalogViewer docUrl={handle.url} handle={handle as DocHandle<DatalogDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

function DatalogViewer({
  docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: DocHandle<DatalogDoc>;
}) {
  const [doc] = useDocument<DatalogDoc>(docUrl);

  const { derivedFacts, baseFacts, factsErrors, rulesErrors } = useMemo(() => {
    if (!doc)
      return { derivedFacts: [], baseFacts: new Set<string>(), factsErrors: [], rulesErrors: [] };

    const fp = parseProgram(doc.factsText ?? '');
    const rp = parseProgram(doc.rulesText ?? '');

    let derived: StoredFact[] = [];
    try {
      derived = evaluate(fp.facts, rp.rules);
    } catch {
      derived = fp.facts;
    }

    return {
      derivedFacts: derived,
      baseFacts: new Set(fp.facts.map(factKey)),
      factsErrors: fp.errors.map((e) => `Line ${e.line}: ${e.message}`),
      rulesErrors: rp.errors.map((e) => `Line ${e.line}: ${e.message}`),
    };
  }, [doc]);

  const grouped = useMemo(() => {
    const map = new Map<string, StoredFact[]>();
    for (const f of derivedFacts) {
      if (!map.has(f.pred)) map.set(f.pred, []);
      map.get(f.pred)!.push(f);
    }
    return map;
  }, [derivedFacts]);

  if (!doc) {
    return <div className="pg-loading">Loading…</div>;
  }

  return (
    <div className="pg-root">
      <div className="pg-editors">
        <section className="pg-section">
          <h2 className="pg-section-title">Base Facts</h2>
          <div className="pg-editor-wrap">
            <CodeMirrorEditor handle={handle} path={['factsText']} />
          </div>
          {factsErrors.length > 0 && (
            <ul className="pg-errors">
              {factsErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </section>

        <section className="pg-section">
          <h2 className="pg-section-title">Rules</h2>
          <div className="pg-editor-wrap">
            <CodeMirrorEditor handle={handle} path={['rulesText']} />
          </div>
          {rulesErrors.length > 0 && (
            <ul className="pg-errors">
              {rulesErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </section>
      </div>

      <div className="pg-derived">
        <h2 className="pg-section-title">Derived Facts</h2>
        <div className="pg-derived-scroll">
          {grouped.size === 0 ? (
            <p className="pg-empty">No facts derived.</p>
          ) : (
            Array.from(grouped.entries()).map(([pred, facts]) => (
              <div key={pred} className="pg-pred-group">
                <div className="pg-pred-name">{pred}</div>
                {facts.map((f) => {
                  const key = factKey(f);
                  return (
                    <div
                      key={key}
                      className={`pg-fact ${baseFacts.has(key) ? 'pg-fact-base' : 'pg-fact-derived'}`}
                    >
                      {key}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CodeMirrorEditor({ handle, path }: { handle: DocHandle<DatalogDoc>; path: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const currentDoc = handle.doc();
    const initialText = path.reduce((obj: any, key) => obj?.[key], currentDoc) ?? '';

    const view = new EditorView({
      doc: initialText,
      extensions: [
        basicSetup,
        automergeSyncPlugin({ handle, path }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: "ui-monospace, 'Cascadia Code', Menlo, monospace",
          },
          '.cm-content': { padding: '6px 0' },
        }),
      ],
      parent: containerRef.current,
    });

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  return <div ref={containerRef} className="pg-cm-container" />;
}
