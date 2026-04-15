import { render } from "solid-js/web";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  RepoContext,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-solid-primitives";
import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";
import type { ToolRender, ToolElement } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, AutomergeUrl } from "@automerge/automerge-repo";
import type { Heads } from "@automerge/automerge";
import type {
  SpecDoc,
  ValidationDoc,
  WorkflowArtifactDoc,
} from "../workflow-types";
import type { LLMProcessDoc, ChatMessagePart } from "../llm/types";
import { runWorkspaceLLM } from "../llm/llm-process";
import type { TaskListExecutionDoc } from "../execution/types";
import type { DatalogDoc } from "../spec/types";
import type {
  VerificationArtifactInput,
  VerificationDataInput,
  VerificationEvaluation,
} from "./evaluate-verification";
import { evaluateVerification } from "./evaluate-verification";
import type { ConstraintViolation } from "../datalog-runtime";
import {
  buildArtifactProjectionProvenance,
  deriveConstraintAnnotationsForArtifact,
  type ArtifactProjectionAnnotation,
  type ArtifactFolderEntry,
  type ProjectionDoc,
} from "../artifact-projection/artifact-projection";
import {
  flattenSpecTree,
  getArtifactsForSpec,
  type FlattenedVerification,
  type SpecTreeNode,
  watchSpecTree,
} from "./verification-assembly";
import { VersionBadge } from "../version";
import "./verification-datalog.css";
import "./validation.css";

type FolderDoc = {
  docs: ArtifactFolderEntry[];
};

type EvaluatedVerificationEntry = {
  entry: FlattenedVerification;
  evaluation: VerificationEvaluation;
};

type ArtifactVerificationSummary = {
  total: number;
  failing: number;
  passing: number;
  status: "pass" | "fail" | "none";
  label: string;
};

