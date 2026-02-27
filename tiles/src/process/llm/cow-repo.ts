import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import type { CowChange, CowChanges } from './types';

type Mapping = {
  originalUrl: AutomergeUrl;
  cloneUrl: AutomergeUrl;
  originalHandle: DocHandle<any>;
  cloneHandle: DocHandle<any>;
  name: string;
  path?: string;
};

/**
 * Minimal handle wrapper that only exposes url, doc, change, on, off, heads.
 * On first .change() call, clones the original doc and records the mapping.
 * The .url property always returns the original URL.
 */
function createHandleWrapper(
  repo: Repo,
  originalHandle: DocHandle<any>,
  onClone: (originalUrl: AutomergeUrl, cloneHandle: DocHandle<any>) => void,
) {
  let cloneHandle: DocHandle<any> | null = null;

  function ensureClone(): DocHandle<any> {
    if (!cloneHandle) {
      cloneHandle = repo.clone(originalHandle);
      onClone(originalHandle.url, cloneHandle);
    }
    return cloneHandle;
  }

  function activeHandle(): DocHandle<any> {
    return cloneHandle ?? originalHandle;
  }

  return {
    get url() {
      return originalHandle.url;
    },
    doc() {
      return activeHandle().doc();
    },
    change(fn: (doc: any) => void) {
      ensureClone().change(fn);
    },
    on(event: string, fn: (...args: any[]) => void) {
      activeHandle().on(event as any, fn);
    },
    off(event: string, fn: (...args: any[]) => void) {
      activeHandle().off(event as any, fn);
    },
    heads() {
      return activeHandle().heads();
    },
  };
}

export type CowRepo = {
  find(url: AutomergeUrl): Promise<ReturnType<typeof createHandleWrapper>>;
  create(): DocHandle<any>;
};

export function getCopyOnWriteRepo(repo: Repo): { cowRepo: CowRepo; changes: CowChanges } {
  const mappings = new Map<AutomergeUrl, Mapping>();
  const createdUrls: AutomergeUrl[] = [];

  function recordClone(
    originalUrl: AutomergeUrl,
    cloneHandle: DocHandle<any>,
    originalHandle: DocHandle<any>,
    name?: string,
    path?: string,
  ) {
    if (mappings.has(originalUrl)) return;
    mappings.set(originalUrl, {
      originalUrl,
      cloneUrl: cloneHandle.url,
      originalHandle,
      cloneHandle,
      name: name ?? originalUrl,
      path,
    });
  }

  const cowRepo: CowRepo = {
    async find(url: AutomergeUrl) {
      const existing = mappings.get(url);
      if (existing) {
        return createHandleWrapper(repo, existing.originalHandle, () => {});
      }

      const handle = await repo.find(url);
      return createHandleWrapper(repo, handle, (origUrl, clone) => {
        recordClone(origUrl, clone, handle);
      });
    },

    create() {
      const handle = repo.create();
      createdUrls.push(handle.url);
      return handle;
    },
  };

  const changes: CowChanges = {
    getChanges(): CowChange[] {
      const result: CowChange[] = [];

      for (const m of mappings.values()) {
        result.push({
          originalUrl: m.originalUrl,
          cloneUrl: m.cloneUrl,
          changeType: 'modified',
          name: m.name,
          path: m.path,
        });
      }

      for (const url of createdUrls) {
        result.push({
          originalUrl: url,
          cloneUrl: url,
          changeType: 'added',
          name: url,
        });
      }

      return result;
    },

    async mergeAll() {
      for (const m of mappings.values()) {
        m.originalHandle.merge(m.cloneHandle);
      }
      mappings.clear();
      createdUrls.length = 0;
    },

    async mergeSingle(originalUrl: AutomergeUrl) {
      const m = mappings.get(originalUrl);
      if (!m) return;
      m.originalHandle.merge(m.cloneHandle);
      mappings.delete(originalUrl);
    },

    revertSingle(originalUrl: AutomergeUrl) {
      mappings.delete(originalUrl);
    },
  };

  return { cowRepo, changes };
}
