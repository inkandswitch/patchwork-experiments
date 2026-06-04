import type { SequenceDoc } from '../types';
import type { PendingClip } from '../drag';

import { useEffect, useMemo, useState } from 'react';
import { SourceMonitor } from './SourceMonitor';

type SourcePanelProps = {
  doc: SequenceDoc;
  onStartClipDrag: (payload: PendingClip, event: React.PointerEvent) => void;
};

export function SourcePanel({ doc, onStartClipDrag }: SourcePanelProps) {
  const sourceEntries = useMemo(() => Object.entries(doc.sources), [doc.sources]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && doc.sources[selectedId]) return;
    setSelectedId(sourceEntries[0]?.[0] ?? null);
  }, [selectedId, sourceEntries, doc.sources]);

  const selectedSource = selectedId ? doc.sources[selectedId] ?? null : null;
  const labelFor = (id: string) => {
    const index = sourceEntries.findIndex(([entryId]) => entryId === id);
    return `Source ${index + 1}`;
  };

  return (
    <aside className="source-panel flex h-full w-80 min-w-72 flex-col border-r border-base-300 bg-base-200">
      <SourceMonitor
        source={selectedSource}
        sourceId={selectedId}
        label={selectedId ? labelFor(selectedId) : 'clip'}
        onStartClipDrag={onStartClipDrag}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-base-content/60">
          Sources
        </div>
        {sourceEntries.length === 0 ? (
          <p className="text-xs text-base-content/50">No sources in this sequence yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sourceEntries.map(([id, source], index) => (
              <li key={id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    id === selectedId
                      ? 'bg-primary/20 text-base-content'
                      : 'hover:bg-base-300/60 text-base-content/80'
                  }`}
                  onClick={() => setSelectedId(id)}
                >
                  <span className="badge badge-xs badge-neutral">{source.type}</span>
                  <span className="truncate">Source {index + 1}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
