import { render } from 'solid-js/web';
import { Show, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { WorkflowDoc } from './types';
import './workflow.css';

type Stage = 'elicitation' | 'spec' | 'plan' | 'execution' | 'validation';

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

  return (
    <div class="wf-root">
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

      <div class="wf-content">
        <Show
          when={getStageUrl()}
          fallback={<div class="wf-empty">No document for this stage</div>}
        >
          {(url) => (
            <patchwork-view
              attr:doc-url={url()}
              style="display:block;width:100%;height:100%;"
            />
          )}
        </Show>
      </div>
    </div>
  );
}
