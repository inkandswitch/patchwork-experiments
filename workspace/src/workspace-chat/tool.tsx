import { render } from 'solid-js/web';
import { createSignal, For, Show, createEffect } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';

import type { WorkspaceChatDoc, WorkspaceDoc, DocumentEntry } from '../types';
import type { LLMProcessDoc, ChatMessagePart } from '../llm/types';
import { runWorkspaceLLM } from '../llm/llm-process';
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

type Stage = 'spec' | 'plan' | 'artifact';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'spec', label: 'Spec' },
  { id: 'plan', label: 'Plan' },
  { id: 'artifact', label: 'Artifact' },
];

async function findDocUrlByType(
  repo: Repo,
  wsHandle: DocHandle<WorkspaceDoc>,
  patchworkType: string,
): Promise<AutomergeUrl | undefined> {
  const wsDoc = await wsHandle.doc();
  if (!wsDoc?.documents) return undefined;

  for (const [, entry] of Object.entries(wsDoc.documents)) {
    const handle = await repo.find((entry as DocumentEntry).cloneUrl);
    const d = await handle.doc();
    if ((d as any)?.['@patchwork']?.type === patchworkType) {
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
  const [stage, setStage] = createSignal<Stage>('spec');
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);

  const [processDoc] = useDocument<LLMProcessDoc>(() => doc()?.llmProcessUrl);

  const hasSpec = () => !!doc()?.specCollectionDocUrl;
  const hasPlan = () => !!doc()?.planDocUrl;
  const isRunning = () => !!doc()?.llmProcessUrl && processDoc() !== undefined && !processDoc()!.done;

  function stageState(id: Stage): 'active' | 'completed' | 'future' {
    const current = stage();
    if (id === current) return 'active';
    if (id === 'spec' && hasSpec()) return 'completed';
    if (id === 'plan' && hasPlan()) return 'completed';
    return 'future';
  }

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

      const specUrl = await findDocUrlByType(repo, wsHandle, 'spec');
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

  async function handleTurnIntoPlan() {
    const currentDoc = doc();
    if (!currentDoc?.specCollectionDocUrl || !currentDoc?.llmProcessUrl) return;
    if (isSubmitting()) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsSubmitting(true);
    try {
      const oldProcessHandle = await repo.find<LLMProcessDoc>(currentDoc.llmProcessUrl);
      const oldProcess = await oldProcessHandle.doc();
      if (!oldProcess) return;

      const wsHandle = await repo.find<WorkspaceDoc>(oldProcess.workspaceUrl);

      const processHandle = repo.create<LLMProcessDoc>();
      processHandle.change((d) => {
        d.config = {
          apiUrl: 'https://openrouter.ai/api/v1',
          model: selectedModel(),
        };
        d.llmConfigFolderUrl = __PLAN_AGENT_FOLDER_URL__ as AutomergeUrl;
        d.workspaceUrl = oldProcess.workspaceUrl;
        d.messages = [{
          role: 'user',
          content: [{
            type: 'text',
            text: `Create a plan from the spec collection at: ${currentDoc.specCollectionDocUrl}`,
          }],
        }];
        d.done = false;
      });

      props.handle.change((d) => {
        d.llmProcessUrl = processHandle.url;
        delete d.planDocUrl;
      });

      await runWorkspaceLLM(repo, processHandle.url, controller.signal);

      const planUrl = await findDocUrlByType(repo, wsHandle, 'plan');
      if (planUrl) {
        props.handle.change((d) => {
          d.planDocUrl = planUrl;
        });
        setStage('plan');
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
      if (!hasSpec() && !isRunning()) handleSubmit();
    }
  }

  return (
    <div class="ws-chat-root">
      <Show when={hasSpec()}>
        <div class="ws-stage-bar">
          <For each={STAGES}>
            {(s, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="ws-stage-chevron">{'>'}</span>
                </Show>
                <button
                  class={`ws-stage-item ${stageState(s.id)}`}
                  onClick={() => {
                    const state = stageState(s.id);
                    if (state === 'completed' || state === 'active') setStage(s.id);
                  }}
                  disabled={stageState(s.id) === 'future'}
                >
                  {s.label}
                </button>
              </>
            )}
          </For>
        </div>
      </Show>

      <Show when={doc()}>
        {(currentDoc) => (
          <>
            <Show when={!hasSpec()}>
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

            <Show when={!isRunning() && hasSpec()}>
              <Show when={stage() === 'spec' && currentDoc().specCollectionDocUrl}>
                {(specUrl) => (
                  <>
                    <div class="ws-spec-view">
                      <patchwork-view
                        attr:doc-url={specUrl()}
                        style="display:block;width:100%;height:100%;"
                      />
                    </div>
                    <div class="ws-spec-actions">
                      <button
                        class="ws-spec-btn ws-spec-btn-plan"
                        onClick={handleTurnIntoPlan}
                        disabled={isSubmitting() || hasPlan()}
                      >
                        {hasPlan() ? 'Plan created' : 'Turn into plan'}
                      </button>
                    </div>
                  </>
                )}
              </Show>

              <Show when={stage() === 'plan' && currentDoc().planDocUrl}>
                {(planUrl) => (
                  <div class="ws-spec-view">
                    <patchwork-view
                      attr:doc-url={planUrl()}
                      style="display:block;width:100%;height:100%;"
                    />
                  </div>
                )}
              </Show>

              <Show when={stage() === 'artifact'}>
                <div class="ws-stage-placeholder">
                  Artifact execution is not yet implemented.
                </div>
              </Show>
            </Show>
          </>
        )}
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

function MessageView(props: { message: { role: string; content: ChatMessagePart[] } }) {
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
