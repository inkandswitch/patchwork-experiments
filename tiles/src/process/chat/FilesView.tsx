import { useCallback, useEffect, useState } from 'react';
import { useRepo } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { CowChange, CowChanges } from '../llm/types';

// --- Content reading helper ---

async function readContent(repo: any, url: AutomergeUrl): Promise<string> {
  try {
    const handle = await repo.find(url);
    const doc = handle.doc() as any;
    if (!doc) return '';
    if (typeof doc.content === 'string') return doc.content;
    if (doc.content instanceof Uint8Array) return new TextDecoder().decode(doc.content);
    if (doc.content !== undefined) return String(doc.content);
    return JSON.stringify(doc, null, 2);
  } catch {
    return '';
  }
}

// --- Main component ---

export function FilesView({
  changes,
  cowChanges,
  onMerged,
}: {
  changes: CowChange[];
  cowChanges: CowChanges | null;
  onMerged?: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);

  const selected = selectedIdx !== null ? changes[selectedIdx] : null;

  const handleMergeAll = useCallback(async () => {
    if (!cowChanges || merging) return;
    setMerging(true);
    try {
      await cowChanges.mergeAll();
      onMerged?.();
      setSelectedIdx(null);
    } finally {
      setMerging(false);
    }
  }, [cowChanges, merging, onMerged]);

  const handleMergeSingle = useCallback(async (originalUrl: AutomergeUrl) => {
    if (!cowChanges) return;
    await cowChanges.mergeSingle(originalUrl);
    onMerged?.();
    setSelectedIdx(null);
  }, [cowChanges, onMerged]);

  const handleRevertSingle = useCallback((originalUrl: AutomergeUrl) => {
    if (!cowChanges) return;
    cowChanges.revertSingle(originalUrl);
    onMerged?.();
    setSelectedIdx(null);
  }, [cowChanges, onMerged]);

  if (changes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 13 }}>
        No changes
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Left panel: file list */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid #e0e0e0',
            overflowY: 'auto',
            fontSize: 12,
            padding: '4px 0',
          }}
        >
          {changes.map((change, i) => {
            const isSelected = i === selectedIdx;
            const label = change.path ? `${change.name}/${change.path}` : change.name;
            return (
              <div
                key={change.originalUrl + (change.path ?? '')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(26, 115, 232, 0.08)' : 'transparent',
                  color: isSelected ? '#1a73e8' : '#555',
                }}
                onClick={() => setSelectedIdx(i)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChangeIndicator type={change.changeType} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Right panel: before/after */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {selected ? (
            <BeforeAfterPanel
              change={selected}
              onMerge={handleMergeSingle}
              onRevert={handleRevertSingle}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 13 }}>
              Select a file to preview
            </div>
          )}
        </div>
      </div>

      {/* Footer: merge all */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#fafafa',
        }}
      >
        <span style={{ fontSize: 11, color: '#888' }}>
          {changes.length} file{changes.length !== 1 ? 's' : ''} changed
        </span>
        <button
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '4px 14px',
            borderRadius: 6,
            border: 'none',
            background: '#e8f0fe',
            color: '#1a73e8',
            cursor: merging ? 'wait' : 'pointer',
            opacity: merging ? 0.6 : 1,
          }}
          onClick={handleMergeAll}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={merging}
        >
          {merging ? 'Merging...' : 'Merge All'}
        </button>
      </div>
    </div>
  );
}

// --- Before/After panel ---

function BeforeAfterPanel({
  change,
  onMerge,
  onRevert,
}: {
  change: CowChange;
  onMerge: (originalUrl: AutomergeUrl) => void;
  onRevert: (originalUrl: AutomergeUrl) => void;
}) {
  const repo = useRepo();
  const [beforeContent, setBeforeContent] = useState<string | null>(null);
  const [afterContent, setAfterContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (change.changeType === 'added') {
      setBeforeContent(null);
      readContent(repo, change.cloneUrl).then((c) => {
        if (!cancelled) setAfterContent(c);
      });
    } else {
      Promise.all([
        readContent(repo, change.originalUrl),
        readContent(repo, change.cloneUrl),
      ]).then(([before, after]) => {
        if (cancelled) return;
        setBeforeContent(before);
        setAfterContent(after);
      });
    }

    return () => { cancelled = true; };
  }, [repo, change.originalUrl, change.cloneUrl, change.changeType]);

  const label = change.path ? `${change.name}/${change.path}` : change.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid #eee',
          background: '#fafafa',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ChangeIndicator type={change.changeType} />
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#555' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {change.changeType === 'modified' && (
            <button
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid #ddd',
                background: '#fff',
                color: '#555',
                cursor: 'pointer',
              }}
              onClick={() => onRevert(change.originalUrl)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Revert
            </button>
          )}
          <button
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 4,
              border: 'none',
              background: '#e8f0fe',
              color: '#1a73e8',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => onMerge(change.originalUrl)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            Merge
          </button>
        </div>
      </div>

      {/* Content panels */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {change.changeType === 'added' ? (
          <ContentPanel label="New" content={afterContent} />
        ) : (
          <>
            <ContentPanel label="Before" content={beforeContent} borderRight />
            <ContentPanel label="After" content={afterContent} />
          </>
        )}
      </div>
    </div>
  );
}

function ContentPanel({
  label,
  content,
  borderRight,
}: {
  label: string;
  content: string | null;
  borderRight?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        ...(borderRight ? { borderRight: '1px solid #eee' } : {}),
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          fontSize: 10,
          color: '#999',
          fontWeight: 600,
          textTransform: 'uppercase',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {content === null ? (
          <div style={{ padding: 16, color: '#ccc', fontSize: 11 }}>Loading...</div>
        ) : (
          <pre
            style={{
              margin: 0,
              padding: 8,
              fontSize: 11,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: '#444',
              lineHeight: '18px',
            }}
          >
            {content || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}

// --- Change indicator badge ---

function ChangeIndicator({ type }: { type: 'modified' | 'added' }) {
  const label = type === 'modified' ? 'M' : 'A';
  const color = type === 'modified' ? '#f59e0b' : '#22c55e';
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '0 3px',
        borderRadius: 3,
        background: `${color}20`,
        color,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
