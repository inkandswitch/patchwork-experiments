import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { WorkflowDoc } from './types';
import type { PetriNetPlanDoc, PetriNetExecutionDoc } from '../paul/petrinet-plan/types';
import './workflow.css';

type Stage = 'elicitation' | 'spec' | 'plan' | 'execution' | 'validation';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
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
  const [selectedStage, setSelectedStage] = createSignal<Stage>('elicitation');
  const repo = useRepo();

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
    setSelectedStage('spec');
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
      d.planUrl = currentDoc.planDocUrl;
      d.tokens = {};
      for (const init of planDoc.initialTokens ?? []) {
        if (!d.tokens[init.placeId]) d.tokens[init.placeId] = [];
        d.tokens[init.placeId].push({
          id: makeId(),
          state: JSON.parse(JSON.stringify(init.state)),
        });
      }
    });

    props.handle.change((d) => {
      d.executionDocUrl = execHandle.url;
    });

    setSelectedStage('execution');
  }

  function getStageAction(): { label: string; action: () => void; disabled?: boolean } | null {
    switch (selectedStage()) {
      case 'elicitation':
        return { label: 'Generate Spec', action: handleGenerateSpec, disabled: true };
      case 'plan':
        return { label: 'Execute Plan', action: handleExecutePlan };
      default:
        return null;
    }
  }

  return (
    <div class="wf-root">
      <div class="wf-header">
        <div class="wf-stage-bar">
          <button
            class="wf-stage-item"
            classList={{ active: selectedStage() === 'elicitation' }}
            onClick={() => setSelectedStage('elicitation')}
          >
            Elicitation
          </button>
          <span class="wf-stage-chevron">{'>'}</span>
          <button
            class="wf-stage-item"
            classList={{ active: selectedStage() === 'spec' }}
            onClick={() => setSelectedStage('spec')}
          >
            Spec
          </button>
          <span class="wf-stage-chevron">{'>'}</span>
          <button
            class="wf-stage-item"
            classList={{ active: selectedStage() === 'plan' }}
            onClick={() => setSelectedStage('plan')}
          >
            Plan
          </button>
          <span class="wf-stage-chevron">{'>'}</span>
          <button
            class="wf-stage-item"
            classList={{ active: selectedStage() === 'execution' }}
            onClick={() => setSelectedStage('execution')}
          >
            Execution
          </button>
          <span class="wf-stage-chevron">{'>'}</span>
          <button
            class="wf-stage-item"
            classList={{ active: selectedStage() === 'validation' }}
            onClick={() => setSelectedStage('validation')}
          >
            Validation
          </button>
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

      <div class="wf-content">
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
      </div>
    </div>
  );
}
