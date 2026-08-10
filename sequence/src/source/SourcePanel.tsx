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
      className="source-name-input"
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
      className="source-panel"
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

      <div className="source-panel__body">
        <div className="source-panel__scroll">
          <div className="source-panel__label">
            Sources
          </div>
          {sourceEntries.length === 0 ? (
            <p className="source-panel__empty">No sources in this sequence yet.</p>
          ) : (
            <ul className="source-list">
              {sourceEntries.map(([id, source], index) => (
                <li key={id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className="source-list__item"
                    data-selected={id === selectedId || undefined}
                    onClick={() => setSelectedId(id)}
                    onKeyDown={(event) => {
                      if (event.target instanceof HTMLInputElement) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(id);
                      }
                    }}
                  >
                    <span className="source-list__type">{source.type}</span>
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
                        className="source-list__remove"
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

        <div className="source-panel__footer">
          <div className="source-panel__add">
            <input
              type="url"
              value={sourceUrl}
              placeholder="https://…"
              className="source-url-input"
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
            <button type="button" className="source-add-button" onClick={addSource}>
              + source
            </button>
          </div>
          {sourceUrlError && <p className="source-panel__error">{sourceUrlError}</p>}
        </div>
      </div>
    </aside>
  );
}
