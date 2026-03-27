import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { getHeads } from '@automerge/automerge';
import type { WorkspaceDoc } from '../types';

type FolderDoc = {
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export type Workspace = {
  getHandle(path: string): Promise<DocHandle<any>>;
  import(path: string): Promise<Record<string, unknown>>;
  readDoc(path: string): Promise<string>;
};

export function createWorkspace(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceDoc>,
  rootFolderUrl: AutomergeUrl,
): Workspace {
  const cloneMap = new Map<AutomergeUrl, DocHandle<any>>();

  return {
    getHandle: (path) => resolveAndMaybeClone(repo, workspaceHandle, rootFolderUrl, cloneMap, path),
    import: (path) => importByPath(repo, rootFolderUrl, cloneMap, path),
    readDoc: (path) => readDocByPath(repo, rootFolderUrl, cloneMap, path),
  };
}

async function resolveAndMaybeClone(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceDoc>,
  rootFolderUrl: AutomergeUrl,
  cloneMap: Map<AutomergeUrl, DocHandle<any>>,
  path: string,
): Promise<DocHandle<any>> {
  const { url } = await resolvePath(repo, rootFolderUrl, path);

  if (cloneMap.has(url)) {
    return cloneMap.get(url)!;
  }

  const originalHandle = await repo.find(url);
  return wrapWithCloneOnWrite(repo, workspaceHandle, cloneMap, url, originalHandle);
}

function wrapWithCloneOnWrite(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceDoc>,
  cloneMap: Map<AutomergeUrl, DocHandle<any>>,
  originalUrl: AutomergeUrl,
  originalHandle: DocHandle<any>,
): DocHandle<any> {
  const proxy = new Proxy(originalHandle, {
    get(target, prop, receiver) {
      if (prop === 'change') {
        return (changeFn: (doc: any) => void) => {
          const existing = cloneMap.get(originalUrl);
          if (existing) {
            existing.change(changeFn);
            return;
          }

          const doc = target.docSync();
          const heads = doc ? getHeads(doc) : [];

          const clonedHandle = repo.clone(target);
          cloneMap.set(originalUrl, clonedHandle);

          workspaceHandle.change((ws) => {
            if (!ws.documents) ws.documents = {} as any;
            (ws.documents as any)[originalUrl] = {
              cloneUrl: clonedHandle.url,
              originalHeads: heads,
            };
          });

          clonedHandle.change(changeFn);
        };
      }

      if (prop === 'url') {
        const existing = cloneMap.get(originalUrl);
        if (existing) return existing.url;
        return target.url;
      }

      const existing = cloneMap.get(originalUrl);
      if (existing) {
        const val = Reflect.get(existing, prop, receiver);
        return typeof val === 'function' ? val.bind(existing) : val;
      }

      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });

  return proxy;
}

async function importByPath(
  repo: Repo,
  rootFolderUrl: AutomergeUrl,
  cloneMap: Map<AutomergeUrl, DocHandle<any>>,
  path: string,
): Promise<Record<string, unknown>> {
  const { url, parentUrl, name } = await resolvePath(repo, rootFolderUrl, path);

  const cloned = cloneMap.get(url);
  const resolvedUrl = cloned ? cloned.url : url;

  const folderUrl = parentUrl ?? rootFolderUrl;
  const importUrl = `/${swPath(folderUrl)}/${name}`;
  return await import(/* @vite-ignore */ importUrl);
}

async function readDocByPath(
  repo: Repo,
  rootFolderUrl: AutomergeUrl,
  cloneMap: Map<AutomergeUrl, DocHandle<any>>,
  path: string,
): Promise<string> {
  const { url } = await resolvePath(repo, rootFolderUrl, path);

  const cloned = cloneMap.get(url);
  const handle = cloned ?? await repo.find(url);
  const doc = await handle.doc();
  if (!doc) throw new Error(`Document not found at path: ${path}`);

  if (typeof (doc as any).content === 'string') return (doc as any).content;
  if ((doc as any).content instanceof Uint8Array) {
    return new TextDecoder().decode((doc as any).content);
  }
  return JSON.stringify(doc, null, 2);
}

type ResolvedPath = {
  url: AutomergeUrl;
  parentUrl?: AutomergeUrl;
  name: string;
};

async function resolvePath(
  repo: Repo,
  rootFolderUrl: AutomergeUrl,
  path: string,
): Promise<ResolvedPath> {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error('Empty path');

  let currentFolderUrl = rootFolderUrl;
  let parentUrl: AutomergeUrl | undefined;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const folderHandle = await repo.find<FolderDoc>(currentFolderUrl);
    const folderDoc = await folderHandle.doc();
    if (!folderDoc?.docs) throw new Error(`Not a folder at segment "${segment}" in path "${path}"`);

    const entry = folderDoc.docs.find((d) => d.name === segment);
    if (!entry) {
      const available = folderDoc.docs.map((d) => d.name).join(', ');
      throw new Error(`"${segment}" not found in path "${path}". Available: [${available}]`);
    }

    if (i < segments.length - 1) {
      if (entry.type !== 'folder') {
        throw new Error(`"${segment}" is not a folder in path "${path}"`);
      }
      parentUrl = currentFolderUrl;
      currentFolderUrl = entry.url;
    } else {
      return { url: entry.url, parentUrl: currentFolderUrl, name: entry.name };
    }
  }

  throw new Error(`Could not resolve path: ${path}`);
}

function swPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', 'automerge%3A');
}
