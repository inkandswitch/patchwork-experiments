import { render } from 'solid-js/web';
import { createResource, createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';

import type { LLMChatDoc, LLMDoc } from './types';
import { buildLLMMessages, runLLMProcess } from './llm-process';
import { LLMView } from './view';
import { LLMWorkspaceView } from './workspace';
import './chat.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMChatView handle={handle as DocHandle<LLMChatDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Main chat view ───────────────────────────────────────────────────────────

function LLMChatView(props: { handle: DocHandle<LLMChatDoc> }) {
  const [doc] = useDocument<LLMChatDoc>(() => props.handle.url);
  const repo = useRepo();
  const [prompt, setPrompt] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<'chat' | 'workspace'>('chat');

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;

    const currentDoc = doc();
    if (!currentDoc) return;

    setIsSubmitting(true);
    try {
      const previousMessages = await buildContextMessages(repo, currentDoc.runs);

      const runHandle = repo.create<LLMDoc>();
      runHandle.change((d) => {
        d['@patchwork'] = { type: 'llm' };
        d.config = { ...currentDoc.config };
        d.prompt = text;
        d.output = [];
        if (currentDoc.workspaceUrl) d.workspaceUrl = currentDoc.workspaceUrl;
        if (previousMessages.length > 0) {
          d.previousMessages = previousMessages;
        }
      });

      props.handle.change((d) => {
        d.runs.push(runHandle.url);
      });

      setPrompt('');

      await runLLMProcess(repo, runHandle.url);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Show
      when={doc()}
      fallback={
        <div class="llm-chat-root">
          <div class="llm-chat-loading">Loading…</div>
        </div>
      }
    >
      {(currentDoc) => (
        <div class="llm-chat-root">
          <div class="llm-chat-tabs">
            <button
              class={`llm-chat-tab${activeTab() === 'chat' ? ' active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
            <button
              class={`llm-chat-tab${activeTab() === 'workspace' ? ' active' : ''}`}
              onClick={() => setActiveTab('workspace')}
            >
              Workspace
            </button>
          </div>

          <Show when={activeTab() === 'chat'}>
            <div class="llm-chat-runs">
              <Show
                when={currentDoc().runs.length > 0}
                fallback={
                  <div class="llm-chat-empty">
                    Start a conversation by typing a prompt below.
                  </div>
                }
              >
                <For each={currentDoc().runs}>
                  {(url) => <LLMRunView url={url} />}
                </For>
              </Show>
            </div>

            <div class="llm-chat-input-bar">
              <textarea
                class="llm-chat-textarea"
                placeholder="Enter a prompt… (⌘↵ to send)"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting()}
                rows={3}
              />
              <button
                class="llm-chat-send-btn"
                onClick={handleSubmit}
                disabled={isSubmitting() || !prompt().trim()}
              >
                {isSubmitting() ? 'Running…' : 'Send'}
              </button>
            </div>
          </Show>

          <Show when={activeTab() === 'workspace'}>
            <div class="llm-chat-workspace-panel">
              <Show
                when={currentDoc().workspaceUrl}
                fallback={<div class="llm-chat-empty">No workspace attached to this chat.</div>}
              >
                {(wsUrl) => <LLMWorkspaceView url={wsUrl()} />}
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

// ─── Single run view (resolves URL → handle → LLMView) ───────────────────────

function LLMRunView(props: { url: AutomergeUrl }) {
  const repo = useRepo();
  const [handle] = createResource(
    () => props.url,
    (url) => repo.find<LLMDoc>(url),
  );

  return (
    <Show when={handle()}>
      {(h) => (
        <div class="llm-chat-run">
          <LLMView handle={h()} />
        </div>
      )}
    </Show>
  );
}

// ─── Context building ─────────────────────────────────────────────────────────

async function buildContextMessages(
  repo: ReturnType<typeof useRepo>,
  runUrls: AutomergeUrl[],
) {
  const allMessages = [];

  for (const url of runUrls) {
    const handle = await repo.find<LLMDoc>(url);
    const runDoc = await handle.doc();
    if (!runDoc) continue;

    const messages = buildLLMMessages(runDoc);
    for (const msg of messages) {
      if (msg.role !== 'system') {
        allMessages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  return allMessages;
}
