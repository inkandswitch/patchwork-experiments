import { createRoot } from 'react-dom/client';
import {
  RepoContext,
  useDocument,
} from '@automerge/automerge-repo-react-hooks';
import { useState, useEffect, useCallback } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { P3NetDoc, SourceDoc } from './doc';
import type { PetriNet } from './lib';
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

  const [net, setNet] = useState<PetriNet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedSourceUrl, setLoadedSourceUrl] = useState<string | null>(null);

  // Load the net factory from the source doc via the service worker.
  // Convert "automerge:abc123" → "/automerge%3Aabc123" so the SW can serve it.
  useEffect(() => {
    if (!doc?.sourceUrl) return;
    if (doc.sourceUrl === loadedSourceUrl) return;

    const swUrl = doc.sourceUrl.replace('automerge:', '/automerge%3A');

    import(/* @vite-ignore */ swUrl)
      .then((mod) => {
        const factory = mod.default;
        if (typeof factory !== 'function') {
          setLoadError('Source must export a defineNet() result as default export.');
          return;
        }
        setNet(factory(handle));
        setLoadedSourceUrl(doc.sourceUrl);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(String(err));
      });
  }, [doc?.sourceUrl, handle, loadedSourceUrl]);

  const handleStep = useCallback(() => net?.step(), [net]);

  if (!doc) {
    return <div className="p3n-loading">Loading…</div>;
  }

  const tokens = doc.tokens ?? {};
  const places = net?.def.places ?? Object.keys(tokens);

  return (
    <div className="p3n-root">
      {/* ── Left: source editor ─────────────────────────────────────────── */}
      <div className="p3n-editor-col">
        <div className="p3n-toolbar">
          <span className="p3n-section-label">net.js</span>
          {loadError && (
            <span className="p3n-error-badge" title={loadError}>Error</span>
          )}
        </div>
        {doc.sourceUrl ? (
          <SourceEditor sourceUrl={doc.sourceUrl} />
        ) : (
          <div className="p3n-editor-wrap">
            <div className="p3n-loading">Loading source…</div>
          </div>
        )}
      </div>

      {/* ── Right: step panel ───────────────────────────────────────────── */}
      <div className="p3n-step-col">
        <div className="p3n-toolbar">
          <span className="p3n-section-label">Tokens</span>
          <span className="p3n-toolbar-spacer" />
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
        ) : (
          <div className="p3n-places">
            {places.map((placeId) => {
              const placeTokens = tokens[placeId] ?? [];
              return (
                <div key={placeId} className="p3n-place">
                  <div className="p3n-place-name">{placeId}</div>
                  {placeTokens.length === 0 ? (
                    <div className="p3n-empty">—</div>
                  ) : (
                    placeTokens.map((t) => (
                      <div key={t.id} className="p3n-token">
                        <span className="p3n-token-id">{t.id}</span>
                        <pre className="p3n-token-state">
                          {JSON.stringify(t.state, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Source editor ────────────────────────────────────────────────────────────

function SourceEditor({ sourceUrl }: { sourceUrl: string }) {
  const [sourceDoc, changeSourceDoc] = useDocument<SourceDoc>(
    sourceUrl as import('@automerge/automerge-repo').AutomergeUrl,
  );

  return (
    <div className="p3n-editor-wrap">
      <textarea
        className="p3n-source-textarea"
        value={sourceDoc?.content ?? ''}
        onChange={(e) =>
          changeSourceDoc((d) => {
            d.content = e.target.value;
          })
        }
        spellCheck={false}
      />
    </div>
  );
}
