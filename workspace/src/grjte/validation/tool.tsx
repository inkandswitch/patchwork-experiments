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
import type { ValidationDoc, ExecutionDoc, VerificationContextDoc } from '../../workflow/types';
import type { DatalogDoc, VerificationArtifactInput } from '../verification/model';
import { evaluateVerificationContext } from '../verification/model';
import {
  applyCsvToDatalogArtifact,
  getArtifactSyncSignature,
  projectDatalogArtifactToCsv,
  type ArtifactFolderEntry,
  type CsvDoc,
} from './csv-sync';
import './validation.css';

type FolderDoc = {
  docs: ArtifactFolderEntry[];
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
  const [execution] = useDocument<ExecutionDoc>(() => doc()?.executionDocUrl);
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
  execution: ExecutionDoc;
  artifactEntries: FolderDoc['docs'];
  toggleArtifact: (url: AutomergeUrl) => void;
  isArtifactExpanded: (url: AutomergeUrl) => boolean;
}) {
  const artifactAccessors = props.artifactEntries.map((entry) => {
    const [doc] = useDocument<DatalogDoc>(() => entry.url);
    return { entry, doc };
  });
  const verificationContextAccessors = props.execution.verificationContextUrls.map((url) => {
    const [doc] = useDocument<VerificationContextDoc>(() => url);
    return { url, doc };
  });
  const verificationDocAccessors = verificationContextAccessors.map(({ doc }) => {
    const [verificationDoc] = useDocument<DatalogDoc>(() => doc()?.verificationUrl);
    return verificationDoc;
  });

  const artifactInputs = createMemo<VerificationArtifactInput[]>(() =>
    artifactAccessors.map(({ entry, doc }) => ({
      url: entry.url,
      name: entry.name || doc()?.title || 'Untitled artifact',
      doc: doc(),
    })),
  );

  const verificationSummaries = createMemo(() =>
    verificationContextAccessors
      .map(({ url, doc }, index) => {
        const contextDoc = doc();
        if (!contextDoc) return null;
        return {
          url,
          evaluation: evaluateVerificationContext(
            contextDoc,
            verificationDocAccessors[index](),
            artifactInputs(),
          ),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          url: AutomergeUrl;
          evaluation: NonNullable<ReturnType<typeof evaluateVerificationContext>>;
        } => Boolean(entry?.evaluation),
      ),
  );

  const summary = createMemo(() => {
    const evaluations = verificationSummaries().map((entry) => entry.evaluation);
    const passing = evaluations.filter((evaluation) => evaluation.passed).length;
    const failing = evaluations.length - passing;
    const artifactEvaluations = evaluations.filter(
      (evaluation) => evaluation.scope === 'artifacts',
    );
    const artifactTargetsTotal = artifactEvaluations.reduce(
      (total, evaluation) => total + evaluation.artifactTargetsTotal,
      0,
    );
    const artifactTargetsPassing = artifactEvaluations.reduce(
      (total, evaluation) => total + evaluation.artifactTargetsPassing,
      0,
    );

    return {
      allPassed: failing === 0,
      total: evaluations.length,
      passing,
      failing,
      artifactTargetsTotal,
      artifactTargetsPassing,
      systemPassed: evaluations.every((evaluation) => evaluation.systemPassed),
    };
  });

  return (
    <div class="validation-body">
      <Show when={verificationSummaries().length > 0}>
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
                <span class="validation-summary-metric-label">Required verifications</span>
                <span class="validation-summary-metric-value">
                  {summary().passing}/{summary().total} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">Artifact checks</span>
                <span class="validation-summary-metric-value">
                  {summary().artifactTargetsPassing}/{summary().artifactTargetsTotal} passing
                </span>
              </div>
              <div class="validation-summary-metric">
                <span class="validation-summary-metric-label">Whole system</span>
                <span class="validation-summary-metric-value">
                  {summary().systemPassed ? 'Passing' : 'Failing'}
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
                    <span class="validation-artifact-name">{entry.name || 'Untitled'}</span>
                    <span class="validation-artifact-type">{entry.type}</span>
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

      <Show when={props.execution.verificationContextUrls.length > 0}>
        <div class="validation-section">
          <div class="validation-section-label">Verifications</div>
          <div class="validation-verification-list">
            <For each={props.execution.verificationContextUrls}>
              {(url) => (
                <patchwork-view
                  attr:doc-url={url}
                  attr:tool-id="grjte-verification-viewer"
                  style="display:block;width:100%;"
                />
              )}
            </For>
          </div>
        </div>
      </Show>
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

function createHandleResource<T>(repo: any, url: () => AutomergeUrl | undefined) {
  return createResource(url, async (currentUrl) => {
    if (!currentUrl) return undefined;
    return (await repo.find(currentUrl)) as RepoDocHandle<T>;
  });
}
