// @vitest-environment node
//
// What a task's code finds by bare name in a Node run thread (task-imports.ts),
// in a real worker thread that does what run-thread.mjs does: it imports the
// Repo from `@automerge/automerge-repo-node` as the host's bundle does, from a
// file inside this package (so Node resolves the host's own imports from this
// package's node_modules, as it does for dist-node/), then shares Automerge
// and imports task code. Each case below is checked on purpose:
//
// - code carried with a task, in a directory with no node_modules (as code
//   fetched from automerge is), imports each shared name and gets the very
//   module the thread's Repo is made from, also through a relative import,
//   and appends with `splice` to a text of a document that Repo made;
// - the same from a data: URL;
// - carried code imports Node's built-in modules by bare name;
// - carried code importing any other bare name, directly or through a
//   relative import, fails with the error that says what it may import;
// - carried code that imports while it runs, after it was loaded (import(),
//   require through createRequire, import.meta.resolve), is held to the same:
//   the shared names are the thread's own, any other bare name fails;
// - code installed on this machine (--local) imports its own dependencies
//   from its node_modules, and the shared names, there and in those
//   dependencies, are the thread's own, not a copy in that node_modules;
// - a CommonJS dependency of installed code that requires the shared names,
//   before any task has imported them, gets the very ES modules the Repo
//   uses, not the copy CommonJS rules would find beside it (the second copy
//   in that node_modules), and so does every task after it;
// - the host's own code resolves as Node does: its `@automerge/automerge` is
//   this package's own dependency (another copy than the Repo's), and a bare
//   name that is nowhere fails with Node's own error.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { unshared } from './task-imports';

const pkgRoot = fileURLToPath(new URL('../..', import.meta.url));
const hooks = new URL('./task-imports.ts', import.meta.url).href;
const hostDir = mkdtempSync(join(pkgRoot, 'node_modules', '.task-imports-test-'));
const codeDir = mkdtempSync(join(tmpdir(), 'task-imports-test-'));
afterAll(() => {
  rmSync(hostDir, { recursive: true, force: true });
  rmSync(codeDir, { recursive: true, force: true });
});

const put = (path: string, source: string) => {
  const file = join(codeDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return pathToFileURL(file).href;
};
const dataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const APPEND = `(handle, piece) => handle.change((d) => splice(d, ['text'], d.text.length, 0, piece))`;

// carried: no node_modules anywhere above it but the package.json a fetched package gets
put('carried/package.json', '{ "type": "module" }\n');
const carried = put(
  'carried/append.js',
  `import { splice } from '@automerge/automerge';
import { splice as slimSplice } from '@automerge/automerge/slim';
import * as repo from '@automerge/automerge-repo';
import * as slimRepo from '@automerge/automerge-repo/slim';
import { Repo as besideRepo } from './beside.js';
import { join } from 'node:path';
import { sep } from 'path';
export const got = { splice, slimSplice, Repo: repo.Repo, repoSplice: repo.splice, slimRepo: slimRepo.Repo, besideRepo, builtins: typeof join === 'function' && typeof sep === 'string' };
export default ${APPEND};`,
);
put('carried/beside.js', `export { Repo } from '@automerge/automerge-repo/slim';`);
const carriedBare = put('carried/bare.js', `import earcut from 'earcut'; export default earcut;`);
const carriedBareBeside = put('carried/bare-beside.js', `export { default } from './bare.js';`);
const data = dataUrl(`import { splice } from '@automerge/automerge';
import { splice as repoSplice, Repo } from '@automerge/automerge-repo';
export const got = { splice, repoSplice, Repo };
export default ${APPEND};`);
const dataBare = dataUrl(`import earcut from 'earcut'; export default earcut;`);
// carried code that imports only once it runs
const later = put(
  'carried/later.js',
  `import { createRequire } from 'node:module';
const outcome = async (f) => { try { return { value: await f() }; } catch (error) { return { error: { message: error?.message, code: error?.code } }; } };
export default async () => {
  const require = createRequire(import.meta.url);
  return {
    importShared: await outcome(async () => (await import('@automerge/automerge')).splice),
    importBare: await outcome(() => import('earcut')),
    requireRepo: await outcome(() => require('@automerge/automerge-repo').Repo),
    requireBare: await outcome(() => require('earcut')),
    resolveBare: await outcome(() => import.meta.resolve('earcut')),
  };
};`,
);

// installed: a package checked out here, with a dependency and a second copy of Automerge in its node_modules
put('installed/package.json', '{ "type": "module" }\n');
const installed = put(
  'installed/task.js',
  `import { splice } from '@automerge/automerge';
import * as lib from 'fake-lib';
export const got = { splice, libSplice: lib.splice, libName: lib.name };
export default ${APPEND};`,
);
put('installed/node_modules/fake-lib/package.json', '{ "name": "fake-lib", "type": "module", "exports": "./index.js" }\n');
put('installed/node_modules/fake-lib/index.js', `export { splice } from '@automerge/automerge'; export const name = 'fake-lib';`);
put(
  'installed/node_modules/@automerge/automerge/package.json',
  '{ "name": "@automerge/automerge", "type": "module", "exports": { ".": "./index.js" } }\n',
);
put('installed/node_modules/@automerge/automerge/index.js', `export const splice = 'a second copy';`);
const installedCjs = put('installed/cjs-user.js', `import lib from 'fake-cjs'; export const got = lib;`);
put('installed/node_modules/fake-cjs/package.json', '{ "name": "fake-cjs", "main": "index.js" }\n');
put(
  'installed/node_modules/fake-cjs/index.js',
  `module.exports = {
  splice: require('@automerge/automerge').splice,
  slimSplice: require('@automerge/automerge/slim').splice,
  Repo: require('@automerge/automerge-repo').Repo,
  slimRepo: require('@automerge/automerge-repo/slim').Repo,
};`,
);

const THREAD = `
import { parentPort, workerData } from 'node:worker_threads';
import * as RepoModule from '@automerge/automerge-repo-node';
import { initSubduction } from '@automerge/automerge-repo-node';
const { shareAutomerge, importTask } = await import(workerData.hooks);
shareAutomerge();

const outcome = async (promise) => promise.then((value) => ({ value }), (error) => ({ error: { message: error?.message, code: error?.code } }));
await initSubduction();
const repo = new RepoModule.Repo({ network: [] });
const handle = repo.create({ text: '' });
const same = (got) => Object.fromEntries(Object.entries(got).map(([name, value]) => [name, value === (/Repo$/i.test(name) ? RepoModule.Repo : RepoModule.splice) ? 'same' : String(value).slice(0, 40)]));

const report = {};
// First of all, so that the first time this thread resolves a shared name it
// is for a require: each name is resolved once and kept.
const cjs = await importTask(workerData.installedCjs, 'installed');
report.cjs = same(cjs.got);
const c = await importTask(workerData.carried, 'carried');
report.carried = same(Object.fromEntries(Object.entries(c.got).filter(([n]) => n !== 'builtins')));
report.builtins = c.got.builtins;
c.default(handle, 'ab');
c.default(handle, 'cd');
const d = await importTask(workerData.data, 'carried');
report.data = same(d.got);
d.default(handle, 'ef');
const i = await importTask(workerData.installed, 'installed');
report.installed = same({ splice: i.got.splice, libSplice: i.got.libSplice });
report.libName = i.got.libName;
i.default(handle, 'gh');
report.text = handle.doc().text;
report.changes = RepoModule.getAllChanges(handle.doc()).length;

report.carriedBare = await outcome(importTask(workerData.carriedBare, 'carried'));
report.carriedBareBeside = await outcome(importTask(workerData.carriedBareBeside, 'carried'));
report.dataBare = await outcome(importTask(workerData.dataBare, 'carried'));

const l = await (await importTask(workerData.later, 'carried')).default();
report.later = Object.fromEntries(Object.entries(l).map(([name, got]) => [name, got.error ? got : same({ [name]: got.value })[name]]));

// the host's own code, after the hooks are in: Node's resolution, from this package
const own = await import('@automerge/automerge');
report.hostAutomerge = own.splice === RepoModule.splice ? 'the Repo copy' : 'its own copy';
report.hostBare = await outcome(import('earcut'));
parentPort.postMessage(report);
`;

let report: any;
beforeAll(async () => {
  const script = join(hostDir, 'thread.mjs');
  writeFileSync(script, THREAD);
  const worker = new Worker(pathToFileURL(script), {
    workerData: { hooks, carried, data, installed, carriedBare, carriedBareBeside, dataBare, later, installedCjs },
  });
  try {
    report = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`the thread ended (code ${code}) before reporting`)));
    });
  } finally {
    await worker.terminate();
  }
}, 30_000);

