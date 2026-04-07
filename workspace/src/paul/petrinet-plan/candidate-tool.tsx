import { render } from 'solid-js/web';
import { createSignal, createResource, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo, AutomergeUrl } from '@automerge/automerge-repo';
import type { CandidateDoc } from './types';
import type { PerVerificationResult } from './evaluate';
import { evaluateSolutionPerVerification } from './evaluate';
import './candidate.css';

type SpecDoc = {
  spec?: {
    goal?: string;
    verificationUrls?: AutomergeUrl[];
  };
};

type DatalogDoc = {
  title?: string;
};

export const CandidateTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <CandidateView handle={handle as DocHandle<CandidateDoc>} repo={element.repo} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function CandidateView({ handle, repo }: { handle: DocHandle<CandidateDoc>; repo: Repo }) {
  const [doc] = useDocument<CandidateDoc>(() => handle.url);
  const [specDoc] = useDocument<SpecDoc>(() =>
    doc()?.specUrl ? (doc()!.specUrl as AutomergeUrl) : undefined,
  );

  const specGoal = () => specDoc()?.spec?.goal ?? 'Unknown spec';
  const documentsFolderUrl = () => doc()?.documentsFolderUrl;

  const [verificationResults] = createResource(
    () => {
      const d = doc();
      if (!d?.specUrl || !d?.documentsFolderUrl) return null;
      return { specUrl: d.specUrl, documentsFolderUrl: d.documentsFolderUrl };
    },
    async (params) => {
      if (!params) return [];
      return evaluateSolutionPerVerification(repo, params.specUrl, params.documentsFolderUrl);
    },
  );

  const overallValid = () => {
    const results = verificationResults();
    if (!results || results.length === 0) return true;
    return results.every((r) => r.valid);
  };

  return (
    <div class="cand-root">
      <Show when={doc()} fallback={<div class="cand-loading">Loading candidate...</div>}>
        <div class="cand-header">
          <span class={`cand-badge ${overallValid() ? 'cand-badge-pass' : 'cand-badge-fail'}`}>
            {overallValid() ? 'PASS' : 'FAIL'}
          </span>
          <span class="cand-spec-goal">{specGoal()}</span>
        </div>

        <div class="cand-body">
          <VerificationSection results={verificationResults() ?? []} repo={repo} />

          <Show when={documentsFolderUrl()}>
            <div class="cand-section">
              <div class="cand-section-header">Documents</div>
              <div class="cand-documents">
                <div class="cand-doc-embed">
                  <patchwork-view attr:doc-url={documentsFolderUrl()} style="display:block;width:100%;min-height:150px;" />
                </div>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function VerificationSection(props: { results: PerVerificationResult[]; repo: Repo }) {
  return (
    <Show when={props.results.length > 0}>
      <div class="cand-section">
        <div class="cand-section-header">Verification</div>
        <div class="cand-verifications">
          <For each={props.results}>
            {(result) => <VerificationRow result={result} repo={props.repo} />}
          </For>
        </div>
      </div>
    </Show>
  );
}

function VerificationRow(props: { result: PerVerificationResult; repo: Repo }) {
  const [expanded, setExpanded] = createSignal(false);
  const [title] = createResource(
    () => props.result.verificationUrl,
    async (url) => {
      const handle = await props.repo.find<DatalogDoc>(url as AutomergeUrl);
      const doc = await handle.doc();
      return doc?.title ?? url.replace('automerge:', '').slice(0, 16) + '...';
    },
  );

  return (
    <div class="cand-verification-item">
      <button
        class="cand-verification-header"
        onClick={() => setExpanded(!expanded())}
      >
        <span class={`cand-status-dot ${props.result.valid ? 'cand-status-pass' : 'cand-status-fail'}`} />
        <span class="cand-verification-title">{title() ?? 'Loading...'}</span>
        <Show when={props.result.violations.length > 0}>
          <span class="cand-violation-count">{props.result.violations.length}</span>
          <span class="cand-expand-toggle">{expanded() ? '▾' : '▸'}</span>
        </Show>
      </button>

      <Show when={expanded() && props.result.violations.length > 0}>
        <div class="cand-violations">
          <For each={props.result.violations}>
            {(violation) => (
              <div class="cand-violation">
                <div class="cand-violation-constraint">
                  {violation.constraint.comment ?? violation.constraint.body.map((a) => `${a.pred}(${a.args.join(', ')})`).join(', ')}
                </div>
                <For each={violation.witnesses}>
                  {(witness) => (
                    <div class="cand-violation-witness">
                      {Object.entries(witness.bindings).map(([k, v]) => `${k}=${v}`).join(', ')}
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
