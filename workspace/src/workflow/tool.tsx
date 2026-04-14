import { render } from 'solid-js/web';
import { Show, createSignal, For, createEffect, createMemo } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import { SolidMarkdown } from 'solid-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { WorkflowDoc, ValidationDoc, SpecElicitationDoc, PlanType } from './types';
import type { LLMProcessDoc, ChatMessagePart } from '../llm/types';
import type { PetriNetPlanDoc, PetriNetExecutionDoc } from '../paul/petrinet-plan/types';
import type { TaskListExecutionDoc } from '../../../grjte-workflow-tools/src/execution/types';
import type { TaskListPlanDoc } from '../../../grjte-workflow-tools/src/plan/types';
import { runWorkspaceLLM } from '../llm/llm-process';
import './workflow.css';
import { FolderDoc } from '@inkandswitch/patchwork-filesystem';

type Stage = 'elicitation' | 'spec' | 'plan' | 'execution' | 'validation';

const WORKFLOW_VERSION = '0.9.0';

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
        if (m) {
          console.log(
            `[workflow] findUrlInMessages: matched ${pattern} → ${m[1]} in ${part.type}${part.type === 'script' ? ` (${(part as any).description ?? 'no desc'})` : ''}`,
          );
          found = m[1] as AutomergeUrl;
        }
      }
    }
  }
  if (!found) {
    console.warn(
      `[workflow] findUrlInMessages: no match for ${pattern} across ${messages?.length ?? 0} messages`,
    );
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
  const [planType, setPlanType] = createSignal<PlanType>(
    doc()?.planType ?? (doc()?.toolIds?.plan === 'grjte-plan-viewer' ? 'task-list' : 'petrinet'),
  );
  const repo = useRepo();

  function handlePlanTypeChange(value: PlanType) {
    setPlanType(value);
    props.handle.change((d) => {
      d.planType = value;
    });
  }

  const [executionProcessDoc] = useDocument<LLMProcessDoc>(() => doc()?.executionProcessUrl);

  const isExecutionRunning = () => {
    // Petrinet path
    const exec = executionDoc();
    if (exec?.tokens) {
      const llmTokens = exec.tokens.llm ?? [];
      if (llmTokens.length > 0) return true;
    }
    // Task-list path: check if the LLM process is still running
    const processDoc = executionProcessDoc();
    if (processDoc && !processDoc.done) return true;
    return false;
  };

  function hasDocForStage(stage: Stage): boolean {
    const d = doc();
    if (!d) return false;
    switch (stage) {
      case 'elicitation':
        return !!d.specElicitationDocUrl;
      case 'spec':
        return !!(d.specProcessUrl || d.specDocUrl);
      case 'plan':
        return !!(d.planDocUrl || d.planProcessUrl);
      case 'execution':
        return !!d.executionDocUrl;
      case 'validation':
        return !!d.validationDocUrl;
    }
  }

  function getStageUrl(): AutomergeUrl | undefined {
    const currentDoc = doc();
    if (!currentDoc) return undefined;

    switch (selectedStage()) {
      case 'elicitation':
        return currentDoc.specElicitationDocUrl;
      case 'spec':
        return currentDoc.specDocUrl;
      case 'plan':
        return currentDoc.planDocUrl;
      case 'execution':
        return currentDoc.executionDocUrl;
      case 'validation':
        return currentDoc.validationDocUrl;
    }
  }

  function getStageToolId(): string | undefined {
    return doc()?.toolIds?.[selectedStage()];
  }

  async function handleGenerateSpec() {
    const currentDoc = doc();
    if (!currentDoc?.specElicitationDocUrl) return;

    console.log('[workflow] handleGenerateSpec: starting');

    const elicitHandle = await repo.find<SpecElicitationDoc>(currentDoc.specElicitationDocUrl);
    const elicitDoc = await elicitHandle.doc();
    const prompt = elicitDoc?.prompt?.trim() ?? '';

    // Build reference document listing (names + URLs only, not full content)
    let referenceDocs: { name: string; url: string }[] = [];
    if (elicitDoc?.referenceDocsFolderUrl) {
      const folderHandle = await repo.find<FolderDoc>(elicitDoc.referenceDocsFolderUrl);
      const folderDoc = folderHandle.doc();
      referenceDocs = ((folderDoc?.docs ?? []) as { name: string; url: AutomergeUrl }[]).map(
        (entry) => ({ name: entry.name, url: entry.url as string }),
      );
    }

    let userMessage = prompt || 'Generate a spec.';
    if (referenceDocs.length > 0) {
      userMessage +=
        '\n\nReference documents (use repo.find(url) to read full content):\n' +
        JSON.stringify(referenceDocs, null, 2);
    }

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }];
      d.done = false;
    });

    props.handle.change((d) => {
      d.specProcessUrl = processHandle.url;
      delete d.specDocUrl;
      delete d.planDocUrl;
      delete d.planProcessUrl;
      delete d.executionDocUrl;
      delete d.validationDocUrl;
    });

    setSelectedStage('spec');

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const rootSpecUrl = findUrlInMessages(
      processDoc?.messages,
      /ROOT_SPEC_URL:\s*(automerge:[A-Za-z0-9]+)/,
    );

    if (rootSpecUrl) {
      console.log('[workflow] handleGenerateSpec: setting specDocUrl =', rootSpecUrl);
      props.handle.change((d) => {
        d.specDocUrl = rootSpecUrl!;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.spec = 'paul-spec-viewer';
      });
    } else {
      console.warn('[workflow] handleGenerateSpec: no ROOT_SPEC_URL found in LLM output');
    }
  }

  async function handleFollowUpSpec(message: string) {
    const currentDoc = doc();
    if (!currentDoc?.specDocUrl) return;

    console.log(
      '[workflow] handleFollowUpSpec: starting, current specDocUrl =',
      currentDoc.specDocUrl,
    );

    let previousMessages: LLMProcessDoc['messages'] = [];
    if (currentDoc.specProcessUrl) {
      const prevProcessHandle = await repo.find<LLMProcessDoc>(currentDoc.specProcessUrl);
      const prevProcessDoc = await prevProcessHandle.doc();
      previousMessages = prevProcessDoc?.messages ?? [];
    }

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __SPEC_AGENT_FOLDER_URL__ as AutomergeUrl;
      const userText =
        previousMessages.length > 0
          ? message
          : `The existing spec is at: ${currentDoc.specDocUrl}\n\n${message}`;
      d.messages = [
        ...JSON.parse(JSON.stringify(previousMessages)),
        { role: 'user', content: [{ type: 'text', text: userText }] },
      ];
      d.done = false;
    });

    props.handle.change((d) => {
      d.specProcessUrl = processHandle.url;
    });

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const rootSpecUrl = findUrlInMessages(
      processDoc?.messages,
      /ROOT_SPEC_URL:\s*(automerge:[A-Za-z0-9]+)/,
    );

    if (rootSpecUrl) {
      console.log('[workflow] handleFollowUpSpec: setting specDocUrl =', rootSpecUrl);
      props.handle.change((d) => {
        d.specDocUrl = rootSpecUrl!;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.spec = 'paul-spec-viewer';
      });
    } else {
      console.warn('[workflow] handleFollowUpSpec: no ROOT_SPEC_URL found in LLM output');
    }
  }

  async function handleCreatePlan() {
    const currentDoc = doc();
    if (!currentDoc?.specDocUrl) return;

    const selectedPlanType = planType();
    console.log('[workflow] handleCreatePlan: planType =', selectedPlanType);
    console.log('[workflow] handleCreatePlan: specDocUrl =', currentDoc.specDocUrl);
    console.log('[workflow] handleCreatePlan: current planDocUrl =', currentDoc.planDocUrl);
    console.log('[workflow] handleCreatePlan: current planProcessUrl =', currentDoc.planProcessUrl);

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __PLAN_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Create a ${selectedPlanType} plan for this spec: ${currentDoc.specDocUrl}`,
            },
          ],
        },
      ];
      d.done = false;
    });

    console.log('[workflow] handleCreatePlan: created LLM process =', processHandle.url);

    props.handle.change((d) => {
      d.planProcessUrl = processHandle.url;
      delete d.planDocUrl;
      delete d.executionDocUrl;
      delete d.validationDocUrl;
    });

    console.log(
      '[workflow] handleCreatePlan: set planProcessUrl, deleted planDocUrl, switching to plan stage',
    );
    setSelectedStage('plan');

    console.log('[workflow] handleCreatePlan: starting runWorkspaceLLM...');
    await runWorkspaceLLM(repo, processHandle.url);
    console.log('[workflow] handleCreatePlan: runWorkspaceLLM finished');

    const finalProcessDoc = await processHandle.doc();
    console.log('[workflow] handleCreatePlan: process done =', finalProcessDoc?.done);
    console.log('[workflow] handleCreatePlan: message count =', finalProcessDoc?.messages?.length);

    const planDocUrl = findUrlInMessages(
      finalProcessDoc?.messages,
      /PLAN_DOC_URL:\s*(automerge:[A-Za-z0-9]+)/,
    );
    console.log('[workflow] handleCreatePlan: extracted planDocUrl =', planDocUrl);

    if (planDocUrl) {
      const planToolId =
        selectedPlanType === 'task-list' ? 'grjte-plan-viewer' : 'paul-plan-viewer';
      props.handle.change((d) => {
        d.planDocUrl = planDocUrl!;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.plan = planToolId;
      });
      console.log(
        '[workflow] handleCreatePlan: set planDocUrl on workflow doc, toolId =',
        planToolId,
      );
    } else {
      console.warn('[workflow] handleCreatePlan: no PLAN_DOC_URL found in LLM output');
    }

    const afterDoc = await props.handle.doc();
    console.log('[workflow] handleCreatePlan: final workflow state:', {
      specDocUrl: afterDoc?.specDocUrl,
      planDocUrl: afterDoc?.planDocUrl,
      planProcessUrl: afterDoc?.planProcessUrl,
    });
  }

  async function handleFollowUpPlan(message: string) {
    const currentDoc = doc();
    if (!currentDoc?.planDocUrl) return;

    const currentPlanType = currentDoc.planType ?? 'petrinet';
    console.log('[workflow] handleFollowUpPlan: planType =', currentPlanType);
    console.log(
      '[workflow] handleFollowUpPlan: starting, current planDocUrl =',
      currentDoc.planDocUrl,
    );
    console.log(
      '[workflow] handleFollowUpPlan: planProcessUrl =',
      currentDoc.planProcessUrl ?? '(none — cold start)',
    );

    let previousMessages: LLMProcessDoc['messages'] = [];
    if (currentDoc.planProcessUrl) {
      const prevProcessHandle = await repo.find<LLMProcessDoc>(currentDoc.planProcessUrl);
      const prevProcessDoc = await prevProcessHandle.doc();
      previousMessages = prevProcessDoc?.messages ?? [];
    }

    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __PLAN_AGENT_FOLDER_URL__ as AutomergeUrl;
      const userText =
        previousMessages.length > 0
          ? `(Plan type: ${currentPlanType}) ${message}`
          : `The existing plan is at: ${currentDoc.planDocUrl}\n\n(Plan type: ${currentPlanType}) ${message}`;
      d.messages = [
        ...JSON.parse(JSON.stringify(previousMessages)),
        { role: 'user', content: [{ type: 'text', text: userText }] },
      ];
      d.done = false;
    });

    props.handle.change((d) => {
      d.planProcessUrl = processHandle.url;
    });

    await runWorkspaceLLM(repo, processHandle.url);

    const processDoc = await processHandle.doc();
    const planDocUrl = findUrlInMessages(
      processDoc?.messages,
      /PLAN_DOC_URL:\s*(automerge:[A-Za-z0-9]+)/,
    );

    if (planDocUrl) {
      console.log('[workflow] handleFollowUpPlan: setting planDocUrl =', planDocUrl);
      props.handle.change((d) => {
        d.planDocUrl = planDocUrl!;
      });
    } else {
      console.warn('[workflow] handleFollowUpPlan: no PLAN_DOC_URL found in LLM output');
    }
  }

  function inferPlanType(d: WorkflowDoc): PlanType {
    if (d.planType) return d.planType;
    if (d.toolIds?.plan === 'grjte-plan-viewer') return 'task-list';
    return 'petrinet';
  }

  async function handleExecutePlan() {
    const currentDoc = doc();
    console.log(
      '[workflow] handleExecutePlan: called, doc keys =',
      currentDoc ? Object.keys(currentDoc) : 'null',
    );
    console.log('[workflow] handleExecutePlan: planDocUrl =', currentDoc?.planDocUrl);
    console.log('[workflow] handleExecutePlan: specDocUrl =', currentDoc?.specDocUrl);
    console.log('[workflow] handleExecutePlan: planType =', currentDoc?.planType);
    console.log('[workflow] handleExecutePlan: toolIds =', JSON.stringify(currentDoc?.toolIds));

    if (!currentDoc?.planDocUrl) {
      console.warn('[workflow] handleExecutePlan: no planDocUrl, aborting');
      return;
    }

    const currentPlanType = inferPlanType(currentDoc);
    console.log('[workflow] handleExecutePlan: inferred planType =', currentPlanType);

    try {
      let execUrl: AutomergeUrl;

      if (currentPlanType === 'task-list') {
        execUrl = await createTaskListExecution(currentDoc);
      } else {
        execUrl = await createPetriNetExecution(currentDoc);
      }

      const validationHandle = currentDoc.validationDocUrl
        ? await repo.find<ValidationDoc>(currentDoc.validationDocUrl)
        : repo.create<ValidationDoc>();

      validationHandle.change((d) => {
        d['@patchwork'] = { type: 'validation' };
        d.planDocUrl = currentDoc.planDocUrl!;
        d.specDocUrl = currentDoc.specDocUrl!;
        d.executionDocUrl = execUrl;
        d.isValidated = false;
        d.headsByDocUrl = {} as Record<AutomergeUrl, never>;
      });

      const execToolId =
        currentPlanType === 'task-list' ? 'grjte-execution-viewer' : 'petrinet-execution';
      console.log('[workflow] handleExecutePlan: execUrl =', execUrl, 'execToolId =', execToolId);

      props.handle.change((d) => {
        d.executionDocUrl = execUrl;
        d.validationDocUrl = validationHandle.url;
        if (!d.toolIds) d.toolIds = {};
        d.toolIds.execution = execToolId;
      });

      console.log('[workflow] handleExecutePlan: done, switching to execution stage');
      setSelectedStage('execution');

      // For task-list executions, launch the LLM to execute the plan
      if (currentPlanType === 'task-list') {
        const processHandle = repo.create<LLMProcessDoc>();
        processHandle.change((d) => {
          d.config = {
            apiUrl: 'https://openrouter.ai/api/v1',
            model: 'anthropic/claude-sonnet-4.6',
          };
          d.llmConfigFolderUrl = __EXEC_AGENT_FOLDER_URL__ as AutomergeUrl;
          d.messages = [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Execute the plan. Spec: ${currentDoc.specDocUrl}, Plan: ${currentDoc.planDocUrl}, Execution: ${execUrl}`,
                },
              ],
            },
          ];
          d.done = false;
        });

        console.log(
          '[workflow] handleExecutePlan: created execution LLM process =',
          processHandle.url,
        );

        props.handle.change((d) => {
          d.executionProcessUrl = processHandle.url;
        });

        // Run async — UI updates reactively as the LLM modifies docs
        runWorkspaceLLM(repo, processHandle.url)
          .then(() => {
            console.log('[workflow] handleExecutePlan: execution LLM process finished');
          })
          .catch((err) => {
            console.error('[workflow] handleExecutePlan: execution LLM process error', err);
          });
      }
    } catch (err) {
      console.error('[workflow] handleExecutePlan: error during execution creation', err);
    }
  }

  async function handleValidateWithProjections() {
    const currentDoc = doc();
    if (!currentDoc?.executionDocUrl) return;

    setSelectedStage('validation');

    // Launch projection generation LLM
    const processHandle = repo.create<LLMProcessDoc>();
    processHandle.change((d) => {
      d.config = { apiUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.6' };
      d.llmConfigFolderUrl = __PROJECTION_AGENT_FOLDER_URL__ as AutomergeUrl;
      d.messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Generate projections for the artifacts. Execution: ${currentDoc.executionDocUrl}`,
            },
          ],
        },
      ];
      d.done = false;
    });

    console.log(
      '[workflow] handleValidateWithProjections: created projection LLM process =',
      processHandle.url,
    );

    props.handle.change((d) => {
      d.projectionProcessUrl = processHandle.url;
    });

    // Also store on the validation doc so the validation tool can access the chat
    if (currentDoc.validationDocUrl) {
      const validationHandle = await repo.find<ValidationDoc>(currentDoc.validationDocUrl);
      validationHandle.change((d) => {
        d.projectionProcessUrl = processHandle.url;
      });
    }

    runWorkspaceLLM(repo, processHandle.url)
      .then(() => {
        console.log('[workflow] handleValidateWithProjections: projection LLM finished');
      })
      .catch((err) => {
        console.error('[workflow] handleValidateWithProjections: projection LLM error', err);
      });
  }

  async function createPetriNetExecution(currentDoc: WorkflowDoc): Promise<AutomergeUrl> {
    const planHandle = await repo.find<PetriNetPlanDoc>(currentDoc.planDocUrl!);
    const planDoc = planHandle.doc();
    if (!planDoc) throw new Error('Plan doc not found');

    console.log(
      '[workflow] createPetriNetExecution: initialTokens count =',
      planDoc.initialTokens?.length,
    );

    const artifactsFolderHandle = repo.create();
    artifactsFolderHandle.change((d: any) => {
      d['@patchwork'] = { type: 'folder' };
      d.title = 'Execution Artifacts';
      d.docs = [];
    });

    const execHandle = repo.create<PetriNetExecutionDoc>();
    execHandle.change((d) => {
      d['@patchwork'] = { type: 'petrinet-execution' };
      d.planUrl = currentDoc.planDocUrl!;
      d.specDocUrl = currentDoc.specDocUrl!;
      d.artifactsFolderUrl = artifactsFolderHandle.url;
      d.tokens = {};
      for (const init of planDoc.initialTokens ?? []) {
        if (!d.tokens[init.placeId]) d.tokens[init.placeId] = [];
        d.tokens[init.placeId].push({
          id: makeId(),
          state: JSON.parse(JSON.stringify(init.state)),
        });
      }
    });

    return execHandle.url;
  }

  async function createTaskListExecution(currentDoc: WorkflowDoc): Promise<AutomergeUrl> {
    const planHandle = await repo.find<TaskListPlanDoc>(currentDoc.planDocUrl!);
    const planDoc = planHandle.doc();
    if (!planDoc) throw new Error('Plan doc not found');

    console.log('[workflow] createTaskListExecution: task count =', planDoc.tasks?.length);

    const artifactsFolderHandle = repo.create();
    artifactsFolderHandle.change((d: any) => {
      d['@patchwork'] = { type: 'folder' };
      d.title = 'Execution Artifacts';
      d.docs = [];
    });

    const execHandle = repo.create<TaskListExecutionDoc>();
    execHandle.change((d) => {
      d['@patchwork'] = { type: 'task-list-execution' };
      d.specDocUrl = currentDoc.specDocUrl!;
      d.planDocUrl = currentDoc.planDocUrl!;
      d.taskUrls = [...(planDoc.tasks ?? [])];
      d.artifactsFolderUrl = artifactsFolderHandle.url;
      d.status = 'in-progress';
    });

    return execHandle.url;
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
          action: handleValidateWithProjections,
          disabled: isExecutionRunning(),
        };
      default:
        return null;
    }
  }

  const STAGES: { id: Stage; label: string }[] = [
    { id: 'elicitation', label: 'Elicitation' },
    { id: 'spec', label: 'Spec' },
    { id: 'plan', label: 'Plan' },
    { id: 'execution', label: 'Execution' },
    { id: 'validation', label: 'Validation' },
  ];

  return (
    <div class="wf-root">
      <div class="wf-header">
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

        <div class="wf-header-right">
          <span class="wf-version">v{WORKFLOW_VERSION}</span>
          <Show when={selectedStage() === 'spec' && doc()?.specDocUrl}>
            <select
              class="wf-plan-select"
              value={planType()}
              onChange={(e) => handlePlanTypeChange(e.currentTarget.value as PlanType)}
            >
              <option value="petrinet">Petri Net</option>
              <option value="task-list">Task List</option>
            </select>
          </Show>
          <Show when={getStageAction()}>
            {(action) => (
              <button
                class="wf-action-btn"
                onClick={() => action().action()}
                disabled={action().disabled}
              >
                {action().label}
              </button>
            )}
          </Show>
        </div>
      </div>

      <div class="wf-content">
        {/* Spec stage — LLM generation split view */}
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
        {/* Spec stage — doc exists but no LLM process (e.g. from a workflow template) */}
        <Show when={selectedStage() === 'spec' && !doc()?.specProcessUrl && doc()?.specDocUrl}>
          {(_) => (
            <SpecEditView
              specDocUrl={doc()!.specDocUrl!}
              specToolId={doc()?.toolIds?.spec}
              onFollowUp={handleFollowUpSpec}
            />
          )}
        </Show>
        <Show when={selectedStage() === 'spec' && !doc()?.specProcessUrl && !doc()?.specDocUrl}>
          <div class="wf-empty">Click "Generate Spec" to begin.</div>
        </Show>

        {/* Plan stage — LLM generation split view */}
        <Show when={selectedStage() === 'plan' && doc()?.planProcessUrl}>
          {(_) => (
            <PlanGenerationView
              processUrl={doc()!.planProcessUrl!}
              planDocUrl={doc()?.planDocUrl}
              planToolId={doc()?.toolIds?.plan}
              onFollowUp={handleFollowUpPlan}
            />
          )}
        </Show>
        {/* Plan stage — doc exists but no LLM process (e.g. from a workflow template) */}
        <Show when={selectedStage() === 'plan' && !doc()?.planProcessUrl && doc()?.planDocUrl}>
          {(_) => (
            <PlanEditView
              planDocUrl={doc()!.planDocUrl!}
              planToolId={doc()?.toolIds?.plan}
              onFollowUp={handleFollowUpPlan}
            />
          )}
        </Show>
        <Show when={selectedStage() === 'plan' && !doc()?.planProcessUrl && !doc()?.planDocUrl}>
          <div class="wf-empty">No document for this stage</div>
        </Show>

        {/* Execution stage — with LLM chat sidebar */}
        <Show when={selectedStage() === 'execution' && doc()?.executionProcessUrl}>
          {(_) => (
            <ExecutionGenerationView
              processUrl={doc()!.executionProcessUrl!}
              executionDocUrl={doc()?.executionDocUrl}
              executionToolId={doc()?.toolIds?.execution}
            />
          )}
        </Show>
        {/* Execution stage — no LLM process (e.g. pre-existing execution) */}
        <Show
          when={
            selectedStage() === 'execution' && !doc()?.executionProcessUrl && doc()?.executionDocUrl
          }
        >
          {(_) => (
            <patchwork-view
              attr:doc-url={doc()!.executionDocUrl!}
              attr:tool-id={doc()?.toolIds?.execution}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>

        {/* All other stages (elicitation, validation) */}
        <Show
          when={
            selectedStage() !== 'spec' &&
            selectedStage() !== 'plan' &&
            selectedStage() !== 'execution'
          }
        >
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

function SpecEditView(props: {
  specDocUrl: AutomergeUrl;
  specToolId?: string;
  onFollowUp?: (message: string) => void;
}) {
  const [followUpText, setFollowUpText] = createSignal('');

  function handleSend() {
    const text = followUpText().trim();
    if (!text) return;
    setFollowUpText('');
    props.onFollowUp?.(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div class="wf-spec-edit">
      <div class="wf-spec-edit-preview">
        <patchwork-view
          attr:doc-url={props.specDocUrl}
          attr:tool-id={props.specToolId}
          style="display:block;width:100%;height:100%;"
        />
      </div>
      <div class="wf-spec-followup">
        <textarea
          class="wf-spec-followup-input"
          placeholder="Ask for changes to the spec…"
          value={followUpText()}
          onInput={(e) => setFollowUpText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button class="wf-spec-followup-btn" onClick={handleSend} disabled={!followUpText().trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

function PlanEditView(props: {
  planDocUrl: AutomergeUrl;
  planToolId?: string;
  onFollowUp?: (message: string) => void;
}) {
  const [followUpText, setFollowUpText] = createSignal('');

  function handleSend() {
    const text = followUpText().trim();
    if (!text) return;
    setFollowUpText('');
    props.onFollowUp?.(text);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div class="wf-spec-edit">
      <div class="wf-spec-edit-preview">
        <patchwork-view
          attr:doc-url={props.planDocUrl}
          attr:tool-id={props.planToolId}
          style="display:block;width:100%;height:100%;"
        />
      </div>
      <div class="wf-spec-followup">
        <textarea
          class="wf-spec-followup-input"
          placeholder="Ask for changes to the plan…"
          value={followUpText()}
          onInput={(e) => setFollowUpText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          rows={2}
        />
        <button class="wf-spec-followup-btn" onClick={handleSend} disabled={!followUpText().trim()}>
          Send
        </button>
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
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  const isRunning = createMemo(() => (processDoc() ? !processDoc()!.done : false));

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
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
        <Show when={props.specDocUrl} fallback={<div class="wf-empty">No spec yet</div>}>
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              attr:tool-id={props.specToolId}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>

      <div class={`wf-spec-right${isSidebarOpen() ? '' : ' wf-spec-right-collapsed'}`}>
        <button
          class="wf-spec-sidebar-toggle"
          onClick={() => setIsSidebarOpen((open) => !open)}
          title={isSidebarOpen() ? 'Collapse chat' : 'Expand chat'}
          type="button"
        >
          {isSidebarOpen() ? '›' : '‹'}
        </button>

        <Show when={isSidebarOpen()}>
          <>
            <div class="wf-spec-process" ref={containerRef} onScroll={handleScroll}>
              <Show when={processDoc()}>
                {(pd) => (
                  <>
                    <For each={pd().messages}>{(msg) => <SpecMessageView message={msg} />}</For>
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
          </>
        </Show>
      </div>
    </div>
  );
}

function PlanGenerationView(props: {
  processUrl: AutomergeUrl;
  planDocUrl?: AutomergeUrl;
  planToolId?: string;
  onFollowUp?: (message: string) => void;
}) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  const [followUpText, setFollowUpText] = createSignal('');
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  const isRunning = createMemo(() => (processDoc() ? !processDoc()!.done : false));

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
  }

  createEffect(() => {
    processDoc();
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
        <Show when={props.planDocUrl} fallback={<div class="wf-empty">No plan yet</div>}>
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              attr:tool-id={props.planToolId}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>

      <div class={`wf-spec-right${isSidebarOpen() ? '' : ' wf-spec-right-collapsed'}`}>
        <button
          class="wf-spec-sidebar-toggle"
          onClick={() => setIsSidebarOpen((open) => !open)}
          title={isSidebarOpen() ? 'Collapse chat' : 'Expand chat'}
          type="button"
        >
          {isSidebarOpen() ? '›' : '‹'}
        </button>

        <Show when={isSidebarOpen()}>
          <>
            <div class="wf-spec-process" ref={containerRef} onScroll={handleScroll}>
              <Show when={processDoc()}>
                {(pd) => (
                  <>
                    <For each={pd().messages}>{(msg) => <SpecMessageView message={msg} />}</For>
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
          </>
        </Show>
      </div>
    </div>
  );
}

function ExecutionGenerationView(props: {
  processUrl: AutomergeUrl;
  executionDocUrl?: AutomergeUrl;
  executionToolId?: string;
}) {
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  createEffect(() => {
    processDoc();
    if (isAtBottom && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom =
      containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - 20;
  }

  return (
    <div class="wf-spec-split">
      <div class="wf-spec-preview">
        <Show when={props.executionDocUrl} fallback={<div class="wf-empty">No execution yet</div>}>
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              attr:tool-id={props.executionToolId}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>

      <div class={`wf-spec-right${isSidebarOpen() ? '' : ' wf-spec-right-collapsed'}`}>
        <button
          class="wf-spec-sidebar-toggle"
          onClick={() => setIsSidebarOpen((open) => !open)}
          title={isSidebarOpen() ? 'Collapse chat' : 'Expand chat'}
          type="button"
        >
          {isSidebarOpen() ? '›' : '‹'}
        </button>

        <Show when={isSidebarOpen()}>
          <div class="wf-spec-process" ref={containerRef} onScroll={handleScroll}>
            <Show when={processDoc()}>
              {(pd) => (
                <>
                  <For each={pd().messages}>{(msg) => <SpecMessageView message={msg} />}</For>
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
        </Show>
      </div>
    </div>
  );
}

function SpecMessageView(props: { message: { role: string; content: ChatMessagePart[] } }) {
  return (
    <div class={`wf-spec-msg wf-spec-msg-${props.message.role}`}>
      <For each={props.message.content}>{(part) => <SpecPartView part={part} />}</For>
    </div>
  );
}

function SpecPartView(props: { part: ChatMessagePart }) {
  return (
    <Show
      when={props.part.type === 'script' ? props.part : undefined}
      fallback={
        <Show when={props.part.type === 'text' ? props.part : undefined}>
          {(p) => (
            <SolidMarkdown remarkPlugins={[remarkGfm]}>
              {(p() as { type: 'text'; text: string }).text}
            </SolidMarkdown>
          )}
        </Show>
      }
    >
      {(sp) => {
        const s = sp() as {
          type: 'script';
          code: string;
          description?: string;
          output?: string;
          error?: string;
        };
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
