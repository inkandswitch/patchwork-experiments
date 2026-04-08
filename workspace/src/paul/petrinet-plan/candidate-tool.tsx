import { render } from 'solid-js/web';
import { createSignal, createResource, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo, AutomergeUrl } from '@automerge/automerge-repo';
import type { CandidateDoc } from './types';
import type { PerVerificationResult } from './evaluate';
import { evaluateSolutionPerVerification } from './evaluate';
import { useTitle } from '../../hooks/useTitle';
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

type FolderDoc = {
  docs?: { type: string; name: string; url: AutomergeUrl }[];
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
              <FolderViewer folderUrl={documentsFolderUrl()!} />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function FolderViewer(props: { folderUrl: string }) {
  const [folderDoc] = useDocument<FolderDoc>(() => props.folderUrl as AutomergeUrl);
  const [selectedUrl, setSelectedUrl] = createSignal<AutomergeUrl | null>(null);

  const entries = () => folderDoc()?.docs ?? [];

  return (
    <Show when={entries().length > 0} fallback={<div class="cand-folder-empty">No documents</div>}>
      <div class="cand-folder-viewer">
        <div class="cand-folder-list">
          <For each={entries()}>
            {(entry) => (
              <FolderItem
                url={entry.url}
                name={entry.name}
                selected={selectedUrl() === entry.url}
                onClick={() => setSelectedUrl(entry.url)}
              />
            )}
          </For>
        </div>
        <div class="cand-folder-preview">
          <Show
            when={selectedUrl()}
            fallback={<div class="cand-folder-preview-empty">Select a document</div>}
          >
            {(url) => (
              <div class="cand-folder-preview-content">
                <patchwork-view
                  attr:doc-url={url()}
                  style="display:block;width:100%;height:100%;"
                />
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}

function FolderItem(props: { url: AutomergeUrl; name: string; selected: boolean; onClick: () => void }) {
  const title = useTitle(() => props.url);
  const displayName = () => props.name || title() || 'Untitled';

  return (
    <div
      class="cand-folder-item"
      classList={{ selected: props.selected }}
      onClick={props.onClick}
    >
      <span class="cand-folder-item-name">{displayName()}</span>
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
