import { render } from 'solid-js/web';
import { For, Show, createSignal, createMemo } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { SpecDoc, Spec } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import './spec.css';

type VerificationWrapperDoc = {
  docUrl?: AutomergeUrl;
};

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
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
  const [selectedVerificationUrl, setSelectedVerificationUrl] = createSignal<AutomergeUrl | null>(
    null,
  );
  const [selectedFileUrl, setSelectedFileUrl] = createSignal<AutomergeUrl | null>(null);

  const handleSelectVerification = (url: AutomergeUrl | null) => {
    setSelectedVerificationUrl(url);
    if (url) setSelectedFileUrl(null);
  };

  const handleSelectFile = (url: AutomergeUrl | null) => {
    setSelectedFileUrl(url);
    if (url) setSelectedVerificationUrl(null);
  };

  const [verificationWrapperDoc] = useDocument<VerificationWrapperDoc>(
    () => selectedVerificationUrl() ?? undefined,
  );

  const resolvedVerificationUrl = createMemo(() => {
    const wrapper = verificationWrapperDoc();
    if (wrapper?.docUrl) return wrapper.docUrl;
    return selectedVerificationUrl();
  });

  const selectedPreviewUrl = () => resolvedVerificationUrl() ?? selectedFileUrl();

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
                    onSelectVerification={handleSelectVerification}
                    selectedFileUrl={selectedFileUrl()}
                    onSelectFile={handleSelectFile}
                  />
                )}
              </Show>
            </div>

            <div class="spec-preview">
              <Show
                when={selectedPreviewUrl()}
                fallback={
                  <div class="spec-preview-empty">Select a verification or file to inspect</div>
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
  selectedFileUrl: AutomergeUrl | null;
  onSelectFile: (url: AutomergeUrl | null) => void;
}) {
  const hasSubSpecs = () => (props.spec.subSpecUrls?.length ?? 0) > 0;
  const hasVerifications = () => (props.spec.verificationUrls?.length ?? 0) > 0;
  const hasFiles = () => !!props.spec.filesFolderUrl;

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
        <Show when={hasFiles()}>
          <FilesSection
            folderUrl={props.spec.filesFolderUrl!}
            selectedFileUrl={props.selectedFileUrl}
            onSelectFile={props.onSelectFile}
          />
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
                selectedFileUrl={props.selectedFileUrl}
                onSelectFile={props.onSelectFile}
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
  selectedFileUrl: AutomergeUrl | null;
  onSelectFile: (url: AutomergeUrl | null) => void;
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
          selectedFileUrl={props.selectedFileUrl}
          onSelectFile={props.onSelectFile}
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

function FilesSection(props: {
  folderUrl: AutomergeUrl;
  selectedFileUrl: AutomergeUrl | null;
  onSelectFile: (url: AutomergeUrl | null) => void;
}) {
  const [folder] = useDocument<FolderDoc>(() => props.folderUrl);

  return (
    <Show when={folder()?.docs && folder()!.docs.length > 0}>
      <div class="spec-files">
        <div class="spec-files-header">Files</div>
        <For each={folder()?.docs}>
          {(file) => (
            <button
              class="spec-file-item"
              classList={{ selected: props.selectedFileUrl === file.url }}
              onClick={() =>
                props.onSelectFile(props.selectedFileUrl === file.url ? null : file.url)
              }
            >
              <span class="spec-file-icon">📄</span>
              <span class="spec-file-name">{file.name}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
