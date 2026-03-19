import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { FolderDoc } from '@inkandswitch/patchwork-filesystem';

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
  const [folderDoc] = useDocument<FolderDoc>(doc?.sourceUrl);

  const netJsUrl = folderDoc?.docs?.find((d) => d.name === 'net.js')?.url;

  if (!doc) {
    return <div className="p3n-loading">Loading…</div>;
  }

  return (
    <div className="p3n-root">
      {/* ── Left: net.js source file ─────────────────────────────────────── */}
      {netJsUrl && (
        <patchwork-view
          doc-url={netJsUrl}
          tool-id="file"
          class="p3n-pane"
        />
      )}

      {/* ── Right: simulation ───────────────────────────────────────────── */}
      <patchwork-view
        doc-url={handle.url}
        tool-id="p3net-simulation"
        class="p3n-pane"
      />
    </div>
  );
}
