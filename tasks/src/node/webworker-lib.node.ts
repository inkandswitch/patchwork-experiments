// What a run worker needs from wherever it is running (see ../webworker-lib.ts),
// for a Node process: the build puts this file in that one's place.

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Repo, initSubduction } from '@automerge/automerge-repo-node';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { resolvePackageExport } from '@inkandswitch/patchwork-filesystem';
import type { PlaceSettings } from '../webworker-lib';
import { mirror } from '../registry-snapshot';
import type { PluginsHere } from '../run-worker';
import { parseAutomergeImport } from '../import-url';
import { flushesToHost } from '../pipe';
import { materialise, packageText } from './package-files';
import { importTask } from './task-imports';

/** Node resolves imports by itself. */
export async function setUpImportMap(_importMap: unknown, _baseURI: string) {}

let subduction: Promise<unknown> | null = null;
let place: PlaceSettings = {};
let threadRepo: Repo | null = null;

/**
 * A Repo for this thread, which reaches documents only through `link`, its
 * end of the pipe to the host's Repo (../pipe.ts): its one network adapter,
 * with no storage and no socket. Code fetched from automerge, and documents
 * found before, are had from the host's Repo, which keeps them on disk, so
 * with no network a host runs the code it already has. What a task's code
 * writes reaches others through the host's Repo.
 */
export async function getRepo(peerId: string, link: MessagePort, given: PlaceSettings = {}) {
  place = given;
  subduction ??= initSubduction();
  await subduction;
  threadRepo = new Repo({
    network: [new MessageChannelNetworkAdapter(link)],
    peerId: peerId as any,
  } as any);
  flushesToHost(threadRepo as unknown as Parameters<typeof flushesToHost>[0]);
  return threadRepo as any;
}

/** Where code fetched from automerge is kept (see package-files.ts): what the process was started with, or a directory at home. */
const cacheDir = (): string => place.codeDir ?? join(homedir(), '.patchwork-tasks', 'code');

/**
 * Imports a task's code from its import URL. A `data:` URL is the code. A
 * service worker URL names a file in a package kept in automerge, whatever
 * site it was made on: there is no service worker here, so the file and its
 * neighbours are fetched through this thread's Repo and imported from disk.
 * Nothing else can be imported from here. What the code imports by bare
 * name is resolved as task-imports.ts says: Automerge and its Repo are this
 * thread's own.
 */
export async function importModule(importUrl: string): Promise<any> {
  if (importUrl.startsWith('data:')) {
    return importTask(importUrl, 'carried');
  }
  const found = parseAutomergeImport(importUrl);
  if (!found) {
    throw new Error(
      `a worker in a process imports code kept in automerge, or a data: URL; this is neither: ${importUrl.slice(0, 120)}`,
    );
  }
  const here = localCopy(found.packageUrl, found.path);
  if (here) {
    return importTask(pathToFileURL(here).href, 'installed');
  }
  if (!threadRepo) {
    throw new Error("code kept in automerge is fetched through the worker's Repo, and it has none");
  }
  const file = await materialise(threadRepo as any, found, cacheDir());
  return importTask(pathToFileURL(file).href, 'carried');
}

/**
 * Where `path` of a package is on this machine, if the process was started
 * with a copy of that package (`--local`, see host.ts): the code then comes
 * from there, with whatever it imports beside it, whichever version of the
 * package the task named. Null for a package there's no copy of. A path that
 * would leave the copy's directory is refused.
 */
function localCopy(packageUrl: string, path: string): string | null {
  const dir = place.local?.[packageUrl];
  if (!dir) {
    return null;
  }
  const file = resolve(dir, path);
  if (!file.startsWith(resolve(dir) + sep)) {
    throw new Error(`${path} is not inside the copy of ${packageUrl} here`);
  }
  return file;
}

/**
 * A package kept in automerge, at the heads `urlAtHeads` names, imported from
 * disk: what core's page does through the service worker
 * (`importPackageFromFolderDocUrl`), with materialise in its place. Its
 * package.json is read from its documents, its entry resolved with core's
 * conditions, and the entry's directory written to disk and imported as code
 * carried from elsewhere (task-imports.ts). The host's ModuleWatcher imports
 * packages with this (host.ts); `entry` is where it is on disk, which a run
 * thread loads from.
 */
export async function importPackage(repo: any, urlAtHeads: string, codeDir: string): Promise<{ module: any; entry: string }> {
  // the path as package.json names it, not escaped as a url would have it
  const at = (path: string) => ({ ...parseAutomergeImport(`/${encodeURIComponent(urlAtHeads)}/package.json`)!, path });
  const manifest = JSON.parse(await packageText(repo, at('package.json')));
  const entry = await materialise(repo, at(resolvePackageExport(manifest).replace(/^\.\//, '')), codeDir);
  return { module: await importTask(pathToFileURL(entry).href, 'carried'), entry };
}

/**
 * This thread's plugin registry, the one a task's code gets by importing
 * `@inkandswitch/patchwork-plugins` (task-imports.ts), made to agree with
 * each snapshot it is handed. A plugin's load() imports its package's entry
 * from where the host put it on disk (`packages`), so it needs no network
 * and no document, and runs that plugin's own load(), as core's
 * `importPluginFromFolderDocUrl` does on a page. `own` stands where nothing
 * installed has its type and id (`mirror`).
 */
export async function pluginMirror(own: { type: string; id: string }[]): Promise<(plugins: PluginsHere) => void> {
  const registry = await import('@inkandswitch/patchwork-plugins');
  let packages: Record<string, string> = {};
  const agree = mirror(registry.getRegistry, async (importUrl, type, id) => {
    const entry = packages[importUrl];
    if (!entry) {
      throw new Error(`the package ${importUrl} is not on this machine's disk`);
    }
    const module = await importTask(pathToFileURL(entry).href, 'carried');
    const plugin = (Array.isArray(module?.plugins) ? module.plugins : []).find((p: any) => p?.type === type && p?.id === id);
    if (typeof plugin?.load !== 'function') {
      throw new Error(`the package ${importUrl} has no plugin "${type}:${id}" with a load()`);
    }
    return plugin.load();
  }, own);
  return (plugins) => {
    packages = plugins.packages ?? {};
    agree(plugins.snapshot);
  };
}
