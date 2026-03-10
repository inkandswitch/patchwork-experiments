import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument } from '@automerge/automerge-repo-react-hooks';
import { useCallback } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { P3NetDoc } from './doc';
import { useP3Net } from './use-p3net';
import { P3NetRenderer } from './renderer';
import './index.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const P3NetSimulationTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <P3NetSimulation handle={handle as DocHandle<P3NetDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Simulation view ──────────────────────────────────────────────────────────

function P3NetSimulation({ handle }: { handle: DocHandle<P3NetDoc> }) {
  const [doc] = useDocument<P3NetDoc>(handle.url);
  const { net, loadError } = useP3Net(handle, doc?.sourceUrl);

  const handleStep = useCallback(() => net?.step(), [net]);
  const handleReset = useCallback(() => net?.reset(), [net]);

  if (!doc) {
    return <div className="p3n-loading">Loading…</div>;
  }

  return (
    <div className="p3n-sim-root">
      <div className="p3n-toolbar">
        <span className="p3n-section-label">Simulation</span>
        <span className="p3n-toolbar-spacer" />
        {loadError && (
          <span className="p3n-error-badge" title={loadError}>Error</span>
        )}
        <button
          className="p3n-reset-btn"
          onClick={handleReset}
          disabled={!net}
        >
          Reset
        </button>
        <button
          className="p3n-step-btn"
          onClick={handleStep}
          disabled={!net}
        >
          Step
        </button>
      </div>

      {loadError ? (
        <div className="p3n-load-error">{loadError}</div>
      ) : net ? (
        <div className="p3n-graph-wrap">
          <P3NetRenderer def={net.def} tokens={doc.tokens ?? {}} />
        </div>
      ) : (
        <div className="p3n-loading">Loading net…</div>
      )}
    </div>
  );
}
