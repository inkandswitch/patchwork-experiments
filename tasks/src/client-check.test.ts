// @vitest-environment node
//
// A checker's cases of the task client as a library (2c0cbed7), written apart
// from the builder's client.test.ts:
//
// - what the library gives is exactly the union of what task-client.js,
//   task-rules.js and task-runs.js export, the union read from their source
//   text, not from importing them; the one name two of them give is one value;
// - `mirror` with the pool's own library: a lookup made before the first
//   snapshot resolves to the pool's own once it comes; later snapshots that
//   change other plugins leave it registered once; an installed one updated
//   to new heads replaces the earlier installed one with nothing of the
//   pool's own between; the same id under another type does not stand in for
//   it; a loaded own is not registered again;
// - a Node run thread's registry (pluginMirror in node/webworker-lib.node.ts)
//   with a package on disk that registers `tasks-next`: the installed one's
//   module, then the pool's own once it is gone.
//
// Every url is made up here.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { getRegistry as threadRegistry, PluginRegistry } from '@inkandswitch/patchwork-plugins';
import * as client from './client.js';
import * as asking from './task-client.js';
import * as runs from './task-runs.js';
import { POOL_COMPONENT_ID, QUEUE_DATATYPE_ID, TASKS_LIBRARY, TASKS_STORAGE_ID } from './ids';
import { mirror, type Description } from './registry-snapshot';

vi.mock('./node/task-imports', async (original) => ({
  ...(await original<typeof import('./node/task-imports')>()),
  importTask: (url: string) => import(/* @vite-ignore */ url),
}));
const { pluginMirror } = await import('./node/webworker-lib.node');

const FILES = ['task-client.js', 'task-rules.js', 'task-runs.js'];

/** The names a file exports, read from its text: declarations and `export { … }` lists. */
function exportedBy(file: string): string[] {
  const text = readFileSync(join(__dirname, file), 'utf8');
  const names: string[] = [];
  for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(match[1]);
  }
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',').map((p) => p.trim()).filter(Boolean)) {
      names.push(part.split(/\s+as\s+/).at(-1)!);
    }
  }
  expect(text).not.toMatch(/^export\s+\*/m); // nothing passed on wholesale, so the list above is all
  return names;
}

const PACKAGE = parseAutomergeUrl(generateAutomergeUrl()).documentId;
/** A made-up package, at heads `n`. */
const urlAt = (n: number) => stringifyAutomergeUrl({ documentId: PACKAGE, heads: encodeHeads([n.toString(16).padStart(64, '0')]) });

describe('what the library gives', () => {
  it('is exactly the union of what the three files export, read from their source', async () => {
    const union = new Set(FILES.flatMap(exportedBy));
    const given = await TASKS_LIBRARY.load();
    expect(Object.keys(given).sort()).toEqual([...union].sort());
    expect(given).toBe(client);
  });

  it('gives one value for the one name two files export, and no other name is exported twice', () => {
    const seen = new Map<string, string[]>();
    for (const file of FILES) {
      for (const name of exportedBy(file)) {
        seen.set(name, [...(seen.get(name) ?? []), file]);
      }
    }
    const twice = [...seen].filter(([, files]) => files.length > 1);
    expect(twice).toEqual([['findWhenThere', ['task-client.js', 'task-runs.js']]]);
    expect(client.findWhenThere).toBe(asking.findWhenThere);
    expect(runs.findWhenThere).toBe(asking.findWhenThere);
  });

  it("the ids the package's own plugins use are the library's", () => {
    expect([POOL_COMPONENT_ID, QUEUE_DATATYPE_ID, TASKS_STORAGE_ID]).toEqual([client.POOL_COMPONENT_ID, client.QUEUE_DATATYPE_ID, client.TASKS_STORAGE_ID]);
  });
});

