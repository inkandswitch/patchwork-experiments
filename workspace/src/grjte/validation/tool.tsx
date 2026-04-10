import { render } from 'solid-js/web';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { Heads } from '@automerge/automerge';
import type { ValidationDoc } from '../../workflow/types';
import type { TaskListExecutionDoc } from '../execution/types';
import type { DatalogDoc } from '../spec/datalog-doc';
import type {
  VerificationArtifactInput,
  VerificationDataInput,
  VerificationEvaluation,
} from './evaluate-verification';
import { evaluateVerification } from './evaluate-verification';
import type { ConstraintViolation } from './datalog-eval';
import {
  deriveConstraintAnnotationsForArtifact,
  expandArtifactDocForVerification,
  type ArtifactSheetAnnotation,
  type ArtifactFolderEntry,
  type ProjectionDoc,
} from '../artifact-projection';
import {
  flattenSpecTree,
  getArtifactsForNode,
  type FlattenedVerification,
  type SpecTreeNode,
  watchSpecTree,
} from './verification-assembly';
import './verification-datalog.css';
import './validation.css';

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
  status: 'pass' | 'fail' | 'none';
  label: string;
};

export const ValidationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ValidationView handle={handle as DocHandle<ValidationDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ValidationView(props: { handle: DocHandle<ValidationDoc>; element: ToolElement }) {
  const [doc] = useDocument<ValidationDoc>(() => props.handle.url);
  const [execution] = useDocument<TaskListExecutionDoc>(() => doc()?.executionDocUrl);
  const [folder] = useDocument<FolderDoc>(() => execution()?.artifactsFolderUrl);
  const [expandedArtifacts, setExpandedArtifacts] = createSignal<AutomergeUrl[]>([]);
  const [liveHeadsByDocUrl, setLiveHeadsByDocUrl] = createSignal<Record<AutomergeUrl, Heads>>({});

  function toggleArtifact(url: AutomergeUrl) {
    setExpandedArtifacts((current) =>
      current.includes(url) ? current.filter((entry) => entry !== url) : [...current, url],
    );
  }

  function isArtifactExpanded(url: AutomergeUrl) {
    return expandedArtifacts().includes(url);
  }

  function handleApprove() {
    props.handle.change((d) => {
      d.approval = {
        status: 'approved',
        headsByDocUrl: cloneHeadsByDocUrl(liveHeadsByDocUrl()),
      };
    });
  }

  function openDocument(url: AutomergeUrl, toolId: string) {
    props.element.dispatchEvent(
      new CustomEvent('patchwork:open-document', {
        detail: { url, toolId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  return (
    <div class="validation-root">
      <Show when={doc()} fallback={<div class="validation-loading">Loading validation...</div>}>
        {(currentDoc) => (
          <>
            <div class="validation-header">
              <div
                class="validation-status"
                classList={{ validated: currentDoc().approval.status === 'approved' }}
              >
                {formatApprovalStatus(currentDoc().approval.status)}
              </div>
              <Show when={currentDoc().specDocUrl}>
                {(specUrl) => (
                  <div class="plan-section">
                    <button
                      class="plan-spec-btn"
                      onClick={() => openDocument(specUrl(), 'grjte-spec-viewer')}
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
                      onClick={() => openDocument(planUrl(), 'grjte-plan-viewer')}
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
                      onClick={() => openDocument(executionUrl(), 'grjte-execution-viewer')}
                    >
                      View Execution
                    </button>
                  </div>
                )}
              </Show>
              <Show when={currentDoc().approval.status !== 'approved'}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  {currentDoc().approval.status === 'stale' ? 'Re-approve' : 'Approve'}
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
  artifactEntries: FolderDoc['docs'];
  toggleArtifact: (url: AutomergeUrl) => void;
  isArtifactExpanded: (url: AutomergeUrl) => boolean;
  onHeadsChanged: (headsByDocUrl: Record<AutomergeUrl, Heads>) => void;
}) {
  const artifactAccessors = props.artifactEntries.map((entry) => {
    const [doc, docHandle] = useDocument<DatalogDoc>(() => entry.url);
    const [projectionDoc, projectionHandle] = useDocument<ProjectionDoc>(() => entry.projectionDocUrl);
    return { entry, doc, docHandle, projectionDoc, projectionHandle };
  });
  const [specTree, setSpecTree] = createSignal<SpecTreeNode | null>(null);
  const [specTreeLoading, setSpecTreeLoading] = createSignal(true);

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

  const expandedArtifactsByUrl = createMemo(() => {
    const entries = artifactAccessors.flatMap(({ entry, doc, projectionDoc }) => {
      const currentDoc = doc();
      const currentProjection = projectionDoc();
      if (!currentDoc || !currentProjection) return [];
      return [[
        entry.url,
        expandArtifactDocForVerification(currentProjection, currentDoc, {
          projectionUrl: entry.projectionDocUrl,
        }),
      ] as const];
    });
    return new Map(entries);
  });

  const artifactInputs = createMemo<VerificationArtifactInput[]>(() =>
    artifactAccessors.map(({ entry, doc }) => {
      const currentDoc = doc();
      const expanded = expandedArtifactsByUrl().get(entry.url);
      return {
        url: entry.url,
        name: entry.name || currentDoc?.title || 'Untitled artifact',
        doc:
          currentDoc && expanded
            ? {
                ...currentDoc,
                facts: expanded.facts,
                draftText: expanded.draftText,
              }
            : currentDoc,
      };
    }),
  );

  const liveHeadsByDocUrl = createMemo<Record<AutomergeUrl, Heads>>(() => {
    const next: Record<AutomergeUrl, Heads> = {};
    for (const { entry, docHandle, projectionHandle } of artifactAccessors) {
      const currentDocHandle = docHandle();
      if (currentDocHandle?.isReady()) next[entry.url] = currentDocHandle.heads() as Heads;
      const currentProjectionHandle = projectionHandle();
      if (entry.projectionDocUrl && currentProjectionHandle?.isReady()) {
        next[entry.projectionDocUrl] = currentProjectionHandle.heads() as Heads;
      }
    }
    return next;
  });

  createEffect(() => {
    props.onHeadsChanged(liveHeadsByDocUrl());
  });

  createEffect(() => {
    if (props.validationDoc.approval.status !== 'approved') return;
    if (!headsByDocUrlDiffer(props.validationDoc.approval.headsByDocUrl, liveHeadsByDocUrl())) return;

    props.validationHandle.change((doc) => {
      if (doc.approval.status === 'approved') {
        doc.approval.status = 'stale';
      }
    });
  });

  const flattenedVerifications = createMemo<FlattenedVerification[]>(() =>
    flattenSpecTree(specTree()),
  );

  const verificationResults = createMemo<EvaluatedVerificationEntry[]>(() =>
    flattenedVerifications()
      .map((entry) => {
        const dataInputs: VerificationDataInput[] = entry.dataDocs.map((dataDoc) => ({
          url: dataDoc.url,
          name: dataDoc.name || dataDoc.title || 'Untitled data doc',
          doc: dataDoc.datalogDoc,
        }));
        const evaluation = evaluateVerification(
          entry.verification,
          entry.verification.datalogDoc,
          dataInputs,
          getArtifactsForNode(
            entry.nodePath,
            artifactInputs(),
            props.execution.artifactSpecPaths ?? {},
          ),
          {
            kind: entry.targetKind,
            label: entry.nodeGoal,
          },
        );
        return evaluation ? { entry, evaluation } : null;
      })
      .filter((entry): entry is EvaluatedVerificationEntry => Boolean(entry))
      .sort((a, b) => Number(a.evaluation.passed) - Number(b.evaluation.passed)),
  );

  const summary = createMemo(() => {
    const evaluations = verificationResults().map((entry) => entry.evaluation);
    const globalEvaluations = evaluations.filter(
      (evaluation) => evaluation.targetKind === 'global',
    );
    const scopedEvaluations = evaluations.filter(
      (evaluation) => evaluation.targetKind === 'scoped',
    );

    return {
      allPassed: evaluations.every((evaluation) => evaluation.passed),
      total: evaluations.length,
      passing: evaluations.filter((evaluation) => evaluation.passed).length,
      failing: evaluations.filter((evaluation) => !evaluation.passed).length,
      globalPassing: globalEvaluations.filter((evaluation) => evaluation.passed).length,
      globalTotal: globalEvaluations.length,
      scopedPassing: scopedEvaluations.filter((evaluation) => evaluation.passed).length,
      scopedTotal: scopedEvaluations.length,
    };
  });

  const artifactStatusByUrl = createMemo<Record<string, ArtifactVerificationSummary>>(() => {
    const statuses: Record<string, ArtifactVerificationSummary> = Object.fromEntries(
      props.artifactEntries.map((entry) => [
        entry.url,
        buildArtifactVerificationSummary(0, 0),
      ]),
    );

    for (const result of verificationResults()) {
      const relevantArtifacts = getArtifactsForNode(
        result.entry.nodePath,
        props.artifactEntries,
        props.execution.artifactSpecPaths ?? {},
      );
      for (const artifact of relevantArtifacts) {
        const current = statuses[artifact.url] ?? {
          total: 0,
          failing: 0,
          passing: 0,
          status: 'none' as ArtifactVerificationSummary['status'],
          label: 'No verifications',
        };
        current.total += 1;
        if (result.evaluation.passed) current.passing += 1;
        else current.failing += 1;
        statuses[artifact.url] = buildArtifactVerificationSummary(
          current.total,
          current.failing,
        );
      }
    }

    return statuses;
  });

  return (
    <div class="validation-body">
      <Show when={specTreeLoading()}>
        <div class="validation-loading-inline">Resolving verification definitions...</div>
      </Show>

      <Show when={verificationResults().length > 0}>
        <div class="validation-section">
          <div class="validation-section-label">Verification Summary</div>
          <div class="validation-summary-card">
            <div class="validation-summary-header">
              <div class="validation-summary-title">
                {summary().allPassed
                  ? 'All required verifications pass'
                  : 'Verification issues detected'}
              </div>
              <span
                class="validation-summary-status"
                classList={{ pass: summary().allPassed, fail: !summary().allPassed }}
              >
                {summary().allPassed ? 'Pass' : 'Fail'}
              </span>
            </div>
            <div class="validation-summary-metrics">
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">All verifications</span>
                <span class="validation-summary-metric-value">
                  {summary().passing}/{summary().total} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">Global checks</span>
                <span class="validation-summary-metric-value">
                  {summary().globalPassing}/{summary().globalTotal} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">Scoped checks</span>
                <span class="validation-summary-metric-value">
                  {summary().scopedPassing}/{summary().scopedTotal} passing
                </span>
              </div>
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
                      <span class="validation-artifact-name">{entry.name || 'Untitled'}</span>
                      <ArtifactStatusPill
                        summary={
                          artifactStatusByUrl()[entry.url] ?? {
                            total: 0,
                            failing: 0,
                            passing: 0,
                            status: 'none',
                            label: 'No verifications',
                          }
                        }
                      />
                    </span>
                    <span class="validation-artifact-meta">
                      <span class="validation-artifact-scope">{entry.specPath || 'root'}</span>
                      <span class="validation-artifact-type">{entry.type}</span>
                    </span>
                  </button>
                  <Show when={props.isArtifactExpanded(entry.url)}>
                    <div class="validation-artifact-preview">
                      <ArtifactWorkspace
                        entry={entry}
                        expandedArtifact={expandedArtifactsByUrl().get(entry.url) ?? null}
                        verificationResults={verificationResults().filter((result) =>
                          getArtifactsForNode(
                            result.entry.nodePath,
                            [entry],
                            props.execution.artifactSpecPaths ?? {},
                          ).length > 0,
                        )}
                        verificationSummary={
                          artifactStatusByUrl()[entry.url] ?? buildArtifactVerificationSummary(0, 0)
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
          fallback={<div class="validation-empty">No verifications available.</div>}
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

function ArtifactStatusPill(props: { summary: ArtifactVerificationSummary }) {
  return (
    <span
      class="validation-artifact-status"
      classList={{
        pass: props.summary.status === 'pass',
        fail: props.summary.status === 'fail',
        idle: props.summary.status === 'none',
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
      status: 'none',
      label: 'No verifications',
    };
  }

  return {
    total,
    failing,
    passing: total - failing,
    status: failing > 0 ? 'fail' : 'pass',
    label: failing > 0 ? 'Verification failed' : 'Verification passed',
  };
}

function ValidationResultCard(props: { result: EvaluatedVerificationEntry }) {
  const [expanded, setExpanded] = createSignal(!props.result.evaluation.passed);
  const orderedConstraints = createMemo(() =>
    [...props.result.evaluation.constraints].sort((a, b) => Number(a.passed) - Number(b.passed)),
  );

  return (
    <div class="verification-card">
      <button
        class="verification-summary validation"
        classList={{ pass: props.result.evaluation.passed, fail: !props.result.evaluation.passed }}
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
            {props.result.evaluation.passed ? 'Pass' : 'Fail'}
          </span>
          <div class="verification-summary-copy">
            <div class="verification-summary-title">{props.result.evaluation.title}</div>
            <div class="verification-summary-description">
              {props.result.evaluation.description}
            </div>
          </div>
        </div>
        <div class="verification-summary-meta">
          <span class="validation-result-target">
            {props.result.evaluation.targetKind === 'global' ? 'Global' : 'Scoped'}:{' '}
            {props.result.evaluation.targetLabel}
          </span>
          <span class="verification-expand-label">
            {expanded() ? 'Hide details' : 'Show details'}
          </span>
        </div>
      </button>

      <Show when={expanded()}>
        <div class="verification-details">
          <div class="verification-evidence">
            <div class="verification-evidence-card">
              <div class="verification-evidence-header">
                <div class="verification-evidence-title">Constraint violations</div>
                <span class="validation-result-node">{props.result.entry.nodePath}</span>
              </div>

              <div class="verification-constraint-list">
                <For each={orderedConstraints()}>
                  {(constraint) => (
                    <div
                      class="verification-constraint-item"
                      classList={{ pass: constraint.passed, fail: !constraint.passed }}
                    >
                      <span class="verification-constraint-icon">
                        {constraint.passed ? '\u2713' : '\u2717'}
                      </span>
                      <div class="verification-constraint-body">
                        <div class="verification-constraint-text">{constraint.label}</div>
                        <Show when={!constraint.passed}>
                          <div class="verification-witness-list">
                            <For each={constraint.violations}>
                              {(violation) => (
                                <For each={violation.witnesses}>
                                  {(witness) => <WitnessCard witness={witness} />}
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
                <pre class="verification-source-code">{props.result.evaluation.combinedSource}</pre>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

function WitnessCard(props: { witness: ConstraintViolation['witnesses'][number] }) {
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
              {step.kind === 'fact' ? (
                <span class="verification-step-code">
                  {step.fact.pred}({step.fact.args.join(', ')})
                </span>
              ) : (
                <span class="verification-step-code">
                  {step.atom.pred}({step.resolvedArgs.map((arg) => String(arg)).join(', ')})
                </span>
              )}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function ArtifactWorkspace(props: {
  entry: ArtifactFolderEntry;
  expandedArtifact: ReturnType<typeof expandArtifactDocForVerification> | null;
  verificationResults: EvaluatedVerificationEntry[];
  verificationSummary: ArtifactVerificationSummary;
}) {
  const [selectedView, setSelectedView] = createSignal<'sheet' | 'datalog'>(
    props.entry.projectionDocUrl ? 'sheet' : 'datalog',
  );
  const [datalogDoc] = useDocument<DatalogDoc>(() => props.entry.url);
  const [projectionDoc] = useDocument<ProjectionDoc>(() => props.entry.projectionDocUrl);

  const constraintAnnotations = createMemo<ArtifactSheetAnnotation[]>(() => {
    const currentExpandedArtifact = props.expandedArtifact;
    const currentProjection = projectionDoc();
    if (!currentExpandedArtifact || !currentProjection || !props.entry.projectionDocUrl) return [];

    const failingConstraints = props.verificationResults.flatMap((result) =>
      result.evaluation.constraints
        .filter((constraint) => !constraint.passed)
        .map((constraint) => ({
          constraintLabel: constraint.label,
          violations: constraint.violations,
        })),
    );

    if (!props.entry.projectionDocUrl) return [];

    return deriveConstraintAnnotationsForArtifact(
      currentProjection,
      props.entry.url,
      currentExpandedArtifact,
      failingConstraints,
      { projectionUrl: props.entry.projectionDocUrl },
    );
  });

  return (
    <div class="validation-artifact-workspace">
      <Show when={props.entry.projectionDocUrl}>
        <div class="validation-artifact-toolbar">
          <div class="validation-artifact-toolbar-main">
            <div class="validation-artifact-tabs">
              <button
                class="validation-artifact-tab"
                classList={{ active: selectedView() === 'sheet' }}
                onClick={() => setSelectedView('sheet')}
              >
                Sheet View
              </button>
              <button
                class="validation-artifact-tab"
                classList={{ active: selectedView() === 'datalog' }}
                onClick={() => setSelectedView('datalog')}
              >
                Datalog Source
              </button>
            </div>
            <div
              class="validation-artifact-verification-banner"
              classList={{
                pass: props.verificationSummary.status === 'pass',
                fail: props.verificationSummary.status === 'fail',
                idle: props.verificationSummary.status === 'none',
              }}
            >
              {props.verificationSummary.label}
            </div>
          </div>
        </div>
      </Show>

      <Show
        when={selectedView() === 'sheet' && props.entry.projectionDocUrl}
        fallback={
          <div class="verification-source-section">
            <div class="verification-source-label">Expanded Datalog Source</div>
            <pre class="verification-source-code">
              {props.expandedArtifact?.draftText ?? datalogDoc()?.draftText ?? ''}
            </pre>
          </div>
        }
      >
        <patchwork-view
          attr:doc-url={props.entry.projectionDocUrl!}
          attr:tool-id="grjte-artifact-sheet"
          attr:data-annotations={JSON.stringify(constraintAnnotations())}
          style="display:block;width:100%;height:100%;"
        />
      </Show>
    </div>
  );
}

function formatApprovalStatus(status: ValidationDoc['approval']['status']) {
  if (status === 'approved') return 'Approved';
  if (status === 'stale') return 'Stale';
  return 'Pending';
}

function cloneHeadsByDocUrl(headsByDocUrl: Record<AutomergeUrl, Heads>) {
  return Object.fromEntries(
    Object.entries(headsByDocUrl).map(([url, heads]) => [url, [...heads] as Heads]),
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
    if (leftSorted.some((head, index) => head !== rightSorted[index])) return true;
  }

  return false;
}
