import type { Repo } from '@automerge/automerge-repo/slim';
import type { RepoConfig } from './repo-config';
import { TASKS_DATABASE, TASKS_HEADS_CHANNEL } from './ids';
import { onOrigin } from './import-url';

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
 * own to the sync server.
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
 * even be saved. On its own database it holds up only itself. The cost: what
 * a task writes through `ctx.repo` reaches the page and the pool only by way
 * of the sync server (its run's record does not: the pool writes that, from
 * what the run worker says), which is why a run worker says how a run ended
 * only once the server has acknowledged what it wrote (run-worker.ts). The
 * job carries the task's own document, so a run worker never needs the
 * shared database.
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
 * No `signer`, on purpose: the Repo makes itself a new identity each time. The
 * tabs on an origin all sign as one peer, and a worker that did the same would
 * be relying on the server to pass a peer's ephemeral messages back to that
 * same peer's other connections. As a peer of its own it is to the pool what
 * another machine would be.
 */
export async function getRepo(config: RepoConfig, peerId: string, place: PlaceSettings = {}) {
  if (!importMapReady) {
    throw new Error('Import map must be configured before creating a worker repo');
  }

  const { database } = place;
  if (database) {
    await holdForLife(database);
  }

  const { Repo, WebSocketEndpoint, IndexedDBStorageAdapter, initializeWasm, initSubductionSync } =
    await getRepoModules();

  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
    fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
  ]);

  initSubductionSync(new Uint8Array(subductionWasm));
  await initializeWasm(new Uint8Array(automergeWasm));
  console.log('Automerge & Subduction WASM initialized');

  // A Repo whose package does not offer endpoints is handed the url, and
  // its first attempt counts as over from the start.
  let ended = () => {};
  const over = new Promise<void>((resolve) => (ended = resolve));
  const endpoint = WebSocketEndpoint
    ? watchedEndpoint(new WebSocketEndpoint(config.syncServerUrl), ended)
    : (ended(), config.syncServerUrl);

  const repo: Repo = new Repo({
    storage: new IndexedDBStorageAdapter(database ?? TASKS_DATABASE),
    peerId: peerId as any,
    subductionWebsocketEndpoints: [endpoint],
    ...(database ? {} : { headsChannel: TASKS_HEADS_CHANNEL }),
    enableRemoteHeadsGossiping: true,
  });
  repo.on('subduction-connection' as any, ({ connected }: { connected: boolean }) => connected && ended());
  attempts.set(repo, over);

  (globalThis as any).repo = repo;

  return repo;
}

/** By Repo made here, when its first attempt to reach the sync server ended. */
const attempts = new WeakMap<object, Promise<void>>();

/**
 * Resolves once the Repo's first attempt to reach its sync server has ended,
 * connected or not: a Repo that is not connected then is offline, not about
 * to connect. At once for a Repo not made here.
 */
export function firstAttempt(repo: object): Promise<void> {
  return attempts.get(repo) ?? Promise.resolve();
}

interface Endpoint {
  url: string;
  connect(): Promise<unknown>;
}

/**
 * The sync server's endpoint, saying `ended` when the first attempt to
 * connect through it has failed. The Repo says when it is connected; a
 * second attempt means the first ended without a connection.
 */
function watchedEndpoint(endpoint: Endpoint, ended: () => void): Endpoint {
  let tries = 0;
  return {
    url: endpoint.url,
    connect() {
      if (++tries > 1) {
        ended();
      }
      const transport = endpoint.connect();
      transport.catch(ended);
      return transport;
    },
  };
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
        WebSocketEndpoint: repo.WebSocketEndpoint as (new (url: string) => Endpoint) | undefined,
        IndexedDBStorageAdapter: storage.IndexedDBStorageAdapter,
        initializeWasm: automerge.initializeWasm,
        initSubductionSync: subduction.initSync,
      };
    })();
  }

  return repoModulesReady;
}
