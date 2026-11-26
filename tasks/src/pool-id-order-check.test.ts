// @vitest-environment node
//
// An independent checker's cases of task-client.js v18: doWork makes this
// browser's pool id only once the queue is had. On real automerge-repo
// documents, with vitest's fake clock. Every url here is made up.

import * as A from '@automerge/automerge';
import { initSubduction, parseAutomergeUrl, Repo, stringifyAutomergeUrl, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OWN_QUEUE_TITLE, POOL_ID_KEY, QUEUE_DATATYPE_ID, TASKS_STORAGE_ID, doWork, markOf, ownQueueOf, sparesOf } from './task-client.js';
import type { Queue } from './task-rules.js';

await initSubduction();

const g = globalThis as any;
afterEach(() => {
  vi.useRealTimers();
  delete g.accountDocHandle;
  delete g.localStorage;
});
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }));

const madeUp = (byte: number) => stringifyAutomergeUrl({ documentId: new Uint8Array(16).fill(byte) } as any) as AutomergeUrl;
const LOCALHOST = 'http://localhost:5173/src/task.js';
const NOT_FOUND = 'The list of your task queues could not be found, so nothing was changed.';
const PAGE_ONLY = 'Task queues can only be kept from a Patchwork page with your account open.';
const NO_POOL_ID = "This work's code is only on this machine (http url), and this browser keeps no id for its pool, so no pool can be asked to run it.";

/** A localStorage that counts writes; with `refuse`, every write throws, as a browser that keeps nothing does, while reads work. */
const storageOf = (items: Record<string, string>, { refuse = false } = {}) => ({
  items,
  writes: 0,
  getItem(key: string) {
    return items[key] ?? null;
  },
  setItem(key: string, value: string) {
    this.writes++;
    if (refuse) throw new Error('QuotaExceededError');
    items[key] = String(value);
  },
});

async function turns(n = 5) {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Every task listed on any queue the storage names. */
function listed(repo: Repo, storage: DocHandle<any> | undefined) {
  const doc = storage?.doc();
  if (!doc) return [];
  const urls = [...new Set([ownQueueOf(doc), ...sparesOf(doc)].filter(Boolean) as string[])];
  return urls.flatMap((url) => Object.keys((repo.handles[parseAutomergeUrl(url as AutomergeUrl).documentId] as any)?.doc()?.jobs ?? {}));
}

describe('the pool id is made only once the queue is had', () => {
  it('code that cannot travel, no pool id yet: every refusal of the queue leaves localStorage unwritten', async () => {
    for (const account of ['none', 'storage not here'] as const) {
      const repo = new Repo({ network: [] } as any);
      const local = storageOf({});
      g.localStorage = local;
      if (account === 'storage not here') g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: madeUp(91) } });
      else delete g.accountDocHandle;
      let error: Error | undefined;
      doWork(repo, { importUrl: LOCALHOST, key: 'k' }).catch((e) => (error = e));
      await vi.advanceTimersByTimeAsync(60_000);
      await turns();
      expect(error?.message, account).toBe(account === 'none' ? PAGE_ONLY : NOT_FOUND);
      expect(local.writes, account).toBe(0);
      expect(local.items[POOL_ID_KEY], account).toBeUndefined();
    }
  });

  it('aborted while the queue is looked for: no pool id is made, even once the list of queues arrives and own is made', async () => {
    const repo = new Repo({ network: [] } as any);
    const away = new Repo({ network: [] } as any);
    const storageAway = away.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storageAway.url } });
    const local = storageOf({});
    g.localStorage = local;
    const controller = new AbortController();
    let error: Error | undefined;
    doWork(repo, { importUrl: LOCALHOST, key: 'k' }, { signal: controller.signal }).catch((e) => (error = e));
    await vi.advanceTimersByTimeAsync(2_000);
    controller.abort();
    await turns();
    expect(error?.message).toBe('The task was cancelled');
    const storage = repo.import<any>(A.save(storageAway.doc()), { docId: storageAway.documentId } as any);
    await vi.advanceTimersByTimeAsync(40_000);
    await turns();
    expect(local.writes).toBe(0);
    expect(listed(repo, storage)).toEqual([]);
  });

  it('a localStorage that reads but refuses writes, own already here: refused for the pool id, nothing listed', async () => {
    const repo = new Repo({ network: [] } as any);
    const storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } });
    const own = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
    storage.change((doc: any) => {
      doc.own = own.url;
      doc[markOf(own.url)] = true;
      doc[own.url] = true;
    });
    const local = storageOf({}, { refuse: true });
    g.localStorage = local;
    let error: Error | undefined;
    doWork(repo, { importUrl: LOCALHOST, key: 'k' }).catch((e) => (error = e));
    await vi.advanceTimersByTimeAsync(5_000);
    await turns();
    expect(error?.message).toBe(NO_POOL_ID);
    expect(local.writes).toBe(1);
    expect(listed(repo, storage)).toEqual([]);
  });

  it('own here, no pool id yet: made once, and the task asked under it', async () => {
    const repo = new Repo({ network: [] } as any);
    const storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } });
    const own = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
    storage.change((doc: any) => {
      doc.own = own.url;
      doc[markOf(own.url)] = true;
      doc[own.url] = true;
    });
    const local = storageOf({});
    g.localStorage = local;
    doWork(repo, { importUrl: LOCALHOST, key: 'k1' }).catch(() => {});
    doWork(repo, { importUrl: LOCALHOST, key: 'k2' }).catch(() => {});
    await vi.advanceTimersByTimeAsync(3_000);
    await turns();
    expect(local.writes).toBe(1);
    const id = local.items[POOL_ID_KEY];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const jobs = own.doc()!.jobs as any;
    expect(Object.keys(jobs).sort()).toEqual(['k1', 'k2']);
    for (const key of ['k1', 'k2']) expect(jobs[key]).toMatchObject({ needs: [`pool:${id}`], near: id });
  });
});
