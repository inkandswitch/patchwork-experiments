import type { AutomergeUrl, DocHandle as RepoDocHandle } from '@automerge/automerge-repo';
import type { SpecDoc } from '../../workflow/types';
import type { VerificationDoc } from '../verification/types';
import type { DatalogDoc } from '../verification/model';

type FolderEntry = {
  type: string;
  name: string;
  url: AutomergeUrl;
};

type FolderDoc = {
  docs: FolderEntry[];
};

export type LoadedVerification = {
  url: AutomergeUrl;
  docUrl: AutomergeUrl;
  title?: string;
  description?: string;
  script: string;
  datalogDoc?: DatalogDoc;
};

export type LoadedDataDoc = {
  url: AutomergeUrl;
  name: string;
  title?: string;
  datalogDoc?: DatalogDoc;
};

export type SpecTreeNode = {
  path: string;
  goal: string;
  verifications: LoadedVerification[];
  dataDocs: LoadedDataDoc[];
  subSpecs: SpecTreeNode[];
};

export type FlattenedVerification = {
  nodePath: string;
  nodeGoal: string;
  targetKind: 'global' | 'scoped';
  verification: LoadedVerification;
  dataDocs: LoadedDataDoc[];
};

type RepoLike = {
  find: (url: AutomergeUrl) => Promise<RepoDocHandle<unknown>>;
};

export async function loadSpecTree(
  repo: RepoLike,
  url: AutomergeUrl,
  path = 'root',
  inheritedDataDocs: LoadedDataDoc[] = [],
): Promise<SpecTreeNode | null> {
  const handle = (await repo.find(url)) as RepoDocHandle<SpecDoc>;
  const doc = handle.doc();
  if (!doc?.spec) return null;

  const ownDataDocs = doc.spec.dataFolderUrl
    ? await loadDataDocsFromFolder(repo, doc.spec.dataFolderUrl)
    : [];
  const dataDocs = dedupeDocsByUrl([...inheritedDataDocs, ...ownDataDocs]);

  const verifications = await Promise.all(
    (doc.spec.verificationUrls ?? []).map(async (verificationUrl) => {
      const verificationHandle = (await repo.find(
        verificationUrl,
      )) as RepoDocHandle<VerificationDoc>;
      const verification = verificationHandle.doc();
      if (!verification?.docUrl) return null;

      const datalogHandle = (await repo.find(verification.docUrl)) as RepoDocHandle<DatalogDoc>;
      return {
        url: verificationUrl,
        docUrl: verification.docUrl,
        title: verification.title,
        description: verification.description,
        script: verification.script ?? '',
        datalogDoc: datalogHandle.doc(),
      } satisfies LoadedVerification;
    }),
  );

  const subSpecs = await Promise.all(
    (doc.spec.subSpecUrls ?? []).map((subSpecUrl, index) =>
      loadSpecTree(repo, subSpecUrl, `${path}/${index}`, dataDocs),
    ),
  );

  return {
    path,
    goal: doc.spec.goal || 'Untitled spec',
    verifications: verifications.filter(
      (entry): entry is NonNullable<(typeof verifications)[number]> => entry !== null,
    ),
    dataDocs,
    subSpecs: subSpecs.filter(
      (entry): entry is NonNullable<(typeof subSpecs)[number]> => entry !== null,
    ),
  };
}

export function flattenSpecTree(node: SpecTreeNode | null | undefined): FlattenedVerification[] {
  if (!node) return [];

  return [
    ...node.verifications.map((verification) => ({
      nodePath: node.path,
      nodeGoal: node.goal,
      targetKind: node.path === 'root' ? ('global' as const) : ('scoped' as const),
      verification,
      dataDocs: node.dataDocs,
    })),
    ...node.subSpecs.flatMap((subSpec) => flattenSpecTree(subSpec)),
  ];
}

export function getArtifactsForNode<T extends { url: AutomergeUrl }>(
  nodePath: string,
  artifacts: T[],
  artifactSpecPaths: Record<string, string>,
): T[] {
  if (nodePath === 'root') return artifacts;

  return artifacts.filter((artifact) => {
    const artifactPath = artifactSpecPaths[artifact.url];
    return artifactPath === nodePath || artifactPath?.startsWith(`${nodePath}/`);
  });
}

async function loadDataDocsFromFolder(
  repo: RepoLike,
  folderUrl: AutomergeUrl,
): Promise<LoadedDataDoc[]> {
  const folderHandle = (await repo.find(folderUrl)) as RepoDocHandle<FolderDoc>;
  const folder = folderHandle.doc();
  if (!folder?.docs?.length) return [];

  const nestedDocs = await Promise.all(
    folder.docs.map(async (entry) => {
      if (entry.type === 'folder') {
        return loadDataDocsFromFolder(repo, entry.url);
      }
      if (entry.type !== 'datalog') return [];

      const dataHandle = (await repo.find(entry.url)) as RepoDocHandle<DatalogDoc>;
      return [
        {
          url: entry.url,
          name: entry.name || dataHandle.doc()?.title || 'Untitled data doc',
          title: dataHandle.doc()?.title,
          datalogDoc: dataHandle.doc(),
        } satisfies LoadedDataDoc,
      ];
    }),
  );

  return dedupeDocsByUrl(nestedDocs.flat());
}

