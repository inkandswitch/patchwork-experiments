// @vitest-environment node
//
// A checker's cases of the fixes to the pool's registry (00403150), written
// apart from the builder's:
//
// - `Latest`, which both executors now keep their registry in: a follower is
//   told only what is set after it follows, and nothing once it stops; one
//   that stops while being told does not keep the others from being told;
// - the Node executor with real threads: a thread started after a change has
//   it in its settings, a live one is told each change after its settings,
//   and a thread that has ended is no longer told;
// - `importPackage` (webworker-lib.node.ts) with real documents and a real
//   materialise, only the final import being a plain import() here (the
//   carried-code hooks are task-imports.test.ts's): package.json is read at
//   the heads the url names, not the latest; a Patchwork `folder` package
//   works as a pushwork `directory` one does; only the entry's directory is
//   written; and an entry whose path has a character a URL escapes (a space,
//   or one that is not ASCII) is found.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateAutomergeUrl, initSubduction, Repo, stringifyAutomergeUrl, parseAutomergeUrl } from '@automerge/automerge-repo';
import { Latest } from '../registry-snapshot';
import { NodeExecutor } from './executor';
import type { Job, WorkerEvents } from '../pool';

vi.mock('./task-imports', async (original) => ({
  ...(await original<typeof import('./task-imports')>()),
  importTask: (url: string) => import(/* @vite-ignore */ url),
}));
const { importPackage } = await import('./webworker-lib.node');

await initSubduction();

