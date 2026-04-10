import * as Automerge from '@automerge/automerge';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { annotations } from '@inkandswitch/annotations-context';
import { Diff } from '@inkandswitch/annotations-diff';
import { ref, Ref } from '@inkandswitch/patchwork-refs';
import { useSubscribe } from '@inkandswitch/subscribables-react';
import type { DatalogDoc } from './datatype';
import {
  type StoredAttribution,
  type StoredConstraint,
  type StoredFact,
  type StoredRule,
  constraintKey,
  parseProgram,
  factKey,
  evaluateWithProvenance,
  ruleKey,
  serializeConstraint,
  serializeFact,
  serializeRule,
  serializeFacts,
  serializeRules,
  serializeConstraints,
} from './datalog';
import { useEffect, useMemo, useState } from 'react';
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

type ViewTab = 'source' | 'derived';
type AttributionStatementKind = 'fact' | 'rule' | 'constraint';
type AttributionEntry = {
  id: string;
  kind: AttributionStatementKind;
  summary: string;
  comment?: string;
  attribution: StoredAttribution;
};

type AttributionPreview = {
  from: number;
  to: number;
  excerpt: string;
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
    () => derivedFacts.filter((f) => !baseFacts.has(factKey(f))),
    [derivedFacts, baseFacts],
  );

  useEffect(() => {
    if (hasDraft) return;
    const newKeySet = new Set(derivedOnlyFacts.map(factKey));
    const stored = handle.doc()?.derivedFacts ?? [];
    const existingKeySet = new Set(stored.map(factKey));

    const same = newKeySet.size === existingKeySet.size && [...newKeySet].every((k) => existingKeySet.has(k));
    if (same) return;

    handle.change((d) => {
      if (!d.derivedFacts) d.derivedFacts = [];
      for (let i = d.derivedFacts.length - 1; i >= 0; i--) {
        if (!newKeySet.has(factKey(d.derivedFacts[i]))) {
          d.derivedFacts.splice(i, 1);
        }
      }
      const remaining = new Set(d.derivedFacts.map(factKey));
      for (const f of derivedOnlyFacts) {
        if (!remaining.has(factKey(f))) {
          d.derivedFacts.push({ pred: f.pred, args: [...f.args] });
        }
      }
    });
  }, [derivedOnlyFacts, hasDraft, handle]);

  const grouped = useMemo(() => {
    const map = new Map<string, StoredFact[]>();
    for (const f of derivedFacts) {
      if (!map.has(f.pred)) map.set(f.pred, []);
      map.get(f.pred)!.push(f);
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

  const attributionEntries = useMemo(() => {
    if (!doc) return [];
    return listAttributionEntries(doc);
  }, [doc]);

  const attributionRefCount = useMemo(
    () => attributionEntries.reduce((total, entry) => total + entry.attribution.refs.length, 0),
    [attributionEntries],
  );

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    const current = handle.doc();
    if (!current) return;

    handle.change((d) => {
      if (d.draftText == null) {
        d.draftText = programText(current);
      }
      Automerge.updateText(d, ['draftText'], newValue);
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
    handle.change((d) => {
      d.facts = nextFacts;
      d.rules = nextRules;
      d.constraints = nextConstraints;
      delete d.draftText;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
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
          >
            Source
          </button>
          <button
            className={`pg-tab ${activeTab === 'derived' ? 'pg-tab-active' : ''}`}
            onClick={() => setActiveTab('derived')}
          >
            Derived Facts
          </button>
        </div>
        <button
          className={`pg-debug-toggle ${isAttributionPanelOpen ? 'pg-debug-toggle-active' : ''}`}
          onClick={() => setIsAttributionPanelOpen((open) => !open)}
        >
          {isAttributionPanelOpen ? 'Hide Attribution' : 'Show Attribution'}
        </button>
      </div>

      <div className="pg-main">
        <div className="pg-main-content">
          {activeTab === 'source' && (
            <div className="pg-editor-col">
              <div className="pg-editor-wrapper">
                <textarea
                  className="pg-textarea"
                  value={currentText}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  spellCheck={false}
                />
                {hasDraft && (
                  <button
                    className={`pg-save-btn ${hasParseErrors ? 'pg-save-btn-disabled' : ''}`}
                    disabled={hasParseErrors}
                    onClick={handleSave}
                  >
                    Save
                  </button>
                )}
              </div>
            </div>
          )}

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
                      {facts.map((f) => {
                        const key = factKey(f);
                        const isBase = baseFacts.has(key);
                        return (
                          <DerivedFactRow
                            key={key}
                            handle={handle}
                            fact={key}
                            isBase={isBase}
                            baseIndex={factKeyToIndex.get(key) ?? -1}
                            derivedIndex={derivedKeyToIndex.get(key) ?? -1}
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

        {isAttributionPanelOpen && (
          <AttributionDebugPanel
            entries={attributionEntries}
            hasDraft={hasDraft}
            totalRefs={attributionRefCount}
            onClose={() => setIsAttributionPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

function AttributionDebugPanel({
  entries,
  hasDraft,
  totalRefs,
  onClose,
}: {
  entries: AttributionEntry[];
  hasDraft: boolean;
  totalRefs: number;
  onClose: () => void;
}) {
  const repo = useRepo();
  const [docsByUrl, setDocsByUrl] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadReferencedDocs() {
      const urls = [...new Set(entries.flatMap((entry) => entry.attribution.refs.map((rangeRef) => rangeRef.docUrl)))];
      const nextDocsByUrl: Record<string, unknown> = {};
      for (const url of urls) {
        try {
          const handle = await repo.find(url as AutomergeUrl);
          nextDocsByUrl[url] = handle.doc();
        } catch (error) {
          nextDocsByUrl[url] = error instanceof Error ? error : new Error(String(error));
        }
      }

      if (!cancelled) {
        setDocsByUrl(nextDocsByUrl);
      }
    }

    loadReferencedDocs();

    return () => {
      cancelled = true;
    };
  }, [entries, repo]);

  return (
    <aside className="pg-attribution-panel">
      <div className="pg-attribution-panel-header">
        <div>
          <div className="pg-attribution-panel-title">Attribution Debug</div>
          <div className="pg-attribution-panel-meta">
            {entries.length} attributed statements, {totalRefs} refs
          </div>
        </div>
        <button className="pg-attribution-close" onClick={onClose}>
          Close
        </button>
      </div>

      {hasDraft && (
        <div className="pg-attribution-banner">
          Showing attribution from the saved structured statements. Save the draft to refresh this panel.
        </div>
      )}

      <div className="pg-attribution-scroll">
        {entries.length === 0 ? (
          <p className="pg-empty">No statement attribution stored in this document.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="pg-attribution-entry">
              <div className="pg-attribution-entry-header">
                <span className={`pg-attribution-kind pg-attribution-kind-${entry.kind}`}>{entry.kind}</span>
                <span className="pg-attribution-ref-count">{entry.attribution.refs.length} refs</span>
              </div>
              <pre className="pg-attribution-summary">{entry.summary}</pre>
              {entry.comment && <div className="pg-attribution-comment">// {entry.comment}</div>}
              <div className="pg-attribution-ref-list">
                {entry.attribution.refs.map((rangeRef, index) => (
                  <div key={`${entry.id}-${index}`} className="pg-attribution-ref">
                    {renderAttributionPreview(docsByUrl[rangeRef.docUrl], rangeRef.path, rangeRef.from, rangeRef.to)}
                    <div className="pg-attribution-ref-row">
                      <span className="pg-attribution-label">doc</span>
                      <code>{rangeRef.docUrl}</code>
                    </div>
                    <div className="pg-attribution-ref-row">
                      <span className="pg-attribution-label">path</span>
                      <code>{formatPath(rangeRef.path)}</code>
                    </div>
                    <div className="pg-attribution-ref-row">
                      <span className="pg-attribution-label">from</span>
                      <code>{formatDebugValue(rangeRef.from)}</code>
                    </div>
                    <div className="pg-attribution-ref-row">
                      <span className="pg-attribution-label">to</span>
                      <code>{formatDebugValue(rangeRef.to)}</code>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function DerivedFactRow({
  handle,
  fact,
  isBase,
  baseIndex,
  derivedIndex,
}: {
  handle: DocHandle<DatalogDoc>;
  fact: string;
  isBase: boolean;
  baseIndex: number;
  derivedIndex: number;
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
  const itemRef = useMemo(() => ref(handle as any, collection, index), [handle, collection, index]);
  const subscribable = useMemo(() => annotations.onRef(itemRef as Ref), [itemRef]);
  const itemAnnotations = useSubscribe(subscribable);
  return itemAnnotations?.lookup(Diff)?.type;
}

function listAttributionEntries(doc: DatalogDoc): AttributionEntry[] {
  const entries: AttributionEntry[] = [];

  for (const fact of doc.facts ?? []) {
    if (!fact.attribution?.refs?.length) continue;
    entries.push({
      id: `fact:${factKey(fact)}`,
      kind: 'fact',
      summary: serializeFact({ pred: fact.pred, args: fact.args }),
      comment: fact.comment,
      attribution: fact.attribution,
    });
  }

  for (const rule of doc.rules ?? []) {
    if (!rule.attribution?.refs?.length) continue;
    entries.push({
      id: `rule:${ruleKey(rule)}`,
      kind: 'rule',
      summary: serializeRule({ head: rule.head, body: rule.body }),
      comment: rule.comment,
      attribution: rule.attribution,
    });
  }

  for (const constraint of doc.constraints ?? []) {
    if (!constraint.attribution?.refs?.length) continue;
    entries.push({
      id: `constraint:${constraint.name ?? constraintKey(constraint)}`,
      kind: 'constraint',
      summary: serializeConstraint({ body: constraint.body }),
      comment: constraint.comment,
      attribution: constraint.attribution,
    });
  }

  return entries;
}

function formatPath(path: Array<string | number>): string {
  return path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment)).join('.');
}

function formatDebugValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderAttributionPreview(
  doc: unknown,
  path: Array<string | number>,
  from: unknown,
  to: unknown,
) {
  const resolved = resolveAttributionPreview(doc, path, from, to);
  if ('error' in resolved) {
    return <div className="pg-attribution-preview-error">{resolved.error}</div>;
  }

  return (
    <div className="pg-attribution-preview">
      <div className="pg-attribution-preview-header">
        Preview <code>{resolved.from}:{resolved.to}</code>
      </div>
      <pre className="pg-attribution-preview-text">{resolved.excerpt}</pre>
    </div>
  );
}

function resolveAttributionPreview(
  doc: unknown,
  path: Array<string | number>,
  from: unknown,
  to: unknown,
): AttributionPreview | { error: string } {
  if (doc instanceof Error) {
    return { error: doc.message };
  }
  if (doc == null) {
    return { error: 'Referenced document is not loaded yet.' };
  }

  const text = resolveValueAtPath(doc, path);
  if (typeof text !== 'string' && !(text instanceof String)) {
    return { error: `Path ${formatPath(path)} does not resolve to text.` };
  }

  try {
    const start = Automerge.getCursorPosition(doc, path, from as any);
    const end = Automerge.getCursorPosition(doc, path, to as any);
    const normalizedFrom = Math.min(start, end);
    const normalizedTo = Math.max(start, end);

    return {
      from: normalizedFrom,
      to: normalizedTo,
      excerpt: buildPreviewExcerpt(String(text), normalizedFrom, normalizedTo),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveValueAtPath(root: unknown, path: Array<string | number>): unknown {
  let current: any = root;
  for (const segment of path) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function buildPreviewExcerpt(text: string, from: number, to: number): string {
  const contextChars = 40;
  const excerptStart = Math.max(0, from - contextChars);
  const excerptEnd = Math.min(text.length, to + contextChars);
  const prefix = excerptStart > 0 ? '...' : '';
  const suffix = excerptEnd < text.length ? '...' : '';
  const before = text.slice(excerptStart, from);
  const selected = text.slice(from, to);
  const after = text.slice(to, excerptEnd);
  return `${prefix}${before}[${selected}]${after}${suffix}`;
}