function dedupeDocsByUrl<T extends { url: AutomergeUrl }>(docs: T[]): T[] {
  const seen = new Set<AutomergeUrl>();
  const unique: T[] = [];
  for (const doc of docs) {
    if (seen.has(doc.url)) continue;
    seen.add(doc.url);
    unique.push(doc);
  }
  return unique;
}

export async function watchSpecTree(
  repo: RepoLike,
  specDocUrl: AutomergeUrl,
  onUpdate: (tree: SpecTreeNode | null) => void,
): Promise<() => void> {
  let disposed = false;
  let unsubscribers: Array<() => void> = [];
  let rebuildQueued = false;

  async function rebuild() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    if (disposed) return;

    const trackedUrls = new Set<AutomergeUrl>();

    const trackHandle = <T>(handle: RepoDocHandle<T>) => {
      if (trackedUrls.has(handle.url)) return;
      trackedUrls.add(handle.url);
      const listener = () => queueRebuild();
      handle.on('change', listener);
      unsubscribers.push(() => handle.off('change', listener));
    };

    async function loadWatchedTree(
      url: AutomergeUrl,
      path = 'root',
      inheritedDataDocs: LoadedDataDoc[] = [],
    ): Promise<SpecTreeNode | null> {
      const handle = (await repo.find(url)) as RepoDocHandle<SpecDoc>;
      trackHandle(handle);
      const doc = handle.doc();
      if (!doc?.spec) return null;

      const ownDataDocs = doc.spec.dataFolderUrl
        ? await loadWatchedDataDocs(doc.spec.dataFolderUrl)
        : [];
      const dataDocs = dedupeDocsByUrl([...inheritedDataDocs, ...ownDataDocs]);

      const verifications = await Promise.all(
        (doc.spec.verificationUrls ?? []).map(async (verificationUrl) => {
          const verificationHandle = (await repo.find(
            verificationUrl,
          )) as RepoDocHandle<VerificationDoc>;
          trackHandle(verificationHandle);
          const verification = verificationHandle.doc();
          if (!verification?.docUrl) return null;

          const datalogHandle = (await repo.find(verification.docUrl)) as RepoDocHandle<DatalogDoc>;
          trackHandle(datalogHandle);
          return {
            url: verificationUrl,
            docUrl: verification.docUrl,
            title: verification.title,
            description: verification.description,
            script: verification.script ?? '',
            datalogDoc: datalogHandle.doc(),
          } satisfies LoadedVerification;
        }),
      );

      const subSpecs = await Promise.all(
        (doc.spec.subSpecUrls ?? []).map((subSpecUrl, index) =>
          loadWatchedTree(subSpecUrl, `${path}/${index}`, dataDocs),
        ),
      );

      return {
        path,
        goal: doc.spec.goal || 'Untitled spec',
        verifications: verifications.filter(
          (entry): entry is NonNullable<(typeof verifications)[number]> => entry !== null,
        ),
        dataDocs,
        subSpecs: subSpecs.filter(
          (entry): entry is NonNullable<(typeof subSpecs)[number]> => entry !== null,
        ),
      };
    }

    async function loadWatchedDataDocs(folderUrl: AutomergeUrl): Promise<LoadedDataDoc[]> {
      const folderHandle = (await repo.find(folderUrl)) as RepoDocHandle<FolderDoc>;
      trackHandle(folderHandle);
      const folder = folderHandle.doc();
      if (!folder?.docs?.length) return [];

      const nestedDocs = await Promise.all(
        folder.docs.map(async (entry) => {
          if (entry.type === 'folder') {
            return loadWatchedDataDocs(entry.url);
          }
          if (entry.type !== 'datalog') return [];

          const dataHandle = (await repo.find(entry.url)) as RepoDocHandle<DatalogDoc>;
          trackHandle(dataHandle);
          return [
            {
              url: entry.url,
              name: entry.name || dataHandle.doc()?.title || 'Untitled data doc',
              title: dataHandle.doc()?.title,
              datalogDoc: dataHandle.doc(),
            } satisfies LoadedDataDoc,
          ];
        }),
      );

      return dedupeDocsByUrl(nestedDocs.flat());
    }

    const tree = await loadWatchedTree(specDocUrl);
    if (!disposed) onUpdate(tree);
  }

  function queueRebuild() {
    if (disposed || rebuildQueued) return;
    rebuildQueued = true;
    queueMicrotask(async () => {
      rebuildQueued = false;
      await rebuild();
    });
  }

  await rebuild();

  return () => {
    disposed = true;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
  };
}
