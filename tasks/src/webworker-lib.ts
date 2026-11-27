import type { Repo } from '@automerge/automerge-repo/slim';
import type { RepoConfig } from './repo-config';
import { TASKS_DATABASE, TASKS_HEADS_CHANNEL } from './ids';
import { onOrigin } from './import-url';
import { mirror } from './registry-snapshot';
import type { PluginsHere } from './run-worker';

// This file is what a run worker (run-worker.ts) needs from wherever it is
// running: a Repo, and a way to load a task's code. This one is a browser's.
// A Node process brings its own in this file's place (see src/node), and the
// run worker itself is the same code in both.

/**
 * Where a run worker keeps its documents, and, in Node, where it finds code
 * (see node/webworker-lib.node.ts). Each platform reads only its own fields.
 */
export interface PlaceSettings {
  /** In a browser: the IndexedDB database its Repo keeps documents in, which it uses only while it holds the Web Lock of the same name. */
  database?: string;
  /** In Node: where its Repo keeps documents, a directory no other live Repo uses. */
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

/**
 * This worker's plugin registry, the one a task's code gets by importing
 * `@inkandswitch/patchwork-plugins` through the page's import map, made to
 * agree with each snapshot it is handed. A plugin's load() is core's
 * `importPluginFromFolderDocUrl`, as on the page: its package is served by
 * this site's service worker; its module is imported only then, so `own`,
 * which stands where nothing installed has its type and id (`mirror`), needs
 * only the registry's.
 */
export async function pluginMirror(own: { type: string; id: string }[]): Promise<(plugins: PluginsHere) => void> {
  const registry = await (self as any).importShim('@inkandswitch/patchwork-plugins');
  const agree = mirror(registry.getRegistry, async (importUrl, type, id) =>
    (await (self as any).importShim('@inkandswitch/patchwork-filesystem')).importPluginFromFolderDocUrl(importUrl, type, id), own);
  return ({ snapshot }) => agree(snapshot);
}

let importMapReady: Promise<void> | null = null;
let repoModulesReady: Promise<any> | null = null;

/**
 * Gives this worker the page's import map, through es-module-shims (a worker
 * has no import map of its own). The shim is carried in this package, built
 * into a file beside the worker's, so a pool or a run worker starts with
 * nothing fetched from the network: the shim comes with the worker, and the
 * Repo's modules and wasm (getRepo) from what the page's import map names
 * and its origin serves, as the page's own do.
 */
export async function setUpImportMap(importMap: any, baseURI: string) {
  if (!importMapReady) {
    importMapReady = (async () => {
      try {
        console.log('importing es-module-shims...');
        await import('es-module-shims/wasm');
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
 * own to the sync server, or, piped to the page above its pool, with that
 * pipe instead (see below).
 *
 * The pool's worker (no `place.database`) keeps its documents in the tasks
 * database and hears the other Repos of the family on the tasks heads
 * channel, as the page's tasks Repo does (ids.ts).
 *
 * A run worker keeps its documents in a database of its own
 * (`place.database`), as a Node run thread keeps a directory of its own. Its
 * task's code may block this thread at any moment, and an IndexedDB
 * transaction left open by a blocked thread holds up every other transaction
 * on that database until the thread is ended: on the shared database that
 * would hold up the page's stops and the pool's records, so a stop could not
 * even be saved. On its own database it holds up only itself. So what a task
 * writes through `ctx.repo` reaches the page by its pipe, or with none by way
 * of the sync server. The job carries the task's own document, so a run
 * worker never needs the shared database.
 *
 * It uses that database only while it holds the Web Lock of the same name,
 * which it keeps for its whole life. A browser passes a worker's locks on only
 * once the worker has really ended, and a terminated worker spinning in a loop
 * goes on for about 2 s; so a run worker never shares its database with one
 * that is still going, whatever number the pool hands out.
 *
 * Nor does a run worker join the heads channel. What comes on it is news of
 * saves to the shared database, which a Repo on another database cannot load,
 * and what it would say there is news of saves the others cannot load either.
 * The Repo takes the channel as optional, and without one says and hears
 * nothing; a channel of its own would be the same with one more object.
 *
 * A worker under a page that holds the site's Repo is handed its end of a
 * pipe to it (`link`, browser/pool-host.ts), which its Repo takes as its one
 * network adapter, the MessageChannel adapter the page's import map names,
 * and then it has no socket to the sync server: the page's Repo is its way to
 * everything, the server included, network or no network. A Repo asks its
 * classic peers (the pipe) for a document it does not have only once its
 * Subduction source has given up, and a Subduction source that cannot reach
 * its server is still trying, so with a socket of its own and no network a
 * worker would never ask the page.
 *
 * No `signer`, on purpose: the Repo makes itself a new identity each time. The
 * tabs on an origin all sign as one peer, and a worker that did the same would
 * be relying on the server to pass a peer's ephemeral messages back to that
 * same peer's other connections. As a peer of its own it is to the pool what
 * another machine would be.
 */
export async function getRepo(config: RepoConfig, peerId: string, place: PlaceSettings = {}, link?: MessagePort) {
  if (!importMapReady) {
    throw new Error('Import map must be configured before creating a worker repo');
  }

  const { database } = place;
  if (database) {
    await holdForLife(database);
  }

  const { Repo, IndexedDBStorageAdapter, initializeWasm, initSubductionSync } = await getRepoModules();
  const network = link ? [new (await (self as any).importShim('@automerge/automerge-repo-network-messagechannel')).MessageChannelNetworkAdapter(link)] : [];

  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
    fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
  ]);

  initSubductionSync(new Uint8Array(subductionWasm));
  await initializeWasm(new Uint8Array(automergeWasm));
  console.log('Automerge & Subduction WASM initialized');

  const repo: Repo = new Repo({
    storage: new IndexedDBStorageAdapter(database ?? TASKS_DATABASE),
    peerId: peerId as any,
    subductionWebsocketEndpoints: link ? [] : [config.syncServerUrl],
    network,
    ...(database ? {} : { headsChannel: TASKS_HEADS_CHANNEL }),
    enableRemoteHeadsGossiping: true,
  });

  (globalThis as any).repo = repo;

  return repo;
}

/**
 * Resolves once this worker holds the Web Lock `name`, which it then keeps
 * until it ends. A worker with no Web Locks gets no Repo: it could not know
 * that its database is its own.
 */
function holdForLife(name: string): Promise<void> {
  const locks = (self as unknown as { navigator?: Navigator }).navigator?.locks;
  if (!locks) {
    return Promise.reject(new Error('its worker has no Web Locks, so it cannot keep a database to itself'));
  }
  return new Promise<void>((granted, failed) => {
    locks
      .request(name, { mode: 'exclusive' }, () => {
        granted();
        return new Promise<never>(() => {});
      })
      .catch(failed);
  });
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
