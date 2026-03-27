import { render } from 'solid-js/web';
import { createSignal, For, Show, onCleanup, createEffect } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';

import type { WorkspaceChatDoc } from '../types';
import type { LLMProcessDoc, ChatMessage, ChatMessagePart } from '../llm/types';
import { runWorkspaceLLM } from '../llm/llm-process';
import './chat.css';

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
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;

    const currentDoc = doc();
    if (!currentDoc) return;

    setIsSubmitting(true);
    try {
      const processHandle = repo.create<LLMProcessDoc>();
      processHandle.change((d) => {
        d.config = {
          apiUrl: 'https://openrouter.ai/api/v1',
          model: 'anthropic/claude-opus-4-5',
        };
        d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
        d.workspaceUrl = currentDoc.workspaceUrl;
        d.messages = [{ role: 'user', content: [{ type: 'text', text }] }];
        d.done = false;
      });

      props.handle.change((d) => {
        d.prompt = text;
        d.llmProcessUrl = processHandle.url;
      });

      setPrompt('');

      await runWorkspaceLLM(repo, processHandle.url);
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
    <div class="ws-chat-root">
      <Show when={doc()}>
        {(currentDoc) => (
          <>
            <Show
              when={currentDoc().llmProcessUrl}
              fallback={
                <div class="ws-chat-empty">
                  Describe the spec you want to create.
                </div>
              }
            >
              {(processUrl) => (
                <LLMProcessView url={processUrl()} scrollAnchor={messagesEndRef} />
              )}
            </Show>

            <div class="ws-chat-input-bar">
              <textarea
                class="ws-chat-textarea"
                placeholder="Describe your spec… (⌘↵ to send)"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting() || !!currentDoc().llmProcessUrl}
                rows={2}
              />
              <button
                class="ws-chat-send-btn"
                onClick={handleSubmit}
                disabled={isSubmitting() || !prompt().trim() || !!currentDoc().llmProcessUrl}
              >
                {isSubmitting() ? 'Running…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function LLMProcessView(props: { url: AutomergeUrl; scrollAnchor?: HTMLDivElement }) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.url);
  let containerRef: HTMLDivElement | undefined;

  createEffect(() => {
    const doc = processDoc();
    if (!doc) return;
    // Scroll to bottom on message changes
    if (containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  return (
    <div class="ws-chat-messages" ref={containerRef}>
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
