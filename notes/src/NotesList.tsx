import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument, useDocuments } from '@automerge/automerge-repo-react-hooks';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { NoteDoc } from './types';
import './styles.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max).trimEnd() + '...';
}

const NotesList = ({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) => {
  const [folder] = useDocument<FolderDoc>(docUrl);

  const noteLinks = useMemo(() => {
    if (!folder?.docs) return [];
    return folder.docs.filter((d: DocLink) => d.type === 'notes');
  }, [folder?.docs]);

  const noteUrls = useMemo(() => noteLinks.map((d: DocLink) => d.url), [noteLinks]);
  const [noteDocs] = useDocuments<NoteDoc>(noteUrls);

  const sortedNotes = useMemo(() => {
    const entries: { link: DocLink; doc: NoteDoc }[] = [];
    for (const link of noteLinks) {
      const doc = noteDocs.get(link.url);
      if (doc) entries.push({ link, doc });
    }
    entries.sort((a, b) => {
      const da = a.doc.createdAt || '';
      const db = b.doc.createdAt || '';
      return db.localeCompare(da);
    });
    return entries;
  }, [noteLinks, noteDocs]);

  const openNote = (url: AutomergeUrl) => {
    element.dispatchEvent(
      new CustomEvent('patchwork:open-document', {
        detail: { url, toolId: 'notes' },
        bubbles: true,
      }),
    );
  };

  if (!folder) {
    return <div className="notes-list-loading">Loading...</div>;
  }

  return (
    <div className="notes-list">
      <div className="notes-list-header">
        <h2 className="notes-list-title">Notes</h2>
        <span className="notes-list-count">{sortedNotes.length}</span>
      </div>
      <div className="notes-list-items">
        {sortedNotes.length === 0 ? (
          <div className="notes-list-empty">No notes yet</div>
        ) : (
          sortedNotes.map(({ link, doc }) => (
            <button
              key={link.url}
              className="notes-list-card"
              onClick={() => openNote(link.url)}
            >
              <div className="notes-list-card-title">
                {doc.title?.trim() || (doc.createdAt ? formatDate(doc.createdAt) : 'Untitled')}
              </div>
              {doc.createdAt && doc.title?.trim() && (
                <div className="notes-list-card-date">{formatDate(doc.createdAt)}</div>
              )}
              {doc.body && (
                <div className="notes-list-card-preview">{truncate(doc.body, 120)}</div>
              )}
              {doc.tags?.length > 0 && (
                <div className="notes-list-card-tags">
                  {doc.tags.map((tag) => (
                    <span key={tag} className="notes-list-card-tag">{tag}</span>
                  ))}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export function renderNotesList(
  handle: { url: AutomergeUrl },
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <NotesList docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
