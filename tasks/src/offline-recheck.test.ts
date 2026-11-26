// @vitest-environment node
//
// A second checker's tests of step 4 after its fix, read with the law:
// nothing a browser can do alone waits on the sync server, and nothing waits
// for ever. Every Repo here has no network at all. Time is vitest's fake
// clock. Beside offline-check.test.ts: the cases here are the ones the fix
// touched (the storage document not here; a spare marked once by several
// copies of the client) and what lies next to them.

import * as A from '@automerge/automerge';
import { initSubduction, parseAutomergeUrl, Repo, stringifyAutomergeUrl, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HERE_MS,
  OWN_QUEUE_TITLE,
  QUEUE_DATATYPE_ID,
  TASKS_STORAGE_ID,
  doWork,
  markOf,
  marksOf,
  ownQueue,
  ownQueueOf,
  sparesOf,
  stopWork,
  watchWork,
  type TaskView,
} from './task-client.js';
import { LAPSE_MS, entryAt, type Queue } from './task-rules.js';

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

const handleOf = <T,>(repo: Repo, url: string) => repo.handles[parseAutomergeUrl(url as AutomergeUrl).documentId] as DocHandle<T> | undefined;

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
  const storage = repo.create<any>({ own: away.url, [markOf(away.url)]: true, [away.url]: true });
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

    it(`${name}: the storage document here, own's document not: the first doWork asks the spare within HERE_MS twice, later ones within HERE_MS, one spare is made for all of them, and nothing is run in the page`, async () => {
      const repo = makeRepo();
      const { storage } = ownElsewhere(repo);
      let called = 0;
      g.__work = () => ++called;
      const listedIn = (key: string) => sparesOf(storage.doc()).some((url) => !!entryAt(handleOf<Queue>(repo, url)?.doc(), key));
      const times: number[] = [];
      for (let i = 1; i <= 3; i++) {
        void doWork(repo, { importUrl: WORK, key: `k${i}` });
        times.push(await timeUntil(() => listedIn(`k${i}`), 300_000));
      }
      expect(times[0]).toBeLessThanOrEqual(2 * HERE_MS + 100);
      for (const t of times.slice(1)) expect(t).toBeLessThanOrEqual(HERE_MS + 100);
      expect(sparesOf(storage.doc())).toHaveLength(1);
      expect(called).toBe(0);
    });
  }
});

describe('several copies of the client on one Repo, own not here', () => {
  it('three copies asking at once: one spare is marked, and all three are given it', async () => {
    // @ts-expect-error second and third instances of the module, as kit copies are
    const two = (await import('./task-client.js?copy=recheck-2')) as typeof import('./task-client.js');
    // @ts-expect-error
    const three = (await import('./task-client.js?copy=recheck-3')) as typeof import('./task-client.js');
    const repo = newRepo();
    const { storage } = ownElsewhere(repo);
    const asks = [ownQueue(repo), two.ownQueue(repo), three.ownQueue(repo)].map(settling);
    await timeUntil(() => asks.every((one) => one.done()), 60_000);
    const answers = asks.map((one) => one.settled.value);
    expect(sparesOf(storage.doc())).toHaveLength(1);
    expect(new Set(answers)).toEqual(new Set(sparesOf(storage.doc())));
    expect(handleOf<Queue>(repo, answers[0]!)?.doc()).toBeDefined();
  });

  it('spares not had here keep arriving from other replicas while a spare is looked for: the look ends, after one round per arrival, with one spare marked by this Repo and had here', async () => {
    const repo = newRepo();
    const { away, storage } = ownElsewhere(repo);
    const elsewhere = newRepo();
    const arrivals = 4;
    let arrived = 0;
    // each time this Repo looks for a document it lacks, another replica's spare arrives meanwhile
    const find = repo.find.bind(repo);
    (repo as any).find = (url: string, ...rest: unknown[]) => {
      if (url !== away.url && !handleOf(repo, url) && arrived < arrivals) {
        arrived++;
        const theirs = elsewhere.create<Queue>({ title: OWN_QUEUE_TITLE, jobs: {} } as any).url;
        storage.change((doc: any) => {
          doc[markOf(theirs)] = true;
          doc[theirs] = true;
        });
      }
      return (find as any)(url, ...rest);
    };
    const asked = settling(ownQueue(repo));
    const took = await timeUntil(asked.done, 60_000);
    expect(asked.settled.error).toBeUndefined();
    const mine = asked.settled.value!;
    expect(handleOf<Queue>(repo, mine)?.doc()).toBeDefined();
    expect(sparesOf(storage.doc())).toContain(mine);
    // own, the arrivals, and the one this Repo marked
    expect(marksOf(storage.doc())).toHaveLength(1 + arrived + 1);
    expect(took).toBeLessThanOrEqual((arrivals + 2) * HERE_MS + 100);
  });
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

describe("own's document arriving after work was asked without it", () => {
  it("once own's document is here, ownQueue gives own, and the spare made before stays marked and served, with the work asked of it", async () => {
    const repo = newRepo();
    const { away, storage } = ownElsewhere(repo);
    void doWork(repo, { importUrl: WORK, key: 'first' });
    await timeUntil(() => sparesOf(storage.doc()).length > 0 && !!entryAt(handleOf<Queue>(repo, sparesOf(storage.doc())[0])?.doc(), 'first'), 60_000);
    const [spare] = sparesOf(storage.doc());
    expect(spare).toBeDefined();
    repo.import(A.save(away.doc() as any), { docId: away.documentId } as any);
    const asked = settling(ownQueue(repo));
    await timeUntil(asked.done, 60_000);
    expect(asked.settled.value).toBe(away.url);
    expect(ownQueueOf(storage.doc())).toBe(away.url);
    expect(sparesOf(storage.doc())).toEqual([spare]);
    expect(storage.doc()[spare]).toBe(true);
  });
});
