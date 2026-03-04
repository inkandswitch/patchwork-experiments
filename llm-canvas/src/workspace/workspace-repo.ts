import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import type { WorkspaceChange, WorkspaceChanges, WorkspaceDoc } from './types';

type HandleCache = {
  originalHandle: DocHandle<any>;
  cloneHandle: DocHandle<any>;
};

export type HandleWrapper = {
  readonly url: AutomergeUrl;
  doc(): any;
  change(fn: (doc: any) => void): void;
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn: (...args: any[]) => void): void;
  heads(): any;
};

function createReadOnlyWrapper(handle: DocHandle<any>): HandleWrapper {
  return {
    get url() {
      return handle.url;
    },
    doc() {
      return handle.doc();
    },
    change(_fn: (doc: any) => void) {
      throw new Error('Document is read-only');
    },
    on(event: string, fn: (...args: any[]) => void) {
      handle.on(event as any, fn);
    },
    off(event: string, fn: (...args: any[]) => void) {
      handle.off(event as any, fn);
    },
    heads() {
      return handle.heads();
    },
  };
}

function createReviewedWrapper(
  repo: Repo,
  originalHandle: DocHandle<any>,
  onClone: (originalUrl: AutomergeUrl, cloneHandle: DocHandle<any>) => void,
): HandleWrapper {
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

function createFullAccessWrapper(handle: DocHandle<any>): HandleWrapper {
  return {
    get url() {
      return handle.url;
    },
    doc() {
      return handle.doc();
    },
    change(fn: (doc: any) => void) {
      handle.change(fn);
    },
    on(event: string, fn: (...args: any[]) => void) {
      handle.on(event as any, fn);
    },
    off(event: string, fn: (...args: any[]) => void) {
      handle.off(event as any, fn);
    },
    heads() {
      return handle.heads();
    },
  };
}

export type WorkspaceRepo = {
  find(url: AutomergeUrl): Promise<HandleWrapper>;
  create(): DocHandle<any>;
};

export function getWorkspaceRepo(
  repo: Repo,
  workspaceHandle: DocHandle<WorkspaceDoc>,
): { workspaceRepo: WorkspaceRepo; changes: WorkspaceChanges } {
  // In-memory cache of live handles, keyed by originalUrl
  const handleCache = new Map<AutomergeUrl, HandleCache>();

  const workspaceDoc = workspaceHandle.doc();
  if (!workspaceDoc) throw new Error('Workspace document not ready');

  const entryByUrl = new Map(workspaceDoc.entries.map((e) => [e.url, e]));

  // Pre-populate cache from persisted mappings so existing clones are reused
  // Handles are resolved lazily when find() is called for that originalUrl.

  function recordClone(originalUrl: AutomergeUrl, cloneHandle: DocHandle<any>, originalHandle: DocHandle<any>) {
    if (handleCache.has(originalUrl)) return;
    handleCache.set(originalUrl, { originalHandle, cloneHandle });
    // Persist to workspace doc only if not already stored
    const current = workspaceHandle.doc()?.mappings ?? [];
    if (!current.some((m) => m.originalUrl === originalUrl)) {
      workspaceHandle.change((d) => {
        if (!d.mappings) d.mappings = [] as any;
        (d.mappings as WorkspaceChange[]).push({
          originalUrl,
          cloneUrl: cloneHandle.url,
          changeType: 'modified',
        });
      });
    }
  }

  const workspaceRepo: WorkspaceRepo = {
    async find(url: AutomergeUrl) {
      // Check if we already have a live clone in the cache
      const cached = handleCache.get(url);
      if (cached) {
        return createReviewedWrapper(repo, cached.originalHandle, () => {});
      }

      // Check if there's a persisted mapping for this url (from a previous session)
      const persistedMapping = workspaceHandle.doc()?.mappings?.find((m) => m.originalUrl === url);
      if (persistedMapping && persistedMapping.changeType === 'modified') {
        const originalHandle = await repo.find(url);
        const cloneHandle = await repo.find(persistedMapping.cloneUrl);
        handleCache.set(url, { originalHandle, cloneHandle });
        return createReviewedWrapper(repo, originalHandle, () => {});
      }

      const entry = entryByUrl.get(url);

      if (!entry) {
        if (workspaceDoc.restrictToEntries) {
          throw new Error('Document not in workspace');
        }
        const handle = await repo.find(url);
        return createReadOnlyWrapper(handle);
      }

      const handle = await repo.find(url);

      switch (entry.accessLevel) {
        case 'read':
          return createReadOnlyWrapper(handle);

        case 'reviewed':
          return createReviewedWrapper(repo, handle, (origUrl, clone) => {
            recordClone(origUrl, clone, handle);
          });

        case 'full':
          return createFullAccessWrapper(handle);
      }
    },

    create() {
      const handle = repo.create();
      workspaceHandle.change((d) => {
        if (!d.mappings) d.mappings = [] as any;
        (d.mappings as WorkspaceChange[]).push({
          originalUrl: handle.url,
          cloneUrl: handle.url,
          changeType: 'added',
        });
      });
      return handle;
    },
  };

  const changes: WorkspaceChanges = {
    getChanges(): WorkspaceChange[] {
      return workspaceHandle.doc()?.mappings ?? [];
    },

    async mergeAll() {
      const mappings = workspaceHandle.doc()?.mappings ?? [];
      for (const m of mappings) {
        if (m.changeType === 'modified') {
          const cached = handleCache.get(m.originalUrl);
          if (cached) {
            cached.originalHandle.merge(cached.cloneHandle);
          } else {
            const originalHandle = await repo.find(m.originalUrl);
            const cloneHandle = await repo.find(m.cloneUrl);
            originalHandle.merge(cloneHandle);
          }
        }
      }
      handleCache.clear();
      workspaceHandle.change((d) => {
        d.mappings = [] as any;
      });
    },

    async mergeSingle(originalUrl: AutomergeUrl) {
      const mapping = workspaceHandle.doc()?.mappings?.find((m) => m.originalUrl === originalUrl);
      if (!mapping || mapping.changeType !== 'modified') return;
      const cached = handleCache.get(originalUrl);
      if (cached) {
        cached.originalHandle.merge(cached.cloneHandle);
      } else {
        const originalHandle = await repo.find(originalUrl);
        const cloneHandle = await repo.find(mapping.cloneUrl);
        originalHandle.merge(cloneHandle);
      }
      handleCache.delete(originalUrl);
      workspaceHandle.change((d) => {
        if (d.mappings) {
          const idx = (d.mappings as WorkspaceChange[]).findIndex((m) => m.originalUrl === originalUrl);
          if (idx >= 0) (d.mappings as WorkspaceChange[]).splice(idx, 1);
        }
      });
    },

    revertSingle(originalUrl: AutomergeUrl) {
      handleCache.delete(originalUrl);
      workspaceHandle.change((d) => {
        if (d.mappings) {
          const idx = (d.mappings as WorkspaceChange[]).findIndex((m) => m.originalUrl === originalUrl);
          if (idx >= 0) (d.mappings as WorkspaceChange[]).splice(idx, 1);
        }
      });
    },
  };

  return { workspaceRepo, changes };
}
