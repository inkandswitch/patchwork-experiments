import { useCallback, useState } from 'react';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { AccessLevel, WorkspaceDoc, WorkspaceEntry } from '../types';
import { DocChip, ToolChip } from '../../shared/tokens.tsx';

const ACCESS_LEVELS: { level: AccessLevel; label: string }[] = [
  { level: 'read', label: 'Read-Only' },
  { level: 'reviewed', label: 'Reviewed' },
  { level: 'full', label: 'Full Access' },
];

export function WorkspaceUI({ docUrl }: { docUrl: AutomergeUrl }) {
  const [doc, changeDoc] = useDocument<WorkspaceDoc>(docUrl, { suspense: true });
  const [draggedEntry, setDraggedEntry] = useState<AutomergeUrl | null>(null);
  const [dropTarget, setDropTarget] = useState<AccessLevel | null>(null);
  const [externalDragLevel, setExternalDragLevel] = useState<AccessLevel | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);

  const entries = doc?.entries ?? [];

  // Build a lookup from originalUrl -> changeType for indicators
  const changeMap = new Map<AutomergeUrl, 'modified' | 'added'>(
    (doc?.mappings ?? []).map((m) => [m.originalUrl, m.changeType]),
  );

  const entriesByLevel = (level: AccessLevel) => entries.filter((e) => e.accessLevel === level);

  const selectedEntry = selectedUrl ? entries.find((e) => e.url === selectedUrl) ?? null : null;

  const handleTitleChange = useCallback(
    (e: React.FocusEvent<HTMLHeadingElement>) => {
      const newTitle = e.currentTarget.textContent?.trim() || 'Workspace';
      changeDoc((d) => { d.title = newTitle; });
    },
    [changeDoc],
  );

  const handleRestrictToggle = useCallback(() => {
    changeDoc((d) => { d.restrictToEntries = !d.restrictToEntries; });
  }, [changeDoc]);

  const handleRemoveEntry = useCallback(
    (url: AutomergeUrl) => {
      changeDoc((d) => {
        const idx = d.entries.findIndex((e) => e.url === url);
        if (idx >= 0) d.entries.splice(idx, 1);
      });
      if (selectedUrl === url) setSelectedUrl(null);
    },
    [changeDoc, selectedUrl],
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

  const handleInternalDragStart = useCallback((e: React.DragEvent, url: AutomergeUrl) => {
    e.dataTransfer.setData('text/x-workspace-entry', url);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedEntry(url);
  }, []);

  const handleInternalDragEnd = useCallback(() => {
    setDraggedEntry(null);
    setDropTarget(null);
  }, []);

  const handleBucketDragOver = useCallback((e: React.DragEvent, level: AccessLevel) => {
    if (e.dataTransfer.types.includes('text/x-workspace-entry')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(level);
    } else if (e.dataTransfer.types.includes('text/x-patchwork-dnd')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setExternalDragLevel(level);
    }
  }, []);

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
      style={{ display: 'flex', flexDirection: 'row', height: '100%', overflow: 'hidden' }}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {/* Left panel — file tree */}
      <div
        style={{
          width: 260,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #e5e7eb',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
          <h2
            contentEditable
            suppressContentEditableWarning
            onBlur={handleTitleChange}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              fontSize: 13,
              fontWeight: 600,
              margin: '0 0 6px',
              padding: '2px 2px',
              outline: 'none',
              borderBottom: '1px solid transparent',
              cursor: 'text',
            }}
            onFocus={(e) => { e.currentTarget.style.borderBottom = '1px solid #ddd'; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderBottom = '1px solid transparent'; }}
          >
            {doc?.title || 'Workspace'}
          </h2>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              color: '#888',
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
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px 8px' }}>
          {ACCESS_LEVELS.map(({ level, label }) => {
            const levelEntries = entriesByLevel(level);
            const isDropHere = dropTarget === level || externalDragLevel === level;

            return (
              <div
                key={level}
                style={{
                  marginBottom: 8,
                  background: isDropHere ? '#eff6ff' : '#f5f5f5',
                  border: `1px solid ${isDropHere ? '#93c5fd' : '#e5e7eb'}`,
                  borderRadius: 6,
                  transition: 'background 0.15s, border-color 0.15s',
                  overflow: 'hidden',
                }}
                onDragOver={(e) => handleBucketDragOver(e, level)}
                onDragLeave={(e) => handleBucketDragLeave(e, level)}
                onDrop={(e) => handleBucketDrop(e, level)}
              >
                {/* Section label */}
                <div
                  style={{
                    padding: '5px 10px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#6b7280',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    borderBottom: levelEntries.length > 0 ? '1px solid #e5e7eb' : 'none',
                    userSelect: 'none',
                  }}
                >
                  {label}
                  {levelEntries.length > 0 && (
                    <span style={{ fontWeight: 400, marginLeft: 4, color: '#9ca3af' }}>
                      {levelEntries.length}
                    </span>
                  )}
                </div>

                {/* Entry rows */}
                {levelEntries.length > 0 && (
                  <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {levelEntries.map((entry) => (
                      <EntryRow
                        key={entry.url}
                        entry={entry}
                        isDragging={draggedEntry === entry.url}
                        isSelected={selectedUrl === entry.url}
                        changeType={changeMap.get(entry.url) ?? null}
                        onSelect={() => setSelectedUrl(entry.url)}
                        onDragStart={(e) => handleInternalDragStart(e, entry.url)}
                        onDragEnd={handleInternalDragEnd}
                        onRemove={() => handleRemoveEntry(entry.url)}
                      />
                    ))}
                  </div>
                )}

                {/* Empty drop hint */}
                {levelEntries.length === 0 && (
                  <div
                    style={{
                      padding: '6px 10px 8px',
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

          {entries.length === 0 && (
            <div
              style={{
                padding: '12px',
                textAlign: 'center',
                fontSize: 10,
                color: '#bbb',
                border: '1px dashed #e5e7eb',
                borderRadius: 6,
              }}
            >
              Drop documents or tools to add them
            </div>
          )}
        </div>
      </div>

      {/* Right panel — preview */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {selectedEntry?.type === 'tool' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: 11,
              color: '#aaa',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            Preview not available for tools
          </div>
        ) : selectedUrl ? (
          // @ts-expect-error Custom element from @inkandswitch/patchwork-elements
          <patchwork-view
            doc-url={selectedUrl}
            style={{ display: 'block', width: '100%', height: '100%' }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              fontSize: 11,
              color: '#ccc',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            Select an item to preview
          </div>
        )}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  isDragging,
  isSelected,
  changeType,
  onSelect,
  onDragStart,
  onDragEnd,
  onRemove,
}: {
  entry: WorkspaceEntry;
  isDragging: boolean;
  isSelected: boolean;
  changeType: 'modified' | 'added' | null;
  onSelect: () => void;
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
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 2px',
        borderRadius: 4,
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : 1,
        background: isSelected ? '#e8f0fe' : 'transparent',
        transition: 'opacity 0.1s, background 0.1s',
        outline: isSelected ? '1px solid #93c5fd' : 'none',
      }}
    >
      {/* Chip renders the full visual token */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {entry.type === 'tool' ? (
          <ToolChip
            docUrl={entry.url}
            name={entry.name}
            path={(entry as any).path}
            draggable={false}
          />
        ) : (
          <DocChip
            docUrl={entry.url}
            name={entry.name}
            draggable={false}
          />
        )}
      </div>

      {/* Change indicators */}
      {changeType === 'modified' && (
        <span
          title="Modified"
          style={{ fontSize: 9, color: '#d97706', flexShrink: 0, lineHeight: 1 }}
        >
          ●
        </span>
      )}
      {changeType === 'added' && (
        <span
          title="Added"
          style={{ fontSize: 10, color: '#16a34a', flexShrink: 0, lineHeight: 1, fontWeight: 700 }}
        >
          +
        </span>
      )}

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
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove from workspace"
      >
        ✕
      </button>
    </div>
  );
}
