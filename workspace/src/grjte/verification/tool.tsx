import { render } from 'solid-js/web';
import { For, Show, createMemo, createSignal, type Accessor } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, AutomergeUrl } from '@automerge/automerge-repo';
import type { VerificationContextDoc } from '../../workflow/types';
import { useTitle } from '../../hooks/useTitle';
import {
  Datalog,
  factKey,
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

  const [expanded, setExpanded] = createSignal(false);
  const toggleExpanded = () => setExpanded((v) => !v);

  const isRichMode = () => (doc()?.artifactUrls?.length ?? 0) > 0;

  return (
    <div class="verification-root">
      <Show when={doc()} fallback={<div class="verification-loading">Loading...</div>}>
        <Show
          when={isRichMode()}
          fallback={
            <div class="verification-item" onClick={toggleExpanded}>
              <span class="verification-circle" />
              <span class="verification-name">{title()}</span>
            </div>
          }
        >
          <RichVerification
            verificationUrl={doc()!.verificationUrl}
            artifactUrls={doc()!.artifactUrls}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
          />
        </Show>
      </Show>
    </div>
  );
}

function RichVerification(props: {
  verificationUrl: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
  expanded: Accessor<boolean>;
  toggleExpanded: () => void;
}) {
  const title = useTitle(() => props.verificationUrl);
  const [verificationDoc] = useDocument<DatalogDoc>(() => props.verificationUrl);

  // Call useDocument at component top level for each artifact URL.
  // Safe because artifactUrls is fixed at creation time.
  const artifactAccessors = props.artifactUrls.map((url) => {
    const [d] = useDocument<DatalogDoc>(() => url);
    return d;
  });

  const results = createMemo(() => {
    const vDoc = verificationDoc();
    if (!vDoc) return null;

    const allFacts: StoredFact[] = [];
    for (const accessor of artifactAccessors) {
      const d = accessor();
      if (d?.facts) {
        for (const fact of d.facts) allFacts.push(fact);
      }
    }

    if (vDoc.facts) {
      for (const fact of vDoc.facts) allFacts.push(fact);
    }

    const constraints = vDoc.constraints ?? [];
    if (constraints.length === 0) return { constraints: [], violations: [], derivedFacts: allFacts };

    const datalog = new Datalog(allFacts, [], constraints);
    const violations = datalog.checkConflicts();
    const derivedFacts = datalog.query();

    return { constraints, violations, derivedFacts };
  });

  const allPass = () => {
    const r = results();
    if (!r) return true;
    return r.violations.length === 0;
  };

  const groupedFacts = createMemo(() => {
    const r = results();
    if (!r) return [];
    const map = new Map<string, StoredFact[]>();
    for (const f of r.derivedFacts) {
      if (!map.has(f.pred)) map.set(f.pred, []);
      map.get(f.pred)!.push(f);
    }
    return Array.from(map.entries());
  });

  return (
    <>
      <div
        class="verification-check-title"
        classList={{ pass: allPass(), fail: !allPass() }}
        onClick={props.toggleExpanded}
      >
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
      <Show when={props.expanded() && groupedFacts().length > 0}>
        <div class="verification-facts-section">
          <For each={groupedFacts()}>
            {([pred, facts]) => (
              <div class="verification-facts-group">
                <div class="verification-facts-pred">{pred}</div>
                <div class="verification-facts-list">
                  <For each={facts}>
                    {(f) => (
                      <div class="verification-fact">{factKey(f)}</div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

function serializeAtom(a: { pred: string; args: string[] }): string {
  if (!a.args || a.args.length === 0) return a.pred;
  return `${a.pred}(${a.args.join(', ')})`;
}