const plainError = (name: string) => ({ error: { message: unshared(name).message, code: undefined } });

describe("a task's imports in a Node run thread", () => {
  it("gives carried code the Repo's own Automerge and Repo, also through a relative import", () => {
    expect(report.carried).toEqual({
      splice: 'same',
      slimSplice: 'same',
      Repo: 'same',
      repoSplice: 'same',
      slimRepo: 'same',
      besideRepo: 'same',
    });
  });

  it("gives a data: URL the Repo's own Automerge and Repo", () => {
    expect(report.data).toEqual({ splice: 'same', repoSplice: 'same', Repo: 'same' });
  });

  it("gives installed code its own dependencies, but the Repo's Automerge there and in them", () => {
    expect(report.libName).toBe('fake-lib');
    expect(report.installed).toEqual({ splice: 'same', libSplice: 'same' });
  });

  it("appends with each one's splice to a text of a document the thread's Repo made, one change each", () => {
    expect(report.text).toBe('abcdefgh');
    expect(report.changes).toBe(5);
  });

  it("lets carried code import Node's built-in modules by bare name", () => {
    expect(report.builtins).toBe(true);
  });

  it('fails any other bare name in carried code with the error that says what it may import', () => {
    expect(report.carriedBare).toEqual(plainError('earcut'));
    expect(report.carriedBareBeside).toEqual(plainError('earcut'));
    expect(report.dataBare).toEqual(plainError('earcut'));
    expect(unshared('earcut').message).toContain('@automerge/automerge-repo/slim');
  });

  it('holds carried code to the same when it imports while it runs, by import(), require or import.meta.resolve', () => {
    expect(report.later).toEqual({
      importShared: 'same',
      importBare: plainError('earcut'),
      requireRepo: 'same',
      requireBare: plainError('earcut'),
      resolveBare: plainError('earcut'),
    });
  });

  it("gives a CommonJS dependency of installed code the Repo's own ES modules, not Automerge's CommonJS build", () => {
    expect(report.cjs).toEqual({ splice: 'same', slimSplice: 'same', Repo: 'same', slimRepo: 'same' });
  });

  it("leaves the host's own code resolving as Node does", () => {
    expect(report.hostAutomerge).toBe('its own copy');
    expect(report.hostBare.error.code).toBe('ERR_MODULE_NOT_FOUND');
  });
});
