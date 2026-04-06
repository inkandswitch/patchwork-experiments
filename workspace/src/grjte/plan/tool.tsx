import { render } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { PlanDoc } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import './plan.css';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export const PlanTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PlanView handle={handle as DocHandle<PlanDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function PlanView(props: { handle: DocHandle<PlanDoc> }) {
  const [doc] = useDocument<PlanDoc>(() => props.handle.url);

  return (
    <div class="plan-root">
      <Show when={doc()} fallback={<div class="plan-loading">Loading plan…</div>}>
        {(currentDoc) => (
          <div class="plan-content">
            <div class="plan-goal">{currentDoc().goal || 'Untitled plan'}</div>

            <Show when={(currentDoc().dependsOn?.length ?? 0) > 0}>
              <div class="plan-section">
                <div class="plan-section-label">Dependencies</div>
                <div class="plan-dep-list">
                  <For each={currentDoc().dependsOn}>
                    {(url) => <DependencyItem url={url} />}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={currentDoc().artifactsFolderUrl}>
              {(folderUrl) => <ArtifactsSection folderUrl={folderUrl()} />}
            </Show>

            <Show when={currentDoc().specDocUrl}>
              {(specUrl) => (
                <div class="plan-section">
                  <div class="plan-section-label">Spec</div>
                  <div class="plan-embed">
                    <patchwork-view
                      attr:doc-url={specUrl()}
                      style="display:block;width:100%;height:100%;"
                    />
                  </div>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function DependencyItem(props: { url: AutomergeUrl }) {
  const title = useTitle(() => props.url);

  return (
    <div class="plan-dep-pill">
      <span class="plan-dep-dot" />
      <span class="plan-dep-name">{title()}</span>
    </div>
  );
}

function ArtifactsSection(props: { folderUrl: AutomergeUrl }) {
  const [folder] = useDocument<FolderDoc>(() => props.folderUrl);

  return (
    <Show when={(folder()?.docs?.length ?? 0) > 0}>
      <div class="plan-section">
        <div class="plan-section-label">Artifacts</div>
        <div class="plan-artifact-list">
          <For each={folder()!.docs}>
            {(entry) => (
              <div class="plan-artifact-card">
                <div class="plan-artifact-card-label">{entry.name}</div>
                <div class="plan-artifact-card-view">
                  <patchwork-view
                    attr:doc-url={entry.url}
                    style="display:block;width:100%;height:100%;"
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
