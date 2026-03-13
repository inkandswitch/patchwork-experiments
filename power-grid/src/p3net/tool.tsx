import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { P3NetDoc } from './doc';
import './index.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const P3NetTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <P3NetView handle={handle as DocHandle<P3NetDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Main view ────────────────────────────────────────────────────────────────

function P3NetView({ handle }: { handle: DocHandle<P3NetDoc> }) {
  const [doc] = useDocument<P3NetDoc>(handle.url);

  if (!doc) {
    return <div className="p3n-loading">Loading…</div>;
  }

  return (
    <div className="p3n-root">
      {/* ── Left: source JS file ────────────────────────────────────────── */}
      <patchwork-view
        doc-url={doc.sourceUrl}
        tool-id="file"
        class="p3n-pane"
      />

      {/* ── Right: simulation ───────────────────────────────────────────── */}
      <patchwork-view
        doc-url={handle.url}
        tool-id="p3net-simulation"
        class="p3n-pane"
      />
    </div>
  );
}
