import * as Automerge from '@automerge/automerge';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { annotations } from '@inkandswitch/annotations-context';
import { Diff } from '@inkandswitch/annotations-diff';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { ref, type Ref } from '@inkandswitch/patchwork-refs';
import { useSubscribe } from '@inkandswitch/subscribables-react';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { addHighlightStyle } from './codemirror-highlights';
import type { DatalogDoc } from './datatype';
import {
  type StoredAttribution,
  type StoredConstraint,
  type StoredFact,
  type StoredRule,
  type StoredTextRangeRef,
  constraintKey,
  evaluateWithProvenance,
  factKey,
  parseProgram,
  ruleKey,
  serializeConstraint,
  serializeConstraints,
  serializeFact,
  serializeFacts,
  serializeRule,
  serializeRules,
} from './datalog';
import './index.css';

type ViewTab = 'source' | 'derived';
type AttributionStatementKind = 'fact' | 'rule' | 'constraint';
type SourceStatement = {
  id: string;
  kind: AttributionStatementKind;
  summary: string;
  comment?: string;
  attribution?: StoredAttribution;
};
type ReferencedDocument = {
  docUrl: AutomergeUrl;
  refs: StoredTextRangeRef[];
  paths: string[];
  handle?: DocHandle<unknown>;
  error?: string;
};

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
  const [activeTab, setActiveTab] = useState<ViewTab>('source');
  const [isAttributionPanelOpen, setIsAttributionPanelOpen] = useState(false);
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);

  const hasDraft = doc?.draftText != null;
  const currentText = hasDraft ? doc!.draftText! : (doc ? programText(doc) : '');

  const { facts: parsedFacts, rules: parsedRules } = useMemo(
    () => (hasDraft ? parseProgram(doc!.draftText!) : { facts: [], rules: [] }),
    [hasDraft, doc],
  );

  const { derivedFacts, baseFacts } = useMemo(() => {
    const facts = hasDraft ? parsedFacts : (doc?.facts ?? []);
    const rules = hasDraft ? parsedRules : (doc?.rules ?? []);
    const baseFactKeys = new Set(facts.map(factKey));
    let db: StoredFact[] = facts;
    try {
      ({ db } = evaluateWithProvenance(facts, rules));
    } catch {
      db = facts;
    }
    return {
      derivedFacts: db,
      baseFacts: baseFactKeys,
    };
  }, [doc, hasDraft, parsedFacts, parsedRules]);

  const derivedOnlyFacts = useMemo(
    () => derivedFacts.filter((fact) => !baseFacts.has(factKey(fact))),
    [derivedFacts, baseFacts],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, StoredFact[]>();
    for (const fact of derivedFacts) {
      if (!map.has(fact.pred)) map.set(fact.pred, []);
      map.get(fact.pred)!.push(fact);
    }
    return map;
  }, [derivedFacts]);

  const factKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < (doc?.facts ?? []).length; i++) {
      map.set(factKey((doc?.facts ?? [])[i]), i);
    }
    return map;
  }, [doc]);

  const derivedKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < (doc?.derivedFacts ?? []).length; i++) {
      map.set(factKey((doc?.derivedFacts ?? [])[i]), i);
    }
    return map;
  }, [doc]);

  const hasParseErrors = useMemo(() => {
    if (!hasDraft) return false;
    return parseProgram(doc!.draftText!).errors.length > 0;
  }, [hasDraft, doc]);

  const sourceStatements = useMemo(() => {
    if (!doc) return [];
    return listSourceStatements(doc);
  }, [doc]);

  const selectedStatement = useMemo(
    () => sourceStatements.find((statement) => statement.id === selectedStatementId) ?? null,
    [selectedStatementId, sourceStatements],
  );

  useEffect(() => {
    if (hasDraft) return;
    const newKeySet = new Set(derivedOnlyFacts.map(factKey));
    const stored = handle.doc()?.derivedFacts ?? [];
    const existingKeySet = new Set(stored.map(factKey));

    const same = newKeySet.size === existingKeySet.size && [...newKeySet].every((key) => existingKeySet.has(key));
    if (same) return;

    handle.change((nextDoc) => {
      if (!nextDoc.derivedFacts) nextDoc.derivedFacts = [];
      for (let i = nextDoc.derivedFacts.length - 1; i >= 0; i--) {
        if (!newKeySet.has(factKey(nextDoc.derivedFacts[i]))) {
          nextDoc.derivedFacts.splice(i, 1);
        }
      }
      const remaining = new Set(nextDoc.derivedFacts.map(factKey));
      for (const fact of derivedOnlyFacts) {
        if (!remaining.has(factKey(fact))) {
          nextDoc.derivedFacts.push({ pred: fact.pred, args: [...fact.args] });
        }
      }
    });
  }, [derivedOnlyFacts, hasDraft, handle]);

  useEffect(() => {
    if (!selectedStatementId) return;
    if (sourceStatements.some((statement) => statement.id === selectedStatementId)) return;
    setSelectedStatementId(null);
  }, [selectedStatementId, sourceStatements]);

  useEffect(() => {
    if (!hasDraft) return;
    setIsAttributionPanelOpen(false);
  }, [hasDraft]);

  function handleTextChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = event.target.value;
    const current = handle.doc();
    if (!current) return;

    handle.change((nextDoc) => {
      if (nextDoc.draftText == null) {
        nextDoc.draftText = programText(current);
      }
      Automerge.updateText(nextDoc, ['draftText'], newValue);
    });
  }

  function handleStartEditing() {
    const current = handle.doc();
    if (!current || current.draftText != null) return;
    handle.change((nextDoc) => {
      nextDoc.draftText = programText(current);
    });
  }

  function handleSave() {
    const current = handle.doc();
    if (!current || current.draftText == null) return;
    const { facts, rules, constraints, errors } = parseProgram(current.draftText);
    if (errors.length > 0) return;

    const nextFacts = preserveFactAttribution(facts, current.facts ?? []);
    const nextRules = preserveRuleAttribution(rules, current.rules ?? []);
    const nextConstraints = preserveConstraintMetadata(constraints, current.constraints ?? []);

    handle.change((nextDoc) => {
      nextDoc.facts = nextFacts;
      nextDoc.rules = nextRules;
      nextDoc.constraints = nextConstraints;
      delete nextDoc.draftText;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      handleSave();
    }
  }

  function handleSelectStatement(statementId: string) {
    setSelectedStatementId(statementId);
    setIsAttributionPanelOpen(true);
  }

  if (!doc) {
    return <div className="pg-loading">Loading…</div>;
  }

  return (
    <div className="pg-root">
      <div className="pg-tabs">
        <div className="pg-tab-list">
          <button
            className={`pg-tab ${activeTab === 'source' ? 'pg-tab-active' : ''}`}
            onClick={() => setActiveTab('source')}
            type="button"
          >
            Source
          </button>
          <button
            className={`pg-tab ${activeTab === 'derived' ? 'pg-tab-active' : ''}`}
            onClick={() => setActiveTab('derived')}
            type="button"
          >
            Derived Facts
          </button>
        </div>

        <div className="pg-tab-actions">
          {activeTab === 'source' && !hasDraft && (
            <button className="pg-action-btn" onClick={handleStartEditing} type="button">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="pg-main">
        <div className="pg-main-content">
          {activeTab === 'source' &&
            (hasDraft ? (
              <div className="pg-editor-col">
                <div className="pg-editor-wrapper">
                  <textarea
                    className="pg-textarea"
                    value={currentText}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    spellCheck={false}
                  />
                  <button
                    className={`pg-save-btn ${hasParseErrors ? 'pg-save-btn-disabled' : ''}`}
                    disabled={hasParseErrors}
                    onClick={handleSave}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <SourceReadPane
                selectedStatementId={selectedStatementId}
                statements={sourceStatements}
                onSelectStatement={handleSelectStatement}
              />
            ))}

          {activeTab === 'derived' && (
            <div className="pg-derived">
              <h2 className="pg-section-title">Derived Facts</h2>
              <div className="pg-derived-scroll">
                {grouped.size === 0 ? (
                  <p className="pg-empty">No facts derived.</p>
                ) : (
                  Array.from(grouped.entries()).map(([pred, facts]) => (
                    <div key={pred} className="pg-pred-group">
                      <div className="pg-pred-name">{pred}</div>
                      {facts.map((fact) => {
                        const key = factKey(fact);
                        const isBase = baseFacts.has(key);
                        return (
                          <DerivedFactRow
                            key={key}
                            baseIndex={factKeyToIndex.get(key) ?? -1}
                            derivedIndex={derivedKeyToIndex.get(key) ?? -1}
                            fact={key}
                            handle={handle}
                            isBase={isBase}
                          />
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'source' && !hasDraft && isAttributionPanelOpen && (
          <AttributionDocumentPanel
            selectedStatement={selectedStatement}
            onClose={() => setIsAttributionPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function SourceReadPane({
  selectedStatementId,
  statements,
  onSelectStatement,
}: {
  selectedStatementId: string | null;
  statements: SourceStatement[];
  onSelectStatement: (statementId: string) => void;
}) {
  const facts = statements.filter((statement) => statement.kind === 'fact');
  const rules = statements.filter((statement) => statement.kind === 'rule');
  const constraints = statements.filter((statement) => statement.kind === 'constraint');

  return (
    <div className="pg-source-read">
      <div className="pg-source-read-scroll">
        {statements.length === 0 ? (
          <p className="pg-empty">No saved Datalog statements.</p>
        ) : (
          <>
            <SourceStatementSection
              selectedStatementId={selectedStatementId}
              statements={facts}
              title="Facts"
              onSelectStatement={onSelectStatement}
            />
            <SourceStatementSection
              selectedStatementId={selectedStatementId}
              statements={rules}
              title="Rules"
              onSelectStatement={onSelectStatement}
            />
            <SourceStatementSection
              selectedStatementId={selectedStatementId}
              statements={constraints}
              title="Constraints"
              onSelectStatement={onSelectStatement}
            />
          </>
        )}
      </div>
    </div>
  );
}

function SourceStatementSection({
  selectedStatementId,
  statements,
  title,
  onSelectStatement,
}: {
  selectedStatementId: string | null;
  statements: SourceStatement[];
  title: string;
  onSelectStatement: (statementId: string) => void;
}) {
  if (statements.length === 0) return null;

  return (
    <section className="pg-source-section">
      <div className="pg-source-section-header">
        <h2 className="pg-section-title">{title}</h2>
      </div>

      <div className="pg-source-list">
        {statements.map((statement) => {
          const isSelected = selectedStatementId === statement.id;
          return (
            <button
              key={statement.id}
              className={`pg-source-statement ${isSelected ? 'pg-source-statement-selected' : ''}`}
              onClick={() => onSelectStatement(statement.id)}
              type="button"
            >
              {statement.comment && <div className="pg-source-comment">// {statement.comment}</div>}
              <pre className="pg-source-summary">{statement.summary}</pre>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AttributionDocumentPanel({
  selectedStatement,
  onClose,
}: {
  selectedStatement: SourceStatement | null;
  onClose: () => void;
}) {
  const repo = useRepo();
  const [documents, setDocuments] = useState<ReferencedDocument[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferencedDocuments() {
      const refs = selectedStatement?.attribution?.refs ?? [];
      if (refs.length === 0) {
        setDocuments([]);
        return;
      }

      const groupedDocuments = groupStatementRefsByDocument(refs);
      const nextDocuments = await Promise.all(
        groupedDocuments.map(async (document) => {
          try {
            const handle = await repo.find(document.docUrl);
            await handle.whenReady();
            return { ...document, handle };
          } catch (error) {
            return {
              ...document,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      );

      if (!cancelled) {
        setDocuments(nextDocuments);
      }
    }

    void loadReferencedDocuments();

    return () => {
      cancelled = true;
    };
  }, [repo, selectedStatement]);

  useEffect(() => {
    const cleanupFns: Array<() => void> = [];

    for (const document of documents) {
      if (!document.handle) continue;
      for (const rangeRef of document.refs) {
        cleanupFns.push(addHighlightStyle(document.handle, rangeRef.path, rangeRef.from, rangeRef.to));
      }
    }

    return () => {
      for (const cleanup of cleanupFns) {
        cleanup();
      }
    };
  }, [documents]);

  const selectedRefCount = selectedStatement?.attribution?.refs.length ?? 0;

  return (
    <aside className="pg-attribution-panel">
      <div className="pg-attribution-panel-header">
        <button
          aria-label="Close sources panel"
          className="pg-attribution-close"
          onClick={onClose}
          title="Close"
          type="button"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="pg-attribution-scroll">
        {!selectedStatement ? (
          <p className="pg-empty">Select a statement.</p>
        ) : (
          <>
            {selectedRefCount === 0 ? (
              <p className="pg-empty">This statement does not have saved attribution yet.</p>
            ) : documents.length === 0 ? (
              <p className="pg-empty">Loading referenced documents…</p>
            ) : (
              documents.map((document) => <SourceDocumentCard key={document.docUrl} document={document} />)
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SourceDocumentCard({ document }: { document: ReferencedDocument }) {
  return (
    <section className="pg-attribution-doc-card">
      {document.error ? (
        <div className="pg-attribution-preview-error">{document.error}</div>
      ) : (
        <patchwork-view className="pg-attribution-doc-view" doc-url={document.docUrl} />
      )}
    </section>
  );
}

function DerivedFactRow({
  baseIndex,
  derivedIndex,
  fact,
  handle,
  isBase,
}: {
  baseIndex: number;
  derivedIndex: number;
  fact: string;
  handle: DocHandle<DatalogDoc>;
  isBase: boolean;
}) {
  const baseDiff = useDiffType(handle, 'facts', baseIndex);
  const derivedDiff = useDiffType(handle, 'derivedFacts', derivedIndex);
  const diffType = isBase ? baseDiff : derivedDiff;
  const diffClass = diffType ? `pg-diff-${diffType}` : '';
  const kindClass = isBase ? 'pg-fact-base' : 'pg-fact-derived';
  return <div className={`pg-fact ${kindClass} ${diffClass}`}>{fact}</div>;
}

function useDiffType(
  handle: DocHandle<DatalogDoc>,
  collection: string,
  index: number,
): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemRef = useMemo(() => ref(handle as any, collection, index), [collection, handle, index]);
  const subscribable = useMemo(() => annotations.onRef(itemRef as Ref), [itemRef]);
  const itemAnnotations = useSubscribe(subscribable);
  return itemAnnotations?.lookup(Diff)?.type;
}

function programText(doc: DatalogDoc): string {
  const facts = serializeFacts(doc.facts ?? []);
  const rules = serializeRules(doc.rules ?? []);
  const constraints = serializeConstraints(doc.constraints ?? []);
  const parts = [facts, rules, constraints].filter(Boolean);
  return parts.join('\n\n');
}

function preserveFactAttribution(nextFacts: StoredFact[], prevFacts: StoredFact[]): StoredFact[] {
  const prevByKey = new Map(prevFacts.map((fact) => [factKey(fact), fact]));
  return nextFacts.map((fact) => {
    const previous = prevByKey.get(factKey(fact));
    const attribution = cloneAttribution(previous?.attribution);
    return attribution ? { ...fact, attribution } : fact;
  });
}

function preserveRuleAttribution(nextRules: StoredRule[], prevRules: StoredRule[]): StoredRule[] {
  const prevByKey = new Map(prevRules.map((rule) => [ruleKey(rule), rule]));
  return nextRules.map((rule) => {
    const previous = prevByKey.get(ruleKey(rule));
    const attribution = cloneAttribution(previous?.attribution);
    return attribution ? { ...rule, attribution } : rule;
  });
}

function preserveConstraintMetadata(
  nextConstraints: StoredConstraint[],
  prevConstraints: StoredConstraint[],
): StoredConstraint[] {
  const prevByKey = new Map(prevConstraints.map((constraint) => [constraintKey(constraint), constraint]));
  return nextConstraints.map((constraint) => {
    const previous = prevByKey.get(constraintKey(constraint));
    if (!previous) return constraint;

    const nextConstraint: StoredConstraint = { ...constraint };
    if (previous.name !== undefined) nextConstraint.name = previous.name;

    const attribution = cloneAttribution(previous.attribution);
    if (attribution) nextConstraint.attribution = attribution;

    return nextConstraint;
  });
}

function cloneAttribution(attribution?: StoredAttribution): StoredAttribution | undefined {
  if (!attribution) return undefined;
  return {
    refs: attribution.refs.map((ref) => ({
      docUrl: ref.docUrl,
      path: [...ref.path],
      from: ref.from,
      to: ref.to,
    })),
  };
}

function listSourceStatements(doc: DatalogDoc): SourceStatement[] {
  const statements: SourceStatement[] = [];

  for (const fact of doc.facts ?? []) {
    statements.push({
      id: `fact:${factKey(fact)}`,
      kind: 'fact',
      summary: serializeFact({ pred: fact.pred, args: fact.args }),
      comment: fact.comment,
      attribution: fact.attribution,
    });
  }

  for (const rule of doc.rules ?? []) {
    statements.push({
      id: `rule:${ruleKey(rule)}`,
      kind: 'rule',
      summary: serializeRule({ head: rule.head, body: rule.body }),
      comment: rule.comment,
      attribution: rule.attribution,
    });
  }

  for (const constraint of doc.constraints ?? []) {
    statements.push({
      id: `constraint:${constraint.name ?? constraintKey(constraint)}`,
      kind: 'constraint',
      summary: serializeConstraint({ body: constraint.body }),
      comment: constraint.comment,
      attribution: constraint.attribution,
    });
  }

  return statements;
}

function hasStatementAttribution(statement: SourceStatement): boolean {
  return (statement.attribution?.refs.length ?? 0) > 0;
}

function groupStatementRefsByDocument(refs: StoredTextRangeRef[]): ReferencedDocument[] {
  const documents = new Map<AutomergeUrl, ReferencedDocument>();

  for (const rangeRef of refs) {
    const existing = documents.get(rangeRef.docUrl);
    const path = formatPath(rangeRef.path);
    if (existing) {
      existing.refs.push(rangeRef);
      if (!existing.paths.includes(path)) {
        existing.paths.push(path);
      }
      continue;
    }

    documents.set(rangeRef.docUrl, {
      docUrl: rangeRef.docUrl,
      refs: [rangeRef],
      paths: [path],
    });
  }

  return [...documents.values()];
}

function formatPath(path: Array<string | number>): string {
  return path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment)).join('.');
}
