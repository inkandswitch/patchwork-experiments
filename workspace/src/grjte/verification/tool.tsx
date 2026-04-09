import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { VerificationDoc } from './types';
import './verification.css';

export const VerificationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <VerificationView handle={handle as DocHandle<VerificationDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function VerificationView(props: { handle: DocHandle<VerificationDoc> }) {
  const [doc] = useDocument<VerificationDoc>(() => props.handle.url);
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="verification-root">
      <Show when={doc()} fallback={<div class="verification-loading">Loading verification...</div>}>
        {(current) => (
          <div class="verification-card">
            <button class="verification-summary" onClick={() => setExpanded((value) => !value)}>
              <div class="verification-summary-main">
                <div class="verification-summary-copy">
                  <div class="verification-summary-title">
                    {current().title || 'Untitled verification'}
                  </div>
                  <div class="verification-summary-description">
                    {current().description || 'Formalized verification'}
                  </div>
                </div>
              </div>
              <div class="verification-summary-meta">
                <span class="verification-expand-label">
                  {expanded() ? 'Hide details' : 'Show details'}
                </span>
              </div>
            </button>

            <Show when={expanded()}>
              <div class="verification-details">
                <div class="verification-raw-doc">
                  <patchwork-view
                    attr:doc-url={current().docUrl}
                    style="display:block;width:100%;"
                  />
                </div>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
