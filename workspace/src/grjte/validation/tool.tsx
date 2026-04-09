import { render } from 'solid-js/web';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  untrack,
} from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import type {
  DocHandle,
  AutomergeUrl,
  DocHandle as RepoDocHandle,
} from '@automerge/automerge-repo';
import type { SpecDoc, ValidationDoc } from '../../workflow/types';
import type { TaskListExecutionDoc } from '../execution/types';
import type { VerificationDoc } from '../verification/types';
import type {
  DatalogDoc,
  VerificationArtifactInput,
  VerificationEvaluation,
} from '../verification/model';
import { evaluateVerification } from '../verification/model';
import type { ConstraintViolation } from '../verification/datalog-eval';
import {
  applyCsvToDatalogArtifact,
  getArtifactSyncSignature,
  projectDatalogArtifactToCsv,
  type ArtifactFolderEntry,
  type CsvDoc,
} from './csv-sync';
import '../verification/verification.css';
import './validation.css';

type FolderDoc = {
  docs: ArtifactFolderEntry[];
};

type LoadedVerification = {
  url: AutomergeUrl;
  docUrl: AutomergeUrl;
  title?: string;
  description?: string;
  script: string;
  datalogDoc?: DatalogDoc;
};

type SpecTreeNode = {
  path: string;
  goal: string;
  verifications: LoadedVerification[];
  subSpecs: SpecTreeNode[];
};

type FlattenedVerification = {
  nodePath: string;
  nodeGoal: string;
  targetKind: 'global' | 'scoped';
  verification: LoadedVerification;
};

