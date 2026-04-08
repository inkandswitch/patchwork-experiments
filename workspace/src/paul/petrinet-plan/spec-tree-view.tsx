import { createSignal, createResource, Show, For } from 'solid-js';
import { useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { Repo, AutomergeUrl } from '@automerge/automerge-repo';
import type { TokenInstance } from './lib';
import type { CandidateDoc } from './types';
import { evaluateSolutionPerVerification, type PerVerificationResult } from './evaluate';

type Spec = {
  goal: string;
  verificationUrls?: AutomergeUrl[];
  subSpecUrls?: AutomergeUrl[];
  filesFolderUrl?: AutomergeUrl;
};

type SpecDoc = {
  spec?: Spec;
};

type FolderDoc = {
  docs?: { type: string; name: string; url: AutomergeUrl }[];
};

type DatalogDoc = {
  title?: string;
};

type SpecTreeProps = {
  specUrl: AutomergeUrl;
  candidateTokens: TokenInstance[];
  repo: Repo;
};

export function SpecTreeView(props: SpecTreeProps) {
  return (
    <div class="spec-tree-view">
      <SpecNode
        specUrl={props.specUrl}
        candidateTokens={props.candidateTokens}
        repo={props.repo}
        depth={0}
      />
    </div>
  );
}

type SpecNodeProps = {
  specUrl: AutomergeUrl;
  candidateTokens: TokenInstance[];
  repo: Repo;
  depth: number;
};

function SpecNode(props: SpecNodeProps) {
  const [specDoc] = useDocument<SpecDoc>(() => props.specUrl);

  const spec = () => specDoc()?.spec;
  const goal = () => spec()?.goal ?? 'Unknown';
  const verificationUrls = () => spec()?.verificationUrls ?? [];
  const subSpecUrls = () => spec()?.subSpecUrls ?? [];
  const filesFolderUrl = () => spec()?.filesFolderUrl;

  const [candidateDocs] = createResource(
    () => props.candidateTokens,
    async (tokens) => {
      const docs: { tokenId: string; doc: CandidateDoc }[] = [];
      for (const token of tokens) {
        const docUrl = token.state.documentUrl as string | undefined;
        if (!docUrl) continue;
        const handle = await props.repo.find<CandidateDoc>(docUrl as AutomergeUrl);
        const doc = await handle.doc();
        if (doc) docs.push({ tokenId: token.id, doc });
      }
      return docs;
    },
  );

  const candidateForSpec = () => {
    const docs = candidateDocs();
    if (!docs) return null;
    for (const { doc } of docs) {
      if (doc.specUrl === props.specUrl) {
        return doc;
      }
    }
    return null;
  };

  const candidateFolderUrl = () => candidateForSpec()?.documentsFolderUrl;

  const [verificationResults] = createResource(
    () => {
      const folder = candidateFolderUrl();
      if (!folder) return null;
      return { specUrl: props.specUrl, folderUrl: folder };
    },
    async (params) => {
      if (!params) return null;
      return evaluateSolutionPerVerification(props.repo, params.specUrl, params.folderUrl);
    },
  );

  const getVerificationStatus = (vUrl: string): 'pass' | 'fail' | 'pending' => {
    const results = verificationResults();
    if (!results) return 'pending';
    const result = results.find((r) => r.verificationUrl === vUrl);
    if (!result) return 'pending';
    return result.valid ? 'pass' : 'fail';
  };

  const overallStatus = (): 'pass' | 'fail' | 'pending' => {
    const results = verificationResults();
    if (!results) return 'pending';
    if (results.length === 0) return 'pending';
    return results.every((r) => r.valid) ? 'pass' : 'fail';
  };

  return (
    <div class="spec-tree-node" style={{ 'margin-left': `${props.depth * 16}px` }}>
      <div class="spec-tree-row">
        <div class="spec-tree-left">
          <div class="spec-tree-title">{goal()}</div>
          <Show when={verificationUrls().length > 0}>
            <div class="spec-tree-verifications">
              <For each={verificationUrls()}>
                {(vUrl) => (
                  <VerificationItem
                    url={vUrl}
                    status={getVerificationStatus(vUrl as string)}
                    repo={props.repo}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={filesFolderUrl()}>
          <div class="spec-tree-right">
            <FilesBox
              folderUrl={filesFolderUrl()!}
              hasCandidate={!!candidateForSpec()}
              status={overallStatus()}
              repo={props.repo}
            />
          </div>
        </Show>
      </div>

      <Show when={subSpecUrls().length > 0}>
        <For each={subSpecUrls()}>
          {(subUrl) => (
            <SpecNode
              specUrl={subUrl}
              candidateTokens={props.candidateTokens}
              repo={props.repo}
              depth={props.depth + 1}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

function VerificationItem(props: { url: AutomergeUrl; status: 'pass' | 'fail' | 'pending'; repo: Repo }) {
  const [title] = createResource(
    () => props.url,
    async (url) => {
      const handle = await props.repo.find<DatalogDoc>(url);
      const doc = await handle.doc();
      return doc?.title ?? url.replace('automerge:', '').slice(0, 12) + '...';
    },
  );

  const statusClass = () => {
    switch (props.status) {
      case 'pass':
        return 'status-pass';
      case 'fail':
        return 'status-fail';
      default:
        return 'status-pending';
    }
  };

  const statusIcon = () => {
    switch (props.status) {
      case 'pass':
        return '●';
      case 'fail':
        return '✕';
      default:
        return '○';
    }
  };

  return (
    <div class={`spec-tree-verification-item ${statusClass()}`}>
      <span class="spec-tree-status-icon">{statusIcon()}</span>
      <span class="spec-tree-verification-title">{title() ?? 'Loading...'}</span>
    </div>
  );
}

function FilesBox(props: {
  folderUrl: AutomergeUrl;
  hasCandidate: boolean;
  status: 'pass' | 'fail' | 'pending';
  repo: Repo;
}) {
  const [folderDoc] = useDocument<FolderDoc>(() => props.folderUrl);

  const files = () => folderDoc()?.docs ?? [];

  const boxClass = () => {
    if (!props.hasCandidate) return 'spec-tree-files-box pending';
    return props.status === 'pass' ? 'spec-tree-files-box valid' : 'spec-tree-files-box invalid';
  };

  return (
    <div class={boxClass()}>
      <For each={files()}>
        {(file) => <div class="spec-tree-file-name">{file.name}</div>}
      </For>
      <Show when={files().length === 0}>
        <div class="spec-tree-file-empty">No files</div>
      </Show>
    </div>
  );
}