describe("a pool's registry, with its own library", () => {
  /** A realm's registries, and every registration of `tasks-next`, in order, by where it came from. */
  function realm() {
    const registries = new Map<string, PluginRegistry<any>>();
    const getRegistry = (type: string) => registries.get(type) ?? registries.set(type, new PluginRegistry()).get(type)!;
    const registered: string[] = [];
    // 'registered' is the registry's own event, not in its typings
    (getRegistry('patchwork:library') as any).on('registered', (plugin: any) => plugin.id === 'tasks-next' && registered.push(plugin.importUrl ?? 'own'));
    const agree = mirror(getRegistry, async (importUrl) => ({ from: importUrl }), [TASKS_LIBRARY]);
    const lookup = async () => {
      const plugin = await getRegistry('patchwork:library').loadWhenReady('tasks-next');
      return plugin.module === client ? 'own' : plugin.module.from;
    };
    return { getRegistry, registered, agree, lookup };
  }
  const library = (importUrl: string): Description => ({ type: 'patchwork:library', id: 'tasks-next', name: 'Tasks client', importUrl });
  const other = (id: string, importUrl: string): Description => ({ type: 'patchwork:tool', id, name: id, importUrl });

  it('a lookup made before the first snapshot resolves to the pool’s own when it comes', async () => {
    const { agree, lookup } = realm();
    const asked = lookup();
    let settled = false;
    void asked.then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    agree([]);
    expect(await asked).toBe('own');
  });

  it('snapshots that change only other plugins leave the pool’s own registered once, and loaded', async () => {
    const { agree, lookup, registered, getRegistry } = realm();
    agree([]);
    expect(await lookup()).toBe('own');
    agree([other('a', urlAt(1))]);
    agree([other('a', urlAt(2)), other('b', urlAt(3))]);
    agree([]);
    expect(registered).toEqual(['own']);
    expect(getRegistry('patchwork:library').get('tasks-next')?.module).toBe(client);
  });

  it('an installed one updated to new heads replaces the earlier installed one, with nothing of the pool’s own between', async () => {
    const { agree, lookup, registered } = realm();
    const [one, two] = [urlAt(1), urlAt(2)];
    agree([library(one)]);
    expect(await lookup()).toBe(one);
    agree([library(two)]);
    expect(await lookup()).toBe(two);
    agree([library(two), other('x', urlAt(4))]);
    agree([other('x', urlAt(4))]);
    expect(await lookup()).toBe('own');
    expect(registered).toEqual([one, two, 'own']);
  });

  it('the same id under another type does not stand in for the library', async () => {
    const { agree, lookup } = realm();
    agree([other('tasks-next', urlAt(5))]);
    expect(await lookup()).toBe('own');
  });
});

describe("a Node run thread's registry, with a package on disk that registers tasks-next", () => {
  const dir = mkdtempSync(join(tmpdir(), 'tasks-client-check-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('gives the installed one while it is installed, and the pool’s own before and after', async () => {
    const installed = urlAt(7);
    mkdirSync(join(dir, 'dist'), { recursive: true });
    const entry = join(dir, 'dist', 'index.js');
    writeFileSync(entry, `export const plugins = [{ type: 'patchwork:library', id: 'tasks-next', name: 'Tasks client', load: async () => ({ from: 'disk' }) }];\n`);
    const agree = await pluginMirror([TASKS_LIBRARY]);
    const lookup = async () => (await threadRegistry('patchwork:library').loadWhenReady('tasks-next')).module;

    agree({ snapshot: [] });
    expect(await lookup()).toBe(client);

    agree({ snapshot: [{ type: 'patchwork:library', id: 'tasks-next', name: 'Tasks client', importUrl: installed }], packages: { [installed]: entry } });
    expect(await lookup()).toEqual({ from: 'disk' });
    expect(threadRegistry('patchwork:library').get('tasks-next')?.importUrl).toBe(installed);

    agree({ snapshot: [] });
    expect(await lookup()).toBe(client);
  });
});
