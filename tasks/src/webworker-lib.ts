import type { Repo } from '@automerge/automerge-repo/slim';
import { onOrigin } from './import-url';
import { flushesToHost } from './pipe';
import { mirror } from './registry-snapshot';
import type { PluginsHere } from './run-worker';

// This file is what a run worker (run-worker.ts) needs from wherever it is
// running: a Repo, and a way to load a task's code. This one is a browser's.
// A Node process brings its own in this file's place (see src/node), and the
// run worker itself is the same code in both.

/** Where, in Node, a run thread finds code. */
export interface PlaceSettings {
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
 * A Repo for this worker, which reaches documents only through `link`, its
 * end of the pipe to its host's Repo (pipe.ts): that is its one network
 * adapter, and it has no storage and no socket. What it keeps is kept by the
 * host's Repo, which sends it on.
 *
 * No `signer`, on purpose: the Repo makes itself a new identity each time. The
 * tabs on an origin all sign as one peer, and a worker that did the same would
 * be relying on the server to pass a peer's ephemeral messages back to that
 * same peer's other connections. As a peer of its own it is to the host's
 * Repo what another machine would be.
 */
export async function getRepo(peerId: string, link: MessagePort, _place?: PlaceSettings) {
  if (!importMapReady) {
    throw new Error('Import map must be configured before creating a worker repo');
  }

  const { Repo, MessageChannelNetworkAdapter, initializeWasm, initSubductionSync } = await getRepoModules();

  const [automergeWasm, subductionWasm] = await Promise.all([
    fetch('/automerge.wasm').then((r) => r.arrayBuffer()),
    fetch('/subduction.wasm').then((r) => r.arrayBuffer()),
  ]);

  initSubductionSync(new Uint8Array(subductionWasm));
  await initializeWasm(new Uint8Array(automergeWasm));
  console.log('Automerge & Subduction WASM initialized');

  const repo: Repo = new Repo({
    peerId: peerId as any,
    network: [new MessageChannelNetworkAdapter(link)],
    enableRemoteHeadsGossiping: true,
  });

  flushesToHost(repo);
  (globalThis as any).repo = repo;

  return repo;
}

async function getRepoModules() {
  if (!repoModulesReady) {
    repoModulesReady = (async () => {
      await importMapReady;

      const [automerge, repo, channel, subduction] = await Promise.all([
        (self as any).importShim('@automerge/automerge/slim'),
        (self as any).importShim('@automerge/automerge-repo/slim'),
        (self as any).importShim('@automerge/automerge-repo-network-messagechannel'),
        (self as any).importShim('@automerge/automerge-subduction/slim'),
      ]);

      return {
        Repo: repo.Repo,
        MessageChannelNetworkAdapter: channel.MessageChannelNetworkAdapter,
        initializeWasm: automerge.initializeWasm,
        initSubductionSync: subduction.initSync,
      };
    })();
  }

  return repoModulesReady;
}
