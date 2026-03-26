import { render } from 'solid-js/web';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import { updateText } from '@automerge/automerge-repo';
import type { ToolRender, DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import { SolidMarkdown } from 'solid-markdown';

import type { ChatMessage, EditableChatDoc, EditableChatMessage } from './types';
import './chat.css';

// ─── Model list ───────────────────────────────────────────────────────────────

const MODELS: { label: string; value: string }[] = [
  // High-end
  { label: 'Claude Opus 4.6', value: 'anthropic/claude-opus-4.6' },
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4.6' },
  { label: 'GPT-5.4', value: 'openai/gpt-5.4' },
  { label: 'Gemini 3.1 Pro', value: 'google/gemini-3.1-pro-preview' },
  { label: 'Grok 4.1 Fast', value: 'x-ai/grok-4.1-fast' },
  { label: 'DeepSeek V3.2', value: 'deepseek/deepseek-v3.2' },
  // Mid-tier
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4.5' },
  { label: 'GPT-5.4 Mini', value: 'openai/gpt-5.4-mini' },
  { label: 'Gemini 3 Flash', value: 'google/gemini-3-flash-preview' },
  { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash' },
  { label: 'Mistral Small 4', value: 'mistralai/mistral-small-2603' },
  // Low-tier
  { label: 'GPT-5.4 Nano', value: 'openai/gpt-5.4-nano' },
  { label: 'Gemini 2.5 Flash Lite', value: 'google/gemini-2.5-flash-lite' },
  { label: 'Claude 3.5 Haiku', value: 'anthropic/claude-3.5-haiku' },
  { label: 'Nemotron Super (free)', value: 'nvidia/nemotron-3-super-120b-a12b:free' },
];

// ─── Datatype ─────────────────────────────────────────────────────────────────

export const EditableChatDatatype: DatatypeImplementation<EditableChatDoc> = {
  init(doc) {
    doc['@patchwork'] = { type: 'editable-llm-chat' };
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4.6',
    };
    doc.messages = [];
  },

  getTitle() {
    return 'Editable Chat';
  },
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export const EditableChatTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <EditableChatView handle={handle as DocHandle<EditableChatDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Main view ────────────────────────────────────────────────────────────────

function EditableChatView(props: { handle: DocHandle<EditableChatDoc> }) {
  const [doc] = useDocument<EditableChatDoc>(() => props.handle.url);
  const [prompt, setPrompt] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;

  createEffect(() => {
    doc()?.messages;
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  });

  async function handleSubmit() {
    const text = prompt().trim();
    if (!text || isSubmitting()) return;

    const currentDoc = doc();
    if (!currentDoc) return;

    setIsSubmitting(true);
    setPrompt('');

    // Snapshot context from current stored messages (captures any user edits)
    const context: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...currentDoc.messages
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
      { role: 'user', content: text },
    ];

    // Append the user message and an empty streaming assistant placeholder
    const assistantIdx = currentDoc.messages.length + 1;
    props.handle.change((d) => {
      d.messages.push({ role: 'user', content: text });
      d.messages.push({ role: 'assistant', content: '', isStreaming: true });
    });

    try {
      await streamToMessage(props.handle, assistantIdx, currentDoc.config, context);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      props.handle.change((d) => {
        updateText(d, ['messages', assistantIdx, 'content'], `Error: ${errMsg}`);
      });
    } finally {
      props.handle.change((d) => {
        d.messages[assistantIdx].isStreaming = false;
      });
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
      fallback={<div class="ec-root"><div class="ec-loading">Loading…</div></div>}
    >
      {(currentDoc) => (
        <div class="ec-root">
          <div class="ec-messages">
            <Show
              when={currentDoc().messages.length > 0}
              fallback={<div class="ec-empty">Start a conversation below.</div>}
            >
              <For each={currentDoc().messages}>
                {(msg, idx) => (
                  <MessageView message={msg} index={idx()} handle={props.handle} />
                )}
              </For>
            </Show>
            <div ref={messagesEndRef} />
          </div>

          <div class="ec-input-bar">
            <div class="ec-input-toolbar">
              <select
                class="ec-model-select"
                value={currentDoc().config.model}
                onChange={(e) => {
                  props.handle.change((d) => {
                    d.config.model = e.currentTarget.value;
                  });
                }}
              >
                <For each={MODELS}>
                  {(m) => (
                    <option value={m.value}>{m.label}</option>
                  )}
                </For>
                <Show when={!MODELS.some((m) => m.value === currentDoc().config.model)}>
                  <option value={currentDoc().config.model}>{currentDoc().config.model}</option>
                </Show>
              </select>
            </div>
            <div class="ec-input-row">
              <textarea
                class="ec-input-textarea"
                placeholder="Enter a prompt… (⌘↵ to send)"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting()}
                rows={3}
              />
              <button
                class="ec-send-btn"
                onClick={handleSubmit}
                disabled={isSubmitting() || !prompt().trim()}
              >
                {isSubmitting() ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

// ─── Message view ─────────────────────────────────────────────────────────────

function MessageView(props: {
  message: EditableChatMessage;
  index: number;
  handle: DocHandle<EditableChatDoc>;
}) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');
  const isAssistant = () => props.message.role === 'assistant';
  const canEdit = () => isAssistant() && !props.message.isStreaming;

  function startEdit() {
    if (!canEdit()) return;
    setEditValue(props.message.content);
    setIsEditing(true);
  }

  function commitEdit() {
    props.handle.change((d) => {
      updateText(d, ['messages', props.index, 'content'], editValue());
    });
    setIsEditing(false);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  function handleEditKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
  }

  return (
    <div class={`ec-message ec-message-${props.message.role}`}>
      <div class="ec-message-header">
        <span class="ec-message-role">{isAssistant() ? 'Assistant' : 'You'}</span>
        <Show when={canEdit() && !isEditing()}>
          <button class="ec-edit-btn" onClick={startEdit} title="Edit response">
            Edit
          </button>
        </Show>
        <Show when={isEditing()}>
          <span class="ec-edit-hint">⌘↵ save · Esc cancel</span>
        </Show>
      </div>

      <Show
        when={isEditing()}
        fallback={
          <div
            class={`ec-message-body${canEdit() ? ' ec-message-body--editable' : ''}`}
            onClick={startEdit}
          >
            <Show
              when={isAssistant()}
              fallback={<div class="ec-user-text">{props.message.content}</div>}
            >
              <Show
                when={props.message.content}
                fallback={
                  <Show when={props.message.isStreaming}>
                    <span class="ec-thinking">Thinking…</span>
                  </Show>
                }
              >
                <div class="ec-markdown">
                  <SolidMarkdown>{props.message.content}</SolidMarkdown>
                </div>
              </Show>
              <Show when={props.message.isStreaming}>
                <span class="ec-cursor" />
              </Show>
            </Show>
          </div>
        }
      >
        <textarea
          class="ec-edit-textarea"
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleEditKeyDown}
          ref={(el) => requestAnimationFrame(() => el.focus())}
        />
        <div class="ec-edit-actions">
          <button class="ec-save-btn" onClick={commitEdit}>Save</button>
          <button class="ec-cancel-btn" onClick={cancelEdit}>Cancel</button>
        </div>
      </Show>
    </div>
  );
}

// ─── LLM streaming ────────────────────────────────────────────────────────────

async function streamToMessage(
  handle: DocHandle<EditableChatDoc>,
  msgIdx: number,
  config: EditableChatDoc['config'],
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<void> {
  let accumulated = '';
  for await (const chunk of streamChatCompletion(config.apiUrl, config.model, messages, signal)) {
    accumulated += chunk;
    handle.change((d) => {
      updateText(d, ['messages', msgIdx, 'content'], accumulated);
    });
  }
}

async function* streamChatCompletion(
  apiUrl: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${apiUrl.replace(/\/$/, '')}/chat/completions`;
  const apiKey = (import.meta as any).env?.VITE_OPENAI_API_KEY ?? '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'HTTP-Referer': globalThis.location?.origin ?? 'http://localhost',
      'X-Title': 'Patchwork',
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
