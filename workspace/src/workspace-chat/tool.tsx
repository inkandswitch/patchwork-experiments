import { render } from 'solid-js/web';
import { createSignal, createResource, For, Show, createEffect } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';

import type { WorkspaceChatDoc, WorkspaceDoc, DocumentEntry } from '../types';
import type { LLMProcessDoc, ChatMessage, ChatMessagePart } from '../llm/types';
import { runWorkspaceLLM, buildFullSystemPrompt } from '../llm/llm-process';
import './chat.css';

const MODELS = [
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
  { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-haiku-3.5', name: 'Claude Haiku 3.5' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
  { id: 'openai/gpt-4.1-nano', name: 'GPT-4.1 Nano' },
  { id: 'openai/o4-mini', name: 'o4-mini' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash' },
];

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

async function findSpecCollectionUrl(
  repo: Repo,
  wsHandle: DocHandle<WorkspaceDoc>,
): Promise<AutomergeUrl | undefined> {
  const wsDoc = await wsHandle.doc();
  if (!wsDoc?.documents) return undefined;

  for (const [, entry] of Object.entries(wsDoc.documents)) {
    const handle = await repo.find((entry as DocumentEntry).cloneUrl);
    const d = await handle.doc();
    if ((d as any)?.['@patchwork']?.type === 'spec') {
      return (entry as DocumentEntry).cloneUrl;
    }
  }
  return undefined;
}

export const WorkspaceChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <WorkspaceChatView handle={handle as DocHandle<WorkspaceChatDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function WorkspaceChatView(props: { handle: DocHandle<WorkspaceChatDoc> }) {
  const [doc] = useDocument<WorkspaceChatDoc>(() => props.handle.url);
  const repo = useRepo();
  const [prompt, setPrompt] = createSignal('');
  const [selectedModel, setSelectedModel] = createSignal(DEFAULT_MODEL);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<'chat' | 'prompt' | 'workspace'>('chat');
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);

  const [processDoc] = useDocument<LLMProcessDoc>(() => doc()?.llmProcessUrl);

  const hasSpec = () => !!doc()?.specCollectionDocUrl;
  const isRunning = () => !!doc()?.llmProcessUrl && processDoc() !== undefined && !processDoc()!.done;

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;
    if (!doc()) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsSubmitting(true);
    try {
      const wsHandle = repo.create<WorkspaceDoc>();
      wsHandle.change((d) => {
        d.documents = {};
      });

      const processHandle = repo.create<LLMProcessDoc>();
      processHandle.change((d) => {
        d.config = {
          apiUrl: 'https://openrouter.ai/api/v1',
          model: selectedModel(),
        };
        d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
        d.workspaceUrl = wsHandle.url;
        d.messages = [{ role: 'user', content: [{ type: 'text', text }] }];
        d.done = false;
      });

      props.handle.change((d) => {
        d.prompt = text;
        d.llmProcessUrl = processHandle.url;
        delete d.specCollectionDocUrl;
      });

      setPrompt('');

      await runWorkspaceLLM(repo, processHandle.url, controller.signal);

      const specUrl = await findSpecCollectionUrl(repo, wsHandle);
      if (specUrl) {
        props.handle.change((d) => {
          d.specCollectionDocUrl = specUrl;
        });
      }
    } finally {
      setAbortController(null);
      setIsSubmitting(false);
    }
  }

  async function handleChangeSpec() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;

    const currentDoc = doc();
    if (!currentDoc?.llmProcessUrl) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsSubmitting(true);
    setEditing(false);
    try {
      const oldProcessHandle = await repo.find<LLMProcessDoc>(currentDoc.llmProcessUrl);
      const oldProcess = await oldProcessHandle.doc();
      if (!oldProcess) return;

      const wsHandle = await repo.find<WorkspaceDoc>(oldProcess.workspaceUrl);

      const prevMessages = JSON.parse(JSON.stringify(oldProcess.messages)) as ChatMessage[];

      const processHandle = repo.create<LLMProcessDoc>();
      processHandle.change((d) => {
        d.config = {
          apiUrl: 'https://openrouter.ai/api/v1',
          model: selectedModel(),
        };
        d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
        d.workspaceUrl = oldProcess.workspaceUrl;
        d.messages = [
          ...prevMessages,
          { role: 'user', content: [{ type: 'text', text }] },
        ];
        d.done = false;
      });

      props.handle.change((d) => {
        d.llmProcessUrl = processHandle.url;
        delete d.specCollectionDocUrl;
      });

      setPrompt('');

      await runWorkspaceLLM(repo, processHandle.url, controller.signal);

      const specUrl = await findSpecCollectionUrl(repo, wsHandle);
      if (specUrl) {
        props.handle.change((d) => {
          d.specCollectionDocUrl = specUrl;
        });
      }
    } finally {
      setAbortController(null);
      setIsSubmitting(false);
    }
  }

  function handleStop() {
    abortController()?.abort();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (hasSpec() && editing()) handleChangeSpec();
      else if (!hasSpec() && !isRunning()) handleSubmit();
    }
  }

  return (
    <div class="ws-chat-root">
      <div class="ws-chat-tabs">
        <button
          class={`ws-chat-tab${activeTab() === 'chat' ? ' active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        <button
          class={`ws-chat-tab${activeTab() === 'prompt' ? ' active' : ''}`}
          onClick={() => setActiveTab('prompt')}
        >
          Prompt
        </button>
        <button
          class={`ws-chat-tab${activeTab() === 'workspace' ? ' active' : ''}`}
          onClick={() => setActiveTab('workspace')}
        >
          Workspace
        </button>
      </div>

      <Show when={doc()}>
        {(currentDoc) => (
          <>
            <Show when={activeTab() === 'chat'}>
              <Show when={!hasSpec() || isRunning()}>
                <div class="ws-chat-input-bar">
                  <div class="ws-chat-input-top">
                    <select
                      class="ws-chat-model-select"
                      value={selectedModel()}
                      onChange={(e) => setSelectedModel(e.currentTarget.value)}
                      disabled={isSubmitting() || isRunning()}
                    >
                      <For each={MODELS}>
                        {(m) => <option value={m.id}>{m.name}</option>}
                      </For>
                    </select>
                  </div>
                  <div class="ws-chat-input-row">
                    <textarea
                      class="ws-chat-textarea"
                      placeholder="I want… (⌘↵ to send)"
                      value={prompt()}
                      onInput={(e) => setPrompt(e.currentTarget.value)}
                      onKeyDown={handleKeyDown}
                      disabled={isSubmitting() || isRunning()}
                      rows={3}
                    />
                    <Show
                      when={isRunning()}
                      fallback={
                        <button
                          class="ws-chat-send-btn"
                          onClick={handleSubmit}
                          disabled={isSubmitting() || !prompt().trim()}
                        >
                          {isSubmitting() ? 'Running…' : 'Send'}
                        </button>
                      }
                    >
                      <button class="ws-chat-stop-btn" onClick={handleStop}>
                        Stop
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>

              <Show when={isRunning() && currentDoc().llmProcessUrl}>
                {(processUrl) => <LLMProcessView url={processUrl()} />}
              </Show>

              <Show when={!isRunning() && hasSpec() && currentDoc().specCollectionDocUrl}>
                {(specUrl) => (
                  <>
                    <div class="ws-spec-view">
                      <patchwork-view
                        attr:doc-url={specUrl()}
                        style="display:block;width:100%;height:100%;"
                      />
                    </div>

                    <Show
                      when={editing()}
                      fallback={
                        <div class="ws-spec-actions">
                          <button
                            class="ws-spec-btn ws-spec-btn-change"
                            onClick={() => setEditing(true)}
                          >
                            Change Spec
                          </button>
                          <button class="ws-spec-btn ws-spec-btn-plan" disabled>
                            Turn into plan
                          </button>
                        </div>
                      }
                    >
                      <div class="ws-spec-edit">
                        <div class="ws-spec-edit-label">Change spec</div>
                        <div class="ws-spec-edit-row">
                          <textarea
                            class="ws-chat-textarea"
                            placeholder="Describe what to change… (⌘↵ to send)"
                            value={prompt()}
                            onInput={(e) => setPrompt(e.currentTarget.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isSubmitting()}
                            rows={3}
                          />
                          <button
                            class="ws-chat-send-btn"
                            onClick={handleChangeSpec}
                            disabled={isSubmitting() || !prompt().trim()}
                          >
                            {isSubmitting() ? 'Running…' : 'Send'}
                          </button>
                        </div>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </Show>

            <Show when={activeTab() === 'prompt'}>
              <PromptDebugView processUrl={currentDoc().llmProcessUrl} />
            </Show>

            <Show when={activeTab() === 'workspace'}>
              <WorkspaceDocumentsView processUrl={currentDoc().llmProcessUrl} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function PromptDebugView(props: { processUrl?: AutomergeUrl }) {
  const repo = useRepo();
  const configFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);

  const [systemPrompt, { refetch }] = createResource(
    () => processDoc()?.workspaceUrl,
    (wsUrl) => buildFullSystemPrompt(repo, configFolderUrl, wsUrl),
  );

  return (
    <div class="ws-chat-prompt-debug">
      <div class="ws-chat-prompt-debug-header">
        <span>System Prompt Preview</span>
        <button class="ws-chat-prompt-refresh-btn" onClick={refetch}>
          Refresh
        </button>
      </div>
      <Show when={!props.processUrl}>
        <div class="ws-chat-prompt-debug-loading">No LLM process yet — send a message first.</div>
      </Show>
      <Show when={systemPrompt.loading}>
        <div class="ws-chat-prompt-debug-loading">Loading prompt…</div>
      </Show>
      <Show when={systemPrompt()}>
        {(text) => (
          <pre class="ws-chat-prompt-debug-content">{text()}</pre>
        )}
      </Show>
      <Show when={systemPrompt.error}>
        <div class="ws-chat-prompt-debug-error">
          Error: {String(systemPrompt.error)}
        </div>
      </Show>
    </div>
  );
}

function WorkspaceDocumentsView(props: { processUrl?: AutomergeUrl }) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  const workspaceUrl = () => processDoc()?.workspaceUrl;
  const [wsDoc] = useDocument<WorkspaceDoc>(() => workspaceUrl());

  return (
    <div class="ws-workspace-view">
      <Show
        when={wsDoc()}
        fallback={
          <div class="ws-workspace-empty">
            {props.processUrl ? 'Loading workspace…' : 'No workspace yet — send a message first.'}
          </div>
        }
      >
        {(ws) => {
          const entries = () => Object.entries(ws().documents ?? {});
          return (
            <Show
              when={entries().length > 0}
              fallback={
                <div class="ws-workspace-empty">
                  No documents in the workspace yet.
                </div>
              }
            >
              <div class="ws-workspace-docs">
                <For each={entries()}>
                  {([originalUrl, info]) => (
                    <div class="ws-workspace-doc-card">
                      <div class="ws-workspace-doc-header">{(info as DocumentEntry).cloneUrl}</div>
                      <div class="ws-workspace-doc-body">
                        <patchwork-view
                          attr:doc-url={(info as DocumentEntry).cloneUrl}
                          style="display:block;width:100%;height:100%;"
                        />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          );
        }}
      </Show>
    </div>
  );
}

function LLMProcessView(props: { url: AutomergeUrl }) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.url);
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
  }

  createEffect(() => {
    const doc = processDoc();
    if (!doc) return;
    if (isAtBottom && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  return (
    <div class="ws-chat-messages" ref={containerRef} onScroll={handleScroll}>
      <Show when={processDoc()}>
        {(pDoc) => (
          <>
            <For each={pDoc().messages}>
              {(msg) => <MessageView message={msg} />}
            </For>
            <Show when={!pDoc().done}>
              <div class="ws-chat-thinking">
                <div class="ws-chat-thinking-dot" />
                <div class="ws-chat-thinking-dot" />
                <div class="ws-chat-thinking-dot" />
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function MessageView(props: { message: ChatMessage }) {
  const roleClass = () => {
    switch (props.message.role) {
      case 'user': return 'ws-chat-msg ws-chat-msg-user';
      case 'assistant': return 'ws-chat-msg ws-chat-msg-assistant';
      case 'system': return 'ws-chat-msg ws-chat-msg-system';
      default: return 'ws-chat-msg';
    }
  };

  return (
    <div class={roleClass()}>
      <For each={props.message.content}>
        {(part) => <PartView part={part} />}
      </For>
    </div>
  );
}

function PartView(props: { part: ChatMessagePart }) {
  return (
    <Show
      when={props.part.type === 'script' ? props.part : undefined}
      fallback={
        <Show when={props.part.type === 'text' ? props.part : undefined}>
          {(textPart) => <span>{textPart().text}</span>}
        </Show>
      }
    >
      {(scriptPart) => (
        <div class="ws-chat-script">
          <Show when={scriptPart().description}>
            {(desc) => <div class="ws-chat-script-header">{desc()}</div>}
          </Show>
          <div class="ws-chat-script-code">{scriptPart().code}</div>
          <Show when={scriptPart().output !== undefined}>
            <div class="ws-chat-script-output">{scriptPart().output}</div>
          </Show>
          <Show when={scriptPart().error !== undefined}>
            <div class="ws-chat-script-error">{scriptPart().error}</div>
          </Show>
        </div>
      )}
    </Show>
  );
}
