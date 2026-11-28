// @vitest-environment node
//
// A checker's cases of the run worker's own library (2c0cbed7), written apart
// from the builder's: `serve` (run-worker.ts, the same code in a browser run
// worker and a Node run thread) makes its registry with the pool's own
// TASKS_LIBRARY and has it agree with the settings' snapshot before a task's
// code is imported, so task code that asks for `tasks-next` gets the pool's
// own build with nothing installed, the installed one when the settings name
// one, and the pool's own again once a later snapshot has it removed.
//
// The realm's registry module is a registry of the test's own here, made to
// agree by the real `mirror`; the Repo is a stand-in with no documents, since
// the code here writes nothing. Every url is made up.

import { describe, expect, it, vi } from 'vitest';
import { encodeHeads, generateAutomergeUrl, parseAutomergeUrl, stringifyAutomergeUrl } from '@automerge/automerge-repo/slim';
import { PluginRegistry } from '@inkandswitch/patchwork-plugins';
import * as client from './client.js';
import { mirror } from './registry-snapshot';
import type { Job } from './pool';
import type { FromRunWorker, ToRunWorker } from './run-worker';

const order: string[] = [];
const registries = new Map<string, PluginRegistry<any>>();
const getRegistry = (type: string) => registries.get(type) ?? registries.set(type, new PluginRegistry()).get(type)!;
let ownGiven: { type: string; id: string }[] | null = null;

/** Task code that asks the realm's registry for the client, as task code does. */
const ASKS = {
  default: async () => {
    order.push('ran');
    const plugin = await getRegistry('patchwork:library').loadWhenReady('tasks-next');
    return plugin.module === client ? 'own' : plugin.module.from;
  },
};

vi.mock('./webworker-lib', () => ({
  setUpImportMap: async () => {},
  getRepo: async () => ({ handles: {}, flush: async () => {}, import: () => {} }),
  pluginMirror: async (own: { type: string; id: string }[]) => {
    ownGiven = own;
    const agree = mirror(getRegistry, async (importUrl) => ({ from: importUrl }), own);
    return ({ snapshot }: { snapshot: any[] }) => {
      order.push(`agreed ${snapshot.length}`);
      agree(snapshot);
    };
  },
  importModule: async (url: string) => {
    order.push(`imported ${url}`);
    return ASKS;
  },
}));

const { serve } = await import('./run-worker');

const job = (n: number): Job => ({
  taskUrl: generateAutomergeUrl() as Job['taskUrl'],
  runId: `run-${n}`,
  importUrl: 'data:text/javascript,asks',
  input: null,
  key: `k${n}`,
});

function start() {
  const said: FromRunWorker[] = [];
  let deliver: (message: ToRunWorker) => void = () => {};
  serve({ post: (message) => said.push(structuredClone(message)), onMessage: (listener) => (deliver = listener) });
  const ending = async () => {
    for (let i = 0; i < 200 && !said.some((m) => m.type === 'done' || m.type === 'threw'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const end = said.find((m) => m.type === 'done' || m.type === 'threw');
    said.length = 0;
    return end;
  };
  return { tell: (message: ToRunWorker) => deliver(message), ending };
}

describe("a run worker's own library", () => {
  it('is registered and agreed before any task code is imported, and is what task code gets with nothing installed; an installed one replaces it and the pool’s own comes back once that is removed', async () => {
    const installed = stringifyAutomergeUrl({ documentId: parseAutomergeUrl(generateAutomergeUrl()).documentId, heads: encodeHeads(['c'.repeat(64)]) });
    const described = { type: 'patchwork:library', id: 'tasks-next', name: 'Tasks client', importUrl: installed };
    const { tell, ending } = start();

    tell({ type: 'settings', settings: { link: new MessageChannel().port1 } });
    tell({ type: 'job', job: job(1), task: null });
    expect(await ending()).toEqual({ type: 'done', result: 'own' });
    expect(order).toEqual(['agreed 0', 'imported data:text/javascript,asks', 'ran']);
    expect(ownGiven?.map(({ type, id }) => `${type} ${id}`)).toEqual(['patchwork:library tasks-next']);

    tell({ type: 'plugins', plugins: { snapshot: [described] } });
    tell({ type: 'job', job: job(2), task: null });
    expect(await ending()).toEqual({ type: 'done', result: installed });

    tell({ type: 'plugins', plugins: { snapshot: [] } });
    tell({ type: 'job', job: job(3), task: null });
    expect(await ending()).toEqual({ type: 'done', result: 'own' });
  });
});
