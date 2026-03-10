import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import { useMemo } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';

import type { PetrinetDoc } from './net';
import { parsePetrinet } from './grammar';
import { computeLayout } from './layout';
import { PetriNetRenderer } from './renderer';
import './index.css';

// ─── ToolRender entry point ───────────────────────────────────────────────────

export const PetrinetTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <PetrinetView
        docUrl={handle.url}
        handle={handle as DocHandle<PetrinetDoc>}
      />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Main component ───────────────────────────────────────────────────────────

function PetrinetView({
  docUrl: _docUrl,
  handle,
}: {
  docUrl: AutomergeUrl;
  handle: DocHandle<PetrinetDoc>;
}) {
  const [doc] = useDocument<PetrinetDoc>(handle.url);

  const { net, errors } = useMemo(
    () => parsePetrinet(doc?.source ?? ''),
    [doc?.source],
  );

  const layout = useMemo(() => computeLayout(net), [net]);

  if (!doc) {
    return <div className="pn-loading">Loading…</div>;
  }

  return (
    <div className="pn-root">
      {/* ── Left: source editor ────────────────────────────────────────── */}
      <div className="pn-editor-col">
        <div className="pn-toolbar">
          <span className="pn-section-label">Source</span>
        </div>
        <div className="pn-editor-wrap">
          <textarea
            className="pn-source-textarea"
            value={doc.source ?? ''}
            onChange={e => handle.change(d => { d.source = e.target.value; })}
            spellCheck={false}
          />
        </div>
        {errors.length > 0 && (
          <div className="pn-parse-error">{errors[0].message}</div>
        )}
      </div>

      {/* ── Right: graph ───────────────────────────────────────────────── */}
      <div className="pn-graph-col">
        <div className="pn-graph-wrap">
          <PetriNetRenderer net={net} layout={layout} />
        </div>
      </div>
    </div>
  );
}
