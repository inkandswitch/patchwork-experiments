// The Editable Chat tool: a conversation with a model whose replies the
// person can edit. Each reply is written into the chat by work done through
// the task system (replies.js, generate-task.js); this view draws the chat
// and what replies.js says of each reply, and writes nothing itself but the
// chosen model.

import { render } from 'solid-js/web';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo } from '@automerge/automerge-repo';
import { SolidMarkdown } from 'solid-markdown';

import type { EditableChatDoc, EditableChatMessage } from './types';
import { chatReplies } from './replies.js';
import { workLines } from './reply-status.js';
import './chat.css';

// The provider's key, given when the package is built. It goes into each reply's task input.
const API_KEY: string = (import.meta as any).env?.VITE_OPENAI_API_KEY ?? '';

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
        <EditableChatView handle={handle as DocHandle<EditableChatDoc>} repo={element.repo} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

type Replies = ReturnType<typeof chatReplies>;

// ─── Main view ────────────────────────────────────────────────────────────────

function EditableChatView(props: { handle: DocHandle<EditableChatDoc>; repo: Repo }) {
  const [doc] = useDocument<EditableChatDoc>(() => props.handle.url);
  const [prompt, setPrompt] = createSignal('');
  // bumped whenever replies.js says what it shows has changed
  const [version, setVersion] = createSignal(0);
  const replies = chatReplies(props.handle, props.repo, { apiKey: API_KEY, onChange: () => setVersion((v) => v + 1) });
  onCleanup(() => replies.dispose());
  const busy = () => (version(), doc(), replies.busy());
  let messagesEndRef: HTMLDivElement | undefined;

  createEffect(() => {
    doc()?.messages;
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
  });

  function handleSubmit() {
    if (replies.send(prompt())) setPrompt('');
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
                {(msg) => <MessageView message={msg} replies={replies} version={version} />}
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
                rows={3}
              />
              <button
                class="ec-send-btn"
                onClick={handleSubmit}
                disabled={busy() || !prompt().trim()}
                title={busy() ? 'A reply is being written' : undefined}
              >
                {busy() ? 'Replying…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

// ─── Message view ─────────────────────────────────────────────────────────────

function MessageView(props: { message: EditableChatMessage; replies: Replies; version: () => number }) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');
  // the chat's heads the edited text was read at, so that saving changes that text and no later one
  let editFrom: unknown;
  const isAssistant = () => props.message.role === 'assistant';
  const shown = () => (props.version(), props.message.content, props.message.ended, props.replies.shown(props.message));
  const canEdit = () => !!shown()?.editable;
  const streaming = () => shown()?.status === 'streaming' || shown()?.status === 'looking';

  function startEdit() {
    if (!canEdit()) return;
    const { text, at } = props.replies.opened(props.message.id);
    editFrom = at;
    setEditValue(text);
    setIsEditing(true);
  }

  function commitEdit() {
    props.replies.edit(props.message.id, editValue(), editFrom);
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

  const statusLine = () => {
    const s = shown();
    if (!s || s.status === 'finished') return null;
    if (s.status === 'streaming') {
      const { stage, where } = workLines(s.work);
      return [stage, where].filter(Boolean).join(' ') || null;
    }
    return s.line ?? null;
  };

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
                  <Show when={streaming()}>
                    <span class="ec-thinking">Thinking…</span>
                  </Show>
                }
              >
                <div class="ec-markdown">
                  <SolidMarkdown>{props.message.content}</SolidMarkdown>
                </div>
              </Show>
              <Show when={streaming()}>
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

      <Show when={statusLine() || shown()?.stoppable || shown()?.retry}>
        <div class="ec-reply-status" data-status={shown()?.status}>
          <Show when={statusLine()}>
            <span>{statusLine()}</span>
          </Show>
          <Show when={shown()?.stoppable && shown()?.work?.state !== 'stopping'}>
            <button class="ec-reply-btn" onClick={() => props.replies.stop(props.message.id)}>Stop</button>
          </Show>
          <Show when={shown()?.retry}>
            <button class="ec-reply-btn" onClick={() => props.replies.tryAgain(props.message.id)}>Try again</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
