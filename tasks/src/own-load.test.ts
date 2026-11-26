// @vitest-environment node
//
// Own's queue document kept in this browser's storage, but slow to load (a
// cold start): `ownQueue` waits for the read and makes nothing, where a
// document the storage does not have is still answered with a spare at once.
// Every Repo here keeps its documents in a storage adapter of the test's own,
// whose reads take as long as the test says, and has no network. Time is
// vitest's fake clock.

import { initSubduction, Repo, type StorageAdapterInterface } from '@automerge/automerge-repo';
import { Repo as SiteRepo, initSubduction as initSiteSubduction } from 'site-automerge-repo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HERE_MS, OWN_QUEUE_TITLE, QUEUE_DATATYPE_ID, TASKS_STORAGE_ID, markOf, marksOf, ownQueue, sparesOf } from './task-client.js';

await initSubduction();
await initSiteSubduction();

const g = globalThis as any;
afterEach(() => {
  vi.useRealTimers();
  delete g.accountDocHandle;
});

/** What a browser's storage holds, shared by the Repos a test opens on it. */
type Kept = Map<string, Uint8Array>;

/** A storage adapter on `kept` whose reads take `readMs` (Infinity: never answer). */
function storageOn(kept: Kept, readMs: number): StorageAdapterInterface {
  const name = (key: string[]) => key.join('\u0000');
  const read = <T,>(value: () => T) =>
    readMs === Infinity ? new Promise<T>(() => {}) : new Promise<T>((resolve) => setTimeout(() => resolve(value()), readMs));
  return {
    load: (key) => read(() => kept.get(name(key))),
    loadRange: (prefix) =>
      read(() =>
        [...kept.entries()]
          .filter(([key]) => key.startsWith(name(prefix)))
          .map(([key, data]) => ({ key: key.split('\u0000'), data })),
      ),
    save: async (key, data) => void kept.set(name(key), data),
    saveBatch: async (entries) => entries.forEach(([key, data]) => kept.set(name(key), data)),
    remove: async (key) => void kept.delete(name(key)),
    removeRange: async (prefix) => [...kept.keys()].filter((key) => key.startsWith(name(prefix))).forEach((key) => kept.delete(key)),
  };
}

const REPOS = {
  "the task system's Repo": (storage: StorageAdapterInterface) => new Repo({ storage, network: [] } as any),
  "the site's Repo": (storage: StorageAdapterInterface) => new SiteRepo({ storage, network: [] } as any) as unknown as Repo,
} as const;

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

/**
 * A browser that made own in an earlier session (kept in its storage, or not,
 * as `keepOwn` says), opened again on storage each of whose reads takes
 * `readMs` (a document takes a few, one after another). The account and the
 * storage document naming own are made in the new session, so only own's
 * document has to be read. The earlier session runs on the real clock; the
 * new one on the fake clock.
 */
async function reopened(makeRepo: (storage: StorageAdapterInterface) => Repo, readMs: number, keepOwn = true) {
  const kept: Kept = new Map();
  const before = makeRepo(storageOn(kept, 0));
  const own = before.create<any>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} });
  if (keepOwn) {
    await before.flush([own.documentId]);
  }
  await before.shutdown?.();
  if (!keepOwn) {
    kept.clear();
  }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const repo = makeRepo(storageOn(kept, readMs));
  const storage = repo.create<any>({ own: own.url, [markOf(own.url)]: true, [own.url]: true });
  g.accountDocHandle = repo.create<any>({ toolStorage: { [TASKS_STORAGE_ID]: storage.url } });
  return { repo, own, storage };
}

describe("own's document in this browser's storage, slow to load", () => {
  for (const [name, makeRepo] of Object.entries(REPOS)) {
    for (const readMs of [HERE_MS / 2, 3 * HERE_MS, 10 * HERE_MS]) {
      it(`${name}: each read taking ${readMs} ms: ownQueue gives own once it is read, and marks nothing`, async () => {
        const { repo, own, storage } = await reopened(makeRepo, readMs);
        const marks = marksOf(storage.doc());
        const asked = settling(ownQueue(repo));
        const took = await timeUntil(asked.done, 120_000);
        console.log(`${name}, each read ${readMs} ms: own given after ${took} ms`);
        expect(asked.settled.value).toBe(own.url);
        expect(marksOf(storage.doc())).toEqual(marks);
        expect(sparesOf(storage.doc())).toEqual([]);
      });
    }

    it(`${name}: not in this browser's storage: ownQueue gives a spare made here, as soon as the storage says so`, async () => {
      const { repo, own, storage } = await reopened(makeRepo, 0, false);
      const asked = settling(ownQueue(repo));
      const took = await timeUntil(asked.done, 120_000);
      expect(asked.settled.value).not.toBe(own.url);
      expect(sparesOf(storage.doc())).toEqual([asked.settled.value]);
      expect(took).toBeLessThanOrEqual(2 * HERE_MS + 200);
    });

    it(`${name}: storage that never answers: ownQueue still settles, with a spare, rather than wait for ever`, async () => {
      const { repo, own, storage } = await reopened(makeRepo, Infinity);
      const asked = settling(ownQueue(repo));
      const took = await timeUntil(asked.done, 300_000, 1_000);
      expect(took).toBeLessThan(Infinity);
      expect(asked.settled.value).not.toBe(own.url);
      expect(sparesOf(storage.doc())).toEqual([asked.settled.value]);
    });
  }
});
