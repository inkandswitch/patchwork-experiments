import { render } from 'solid-js/web';
import { Show, createSignal, For, createEffect, createMemo } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import { SolidMarkdown } from 'solid-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { WorkflowDoc, ValidationDoc, SpecElicitationDoc } from './types';
import type { LLMProcessDoc, ChatMessagePart } from '../llm/types';
import type { PetriNetPlanDoc, PetriNetExecutionDoc } from '../paul/petrinet-plan/types';
import { runWorkspaceLLM } from '../llm/llm-process';
import './workflow.css';

type Stage = 'elicitation' | 'spec' | 'plan' | 'execution' | 'validation';

const WORKFLOW_VERSION = '0.4.4';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function findUrlInMessages(
  messages: LLMProcessDoc['messages'],
  pattern: RegExp,
): AutomergeUrl | undefined {
  let found: AutomergeUrl | undefined;
  for (const msg of messages ?? []) {
    for (const part of msg.content) {
      const candidates: (string | undefined)[] =
        part.type === 'script'
          ? [
              'output' in part ? (part.output as string | undefined) : undefined,
              'error' in part ? (part.error as string | undefined) : undefined,
              part.code,
            ]
          : part.type === 'text'
          ? [(part as { type: 'text'; text: string }).text]
          : [];
      for (const str of candidates) {
        if (typeof str !== 'string') continue;
        const m = str.match(pattern);
        if (m) found = m[1] as AutomergeUrl;
      }
    }
  }
  return found;
}

