import { render } from 'solid-js/web';
import { createSignal, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo, AutomergeUrl } from '@automerge/automerge-repo';

import type { ValidationDoc } from '../../workflow/types';
import type { PetriNetExecutionDoc } from './types';
import type { TokenInstance } from './lib';
import { SpecTreeView } from './spec-tree-view';
import './petrinet-plan.css';

export const ValidationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ValidationView handle={handle as DocHandle<ValidationDoc>} repo={element.repo} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function ValidationView({ handle, repo }: { handle: DocHandle<ValidationDoc>; repo: Repo }) {
  const [doc] = useDocument<ValidationDoc>(() => handle.url);
  const [executionDoc] = useDocument<PetriNetExecutionDoc>(() => doc()?.executionDocUrl);
  const [isApproving, setIsApproving] = createSignal(false);

  const tokens = () => executionDoc()?.tokens ?? {};
  const candidateTokens = () => (tokens().candidates ?? []) as TokenInstance[];
  const specTokens = () => (tokens().spec ?? []) as TokenInstance[];
  const specUrls = () =>
    specTokens()
      .map((t) => (t.state as Record<string, unknown>)?.specUrl as AutomergeUrl | undefined)
      .filter((u): u is AutomergeUrl => !!u);

  const isValidated = () => doc()?.isValidated ?? false;

  function handleApprove() {
    setIsApproving(true);
    handle.change((d) => {
      d.isValidated = true;
    });
    setIsApproving(false);
  }

  function handleRevoke() {
    handle.change((d) => {
      d.isValidated = false;
    });
  }

  return (
    <div class="p3n-validation-root">
      <div class="p3n-validation-header">
        <h2 class="p3n-validation-title">Validation</h2>
        <div class="p3n-validation-status">
          <Show
            when={isValidated()}
            fallback={
              <span class="p3n-validation-badge p3n-validation-pending">Pending Approval</span>
            }
          >
            <span class="p3n-validation-badge p3n-validation-approved">Approved</span>
          </Show>
        </div>
      </div>

      <div class="p3n-validation-content">
        <Show
          when={specUrls().length > 0}
          fallback={<div class="p3n-loading">No execution data found</div>}
        >
          <For each={specUrls()}>
            {(url) => (
              <SpecTreeView
                specUrl={url}
                candidateTokens={candidateTokens()}
                repo={repo}
              />
            )}
          </For>
        </Show>
      </div>

      <div class="p3n-validation-actions">
        <Show
          when={!isValidated()}
          fallback={
            <button
              class="p3n-validation-btn p3n-validation-btn-revoke"
              onClick={handleRevoke}
            >
              Revoke Approval
            </button>
          }
        >
          <button
            class="p3n-validation-btn p3n-validation-btn-approve"
            onClick={handleApprove}
            disabled={isApproving()}
          >
            {isApproving() ? 'Approving...' : 'Approve All'}
          </button>
        </Show>
      </div>
    </div>
  );
}
