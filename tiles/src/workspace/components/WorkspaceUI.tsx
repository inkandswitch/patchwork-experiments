import { useCallback, useState } from 'react';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { AccessLevel, WorkspaceDoc, WorkspaceEntry } from '../types';

const ACCESS_LEVELS: { level: AccessLevel; label: string; description: string }[] = [
  { level: 'read', label: 'Read', description: 'Read-only access' },
  { level: 'reviewed', label: 'Reviewed', description: 'Changes require review' },
  { level: 'full', label: 'Full Access', description: 'Direct writes to original' },
];

export function WorkspaceUI({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<WorkspaceDoc>(docUrl, { suspense: true });
  const [draggedEntry, setDraggedEntry] = useState<AutomergeUrl | null>(null);
  const [dropTarget, setDropTarget] = useState<AccessLevel | null>(null);
  const [externalDragLevel, setExternalDragLevel] = useState<AccessLevel | null>(null);

  const entries = doc?.entries ?? [];

  const entriesByLevel = (level: AccessLevel) =>
    entries.filter((e) => e.accessLevel === level);

  const handleTitleChange = useCallback(
    (e: React.FocusEvent<HTMLHeadingElement>) => {
      const newTitle = e.currentTarget.textContent?.trim() || 'Workspace';
      changeDoc((d) => {
        d.title = newTitle;
      });
    },
    [changeDoc],
  );

  const handleRestrictToggle = useCallback(() => {
    changeDoc((d) => {
      d.restrictToEntries = !d.restrictToEntries;
    });
  }, [changeDoc]);

  const handleRemoveEntry = useCallback(
    (url: AutomergeUrl) => {
      changeDoc((d) => {
        const idx = d.entries.findIndex((e) => e.url === url);
        if (idx >= 0) d.entries.splice(idx, 1);
      });
    },
    [changeDoc],
  );

  const handleMoveEntry = useCallback(
    (url: AutomergeUrl, newLevel: AccessLevel) => {
      changeDoc((d) => {
        const entry = d.entries.find((e) => e.url === url);
        if (entry) entry.accessLevel = newLevel;
      });
    },
    [changeDoc],
  );

  const handleAddEntries = useCallback(
    (items: { url: string; type: string; name: string }[], level: AccessLevel) => {
      changeDoc((d) => {
        if (!d.entries) d.entries = [] as any;
        for (const item of items) {
          const exists = d.entries.some((e) => e.url === item.url);
          if (exists) continue;

          const isTool =
            item.type && item.type !== 'raw' && item.type !== 'file' && item.type !== 'folder';

          if (isTool) {
            (d.entries as any[]).push({
              type: 'tool',
              name: item.name || item.type,
              url: item.url,
              path: 'tool.js',
              accessLevel: level,
            });
          } else {
            (d.entries as any[]).push({
              type: 'document',
              name: item.name || 'Untitled',
              url: item.url,
              accessLevel: level,
            });
          }
        }
      });
    },
    [changeDoc],
  );

  const handleInternalDragStart = useCallback(
    (e: React.DragEvent, url: AutomergeUrl) => {
      e.dataTransfer.setData('text/x-workspace-entry', url);
      e.dataTransfer.effectAllowed = 'move';
      setDraggedEntry(url);
    },
    [],
  );

  const handleInternalDragEnd = useCallback(() => {
    setDraggedEntry(null);
    setDropTarget(null);
  }, []);

  const handleBucketDragOver = useCallback(
    (e: React.DragEvent, level: AccessLevel) => {
      if (e.dataTransfer.types.includes('text/x-workspace-entry')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(level);
      } else if (e.dataTransfer.types.includes('text/x-patchwork-dnd')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setExternalDragLevel(level);
      }
    },
    [],
  );

  const handleBucketDragLeave = useCallback(
    (e: React.DragEvent, level: AccessLevel) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      if (dropTarget === level) setDropTarget(null);
      if (externalDragLevel === level) setExternalDragLevel(null);
    },
    [dropTarget, externalDragLevel],
  );

  const handleBucketDrop = useCallback(
    (e: React.DragEvent, level: AccessLevel) => {
      e.preventDefault();

      const entryUrl = e.dataTransfer.getData('text/x-workspace-entry');
      if (entryUrl) {
        handleMoveEntry(entryUrl as AutomergeUrl, level);
        setDraggedEntry(null);
        setDropTarget(null);
        return;
      }

      const dndData = e.dataTransfer.getData('text/x-patchwork-dnd');
      if (dndData) {
        const { items } = JSON.parse(dndData) as {
          source: string;
          items: { url: string; type: string; name: string }[];
        };
        if (items?.length) handleAddEntries(items, level);
        setExternalDragLevel(null);
        return;
      }
    },
    [handleMoveEntry, handleAddEntries],
  );

  // Global external drop (defaults to 'read')
  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/x-patchwork-dnd')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleGlobalDrop = useCallback(
    (e: React.DragEvent) => {
      const dndData = e.dataTransfer.getData('text/x-patchwork-dnd');
      if (!dndData) return;
      e.preventDefault();
      const { items } = JSON.parse(dndData) as {
        source: string;
        items: { url: string; type: string; name: string }[];
      };
      if (items?.length) handleAddEntries(items, 'read');
    },
    [handleAddEntries],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 12,
        gap: 8,
        overflow: 'auto',
      }}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {/* Title */}
      <h2
        contentEditable
        suppressContentEditableWarning
        onBlur={handleTitleChange}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          fontSize: 16,
          fontWeight: 600,
          margin: 0,
          padding: '4px 2px',
          outline: 'none',
          borderBottom: '1px solid transparent',
          cursor: 'text',
        }}
        onFocus={(e) => {
          (e.currentTarget.style.borderBottom = '1px solid #ddd');
        }}
        onBlurCapture={(e) => {
          (e.currentTarget.style.borderBottom = '1px solid transparent');
        }}
      >
        {doc?.title || 'Workspace'}
      </h2>

      {/* Restrict toggle */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: '#666',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={doc?.restrictToEntries ?? false}
          onChange={handleRestrictToggle}
          style={{ margin: 0 }}
        />
        Restrict to listed entries
      </label>

      {/* Buckets */}
      {ACCESS_LEVELS.map(({ level, label, description }) => {
        const levelEntries = entriesByLevel(level);
        const isDropHere = dropTarget === level || externalDragLevel === level;

        return (
          <div
            key={level}
            style={{
              border: `1px solid ${isDropHere ? '#93c5fd' : '#e5e7eb'}`,
              borderRadius: 8,
              background: isDropHere ? '#eff6ff' : '#fafafa',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onDragOver={(e) => handleBucketDragOver(e, level)}
            onDragLeave={(e) => handleBucketDragLeave(e, level)}
            onDrop={(e) => handleBucketDrop(e, level)}
          >
            {/* Bucket header */}
            <div
              style={{
                padding: '6px 10px',
                borderBottom: levelEntries.length > 0 ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: '#555' }}>{label}</span>
              <span style={{ fontSize: 10, color: '#aaa' }}>{description}</span>
            </div>

            {/* Entry rows */}
            {levelEntries.length > 0 && (
              <div style={{ padding: '2px 0' }}>
                {levelEntries.map((entry) => (
                  <EntryRow
                    key={entry.url}
                    entry={entry}
                    isDragging={draggedEntry === entry.url}
                    onDragStart={(e) => handleInternalDragStart(e, entry.url)}
                    onDragEnd={handleInternalDragEnd}
                    onRemove={() => handleRemoveEntry(entry.url)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {levelEntries.length === 0 && (
              <div
                style={{
                  padding: '8px 10px',
                  fontSize: 10,
                  color: '#ccc',
                  fontStyle: 'italic',
                }}
              >
                Drop items here
              </div>
            )}
          </div>
        );
      })}

      {/* Global drop hint */}
      {entries.length === 0 && (
        <div
          style={{
            padding: '16px',
            textAlign: 'center',
            fontSize: 11,
            color: '#bbb',
            border: '1px dashed #ddd',
            borderRadius: 8,
          }}
        >
          Drop documents or tools to add them to this workspace
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  isDragging,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  entry: WorkspaceEntry;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 11,
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        background: isDragging ? '#f0f4ff' : 'transparent',
        transition: 'opacity 0.1s',
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: entry.type === 'tool' ? '#7c3aed' : '#0369a1',
          flexShrink: 0,
        }}
      >
        {entry.type === 'tool' ? '◆' : '▪'}
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: '#333',
        }}
      >
        {entry.name}
      </span>
      <button
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontSize: 10,
          color: '#ccc',
          padding: '0 2px',
          lineHeight: 1,
          flexShrink: 0,
        }}
        onClick={onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove from workspace"
      >
        ✕
      </button>
    </div>
  );
}
