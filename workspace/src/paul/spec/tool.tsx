import { render } from 'solid-js/web';
import { For, Show, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { SpecDoc, Spec } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import './spec.css';

export const SpecTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <SpecView handle={handle as DocHandle<SpecDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function SpecView(props: { handle: DocHandle<SpecDoc> }) {
  const [doc] = useDocument<SpecDoc>(() => props.handle.url);
  const [selectedVerificationUrl, setSelectedVerificationUrl] = createSignal<AutomergeUrl | null>(
    null,
  );

  return (
    <div class="spec-root">
      <Show when={doc()} fallback={<div class="spec-loading">Loading spec…</div>}>
        {(currentDoc) => (
          <div class="spec-container">
            <div class="spec-tree">
              <Show
                when={currentDoc().spec}
                fallback={<div class="spec-empty">No spec defined.</div>}
              >
                {(spec) => (
                  <SpecNode
                    spec={spec()}
                    depth={0}
                    selectedVerificationUrl={selectedVerificationUrl()}
                    onSelectVerification={setSelectedVerificationUrl}
                  />
                )}
              </Show>
            </div>

            <div class="spec-preview">
              <Show
                when={selectedVerificationUrl()}
                fallback={
                  <div class="spec-preview-empty">Select a verification to inspect</div>
                }
              >
                {(url) => (
                  <patchwork-view
                    attr:doc-url={url()}
                    style="display:block;width:100%;height:100%;"
                  />
                )}
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function SpecNode(props: {
  spec: Spec;
  depth: number;
  selectedVerificationUrl: AutomergeUrl | null;
  onSelectVerification: (url: AutomergeUrl | null) => void;
}) {
  const hasSubSpecs = () => (props.spec.subSpecUrls?.length ?? 0) > 0;
  const hasVerifications = () => (props.spec.verificationUrls?.length ?? 0) > 0;

  return (
    <div class="spec-node">
      <div class="spec-node-box">
        <div class="spec-node-goal">{props.spec.goal || 'Untitled spec'}</div>
        <Show when={hasVerifications()}>
          <div class="spec-verifications">
            <For each={props.spec.verificationUrls}>
              {(url) => (
                <VerificationItem
                  url={url}
                  selected={props.selectedVerificationUrl === url}
                  onSelect={() =>
                    props.onSelectVerification(props.selectedVerificationUrl === url ? null : url)
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={hasSubSpecs()}>
        <div class="spec-subspecs">
          <For each={props.spec.subSpecUrls}>
            {(url) => (
              <SubSpecNode
                url={url}
                depth={props.depth + 1}
                selectedVerificationUrl={props.selectedVerificationUrl}
                onSelectVerification={props.onSelectVerification}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function SubSpecNode(props: {
  url: AutomergeUrl;
  depth: number;
  selectedVerificationUrl: AutomergeUrl | null;
  onSelectVerification: (url: AutomergeUrl | null) => void;
}) {
  const [doc] = useDocument<SpecDoc>(() => props.url);

  return (
    <Show when={doc()?.spec}>
      {(spec) => (
        <SpecNode
          spec={spec()}
          depth={props.depth}
          selectedVerificationUrl={props.selectedVerificationUrl}
          onSelectVerification={props.onSelectVerification}
        />
      )}
    </Show>
  );
}

function VerificationItem(props: { url: AutomergeUrl; selected: boolean; onSelect: () => void }) {
  const title = useTitle(() => props.url);

  return (
    <button
      class="spec-verification-item"
      classList={{ selected: props.selected }}
      onClick={props.onSelect}
    >
      <span class="spec-verification-circle" />
      <span class="spec-verification-name">{title()}</span>
    </button>
  );
}
