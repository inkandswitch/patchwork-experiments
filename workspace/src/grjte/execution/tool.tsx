import { render } from 'solid-js/web';
import { For, Show, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { TaskListExecutionDoc } from './types';
import type { TaskDoc } from '../plan/types';
import type { ArtifactFolderEntry } from '../artifact-projection';
import './execution.css';

type FolderDoc = {
  docs: ArtifactFolderEntry[];
};

export const ExecutionTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ExecutionView handle={handle as DocHandle<TaskListExecutionDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function openDocument(element: ToolElement, url: AutomergeUrl, toolId: string) {
  element.dispatchEvent(
    new CustomEvent('patchwork:open-document', {
      detail: { url, toolId },
      bubbles: true,
      composed: true,
    }),
  );
}

function ExecutionView(props: { handle: DocHandle<TaskListExecutionDoc>; element: ToolElement }) {
  const [doc] = useDocument<TaskListExecutionDoc>(() => props.handle.url);
  const [folder] = useDocument<FolderDoc>(() => doc()?.artifactsFolderUrl);
  const [expandedArtifacts, setExpandedArtifacts] = createSignal<AutomergeUrl[]>([]);

  const artifacts = () => folder()?.docs ?? [];

  function toggleArtifact(url: AutomergeUrl) {
    setExpandedArtifacts((current) =>
      current.includes(url) ? current.filter((entry) => entry !== url) : [...current, url],
    );
  }

  function isArtifactExpanded(url: AutomergeUrl) {
    return expandedArtifacts().includes(url);
  }

  return (
    <div class="execution-root">
      <Show when={doc()} fallback={<div class="execution-loading">Loading execution...</div>}>
        {(currentDoc) => (
          <>
            <div class="execution-header">
              <div class={`execution-status ${currentDoc().status}`}>
                {formatStatus(currentDoc().status)}
              </div>

              <Show when={currentDoc().specDocUrl}>
                {(specUrl) => (
                  <button
                    class="execution-link-btn"
                    onClick={() => openDocument(props.element, specUrl(), 'grjte-spec-viewer')}
                  >
                    View Spec
                  </button>
                )}
              </Show>

              <Show when={currentDoc().planDocUrl}>
                {(planUrl) => (
                  <button
                    class="execution-link-btn"
                    onClick={() => openDocument(props.element, planUrl(), 'grjte-plan-viewer')}
                  >
                    View Plan
                  </button>
                )}
              </Show>
            </div>

            <div class="execution-body">
              <div class="execution-section">
                <div class="execution-section-label">Tasks</div>
                <Show
                  when={(currentDoc().taskUrls?.length ?? 0) > 0}
                  fallback={<div class="execution-empty">No tasks in this execution.</div>}
                >
                  <div class="execution-task-list">
                    <For each={currentDoc().taskUrls}>
                      {(url, index) => <TaskRow url={url} index={index() + 1} />}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="execution-section">
                <div class="execution-section-label">Artifacts</div>
                <Show
                  when={artifacts().length > 0}
                  fallback={<div class="execution-empty">No artifacts available.</div>}
                >
                  <div class="execution-artifact-list">
                    <For each={artifacts()}>
                      {(entry) => (
                        <div
                          class="execution-artifact-card"
                          classList={{ expanded: isArtifactExpanded(entry.url) }}
                        >
                          <button
                            class="execution-artifact-toggle"
                            onClick={() => toggleArtifact(entry.url)}
                          >
                            <span class="execution-artifact-name">{entry.name || 'Untitled'}</span>
                            <span class="execution-artifact-type">{entry.type}</span>
                          </button>
                          <Show when={isArtifactExpanded(entry.url)}>
                            <div class="execution-artifact-preview">
                              <patchwork-view
                                attr:doc-url={entry.projectionDocUrl ?? entry.url}
                                attr:tool-id={entry.projectionDocUrl ? 'grjte-artifact-sheet' : undefined}
                                style="display:block;width:100%;height:100%;"
                              />
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function TaskRow(props: { url: AutomergeUrl; index: number }) {
  const [task] = useDocument<TaskDoc>(() => props.url);

  return (
    <Show when={task()} fallback={<div class="execution-task-card">Loading task...</div>}>
      {(currentTask) => {
        const status = () => currentTask().status ?? 'pending';

        return (
          <div class="execution-task-card">
            <div class="execution-task-header">
              <span class="execution-task-index">{props.index}</span>
              <span class="execution-task-goal">{currentTask().goal || 'Untitled task'}</span>
              <span class={`execution-task-status ${status()}`}>{formatStatus(status())}</span>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

function formatStatus(status: string) {
  if (status === 'in-progress') return 'In Progress';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}
