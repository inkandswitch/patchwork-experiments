import type { Repo } from '@automerge/automerge-repo/slim';
import type { RepoConfig } from './repo-config';
import { TASKS_DATABASE, TASKS_HEADS_CHANNEL } from './ids';
import { onOrigin } from './import-url';

// This file is what a run worker (run-worker.ts) needs from wherever it is
// running: a Repo, and a way to load a task's code. This one is a browser's.
// A Node process brings its own in this file's place (see src/node), and the
// run worker itself is the same code in both.

/**
 * What only a run worker in a Node process is told (see
 * node/webworker-lib.node.ts). A browser's keeps its documents in the tasks
 * database and has its code from the site, and ignores it.
 */
export interface PlaceSettings {
  /** Where its Repo keeps documents: a directory no other live Repo uses. */
  storageDir?: string;
  /** Where code fetched from automerge is written (see node/package-files.ts). */
  codeDir?: string;
  /** Packages whose code is run from a directory here: `automerge:<package>` to a path. */
  local?: Record<string, string>;
}

/**
 * Imports a task's code from its import URL, bare specifiers in it resolved
 * by the page's import map. Code kept in automerge is fetched from this
 * site's own service worker, whichever site the URL was made on (see
 * import-url.ts).
 */
export const importModule = (importUrl: string): Promise<any> =>
  (self as any).importShim(onOrigin(importUrl, self.location.origin));

const shimCodeUrl = 'https://ga.jspm.io/npm:es-module-shims@1.6.2/dist/es-module-shims.wasm.js';

let importMapReady: Promise<void> | null = null;
let repoModulesReady: Promise<any> | null = null;

export async function setUpImportMap(importMap: any, baseURI: string) {
  if (!importMapReady) {
    importMapReady = (async () => {
      try {
        console.log('importing es-module-shims...');
        await import(shimCodeUrl);
        console.log('done');
      } catch (error) {
        console.error('failed to import es-module-shims:', error);
        throw error;
      }

      (self as any).importShim.addImportMap(resolveImportMap(importMap, baseURI));
    })();
  }

  await importMapReady;
}

function resolveImportMap(importMap: any, baseURI: string) {
  const resolvedImportMap: any = {};

  if (importMap.imports) {
    resolvedImportMap.imports = {};
    for (const [key, value] of Object.entries(importMap.imports)) {
      try {
        resolvedImportMap.imports[key] = new URL(value as any, baseURI).href;
      } catch (e) {
        console.warn(`failed to resolve import map entry ${key}: ${value}`, e);
        resolvedImportMap.imports[key] = value;
      }
    }
  }

  if (importMap.scopes) {
    resolvedImportMap.scopes = {};
    for (const [scopeKey, scopeMap] of Object.entries(importMap.scopes)) {
      let resolvedScopeKey;
      try {
        resolvedScopeKey = new URL(scopeKey, baseURI).href;
      } catch (e) {
        console.warn(`failed to resolve scope key ${scopeKey}`, e);
        resolvedScopeKey = scopeKey;
      }

      resolvedImportMap.scopes[resolvedScopeKey] = {};
      for (const [key, value] of Object.entries(scopeMap as any)) {
        try {
          resolvedImportMap.scopes[resolvedScopeKey][key] = new URL(value as any, baseURI).href;
        } catch (e) {
          console.warn(`failed to resolve scope entry ${scopeKey}[${key}]: ${value}`, e);
          resolvedImportMap.scopes[resolvedScopeKey][key] = value;
        }
      }
    }
  }

  console.log('Import map configured from main thread', resolvedImportMap);
  return resolvedImportMap;
}

/**
 * A Repo for this worker: an ordinary Subduction node with a socket of its
 * own to the sync server, keeping its documents in the tasks database.
 *
 * No `signer`, on purpose: the Repo makes itself a new identity each time. The
 * tabs on an origin all sign as one peer, and a worker that did the same would
 * be relying on the server to pass a peer's ephemeral messages back to that
 * same peer's other connections. As a peer of its own it is to the pool what
 * another machine would be.
 */
export async function getRepo(config: RepoConfig, peerId: string, _place?: PlaceSettings) {
  if (!importMapReady) {
    throw new Error('Import map must be configured before creating a worker repo');
  }

  const { Repo, IndexedDBStorageAdapter, initializeWasm, initSubductionSync } =
    await getRepoModules();

  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
    fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
  ]);

  initSubductionSync(new Uint8Array(subductionWasm));
  await initializeWasm(new Uint8Array(automergeWasm));
  console.log('Automerge & Subduction WASM initialized');

  const repo: Repo = new Repo({
    storage: new IndexedDBStorageAdapter(TASKS_DATABASE),
    peerId: peerId as any,
    subductionWebsocketEndpoints: [config.syncServerUrl],
    headsChannel: TASKS_HEADS_CHANNEL,
    enableRemoteHeadsGossiping: true,
  });

  (globalThis as any).repo = repo;

  return repo;
}

async function getRepoModules() {
  if (!repoModulesReady) {
    repoModulesReady = (async () => {
      await importMapReady;

      const [automerge, repo, storage, subduction] = await Promise.all([
        (self as any).importShim('@automerge/automerge/slim'),
        (self as any).importShim('@automerge/automerge-repo/slim'),
        (self as any).importShim('@automerge/automerge-repo-storage-indexeddb'),
        (self as any).importShim('@automerge/automerge-subduction/slim'),
      ]);

      return {
        Repo: repo.Repo,
        IndexedDBStorageAdapter: storage.IndexedDBStorageAdapter,
        initializeWasm: automerge.initializeWasm,
        initSubductionSync: subduction.initSync,
      };
    })();
  }

  return repoModulesReady;
}
