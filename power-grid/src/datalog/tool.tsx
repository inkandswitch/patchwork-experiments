import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { automergeSyncPlugin } from '@automerge/automerge-codemirror';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import type { DatalogDoc } from './datatype';
import {
  type StoredFact,
  type StoredConstraint,
  type WitnessTrace,
  parseProgram,
  factKey,
  ruleKey,
  evaluateWithProvenance,
  checkConstraints,
  serializeFacts,
  serializeRules,
  serializeConstraints,
} from './datalog';
import { useEffect, useMemo, useRef, useState } from 'react';
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

function formatAtom(atom: { pred: string; args: string[] }): string {
  if (atom.args.length === 0) return atom.pred;
  return `${atom.pred}(${atom.args.join(', ')})`;
}

function programText(doc: DatalogDoc): string {
  const facts = serializeFacts(doc.facts ?? []);
  const rules = serializeRules(doc.rules ?? []);
  const constraints = serializeConstraints(doc.constraints ?? []);
  const parts = [facts, rules, constraints].filter(Boolean);
  return parts.join('\n\n');
}

function DatalogViewer({
  docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: DocHandle<DatalogDoc>;
}) {
  const [doc] = useDocument<DatalogDoc>(docUrl);
  const [isEditing, setIsEditing] = useState(false);

  const savedText = doc ? programText(doc) : '';
  const draftText = doc?.draftText ?? savedText;
  const isDirty = isEditing && draftText !== savedText;

  const sourceText = isEditing ? draftText : savedText;
  const { facts: sourceFacts, rules: sourceRules, constraints: sourceConstraints } = useMemo(
    () => parseProgram(sourceText),
    [sourceText],
  );

  const { derivedFacts, baseFacts, violations } = useMemo(() => {
    const facts = isEditing ? sourceFacts : (doc?.facts ?? []);
    const rules = isEditing ? sourceRules : (doc?.rules ?? []);
    const constraints: StoredConstraint[] = isEditing ? sourceConstraints : (doc?.constraints ?? []);
    const baseFactKeys = new Set(facts.map(factKey));
    let db: StoredFact[] = facts;
    let provenance = new Map();
    try {
      ({ db, provenance } = evaluateWithProvenance(facts, rules));
    } catch {
      db = facts;
    }
    return {
      derivedFacts: db,
      baseFacts: baseFactKeys,
      violations: checkConstraints(db, constraints, provenance, baseFactKeys),
    };
  }, [doc, isEditing, sourceFacts, sourceRules, sourceConstraints]);

  const grouped = useMemo(() => {
    const map = new Map<string, StoredFact[]>();
    for (const f of derivedFacts) {
      if (!map.has(f.pred)) map.set(f.pred, []);
      map.get(f.pred)!.push(f);
    }
    return map;
  }, [derivedFacts]);

  const parseErrors = useMemo(() => {
    if (!isEditing) return [];
    return parseProgram(draftText).errors.map((e) => `Line ${e.line}: ${e.message}`);
  }, [isEditing, draftText]);

  function handleEdit() {
    const current = handle.doc();
    if (!current) return;
    handle.change((d) => {
      d.draftText = programText(current);
    });
    setIsEditing(true);
  }

  function handleSave() {
    const current = handle.doc();
    if (!current) return;
    const { facts, rules, constraints } = parseProgram(current.draftText ?? '');
    handle.change((d) => {
      d.facts = facts;
      d.rules = rules;
      d.constraints = constraints;
    });
    setIsEditing(false);
  }

  function handleCancel() {
    const current = handle.doc();
    if (!current) return;
    handle.change((d) => {
      d.draftText = programText(current);
    });
    setIsEditing(false);
  }

  if (!doc) {
    return <div className="pg-loading">Loading…</div>;
  }

  return (
    <div className="pg-root">
      <div className="pg-editor-col">
        <div className="pg-toolbar">
          {isEditing ? (
            <>
              {isDirty && <span className="pg-dirty-badge">● Unsaved</span>}
              <button className="pg-btn pg-btn-primary" onClick={handleSave}>
                Save
              </button>
              <button className="pg-btn" onClick={handleCancel}>
                Cancel
              </button>
            </>
          ) : (
            <button className="pg-btn" onClick={handleEdit}>
              Edit
            </button>
          )}
        </div>

        <div className="pg-editor-wrap">
          {isEditing ? (
            <ProgramEditor handle={handle} onSave={handleSave} />
          ) : (
            <pre className="pg-program-view">{savedText}</pre>
          )}
        </div>

        {parseErrors.length > 0 && (
          <ul className="pg-errors">
            {parseErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="pg-derived">
        {violations.length > 0 && (
          <div className="pg-violations">
            <h2 className="pg-section-title pg-violations-title">Constraint Violations</h2>
            {violations.map((v, i) => (
              <div key={i} className="pg-violation">
                <div className="pg-violation-constraint">
                  {':- ' + v.constraint.body.map(formatAtom).join(', ') + '.'}
                </div>
                {v.witnesses.map((w, j) => (
                  <WitnessTraceView key={j} witness={w} baseFacts={baseFacts} />
                ))}
              </div>
            ))}
          </div>
        )}

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

function WitnessTraceView({
  witness,
  baseFacts,
}: {
  witness: WitnessTrace;
  baseFacts: Set<string>;
}) {
  const bindingSummary = Object.entries(witness.bindings)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  return (
    <div className="pg-witness">
      {bindingSummary && (
        <div className="pg-witness-bindings">{bindingSummary}</div>
      )}
      <div className="pg-witness-steps">
        {witness.steps.map((step, i) => {
          if (step.kind === 'builtin') {
            return (
              <div key={i} className="pg-trace-step pg-trace-step-builtin">
                {step.atom.pred}({step.resolvedArgs.join(', ')})
                <span className="pg-trace-tag"> [builtin]</span>
              </div>
            );
          }
          const key = factKey(step.fact);
          return (
            <div key={i} className="pg-trace-step">
              <div className={step.isBase ? 'pg-trace-fact-base' : 'pg-trace-fact-derived'}>
                {key}
                <span className="pg-trace-tag"> [{step.isBase ? 'base' : 'derived'}]</span>
              </div>
              {!step.isBase && step.derivedBy && (
                <div className="pg-trace-derivation">
                  <div className="pg-trace-rule">via {ruleKey(step.derivedBy.rule)}</div>
                  {step.derivedBy.groundBody.map((pf, j) => {
                    const pfKey = factKey(pf);
                    const pfIsBase = baseFacts.has(pfKey);
                    return (
                      <div
                        key={j}
                        className={pfIsBase ? 'pg-trace-premise-base' : 'pg-trace-premise-derived'}
                      >
                        {pfKey}
                        <span className="pg-trace-tag"> [{pfIsBase ? 'base' : 'derived'}]</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgramEditor({
  handle,
  onSave,
}: {
  handle: DocHandle<DatalogDoc>;
  onSave: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const currentDoc = handle.doc();
    const initialText = currentDoc?.draftText ?? '';

    const view = new EditorView({
      doc: initialText,
      extensions: [
        basicSetup,
        automergeSyncPlugin({ handle, path: ['draftText'] }),
        keymap.of([
          {
            key: 'Mod-s',
            run() {
              onSave();
              return true;
            },
          },
        ]),
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
