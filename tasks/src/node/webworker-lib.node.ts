// What a worker needs from wherever it is running (see ../webworker-lib.ts),
// for a Node process: the build puts this file in that one's place.

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Repo, initSubduction } from '@automerge/automerge-repo-node';
import type { RepoConfig } from '../protocol';
import { parseAutomergeImport } from '../import-url';
import { materialise } from './package-files';

/** Node resolves imports by itself. */
export async function setUpImportMap(_importMap: unknown, _baseURI: string) {}

let subduction: Promise<unknown> | null = null;

/**
 * A Repo for this thread: a Subduction node with a socket of its own to the
 * sync server, as each shared worker has in a browser. It keeps nothing on
 * disk: what it needs it fetches, and what it writes the server has.
 */
export async function getRepo(config: RepoConfig, peerId: string) {
  subduction ??= initSubduction();
  await subduction;
  const repo = new Repo({
    network: [],
    subductionWebsocketEndpoints: [config.syncServerUrl],
    peerId: peerId as any,
  } as any);
  (globalThis as any).repo = repo;
  return repo as any;
}

/** Where code fetched from automerge is kept (see package-files.ts): what the process was started with, or a directory at home. */
const cacheDir = (): string =>
  (globalThis as any).__tasksCodeDir ?? join(homedir(), '.patchwork-tasks', 'code');

/**
 * Imports a task's code from its import URL. A `data:` URL is the code. A
 * service worker URL names a file in a package kept in automerge, whatever
 * site it was made on: there is no service worker here, so the file and its
 * neighbours are fetched through this thread's Repo and imported from disk.
 * Nothing else can be imported from here.
 */
export async function importModule(importUrl: string): Promise<any> {
  if (importUrl.startsWith('data:')) {
    return import(importUrl);
  }
  const found = parseAutomergeImport(importUrl);
  if (!found) {
    throw new Error(
      `a worker in a process imports code kept in automerge, or a data: URL; this is neither: ${importUrl.slice(0, 120)}`,
    );
  }
  const here = localCopy(found.packageUrl, found.path);
  if (here) {
    return import(pathToFileURL(here).href);
  }
  const file = await materialise((globalThis as any).repo, found, cacheDir());
  return import(pathToFileURL(file).href);
}

/**
 * Where `path` of a package is on this machine, if the process was started
 * with a copy of that package (`--local`, see host.ts): the code then comes
 * from there, with whatever it imports beside it, whichever version of the
 * package the task named. Null for a package there's no copy of. A path that
 * would leave the copy's directory is refused.
 */
function localCopy(packageUrl: string, path: string): string | null {
  const dir: string | undefined = (globalThis as any).__tasksLocalCode?.[packageUrl];
  if (!dir) {
    return null;
  }
  const file = resolve(dir, path);
  if (!file.startsWith(resolve(dir) + sep)) {
    throw new Error(`${path} is not inside the copy of ${packageUrl} here`);
  }
  return file;
}
