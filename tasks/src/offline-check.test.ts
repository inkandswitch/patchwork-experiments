// @vitest-environment node
//
// A checker's tests of step 4 (own, asking is joining), read with
// the law: nothing a browser can do alone waits on the sync server. Every
// Repo here has no network at all; replicas meet only when a test merges
// their documents by hand. Time is vitest's fake clock.

import * as A from '@automerge/automerge';
import { initSubduction, parseAutomergeUrl, Repo, stringifyAutomergeUrl, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TASKS_STORAGE_ID,
  ask,
  doWork,
  ownQueue,
  ownQueueOf,
  servedOf,
  stopWork,
  storageUrlOf,
  watchWork,
  type TaskView,
} from './task-client.js';
import { claimRun, endRun, entryAt, type Queue, type Task } from './task-rules.js';

await initSubduction();

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

const newRepo = () => new Repo({ network: [] } as any);
const CODE = 'data:text/javascript,export default () => 1';
const WORK = 'data:text/javascript,export default function (input, ctx) { return globalThis.__work(input, ctx); }';

/** A made-up document url, from fixed bytes. */
const madeUp = (byte: number) => stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(byte) } as any) as AutomergeUrl;

async function outcome<T>(promise: Promise<T>, advanceMs = 0): Promise<{ value?: T; error?: Error }> {
  let result: { value?: T; error?: Error } | undefined;
  promise.then(
    (value) => (result = { value }),
    (error) => (result = { error }),
  );
  if (advanceMs) await vi.advanceTimersByTimeAsync(advanceMs);
  for (let i = 0; i < 200 && !result; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!result) throw new Error('it never settled');
  return result;
}

/** Fake time, in steps of `step`, until `done` or `limit` ms have passed; the time it took. */
async function timeUntil(done: () => boolean, limit: number, step = 100) {
  const started = Date.now();
  while (!done() && Date.now() - started < limit) {
    await vi.advanceTimersByTimeAsync(step);
    for (let i = 0; i < 5 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
  }
  return done() ? Date.now() - started : Infinity;
}

function replicate<T>(repo: Repo, handle: DocHandle<T>): DocHandle<T> {
  return repo.import<T>(A.save(handle.doc() as A.Doc<T>), { docId: handle.documentId } as any);
}

function asActor(handle: DocHandle<any>, actor: string) {
  handle.update((doc) => A.clone(doc, actor as A.ActorId));
}

const ACTORS = ['aa'.repeat(16), 'bb'.repeat(16), 'cc'.repeat(16)] as const;
function permutations<T>(items: readonly T[]): T[][] {
  return items.length <= 1 ? [[...items]] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

const handleOf = <T,>(repo: Repo, url: string) => repo.handles[parseAutomergeUrl(url as AutomergeUrl).documentId] as DocHandle<T> | undefined;

/** Every document any of `repos` has, in every one of them, merged both ways: the Repos have met. */
function sync(repos: Repo[]) {
  const ids = new Set(repos.flatMap((repo) => Object.values(repo.handles).filter((handle) => handle.isReady()).map((handle) => handle.documentId)));
  for (const id of ids) {
    const handles = repos.map((repo) => repo.handles[id] as DocHandle<any> | undefined);
    const source = handles.find((handle) => handle?.isReady())!;
    const all = repos.map((repo, i) => (handles[i]?.isReady() ? handles[i]! : replicate(repo, source)));
    for (const to of all) for (const from of all) if (to !== from) to.merge(from);
  }
}

describe('doWork with no network, the list of queues not here', () => {
  it("the account names a storage document this Repo does not have (it arrived on the account from another device, then the network went): no queue can be had, so doWork rejects once ownQueue gives up, with its sentence, and nothing is run", async () => {
    const repo = newRepo();
    const account = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(7) } });
    g.accountDocHandle = account;
    let called = 0;
    g.__work = () => ++called;
    const settled: { value?: unknown; error?: Error } = {};
    doWork(repo, { importUrl: WORK, key: 'k' }).then(
      (value) => (settled.value = value),
      (error) => (settled.error = error),
    );
    const took = await timeUntil(() => 'value' in settled || 'error' in settled, 300_000);
    expect(took).toBeLessThan(Infinity);
    expect(settled.error?.message).toBe('The list of your task queues could not be found, so nothing was changed.');
    expect(called).toBe(0);
  });
});

/** A tool-storage provider for one replica, as the frame's: the account's link, or a new storage document it links in (making `toolStorage` when its copy has none). */
function provider(target: EventTarget, repo: Repo, account: DocHandle<any>) {
  target.addEventListener('patchwork:subscribe', (event) => {
    const { selector, port } = (event as CustomEvent).detail;
    if (selector?.type !== 'patchwork:tool-storage') return;
    event.stopPropagation();
    void Promise.resolve().then(() => {
      let url = account.doc().toolStorage?.[selector.toolId];
      if (!url) {
        url = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } }).url;
        account.change((doc) => {
          if (!doc.toolStorage) doc.toolStorage = {};
          doc.toolStorage[selector.toolId] = url;
        });
      }
      port.postMessage({ type: 'change', value: url });
    });
  });
}

