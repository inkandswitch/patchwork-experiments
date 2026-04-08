import { render } from 'solid-js/web';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { VerificationContextDoc } from '../../workflow/types';
import type { ConstraintViolation } from './datalog-eval';
import {
  type DatalogDoc,
  type VerificationArtifactInput,
  evaluateVerificationContext,
  getRequiredArtifactUrls,
} from './model';
import './verification.css';

export const VerificationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <VerificationView handle={handle as DocHandle<VerificationContextDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function VerificationView(props: { handle: DocHandle<VerificationContextDoc> }) {
  const [doc] = useDocument<VerificationContextDoc>(() => props.handle.url);

  return (
    <div class="verification-root">
      <Show when={doc()} fallback={<div class="verification-loading">Loading verification...</div>}>
        {(currentDoc) => (
          <ResolvedVerificationView
            doc={currentDoc()}
            verificationUrl={currentDoc().verificationUrl}
            artifactUrls={getRequiredArtifactUrls(currentDoc())}
          />
        )}
      </Show>
    </div>
  );
}

function ResolvedVerificationView(props: {
  doc: VerificationContextDoc;
  verificationUrl: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [verificationDoc] = useDocument<DatalogDoc>(() => props.verificationUrl);
  const artifactDocs = props.artifactUrls.map((url) => {
    const [doc] = useDocument<DatalogDoc>(() => url);
    return { url, doc };
  });

  const artifacts = createMemo<VerificationArtifactInput[]>(() =>
    artifactDocs.map(({ url, doc }) => ({
      url,
      name: doc()?.title || 'Untitled artifact',
      doc: doc(),
    })),
  );

  const evaluation = createMemo(() =>
    evaluateVerificationContext(props.doc, verificationDoc(), artifacts()),
  );

  return (
    <Show when={evaluation()} fallback={<div class="verification-loading">Loading details...</div>}>
      {(current) => (
        <div class="verification-card">
          <button
            class="verification-summary"
            classList={{
              validation: current().mode === 'validation',
              pass: current().mode === 'validation' && current().passed,
              fail: current().mode === 'validation' && !current().passed,
            }}
            onClick={() => setExpanded((value) => !value)}
          >
            <div class="verification-summary-main">
              <Show when={current().mode === 'validation'}>
                <span
                  class="verification-status-pill"
                  classList={{ pass: current().passed, fail: !current().passed }}
                >
                  {current().passed ? 'Pass' : 'Fail'}
                </span>
              </Show>
              <div class="verification-summary-copy">
                <div class="verification-summary-title">{current().title}</div>
                <div class="verification-summary-description">{current().description}</div>
              </div>
            </div>
            <div class="verification-summary-meta">
              <Show when={current().mode === 'validation'}>
                <span class="verification-target-summary">{current().targetSummary}</span>
              </Show>
              <span class="verification-expand-label">{expanded() ? 'Hide details' : 'Show details'}</span>
            </div>
          </button>

          <Show when={current().mode === 'validation'}>
            <div class="verification-target-list">
              <For each={current().targetResults}>
                {(target) => (
                  <div class="verification-target-row">
                    <div class="verification-target-label">{target.label}</div>
                    <span
                      class="verification-target-status"
                      classList={{ pass: target.passed, fail: !target.passed }}
                    >
                      {target.passed ? 'Pass' : 'Fail'}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={expanded()}>
            <div class="verification-details">
              <Show
                when={current().mode === 'spec'}
                fallback={<ValidationDetails evaluation={current()} verificationUrl={props.verificationUrl} />}
              >
                <div class="verification-raw-doc">
                  <patchwork-view attr:doc-url={props.verificationUrl} style="display:block;width:100%;" />
                </div>
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function ValidationDetails(props: {
  evaluation: NonNullable<ReturnType<typeof evaluateVerificationContext>>;
  verificationUrl: AutomergeUrl;
}) {
  return (
    <div class="verification-evidence">
      <For each={props.evaluation.targetResults}>
        {(target) => (
          <div class="verification-evidence-card">
            <div class="verification-evidence-header">
              <div class="verification-evidence-title">{target.label}</div>
              <span
                class="verification-target-status"
                classList={{ pass: target.passed, fail: !target.passed }}
              >
                {target.passed ? 'Pass' : 'Fail'}
              </span>
            </div>

            <div class="verification-constraint-list">
              <For each={target.constraints}>
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
              <pre class="verification-source-code">{target.combinedSource}</pre>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function WitnessCard(props: {
  witness: ConstraintViolation['witnesses'][number];
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
