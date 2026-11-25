// Code kept in automerge, on disk: what the site's service worker does for a
// browser, for a process that has none.
//
// A task's import URL names a file in a package (see ../import-url.ts). A
// browser imports that URL and the service worker answers from the package's
// folder doc. Here the same folder doc is read through this process's own
// Repo, the files beside the one wanted are written to a directory, and the
// task's code is imported from there, so its relative imports find their
// neighbours the ordinary way.
//
// A directory holds one version and is never written twice: its name is a
// digest of exactly which files, at which heads, are in it. A package whose
// URL names its heads always lands in the same place; one that doesn't lands
// wherever its files' heads say today, so "the latest" is looked up afresh
// for each task and costs nothing when nothing has changed.
//
// What is written is the top-level directory the wanted file is in (`dist/`,
// for `dist/tasks/wait.js`), without source maps, and no node_modules. Code
// here imports its neighbours, Node's own modules, and by bare name only
// Automerge and its Repo, which are the run thread's own (task-imports.ts);
// any other bare name fails, as there is nothing here for it to be.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AutomergeImport } from '../import-url';

interface Handle {
  doc(): any;
  heads(): string[];
}
interface AnyRepo {
  find(url: any): Promise<Handle>;
}

const FIND_TIMEOUT_MS = 60_000;

const within = <T>(promise: Promise<T>, what: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} didn't arrive in ${FIND_TIMEOUT_MS / 1000} s`)), FIND_TIMEOUT_MS),
    ),
  ]);

const isUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('automerge:');

/** Whether `path` is one to write for a module in `top` (a directory with its slash, or '' for the package's root). */
const wanted = (path: string, top: string) =>
  path.startsWith(top) && !path.endsWith('.map') && !/(^|\/)(node_modules|\.pushwork[^/]*)\//.test(path);

/**
 * Every file of the package under `top`, by its path: the url of its doc. A
 * package's folder doc is one of two shapes: a flat map from path to file
 * (pushwork's `directory`), or a tree of `docs` lists (a Patchwork `folder`).
 */
async function listFiles(repo: AnyRepo, root: any, top: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (Array.isArray(root?.docs)) {
    const walk = async (folder: any, base: string) => {
      for (const entry of folder?.docs ?? []) {
        if (typeof entry?.name !== 'string' || !isUrl(entry.url)) continue;
        const path = base + entry.name;
        if (entry.type === 'folder') {
          const inside = `${path}/`;
          // only the folders on the way to `top`, and those within it
          if (top.startsWith(inside) || inside.startsWith(top)) {
            await walk((await within(repo.find(entry.url), `the folder ${path}`)).doc(), inside);
          }
        } else if (wanted(path, top)) {
          files.set(path, entry.url);
        }
      }
    };
    await walk(root, '');
  } else {
    for (const [path, url] of Object.entries(root ?? {})) {
      if (isUrl(url) && !path.startsWith('@') && wanted(path, top)) {
        files.set(path, url);
      }
    }
  }
  return files;
}

/** A file doc's content, as bytes: text, text that is never edited (a build's output), or bytes. */
function bytesOf(content: unknown): Uint8Array {
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (typeof (content as any)?.val === 'string') {
    return Buffer.from((content as any).val, 'utf8');
  }
  throw new Error('a file in the package has content that is neither text nor bytes');
}

// packages whose every url names its heads never change: where each landed
const settled = new Map<string, string>();

/**
 * Writes the files beside `wantedImport.path` to a directory under
 * `cacheDir`, if that version isn't there already, and resolves to the path
 * of the file itself.
 */
export async function materialise(
  repo: AnyRepo,
  wantedImport: AutomergeImport,
  cacheDir: string,
): Promise<string> {
  const { docUrl, packageUrl, path } = wantedImport;
  const slash = path.indexOf('/');
  const top = slash < 0 ? '' : path.slice(0, slash + 1);
  const settledKey = `${docUrl} ${top}`;
  const already = settled.get(settledKey);
  if (already) {
    return join(already, path);
  }

  const root = (await within(repo.find(docUrl), `the package ${packageUrl}`)).doc();
  const files = await listFiles(repo, root, top);
  if (!files.has(path)) {
    throw new Error(`there is no ${path} in the package ${docUrl}`);
  }

  // each file's doc, and with them exactly which version of each this is
  const paths = [...files.keys()].sort();
  const handles = new Map<string, Handle>();
  await Promise.all(
    paths.map(async (file) => {
      handles.set(file, await within(repo.find(files.get(file)!), `${file} of ${packageUrl}`));
    }),
  );
  const digest = createHash('sha256');
  for (const file of paths) {
    digest.update(`${file}\t${files.get(file)}\t${[...handles.get(file)!.heads()].sort().join('|')}\n`);
  }
  const dir = join(cacheDir, packageUrl.slice('automerge:'.length), digest.digest('hex').slice(0, 32));

  const there = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!there) {
    // written beside where it goes and moved into place whole, so that nothing
    // ever imports from a directory that is half there
    const making = `${dir}.making-${randomUUID()}`;
    for (const file of paths) {
      const target = join(making, file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytesOf(handles.get(file)!.doc()?.content));
    }
    if (!files.has('package.json')) {
      // these are ES modules, whatever their file names end in
      await writeFile(join(making, 'package.json'), '{ "type": "module" }\n');
    }
    try {
      await rename(making, dir);
    } catch (error) {
      // another thread of this process got it there first
      await rm(making, { recursive: true, force: true });
      if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) {
        throw error;
      }
    }
  }

  const pinned = wantedImport.heads !== null && [...files.values()].every((url) => url.includes('#'));
  if (pinned) {
    settled.set(settledKey, dir);
  }
  return join(dir, path);
}
