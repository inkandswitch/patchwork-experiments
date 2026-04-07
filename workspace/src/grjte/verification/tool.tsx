import { render } from 'solid-js/web';
import { For, Show, createMemo } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { VerificationContextDoc } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import {
  Datalog,
  type StoredFact,
  type StoredConstraint,
  type ConstraintViolation,
} from './datalog-eval';
import './verification.css';

type DatalogDoc = {
  facts: StoredFact[];
  rules: unknown[];
  constraints: StoredConstraint[];
};

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
  const title = useTitle(() => doc()?.verificationUrl);
  const [verificationDoc] = useDocument<DatalogDoc>(() => doc()?.verificationUrl);

  const isRichMode = () => (doc()?.artifactUrls?.length ?? 0) > 0;

  // Load all artifact docs for rich mode
  const artifactDocs = createMemo(() => {
    const urls = doc()?.artifactUrls ?? [];
    return urls.map((url) => {
      const [d] = useDocument<DatalogDoc>(() => url);
      return d;
    });
  });

  const results = createMemo(() => {
    if (!isRichMode()) return null;
    const vDoc = verificationDoc();
    if (!vDoc) return null;

    const allFacts: StoredFact[] = [];
    for (const docAccessor of artifactDocs()) {
      const d = docAccessor();
      if (d?.facts) {
        for (const fact of d.facts) allFacts.push(fact);
      }
    }

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

  return (
    <div class="verification-root">
      <Show when={doc()} fallback={<div class="verification-loading">Loading...</div>}>
        <Show when={isRichMode()} fallback={
          <div class="verification-item">
            <span class="verification-circle" />
            <span class="verification-name">{title()}</span>
          </div>
        }>
          <div class="verification-check-title" classList={{ pass: allPass(), fail: !allPass() }}>
            <span class="verification-check-circle" />
            <span class="verification-check-name">{title()}</span>
          </div>
          <Show when={results()}>
            {(r) => (
              <div class="verification-constraint-list">
                <For each={r().constraints}>
                  {(constraint) => {
                    const violated = () =>
                      r().violations.some((v: ConstraintViolation) => v.constraint === constraint);
                    return (
                      <div
                        class="verification-constraint-item"
                        classList={{ pass: !violated(), fail: violated() }}
                      >
                        <span class="verification-constraint-icon">
                          {violated() ? '\u2717' : '\u2713'}
                        </span>
                        <span class="verification-constraint-text">
                          {constraint.comment || ':- ' + constraint.body.map(serializeAtom).join(', ')}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function serializeAtom(a: { pred: string; args: string[] }): string {
  if (!a.args || a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}
