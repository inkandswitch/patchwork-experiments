// What a run worker needs from wherever it is running (see ../webworker-lib.ts),
// for a Node process: the build puts this file in that one's place.

import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Repo, WebSocketEndpoint, initSubduction } from '@automerge/automerge-repo-node';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import type { RepoConfig } from '../repo-config';
import type { PlaceSettings } from '../webworker-lib';
import { parseAutomergeImport } from '../import-url';
import { materialise } from './package-files';
import { importTask } from './task-imports';

/** Node resolves imports by itself. */
export async function setUpImportMap(_importMap: unknown, _baseURI: string) {}

let subduction: Promise<unknown> | null = null;
let place: PlaceSettings = {};
let threadRepo: Repo | null = null;

/**
 * A Repo for this thread: a Subduction node with a socket of its own to the
 * sync server, keeping its documents in `place.storageDir`, which no other
 * live Repo uses. On disk, so that code fetched from automerge, and documents
 * found before, are had again without the network.
 *
 * What a task's code writes reaches others only through this Repo's socket,
 * and the run worker says how a run ended only once the server has
 * acknowledged it (run-worker.ts). What a run wrote whose thread was ended
 * before that (a stopped run not done within GRACE_MS, a process that died)
 * stays in this directory, and a later thread on it does not send it: the
 * Repo loads a stored document only when something asks for it.
 */
export async function getRepo(config: RepoConfig, peerId: string, given: PlaceSettings = {}) {
  place = given;
  subduction ??= initSubduction();
  await subduction;
  let ended = () => {};
  const over = new Promise<void>((resolve) => (ended = resolve));
  threadRepo = new Repo({
    network: [],
    subductionWebsocketEndpoints: [watchedEndpoint(new WebSocketEndpoint(config.syncServerUrl), ended)],
    peerId: peerId as any,
    ...(place.storageDir ? { storage: new NodeFSStorageAdapter(place.storageDir) } : {}),
  } as any);
  threadRepo.on('subduction-connection', ({ connected }) => connected && ended());
  attempts.set(threadRepo, over);
  return threadRepo as any;
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

/**
 * The sync server's endpoint, saying `ended` when the first attempt to
 * connect through it has failed. The Repo says when it is connected; a
 * second attempt means the first ended without a connection.
 */
function watchedEndpoint(endpoint: WebSocketEndpoint, ended: () => void) {
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
