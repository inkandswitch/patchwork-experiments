import { render } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { ValidationDoc, PlanDoc, ExecutionDoc } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import './validation.css';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export const ValidationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ValidationView handle={handle as DocHandle<ValidationDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ValidationView(props: { handle: DocHandle<ValidationDoc>; element: ToolElement }) {
  const [doc] = useDocument<ValidationDoc>(() => props.handle.url);
  const [execution] = useDocument<ExecutionDoc>(() => doc()?.executionDocUrl);
  const [folder] = useDocument<FolderDoc>(() => execution()?.artifactsFolderUrl);

  const artifacts = () => folder()?.docs ?? [];

  function handleApprove() {
    props.handle.change((d) => {
      d.isValidated = true;
    });
  }

  function openDocument(url: AutomergeUrl, toolId: string) {
    props.element.dispatchEvent(
      new CustomEvent('patchwork:open-document', {
        detail: { url, toolId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  return (
    <div class="validation-root">
      <Show when={doc()} fallback={<div class="validation-loading">Loading validation...</div>}>
        {(currentDoc) => (
          <>
            <div class="validation-header">
              <div class="validation-status" classList={{ validated: currentDoc().isValidated }}>
                {currentDoc().isValidated ? 'Approved' : 'Pending'}
              </div>
              <Show when={currentDoc().specDocUrl}>
                {(specUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() => openDocument(specUrl(), 'grjte-spec-viewer')}
                    >
                      View Spec
                    </button>
                  </div>
                )}
              </Show>
              <Show when={currentDoc().planDocUrl}>
                {(planUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() => openDocument(planUrl(), 'grjte-plan-viewer')}
                    >
                      View Plan
                    </button>
                  </div>
                )}
              </Show>
              <Show when={currentDoc().executionDocUrl}>
                {(executionUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() => openDocument(executionUrl(), 'grjte-execution-viewer')}
                    >
                      View Execution
                    </button>
                  </div>
                )}
              </Show>
              <Show when={!currentDoc().isValidated}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  Approve
                </button>
              </Show>
            </div>

            <div class="validation-body">
              <Show when={artifacts().length > 0}>
                <div class="validation-section">
                  <div class="validation-section-label">Artifacts</div>
                  <div class="validation-artifact-list">
                    <For each={artifacts()}>
                      {(entry) => (
                        <div class="validation-artifact-card">
                          <div class="validation-artifact-card-label">{entry.name}</div>
                          <div class="validation-artifact-card-view">
                            <patchwork-view
                              attr:doc-url={entry.url}
                              style="display:block;width:100%;height:100%;"
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={(execution()?.verificationContextUrls?.length ?? 0) > 0}>
                <div class="validation-section">
                  <div class="validation-section-label">Verifications</div>
                  <div class="validation-verification-list">
                    <For each={execution()?.verificationContextUrls}>
                      {(url) => (
                        <patchwork-view
                          attr:doc-url={url}
                          attr:tool-id="grjte-verification-viewer"
                          style="display:block;width:100%;"
                        />
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function LinkPill(props: { url: AutomergeUrl; label: string; onClick: () => void }) {
  const title = useTitle(() => props.url);

  return (
    <button class="validation-link-pill" onClick={props.onClick}>
      <span class="validation-link-label">{props.label}:</span>
      <span class="validation-link-title">{title()}</span>
    </button>
  );
}
