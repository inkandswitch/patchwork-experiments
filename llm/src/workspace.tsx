import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
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

  function handleAdd() {
    const url = newUrl().trim();
    if (!url) return;
    handle()?.change((d) => {
      d.urls.push(url as AutomergeUrl);
    });
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

          <div class="llm-ws-list">
            <Show
              when={currentDoc().urls.length > 0}
              fallback={<div class="llm-ws-empty">No documents yet. Add an Automerge URL below.</div>}
            >
              <For each={currentDoc().urls}>
                {(url, index) => (
                  <div class="llm-ws-row">
                    <span class="llm-ws-row-url" title={url}>{url}</span>
                    <button
                      class="llm-ws-remove-btn"
                      onClick={() => handleRemove(index())}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="llm-ws-add-bar">
            <input
              class="llm-ws-add-input"
              type="text"
              placeholder="automerge:…"
              value={newUrl()}
              onInput={(e) => setNewUrl(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
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
