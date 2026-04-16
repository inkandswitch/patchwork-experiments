import { createResource, Show, For } from 'solid-js';
import { useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { Repo, AutomergeUrl } from '@automerge/automerge-repo';
import type { TokenInstance } from './lib';
import type { CandidateDoc } from './types';
import {
  evaluateSolutionPerVerification,
  evaluateVerificationsAgainstFolders,
  type PerVerificationResult,
} from './evaluate';

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

type VerificationOrDatalogDoc = {
  title?: string;
  docUrl?: AutomergeUrl;
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

  const candidateTokenIds = () => props.candidateTokens.map((t) => t.id).join(',');

  const [bestCandidate, { refetch: refetchBestCandidate }] = createResource(
    () => ({ tokenIds: candidateTokenIds(), specUrl: props.specUrl }),
    async ({ specUrl }) => {
      const tokens = props.candidateTokens;
      const candidatesForSpec: { doc: CandidateDoc; violationCount: number }[] = [];

      for (const token of tokens) {
        const docUrl = token.state.documentUrl as string | undefined;
        if (!docUrl) continue;
        const handle = await props.repo.find<CandidateDoc>(docUrl as AutomergeUrl);
        const doc = await handle.doc();
        if (!doc || doc.specUrl !== specUrl) continue;

        if (!doc.documentsFolderUrl) {
          candidatesForSpec.push({ doc, violationCount: Infinity });
          continue;
        }

        const results = await evaluateSolutionPerVerification(
          props.repo,
          specUrl as string,
          doc.documentsFolderUrl,
        );
        const violationCount = results.reduce((sum, r) => sum + r.violations.length, 0);
        candidatesForSpec.push({ doc, violationCount });
      }

      if (candidatesForSpec.length === 0) return null;

      candidatesForSpec.sort((a, b) => a.violationCount - b.violationCount);
      return candidatesForSpec[0].doc;
    },
  );

  const candidateFolderUrl = () => bestCandidate()?.documentsFolderUrl;

  const [childCandidateFolders] = createResource(
    () => ({ tokenIds: candidateTokenIds(), subSpecUrls: subSpecUrls() }),
    async ({ subSpecUrls }) => {
      if (subSpecUrls.length === 0) return [];

      const tokens = props.candidateTokens;
      const folders: string[] = [];
      const subSpecUrlSet = new Set(subSpecUrls.map((u) => u as string));

      for (const token of tokens) {
        const docUrl = token.state.documentUrl as string | undefined;
        if (!docUrl) continue;
        const handle = await props.repo.find<CandidateDoc>(docUrl as AutomergeUrl);
        const doc = await handle.doc();
        if (!doc?.specUrl || !subSpecUrlSet.has(doc.specUrl)) continue;
        if (doc.documentsFolderUrl) {
          folders.push(doc.documentsFolderUrl);
        }
      }
      return folders;
    },
  );

  const [verificationResults] = createResource(
    () => {
      const _tokenIds = candidateTokenIds();
      const ownFolder = candidateFolderUrl();
      const childFolders = childCandidateFolders() ?? [];
      const vUrls = verificationUrls();
      if (vUrls.length === 0) return null;

      if (ownFolder) {
        return { type: 'own' as const, specUrl: props.specUrl, folderUrl: ownFolder, _tokenIds };
      }
      if (childFolders.length > 0) {
        return { type: 'children' as const, vUrls: vUrls.map((u) => u as string), folders: childFolders, _tokenIds };
      }
      return null;
    },
    async (params) => {
      if (!params) return null;
      if (params.type === 'own') {
        return evaluateSolutionPerVerification(props.repo, params.specUrl as string, params.folderUrl);
      }
      return evaluateVerificationsAgainstFolders(props.repo, params.vUrls, params.folders);
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
              candidateFolderUrl={candidateFolderUrl()}
              hasCandidate={!!bestCandidate()}
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
      const handle = await props.repo.find<VerificationOrDatalogDoc>(url);
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
  candidateFolderUrl?: string;
  hasCandidate: boolean;
  status: 'pass' | 'fail' | 'pending';
  repo: Repo;
}) {
  const [folderDoc] = useDocument<FolderDoc>(() => props.folderUrl);
  const [candidateFolderDoc] = useDocument<FolderDoc>(
    () => props.candidateFolderUrl as AutomergeUrl | undefined,
  );

  const files = () => folderDoc()?.docs ?? [];
  const candidateFiles = () => candidateFolderDoc()?.docs ?? [];

  const boxClass = () => {
    if (!props.hasCandidate) return 'spec-tree-files-box pending';
    return props.status === 'pass' ? 'spec-tree-files-box valid' : 'spec-tree-files-box invalid';
  };

  return (
    <div class={boxClass()}>
      <Show
        when={candidateFiles().length > 0}
        fallback={
          <>
            <For each={files()}>
              {(file) => <div class="spec-tree-file-name">{file.name}</div>}
            </For>
            <Show when={files().length === 0}>
              <div class="spec-tree-file-empty">No files</div>
            </Show>
          </>
        }
      >
        <For each={candidateFiles()}>
          {(file) => (
            <div class="spec-tree-file-embed">
              <div class="spec-tree-file-name">{file.name}</div>
              <patchwork-view
                attr:doc-url={file.url}
                style="display:block;width:100%;min-height:120px;"
              />
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