export const ValidationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ValidationView
          handle={handle as DocHandle<ValidationDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ValidationView(props: {
  handle: DocHandle<ValidationDoc>;
  element: ToolElement;
}) {
  const [doc] = useDocument<ValidationDoc>(() => props.handle.url);
  const [execution] = useDocument<TaskListExecutionDoc>(
    () => doc()?.executionDocUrl,
  );
  const [folder] = useDocument<FolderDoc>(
    () => execution()?.artifactsFolderUrl,
  );
  const [expandedArtifacts, setExpandedArtifacts] = createSignal<
    AutomergeUrl[]
  >([]);
  const [liveHeadsByDocUrl, setLiveHeadsByDocUrl] = createSignal<
    Record<AutomergeUrl, Heads>
  >({});

  function toggleArtifact(url: AutomergeUrl) {
    setExpandedArtifacts((current) =>
      current.includes(url)
        ? current.filter((entry) => entry !== url)
        : [...current, url],
    );
  }

  function isArtifactExpanded(url: AutomergeUrl) {
    return expandedArtifacts().includes(url);
  }

  function handleApprove() {
    props.handle.change((d) => {
      d.isValidated = true;
      d.headsByDocUrl = cloneHeadsByDocUrl(liveHeadsByDocUrl());
    });
  }

  function openDocument(url: AutomergeUrl, toolId: string) {
    props.element.dispatchEvent(
      new CustomEvent("patchwork:open-document", {
        detail: { url, toolId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  return (
    <div class="validation-root">
      <Show
        when={doc()}
        fallback={<div class="validation-loading">Loading validation...</div>}
      >
        {(currentDoc) => (
          <>
            <div class="validation-header">
              <div
                class="validation-status"
                classList={{ validated: currentDoc().isValidated }}
              >
                {currentDoc().isValidated ? "Validated" : "Pending"}
              </div>
              <VersionBadge />
              <Show when={currentDoc().specDocUrl}>
                {(specUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() =>
                        openDocument(specUrl(), "grjte-spec-viewer")
                      }
                    >
                      View Spec
                    </button>
                  </div>
                )}
              </Show>
              <Show when={currentDoc().planDocUrl}>
                {(planUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() =>
                        openDocument(planUrl(), "grjte-plan-viewer")
                      }
                    >
                      View Plan
                    </button>
                  </div>
                )}
              </Show>
              <Show when={currentDoc().executionDocUrl}>
                {(executionUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() =>
                        openDocument(executionUrl(), "grjte-execution-viewer")
                      }
                    >
                      View Execution
                    </button>
                  </div>
                )}
              </Show>
              <Show when={!currentDoc().isValidated}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  Validate
                </button>
              </Show>
            </div>

            <Show when={execution()}>
              {(currentExecution) => (
                <Show when={folder()}>
                  {(currentFolder) => (
                    <ValidationBody
                      repo={props.element.repo}
                      execution={currentExecution()}
                      validationDoc={currentDoc()}
                      validationHandle={props.handle}
                      specDocUrl={currentDoc().specDocUrl}
                      artifactEntries={currentFolder().docs ?? []}
                      toggleArtifact={toggleArtifact}
                      isArtifactExpanded={isArtifactExpanded}
                      onHeadsChanged={setLiveHeadsByDocUrl}
                      projectionProcessUrl={currentDoc().projectionProcessUrl}
                    />
                  )}
                </Show>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function ValidationBody(props: {
  repo: any;
  execution: TaskListExecutionDoc;
  validationDoc: ValidationDoc;
  validationHandle: DocHandle<ValidationDoc>;
  specDocUrl: AutomergeUrl;
  artifactEntries: FolderDoc["docs"];
  toggleArtifact: (url: AutomergeUrl) => void;
  isArtifactExpanded: (url: AutomergeUrl) => boolean;
  onHeadsChanged: (headsByDocUrl: Record<AutomergeUrl, Heads>) => void;
  projectionProcessUrl?: AutomergeUrl;
}) {
  const artifactAccessors = props.artifactEntries.map((entry) => {
    const [workflowArtifact, workflowArtifactHandle] =
      useDocument<WorkflowArtifactDoc>(() => entry.url);
    const [doc, docHandle] = useDocument<DatalogDoc>(
      () => workflowArtifact()?.artifactDocUrl,
    );
    const [specDoc, specHandle] = useDocument<SpecDoc>(
      () => workflowArtifact()?.specDocUrl,
    );
    const [projectionDoc, projectionHandle] = useDocument<ProjectionDoc>(
      () => specDoc()?.spec?.projectionDocUrl,
    );
    return {
      entry,
      workflowArtifact,
      workflowArtifactHandle,
      doc,
      docHandle,
      specDoc,
      specHandle,
      projectionDoc,
      projectionHandle,
    };
  });
  const [specTree, setSpecTree] = createSignal<SpecTreeNode | null>(null);
  const [specTreeLoading, setSpecTreeLoading] = createSignal(true);
  const [projectionExpanded, setProjectionExpanded] = createSignal(false);

  createEffect(() => {
    const url = props.specDocUrl;
    let active = true;
    let dispose: (() => void) | undefined;
    setSpecTreeLoading(true);

    void watchSpecTree(props.repo, url, (tree) => {
      if (!active) return;
      setSpecTree(tree);
      setSpecTreeLoading(false);
    }).then((cleanup) => {
      if (!active) {
        cleanup();
        return;
      }
      dispose = cleanup;
    });

    onCleanup(() => {
      active = false;
      dispose?.();
    });
  });

  const projectionProvenanceByUrl = createMemo(() => {
    const entries = artifactAccessors.flatMap(
      ({ entry, workflowArtifact, doc, specDoc, projectionDoc }) => {
        const currentWorkflowArtifact = workflowArtifact();
        const currentDoc = doc();
        const currentSpec = specDoc();
        const currentProjection = projectionDoc();
        const currentProjectionUrl = currentSpec?.spec?.projectionDocUrl;
        if (
          !currentWorkflowArtifact ||
          !currentDoc ||
          !currentProjection ||
          !currentProjectionUrl
        )
          return [];
        return [
          [
            entry.url,
            buildArtifactProjectionProvenance(currentProjection, currentDoc, {
              projectionUrl: currentProjectionUrl,
            }),
          ] as const,
        ];
      },
    );
    return new Map(entries);
  });

  const artifactInputs = createMemo<VerificationArtifactInput[]>(() =>
    artifactAccessors.flatMap(({ entry, workflowArtifact, doc }) => {
      const currentWorkflowArtifact = workflowArtifact();
      const currentDoc = doc();
      if (!currentWorkflowArtifact || !currentDoc) return [];
      return [
        {
          url: currentWorkflowArtifact.artifactDocUrl,
          name:
            currentWorkflowArtifact.name ||
            currentDoc?.title ||
            "Untitled artifact",
          specDocUrl: currentWorkflowArtifact.specDocUrl,
          doc: currentDoc,
        },
      ];
    }),
  );

  const liveHeadsByDocUrl = createMemo<Record<AutomergeUrl, Heads>>(() => {
    const next: Record<AutomergeUrl, Heads> = {};
    for (const {
      entry,
      workflowArtifact,
      workflowArtifactHandle,
      docHandle,
      specHandle,
      projectionHandle,
    } of artifactAccessors) {
      const currentWorkflowArtifact = workflowArtifactHandle();
      if (currentWorkflowArtifact?.isReady()) {
        next[entry.url] = currentWorkflowArtifact.heads() as Heads;
      }
      const currentDocHandle = docHandle();
      if (currentDocHandle?.isReady())
        next[currentDocHandle.url] = currentDocHandle.heads() as Heads;
      const currentSpecHandle = specHandle();
      if (currentSpecHandle?.isReady()) {
        const currentWorkflowArtifactDoc = workflowArtifact();
        if (currentWorkflowArtifactDoc) {
          next[currentWorkflowArtifactDoc.specDocUrl] =
            currentSpecHandle.heads() as Heads;
        }
      }
      const currentProjectionHandle = projectionHandle();
      const currentProjectionUrl =
        currentSpecHandle?.doc()?.spec?.projectionDocUrl;
      if (currentProjectionUrl && currentProjectionHandle?.isReady()) {
        next[currentProjectionUrl] = currentProjectionHandle.heads() as Heads;
      }
    }
    return next;
  });

  createEffect(() => {
    props.onHeadsChanged(liveHeadsByDocUrl());
  });

  createEffect(() => {
    if (!props.validationDoc.isValidated) return;
    if (
      !headsByDocUrlDiffer(
        props.validationDoc.headsByDocUrl,
        liveHeadsByDocUrl(),
      )
    )
      return;

    props.validationHandle.change((doc) => {
      if (doc.isValidated) {
        doc.isValidated = false;
      }
    });
  });

  const flattenedVerifications = createMemo<FlattenedVerification[]>(() =>
    flattenSpecTree(specTree()),
  );

  const verificationResults = createMemo<EvaluatedVerificationEntry[]>(() =>
    flattenedVerifications()
      .map((entry) => {
        const dataInputs: VerificationDataInput[] = entry.dataDocs.map(
          (dataDoc) => ({
            url: dataDoc.url,
            name: dataDoc.name || dataDoc.title || "Untitled data doc",
            doc: dataDoc.datalogDoc,
          }),
        );
        const evaluation = evaluateVerification(
          entry.verification,
          entry.verification.datalogDoc,
          dataInputs,
          getArtifactsForSpec(
            entry.specDocUrl,
            artifactInputs(),
            entry.targetKind === "global",
          ),
          {
            kind: entry.targetKind,
            label: entry.nodeGoal,
          },
        );
        return evaluation ? { entry, evaluation } : null;
      })
      .filter((entry): entry is EvaluatedVerificationEntry => Boolean(entry))
      .sort(
        (a, b) => Number(a.evaluation.passed) - Number(b.evaluation.passed),
      ),
  );

  const summary = createMemo(() => {
    const evaluations = verificationResults().map((entry) => entry.evaluation);
    const globalEvaluations = evaluations.filter(
      (evaluation) => evaluation.targetKind === "global",
    );
    const scopedEvaluations = evaluations.filter(
      (evaluation) => evaluation.targetKind === "scoped",
    );

    return {
      allPassed: evaluations.every((evaluation) => evaluation.passed),
      total: evaluations.length,
      passing: evaluations.filter((evaluation) => evaluation.passed).length,
      failing: evaluations.filter((evaluation) => !evaluation.passed).length,
      globalPassing: globalEvaluations.filter((evaluation) => evaluation.passed)
        .length,
      globalTotal: globalEvaluations.length,
      scopedPassing: scopedEvaluations.filter((evaluation) => evaluation.passed)
        .length,
      scopedTotal: scopedEvaluations.length,
    };
  });

  const artifactStatusByUrl = createMemo<
    Record<string, ArtifactVerificationSummary>
  >(() => {
    const statuses: Record<string, ArtifactVerificationSummary> =
      Object.fromEntries(
        props.artifactEntries.map((entry) => [
          entry.url,
          buildArtifactVerificationSummary(0, 0),
        ]),
      );

    for (const result of verificationResults()) {
      const relevantArtifacts = artifactAccessors.filter(
        ({ workflowArtifact }) =>
          workflowArtifact() &&
          getArtifactsForSpec(
            result.entry.specDocUrl,
            [
              {
                url: workflowArtifact()!.artifactDocUrl,
                specDocUrl: workflowArtifact()!.specDocUrl,
              },
            ],
            result.entry.targetKind === "global",
          ).length > 0,
      );
      for (const artifact of relevantArtifacts) {
        const current = statuses[artifact.entry.url] ?? {
          total: 0,
          failing: 0,
          passing: 0,
          status: "none" as ArtifactVerificationSummary["status"],
          label: "No verifications",
        };
        current.total += 1;
        if (result.evaluation.passed) current.passing += 1;
        else current.failing += 1;
        statuses[artifact.entry.url] = buildArtifactVerificationSummary(
          current.total,
          current.failing,
        );
      }
    }

    return statuses;
  });

  const constraintAnnotationsByArtifact = createMemo<
    Record<AutomergeUrl, ArtifactProjectionAnnotation[]>
  >(() => {
    const next: Record<AutomergeUrl, ArtifactProjectionAnnotation[]> = {};

    for (const {
      entry,
      workflowArtifact,
      projectionDoc,
    } of artifactAccessors) {
      const currentWorkflowArtifact = workflowArtifact();
      const currentProjection = projectionDoc();
      const currentExpandedArtifact = projectionProvenanceByUrl().get(
        entry.url,
      );
      if (
        !currentWorkflowArtifact ||
        !currentProjection ||
        !currentExpandedArtifact
      ) {
        next[entry.url] = [];
        continue;
      }

      const failingConstraints = verificationResults().flatMap((result) => {
        const relevant = getArtifactsForSpec(
          result.entry.specDocUrl,
          [
            {
              url: currentWorkflowArtifact.artifactDocUrl,
              specDocUrl: currentWorkflowArtifact.specDocUrl,
            },
          ],
          result.entry.targetKind === "global",
        );
        if (relevant.length === 0) return [];
        return result.evaluation.constraints
          .filter((constraint) => !constraint.passed)
          .map((constraint) => ({
            constraintLabel: constraint.label,
            violations: constraint.violations,
          }));
      });

      next[entry.url] = deriveConstraintAnnotationsForArtifact(
        currentProjection,
        currentWorkflowArtifact.artifactDocUrl,
        currentExpandedArtifact,
        failingConstraints,
      );
    }

    return next;
  });

  const artifactDisplayByUrl = createMemo<
    Record<
      AutomergeUrl,
      {
        name: string;
        specLabel: string;
      }
    >
  >(() =>
    Object.fromEntries(
      artifactAccessors.map(({ entry, workflowArtifact }) => {
        const currentWorkflowArtifact = workflowArtifact();
        return [
          entry.url,
          {
            name:
              currentWorkflowArtifact?.name ||
              entry.name ||
              "Untitled artifact",
            specLabel:
              currentWorkflowArtifact?.specDocUrl?.slice(-8) ?? "loading",
          },
        ];
      }),
    ),
  );

  return (
    <div class="validation-body">
      <Show when={specTreeLoading()}>
        <div class="validation-loading-inline">
          Resolving verification definitions...
        </div>
      </Show>

      <Show when={verificationResults().length > 0}>
        <div class="validation-section">
          <div class="validation-section-label">Verification Summary</div>
          <div class="validation-summary-card">
            <div class="validation-summary-header">
              <div class="validation-summary-title">
                {summary().allPassed
                  ? "All required verifications pass"
                  : "Verification issues detected"}
              </div>
              <span
                class="validation-summary-status"
                classList={{
                  pass: summary().allPassed,
                  fail: !summary().allPassed,
                }}
              >
                {summary().allPassed ? "Pass" : "Fail"}
              </span>
            </div>
            <div class="validation-summary-metrics">
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">
                  All verifications
                </span>
                <span class="validation-summary-metric-value">
                  {summary().passing}/{summary().total} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">
                  Global checks
                </span>
                <span class="validation-summary-metric-value">
                  {summary().globalPassing}/{summary().globalTotal} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">
                  Scoped checks
                </span>
                <span class="validation-summary-metric-value">
                  {summary().scopedPassing}/{summary().scopedTotal} passing
                </span>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={props.artifactEntries.length > 0}>
        <div class="validation-section">
          <div class="validation-section-label">Projection</div>
          <div class="validation-artifact-list">
            <div
              class="validation-artifact-card"
              classList={{ expanded: projectionExpanded() }}
            >
              <button
                class="validation-artifact-toggle"
                onClick={() => setProjectionExpanded((v) => !v)}
              >
                <span class="validation-artifact-heading">
                  <span class="validation-artifact-name">
                    {props.artifactEntries.length} artifact projection view
                    {props.artifactEntries.length !== 1 ? "s" : ""}
                  </span>
                </span>
              </button>
              <Show when={projectionExpanded()}>
                <ProjectionSection
                  artifactEntries={props.artifactEntries}
                  processUrl={props.projectionProcessUrl}
                  validationHandle={props.validationHandle}
                />
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <div class="validation-section">
        <div class="validation-section-label">Artifacts</div>
        <Show
          when={props.artifactEntries.length > 0}
          fallback={<div class="validation-empty">No artifacts available.</div>}
        >
          <div class="validation-artifact-list">
            <For each={props.artifactEntries}>
              {(entry) => (
                <div
                  class="validation-artifact-card"
                  classList={{ expanded: props.isArtifactExpanded(entry.url) }}
                >
                  <button
                    class="validation-artifact-toggle"
                    onClick={() => props.toggleArtifact(entry.url)}
                  >
                    <span class="validation-artifact-heading">
                      <span class="validation-artifact-name">
                        {artifactDisplayByUrl()[entry.url]?.name ||
                          entry.name ||
                          "Untitled"}
                      </span>
                      <ArtifactStatusPill
                        summary={
                          artifactStatusByUrl()[entry.url] ?? {
                            total: 0,
                            failing: 0,
                            passing: 0,
                            status: "none",
                            label: "No verifications",
                          }
                        }
                      />
                    </span>
                    <span class="validation-artifact-meta">
                      <span class="validation-artifact-scope">
                        {artifactDisplayByUrl()[entry.url]?.specLabel ||
                          "loading"}
                      </span>
                      <span class="validation-artifact-type">{entry.type}</span>
                    </span>
                  </button>
                  <Show when={props.isArtifactExpanded(entry.url)}>
                    <div class="validation-artifact-preview">
                      <ArtifactPreviewSwitcher
                        workflowArtifactUrl={entry.url}
                        constraintAnnotations={
                          constraintAnnotationsByArtifact()[entry.url] ?? []
                        }
                      />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="validation-section">
        <div class="validation-section-label">Verification Results</div>
        <Show
          when={verificationResults().length > 0}
          fallback={
            <div class="validation-empty">No verifications available.</div>
          }
        >
          <div class="validation-results-list">
            <For each={verificationResults()}>
              {(result) => <ValidationResultCard result={result} />}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ProjectionSection(props: {
  artifactEntries: FolderDoc["docs"];
  processUrl?: AutomergeUrl;
  validationHandle: DocHandle<ValidationDoc>;
}) {
  const repo = useRepo();
  const [processDoc] = useDocument<LLMProcessDoc>(() => props.processUrl);
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [followUpText, setFollowUpText] = createSignal("");
  let containerRef: HTMLDivElement | undefined;
  let isAtBottom = true;

  const isRunning = createMemo(() =>
    processDoc() ? !processDoc()!.done : false,
  );

  createEffect(() => {
    processDoc();
    if (isAtBottom && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  function handleScroll() {
    if (!containerRef) return;
    isAtBottom =
      containerRef.scrollTop + containerRef.clientHeight >=
      containerRef.scrollHeight - 20;
  }

  async function handleFollowUp() {
    const text = followUpText().trim();
    if (!text || isRunning() || !processDoc()) return;
    setFollowUpText("");

    const previousMessages = processDoc()?.messages ?? [];

    const newProcessHandle = repo.create<LLMProcessDoc>();
    newProcessHandle.change((d) => {
      d.config = {
        apiUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-4.6",
      };
      d.llmConfigFolderUrl = processDoc()!.llmConfigFolderUrl;
      d.messages = [
        ...JSON.parse(JSON.stringify(previousMessages)),
        { role: "user", content: [{ type: "text", text }] },
      ];
      d.done = false;
    });

    props.validationHandle.change((d) => {
      d.projectionProcessUrl = newProcessHandle.url;
    });

    runWorkspaceLLM(repo, newProcessHandle.url).catch((err) => {
      console.error("[validation] projection follow-up error", err);
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleFollowUp();
    }
  }

  const projectionEntries = createMemo(() =>
    props.artifactEntries.filter((entry) => entry.type === "workflow-artifact"),
  );

  return (
    <div class="projection-split">
      <div class="projection-content">
        <Show
          when={projectionEntries().length > 0}
          fallback={
            <div class="validation-empty">
              {isRunning()
                ? "Generating projections..."
                : "No projections yet."}
            </div>
          }
        >
          <div class="projection-summary">
            <For each={projectionEntries()}>
              {(entry) => <ProjectionSummaryCard entry={entry} />}
            </For>
          </div>
        </Show>
      </div>

      <Show when={props.processUrl}>
        <div
          class={`projection-sidebar${isSidebarOpen() ? "" : " projection-sidebar-collapsed"}`}
        >
          <button
            class="projection-sidebar-toggle"
            onClick={() => setIsSidebarOpen((open) => !open)}
            title={isSidebarOpen() ? "Collapse chat" : "Expand chat"}
            type="button"
          >
            {isSidebarOpen() ? "\u203A" : "\u2039"}
          </button>

          <Show when={isSidebarOpen()}>
            <>
              <div
                class="projection-chat"
                ref={containerRef}
                onScroll={handleScroll}
              >
                <Show when={processDoc()}>
                  {(pd) => (
                    <>
                      <For each={pd().messages}>
                        {(msg) => <ProjectionMessageView message={msg} />}
                      </For>
                      <Show when={!pd().done}>
                        <div class="projection-thinking">
                          <div class="projection-dot" />
                          <div class="projection-dot" />
                          <div class="projection-dot" />
                        </div>
                      </Show>
                    </>
                  )}
                </Show>
              </div>

              <div class="projection-followup">
                <textarea
                  class="projection-followup-input"
                  placeholder="Ask for changes to the projection..."
                  value={followUpText()}
                  onInput={(e) => setFollowUpText(e.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isRunning()}
                  rows={2}
                />
                <button
                  class="projection-followup-btn"
                  onClick={handleFollowUp}
                  disabled={isRunning() || !followUpText().trim()}
                >
                  Send
                </button>
              </div>
            </>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function ProjectionSummaryCard(props: { entry: ArtifactFolderEntry }) {
  const [workflowArtifact] = useDocument<WorkflowArtifactDoc>(
    () => props.entry.url,
  );
  const [specDoc] = useDocument<SpecDoc>(() => workflowArtifact()?.specDocUrl);
  const [projectionDoc] = useDocument<ProjectionDoc>(
    () => specDoc()?.spec?.projectionDocUrl,
  );

  return (
    <div class="projection-card">
      <div class="projection-card-header">
        <span class="projection-card-name">
          {workflowArtifact()?.name || props.entry.name || "Untitled"}
        </span>
        <Show
          when={projectionDoc()}
          fallback={<span class="projection-card-meta">No projection</span>}
        >
          {(pd) => (
            <span class="projection-card-meta">
              {(pd().viewKind ?? "table") === "key-value"
                ? `${pd().entries?.length ?? 0} entries`
                : `${pd().columns?.length ?? 0} columns`}
            </span>
          )}
        </Show>
      </div>
      <Show when={projectionDoc()}>
        {(pd) => (
          <div class="projection-card-columns">
            <Show
              when={(pd().viewKind ?? "table") === "key-value"}
              fallback={
                <For each={pd().columns ?? []}>
                  {(col) => (
                    <span
                      class="projection-card-column"
                      classList={{ "read-only": !col.write }}
                    >
                      {col.header}
                      <span class="projection-card-column-type">
                        {col.cellType}
                      </span>
                    </span>
                  )}
                </For>
              }
            >
              <For each={pd().entries ?? []}>
                {(entry) => (
                  <span
                    class="projection-card-column"
                    classList={{ "read-only": !entry.write }}
                  >
                    {entry.label}
                    <span class="projection-card-column-type">
                      {entry.cellType}
                    </span>
                  </span>
                )}
              </For>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function ProjectionMessageView(props: {
  message: { role: string; content: ChatMessagePart[] };
}) {
  return (
    <div class={`projection-msg projection-msg-${props.message.role}`}>
      <For each={props.message.content}>
        {(part) => <ProjectionPartView part={part} />}
      </For>
    </div>
  );
}

function ProjectionPartView(props: { part: ChatMessagePart }) {
  return (
    <Show
      when={props.part.type === "script" ? props.part : undefined}
      fallback={
        <Show when={props.part.type === "text" ? props.part : undefined}>
          {(p) => (
            <SolidMarkdown remarkPlugins={[remarkGfm]}>
              {(p() as { type: "text"; text: string }).text}
            </SolidMarkdown>
          )}
        </Show>
      }
    >
      {(sp) => {
        const s = sp() as {
          type: "script";
          code: string;
          description?: string;
          output?: string;
          error?: string;
        };
        return (
          <div class="projection-script">
            <Show when={s.description}>
              {(d) => <div class="projection-script-header">{d()}</div>}
            </Show>
            <div class="projection-script-code">{s.code}</div>
            <Show when={s.output}>
              {(o) => <div class="projection-script-output">{o()}</div>}
            </Show>
            <Show when={s.error}>
              {(e) => <div class="projection-script-error">{e()}</div>}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

function ArtifactStatusPill(props: { summary: ArtifactVerificationSummary }) {
  return (
    <span
      class="validation-artifact-status"
      classList={{
        pass: props.summary.status === "pass",
        fail: props.summary.status === "fail",
        idle: props.summary.status === "none",
      }}
    >
      {props.summary.label}
    </span>
  );
}

function buildArtifactVerificationSummary(
  total: number,
  failing: number,
): ArtifactVerificationSummary {
  if (total === 0) {
    return {
      total,
      failing,
      passing: 0,
      status: "none",
      label: "No verifications",
    };
  }

  return {
    total,
    failing,
    passing: total - failing,
    status: failing > 0 ? "fail" : "pass",
    label: failing > 0 ? "Verification failed" : "Verification passed",
  };
}

function ValidationResultCard(props: { result: EvaluatedVerificationEntry }) {
  const [expanded, setExpanded] = createSignal(!props.result.evaluation.passed);
  const orderedConstraints = createMemo(() =>
    [...props.result.evaluation.constraints].sort(
      (a, b) => Number(a.passed) - Number(b.passed),
    ),
  );

  return (
    <div class="verification-card">
      <button
        class="verification-summary validation"
        classList={{
          pass: props.result.evaluation.passed,
          fail: !props.result.evaluation.passed,
        }}
        onClick={() => setExpanded((value) => !value)}
      >
        <div class="verification-summary-main">
          <span
            class="verification-status-pill"
            classList={{
              pass: props.result.evaluation.passed,
              fail: !props.result.evaluation.passed,
            }}
          >
            {props.result.evaluation.passed ? "Pass" : "Fail"}
          </span>
          <div class="verification-summary-copy">
            <div class="verification-summary-title">
              {props.result.evaluation.title}
            </div>
            <div class="verification-summary-description">
              {props.result.evaluation.description}
            </div>
          </div>
        </div>
        <div class="verification-summary-meta">
          <span class="validation-result-target">
            {props.result.evaluation.targetKind === "global"
              ? "Global"
              : "Scoped"}
            : {props.result.evaluation.targetLabel}
          </span>
          <span class="verification-expand-label">
            {expanded() ? "Hide details" : "Show details"}
          </span>
        </div>
      </button>

      <Show when={expanded()}>
        <div class="verification-details">
          <div class="verification-evidence">
            <div class="verification-evidence-card">
              <div class="verification-evidence-header">
                <div class="verification-evidence-title">
                  Constraint violations
                </div>
                <span class="validation-result-node">
                  {props.result.entry.nodePath}
                </span>
              </div>

              <div class="verification-constraint-list">
                <For each={orderedConstraints()}>
                  {(constraint) => (
                    <div
                      class="verification-constraint-item"
                      classList={{
                        pass: constraint.passed,
                        fail: !constraint.passed,
                      }}
                    >
                      <span class="verification-constraint-icon">
                        {constraint.passed ? "\u2713" : "\u2717"}
                      </span>
                      <div class="verification-constraint-body">
                        <div class="verification-constraint-text">
                          {constraint.label}
                        </div>
                        <Show when={!constraint.passed}>
                          <div class="verification-witness-list">
                            <For each={constraint.violations}>
                              {(violation) => (
                                <For each={violation.witnesses}>
                                  {(witness) => (
                                    <WitnessCard witness={witness} />
                                  )}
                                </For>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              <div class="verification-source-section">
                <div class="verification-source-label">Combined datalog</div>
                <pre class="verification-source-code">
                  {props.result.evaluation.combinedSource}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function ArtifactWorkspace(props: {
  workflowArtifactUrl: AutomergeUrl;
  constraintAnnotations: ArtifactProjectionAnnotation[];
}) {
  return (
    <div class="validation-artifact-view">
      <patchwork-view
        attr:doc-url={props.workflowArtifactUrl}
        attr:tool-id="grjte-artifact-projection"
        attr:data-annotations={JSON.stringify(props.constraintAnnotations)}
        style="display:block;width:100%;height:100%;"
      />
    </div>
  );
}

function ArtifactPreviewSwitcher(props: {
  workflowArtifactUrl: AutomergeUrl;
  constraintAnnotations: ArtifactProjectionAnnotation[];
}) {
  const [selectedView, setSelectedView] = createSignal<"raw" | "projection">(
    "projection",
  );
  const [workflowArtifact] = useDocument<WorkflowArtifactDoc>(
    () => props.workflowArtifactUrl,
  );
  const [specDoc] = useDocument<SpecDoc>(() => workflowArtifact()?.specDocUrl);
  const projectionDocUrl = createMemo(() => specDoc()?.spec?.projectionDocUrl);
  const [projectionDoc] = useDocument<ProjectionDoc>(() => projectionDocUrl());
  const hasProjection = createMemo(() => Boolean(projectionDocUrl()));
  const viewKindLabel = createMemo(() => {
    const kind = projectionDoc()?.viewKind ?? "table";
    return kind === "key-value" ? "Key-Value" : "Table";
  });

  createEffect(() => {
    if (!hasProjection() && selectedView() === "projection") {
      setSelectedView("raw");
    }
  });

  return (
    <div class="validation-artifact-workspace">
      <div class="validation-artifact-toolbar">
        <div class="validation-artifact-toolbar-main">
          <div class="validation-artifact-tabs">
            <button
              class="validation-artifact-tab"
              classList={{ active: selectedView() === "projection" }}
              onClick={() => setSelectedView("projection")}
              disabled={!hasProjection()}
              type="button"
            >
              {viewKindLabel()}
            </button>
            <button
              class="validation-artifact-tab"
              classList={{ active: selectedView() === "raw" }}
              onClick={() => setSelectedView("raw")}
              type="button"
            >
              Datalog
            </button>
          </div>
          <Show when={!hasProjection()}>
            <div class="validation-artifact-hint">No projection yet.</div>
          </Show>
        </div>
      </div>

      <Show
        when={workflowArtifact()?.artifactDocUrl}
        fallback={<div class="validation-empty">Loading artifact...</div>}
      >
        {(artifactUrl) => (
          <Show
            when={selectedView() === "projection"}
            fallback={
              <div class="validation-artifact-view">
                <patchwork-view
                  attr:doc-url={artifactUrl()}
                  style="display:block;width:100%;height:100%;"
                />
              </div>
            }
          >
            <ArtifactWorkspace
              workflowArtifactUrl={props.workflowArtifactUrl}
              constraintAnnotations={props.constraintAnnotations}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}

function WitnessCard(props: {
  witness: ConstraintViolation["witnesses"][number];
}) {
  const bindings = () => Object.entries(props.witness.bindings);

  return (
    <div class="verification-witness-card">
      <Show when={bindings().length > 0}>
        <div class="verification-witness-bindings">
          <For each={bindings()}>
            {([key, value]) => (
              <span class="verification-binding-pill">
                {key}={String(value)}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="verification-witness-steps">
        <For each={props.witness.steps}>
          {(step) => (
            <div class="verification-step">
              {step.kind === "fact" ? (
                <span class="verification-step-code">
                  {step.fact.pred}({step.fact.args.join(", ")})
                </span>
              ) : (
                <span class="verification-step-code">
                  {step.atom.pred}(
                  {step.resolvedArgs.map((arg) => String(arg)).join(", ")})
                </span>
              )}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function cloneHeadsByDocUrl(headsByDocUrl: Record<AutomergeUrl, Heads>) {
  return Object.fromEntries(
    Object.entries(headsByDocUrl).map(([url, heads]) => [
      url,
      [...heads] as Heads,
    ]),
  ) as Record<AutomergeUrl, Heads>;
}

function headsByDocUrlDiffer(
  left: Record<AutomergeUrl, Heads>,
  right: Record<AutomergeUrl, Heads>,
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return true;

  for (const [url, leftHeads] of leftEntries) {
    const rightHeads = right[url as AutomergeUrl];
    if (!rightHeads) return true;
    if (leftHeads.length !== rightHeads.length) return true;
    const leftSorted = [...leftHeads].sort();
    const rightSorted = [...rightHeads].sort();
    if (leftSorted.some((head, index) => head !== rightSorted[index]))
      return true;
  }

  return false;
}
