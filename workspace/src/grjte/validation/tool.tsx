import { render } from 'solid-js/web';
import { For, Show, createMemo } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { ValidationDoc, PlanDoc, SpecDoc, Spec } from '../../workflow/types';
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
        <ValidationView handle={handle as DocHandle<ValidationDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function ValidationView(props: { handle: DocHandle<ValidationDoc> }) {
  const [doc] = useDocument<ValidationDoc>(() => props.handle.url);
  const [plan] = useDocument<PlanDoc>(() => doc()?.planDocUrl);
  const [spec] = useDocument<SpecDoc>(() => doc()?.specDocUrl);
  const [folder] = useDocument<FolderDoc>(() => plan()?.artifactsFolderUrl);

  const artifacts = () => folder()?.docs ?? [];

  function handleApprove() {
    props.handle.change((d) => {
      d.isValidated = true;
    });
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
                  {(url) => <LinkPill url={url()} label="Spec" />}
                </Show>
                <Show when={currentDoc().planDocUrl}>
                  {(url) => <LinkPill url={url()} label="Plan" />}
                </Show>
              </div>
              <Show when={!currentDoc().isValidated}>
                <button class="validation-approve-btn" onClick={handleApprove}>
                  Approve
                </button>
              </Show>
            </div>

            <div class="validation-body">
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
                    />
                  </div>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function LinkPill(props: { url: AutomergeUrl; label: string }) {
  const title = useTitle(() => props.url);

  return (
    <div class="validation-link-pill">
      <span class="validation-link-label">{props.label}:</span>
      <span class="validation-link-title">{title()}</span>
    </div>
  );
}

/** Recursively render verifications for a spec and its sub-specs */
function SpecVerifications(props: { spec: Spec; artifactUrls: AutomergeUrl[] }) {
  return (
    <div class="validation-spec-group">
      <Show when={props.spec.goal}>
        <div class="validation-spec-goal">{props.spec.goal}</div>
      </Show>
      <For each={props.spec.verificationUrls}>
        {(url) => <VerificationCheck url={url} artifactUrls={props.artifactUrls} />}
      </For>
      <Show when={(props.spec.subSpecUrls?.length ?? 0) > 0}>
        <For each={props.spec.subSpecUrls}>
          {(subUrl) => <SubSpecVerifications url={subUrl} artifactUrls={props.artifactUrls} />}
        </For>
      </Show>
    </div>
  );
}

function SubSpecVerifications(props: { url: AutomergeUrl; artifactUrls: AutomergeUrl[] }) {
  const [doc] = useDocument<SpecDoc>(() => props.url);

  return (
    <Show when={doc()?.spec}>
      {(spec) => (
        <div class="validation-subspec">
          <SpecVerifications spec={spec()} artifactUrls={props.artifactUrls} />
        </div>
      )}
    </Show>
  );
}

/** Load a verification DatalogDoc, check its constraints against artifact facts */
function VerificationCheck(props: { url: AutomergeUrl; artifactUrls: AutomergeUrl[] }) {
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

  return (
    <div class="validation-verification-group">
      <div class="validation-verification-title">{title()}</div>
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
