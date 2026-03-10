import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import { useState } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';

import type { PetrinetDoc } from './net';
import './index.css';

// ─── ToolRender entry point ───────────────────────────────────────────────────

export const PetrinetEditorTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <PetrinetEditor
        docUrl={handle.url}
        handle={handle as DocHandle<PetrinetDoc>}
      />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Tab types ────────────────────────────────────────────────────────────────

type Tab = 'source' | 'preview';

// ─── Editor component ─────────────────────────────────────────────────────────

function PetrinetEditor({
  docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: DocHandle<PetrinetDoc>;
}) {
  const [doc] = useDocument<PetrinetDoc>(docUrl);
  const [activeTab, setActiveTab] = useState<Tab>('source');

  if (!doc) {
    return <div className="pn-loading">Loading…</div>;
  }

  return (
    <div className="pne-root">
      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div className="pne-tabbar">
        <button
          className={`pne-tab ${activeTab === 'source' ? 'pne-tab-active' : ''}`}
          onClick={() => setActiveTab('source')}
        >
          Source
        </button>
        <button
          className={`pne-tab ${activeTab === 'preview' ? 'pne-tab-active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Preview
        </button>
      </div>

      {/* ── Tab content ─────────────────────────────────────────────── */}
      <div className="pne-content">
        {activeTab === 'source' && (
          <textarea
            className="pne-source-textarea"
            value={doc.source ?? ''}
            onChange={e => handle.change(d => { d.source = e.target.value; })}
            spellCheck={false}
          />
        )}
        {activeTab === 'preview' && (
          <patchwork-view
            doc-url={docUrl}
            tool-id="petrinet"
            class="pne-patchwork-view"
          />
        )}
      </div>
    </div>
  );
}
