import { render } from 'solid-js/web';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { ValidationDoc, PlanDoc, SpecDoc, Spec, ExecutionDoc } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import {
  Datalog,
  type StoredFact,
  type StoredConstraint,
  type ConstraintViolation,
} from './datalog-eval';
import './validation.css';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type DatalogDoc = {
  facts: StoredFact[];
  rules: unknown[];
  constraints: StoredConstraint[];
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
  const [plan] = useDocument<PlanDoc>(() => doc()?.planDocUrl);
  const [spec] = useDocument<SpecDoc>(() => doc()?.specDocUrl);
  const [execution] = useDocument<ExecutionDoc>(() => doc()?.executionDocUrl);
  const [folder] = useDocument<FolderDoc>(() => execution()?.artifactsFolderUrl);
  const [selectedVerificationUrl, setSelectedVerificationUrl] =
    createSignal<AutomergeUrl | null>(null);

  const artifacts = () => folder()?.docs ?? [];

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
      <Show when={doc()} fallback={<div class="validation-loading">Loading validation…</div>}>
        {(currentDoc) => (
          <>
            <div class="validation-header">
              <div
                class="validation-status"
                classList={{ validated: currentDoc().isValidated }}
              >
                {currentDoc().isValidated ? 'Approved' : 'Pending'}
              </div>
              <div class="validation-links">
                <Show when={currentDoc().specDocUrl}>
                  {(url) => (
                    <LinkPill
                      url={url()}
                      label="Spec"
                      onClick={() => openDocument(url(), 'grjte-spec-viewer')}
                    />
                  )}
                </Show>
                <Show when={currentDoc().planDocUrl}>
                  {(url) => (
                    <LinkPill
                      url={url()}
                      label="Plan"
                      onClick={() => openDocument(url(), 'grjte-plan-viewer')}
                    />
                  )}
                </Show>
              </div>
              <Show when={!currentDoc().isValidated}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  Approve
                </button>
              </Show>
            </div>

            <div class="validation-body">
              <div class="validation-left-panel">
                <Show when={artifacts().length > 0}>
                  <div class="validation-section">
                    <div class="validation-section-label">Artifacts</div>
                    <div class="validation-artifact-list">
                      <For each={artifacts()}>
                        {(entry) => (
                          <div class="validation-artifact-card">
                            <div class="validation-artifact-card-label">{entry.name}</div>
                            <div class="validation-artifact-card-view">
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

                <Show when={spec()?.spec}>
                  {(currentSpec) => (
                    <div class="validation-section">
                      <div class="validation-section-label">Verifications</div>
                      <SpecVerifications
                        spec={currentSpec()}
                        artifactUrls={artifacts().map((a) => a.url)}
                        selectedUrl={selectedVerificationUrl()}
                        onSelect={setSelectedVerificationUrl}
                      />
                    </div>
                  )}
                </Show>
              </div>

              <div class="validation-preview">
                <Show
                  when={selectedVerificationUrl()}
                  fallback={
                    <div class="validation-preview-empty">
                      Select a verification to inspect
                    </div>
                  }
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
          </>
        )}
      </Show>
    </div>
  );
}

function LinkPill(props: { url: AutomergeUrl; label: string; onClick: () => void }) {
  const title = useTitle(() => props.url);

  return (
    <button class="validation-link-pill" onClick={props.onClick}>
      <span class="validation-link-label">{props.label}:</span>
      <span class="validation-link-title">{title()}</span>
    </button>
  );
}

/** Recursively render verifications for a spec and its sub-specs */
function SpecVerifications(props: {
  spec: Spec;
  artifactUrls: AutomergeUrl[];
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl | null) => void;
}) {
  return (
    <div class="validation-spec-group">
      <Show when={props.spec.goal}>
        <div class="validation-spec-goal">{props.spec.goal}</div>
      </Show>
      <For each={props.spec.verificationUrls}>
        {(url) => (
          <VerificationCheck
            url={url}
            artifactUrls={props.artifactUrls}
            selectedUrl={props.selectedUrl}
            onSelect={props.onSelect}
          />
        )}
      </For>
      <Show when={(props.spec.subSpecUrls?.length ?? 0) > 0}>
        <For each={props.spec.subSpecUrls}>
          {(subUrl) => (
            <SubSpecVerifications
              url={subUrl}
              artifactUrls={props.artifactUrls}
              selectedUrl={props.selectedUrl}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function SubSpecVerifications(props: {
  url: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl | null) => void;
}) {
  const [doc] = useDocument<SpecDoc>(() => props.url);

  return (
    <Show when={doc()?.spec}>
      {(spec) => (
        <div class="validation-subspec">
          <SpecVerifications
            spec={spec()}
            artifactUrls={props.artifactUrls}
            selectedUrl={props.selectedUrl}
            onSelect={props.onSelect}
          />
        </div>
      )}
    </Show>
  );
}

/** Load a verification DatalogDoc, check its constraints against artifact facts */
function VerificationCheck(props: {
  url: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
  selectedUrl: AutomergeUrl | null;
  onSelect: (url: AutomergeUrl | null) => void;
}) {
  const title = useTitle(() => props.url);
  const [verificationDoc] = useDocument<DatalogDoc>(() => props.url);

  // Load all artifact docs
  const artifactDocs = props.artifactUrls.map((url) => {
    const [doc] = useDocument<DatalogDoc>(() => url);
    return doc;
  });

  const results = createMemo(() => {
    const vDoc = verificationDoc();
    if (!vDoc) return null;

    // Collect all facts from artifacts
    const allFacts: StoredFact[] = [];
    for (const docAccessor of artifactDocs) {
      const d = docAccessor();
      if (d?.facts) {
        for (const fact of d.facts) allFacts.push(fact);
      }
    }

    // Also include facts from the verification doc itself (base data like staff definitions)
    if (vDoc.facts) {
      for (const fact of vDoc.facts) allFacts.push(fact);
    }

    const constraints = vDoc.constraints ?? [];
    if (constraints.length === 0) return { constraints: [], violations: [] };

    const datalog = new Datalog(allFacts, [], constraints);
    const violations = datalog.checkConflicts();

    return { constraints, violations };
  });

  const allPass = () => {
    const r = results();
    if (!r) return true;
    return r.violations.length === 0;
  };

  const isSelected = () => props.selectedUrl === props.url;

  return (
    <div class="validation-verification-group">
      <button
        class="validation-verification-title"
        classList={{ selected: isSelected(), pass: allPass(), fail: !allPass() }}
        onClick={() => props.onSelect(isSelected() ? null : props.url)}
      >
        <span class="validation-verification-circle" />
        <span class="validation-verification-name">{title()}</span>
      </button>
      <Show when={results()}>
        {(r) => (
          <div class="validation-constraint-list">
            <For each={r().constraints}>
              {(constraint) => {
                const violated = () =>
                  r().violations.some((v: ConstraintViolation) => v.constraint === constraint);
                return (
                  <div
                    class="validation-constraint-item"
                    classList={{ pass: !violated(), fail: violated() }}
                  >
                    <span class="validation-constraint-icon">
                      {violated() ? '\u2717' : '\u2713'}
                    </span>
                    <span class="validation-constraint-text">
                      {constraint.comment || ':- ' + constraint.body.map(serializeAtom).join(', ')}
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}

function serializeAtom(a: { pred: string; args: string[] }): string {
  if (!a.args || a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}
