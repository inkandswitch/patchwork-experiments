import { render } from 'solid-js/web';
import { createResource, createSignal, For, Show } from 'solid-js';
import {
  RepoContext,
  useDocument,
  useDocHandle,
  createDocumentProjection,
} from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl } from '@automerge/automerge-repo';

import type { LLMWorkspaceDoc } from './types';
import './workspace.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMWorkspaceTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMWorkspaceView url={handle.url as AutomergeUrl} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Workspace view ───────────────────────────────────────────────────────────

export function LLMWorkspaceView(props: { url: AutomergeUrl }) {
  const [doc, handle] = useDocument<LLMWorkspaceDoc>(() => props.url);
  const [newUrl, setNewUrl] = createSignal('');
  const [isDragOver, setIsDragOver] = createSignal(false);

  function addUrls(urls: string[]) {
    const existing = new Set(doc()?.urls ?? []);
    const toAdd = urls.filter((u) => u.startsWith('automerge:') && !existing.has(u as AutomergeUrl));
    if (toAdd.length === 0) return;
    handle()?.change((d) => {
      for (const u of toAdd) d.urls.push(u as AutomergeUrl);
    });
  }

  function handleAdd() {
    const url = newUrl().trim();
    if (!url) return;
    addUrls([url]);
    setNewUrl('');
  }

  function handleRemove(index: number) {
    handle()?.change((d) => {
      d.urls.splice(index, 1);
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  function isPatchworkDrag(types: readonly string[]) {
    return types.includes('text/x-patchwork-urls');
  }

  function extractDroppedUrls(dataTransfer: DataTransfer): string[] {
    const raw = dataTransfer.getData('text/x-patchwork-urls');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  function handleDragOver(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    setIsDragOver(false);
    addUrls(extractDroppedUrls(e.dataTransfer!));
  }

  function handleInputDragOver(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
  }

  function handleInputDrop(e: DragEvent) {
    if (!isPatchworkDrag(e.dataTransfer?.types ?? [])) return;
    e.preventDefault();
    addUrls(extractDroppedUrls(e.dataTransfer!));
  }

  return (
    <Show
      when={doc()}
      fallback={
        <div class="llm-ws-root">
          <div class="llm-ws-empty">Loading…</div>
        </div>
      }
    >
      {(currentDoc) => (
        <div class="llm-ws-root">
          <div class="llm-ws-toolbar">
            <span class="llm-ws-title">{currentDoc().title || 'Workspace'}</span>
          </div>

          <div
            class={`llm-ws-list${isDragOver() ? ' drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Show
              when={currentDoc().urls.length > 0}
              fallback={
                <div class="llm-ws-drop-hint">
                  {isDragOver() ? 'Drop to add' : 'Drop documents here or paste an Automerge URL below'}
                </div>
              }
            >
              <For each={currentDoc().urls}>
                {(url, index) => (
                  <WorkspaceDocCard
                    url={url}
                    onRemove={() => handleRemove(index())}
                  />
                )}
              </For>
              <Show when={isDragOver()}>
                <div class="llm-ws-drop-hint active">Drop to add</div>
              </Show>
            </Show>
          </div>

          <div class="llm-ws-add-bar">
            <input
              class="llm-ws-add-input"
              type="text"
              placeholder="automerge:… or drop a document"
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onDragOver={handleInputDragOver}
              onDrop={handleInputDrop}
            />
            <button
              class="llm-ws-add-btn"
              onClick={handleAdd}
              disabled={!newUrl().trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}

// ─── Document card ────────────────────────────────────────────────────────────

function WorkspaceDocCard(props: { url: AutomergeUrl; onRemove: () => void }) {
  const title = useDocTitle(() => props.url);

  return (
    <div class="llm-ws-card">
      <div class="llm-ws-card-header">
        <span class="llm-ws-card-title">{title()}</span>
        <span class="llm-ws-card-url" title={props.url}>{props.url}</span>
        <button class="llm-ws-remove-btn" onClick={props.onRemove} title="Remove">
          ×
        </button>
      </div>
      <div class="llm-ws-card-body">
        <patchwork-view
          attr:doc-url={props.url}
          style="display:block;width:100%;height:100%;"
        />
      </div>
    </div>
  );
}

// ─── useDocTitle ──────────────────────────────────────────────────────────────

function useDocTitle(url: () => AutomergeUrl | undefined) {
  const handle = useDocHandle<any>(url);
  const doc = createDocumentProjection<any>(handle);

  const docType = () => (doc() as any)?.['@patchwork']?.type ?? '';

  const [datatype] = createResource(docType, (dt) =>
    dt ? getRegistry('patchwork:datatype').load(dt) : Promise.resolve(null),
  );

  const fallback = () => {
    const u = url();
    return u ? u.replace('automerge:', '').slice(0, 16) + '…' : '';
  };

  return () => ((datatype()?.module as any)?.getTitle?.(doc()) as string | undefined) ?? fallback();
}