const dir = mkdtempSync(join(tmpdir(), 'tasks-registry-fix-check-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const filesUnder = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();

describe('Latest', () => {
  it('tells a follower only what is set after it follows, and nothing after it stops', () => {
    const latest = new Latest<number>(0);
    latest.set(1);
    const a: number[] = [];
    const stopA = latest.follow((v) => a.push(v));
    expect(latest.value).toBe(1);
    latest.set(2);
    stopA();
    latest.set(3);
    expect(a).toEqual([2]);
    expect(latest.value).toBe(3);
  });

  it('a follower that stops while it is told does not keep the others from being told', () => {
    const latest = new Latest<string>('');
    const said: string[] = [];
    const stop = latest.follow((v) => {
      said.push(`a ${v}`);
      stop();
    });
    latest.follow((v) => said.push(`b ${v}`));
    latest.set('x');
    latest.set('y');
    expect(said).toEqual(['a x', 'b x', 'b y']);
  });
});

describe("the Node executor's registry, with real threads", () => {
  const standIn = join(dir, 'stand-in.mjs');
  writeFileSync(
    standIn,
    `import { parentPort } from 'node:worker_threads';
parentPort.on('message', (m) => {
  if (m.type === 'settings') parentPort.postMessage({ type: 'log', message: 'settings ' + JSON.stringify(m.settings.plugins) });
  if (m.type === 'plugins') parentPort.postMessage({ type: 'log', message: 'plugins ' + JSON.stringify(m.plugins) });
  if (m.type === 'job' && m.job.importUrl === 'exit') process.exit(0);
});
`,
  );
  const executor = () =>
    new NodeExecutor({
      script: pathToFileURL(standIn),
      settings: {},
      link: () => ({ port: new MessageChannel().port2 as unknown as MessagePort, end() {} }),
    });
  const recorder = () => {
    const said: string[] = [];
    let exited!: () => void;
    const gone = new Promise<void>((resolve) => (exited = resolve));
    const events: WorkerEvents = {
      log: (message) => said.push(message),
      progress: () => {},
      done: () => {},
      threw: () => {},
      exit: () => exited(),
    };
    return { said, gone, events };
  };
  const snap = (n: number) => ({ snapshot: [{ type: 't', id: `p${n}`, importUrl: `automerge:x#${n}` }], packages: { [`automerge:x#${n}`]: `/d/${n}` } });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  const job = (importUrl: string): Job => ({ taskUrl: generateAutomergeUrl() as Job['taskUrl'], runId: 'r', importUrl, input: null, key: 'k' });

  it('a thread started later has the latest in its settings; a live one is told each change after its settings; an ended one is told nothing', async () => {
    const ex = executor();
    ex.plugins.set(snap(1));
    const a = recorder();
    const workerA = ex.start(a.events);
    ex.plugins.set(snap(2));
    await until(() => a.said.length >= 2);
    expect(a.said).toEqual([`settings ${JSON.stringify(snap(1))}`, `plugins ${JSON.stringify(snap(2))}`]);

    workerA.run(job('exit'));
    await a.gone;
    const b = recorder();
    const workerB = ex.start(b.events);
    ex.plugins.set(snap(3));
    await until(() => b.said.length >= 2);
    expect(b.said).toEqual([`settings ${JSON.stringify(snap(2))}`, `plugins ${JSON.stringify(snap(3))}`]);
    expect(a.said).toHaveLength(2);
    workerB.terminate();
    await b.gone;
  });
});

describe('importPackage, with real documents', () => {
  const repo = new Repo({ network: [] } as any);
  const file = (content: string) => repo.create({ content }).url;
  const LIB = `export const plugins = [{ type: 'patchwork:library', id: 'made-up', load: async () => ({ v: 1 }) }];\n`;
  const atHeads = (handle: any) => stringifyAutomergeUrl({ documentId: parseAutomergeUrl(handle.url).documentId, heads: handle.heads() });

  it('reads package.json at the heads the url names, not the latest, and writes only the entry directory', async () => {
    const folder = repo.create<Record<string, string>>({
      'package.json': file('{ "name": "made-up", "type": "module", "exports": "./dist/one.js" }'),
      'dist/one.js': file(LIB.replace('v: 1', 'v: "one"') + 'export const which = "one";\n'),
      'dist/two.js': file('export const which = "two"; export const plugins = [];\n'),
      'src/big.txt': file('x'.repeat(10_000)),
    });
    const before = atHeads(folder);
    folder.change((d) => {
      d['package.json'] = file('{ "name": "made-up", "type": "module", "exports": "./dist/two.js" }');
    });
    const codeDir = join(dir, 'heads');
    const old = await importPackage(repo, before, codeDir);
    expect(old.module.which).toBe('one');
    const now = await importPackage(repo, atHeads(folder), codeDir);
    expect(now.module.which).toBe('two');
    expect(filesUnder(codeDir).every((path) => /\/(dist\/(one|two)\.js|package\.json)$/.test(path))).toBe(true);
  });

  it('reads a Patchwork folder package (a tree of docs lists) as it reads a directory one', async () => {
    const dist = repo.create({ docs: [{ name: 'index.js', type: 'file', url: file(LIB + 'export const shape = "folder";\n') }] });
    const root = repo.create({
      docs: [
        { name: 'package.json', type: 'file', url: file('{ "type": "module", "exports": { ".": "./dist/index.js" } }') },
        { name: 'dist', type: 'folder', url: dist.url },
        { name: 'docs', type: 'folder', url: repo.create({ docs: [{ name: 'a.md', type: 'file', url: file('# a') }] }).url },
      ],
    });
    const codeDir = join(dir, 'folder');
    const { module, entry } = await importPackage(repo, atHeads(root), codeDir);
    expect(module.shape).toBe('folder');
    expect(entry.endsWith('/dist/index.js')).toBe(true);
    expect(filesUnder(codeDir).map((path) => path.split('/').slice(2).join('/'))).toEqual(['dist/index.js', 'package.json']);
  });

  // the path as package.json gives it, not URL-escaped ("dist/my%20entry.js")
  it('imports a package whose entry path has a space, or a character that is not ASCII, in it', async () => {
    for (const name of ['my entry.js', 'ünï.js']) {
      const folder = repo.create({
        'package.json': file(`{ "type": "module", "exports": "./dist/${name}" }`),
        [`dist/${name}`]: file(LIB),
      });
      const { module, entry } = await importPackage(repo, atHeads(folder), join(dir, 'escaped'));
      expect(Array.isArray(module.plugins)).toBe(true);
      expect(entry.endsWith(`dist/${name}`)).toBe(true);
    }
  });
});
