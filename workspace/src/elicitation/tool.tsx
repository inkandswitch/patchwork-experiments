import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { X } from 'lucide-solid';
import { useTitle, getDocTitle } from '../hooks/useTitle';
import type { ElicitationDoc } from '../types';
import './elicitation.css';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export const ElicitationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ElicitationView handle={handle as DocHandle<ElicitationDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ElicitationView(props: { handle: DocHandle<ElicitationDoc> }) {
  const [doc] = useDocument<ElicitationDoc>(() => props.handle.url);
  const repo = useRepo();
  const [selectedDocUrl, setSelectedDocUrl] = createSignal<AutomergeUrl | null>(null);
  const [isDragOver, setIsDragOver] = createSignal(false);

  const folderUrl = () => doc()?.referenceDocsFolderUrl;
  const [folderDoc] = useDocument<FolderDoc>(() => folderUrl());
  const folderEntries = () => folderDoc()?.docs ?? [];

  function handlePromptInput(e: InputEvent) {
    const value = (e.target as HTMLTextAreaElement).value;
    props.handle.change((d) => {
      d.prompt = value;
    });
  }

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('text/x-patchwork-urls')) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const data = e.dataTransfer?.getData('text/x-patchwork-urls');
    const fUrl = folderUrl();
    if (!data || !fUrl) return;

    const urls: AutomergeUrl[] = JSON.parse(data);
    const folderHandle = await repo.find<FolderDoc>(fUrl);
    let lastUrl: AutomergeUrl | null = null;

    for (const url of urls) {
      const name = await getDocTitle(repo, url);
      folderHandle.change((d) => {
        if (!d.docs) d.docs = [];
        d.docs.push({ type: 'doc', name, url });
      });
      lastUrl = url;
    }
    if (lastUrl) setSelectedDocUrl(lastUrl);
  }

  function handleDocClick(url: AutomergeUrl) {
    setSelectedDocUrl(url);
  }

  function handleRemoveDoc(index: number, url: AutomergeUrl) {
    const fUrl = folderUrl();
    if (!fUrl) return;
    repo.find<FolderDoc>(fUrl).then((folderHandle) => {
      folderHandle.change((d) => {
        if (d.docs) d.docs.splice(index, 1);
      });
    });
    if (selectedDocUrl() === url) setSelectedDocUrl(null);
  }

  return (
    <div
      class="el-root"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Show when={isDragOver()}>
        <div class="el-drop-overlay">
          <div class="el-drop-overlay-content">
            Drop document to add to spec elicitation
          </div>
        </div>
      </Show>

      <div class="el-main">
        <div class="el-prompt-box">
          <textarea
            class="el-prompt-textarea"
            placeholder="Describe what you want to build..."
            value={doc()?.prompt ?? ''}
            onInput={handlePromptInput}
            rows={3}
          />
        </div>

        <Show when={folderEntries().length === 0}>
          <div class="el-prompt-hint">Drag and drop files to add to elicitation</div>
        </Show>

        <Show when={folderEntries().length > 0}>
          <div class="el-docs-section">
            <div class="el-doc-list">
              <For each={folderEntries()}>
                {(entry, index) => (
                  <DocCard
                    url={entry.url}
                    selected={selectedDocUrl() === entry.url}
                    onClick={() => handleDocClick(entry.url)}
                    onRemove={() => handleRemoveDoc(index(), entry.url)}
                  />
                )}
              </For>
            </div>

            <div class="el-preview">
              <Show
                when={selectedDocUrl()}
                fallback={<div class="el-preview-empty">Select a document to preview</div>}
              >
                {(url) => (
                  <div class="el-preview-content">
                    <patchwork-view
                      attr:doc-url={url()}
                      style="display:block;width:100%;height:100%;"
                    />
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

function DocCard(props: {
  url: AutomergeUrl;
  selected: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const title = useTitle(() => props.url);

  return (
    <div
      class={`el-doc-card ${props.selected ? 'selected' : ''}`}
      onClick={props.onClick}
    >
      <span class="el-doc-card-title">{title()}</span>
      <button
        class="el-doc-card-remove"
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
