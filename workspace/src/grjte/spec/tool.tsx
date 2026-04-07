import { render } from 'solid-js/web';
import { For, Show, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { SpecDoc, Spec } from '../../workflow/types';
import './spec.css';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

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
            <DataFolderList folderUrl={url()} />
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

function DataFolderList(props: { folderUrl: AutomergeUrl }) {
  const [folder] = useDocument<FolderDoc>(() => props.folderUrl);
  const [selectedDoc, setSelectedDoc] = createSignal<AutomergeUrl | null>(null);

  return (
    <div class="spec-data-list">
      <Show when={folder()?.docs} fallback={<div class="spec-data-empty">No data docs.</div>}>
        {(docs) => (
          <>
            <For each={docs()}>
              {(docLink) => (
                <div
                  class="spec-data-item"
                  classList={{ selected: selectedDoc() === docLink.url }}
                  onClick={() =>
                    setSelectedDoc((prev) => (prev === docLink.url ? null : docLink.url))
                  }
                >
                  <span class="spec-data-icon">
                    {docLink.type === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
                  </span>
                  <span class="spec-data-name">{docLink.name || 'Untitled'}</span>
                  <span class="spec-data-type">{docLink.type}</span>
                </div>
              )}
            </For>
            <Show when={selectedDoc()}>
              {(url) => (
                <div class="spec-data-preview">
                  <patchwork-view attr:doc-url={url()} />
                </div>
              )}
            </Show>
          </>
        )}
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