/**
 * `n` devices of one person that parted with the account as `base` and never
 * met since: each has a Repo with a replica of the account under an actor of
 * the test's choosing, and its frame's provider. With `shareStorage`, the
 * storage document existed before they parted (replicated, with no own);
 * otherwise each device's provider makes one of its own.
 */
function devices(actors: readonly string[], { shareStorage }: { shareStorage: boolean }) {
  const repos = actors.map(() => newRepo());
  const first = repos[0].create<any>(shareStorage ? {} : { toolStorage: {} });
  if (shareStorage) {
    const storage = repos[0].create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    first.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
    const storages = repos.map((repo, i) => (i === 0 ? storage : replicate(repo, storage)));
    storages.forEach((handle, i) => asActor(handle, actors[i]));
  }
  const accounts = repos.map((repo, i) => (i === 0 ? first : replicate(repo, first)));
  accounts.forEach((handle, i) => asActor(handle, actors[i]));
  const elements = repos.map((repo, i) => {
    const element = new EventTarget();
    provider(element, repo, accounts[i]);
    return element;
  });
  /** Acts as device `i`: its account is the page's. */
  const on = (i: number) => {
    g.accountDocHandle = accounts[i];
    return { repo: repos[i], account: accounts[i], element: elements[i] };
  };
  /** Device `i`'s handle on the storage document its account names now. */
  const storageOn = (i: number) => handleOf<any>(repos[i], storageUrlOf(accounts[i].doc())!)!;
  return { repos, accounts, elements, on, storageOn };
}

type Asked = { key: string; taskUrl: string; device: number; ended: boolean };

/** Device `i`, alone: gets own at once, has a tool's work asked of own by doWork (then stopped), asks two tasks of own (its own key and a shared one), and its pool runs a third to its end. */
async function alone(d: ReturnType<typeof devices>, i: number, asked: Asked[]) {
  const { repo, element } = d.on(i);
  const started = Date.now();
  const own = (await outcome(ownQueue(repo, element))).value!;
  expect(Date.now(), 'own is had with the clock still').toBe(started);
  expect(ownQueueOf(d.storageOn(i).doc())).toBe(own);
  // a tool's work, with no pool heard: asked of own at once, never called in the page; then stopped from the page
  let called = 0;
  g.__work = () => ++called;
  const stop = new AbortController();
  const did = doWork(repo, { importUrl: WORK, key: `page${i}` }, { signal: stop.signal });
  const ownHandle = handleOf<Queue>(repo, own)!;
  expect(await timeUntil(() => !!entryAt(ownHandle.doc(), `page${i}`), 60_000), 'asked of own at once').toBeLessThanOrEqual(100);
  const work = entryAt(ownHandle.doc(), `page${i}`)!;
  stop.abort();
  expect((await outcome(did)).error?.message).toBe('The task was cancelled');
  expect(called).toBe(0);
  asked.push({ key: `page${i}`, taskUrl: work.taskUrl, device: i, ended: true });
  for (const key of [`k${i}`, 'shared']) {
    const got = (await outcome(ask(repo, own, { importUrl: CODE, key, input: i }))).value!;
    asked.push({ ...got, device: i, ended: false });
  }
  // this device's pool takes its shared task while apart; it cannot hear the others'
  const shared = handleOf<Task>(repo, asked.at(-1)!.taskUrl)!;
  shared.change((doc) => claimRun(doc, { id: `run-${i}`, pool: `pool-${i}`, start: Date.now() }));
  // and runs one to its end, alone
  const solo = (await outcome(ask(repo, own, { importUrl: CODE, key: `solo${i}` }))).value!;
  const task = handleOf<Task>(repo, solo.taskUrl)!;
  task.change((doc) => claimRun(doc, { id: `solo-run-${i}`, pool: `pool-${i}`, start: Date.now() }));
  task.change((doc) => endRun(doc, `solo-run-${i}`, { status: 'succeeded', end: Date.now(), result: i }));
  asked.push({ ...solo, device: i, ended: true });
  return own;
}

