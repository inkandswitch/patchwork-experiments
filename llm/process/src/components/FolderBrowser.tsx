import { useState } from 'react';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';

export function FolderBrowser({ docUrl }: { docUrl: AutomergeUrl }) {
  const [selectedUrl, setSelectedUrl] = useState<AutomergeUrl | null>(null);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[250px] shrink-0 border-r border-base-content/[0.06] overflow-y-auto py-1">
        <FolderNode url={docUrl} depth={0} onSelect={setSelectedUrl} selectedUrl={selectedUrl} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedUrl ? (
          <patchwork-view doc-url={selectedUrl} class="overflow-auto h-full w-full" />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-base-content/30">
            Select a file to preview!!!
          </div>
        )}
      </div>
    </div>
  );
}

function FolderNode({
  url,
  depth,
  onSelect,
  selectedUrl,
}: {
  url: AutomergeUrl;
  depth: number;
  onSelect: (url: AutomergeUrl) => void;
  selectedUrl: AutomergeUrl | null;
}) {
  const [folder] = useDocument<FolderDoc>(url);

  if (!folder?.docs) return null;

  return (
    <>
      {folder.docs.map((entry, i) => (
        <TreeEntry
          key={`${entry.url}-${i}`}
          entry={entry}
          depth={depth}
          onSelect={onSelect}
          selectedUrl={selectedUrl}
        />
      ))}
    </>
  );
}

function TreeEntry({
  entry,
  depth,
  onSelect,
  selectedUrl,
}: {
  entry: DocLink;
  depth: number;
  onSelect: (url: AutomergeUrl) => void;
  selectedUrl: AutomergeUrl | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFolder = entry.type === 'folder';
  const isSelected = selectedUrl === entry.url;
  const paddingLeft = 8 + depth * 16;

  return (
    <div>
      <button
        className={`flex items-center gap-1.5 w-full text-left py-1 px-2 text-xs transition-colors hover:bg-base-content/[0.04] ${
          isSelected ? 'bg-primary/10 text-primary' : 'text-base-content/70'
        }`}
        style={{ paddingLeft }}
        onClick={() => {
          if (isFolder) {
            setExpanded(!expanded);
          }
          onSelect(entry.url);
        }}
      >
        <span className="text-[10px] w-3 shrink-0 text-center text-base-content/25">
          {isFolder ? (expanded ? '▼' : '▶') : '·'}
        </span>
        <span className="truncate">{entry.name}</span>
      </button>
      {isFolder && expanded && (
        <FolderNode
          url={entry.url}
          depth={depth + 1}
          onSelect={onSelect}
          selectedUrl={selectedUrl}
        />
      )}
    </div>
  );
}