export const WorkflowTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <WorkflowView handle={handle as DocHandle<WorkflowDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function WorkflowView(props: { handle: DocHandle<WorkflowDoc> }) {
  const [doc] = useDocument<WorkflowDoc>(() => props.handle.url);
  const [executionDoc] = useDocument<PetriNetExecutionDoc>(() => doc()?.executionDocUrl);
  const [selectedStage, setSelectedStage] = createSignal<Stage>('elicitation');
  const repo = useRepo();

  const isExecutionRunning = () => {
    const exec = executionDoc();
    if (!exec?.tokens) return false;
    const llmTokens = exec.tokens.llm ?? [];
    return llmTokens.length > 0;
  };

  function hasDocForStage(stage: Stage): boolean {
    const d = doc();
    if (!d) return false;
    switch (stage) {
      case 'elicitation': return !!d.specElicitationDocUrl;
      case 'spec':        return !!(d.specProcessUrl || d.specDocUrl);
      case 'plan':        return !!(d.planDocUrl || d.planProcessUrl);
      case 'execution':   return !!d.executionDocUrl;
      case 'validation':  return !!d.validationDocUrl;
    }
  }

  function getStageUrl(): AutomergeUrl | undefined {
    const currentDoc = doc();
    if (!currentDoc) return undefined;

    switch (selectedStage()) {
      case 'elicitation': return currentDoc.specElicitationDocUrl;
      case 'spec':        return currentDoc.specDocUrl;
      case 'plan':        return currentDoc.planDocUrl;
      case 'execution':   return currentDoc.executionDocUrl;
      case 'validation':  return currentDoc.validationDocUrl;
    }
  }

  function getStageToolId(): string | undefined {
    return doc()?.toolIds?.[selectedStage()];
  }

  async function handleGenerateSpec() {
    const currentDoc = doc();
    if (!currentDoc?.specElicitationDocUrl) return;

    const elicitHandle = await repo.find<SpecElicitationDoc>(currentDoc.specElicitationDocUrl);
    const elicitDoc = await elicitHandle.doc();
    const prompt = elicitDoc?.prompt?.trim() ?? '';

    // Include any reference documents from the elicitation folder
    let docsContext = '';
    if (elicitDoc?.referenceDocsFolderUrl) {
      const folderHandle = await repo.find(elicitDoc.referenceDocsFolderUrl);
      const folderDoc = await folderHandle.doc() as any;
      for (const entry of (folderDoc?.docs ?? []) as { name: string; url: AutomergeUrl }[]) {
        const h = await repo.find(entry.url);
        const d = await h.doc() as any;
        const content = typeof d?.content === 'string' ? d.content
          : d?.content instanceof Uint8Array ? new TextDecoder().decode(d.content)
          : JSON.stringify(d, null, 2);
        docsContext += `\n\n### ${entry.name}\n${content}`;
      }
    }

    const userMessage = (prompt || 'Generate a spec.') + docsContext;

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }];
      d.done = false;
    });

    props.handle.change((d) => {
      d.specProcessUrl = processHandle.url;
      delete (d as any).specDocUrl;
    });

    setSelectedStage('spec');

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const rootSpecUrl = findUrlInMessages(processDoc?.messages, /ROOT_SPEC_URL:\s*(automerge:[A-Za-z0-9]+)/);

    if (rootSpecUrl) {
      props.handle.change((d) => {
        d.specDocUrl = rootSpecUrl!;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.spec = 'paul-spec-viewer';
      });
    }
  }

  async function handleFollowUpSpec(message: string) {
    const currentDoc = doc();
    if (!currentDoc?.specProcessUrl) return;

    const prevProcessHandle = await repo.find<LLMProcessDoc>(currentDoc.specProcessUrl);
    const prevProcessDoc = await prevProcessHandle.doc();
    const previousMessages = prevProcessDoc?.messages ?? [];

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [
        ...JSON.parse(JSON.stringify(previousMessages)),
        { role: 'user', content: [{ type: 'text', text: message }] },
      ];
      d.done = false;
    });

    props.handle.change((d) => {
      d.specProcessUrl = processHandle.url;
    });

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const rootSpecUrl = findUrlInMessages(processDoc?.messages, /ROOT_SPEC_URL:\s*(automerge:[A-Za-z0-9]+)/);

    if (rootSpecUrl) {
      props.handle.change((d) => {
        d.specDocUrl = rootSpecUrl!;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.spec = 'paul-spec-viewer';
      });
    }
  }

  async function handleCreatePlan() {
    const currentDoc = doc();
    if (!currentDoc?.specDocUrl) return;

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __PLAN_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [{ role: 'user', content: [{ type: 'text', text: `Create a plan for this spec: ${currentDoc.specDocUrl}` }] }];
      d.done = false;
    });

    props.handle.change((d) => {
      d.planProcessUrl = processHandle.url;
      delete (d as any).planDocUrl;
    });

    setSelectedStage('plan');

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const planDocUrl = findUrlInMessages(processDoc?.messages, /PLAN_DOC_URL:\s*(automerge:[A-Za-z0-9]+)/);

    if (planDocUrl) {
      props.handle.change((d) => {
        d.planDocUrl = planDocUrl!;
      });
    }
  }

  async function handleExecutePlan() {
    const currentDoc = doc();
    if (!currentDoc?.planDocUrl) return;

    const planHandle = await repo.find<PetriNetPlanDoc>(currentDoc.planDocUrl);
    const planDoc = planHandle.doc();
    if (!planDoc) return;

    const execHandle = repo.create<PetriNetExecutionDoc>();
    execHandle.change((d) => {
      d['@patchwork'] = { type: 'petrinet-execution' };
      d.planUrl = currentDoc.planDocUrl!;
      d.tokens = {};
      for (const init of planDoc.initialTokens ?? []) {
        if (!d.tokens[init.placeId]) d.tokens[init.placeId] = [];
        d.tokens[init.placeId].push({
          id: makeId(),
          state: JSON.parse(JSON.stringify(init.state)),
        });
      }
    });

    const validationHandle = currentDoc.validationDocUrl
      ? await repo.find<ValidationDoc>(currentDoc.validationDocUrl)
      : repo.create<ValidationDoc>();

    validationHandle.change((d) => {
      d['@patchwork'] = { type: 'validation' };
      d.planDocUrl = currentDoc.planDocUrl!;
      d.specDocUrl = currentDoc.specDocUrl!;
      d.executionDocUrl = execHandle.url;
      d.isValidated = false;
      d.headsByDocUrl = {} as Record<AutomergeUrl, never>;
    });

    props.handle.change((d) => {
      d.executionDocUrl = execHandle.url;
      d.validationDocUrl = validationHandle.url;
    });

    setSelectedStage('execution');
  }

  function getStageAction(): { label: string; action: () => void; disabled?: boolean } | null {
    switch (selectedStage()) {
      case 'elicitation':
        return { label: 'Generate Spec', action: handleGenerateSpec };
      case 'spec':
        if (doc()?.specDocUrl) {
          return { label: 'Create Plan', action: handleCreatePlan };
        }
        return null;
      case 'plan':
        if (doc()?.planDocUrl) {
          return { label: 'Execute Plan', action: handleExecutePlan };
        }
        return null;
      case 'execution':
        return {
          label: 'Validate',
          action: () => setSelectedStage('validation'),
          disabled: isExecutionRunning(),
        };
      default:
        return null;
    }
  }

  const STAGES: { id: Stage; label: string }[] = [
    { id: 'elicitation', label: 'Elicitation' },
    { id: 'spec',        label: 'Spec' },
    { id: 'plan',        label: 'Plan' },
    { id: 'execution',   label: 'Execution' },
    { id: 'validation',  label: 'Validation' },
  ];

  return (
    <div class="wf-root">
      <div class="wf-header">
        <div class="wf-header-main">
          <div class="wf-stage-bar">
            <For each={STAGES}>
              {(stage, i) => (
                <>
                  <Show when={i() > 0}>
                    <span class="wf-stage-chevron">{'>'}</span>
                  </Show>
                  <button
                    class="wf-stage-item"
                    classList={{
                      active: selectedStage() === stage.id,
                      unavailable: !hasDocForStage(stage.id),
                    }}
                    disabled={!hasDocForStage(stage.id)}
                    onClick={() => setSelectedStage(stage.id)}
                  >
                    {stage.label}
                  </button>
                </>
              )}
            </For>
          </div>

          <Show when={getStageAction()}>
            {(action) => (
              <div class="wf-action-bar">
                <button
                  class="wf-action-btn"
                  onClick={action().action}
                  disabled={action().disabled}
                >
                  {action().label}
                </button>
              </div>
            )}
          </Show>
        </div>
        <span class="wf-version">v{WORKFLOW_VERSION}</span>
      </div>

      <div class="wf-content">
        {/* Spec stage */}
        <Show when={selectedStage() === 'spec' && doc()?.specProcessUrl}>
          {(_) => (
            <SpecGenerationView
              processUrl={doc()!.specProcessUrl!}
              specDocUrl={doc()?.specDocUrl}
              specToolId={doc()?.toolIds?.spec}
              onFollowUp={handleFollowUpSpec}
            />
          )}
        </Show>
        <Show when={selectedStage() === 'spec' && !doc()?.specProcessUrl}>
          <div class="wf-empty">Click "Generate Spec" to begin.</div>
        </Show>

        {/* Plan stage — split view while generating, full view once done */}
        <Show when={selectedStage() === 'plan' && doc()?.planProcessUrl && !doc()?.planDocUrl}>
          {(_) => (
            <PlanGenerationView
              processUrl={doc()!.planProcessUrl!}
              planDocUrl={doc()?.planDocUrl}
            />
          )}
        </Show>
        <Show when={selectedStage() === 'plan' && (doc()?.planDocUrl || !doc()?.planProcessUrl)}>
          <Show
            when={doc()?.planDocUrl}
            fallback={<div class="wf-empty">No document for this stage</div>}
          >
            {(url) => (
              <patchwork-view
                attr:doc-url={url()}
                style="display:block;width:100%;height:100%;"
              />
            )}
          </Show>
        </Show>

        {/* All other stages */}
        <Show when={selectedStage() !== 'spec' && selectedStage() !== 'plan'}>
          <Show
            when={getStageUrl()}
            fallback={<div class="wf-empty">No document for this stage</div>}
          >
            {(url) => (
              <patchwork-view
                attr:doc-url={url()}
                attr:tool-id={getStageToolId()}
                style="display:block;width:100%;height:100%;"
              />
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}

function SpecGenerationView(props: {
  processUrl: AutomergeUrl;
  specDocUrl?: AutomergeUrl;
  specToolId?: string;
  onFollowUp?: (message: string) => void;
}) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  const [followUpText, setFollowUpText] = createSignal('');
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  const isRunning = createMemo(() => processDoc() ? !processDoc()!.done : false);

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom = containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
  }

  createEffect(() => {
    processDoc(); // track reactively
    if (isAtBottom && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  function handleSendFollowUp() {
    const text = followUpText().trim();
    if (!text || isRunning()) return;
    setFollowUpText('');
    props.onFollowUp?.(text);
  }

  function handleFollowUpKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendFollowUp();
    }
  }

  return (
    <div class="wf-spec-split">
      <div class="wf-spec-preview">
        <Show
          when={props.specDocUrl}
          fallback={<div class="wf-empty">No spec yet</div>}
        >
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              attr:tool-id={props.specToolId}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>

      <div class="wf-spec-right">
        <div class="wf-spec-process" ref={containerRef} onScroll={handleScroll}>
          <Show when={processDoc()}>
            {(pd) => (
              <>
                <For each={pd().messages}>
                  {(msg) => <SpecMessageView message={msg} />}
                </For>
                <Show when={!pd().done}>
                  <div class="wf-spec-thinking">
                    <div class="wf-spec-dot" />
                    <div class="wf-spec-dot" />
                    <div class="wf-spec-dot" />
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>

        <div class="wf-spec-followup">
          <textarea
            class="wf-spec-followup-input"
            placeholder="Ask for changes…"
            value={followUpText()}
            onInput={(e) => setFollowUpText(e.currentTarget.value)}
            onKeyDown={handleFollowUpKeyDown}
            disabled={isRunning()}
            rows={2}
          />
          <button
            class="wf-spec-followup-btn"
            onClick={handleSendFollowUp}
            disabled={isRunning() || !followUpText().trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanGenerationView(props: {
  processUrl: AutomergeUrl;
  planDocUrl?: AutomergeUrl;
}) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom = containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
  }

  createEffect(() => {
    processDoc();
    if (isAtBottom && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  return (
    <div class="wf-spec-split">
      <div class="wf-spec-preview">
        <Show
          when={props.planDocUrl}
          fallback={<div class="wf-empty">No plan yet</div>}
        >
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>

      <div class="wf-spec-right">
        <div class="wf-spec-process" ref={containerRef} onScroll={handleScroll}>
          <Show when={processDoc()}>
            {(pd) => (
              <>
                <For each={pd().messages}>
                  {(msg) => <SpecMessageView message={msg} />}
                </For>
                <Show when={!pd().done}>
                  <div class="wf-spec-thinking">
                    <div class="wf-spec-dot" />
                    <div class="wf-spec-dot" />
                    <div class="wf-spec-dot" />
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

function SpecMessageView(props: { message: { role: string; content: ChatMessagePart[] } }) {
  return (
    <div class={`wf-spec-msg wf-spec-msg-${props.message.role}`}>
      <For each={props.message.content}>
        {(part) => <SpecPartView part={part} />}
      </For>
    </div>
  );
}

function SpecPartView(props: { part: ChatMessagePart }) {
  return (
    <Show
      when={props.part.type === 'script' ? props.part : undefined}
      fallback={
        <Show when={props.part.type === 'text' ? props.part : undefined}>
          {(p) => <SolidMarkdown remarkPlugins={[remarkGfm]}>{(p() as { type: 'text'; text: string }).text}</SolidMarkdown>}
        </Show>
      }
    >
      {(sp) => {
        const s = sp() as { type: 'script'; code: string; description?: string; output?: string; error?: string };
        return (
          <div class="wf-spec-script">
            <Show when={s.description}>
              {(d) => <div class="wf-spec-script-header">{d()}</div>}
            </Show>
            <div class="wf-spec-script-code">{s.code}</div>
            <Show when={s.output !== undefined}>
              <div class="wf-spec-script-output">{s.output}</div>
            </Show>
            <Show when={s.error !== undefined}>
              <div class="wf-spec-script-error">{s.error}</div>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
