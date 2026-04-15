import { render } from "solid-js/web";
import { For, Show } from "solid-js";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-solid-primitives";
import type { ToolRender, ToolElement } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, AutomergeUrl } from "@automerge/automerge-repo";
import type { TaskListPlanDoc, TaskDoc } from "./types";
import { useTitle } from "../hooks/useTitle";
import { VersionBadge } from "../version";
import "./plan.css";

export const PlanTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PlanView
          handle={handle as DocHandle<TaskListPlanDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function openDocument(element: ToolElement, url: AutomergeUrl, toolId: string) {
  element.dispatchEvent(
    new CustomEvent("patchwork:open-document", {
      detail: { url, toolId },
      bubbles: true,
      composed: true,
    }),
  );
}

function PlanView(props: {
  handle: DocHandle<TaskListPlanDoc>;
  element: ToolElement;
}) {
  const [doc] = useDocument<TaskListPlanDoc>(() => props.handle.url);

  return (
    <div class="plan-root">
      <Show
        when={doc()}
        fallback={<div class="plan-loading">Loading plan…</div>}
      >
        {(currentDoc) => (
          <>
            <div class="plan-header">
              <div class="plan-header-left">
                <Show when={currentDoc().specDocUrl}>
                  {(specUrl) => (
                    <button
                      class="plan-header-link"
                      onClick={() =>
                        openDocument(
                          props.element,
                          specUrl(),
                          "grjte-spec-viewer",
                        )
                      }
                    >
                      Spec
                    </button>
                  )}
                </Show>
              </div>
              <div class="plan-header-right">
                <VersionBadge />
              </div>
            </div>

            <div class="plan-content">
              <div class="plan-goal">{currentDoc().goal || "Untitled plan"}</div>

              <Show when={currentDoc().specDocUrl}>
                {(specUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() =>
                        openDocument(
                          props.element,
                          specUrl(),
                          "grjte-spec-viewer",
                        )
                      }
                    >
                      View Spec
                    </button>
                  </div>
                )}
              </Show>

              <Show when={(currentDoc().tasks?.length ?? 0) > 0}>
                <div class="plan-section">
                  <div class="plan-section-label">Tasks</div>
                  <div class="plan-task-list">
                    <For each={currentDoc().tasks}>
                      {(url, index) => (
                        <TaskCard
                          url={url}
                          index={index() + 1}
                          element={props.element}
                        />
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function TaskCard(props: {
  url: AutomergeUrl;
  index: number;
  element: ToolElement;
}) {
  const [task] = useDocument<TaskDoc>(() => props.url);

  return (
    <Show when={task()}>
      {(currentTask) => (
        <div class="plan-task-card">
          <div class="plan-task-header">
            <span class="plan-task-index">{props.index}</span>
            <span class="plan-task-goal">
              {currentTask().goal || "Untitled task"}
            </span>
          </div>
          <Show when={(currentTask().dependsOn?.length ?? 0) > 0}>
            <div class="plan-dep-list">
              <For each={currentTask().dependsOn}>
                {(depUrl) => (
                  <DependencyPill url={depUrl} element={props.element} />
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function DependencyPill(props: { url: AutomergeUrl; element: ToolElement }) {
  const title = useTitle(() => props.url);

  return (
    <button
      class="plan-dep-pill"
      onClick={() =>
        openDocument(props.element, props.url, "grjte-spec-viewer")
      }
    >
      <span class="plan-dep-dot" />
      <span class="plan-dep-name">{title()}</span>
    </button>
  );
}