type EvaluatedVerificationEntry = {
  entry: FlattenedVerification;
  evaluation: VerificationEvaluation;
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
      d.isValidated = true;
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
              <div class="validation-status" classList={{ validated: currentDoc().isValidated }}>
                {currentDoc().isValidated ? 'Approved' : 'Pending'}
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
              <Show when={!currentDoc().isValidated}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  Approve
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
                      specDocUrl={currentDoc().specDocUrl}
                      artifactEntries={currentFolder().docs ?? []}
                      toggleArtifact={toggleArtifact}
                      isArtifactExpanded={isArtifactExpanded}
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
  specDocUrl: AutomergeUrl;
  artifactEntries: FolderDoc['docs'];
  toggleArtifact: (url: AutomergeUrl) => void;
  isArtifactExpanded: (url: AutomergeUrl) => boolean;
}) {
  const artifactAccessors = props.artifactEntries.map((entry) => {
    const [doc] = useDocument<DatalogDoc>(() => entry.url);
    return { entry, doc };
  });
  const [specTree] = createResource(
    () => props.specDocUrl,
    (url) => loadSpecTree(props.repo, url),
  );

  const artifactInputs = createMemo<VerificationArtifactInput[]>(() =>
    artifactAccessors.map(({ entry, doc }) => ({
      url: entry.url,
      name: entry.name || doc()?.title || 'Untitled artifact',
      doc: doc(),
    })),
  );

  const flattenedVerifications = createMemo<FlattenedVerification[]>(() =>
    flattenSpecTree(specTree()),
  );

  const verificationResults = createMemo<EvaluatedVerificationEntry[]>(() =>
    flattenedVerifications()
      .map((entry) => {
        const evaluation = evaluateVerification(
          entry.verification,
          entry.verification.datalogDoc,
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

  return (
    <div class="validation-body">
      <Show when={specTree.loading}>
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
                    <span class="validation-artifact-name">{entry.name || 'Untitled'}</span>
                    <span class="validation-artifact-meta">
                      <span class="validation-artifact-scope">{entry.specPath || 'root'}</span>
                      <span class="validation-artifact-type">{entry.type}</span>
                    </span>
                  </button>
                  <Show when={props.isArtifactExpanded(entry.url)}>
                    <div class="validation-artifact-preview">
                      <ArtifactWorkspace entry={entry} repo={props.repo} />
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
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

function ArtifactWorkspace(props: { entry: ArtifactFolderEntry; repo: any }) {
  const [selectedView, setSelectedView] = createSignal<'csv' | 'datalog'>(
    props.entry.csvUrl ? 'csv' : 'datalog',
  );
  const [datalogDoc] = useDocument<DatalogDoc>(() => props.entry.url);
  const [csvDoc] = useDocument<CsvDoc>(() => props.entry.csvUrl);
  const [datalogHandle] = createHandleResource<DatalogDoc>(props.repo, () => props.entry.url);
  const [csvHandle] = createHandleResource<CsvDoc>(props.repo, () => props.entry.csvUrl);
  const [syncError, setSyncError] = createSignal<string | null>(null);
  let lastProjectedCsvContent: string | undefined;

  const projection = createMemo(() => {
    if (!props.entry.csvUrl || !props.entry.projectionKind || !datalogDoc()) return null;
    return projectDatalogArtifactToCsv(props.entry.projectionKind, datalogDoc()!, props.entry.name);
  });

  createEffect(
    on(
      () => getArtifactSyncSignature(datalogDoc() ?? { title: '', facts: [], draftText: '' }),
      () => {
        const currentProjection = projection();
        const handle = csvHandle();
        if (!currentProjection || !handle) return;
        const currentCsvDoc = untrack(csvDoc);
        if (
          currentCsvDoc?.content === currentProjection.content &&
          currentCsvDoc?.title === currentProjection.title
        ) {
          lastProjectedCsvContent = currentProjection.content;
          return;
        }
        lastProjectedCsvContent = currentProjection.content;
        handle.change((d) => {
          d['@patchwork'] = { type: 'csv' };
          d.title = currentProjection.title;
          d.content = currentProjection.content;
        });
        setSyncError(null);
      },
    ),
  );

  createEffect(
    on(
      () => csvDoc()?.content,
      (content) => {
        const currentCsvDoc = csvDoc();
        const currentDatalogDoc = untrack(datalogDoc);
        const handle = datalogHandle();
        if (
          !content ||
          !currentCsvDoc ||
          !currentDatalogDoc ||
          !handle ||
          !props.entry.projectionKind ||
          !props.entry.csvUrl
        ) {
          return;
        }
        if (content === lastProjectedCsvContent) {
          setSyncError(null);
          return;
        }

        const result = applyCsvToDatalogArtifact(
          props.entry.projectionKind,
          content,
          currentDatalogDoc,
          props.entry.name,
        );
        if (!result.ok) {
          setSyncError(result.error);
          return;
        }

        setSyncError(null);
        const nextSignature = getArtifactSyncSignature(result.doc);
        if (nextSignature === getArtifactSyncSignature(currentDatalogDoc)) return;

        handle.change((d) => {
          d.title = result.doc.title;
          d.facts = result.doc.facts;
          d.draftText = result.doc.draftText;
        });
      },
    ),
  );

  return (
    <div class="validation-artifact-workspace">
      <Show when={props.entry.csvUrl}>
        <div class="validation-artifact-toolbar">
          <div class="validation-artifact-tabs">
            <button
              class="validation-artifact-tab"
              classList={{ active: selectedView() === 'csv' }}
              onClick={() => setSelectedView('csv')}
            >
              CSV View
            </button>
            <button
              class="validation-artifact-tab"
              classList={{ active: selectedView() === 'datalog' }}
              onClick={() => setSelectedView('datalog')}
            >
              Datalog Source
            </button>
          </div>
          <Show when={syncError()}>
            {(message) => <div class="validation-artifact-sync-error">{message()}</div>}
          </Show>
        </div>
      </Show>

      <Show
        when={selectedView() === 'csv' && props.entry.csvUrl}
        fallback={
          <patchwork-view
            attr:doc-url={props.entry.url}
            style="display:block;width:100%;height:100%;"
          />
        }
      >
        <patchwork-view
          attr:doc-url={props.entry.csvUrl!}
          attr:tool-id="csv"
          style="display:block;width:100%;height:100%;"
        />
      </Show>
    </div>
  );
}

async function loadSpecTree(
  repo: any,
  url: AutomergeUrl,
  path = 'root',
): Promise<SpecTreeNode | null> {
  const handle = (await repo.find(url)) as RepoDocHandle<SpecDoc>;
  const doc = handle.doc();
  if (!doc?.spec) return null;

  const verifications = await Promise.all(
    (doc.spec.verificationUrls ?? []).map(async (verificationUrl) => {
      const verificationHandle = (await repo.find(
        verificationUrl,
      )) as RepoDocHandle<VerificationDoc>;
      const verification = verificationHandle.doc();
      if (!verification?.docUrl) return null;

      const datalogHandle = (await repo.find(verification.docUrl)) as RepoDocHandle<DatalogDoc>;
      return {
        url: verificationUrl,
        docUrl: verification.docUrl,
        title: verification.title,
        description: verification.description,
        script: verification.script ?? '',
        datalogDoc: datalogHandle.doc(),
      } satisfies LoadedVerification;
    }),
  );

  const subSpecs = await Promise.all(
    (doc.spec.subSpecUrls ?? []).map((subSpecUrl, index) =>
      loadSpecTree(repo, subSpecUrl, `${path}/${index}`),
    ),
  );
  const resolvedVerifications = verifications.filter(
    (entry): entry is NonNullable<(typeof verifications)[number]> => entry !== null,
  );
  const resolvedSubSpecs = subSpecs.filter(
    (entry): entry is NonNullable<(typeof subSpecs)[number]> => entry !== null,
  );

  return {
    path,
    goal: doc.spec.goal || 'Untitled spec',
    verifications: resolvedVerifications,
    subSpecs: resolvedSubSpecs,
  };
}

function flattenSpecTree(node: SpecTreeNode | null | undefined): FlattenedVerification[] {
  if (!node) return [];

  return [
    ...node.verifications.map((verification) => ({
      nodePath: node.path,
      nodeGoal: node.goal,
      targetKind: node.path === 'root' ? ('global' as const) : ('scoped' as const),
      verification,
    })),
    ...node.subSpecs.flatMap((subSpec) => flattenSpecTree(subSpec)),
  ];
}

function getArtifactsForNode(
  nodePath: string,
  artifacts: VerificationArtifactInput[],
  artifactSpecPaths: Record<string, string>,
): VerificationArtifactInput[] {
  if (nodePath === 'root') return artifacts;

  return artifacts.filter((artifact) => {
    const artifactPath = artifactSpecPaths[artifact.url];
    return artifactPath === nodePath || artifactPath?.startsWith(`${nodePath}/`);
  });
}

function createHandleResource<T>(repo: any, url: () => AutomergeUrl | undefined) {
  return createResource(url, async (currentUrl) => {
    if (!currentUrl) return undefined;
    return (await repo.find(currentUrl)) as RepoDocHandle<T>;
  });
}
