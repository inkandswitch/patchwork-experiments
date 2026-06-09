import type { ChangeFn } from '@automerge/automerge/slim';
import type { SequenceDoc, Source } from '../types';
import type { PendingClip } from '../drag';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addSourceFromUrl,
  defaultSourceName,
  isSourceUsedInTimeline,
  sourceDisplayName,
} from '../helpers';
import { SourceMonitor } from './SourceMonitor';

type SourceNameInputProps = {
  id: string;
  source: Source;
  index: number;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
};

function SourceNameInput({ id, source, index, onSelect, onRename }: SourceNameInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? source.name ?? '';
  const placeholder = defaultSourceName(index);

  const commit = () => {
    if (draft === null) return;
    onRename(id, draft);
    setDraft(null);
  };

  return (
    <input
      type="text"
      className="min-w-0 flex-1 truncate bg-transparent p-0 text-sm outline-none placeholder:text-base-content/50"
      value={value}
      placeholder={placeholder}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onFocus={() => {
        onSelect(id);
        setDraft(source.name ?? '');
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type SourcePanelProps = {
  doc: SequenceDoc;
  changeDoc: (changeFn: ChangeFn<SequenceDoc>) => void;
  onStartClipDrag: (payload: PendingClip, event: React.PointerEvent) => void;
};

export function SourcePanel({ doc, changeDoc, onStartClipDrag }: SourcePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const toggleSourcePlayRef = useRef<(() => void) | null>(null);
  const sourceEntries = useMemo(() => Object.entries(doc.sources), [doc.sources]);
  const usedSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const track of doc.tracks) {
      for (const clip of track.clips) {
        ids.add(clip.sourceId);
      }
    }
    return ids;
  }, [doc.tracks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceUrlError, setSourceUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && doc.sources[selectedId]) return;
    setSelectedId(sourceEntries[0]?.[0] ?? null);
  }, [selectedId, sourceEntries, doc.sources]);

  const selectedSource = selectedId ? doc.sources[selectedId] ?? null : null;
  const labelFor = (id: string) => {
    const index = sourceEntries.findIndex(([entryId]) => entryId === id);
    const source = doc.sources[id];
    if (!source || index < 0) return 'clip';
    return sourceDisplayName(source, index);
  };

  const renameSource = (id: string, name: string) => {
    changeDoc((d) => {
      const source = d.sources[id];
      if (!source) return;
      const trimmed = name.trim();
      if (trimmed) {
        source.name = trimmed;
      } else {
        delete source.name;
      }
    });
  };

  const removeSource = (id: string) => {
    if (usedSourceIds.has(id)) return;

    changeDoc((d) => {
      if (isSourceUsedInTimeline(d, id)) return;
      delete d.sources[id];
    });

    if (selectedId === id) {
      const remaining = sourceEntries.filter(([entryId]) => entryId !== id);
      setSelectedId(remaining[0]?.[0] ?? null);
    }
  };

  const onPanelPointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    panelRef.current?.focus({ preventScroll: true });
  };

  const addSource = () => {
    const trimmed = sourceUrl.trim();
    if (!trimmed) {
      setSourceUrlError('Enter a URL.');
      return;
    }

    let createdId: string | null = null;
    changeDoc((d) => {
      createdId = addSourceFromUrl(d, trimmed);
    });

    if (!createdId) {
      setSourceUrlError('Could not detect media type from URL extension.');
      return;
    }

    setSourceUrl('');
    setSourceUrlError(null);
    setSelectedId(createdId);
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== ' ' && event.code !== 'Space') return;
    if (event.repeat) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (!toggleSourcePlayRef.current) return;

    event.preventDefault();
    event.stopPropagation();
    toggleSourcePlayRef.current();
  };

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="source-panel flex h-full w-80 min-w-72 flex-col border-r border-base-300 bg-base-200 outline-none"
      onPointerDownCapture={onPanelPointerDownCapture}
      onKeyDown={onPanelKeyDown}
    >
      <SourceMonitor
        source={selectedSource}
        sourceId={selectedId}
        label={selectedId ? labelFor(selectedId) : 'clip'}
        onStartClipDrag={onStartClipDrag}
        bindTogglePlay={toggleSourcePlayRef}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-base-content/60">
            Sources
          </div>
          {sourceEntries.length === 0 ? (
            <p className="text-xs text-base-content/50">No sources in this sequence yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sourceEntries.map(([id, source], index) => (
                <li key={id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      id === selectedId
                        ? 'bg-primary/20 text-base-content'
                        : 'hover:bg-base-300/60 text-base-content/80'
                    }`}
                    onClick={() => setSelectedId(id)}
                    onKeyDown={(event) => {
                      if (event.target instanceof HTMLInputElement) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(id);
                      }
                    }}
                  >
                    <span className="badge badge-xs badge-neutral shrink-0">{source.type}</span>
                    <SourceNameInput
                      id={id}
                      source={source}
                      index={index}
                      onSelect={setSelectedId}
                      onRename={renameSource}
                    />
                    {!usedSourceIds.has(id) && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs btn-square shrink-0 text-base-content/50 hover:text-base-content"
                        aria-label={`Remove ${sourceDisplayName(source, index)}`}
                        title="Remove unused source"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeSource(id);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-base-300 p-3">
          <div className="flex gap-2">
            <input
              type="url"
              value={sourceUrl}
              placeholder="https://…"
              className="input input-sm input-bordered min-w-0 flex-1"
              onChange={(event) => {
                setSourceUrl(event.target.value);
                if (sourceUrlError) setSourceUrlError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addSource();
                }
              }}
            />
            <button type="button" className="btn btn-sm btn-primary shrink-0" onClick={addSource}>
              + source
            </button>
          </div>
          {sourceUrlError && <p className="mt-1 text-xs text-error">{sourceUrlError}</p>}
        </div>
      </div>
    </aside>
  );
}
