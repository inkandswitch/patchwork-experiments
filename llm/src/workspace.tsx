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
  const [isDragOver, setIsDragOver] = createSignal(false);

  function addUrls(urls: string[]) {
    const entries = doc()?.entries ?? {};
    const toAdd = urls.filter((u) => u.startsWith('automerge:') && !(u in entries));
    if (toAdd.length === 0) return;

    handle()?.change((d) => {
      for (const u of toAdd) {
        d.entries[u] = { url: u as AutomergeUrl, changedAt: null };
      }
    });
  }

  function handleRemove(url: string) {
    handle()?.change((d) => {
      delete d.entries[url];
    });
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
              when={Object.keys(currentDoc().entries).length > 0}
              fallback={
                <div class="llm-ws-drop-hint">
                  {isDragOver() ? 'Drop to add' : 'Drop documents here'}
                </div>
              }
            >
              <For each={Object.keys(currentDoc().entries)}>
                {(url) => (
                  <WorkspaceDocCard
                    url={url as AutomergeUrl}
                    onRemove={() => handleRemove(url)}
                  />
                )}
              </For>
              <Show when={isDragOver()}>
                <div class="llm-ws-drop-hint active">Drop to add</div>
              </Show>
            </Show>
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
