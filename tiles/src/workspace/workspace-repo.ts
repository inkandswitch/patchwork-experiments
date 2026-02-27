import type { AutomergeUrl, DocHandle, Repo } from '@automerge/automerge-repo';
import type { WorkspaceChange, WorkspaceChanges, WorkspaceDoc } from './types';

type Mapping = {
  originalUrl: AutomergeUrl;
  cloneUrl: AutomergeUrl;
  originalHandle: DocHandle<any>;
  cloneHandle: DocHandle<any>;
  name: string;
  path?: string;
};

type HandleWrapper = {
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
    change() {
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
  workspaceDoc: WorkspaceDoc,
): { workspaceRepo: WorkspaceRepo; changes: WorkspaceChanges } {
  const mappings = new Map<AutomergeUrl, Mapping>();
  const createdUrls: AutomergeUrl[] = [];

  const entryByUrl = new Map(
    workspaceDoc.entries.map((e) => [e.url, e]),
  );

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

  const workspaceRepo: WorkspaceRepo = {
    async find(url: AutomergeUrl) {
      const existingMapping = mappings.get(url);
      if (existingMapping) {
        return createReviewedWrapper(repo, existingMapping.originalHandle, () => {});
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
      const entryPath = entry.type === 'tool' ? entry.path : undefined;

      switch (entry.accessLevel) {
        case 'read':
          return createReadOnlyWrapper(handle);

        case 'reviewed':
          return createReviewedWrapper(repo, handle, (origUrl, clone) => {
            recordClone(origUrl, clone, handle, entry.name, entryPath);
          });

        case 'full':
          return createFullAccessWrapper(handle);
      }
    },

    create() {
      const handle = repo.create();
      createdUrls.push(handle.url);
      return handle;
    },
  };

  const changes: WorkspaceChanges = {
    getChanges(): WorkspaceChange[] {
      const result: WorkspaceChange[] = [];

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

  return { workspaceRepo, changes };
}
