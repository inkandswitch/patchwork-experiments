import { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import { useDocument, useDocuments, useRepo } from '@automerge/automerge-repo-react-hooks';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import { Search, Plus } from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { NoteDoc } from './types';
import { NoteDatatype } from './datatype';
import './styles.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function matchesQuery(doc: NoteDoc, query: string): boolean {
  const q = query.toLowerCase();
  if (doc.title?.toLowerCase().includes(q)) return true;
  if (doc.body?.toLowerCase().includes(q)) return true;
  if (doc.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

const QuickEntry = ({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) => {
  const [folder, changeFolder] = useDocument<FolderDoc>(docUrl);
  const repo = useRepo();
  const [query, setQuery] = useState('');

  const noteLinks = useMemo(() => {
    if (!folder?.docs) return [];
    return folder.docs.filter((d: DocLink) => d.type === 'notes');
  }, [folder?.docs]);

  const noteUrls = useMemo(() => noteLinks.map((d: DocLink) => d.url), [noteLinks]);
  const [noteDocs] = useDocuments<NoteDoc>(noteUrls);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const matches: { link: DocLink; doc: NoteDoc }[] = [];
    for (const link of noteLinks) {
      const doc = noteDocs.get(link.url);
      if (doc && matchesQuery(doc, query)) {
        matches.push({ link, doc });
      }
    }
    matches.sort((a, b) => {
      const da = a.doc.createdAt || '';
      const db = b.doc.createdAt || '';
      return db.localeCompare(da);
    });
    return matches;
  }, [query, noteLinks, noteDocs]);

  const openNote = useCallback(
    (url: AutomergeUrl) => {
      element.dispatchEvent(
        new CustomEvent('patchwork:open-document', {
          detail: { url, toolId: 'notes' },
          bubbles: true,
        }),
      );
    },
    [element],
  );

  const createNote = useCallback(() => {
    const handle = repo.create<NoteDoc>();
    handle.change((doc) => {
      NoteDatatype.init(doc);
      if (query.trim()) {
        doc.title = query.trim();
      }
    });

    changeFolder((f: FolderDoc) => {
      const link: DocLink = {
        url: handle.url,
        name: query.trim() || 'Untitled',
        type: 'notes',
      };
      if (!f.docs) (f as any).docs = [];
      f.docs.push(link);
    });

    setQuery('');
    openNote(handle.url);
  }, [repo, changeFolder, query, openNote]);

  const hasResults = results.length > 0;
  const showCreate = query.trim().length > 0;

  return (
    <div className="notes-quick">
      <div className="notes-quick-input-wrap">
        <Search size={16} className="notes-quick-icon" />
        <input
          type="text"
          className="notes-quick-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !hasResults && showCreate) {
              e.preventDefault();
              createNote();
            }
          }}
          placeholder="Search notes or create new..."
          autoFocus
        />
      </div>

      {showCreate && (
        <button className="notes-quick-create" onClick={createNote}>
          <Plus size={16} />
          Create &ldquo;{query.trim()}&rdquo;
        </button>
      )}

      {hasResults && (
        <div className="notes-quick-results">
          {results.map(({ link, doc }) => (
            <button
              key={link.url}
              className="notes-quick-result"
              onClick={() => openNote(link.url)}
            >
              <span className="notes-quick-result-title">
                {doc.title?.trim() || (doc.createdAt ? formatDate(doc.createdAt) : 'Untitled')}
              </span>
              {doc.tags?.length > 0 && (
                <span className="notes-quick-result-tags">
                  {doc.tags.map((t) => `#${t}`).join(' ')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {query.trim() && !hasResults && (
        <div className="notes-quick-empty">
          No matching notes. Press Enter to create a new one.
        </div>
      )}
    </div>
  );
};

export function renderQuickEntry(
  handle: { url: AutomergeUrl },
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <QuickEntry docUrl={handle.url} element={element} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
