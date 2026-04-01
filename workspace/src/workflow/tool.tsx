import { render } from 'solid-js/web';
import { Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { WorkflowDoc } from './types';
import './workflow.css';

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

  return (
    <div class="wf-root">
      <div class="wf-stage-bar">
        <span class="wf-stage-item active">Elicitation</span>
        <span class="wf-stage-chevron">{'>'}</span>
        <span class="wf-stage-item future">Spec</span>
        <span class="wf-stage-chevron">{'>'}</span>
        <span class="wf-stage-item future">Plan</span>
        <span class="wf-stage-chevron">{'>'}</span>
        <span class="wf-stage-item future">Execution</span>
        <span class="wf-stage-chevron">{'>'}</span>
        <span class="wf-stage-item future">Validation</span>
      </div>

      <div class="wf-content">
        <Show
          when={doc()?.specElicitationDocUrl}
          fallback={<div class="wf-empty">No elicitation document</div>}
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
