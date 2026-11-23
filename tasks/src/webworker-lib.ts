import type { Repo } from '@automerge/automerge-repo/slim';
import type { RepoConfig } from './protocol';

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

// The task workers keep their documents in a database of their own, and tell
// each other what they've saved on a channel of their own, rather than sharing
// the site's. A site's own Repo may not be an ordinary one: on a keyhive site
// it is wrapped in keyhive's machinery, and what that leaves in the site's
// database is its business. Kept apart, the workers are the same on every site.
// They and the site's tabs still see each other's documents, through the server.
const TASKS_DATABASE = 'patchwork-tasks';
const TASKS_HEADS_CHANNEL = 'patchwork-tasks-heads';

/**
 * A Repo for this shared worker: an ordinary Subduction node with a socket of
 * its own to the sync server.
 *
 * Patchwork used to hand workers a MessagePort to one Repo they all synced
 * through. That Repo is gone (every tab is its own node now), and with it the
 * relay that every ephemeral message between two workers had to pass through:
 * a broadcast now goes from this Repo to the server, and from there to every
 * Repo that has the document open, on this machine or any other.
 *
 * No `signer`, on purpose: the Repo makes itself a new identity each time. The
 * tabs on an origin all sign as one peer, and a worker that did the same would
 * be relying on the server to pass a peer's ephemeral messages back to that
 * same peer's other connections, which is exactly the traffic the router, the
 * pool and the workers on one machine send each other. As peers of their own
 * they are to each other what two machines are.
 */
export async function getRepo(config: RepoConfig, peerId: string) {
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