describe('devices that never met, each with no network, then meeting in every order (one storage document made before they parted)', () => {
  for (const n of [2, 3]) {
    it(`${n} devices: each makes own at once, a tool's work asked of it and stopped, and a task run alone; met, they agree on own, every queue made stays served, and asked again each gives own and makes nothing`, async () => {
      const owns = new Set<number>();
      for (const actors of permutations(ACTORS.slice(0, n))) {
        const d = devices(actors, { shareStorage: true });
        const asked: Asked[] = [];
        const made: string[] = [];
        for (let i = 0; i < n; i++) made.push(await alone(d, i, asked));
        expect(new Set(made).size).toBe(n);
        sync(d.repos);
        const storages = d.repos.map((_, i) => d.storageOn(i));
        const own = ownQueueOf(storages[0].doc())!;
        expect(made).toContain(own);
        for (const storage of storages) {
          expect(ownQueueOf(storage.doc())).toBe(own);
          for (const url of made) expect(servedOf(storage.doc())[url], `${url} served`).toBe(true);
        }
        owns.add(made.indexOf(own));
        // asked again, each device's ownQueue gives own and makes nothing
        for (let i = 0; i < n; i++) {
          const { repo, element } = d.on(i);
          const handles = Object.keys(repo.handles).length;
          expect((await outcome(ownQueue(repo, element))).value).toBe(own);
          expect(Object.keys(repo.handles).length).toBe(handles);
        }
        await vi.advanceTimersByTimeAsync(0);
      }
      expect([...owns].sort()).toEqual([...Array(n).keys()]);
    }, 120_000);
  }
});

describe('two tools asking at once', () => {
  it('two copies of the client (two builds of the package) asking at once on a page with no own yet: one pointer, both asked of it, and one pool view appended', async () => {
    // @ts-expect-error a second instance of the module, as another build of the package is
    const other = (await import('./task-client.js?copy=3')) as typeof import('./task-client.js');
    const appended: any[] = [];
    const views: any[] = [];
    const providerElement = new EventTarget() as any;
    providerElement.append = (view: unknown) => appended.push(view);
    g.document = {
      body: { append: () => appended.push('body') },
      querySelector: (selector: string) =>
        selector === 'patchwork-view[component="task-pool-next"]' ? (views.find((view) => view.connected) ?? null) : selector.includes('patchwork-tool-storage-provider') ? providerElement : null,
      createElement: (tag: string) => {
        const view = { tag, attributes: {} as Record<string, string>, style: {} as Record<string, string>, connected: true, setAttribute(name: string, value: string) { this.attributes[name] = value; } };
        views.push(view);
        return view;
      },
    };
    const repo = newRepo();
    const account = repo.create<any>({});
    g.accountDocHandle = account;
    provider(providerElement, repo, account);
    let called = 0;
    g.__work = () => ++called;
    void doWork(repo, { importUrl: WORK, key: 'one' });
    void other.doWork(repo, { importUrl: WORK, key: 'two' });
    const ownJobs = () => {
      const storageUrl = storageUrlOf(account.doc());
      const own = storageUrl ? ownQueueOf(handleOf<any>(repo, storageUrl)?.doc()) : null;
      return (own ? handleOf<Queue>(repo, own)?.doc()?.jobs : undefined) ?? {};
    };
    await timeUntil(() => 'one' in ownJobs() && 'two' in ownJobs(), 60_000);
    expect(Object.keys(ownJobs()).sort()).toEqual(['one', 'two']);
    expect(called).toBe(0);
    expect(appended).toHaveLength(1);
    const storage = handleOf<any>(repo, storageUrlOf(account.doc())!)!;
    expect(A.getConflicts(storage.doc(), 'own')).toBeUndefined();
  });

});

describe('a page with no tool-storage provider', () => {
  it('an account that names no storage, in a page with no provider: doWork rejects at once with the sentence that says so, whatever the work needs, and nothing is run, written or appended; watchWork says missing at once; stopWork is false', async () => {
    const repo = newRepo();
    const account = repo.create<any>({});
    g.accountDocHandle = account;
    const appended: unknown[] = [];
    g.document = { body: { append: (view: unknown) => appended.push(view) }, querySelector: () => null, createElement: () => ({ setAttribute() {}, style: {} }) };
    const heads = A.getHeads(account.doc());
    let called = 0;
    g.__work = () => ++called;
    for (const needs of [undefined, ['node']]) {
      const settled: { error?: Error } = {};
      void doWork(repo, { importUrl: WORK, key: 'k', needs }).catch((error) => (settled.error = error));
      expect(await timeUntil(() => 'error' in settled, 60_000)).toBeLessThanOrEqual(100);
      expect(settled.error?.message).toBe('This page has nowhere to keep your task queues, so nothing was changed.');
    }
    expect(called).toBe(0);
    expect(appended).toEqual([]);
    expect(A.getHeads(account.doc())).toEqual(heads);
    const views: TaskView[] = [];
    const stop = watchWork(repo, 'k', (view) => views.push(view));
    await outcome(Promise.resolve());
    expect(views.map((view) => view.state)).toEqual(['missing']);
    stop();
    expect((await outcome(stopWork(repo, 'k'))).value).toBe(false);
  });
});
