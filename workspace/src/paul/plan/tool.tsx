import { render } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { PlanDoc, TaskDoc } from '../../types';
import './plan.css';

export const PlanTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PlanView url={(handle as DocHandle<PlanDoc>).url} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function PlanView(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<PlanDoc>(() => props.url);

  return (
    <div class="plan-root">
      <Show when={doc()} fallback={<div class="plan-loading">Loading plan…</div>}>
        {(currentDoc) => {
          const taskUrls = () => currentDoc().tasks ?? [];

          return (
            <Show
              when={taskUrls().length > 0}
              fallback={<div class="plan-empty">No tasks in this plan.</div>}
            >
              <div class="plan-task-list">
                <For each={taskUrls()}>
                  {(taskUrl, index) => (
                    <TaskCard taskUrl={taskUrl} index={index()} allTaskUrls={taskUrls()} />
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

function TaskCard(props: { taskUrl: AutomergeUrl; index: number; allTaskUrls: AutomergeUrl[] }) {
  const [task] = useDocument<TaskDoc>(() => props.taskUrl);

  const artifactEntries = () =>
    Object.entries(task()?.artifacts ?? {}) as [string, AutomergeUrl][];
  const dependsOn = () => task()?.dependsOn ?? [];

  return (
    <Show when={task()} fallback={<div class="plan-task-card plan-task-loading">Loading task…</div>}>
      {(currentTask) => (
        <div class="plan-task-card">
          <div class="plan-task-header">
            <span class="plan-task-index">{props.index + 1}</span>
            <span class="plan-task-goal">{currentTask().goal || 'Untitled task'}</span>
          </div>

          <Show when={dependsOn().length > 0}>
            <div class="plan-section">
              <div class="plan-section-label">Depends on</div>
              <div class="plan-dep-list">
                <For each={dependsOn()}>
                  {(depUrl) => <DependencyPill depUrl={depUrl} allTaskUrls={props.allTaskUrls} />}
                </For>
              </div>
            </div>
          </Show>

          <Show when={artifactEntries().length > 0}>
            <div class="plan-section">
              <div class="plan-section-label">Artifacts</div>
              <div class="plan-artifact-list">
                <For each={artifactEntries()}>
                  {([name, url]) => <ArtifactCard name={name} url={url} />}
                </For>
              </div>
            </div>
          </Show>

          <Show when={currentTask().specDocUrl}>
            <div class="plan-section">
              <div class="plan-section-label">Spec</div>
              <div class="plan-spec-embed">
                <patchwork-view
                  attr:doc-url={currentTask().specDocUrl}
                  style="display:block;width:100%;height:100%;"
                />
              </div>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function DependencyPill(props: { depUrl: AutomergeUrl; allTaskUrls: AutomergeUrl[] }) {
  const [depTask] = useDocument<TaskDoc>(() => props.depUrl);
  const depIndex = () => props.allTaskUrls.indexOf(props.depUrl);

  return (
    <div class="plan-dep-pill">
      <Show when={depIndex() >= 0}>
        <span class="plan-dep-pill-index">{depIndex() + 1}</span>
      </Show>
      <span class="plan-dep-pill-label">
        {depTask()?.goal || props.depUrl}
      </span>
    </div>
  );
}

function ArtifactCard(props: { name: string; url: AutomergeUrl }) {
  return (
    <div class="plan-artifact-card">
      <div class="plan-artifact-card-label">{props.name}</div>
      <div class="plan-artifact-card-view">
        <patchwork-view
          attr:doc-url={props.url}
          style="display:block;width:100%;height:100%;"
        />
      </div>
    </div>
  );
}
