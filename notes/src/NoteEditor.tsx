import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { automergeSyncPlugin } from '@automerge/automerge-codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineWrapping, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Marked } from 'marked';
import { Eye, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { toolify } from './react-util';
import { NoteDoc } from './types';
import './styles.css';

const marked = new Marked();

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const NoteEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc, changeDoc] = useDocument<NoteDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<NoteDoc>(docUrl, { suspense: true });
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [tagInput, setTagInput] = useState('');
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Set up CodeMirror
  useEffect(() => {
    if (mode !== 'edit' || !editorContainerRef.current || !handle) return;

    const state = EditorState.create({
      doc: handle.doc()?.body ?? '',
      extensions: [
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        automergeSyncPlugin({ handle: handle as any, path: ['body'] }),
        lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '15px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
          '.cm-content': { padding: '8px 0' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [mode, handle]);

  const addTag = useCallback(() => {
    const tag = tagInput.trim();
    if (!tag || doc.tags.includes(tag)) return;
    changeDoc((d) => {
      d.tags.push(tag);
    });
    setTagInput('');
  }, [tagInput, doc.tags, changeDoc]);

  const removeTag = useCallback(
    (tag: string) => {
      changeDoc((d) => {
        const idx = d.tags.indexOf(tag);
        if (idx !== -1) d.tags.splice(idx, 1);
      });
    },
    [changeDoc],
  );

  const renderedHtml = mode === 'preview' ? marked.parse(doc.body || '') : '';

  return (
    <div className="notes-editor">
      <div className="notes-editor-header">
        <input
          type="text"
          className="notes-title-input"
          value={doc.title}
          onChange={(e) => changeDoc((d) => { d.title = e.target.value; })}
          placeholder="Untitled"
        />
        <div className="notes-meta-row">
          {doc.createdAt && (
            <span className="notes-date">{formatDate(doc.createdAt)}</span>
          )}
          <button
            className="notes-mode-toggle"
            onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
            title={mode === 'edit' ? 'Preview' : 'Edit'}
          >
            {mode === 'edit' ? <Eye size={16} /> : <Pencil size={16} />}
          </button>
        </div>
      </div>

      <div className="notes-tags">
        {doc.tags.map((tag) => (
          <span key={tag} className="notes-tag">
            {tag}
            <button className="notes-tag-remove" onClick={() => removeTag(tag)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <span className="notes-tag-input-wrap">
          <input
            type="text"
            className="notes-tag-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            }}
            placeholder="Add tag..."
          />
          {tagInput.trim() && (
            <button className="notes-tag-add" onClick={addTag}>
              <Plus size={12} />
            </button>
          )}
        </span>
      </div>

      <div className="notes-body">
        {mode === 'edit' ? (
          <div className="notes-cm-container" ref={editorContainerRef} />
        ) : (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedHtml as string }}
          />
        )}
      </div>
    </div>
  );
};

export const renderNoteEditor = toolify(NoteEditor);
