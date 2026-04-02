import * as Automerge from '@automerge/automerge';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
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
  type StoredFact,
  parseProgram,
  factKey,
  evaluateWithProvenance,
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

type ViewTab = 'source' | 'derived';

function DatalogViewer({
  docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: DocHandle<DatalogDoc>;
}) {
  const [doc] = useDocument<DatalogDoc>(docUrl);
  const [activeTab, setActiveTab] = useState<ViewTab>('source');

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
    handle.change((d) => {
      d.facts = facts;
      d.rules = rules;
      d.constraints = constraints;
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
