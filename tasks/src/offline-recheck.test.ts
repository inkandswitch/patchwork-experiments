// @vitest-environment node
//
// A second checker's tests of step 4 after its fix, read with the law:
// nothing a browser can do alone waits on the sync server, and nothing waits
// for ever. Every Repo here has no network at all. Time is vitest's fake
// clock. Beside offline-check.test.ts: the cases here are the ones the fix
// touched (the storage document not here; own's document not here) and what
// lies next to them.

import * as A from '@automerge/automerge';
import { initSubduction, Repo, stringifyAutomergeUrl, type AutomergeUrl } from '@automerge/automerge-repo';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HERE_MS,
  OWN_QUEUE_TITLE,
  QUEUE_DATATYPE_ID,
  TASKS_STORAGE_ID,
  doWork,
  stopWork,
  watchWork,
  type TaskView,
} from './task-client.js';
import { LAPSE_MS, type Queue } from './task-rules.js';

await initSubduction();
await initSiteSubduction();

const g = globalThis as any;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  delete g.accountDocHandle;
  delete g.document;
  delete g.__work;
});

const REPOS = {
  "the task system's Repo": () => new Repo({ network: [] } as any),
  "the site's Repo": () => new SiteRepo({ network: [] } as any) as unknown as Repo,
} as const;
const newRepo = REPOS["the task system's Repo"];

const WORK = 'data:text/javascript,export default function (input, ctx) { return globalThis.__work(input, ctx); }';

/** A made-up document url, from fixed bytes. */
const madeUp = (byte: number) => stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(byte) } as any) as AutomergeUrl;

/** Fake time, in steps of `step`, until `done` or `limit` ms have passed; the time it took (Infinity if never). */
async function timeUntil(done: () => boolean, limit: number, step = 100) {
  const started = Date.now();
  while (!done() && Date.now() - started < limit) {
    await vi.advanceTimersByTimeAsync(step);
    for (let i = 0; i < 5 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
  }
  return done() ? Date.now() - started : Infinity;
}

function settling<T>(promise: Promise<T>) {
  const settled: { value?: T; error?: Error } = {};
  promise.then(
    (value) => (settled.value = value),
    (error) => (settled.error = error),
  );
  return { settled, done: () => 'value' in settled || 'error' in settled };
}

/** A storage document in `repo` naming as own a queue made in a Repo that never met this one. */
function ownElsewhere(repo: Repo) {
  const away = newRepo().create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
  const storage = repo.create<any>({ own: away.url, [away.url]: true });
  g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } });
  return { away, storage };
}

describe('doWork with no network, on either Repo', () => {
  for (const [name, makeRepo] of Object.entries(REPOS)) {
    it(`${name}: the account names a storage document not here: doWork rejects with ownQueue's sentence once it gives up, and nothing is run, written or appended`, async () => {
      const repo = makeRepo();
      const account = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(11) } });
      g.accountDocHandle = account;
      const appended: unknown[] = [];
      g.document = { body: { append: (view: unknown) => appended.push(view) }, querySelector: () => null, createElement: () => ({ setAttribute() {}, style: {} }) };
      let called = 0;
      g.__work = () => ++called;
      const heads = A.getHeads(account.doc() as any);
      const work = settling(doWork(repo, { importUrl: WORK, key: 'k' }));
      const took = await timeUntil(work.done, 600_000, 500);
      expect(took).toBeLessThan(Infinity);
      expect(work.settled.error?.message).toBe('The list of your task queues could not be found, so nothing was changed.');
      expect(called).toBe(0);
      expect(appended).toEqual([]);
      expect(A.getHeads(account.doc() as any)).toEqual(heads);
    });

    it(`${name}: the storage document here, own's document not: doWork waits for it, makes no queue of its own, writes nothing, and rejects once it gives up`, async () => {
      const repo = makeRepo();
      const { storage } = ownElsewhere(repo);
      let called = 0;
      g.__work = () => ++called;
      const heads = A.getHeads(storage.doc());
      const work = settling(doWork(repo, { importUrl: WORK, key: 'k' }));
      const took = await timeUntil(work.done, 600_000, 500);
      expect(took).toBeLessThan(Infinity);
      expect(work.settled.error).toBeDefined();
      expect(called).toBe(0);
      expect(A.getHeads(storage.doc())).toEqual(heads);
      expect(Object.values(repo.handles).filter((handle) => (handle.doc() as any)?.title === OWN_QUEUE_TITLE)).toEqual([]);
    });
  }
});

describe('nothing waits for ever, with the storage document not here', () => {
  it('work that needs a node: doWork settles, rejecting with ownQueue\'s sentence (it waits on the storage document as ownQueue does)', async () => {
    const repo = newRepo();
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(12) } });
    const work = settling(doWork(repo, { importUrl: WORK, key: 'n', needs: ['node'] }));
    const took = await timeUntil(work.done, 600_000, 500);
    console.log(`work needing a node, storage document not here: settled after ${took} ms`);
    expect(took).toBeLessThan(Infinity);
    expect(work.settled.error?.message).toBe('The list of your task queues could not be found, so nothing was changed.');
  });

  it('aborted while it waits on that document: rejects at once with "The task was cancelled", having written nothing', async () => {
    const repo = newRepo();
    const account = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(13) } });
    g.accountDocHandle = account;
    const heads = A.getHeads(account.doc() as any);
    const stop = new AbortController();
    const work = settling(doWork(repo, { importUrl: WORK, key: 'n', needs: ['node'] }, { signal: stop.signal }));
    await timeUntil(() => false, 2_000);
    expect(work.done()).toBe(false);
    stop.abort();
    expect(await timeUntil(work.done, 1_000)).toBeLessThanOrEqual(100);
    expect(work.settled.error?.message).toBe('The task was cancelled');
    // nothing made: no document with anything in it but the account (a Repo keeps an empty handle for a url it could not find)
    expect(Object.values(repo.handles).filter((handle) => Object.keys((handle.doc() as any) ?? {}).length > 0).map((handle) => handle.url)).toEqual([account.url]);
    expect(A.getHeads(account.doc() as any)).toEqual(heads);
  });

  it('stopWork is false within HERE_MS; watchWork says missing within LAPSE_MS', async () => {
    const repo = newRepo();
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(14) } });
    const stopped = settling(stopWork(repo, 'k'));
    expect(await timeUntil(stopped.done, 60_000)).toBeLessThanOrEqual(HERE_MS + 100);
    expect(stopped.settled.value).toBe(false);
    const views: TaskView[] = [];
    const unwatch = watchWork(repo, 'k', (view) => views.push(view));
    expect(await timeUntil(() => views.length > 0, 60_000)).toBeLessThanOrEqual(LAPSE_MS + 100);
    expect(views.map((view) => view.state)).toEqual(['missing']);
    unwatch();
  });
});
