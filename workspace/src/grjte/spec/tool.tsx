import { render } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { SpecDoc, Spec } from '../../workflow/types';
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

  return (
    <div class="spec-root">
      <Show when={doc()} fallback={<div class="spec-loading">Loading spec...</div>}>
        {(currentDoc) => (
          <Show
            when={currentDoc().spec}
            fallback={<div class="spec-empty">No spec defined.</div>}
          >
            {(spec) => (
              <div class="spec-content">
                <SpecSection spec={spec()} />
              </div>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}

function SpecSection(props: { spec: Spec }) {
  return (
    <div class="spec-section">
      <div class="spec-goal">{props.spec.goal || 'Untitled spec'}</div>

      <Show when={props.spec.dataFolderUrl}>
        {(url) => (
          <div class="spec-data-folder">
            <div class="spec-section-label">Data</div>
            <patchwork-view
              attr:doc-url={url()}
              style="display:block;width:100%;"
            />
          </div>
        )}
      </Show>

      <Show when={(props.spec.verificationUrls?.length ?? 0) > 0}>
        <div class="spec-section-label">Verifications</div>
        <div class="spec-verification-list">
          <For each={props.spec.verificationUrls}>
            {(url) => (
              <patchwork-view
                attr:doc-url={url}
                attr:tool-id="grjte-verification-viewer"
                style="display:block;width:100%;"
              />
            )}
          </For>
        </div>
      </Show>

      <Show when={(props.spec.subSpecUrls?.length ?? 0) > 0}>
        <div class="spec-subspecs">
          <For each={props.spec.subSpecUrls}>
            {(url) => <SubSpecSection url={url} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function SubSpecSection(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<SpecDoc>(() => props.url);

  return (
    <Show when={doc()?.spec}>
      {(spec) => <SpecSection spec={spec()} />}
    </Show>
  );
}
