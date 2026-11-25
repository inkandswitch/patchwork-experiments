// @vitest-environment node
//
// The asker's side, task-client.js, on real automerge-repo documents. Where
// two askers or an asker and a pool act at once, each has a Repo of its own
// and the documents are merged by hand, in the order a test names. Time is
// vitest's fake clock, so a lapse passes when a test says. A pool's word on a
// task's or a queue's channel is delivered as the sync server would deliver
// it, as an `ephemeral-message` on the handle.

import * as A from '@automerge/automerge';
import { generateAutomergeUrl, initSubduction, Repo, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  LOCAL_MESSAGES_CHANNEL,
  OWN_QUEUE_TITLE,
  POOL_ID_KEY,
  PROVIDER_WAIT_MS,
  QUEUE_DATATYPE_ID,
  TASKS_STORAGE_ID,
  ask,
  cancel,
  doWork,
  findWhenThere,
  inSamePackage,
  listen,
  ownQueue,
  ownQueueOf,
  packageOf,
  parseAutomergeImport,
  run,
  send,
  served,
  servedOf,
  stamper,
  stopWork,
  storageUrlOf,
  tasksStorage,
  watch,
  watchWork,
  type Serving,
  type TaskView,
} from './task-client.js';
import { getAcceptance, getTaskQueues, isOnTaskQueue, joinTaskQueue, leaveTaskQueue, setAcceptance } from './helpers';
import { BEAT_MS, LAPSE_MS, LOST_TOO_OFTEN, MAX_LOG_LINES, claimRun, delistTask, endRun, listTask, type Queue, type RunStatus, type Task } from './task-rules.js';

await initSubduction();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

// The harness

/** Lets promises, and the Repo's own work, run, without moving the clock. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

/** Lets a message on a BroadcastChannel arrive: it comes on the real event loop. */
async function delivered(until: () => boolean) {
  for (let i = 0; i < 50 && !until(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const CODE = 'data:text/javascript,export default () => 1';
const PKG = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P';
const HEADS = '2iYYnqERhPWhH9VN5HunnB5bzATxTBYAWDBdnS4CjKpbjmjVXU';
const codeIn = (pkg: string) => `https://site.example/${encodeURIComponent(pkg)}/dist/task.js`;

const newRepo = () => new Repo({ network: [] } as any);

function world() {
  const repo = newRepo();
  const queue = repo.create<Queue>({ title: 'q', jobs: {} });
  return { repo, queue };
}

/** The same documents in another Repo: another machine that has synced them once. */
function replicate<T>(repo: Repo, handle: DocHandle<T>): DocHandle<T> {
  return repo.import<T>(A.save(handle.doc() as A.Doc<T>), { docId: handle.documentId } as any);
}

/** Actor ids a test names, so that which of two conflicting writes Automerge keeps is the test's choice. */
const ACTORS = ['aa'.repeat(16), 'bb'.repeat(16), 'cc'.repeat(16)] as const;
const ACTOR_ORDERS = [
  [ACTORS[0], ACTORS[1]],
  [ACTORS[1], ACTORS[0]],
] as const;

/** Every order of `items`. */
function permutations<T>(items: readonly T[]): T[][] {
  return items.length <= 1 ? [[...items]] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** Makes a handle's further changes under `actor`. */
function asActor(handle: DocHandle<any>, actor: string) {
  handle.update((doc) => A.clone(doc, actor as A.ActorId));
}

/** What a pool writes. */
const take = (task: DocHandle<Task>, id: string, pool = 'P') =>
  task.change((doc) => claimRun(doc, { id, pool, start: Date.now() }));
const complete = (task: DocHandle<Task>, id: string, status: RunStatus, more: { result?: unknown; logs?: { timestampMillis: number; message: string }[] } = {}) =>
  task.change((doc) => endRun(doc, id, { status, end: Date.now(), ...more }));

let seq = 0;
/** A pool's word that a run is going on, as the sync server delivers it. */
const beat = (task: DocHandle<any>, run: string, more: Record<string, unknown> = {}) =>
  task.emit('ephemeral-message', {
    handle: task,
    senderId: 'pool' as any,
    message: { type: 'task progress', run, from: 'a pool', seq: seq++, ...more },
  });
const line = (message: string) => ({ timestampMillis: 0, message });

/** A watcher that keeps every view it is given. */
function follow(repo: Repo, queueUrl: AutomergeUrl, key: string, options?: { keep?: boolean; from?: string }) {
  const views: TaskView[] = [];
  const stop = watch(repo, queueUrl, key, (view) => views.push(view), options);
  return {
    views,
    stop,
    get last() {
      return views.at(-1)!;
    },
    states: () => views.map((view) => view.state),
  };
}

const entryOf = (queue: DocHandle<Queue>, key: string) => queue.doc()!.jobs[key];

/** Lists a document under `key` as an asker that wrote the documents itself would, and returns its handle: a task with these runs, unless `doc` is given. */
function listed(repo: Repo, queue: DocHandle<Queue>, key: string, runs: Task['runs'] = [], doc?: unknown) {
  const task = repo.create<Task>((doc ?? { importUrl: CODE, input: null, key, runs }) as Task);
  queue.change((it) => listTask(it, key, { taskUrl: task.url, askedAt: Date.now(), package: null }));
  return task;
}

const closed = (id: string, status: RunStatus, message?: string) => ({
  id,
  pool: 'P',
  start: 0,
  end: 1,
  status,
  result: status === 'succeeded' ? 'done' : null,
  logs: message ? [line(message)] : [],
});
const opened = (id: string, pool = 'P') => ({ id, pool, start: 0 });
/** A stop, as `cancel` appends it: a record with no pool that says cancelled. */
const stopped = (id = 'stop') => ({ id, start: 0, end: 0, status: 'cancelled' as const });

// Asking

describe('ask', () => {
  it('lists a new task: exactly {importUrl, input, key, runs: []}, the input copied as JSON, and the entry {taskUrl, askedAt, package, needs: []}', async () => {
    const { repo, queue } = world();
    const input = { n: 1, gone: undefined, when: new Date(0), list: [1, undefined] };
    const askedAt = Date.now();
    const got = await ask(repo, queue.url, { importUrl: codeIn(PKG), input, key: 'k' });
    expect(got.key).toBe('k');
    const task = await repo.find<Task>(got.taskUrl as AutomergeUrl);
    expect(task.doc()).toEqual({
      importUrl: codeIn(PKG),
      input: { n: 1, when: '1970-01-01T00:00:00.000Z', list: [1, null] },
      key: 'k',
      runs: [],
    });
    expect(Object.keys(task.doc()!).sort()).toEqual(['importUrl', 'input', 'key', 'runs']);
    expect(queue.doc()!.jobs).toEqual({ k: { taskUrl: got.taskUrl, askedAt, package: PKG, needs: [] } });
    input.n = 2;
    expect((task.doc()!.input as { n: number }).n).toBe(1);

    // with no input, null; code in no package, a null package
    const bare = await ask(repo, queue.url, { importUrl: CODE, key: 'bare' });
    expect((await repo.find<Task>(bare.taskUrl as AutomergeUrl)).doc()!.input).toBeNull();
    expect(entryOf(queue, 'bare').package).toBeNull();
  });

  it('writes needs on the task and copies them onto the entry; near goes on the entry alone', async () => {
    const { repo, queue } = world();
    const needs = ['unix', 'pool:P'];
    const got = await ask(repo, queue.url, { importUrl: CODE, key: 'k', needs, near: 'P' });
    const task = await repo.find<Task>(got.taskUrl as AutomergeUrl);
    expect(task.doc()!.needs).toEqual(['unix', 'pool:P']);
    expect(entryOf(queue, 'k')).toMatchObject({ needs: ['unix', 'pool:P'], near: 'P' });
    expect('near' in task.doc()!).toBe(false);
    needs.push('gpu');
    expect(task.doc()!.needs).toEqual(['unix', 'pool:P']);
    expect(entryOf(queue, 'k').needs).toEqual(['unix', 'pool:P']);
  });

  it('asked again under a key whose task is wanted, the task keeps the needs it was first asked with', async () => {
    const { repo, queue } = world();
    const first = await ask(repo, queue.url, { importUrl: CODE, key: 'k', needs: ['unix'] });
    const again = await ask(repo, queue.url, { importUrl: CODE, key: 'k', needs: ['gpu'], near: 'P' });
    expect(again.taskUrl).toBe(first.taskUrl);
    expect((await repo.find<Task>(first.taskUrl as AutomergeUrl)).doc()!.needs).toEqual(['unix']);
    expect(entryOf(queue, 'k')).toEqual({ taskUrl: first.taskUrl, askedAt: expect.any(Number), package: null, needs: ['unix'] });
  });

  it('refuses needs that are not a list of labels, and a near that is not a string, writing nothing', async () => {
    const { repo, queue } = world();
    const handles = Object.keys(repo.handles).length;
    for (const needs of ['unix', [''], [7], ['unix', null], { 0: 'unix' }]) {
      await expect(ask(repo, queue.url, { importUrl: CODE, key: 'k', needs: needs as never }), JSON.stringify(needs)).rejects.toThrow(/list of labels/);
    }
    await expect(ask(repo, queue.url, { importUrl: CODE, key: 'k', near: 7 as never })).rejects.toThrow(/near/);
    expect(queue.doc()!.jobs).toEqual({});
    expect(Object.keys(repo.handles)).toHaveLength(handles);
  });

  it('saves the task before the queue names it', async () => {
    const { repo, queue } = world();
    const order: string[] = [];
    const flush = repo.flush.bind(repo);
    const what = (ids?: string[]) => (ids ?? []).map((id) => (id === queue.documentId ? 'queue' : 'task')).join();
    (repo as any).flush = async (ids?: any[]) => {
      order.push(`saving ${what(ids)}`);
      await flush(ids);
      order.push(`saved ${what(ids)}`);
    };
    queue.on('change', () => order.push('named'));
    await ask(repo, queue.url, { importUrl: CODE, key: 'k' });
    expect(order.slice(0, 3)).toEqual(['saving task', 'saved task', 'named']);
  });

  it('asking again under a key whose task is still wanted (no record has ended it) returns the same task and makes none', async () => {
    const cases: [string, Task['runs']][] = [
      ['waiting', []],
      ['an open run', [opened('r')]],
      ['two lost runs', [closed('a', 'lost'), closed('b', 'lost')]],
      ['a yielded run', [closed('a', 'yielded')]],
      // losses recorded at once by machines that each saw two: no record ends it, so it is wanted
      ['three lost runs', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost')]],
      ['three lost runs and an open run', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost'), opened('r')]],
    ];
    for (const [name, runs] of cases) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs);
      const create = vi.spyOn(repo, 'create');
      const again = await ask(repo, queue.url, { importUrl: CODE, key: 'k' });
      expect(again, name).toEqual({ key: 'k', taskUrl: task.url });
      expect(create, name).not.toHaveBeenCalled();
      expect(entryOf(queue, 'k').taskUrl, name).toBe(task.url);
    }
  });

  it('asking under a key whose document is not wanted lists a new task over it: a record ended it (open runs or not), or it is not a task at all', async () => {
    const cases: [string, Task['runs'], unknown?][] = [
      ['succeeded', [closed('a', 'succeeded')]],
      ['failed', [closed('a', 'failed')]],
      ['cancelled by a run', [closed('a', 'cancelled')]],
      ['a later run succeeded after one yielded', [closed('a', 'yielded'), closed('b', 'succeeded')]],
      ['its third loss recorded', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'failed', LOST_TOO_OFTEN)]],
      ['stopped, no runs', [stopped()]],
      ['stopped, a yielded run', [closed('a', 'yielded'), stopped()]],
      ['stopped, with an open run', [opened('r'), stopped()]],
      ['a failure after an open run (which may yet rescue it)', [opened('r'), closed('b', 'failed')]],
      ['a document with a title only', [], { title: 'not a task' }],
      ['a document whose runs are not a list', [], { importUrl: CODE, runs: 'r' }],
      ['a document with no importUrl', [], { runs: [] }],
    ];
    for (const [name, runs, doc] of cases) {
      const { repo, queue } = world();
      const old = listed(repo, queue, 'k', runs, doc);
      const before = structuredClone(old.doc());
      const again = await ask(repo, queue.url, { importUrl: CODE, input: 2, key: 'k' });
      expect(again.taskUrl, name).not.toBe(old.url);
      expect(entryOf(queue, 'k').taskUrl, name).toBe(again.taskUrl);
      expect((await repo.find<Task>(again.taskUrl as AutomergeUrl)).doc()!.input, name).toBe(2);
      expect(old.doc(), name).toEqual(before);
    }
  });

  it('asking under a key whose task cannot be found (nobody could run it either) lists a new task over it', async () => {
    const { repo, queue } = world();
    const nowhere = generateAutomergeUrl();
    queue.change((doc) => listTask(doc, 'k', { taskUrl: nowhere, askedAt: 0, package: null }));
    const asking = ask(repo, queue.url, { importUrl: CODE, input: 3, key: 'k' });
    await settle();
    const got = await asking;
    expect(got.taskUrl).not.toBe(nowhere);
    expect(entryOf(queue, 'k').taskUrl).toBe(got.taskUrl);
    expect((await repo.find<Task>(got.taskUrl as AutomergeUrl)).doc()!.input).toBe(3);
    // and the next ask under the key is asking for that task
    expect((await ask(repo, queue.url, { importUrl: CODE, key: 'k' })).taskUrl).toBe(got.taskUrl);
  });

  it("asking or cancelling under a key whose task's runs hold something that is no record goes through: the key is not stuck", async () => {
    // { importUrl, runs: [null] } is a task with no records (see recordsOf).
    const { repo, queue } = world();
    listed(repo, queue, 'k', [null as unknown as Task['runs'][number]]);
    const outcomes = await Promise.allSettled([ask(repo, queue.url, { importUrl: CODE, key: 'k' }), cancel(repo, queue.url, 'k')]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
  });

  it('without a key, each ask gets a key and a task of its own', async () => {
    const { repo, queue } = world();
    const one = await ask(repo, queue.url, { importUrl: CODE, input: 1 });
    const two = await ask(repo, queue.url, { importUrl: CODE, input: 1 });
    expect(one.key).not.toBe(two.key);
    expect(one.taskUrl).not.toBe(two.taskUrl);
    expect(Object.keys(queue.doc()!.jobs).sort()).toEqual([one.key, two.key].sort());
  });

  it("rejects '__proto__' as a key before making any document, and lists nothing", async () => {
    const { repo, queue } = world();
    const handles = Object.keys(repo.handles).length;
    const create = vi.spyOn(repo, 'create');
    const find = vi.spyOn(repo, 'find');
    await expect(ask(repo, queue.url, { importUrl: CODE, key: '__proto__' })).rejects.toThrow(/__proto__/);
    expect(create).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(Object.keys(repo.handles)).toHaveLength(handles);
    expect(queue.doc()!.jobs).toEqual({});
    expect(Object.getPrototypeOf(queue.doc()!.jobs)).toBe(Object.prototype);
  });

  it('two asks at once on two replicas leave one entry, and both askers follow it after the merge', async () => {
    const repoA = newRepo();
    const repoB = newRepo();
    const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
    const queueB = replicate(repoB, queueA);
    const [a, b] = await Promise.all([
      ask(repoA, queueA.url, { importUrl: CODE, input: 'a', key: 'k' }),
      ask(repoB, queueB.url, { importUrl: CODE, input: 'b', key: 'k' }),
    ]);
    expect(a.taskUrl).not.toBe(b.taskUrl);
    // each task reaches the other machine
    replicate(repoB, await repoA.find<Task>(a.taskUrl as AutomergeUrl));
    replicate(repoA, await repoB.find<Task>(b.taskUrl as AutomergeUrl));
    const onA = follow(repoA, queueA.url, 'k');
    const onB = follow(repoB, queueB.url, 'k');
    await settle();
    expect([onA.last.taskUrl, onB.last.taskUrl]).toEqual([a.taskUrl, b.taskUrl]);

    queueA.merge(queueB);
    queueB.merge(queueA);
    await settle();
    expect(queueA.doc()!.jobs).toEqual(queueB.doc()!.jobs);
    expect(Object.keys(queueA.doc()!.jobs)).toEqual(['k']);
    const winner = entryOf(queueA, 'k').taskUrl;
    expect([a.taskUrl, b.taskUrl]).toContain(winner);
    expect([onA.last.taskUrl, onB.last.taskUrl]).toEqual([winner, winner]);
    expect([onA.last.input, onB.last.input]).toEqual([winner === a.taskUrl ? 'a' : 'b', winner === a.taskUrl ? 'a' : 'b']);
    // and asking again, on either machine, is asking for the survivor
    expect((await ask(repoA, queueA.url, { importUrl: CODE, key: 'k' })).taskUrl).toBe(winner);
    expect((await ask(repoB, queueB.url, { importUrl: CODE, key: 'k' })).taskUrl).toBe(winner);
    onA.stop();
    onB.stop();
  });
});

// Cancelling

describe('cancel', () => {
  it('appends a stop, {id, start, end, status: cancelled} with no pool, after the runs there are, deletes the entry, and says so; the task gets no other field', async () => {
    for (const runs of [[], [opened('r')], [closed('a', 'lost'), closed('b', 'yielded')]]) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs);
      const at = Date.now();
      expect(await cancel(repo, queue.url, 'k')).toBe(true);
      expect(entryOf(queue, 'k')).toBeUndefined();
      const after = task.doc()!.runs;
      expect(after.slice(0, runs.length)).toEqual(runs);
      expect(after).toHaveLength(runs.length + 1);
      const stop = after.at(-1)!;
      expect(Object.keys(stop).sort()).toEqual(['end', 'id', 'start', 'status']);
      expect(stop).toEqual({ id: expect.any(String), start: at, end: at, status: 'cancelled' });
      expect(runs.map((run) => run.id)).not.toContain(stop.id);
      expect(Object.keys(task.doc()!).sort()).toEqual(['importUrl', 'input', 'key', 'runs']);
      expect(task.doc()).not.toHaveProperty('cancelled');
    }
  });

  it('is false for a key that names nothing, and writes nothing', async () => {
    const { repo, queue } = world();
    const other = listed(repo, queue, 'other');
    const heads = [queue.heads(), other.heads()];
    for (const key of ['k', 'constructor', '__proto__']) {
      expect(await cancel(repo, queue.url, key), key).toBe(false);
    }
    expect([queue.heads(), other.heads()]).toEqual(heads);
  });

  it('a task some record has ended gets no stop; its stale entry is removed, and the answer is false', async () => {
    const cases: [string, Task['runs']][] = [
      ['succeeded', [closed('a', 'succeeded')]],
      ['failed', [closed('a', 'failed')]],
      ['cancelled by a run', [closed('a', 'cancelled')]],
      ['stopped already', [stopped()]],
      ['third loss', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'failed', LOST_TOO_OFTEN)]],
      ['a failure after an open run', [opened('r'), closed('b', 'failed')]],
    ];
    for (const [name, runs] of cases) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs);
      const heads = task.heads();
      expect(await cancel(repo, queue.url, 'k'), name).toBe(false);
      expect(task.heads(), name).toEqual(heads);
      expect(task.doc()!.runs, name).toEqual(runs);
      expect(entryOf(queue, 'k'), name).toBeUndefined();
    }
  });

  it('a document under the key that is not a task is not written to; its entry is removed, and the answer is false', async () => {
    for (const doc of [{ title: 'not a task' }, { runs: [] }, { importUrl: CODE, runs: 'r' }, { importUrl: CODE }]) {
      const { repo, queue } = world();
      const notATask = listed(repo, queue, 'k', [], doc);
      const heads = notATask.heads();
      expect(await cancel(repo, queue.url, 'k'), JSON.stringify(doc)).toBe(false);
      expect(notATask.heads()).toEqual(heads);
      expect(notATask.doc()).toEqual(doc);
      expect(entryOf(queue, 'k')).toBeUndefined();
    }
  });

  it('on a key whose task cannot be found: removes the entry, makes and writes no task, and is false', async () => {
    const { repo, queue } = world();
    const nowhere = generateAutomergeUrl();
    queue.change((doc) => listTask(doc, 'k', { taskUrl: nowhere, askedAt: 0, package: null }));
    const other = listed(repo, queue, 'other');
    const otherHeads = other.heads();
    const create = vi.spyOn(repo, 'create');
    const cancelling = cancel(repo, queue.url, 'k');
    await settle();
    expect(await cancelling).toBe(false);
    expect(entryOf(queue, 'k')).toBeUndefined();
    expect(entryOf(queue, 'other').taskUrl).toBe(other.url);
    expect(other.heads()).toEqual(otherHeads);
    expect(create).not.toHaveBeenCalled();
  });

  it('cancelling twice: true, then false; one stop is recorded', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k');
    expect(await cancel(repo, queue.url, 'k')).toBe(true);
    expect(await cancel(repo, queue.url, 'k')).toBe(false);
    expect(task.doc()!.runs.map((run) => run.status)).toEqual(['cancelled']);
    // and twice while the key still names it (another replica listed it again meanwhile): still one stop
    queue.change((doc) => listTask(doc, 'k', { taskUrl: task.url, askedAt: Date.now(), package: null }));
    expect(await cancel(repo, queue.url, 'k')).toBe(false);
    expect(task.doc()!.runs.map((run) => run.status)).toEqual(['cancelled']);
    expect(entryOf(queue, 'k')).toBeUndefined();
  });

  it('two cancels on two replicas at once: two stops, and the first in list order is the ending on both', async () => {
    const repoA = newRepo();
    const repoB = newRepo();
    const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
    const taskA = listed(repoA, queueA, 'k');
    const queueB = replicate(repoB, queueA);
    const taskB = replicate(repoB, taskA);
    expect(await cancel(repoA, queueA.url, 'k')).toBe(true);
    expect(await cancel(repoB, queueB.url, 'k')).toBe(true);
    taskA.merge(taskB);
    taskB.merge(taskA);
    expect(taskA.doc()!.runs).toEqual(taskB.doc()!.runs);
    expect(taskA.doc()!.runs.map((run) => run.status)).toEqual(['cancelled', 'cancelled']);
    for (const task of [taskA, taskB]) {
      const watcher = follow(task === taskA ? repoA : repoB, (task === taskA ? queueA : queueB).url, 'k', { from: task.url });
      await settle();
      expect(watcher.last.state).toBe('cancelled');
      watcher.stop();
    }
  });
});

// Following

describe('watch', () => {
  it("is 'missing' only while the key names nothing and has never named a task", async () => {
    const { repo, queue } = world();
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    expect(watcher.views).toHaveLength(1);
    expect(watcher.last).toMatchObject({ key: 'k', state: 'missing', taskUrl: null, importUrl: null, runs: [], logs: [], progress: null });
    const task = listed(repo, queue, 'k');
    await settle();
    expect(watcher.last).toMatchObject({ state: 'waiting', taskUrl: task.url, importUrl: CODE });
    const seen = watcher.views.length;
    queue.change((doc) => delistTask(doc, 'k', task.url));
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(watcher.states().slice(seen)).not.toContain('missing');
    expect(watcher.last.taskUrl).toBe(task.url);
    watcher.stop();
  });

  it("is never 'missing' when started with `from`, though the key names nothing", async () => {
    const { repo, queue } = world();
    const task = repo.create<Task>({ importUrl: CODE, input: null, key: 'k', runs: [] });
    const watcher = follow(repo, queue.url, 'k', { from: task.url });
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(watcher.views.length).toBeGreaterThan(0);
    expect(watcher.states()).not.toContain('missing');
    expect(watcher.last).toMatchObject({ state: 'waiting', taskUrl: task.url });
    watcher.stop();
  });

  it("hears a new task afresh when the key moves to it: what was heard of the first task's runs does not count for the second, even under the same run names", async () => {
    const { repo, queue } = world();
    // the first task's run has gone unheard for longer than the lapse: stalled
    const first = listed(repo, queue, 'k', [opened('r')]);
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    expect(watcher.last.state).toBe('running');
    await vi.advanceTimersByTimeAsync(LAPSE_MS + LAPSE_MS / 4);
    expect(watcher.last).toMatchObject({ state: 'stalled', taskUrl: first.url });
    // a copy carrying the same run name takes the key: first sight of its run counts as heard
    const second = repo.create<Task>({ importUrl: CODE, input: 'copy', key: 'k', runs: [opened('r')] });
    queue.change((doc) => listTask(doc, 'k', { taskUrl: second.url, askedAt: Date.now(), package: null }, first.url));
    await settle();
    expect(watcher.last).toMatchObject({ state: 'running', taskUrl: second.url });
    // and a beat on the first task's channel says nothing of the second's run of that name
    beat(first, 'r');
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(watcher.last.state).toBe('running');
    beat(first, 'r');
    await vi.advanceTimersByTimeAsync(1 + LAPSE_MS / 4);
    expect(watcher.last).toMatchObject({ state: 'stalled', taskUrl: second.url });
    watcher.stop();
  });

  it('follows the key to another task when a merge replaces the entry, and hears no more of the one it followed', async () => {
    const repoA = newRepo();
    const repoB = newRepo();
    const queueA = repoA.create<Queue>({ title: 'q', jobs: {} });
    const queueB = replicate(repoB, queueA);
    const a = await ask(repoA, queueA.url, { importUrl: CODE, input: 'a', key: 'k' });
    const b = await ask(repoB, queueB.url, { importUrl: CODE, input: 'b', key: 'k' });
    const tasks = {
      [a.taskUrl]: [await repoA.find<Task>(a.taskUrl as AutomergeUrl), replicate(repoB, await repoA.find<Task>(a.taskUrl as AutomergeUrl))],
      [b.taskUrl]: [replicate(repoA, await repoB.find<Task>(b.taskUrl as AutomergeUrl)), await repoB.find<Task>(b.taskUrl as AutomergeUrl)],
    };
    const onA = follow(repoA, queueA.url, 'k');
    const onB = follow(repoB, queueB.url, 'k');
    await settle();
    queueA.merge(queueB);
    queueB.merge(queueA);
    await settle();
    const winner = entryOf(queueA, 'k').taskUrl;
    const loser = winner === a.taskUrl ? b.taskUrl : a.taskUrl;
    // the watcher whose task lost the key was moved, the other stayed
    const [moved, stayed] = winner === a.taskUrl ? [onB, onA] : [onA, onB];
    const [loserHere, winnerHere] = winner === a.taskUrl ? [tasks[loser][1], tasks[winner][1]] : [tasks[loser][0], tasks[winner][0]];
    expect(moved.views.map((view) => view.taskUrl)).toContain(loser);
    expect(moved.last.taskUrl).toBe(winner);
    expect(stayed.views.every((view) => view.taskUrl === winner)).toBe(true);
    const count = moved.views.length;
    take(loserHere, 'old');
    beat(loserHere, 'old', { progress: 'of the old task' });
    await settle();
    expect(moved.views.length).toBe(count);
    take(winnerHere, 'w');
    complete(winnerHere, 'w', 'succeeded', { result: 'the survivor' });
    await settle();
    expect(moved.last).toMatchObject({ state: 'succeeded', taskUrl: winner, result: 'the survivor' });
    onA.stop();
    onB.stop();
  });

  for (const order of ['the deletion first, then the final run', 'the final run first, then the deletion'] as const) {
    it(`keeps following the last task named after its entry is deleted, and reports the task's own ending: ${order}; never cancelled or missing in between`, async () => {
      // The asker's machine W and the pool's machine P.
      const W = newRepo();
      const P = newRepo();
      const queueW = W.create<Queue>({ title: 'q', jobs: {} });
      const { taskUrl } = await ask(W, queueW.url, { importUrl: CODE, key: 'k' });
      const taskW = await W.find<Task>(taskUrl as AutomergeUrl);
      const queueP = replicate(P, queueW);
      const taskP = replicate(P, taskW);
      const watcher = follow(W, queueW.url, 'k');
      await settle();
      take(taskP, 'r');
      taskW.merge(taskP);
      await settle();
      expect(watcher.last.state).toBe('running');
      complete(taskP, 'r', 'succeeded', { result: 42 });
      queueP.change((doc) => delistTask(doc, 'k', taskUrl));
      const deliveries =
        order === 'the deletion first, then the final run'
          ? [() => queueW.merge(queueP), () => taskW.merge(taskP)]
          : [() => taskW.merge(taskP), () => queueW.merge(queueP)];
      deliveries[0]();
      await settle();
      await vi.advanceTimersByTimeAsync(BEAT_MS);
      deliveries[1]();
      await settle();
      await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
      const states = watcher.states();
      expect(states.at(-1)).toBe('succeeded');
      expect(watcher.last).toMatchObject({ taskUrl, result: 42, error: null });
      const before = states.slice(0, states.indexOf('succeeded'));
      expect(before.every((state) => ['waiting', 'running', 'stalled'].includes(state)), states.join()).toBe(true);
      expect(states.slice(states.indexOf('succeeded')).every((state) => state === 'succeeded')).toBe(true);
      watcher.stop();
    });
  }

  it('goes from running to stalled when beats stop for the lapse with no document change, and back when a beat is heard', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [opened('r')]);
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    beat(task, 'r');
    expect(watcher.last.state).toBe('running');
    const heads = task.heads();
    const count = watcher.views.length;
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(watcher.last.state).toBe('running');
    // looked at again every quarter of a lapse, so it is told at most that late
    await vi.advanceTimersByTimeAsync(1 + LAPSE_MS / 4);
    expect(watcher.last.state).toBe('stalled');
    expect(task.heads()).toEqual(heads);
    // told once that it stalled, not on every look
    expect(watcher.views.length).toBe(count + 1);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(watcher.views.length).toBe(count + 1);
    beat(task, 'r');
    expect(watcher.last.state).toBe('running');
    watcher.stop();
  });

  it("gives the progress and logs heard for the run that holds the task, starts afresh for a new run, and after the end gives the ending run's logs", async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [opened('r1')]);
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    expect(watcher.last).toMatchObject({ state: 'running', progress: null, logs: [] });
    beat(task, 'r1', { progress: { step: 1 }, logs: [line('a')] });
    expect(watcher.last).toMatchObject({ progress: { step: 1 }, logs: [line('a')] });
    beat(task, 'r1', { logs: [line('b')] });
    expect(watcher.last).toMatchObject({ progress: { step: 1 }, logs: [line('a'), line('b')] });
    beat(task, 'r1', { progress: 2 });
    expect(watcher.last).toMatchObject({ progress: 2, logs: [line('a'), line('b')] });
    // the log heard is capped as a run's is
    beat(task, 'r1', { logs: Array.from({ length: MAX_LOG_LINES + 5 }, (_, n) => line(`n${n}`)) });
    expect(watcher.last.logs).toHaveLength(MAX_LOG_LINES);
    expect(watcher.last.logs.at(-1)).toEqual(line(`n${MAX_LOG_LINES + 4}`));

    // r1 is lost; r2 takes the task
    complete(task, 'r1', 'lost');
    take(task, 'r2');
    await settle();
    expect(watcher.last).toMatchObject({ state: 'running', progress: null, logs: [] });
    beat(task, 'r2', { logs: [line('m')] });
    expect(watcher.last).toMatchObject({ progress: null, logs: [line('m')] });

    complete(task, 'r2', 'succeeded', { result: 'ok', logs: [line('kept 1'), line('kept 2')] });
    await settle();
    expect(watcher.last).toMatchObject({ state: 'succeeded', result: 'ok', progress: null, logs: [line('kept 1'), line('kept 2')] });
    watcher.stop();
  });

  it('a beat of a later run that is giving way does not wipe what was heard of the run that holds the task', async () => {
    // Case (b): two pools took the task at once, and both say so until the later one hears the earlier.
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [opened('r1'), opened('r2')]);
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    beat(task, 'r1', { progress: 1, logs: [line('a')] });
    beat(task, 'r2', { progress: 9, logs: [line('x')] });
    expect(watcher.last).toMatchObject({ progress: 1, logs: [line('a')] });
    beat(task, 'r1', { logs: [line('b')] });
    expect(watcher.last).toMatchObject({ progress: 1, logs: [line('a'), line('b')] });
    watcher.stop();
  });

  it('on a task document whose runs are malformed (missing, null, a map, a number, a string): reports a view and does not throw; it reads waiting with no runs, a beat changes nothing, and with keep it is never listed again', async () => {
    const malformed: [string, Record<string, unknown>][] = [
      ['missing', { importUrl: CODE, input: 1, key: 'k' }],
      ['null', { importUrl: CODE, input: 1, key: 'k', runs: null }],
      ['a map', { importUrl: CODE, input: 1, key: 'k', runs: { r: { id: 'r', pool: 'P', start: 0 } } }],
      ['a number', { importUrl: CODE, input: 1, key: 'k', runs: 5 }],
      ['a string', { importUrl: CODE, input: 1, key: 'k', runs: 'r' }],
    ];
    for (const [name, doc] of malformed) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', [], doc);
      const watcher = follow(repo, queue.url, 'k', { keep: true });
      await settle();
      expect(watcher.last, name).toMatchObject({ state: 'waiting', taskUrl: task.url, importUrl: CODE, input: 1, runs: [], logs: [], result: undefined, error: null });
      beat(task, 'r', { progress: 0.5 });
      await settle();
      expect(watcher.last, name).toMatchObject({ state: 'waiting', runs: [], progress: null });
      queue.change((it) => delistTask(it, 'k', task.url));
      await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
      expect(entryOf(queue, 'k'), name).toBeUndefined();
      expect(watcher.states(), name).not.toContain('missing');
      watcher.stop();
    }
  });

  it('a message that is not a well-formed beat changes nothing and breaks nothing', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [opened('r')]);
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    beat(task, 'r', { logs: [line('a')] });
    const view = watcher.last;
    for (const message of [
      { type: 'task progress', from: 'x', seq: 1 },
      { type: 'task progress', run: 7, from: 'x', seq: 2 },
      { type: 'something else', run: 'r', from: 'x', seq: 3 },
      { type: 'task progress', run: 'r' },
    ]) {
      task.emit('ephemeral-message', { handle: task, senderId: 'x' as any, message });
    }
    beat(task, 'r', { logs: 7 });
    beat(task, 'r', { logs: 'not lines' });
    expect(watcher.last.logs).toEqual(view.logs);
    expect(watcher.last.state).toBe('running');
    watcher.stop();
  });

  it('stop() leaves no timer and no listener, on either document or on the local channel', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [opened('r')]);
    await settle();
    const timers = vi.getTimerCount();
    const count = () => [queue.listenerCount('change'), task.listenerCount('change'), task.listenerCount('ephemeral-message')];
    const before = count();
    const watcher = follow(repo, queue.url, 'k', { keep: true });
    await settle();
    expect(count()).toEqual(before.map((n) => n + 1));
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    // it hears the local channel
    const local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    local.postMessage({ channel: task.url, message: { type: 'task progress', run: 'r', progress: 'near', from: 'neighbour', seq: 1 } });
    await delivered(() => watcher.last.progress === 'near');
    expect(watcher.last.progress).toBe('near');

    watcher.stop();
    expect(count()).toEqual(before);
    expect(vi.getTimerCount()).toBe(timers);
    const seen = watcher.views.length;
    local.postMessage({ channel: task.url, message: { type: 'task progress', run: 'r', progress: 'after', from: 'neighbour', seq: 2 } });
    beat(task, 'r');
    queue.change((doc) => delistTask(doc, 'k', task.url));
    task.change((doc) => endRun(doc, 'r', { status: 'succeeded', end: Date.now() }));
    await delivered(() => false);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(watcher.views.length).toBe(seen);
    expect(entryOf(queue, 'k')).toBeUndefined();
    local.close();
  });

  it('stop() before the queue is found leaves nothing behind either', async () => {
    const { repo, queue } = world();
    await settle();
    const timers = vi.getTimerCount();
    const changes = queue.listenerCount('change');
    const watcher = follow(repo, queue.url, 'k');
    watcher.stop();
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS);
    expect(watcher.views).toEqual([]);
    expect(queue.listenerCount('change')).toBe(changes);
    expect(vi.getTimerCount()).toBe(timers);
  });
});

describe('watch with keep', () => {
  it('lists the task again, once, a lapse after its key came to name nothing while it was wanted and unheard: the same task, not before', async () => {
    const { repo, queue } = world();
    const { taskUrl } = await ask(repo, queue.url, { importUrl: codeIn(PKG), key: 'k' });
    const watcher = follow(repo, queue.url, 'k', { keep: true });
    await settle();
    queue.change((doc) => delistTask(doc, 'k', taskUrl));
    await settle();
    const goneAt = Date.now();
    let writes = 0;
    queue.on('change', () => writes++);
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(entryOf(queue, 'k')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1 + LAPSE_MS / 4);
    expect(entryOf(queue, 'k')).toMatchObject({ taskUrl, package: PKG });
    expect(entryOf(queue, 'k').askedAt).toBeGreaterThanOrEqual(goneAt + LAPSE_MS);
    expect(entryOf(queue, 'k').needs).toEqual([]);
    expect(writes).toBe(1);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(writes).toBe(1);
    expect(watcher.states()).not.toContain('missing');
    watcher.stop();
  });

  it("lists it again with the needs its document holds, and without the first asking's near", async () => {
    const { repo, queue } = world();
    const { taskUrl } = await ask(repo, queue.url, { importUrl: CODE, key: 'k', needs: ['unix'], near: 'P' });
    const watcher = follow(repo, queue.url, 'k', { keep: true });
    await settle();
    queue.change((doc) => delistTask(doc, 'k', taskUrl));
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS + LAPSE_MS / 4);
    expect(entryOf(queue, 'k')).toEqual({ taskUrl, askedAt: expect.any(Number), package: null, needs: ['unix'] });
    watcher.stop();
  });

  it('lists again a task whose document holds needs that are not a list of labels with those needs, which no pool satisfies', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [], { importUrl: CODE, input: null, key: 'k', needs: 'unix', runs: [] });
    const watcher = follow(repo, queue.url, 'k', { keep: true });
    await settle();
    queue.change((doc) => delistTask(doc, 'k', task.url));
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS + LAPSE_MS / 4);
    expect(entryOf(queue, 'k')).toMatchObject({ taskUrl: task.url, needs: 'unix' });
    watcher.stop();
  });

  const never: [string, Task['runs'], boolean][] = [
    ['it has ended by a run', [closed('a', 'succeeded')], false],
    ['it is stopped', [stopped()], false],
    ['it is stopped, with an open run nobody hears', [opened('r'), stopped()], false],
    ['its third loss is recorded', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'failed', LOST_TOO_OFTEN)], false],
    ['a failure follows an open run that is heard', [opened('r'), closed('b', 'failed')], true],
    ['an open run of it is heard', [opened('r')], true],
  ];
  for (const [why, runs, beating] of never) {
    it(`never lists the task again when ${why}`, async () => {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs);
      const watcher = follow(repo, queue.url, 'k', { keep: true });
      await settle();
      queue.change((doc) => delistTask(doc, 'k', task.url));
      await settle();
      for (let t = 0; t < LAPSE_MS * 3; t += BEAT_MS) {
        if (beating) {
          beat(task, 'r');
        }
        await vi.advanceTimersByTimeAsync(BEAT_MS);
      }
      expect(entryOf(queue, 'k')).toBeUndefined();
      watcher.stop();
    });
  }

  it('lists again a task that lost three runs with no record ending it (losses recorded at once by machines that each saw two)', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost')]);
    const watcher = follow(repo, queue.url, 'k', { keep: true });
    await settle();
    queue.change((doc) => delistTask(doc, 'k', task.url));
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS + LAPSE_MS / 4);
    expect(entryOf(queue, 'k')?.taskUrl).toBe(task.url);
    expect(watcher.last.state).toBe('waiting');
    watcher.stop();
  });

  it('without keep, never lists it again', async () => {
    const { repo, queue } = world();
    const { taskUrl } = await ask(repo, queue.url, { importUrl: CODE, key: 'k' });
    const watcher = follow(repo, queue.url, 'k');
    await settle();
    queue.change((doc) => delistTask(doc, 'k', taskUrl));
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(entryOf(queue, 'k')).toBeUndefined();
    expect(watcher.last.state).toBe('waiting');
    watcher.stop();
  });
});

describe('run', () => {
  /** Asks under `key` with run(), and hands back the task it listed and the promise. */
  async function started(key = 'k') {
    const { repo, queue } = world();
    const views: TaskView[] = [];
    const settled: { value?: unknown; error?: Error } = {};
    const promise = run(repo, queue.url, { importUrl: CODE, key }, (view) => views.push(view)).then(
      (value) => void (settled.value = value),
      (error: Error) => void (settled.error = error),
    );
    await settle();
    const task = await repo.find<Task>(entryOf(queue, key).taskUrl as AutomergeUrl);
    return { repo, queue, task, views, settled, promise };
  }

  it('resolves with the result of a succeeded task', async () => {
    const { queue, task, views, settled, promise } = await started();
    take(task, 'r');
    complete(task, 'r', 'succeeded', { result: { answer: 42 } });
    queue.change((doc) => delistTask(doc, 'k', task.url));
    await settle();
    await promise;
    expect(settled).toEqual({ value: { answer: 42 } });
    expect(views.at(-1)?.state).toBe('succeeded');
    // and it stops following: nothing more is heard or written for it
    const count = views.length;
    beat(task, 'r');
    task.change((doc) => void (doc.title = 'renamed'));
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(views.length).toBe(count);
    expect(entryOf(queue, 'k')).toBeUndefined();
  });

  it("rejects with the failing run's last log line", async () => {
    const { task, settled, promise } = await started();
    take(task, 'r');
    complete(task, 'r', 'failed', { logs: [line('first'), line('Error: boom')] });
    await settle();
    await promise;
    expect(settled.error?.message).toBe('Error: boom');
  });

  it("rejects with 'The task was cancelled' when it is cancelled", async () => {
    const { repo, queue, settled, promise } = await started();
    expect(await cancel(repo, queue.url, 'k')).toBe(true);
    await settle();
    await promise;
    expect(settled.error?.message).toBe('The task was cancelled');
  });

  it('resolves with a result that arrives after the entry was deleted', async () => {
    const { queue, task, settled, promise } = await started();
    take(task, 'r');
    queue.change((doc) => delistTask(doc, 'k', task.url));
    await settle();
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(settled).toEqual({});
    complete(task, 'r', 'succeeded', { result: 'late' });
    await settle();
    await promise;
    expect(settled).toEqual({ value: 'late' });
  });

  it("survives its entry being replaced by another asker's task, and resolves with that task's result", async () => {
    const { repo, queue, task, settled, promise } = await started();
    const theirs = repo.create<Task>({ importUrl: CODE, input: 'theirs', key: 'k', runs: [] });
    queue.change((doc) => {
      doc.jobs.k = { taskUrl: theirs.url, askedAt: 0, package: null };
    });
    await settle();
    take(task, 'mine');
    complete(task, 'mine', 'yielded');
    take(theirs, 'r');
    complete(theirs, 'r', 'succeeded', { result: 'their result' });
    await settle();
    await promise;
    expect(settled).toEqual({ value: 'their result' });
  });

  // A task some record has ended while an earlier open run still comes before
  // that record is not wanted and has not ended, for as long as that run is
  // heard. If the run's pool is gone for good, nothing will ever write to the
  // task again; run() settles all the same, a lapse after the run was last
  // heard, because it reads with ears, not with allHeard.
  const behindADeadRun: [string, (task: DocHandle<Task>, repo: Repo, queueUrl: AutomergeUrl) => Promise<void>, string][] = [
    ['stopped', async (_, repo, queueUrl) => void (await cancel(repo, queueUrl, 'k')), 'The task was cancelled'],
    ['failed after it', async (task) => complete(task, 'later', 'failed', { logs: [line('Error: later broke')] }), 'Error: later broke'],
  ];
  for (const [how, end, message] of behindADeadRun) {
    it(`is not left waiting on a task ${how} behind an open run whose pool is gone for good: it rejects a lapse after that run was last heard`, async () => {
      const { repo, queue, task, settled, promise } = await started();
      take(task, 'dead', 'gone for good');
      take(task, 'later', 'Q');
      beat(task, 'dead');
      await settle();
      await end(task, repo, queue.url);
      await settle();
      const lastWord = Date.now();
      beat(task, 'dead');
      await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
      expect(settled).toEqual({});
      await vi.advanceTimersByTimeAsync(1 + LAPSE_MS / 4);
      await promise;
      expect(settled.error?.message).toBe(message);
      expect(Date.now() - lastWord).toBeLessThanOrEqual(LAPSE_MS + LAPSE_MS / 4);
    });
  }
});

describe('served', () => {
  let seqServing = 0;
  const serving = (queue: DocHandle<Queue>, pool: string, more: Record<string, unknown> = {}) =>
    queue.emit('ephemeral-message', {
      handle: queue,
      senderId: pool as any,
      message: { type: 'serving', pool, name: `pool ${pool}`, slots: 2, busy: 0, from: `stamp ${pool}`, seq: seqServing++, ...more },
    });

  function hear(repo: Repo, queue: DocHandle<Queue>) {
    const reports: Serving[][] = [];
    const stop = served(repo, queue.url, (pools) => reports.push(pools));
    return { reports, stop };
  }

  it('reports [] at once, before anything is found or heard', () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    expect(reports).toEqual([[]]);
    stop();
  });

  it("lists a pool on its first 'serving' message, and the pools in order of their names", async () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    await settle();
    serving(queue, 'B', { busy: 1 });
    expect(reports.at(-1)).toEqual([{ pool: 'B', name: 'pool B', slots: 2, busy: 1, has: [] }]);
    serving(queue, 'A');
    expect(reports.at(-1)?.map((it) => it.pool)).toEqual(['A', 'B']);
    stop();
  });

  it('reports what each pool has, as labels: none when it says something else, and only the non-empty strings of a list', async () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    await settle();
    const cases: [unknown, string[]][] = [
      [['node', 'unix', 'pool:A'], ['node', 'unix', 'pool:A']],
      [undefined, []],
      ['unix', []],
      [{ 0: 'unix' }, []],
      [['unix', 7, '', null, 'gpu'], ['unix', 'gpu']],
    ];
    for (const [has, labels] of cases) {
      serving(queue, 'A', { has });
      expect(reports.at(-1)?.[0].has, JSON.stringify(has)).toEqual(labels);
    }
    stop();
  });

  it('drops a pool 1 ms after one lapse from its last message, each pool at its own lapse: the timer fires at the oldest pool lapse', async () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    await settle();
    serving(queue, 'A');
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    serving(queue, 'A');
    const lastA = Date.now();
    await vi.advanceTimersByTimeAsync(3_000);
    serving(queue, 'B');
    const lastB = Date.now();
    const pools = () => reports.at(-1)?.map((it) => it.pool);
    await vi.advanceTimersByTimeAsync(lastA + LAPSE_MS - Date.now());
    expect(pools()).toEqual(['A', 'B']);
    await vi.advanceTimersByTimeAsync(1);
    expect(pools()).toEqual(['B']);
    await vi.advanceTimersByTimeAsync(lastB + LAPSE_MS - Date.now());
    expect(pools()).toEqual(['B']);
    await vi.advanceTimersByTimeAsync(1);
    expect(reports.at(-1)).toEqual([]);
    stop();
  });

  it('reports only when the list changes', async () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    await settle();
    for (let i = 0; i < 5; i++) {
      serving(queue, 'A');
      await vi.advanceTimersByTimeAsync(BEAT_MS);
    }
    expect(reports).toHaveLength(2);
    serving(queue, 'A', { busy: 2 });
    expect(reports).toHaveLength(3);
    stop();
  });

  it('stop() leaves no timer and no listener', async () => {
    const { repo, queue } = world();
    await settle();
    const timers = vi.getTimerCount();
    const listeners = queue.listenerCount('ephemeral-message');
    const { reports, stop } = hear(repo, queue);
    await settle();
    serving(queue, 'A');
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    stop();
    expect(vi.getTimerCount()).toBe(timers);
    expect(queue.listenerCount('ephemeral-message')).toBe(listeners);
    const count = reports.length;
    serving(queue, 'B');
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(reports).toHaveLength(count);
  });
});

describe('messages', () => {
  it('listen passes each stamped message on once, by either route, and nothing unstamped; its stop removes both routes', async () => {
    const { queue } = world();
    const heard: unknown[] = [];
    const stop = listen(queue, (message) => heard.push(message));
    const local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    const message = { type: 'x', from: 'someone', seq: 1 };
    queue.emit('ephemeral-message', { handle: queue, senderId: 's' as any, message });
    local.postMessage({ channel: queue.url, message });
    local.postMessage({ channel: 'automerge:elsewhere', message: { ...message, seq: 2 } });
    local.postMessage({ channel: queue.url, message: { ...message, seq: 3 } });
    await delivered(() => heard.length >= 2);
    queue.emit('ephemeral-message', { handle: queue, senderId: 's' as any, message: { type: 'unstamped' } });
    queue.emit('ephemeral-message', { handle: queue, senderId: 's' as any, message: { type: 'half', from: 'someone' } });
    expect(heard).toEqual([message, { ...message, seq: 3 }]);
    stop();
    local.postMessage({ channel: queue.url, message: { ...message, seq: 4 } });
    queue.emit('ephemeral-message', { handle: queue, senderId: 's' as any, message: { ...message, seq: 5 } });
    await delivered(() => false);
    expect(heard).toHaveLength(2);
    local.close();
  });

  it('send broadcasts on the document and posts on the local channel, as one stamped message', async () => {
    const { queue } = world();
    const local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    const posted: any[] = [];
    local.onmessage = ({ data }) => posted.push(data);
    const broadcast = vi.spyOn(queue, 'broadcast');
    const stamp = stamper();
    const message = { type: 'x', ...stamp(queue.url) };
    send(queue, message);
    await delivered(() => posted.length > 0);
    expect(broadcast).toHaveBeenCalledWith(message);
    expect(posted).toEqual([{ channel: queue.url, message }]);
    local.close();
  });

  it('a stamper names its sender once and counts per channel from 0', () => {
    const stamp = stamper();
    const [a0, a1, b0] = [stamp('a'), stamp('a'), stamp('b')];
    expect([a0.seq, a1.seq, b0.seq]).toEqual([0, 1, 0]);
    expect(new Set([a0.from, a1.from, b0.from]).size).toBe(1);
    expect(stamper()('a').from).not.toBe(a0.from);
  });
});

describe('import URLs', () => {
  const ID = PKG.slice('automerge:'.length);

  it('inSamePackage keeps the heads of the module it is called from, and drops its origin and query', () => {
    const from = `https://site.example/automerge%3A${ID}%23${HEADS}/dist/assets/chunk.js?v=1`;
    expect(inSamePackage(from, 'dist/task.js')).toBe(`/automerge%3A${ID}%23${HEADS}/dist/task.js`);
    expect(inSamePackage(`https://site.example/automerge%3A${ID}/dist/x.js`, 'dist/task.js')).toBe(`/automerge%3A${ID}/dist/task.js`);
    expect(packageOf(inSamePackage(from, 'dist/task.js')!)).toBe(PKG);
  });

  it('inSamePackage is null from anything that is not a file in a package', () => {
    for (const from of [
      'data:text/javascript,export default 1',
      'file:///x/y.js',
      `https://site.example/automerge%3A${ID}`,
      `https://site.example/automerge%3A${ID}/`,
      'https://site.example/not-a-package/x.js',
      '',
    ]) {
      expect(inSamePackage(from, 'dist/task.js'), from).toBeNull();
    }
  });

  it('reads odd inputs as no package, without throwing', () => {
    for (const odd of [
      '',
      'automerge:' + ID,
      `automerge:${ID}/dist/x.js`,
      'https://site.example/%E0%A4%A/x.js',
      `https://site.example/automerge%3A${ID}%23/x.js`,
      `https://site.example/automerge%3Ashort/x.js`,
      `https://site.example/automerge%3A${ID}0OIl/x.js`,
      'blob:https://site.example/1234',
      'http://[::1',
    ]) {
      expect(parseAutomergeImport(odd), odd).toBeNull();
      expect(packageOf(odd), odd).toBeNull();
    }
  });
});

// A person's own queue

/**
 * A frame's tool-storage provider, as Patchwork's ToolStorageProvider answers
 * through patchwork-providers' `accept()`: on a `patchwork:subscribe` event
 * for `{ type: 'patchwork:tool-storage', toolId }` it stops the event, listens
 * on the event's port for `{ type: 'unsubscribe' }`, and later posts
 * `{ type: 'change', value: url }` there: the url the account names under
 * `toolStorage[toolId]`, or of a document it makes and links there first.
 */
function toolStorageProvider(target: EventTarget, repo: Repo, account: DocHandle<any>) {
  const asked: unknown[] = [];
  const onSubscribe = (event: Event) => {
    const { selector, port } = (event as CustomEvent).detail;
    if (selector?.type !== 'patchwork:tool-storage' || typeof selector.toolId !== 'string' || !selector.toolId) {
      return;
    }
    asked.push(selector);
    const toolId: string = selector.toolId;
    event.stopPropagation();
    let alive = true;
    port.onmessage = (message: MessageEvent) => {
      if (message.data?.type === 'unsubscribe' && alive) {
        alive = false;
        port.close();
      }
    };
    void Promise.resolve()
      .then(() => {
        const existing = account.doc().toolStorage?.[toolId];
        if (existing) {
          return existing;
        }
        const made = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
        account.change((doc) => {
          if (!doc.toolStorage) doc.toolStorage = {};
          if (!doc.toolStorage[toolId]) doc.toolStorage[toolId] = made.url;
        });
        return account.doc().toolStorage[toolId];
      })
      .then((url) => {
        if (alive && url) port.postMessage({ type: 'change', value: url });
      });
  };
  target.addEventListener('patchwork:subscribe', onSubscribe);
  return { asked, stop: () => target.removeEventListener('patchwork:subscribe', onSubscribe) };
}

/** Waits for a promise while letting fake time, the Repo's work and port messages (which come on the real event loop) go on. */
async function outcome<T>(promise: Promise<T>, advanceMs = 0): Promise<{ value?: T; error?: Error }> {
  let result: { value?: T; error?: Error } | undefined;
  promise.then(
    (value) => (result = { value }),
    (error) => (result = { error }),
  );
  if (advanceMs) {
    await vi.advanceTimersByTimeAsync(advanceMs);
  }
  for (let i = 0; i < 200 && !result; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!result) {
    throw new Error('it never settled');
  }
  return result;
}

describe('ownQueue', () => {
  const g = globalThis as any;
  afterEach(() => {
    delete g.accountDocHandle;
  });

  /** A page: an account open on it, with its handle where the site puts it, and the element a tool was mounted on. */
  function page(account: object = {}) {
    const repo = newRepo();
    const accountHandle = repo.create<any>(account);
    g.accountDocHandle = accountHandle;
    const element = new EventTarget();
    return { repo, account: accountHandle, element };
  }
  const handleCount = (repo: Repo) => Object.keys(repo.handles).length;

  it('returns the queue the storage already names, asking nobody and writing nothing', async () => {
    const { repo, account, element } = page();
    const storage = repo.create<any>({ own: 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P' });
    account.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
    const provider = toolStorageProvider(element, repo, account);
    const heads = [A.getHeads(account.doc()), A.getHeads(storage.doc())];
    const handles = handleCount(repo);
    const got = await outcome(ownQueue(repo, element));
    expect(got.value).toBe('automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P');
    expect(provider.asked).toEqual([]);
    expect([A.getHeads(account.doc()), A.getHeads(storage.doc())]).toEqual(heads);
    expect(handleCount(repo)).toBe(handles);
  });

  it('on an account with no storage: asks the provider once, makes one queue of the datatype\'s shape, sets `own` and serves it for any code', async () => {
    const { repo, account, element } = page();
    const provider = toolStorageProvider(element, repo, account);
    const got = await outcome(ownQueue(repo, element));
    expect(got.error).toBeUndefined();
    expect(provider.asked).toEqual([{ type: 'patchwork:tool-storage', toolId: TASKS_STORAGE_ID }]);
    const storageUrl = storageUrlOf(account.doc())!;
    expect(storageUrl).toMatch(/^automerge:/);
    const storage = await repo.find<any>(storageUrl as AutomergeUrl);
    expect(ownQueueOf(storage.doc())).toBe(got.value);
    expect(servedOf(storage.doc())).toEqual({ [got.value!]: true });
    expect(storage.doc()).toEqual({ '@patchwork': { type: 'patchwork:tool-storage' }, own: got.value, [got.value!]: true });
    const queue = await repo.find<any>(got.value as AutomergeUrl);
    expect(queue.doc()).toEqual({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} });
  });

  it('is made once: asked again, it returns the same queue and makes and writes nothing', async () => {
    const { repo, account, element } = page();
    const provider = toolStorageProvider(element, repo, account);
    const first = (await outcome(ownQueue(repo, element))).value;
    const storage = await repo.find<any>(storageUrlOf(account.doc()) as AutomergeUrl);
    const heads = [A.getHeads(account.doc()), A.getHeads(storage.doc())];
    const handles = handleCount(repo);
    const again = (await outcome(ownQueue(repo, element))).value;
    expect(again).toBe(first);
    expect(provider.asked).toHaveLength(1);
    expect(handleCount(repo)).toBe(handles);
    expect([A.getHeads(account.doc()), A.getHeads(storage.doc())]).toEqual(heads);
  });

  it('a person who left their own queue gets it back from ownQueue unserved: their leaving stands', async () => {
    const { repo, account, element } = page();
    toolStorageProvider(element, repo, account);
    const own = (await outcome(ownQueue(repo, element))).value!;
    const storage = await repo.find<any>(storageUrlOf(account.doc()) as AutomergeUrl);
    storage.change((doc) => leaveTaskQueue(doc, own as AutomergeUrl));
    expect((await outcome(ownQueue(repo, element))).value).toBe(own);
    expect(servedOf(storage.doc())).toEqual({});
  });

  /**
   * Two replicas of one account's task storage: the document the provider
   * made, with `start` written into it, then in each Repo under an actor id
   * of the test's choosing, so that a test can name which replica's write
   * Automerge ranks higher where two conflict.
   */
  function twoReplicas(actors: readonly [string, string], start: (doc: any) => void = () => {}) {
    const one = page();
    const storageA = one.repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    storageA.change(start);
    one.account.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storageA.url }));
    const repoB = newRepo();
    const storageB = replicate(repoB, storageA);
    asActor(storageA, actors[0]);
    asActor(storageB, actors[1]);
    return { one, repoB, storageA, storageB };
  }

  /** Every replica merges every other, so each has every change. */
  function mergeAll(...handles: DocHandle<any>[]) {
    for (const to of handles) {
      for (const from of handles) {
        if (to !== from) to.merge(from);
      }
    }
  }

  /**
   * The invariant the storage document's shape gives: after every replica
   * has every change, there is one pointer, the same on all of them, every
   * replica reads the same served queues, and the pointer names one of them.
   * Returns the pointer.
   */
  function onePointerNamingAServedQueue(...handles: DocHandle<any>[]) {
    const own = ownQueueOf(handles[0].doc());
    expect(own).toMatch(/^automerge:/);
    for (const handle of handles) {
      expect(ownQueueOf(handle.doc())).toBe(own);
      expect(servedOf(handle.doc())).toEqual(servedOf(handles[0].doc()));
      expect(isOnTaskQueue(handle.doc(), own as AutomergeUrl)).toBe(true);
    }
    return own!;
  }

  /** The url of the one queue of one's own made in `repo`. */
  function madeIn(repo: Repo) {
    const made = Object.values(repo.handles).filter((handle) => handle.isReady() && (handle.doc() as any)?.title === OWN_QUEUE_TITLE);
    expect(made).toHaveLength(1);
    return made[0].url;
  }

  /** Has `repo` merge `from` into `into` as it saves `into`: news that arrives between a write and the read after it. */
  function arrivesOnSave(repo: Repo, into: DocHandle<any>, from: DocHandle<any>[]) {
    const flush = repo.flush.bind(repo);
    let done = false;
    repo.flush = async (ids?: any[]) => {
      if (!done && ids?.includes(into.documentId)) {
        done = true;
        for (const other of from) into.merge(other);
      }
      return flush(ids);
    };
  }

  const PRIOR = 'automerge:bstquQmZKqNMFBRgzm57aYAKFgX' as AutomergeUrl;
  const STARTS: [string, (doc: any) => void][] = [
    ['a document that serves nothing', () => {}],
    ['a document that serves another queue for named packages', (doc) => setAcceptance(doc, PRIOR, ['automerge:pkg'])],
  ];

  it('two ownQueue calls at once from the same document, in either actor order: one pointer, the same on both, naming a served queue; both queues stay served', async () => {
    for (const [what, start] of STARTS) {
      const winners = new Set<string>();
      for (const actors of ACTOR_ORDERS) {
        const { one, repoB, storageA, storageB } = twoReplicas(actors, start);
        const [a, b] = await Promise.all([outcome(ownQueue(one.repo, one.element)), outcome(ownQueue(repoB, one.element))]);
        expect(a.value, what).toMatch(/^automerge:/);
        expect(b.value, what).toMatch(/^automerge:/);
        expect(a.value).not.toBe(b.value);
        mergeAll(storageA, storageB);
        const own = onePointerNamingAServedQueue(storageA, storageB);
        expect([a.value, b.value]).toContain(own);
        winners.add(own === a.value ? 'A' : 'B');
        // neither saw the other's pointer before it returned, so both queues stay served
        expect(isOnTaskQueue(storageA.doc(), a.value as AutomergeUrl)).toBe(true);
        expect(isOnTaskQueue(storageA.doc(), b.value as AutomergeUrl)).toBe(true);
        expect(getAcceptance(storageA.doc(), PRIOR)).toEqual(start === STARTS[0][1] ? undefined : ['automerge:pkg']);
        // asked again, each returns the pointer that stands and makes nothing
        const handles = [handleCount(one.repo), handleCount(repoB)];
        expect((await outcome(ownQueue(one.repo, one.element))).value).toBe(own);
        expect((await outcome(ownQueue(repoB, one.element))).value).toBe(own);
        expect([handleCount(one.repo), handleCount(repoB)]).toEqual(handles);
      }
      // the actor orders reach both outcomes, so both are checked
      expect([...winners].sort(), what).toEqual(['A', 'B']);
    }
  });

  it('two ownQueue calls at once from documents that have never met (the same document, each changed unseen since it was made), in either actor order: one pointer, the same on both, naming a served queue', async () => {
    const X = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P' as AutomergeUrl;
    const Y = 'automerge:3x7cLUJEpjP2EvgFz948PS6YhfhK' as AutomergeUrl;
    for (const actors of ACTOR_ORDERS) {
      const { one, repoB, storageA, storageB } = twoReplicas(actors);
      // unequal histories: A has made more changes than B, so their writes are numbered differently
      storageA.change((doc) => joinTaskQueue(doc, X));
      storageA.change((doc) => setAcceptance(doc, X, ['automerge:pkg']));
      storageA.change((doc) => setAcceptance(doc, X, 'any'));
      storageB.change((doc) => joinTaskQueue(doc, Y));
      const [a, b] = await Promise.all([outcome(ownQueue(one.repo, one.element)), outcome(ownQueue(repoB, one.element))]);
      mergeAll(storageA, storageB);
      const own = onePointerNamingAServedQueue(storageA, storageB);
      expect([a.value, b.value]).toContain(own);
      expect(getTaskQueues(storageA.doc())).toEqual({ [X]: true, [Y]: true, [a.value!]: true, [b.value!]: true });
    }
  });

  it("the loser's queue is taken back out when its maker sees the other pointer before it returns; the winner's never is", async () => {
    const outcomes = new Set<string>();
    for (const actors of ACTOR_ORDERS) {
      const { one, repoB, storageA, storageB } = twoReplicas(actors);
      const b = (await outcome(ownQueue(repoB, one.element))).value!;
      // B's pointer reaches A between A's write and A's reading it back
      arrivesOnSave(one.repo, storageA, [storageB]);
      const got = (await outcome(ownQueue(one.repo, one.element))).value!;
      const a = madeIn(one.repo);
      expect(got).toBe(ownQueueOf(storageA.doc()));
      mergeAll(storageA, storageB);
      const own = onePointerNamingAServedQueue(storageA, storageB);
      expect([a, b]).toContain(own);
      const queues = Object.keys(getTaskQueues(storageA.doc()));
      if (own === b) {
        // A lost, saw it, and took its queue back out
        expect(queues).toEqual([b]);
        outcomes.add('A lost');
      } else {
        // A won; B learns of it only now, after its call returned, so its queue stays served and empty
        expect(queues.sort()).toEqual([a, b].sort());
        outcomes.add('B lost');
      }
    }
    expect([...outcomes].sort()).toEqual(['A lost', 'B lost']);
  });

  it('three ownQueue calls, two done and the third seeing both before it returns, in every actor order: one pointer naming a served queue, and the third keeps its queue only if it won', async () => {
    const orders = permutations(ACTORS);
    expect(orders).toHaveLength(6);
    const third = new Set<string>();
    for (const actors of orders) {
      const { one, repoB, storageA, storageB } = twoReplicas([actors[0], actors[1]]);
      const repoC = newRepo();
      const storageC = replicate(repoC, storageA);
      asActor(storageC, actors[2]);
      const b = (await outcome(ownQueue(repoB, one.element))).value!;
      const c = (await outcome(ownQueue(repoC, one.element))).value!;
      arrivesOnSave(one.repo, storageA, [storageB, storageC]);
      const got = (await outcome(ownQueue(one.repo, one.element))).value!;
      // what A's call returns is the pointer that stands as A sees it; the queue it made is the one in its Repo
      const a = madeIn(one.repo);
      expect(got).toBe(ownQueueOf(storageA.doc()));
      mergeAll(storageA, storageB, storageC);
      const own = onePointerNamingAServedQueue(storageA, storageB, storageC);
      expect(got).toBe(own);
      expect([a, b, c]).toContain(own);
      expect(isOnTaskQueue(storageA.doc(), a as AutomergeUrl)).toBe(own === a);
      third.add(own === a ? 'won' : 'lost');
    }
    expect([...third].sort()).toEqual(['lost', 'won']);
  });

  it('a pointer that arrives while this call saves its new queue: it writes nothing, returns that pointer, and its queue is served by nothing', async () => {
    for (const actors of ACTOR_ORDERS) {
      const { one, repoB, storageA, storageB } = twoReplicas(actors);
      const b = (await outcome(ownQueue(repoB, one.element))).value!;
      // the first save A waits on is its new queue's
      const flush = one.repo.flush.bind(one.repo);
      let first = true;
      one.repo.flush = async (ids?: any[]) => {
        if (first) {
          first = false;
          storageA.merge(storageB);
        }
        return flush(ids);
      };
      const heads = A.getHeads(storageB.doc());
      const a = (await outcome(ownQueue(one.repo, one.element))).value!;
      expect(a).toBe(b);
      expect(A.getHeads(storageA.doc())).toEqual(heads);
      expect(Object.keys(getTaskQueues(storageA.doc()))).toEqual([b]);
    }
  });

  it('two ownQueue calls at once on the same replica: both return the one queue that is named and served, and the other queue made is named and served by nothing', async () => {
    const { repo, account, element } = page();
    const provider = toolStorageProvider(element, repo, account);
    const [a, b] = await Promise.all([outcome(ownQueue(repo, element)), outcome(ownQueue(repo, element))]);
    expect(a.value).toMatch(/^automerge:/);
    expect(b.value).toBe(a.value);
    const storage = await repo.find<any>(storageUrlOf(account.doc()) as AutomergeUrl);
    expect(ownQueueOf(storage.doc())).toBe(a.value);
    expect(servedOf(storage.doc())).toEqual({ [a.value!]: true });
    // each call asked the provider, which links one storage document into the account
    expect(provider.asked.length).toBeGreaterThanOrEqual(1);
  });

  it('a leave of the own queue on one replica at the same time as ownQueue on one that never saw the pointer, in either actor order: one pointer; it names a served queue unless it names the queue that was left', async () => {
    for (const seesItBeforeReturning of [false, true]) {
      const outcomes = new Set<string>();
      for (const actors of ACTOR_ORDERS) {
        const { one, repoB, storageA, storageB } = twoReplicas(actors);
        const a = (await outcome(ownQueue(one.repo, one.element))).value!;
        storageA.change((doc) => leaveTaskQueue(doc, a as AutomergeUrl));
        if (seesItBeforeReturning) {
          arrivesOnSave(repoB, storageB, [storageA]);
        }
        const b = (await outcome(ownQueue(repoB, one.element))).value!;
        mergeAll(storageA, storageB);
        const own = ownQueueOf(storageA.doc());
        expect(ownQueueOf(storageB.doc())).toBe(own);
        expect(servedOf(storageB.doc())).toEqual(servedOf(storageA.doc()));
        if (own === a) {
          // the left queue's pointer stands: the leaving stands with it, as when it is made alone
          expect(isOnTaskQueue(storageA.doc(), a as AutomergeUrl)).toBe(false);
          // B's queue is served if B returned it, and taken back out if B saw A's pointer first
          expect(b).toBe(seesItBeforeReturning ? a : b);
          expect(Object.keys(getTaskQueues(storageA.doc()))).toEqual(seesItBeforeReturning ? [] : [b]);
          outcomes.add('left queue named');
        } else {
          expect(own).toBe(b);
          onePointerNamingAServedQueue(storageA, storageB);
          outcomes.add('new queue named');
        }
      }
      expect([...outcomes].sort(), `B sees A's pointer before returning: ${seesItBeforeReturning}`).toEqual(['left queue named', 'new queue named']);
    }
  });

  it("a loser's taking its queue back out, at the same time as a third replica that saw its pointer sets that queue's code: the setting stands, and the pointer names a served queue", async () => {
    const outcomes = new Set<string>();
    for (const actors of permutations(ACTORS)) {
      const { one, repoB, storageA, storageB } = twoReplicas([actors[0], actors[1]]);
      const a = (await outcome(ownQueue(one.repo, one.element))).value!;
      const repoC = newRepo();
      let storageC: DocHandle<any> | undefined;
      // As B saves its pointer, C syncs with B (and so reads B's queue as the own one), then A's pointer reaches B.
      const flush = repoB.flush.bind(repoB);
      let done = false;
      repoB.flush = async (ids?: any[]) => {
        if (!done && ids?.includes(storageB.documentId)) {
          done = true;
          storageC = replicate(repoC, storageB);
          asActor(storageC, actors[2]);
          storageB.merge(storageA);
        }
        return flush(ids);
      };
      const returned = (await outcome(ownQueue(repoB, one.element))).value!;
      const b = madeIn(repoB);
      expect(ownQueueOf(storageC!.doc())).toBe(b);
      storageC!.change((doc) => setAcceptance(doc, b as AutomergeUrl, ['automerge:pkg']));
      mergeAll(storageA, storageB, storageC!);
      const own = onePointerNamingAServedQueue(storageA, storageB, storageC!);
      expect(returned).toBe(own);
      // C's setting was made without seeing B take the queue out, so it outlasts that
      expect(getAcceptance(storageA.doc(), b as AutomergeUrl)).toEqual(['automerge:pkg']);
      outcomes.add(own === a ? 'B lost' : 'B won');
    }
    expect([...outcomes].sort()).toEqual(['B lost', 'B won']);
  });

  it('with no provider to answer: rejects plainly after PROVIDER_WAIT_MS, and has written and made nothing', async () => {
    const { repo, account, element } = page();
    const heads = A.getHeads(account.doc());
    const handles = handleCount(repo);
    const early = ownQueue(repo, element);
    const before = await outcome(Promise.race([early, new Promise((resolve) => setTimeout(resolve, PROVIDER_WAIT_MS - 1, 'waiting'))]), PROVIDER_WAIT_MS - 1);
    expect(before.value).toBe('waiting');
    const got = await outcome(early, 1);
    expect(got.error?.message).toBe('This page has nowhere to keep your task queues, so nothing was changed.');
    expect(A.getHeads(account.doc())).toEqual(heads);
    expect(account.doc().toolStorage).toBeUndefined();
    expect(handleCount(repo)).toBe(handles);
  });

  it('a provider that answers something that is no url is no answer', async () => {
    const { repo, account, element } = page();
    element.addEventListener('patchwork:subscribe', (event) => {
      event.stopPropagation();
      (event as CustomEvent).detail.port.postMessage({ type: 'change', value: 42 });
    });
    const got = await outcome(ownQueue(repo, element), PROVIDER_WAIT_MS);
    expect(got.error?.message).toBe('This page has nowhere to keep your task queues, so nothing was changed.');
    expect(account.doc().toolStorage).toBeUndefined();
  });

  it('called from Node, with no account open and no element: rejects plainly and makes nothing', async () => {
    const repo = newRepo();
    const handles = handleCount(repo);
    for (const element of [undefined, new EventTarget()]) {
      const got = await outcome(ownQueue(repo, element));
      expect(got.error?.message).toBe('Task queues can only be kept from a Patchwork page with your account open.');
      expect((await outcome(tasksStorage(repo, element))).error?.message).toBe(got.error?.message);
    }
    expect(handleCount(repo)).toBe(handles);
  });

  it('with an account open but no element to ask from: rejects the same way, and writes nothing', async () => {
    const { repo, account } = page();
    const heads = A.getHeads(account.doc());
    const got = await outcome(ownQueue(repo, undefined));
    expect(got.error?.message).toBe('Task queues can only be kept from a Patchwork page with your account open.');
    expect(A.getHeads(account.doc())).toEqual(heads);
  });

  it('a queue it makes can be asked for work under the usual rules', async () => {
    const { repo, account, element } = page();
    toolStorageProvider(element, repo, account);
    const own = (await outcome(ownQueue(repo, element))).value as AutomergeUrl;
    const asked = (await outcome(ask(repo, own, { importUrl: CODE, key: 'k' }))).value!;
    const queue = await repo.find<Queue>(own);
    expect(queue.doc()!.jobs.k.taskUrl).toBe(asked.taskUrl);
  });
});

describe('the served queues on two replicas at once (helpers.ts writers on real documents)', () => {
  const Q1 = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P' as AutomergeUrl;
  const Q2 = 'automerge:3x7cLUJEpjP2EvgFz948PS6YhfhK' as AutomergeUrl;
  const Q0 = 'automerge:bstquQmZKqNMFBRgzm57aYAKFgX' as AutomergeUrl;
  const MADE = { '@patchwork': { type: 'patchwork:tool-storage' } };

  /**
   * The storage document as the provider made it, with `start` written in,
   * then changed by `a` on one replica and `b` on another, each under its
   * own actor, in both actor orders; merged both ways. Checks that both
   * replicas read the same, and gives what each order read.
   */
  function race(start: (doc: any) => void, a: (doc: any) => void, b: (doc: any) => void) {
    return ACTOR_ORDERS.map(([x, y]) => {
      const made = A.change(A.from<any>(structuredClone(MADE), ACTORS[2]), start);
      const one = A.change(A.clone(made, x), a);
      const other = A.change(A.clone(made, y), b);
      const oneMerged = A.merge(A.clone(one), other);
      const otherMerged = A.merge(A.clone(other), one);
      expect(servedOf(oneMerged)).toEqual(servedOf(otherMerged));
      expect(ownQueueOf(oneMerged)).toBe(ownQueueOf(otherMerged));
      return servedOf(oneMerged);
    });
  }

  it('two first joins of different queues at once: both served, in either order', () => {
    for (const served of race(() => {}, (d) => joinTaskQueue(d, Q1), (d) => joinTaskQueue(d, Q2))) {
      expect(served).toEqual({ [Q1]: true, [Q2]: true });
    }
  });

  it('two joins of different queues at once beside a served queue and a pointer: all stand', () => {
    for (const served of race(
      (d) => ((d.own = Q0), joinTaskQueue(d, Q0)),
      (d) => joinTaskQueue(d, Q1),
      (d) => joinTaskQueue(d, Q2),
    )) {
      expect(served).toEqual({ [Q0]: true, [Q1]: true, [Q2]: true });
    }
  });

  it('a join and a leave of different queues at once: both stand', () => {
    for (const served of race((d) => joinTaskQueue(d, Q0), (d) => joinTaskQueue(d, Q1), (d) => leaveTaskQueue(d, Q0))) {
      expect(served).toEqual({ [Q1]: true });
    }
  });

  it('a leave and a new setting of the same queue at once: the setting wins, on both, in either order (a leave removes only what it saw)', () => {
    for (const served of race(
      (d) => setAcceptance(d, Q1, ['automerge:pkg']),
      (d) => leaveTaskQueue(d, Q1),
      (d) => setAcceptance(d, Q1, 'any'),
    )) {
      expect(served).toEqual({ [Q1]: true });
    }
  });

  it('a join and a leave of the same queue at once, where the leaver had served it unseen: the join wins, on both, in either order', () => {
    for (const served of race(
      () => {},
      (d) => (joinTaskQueue(d, Q1), leaveTaskQueue(d, Q1)),
      (d) => joinTaskQueue(d, Q1),
    )) {
      expect(served).toEqual({ [Q1]: true });
    }
  });

  it('a join and a leave of the same queue at once, where both saw it served: the join writes nothing, so the leave wins, on both, in either order', () => {
    for (const served of race(
      (d) => joinTaskQueue(d, Q1),
      (d) => joinTaskQueue(d, Q1),
      (d) => leaveTaskQueue(d, Q1),
    )) {
      expect(served).toEqual({});
    }
  });

  it('two different settings of one queue at once: one of them, whole, the same on both; the actor orders reach both', () => {
    const one = { [Q1]: { packages: ['automerge:p1'] } };
    const other = { [Q1]: { packages: ['automerge:p2', 'automerge:p3'] } };
    const results = race(
      (d) => joinTaskQueue(d, Q1),
      (d) => setAcceptance(d, Q1, ['automerge:p1']),
      (d) => setAcceptance(d, Q1, ['automerge:p2', 'automerge:p3']),
    ).map((served) => JSON.stringify(served));
    expect(new Set(results)).toEqual(new Set([JSON.stringify(one), JSON.stringify(other)]));
  });

  it('a setting for named packages and one for any code at once: one of them, whole, the same on both; the actor orders reach both', () => {
    // served at first for a third setting, so that each of the two writes something
    const results = race(
      (d) => setAcceptance(d, Q1, ['automerge:p0']),
      (d) => setAcceptance(d, Q1, ['automerge:p1']),
      (d) => setAcceptance(d, Q1, 'any'),
    ).map((served) => JSON.stringify(served));
    expect(new Set(results)).toEqual(new Set([JSON.stringify({ [Q1]: { packages: ['automerge:p1'] } }), JSON.stringify({ [Q1]: true })]));
  });

  it('keys on a real document that are not queue urls are never read as served', () => {
    const doc = A.change(A.from<any>(structuredClone(MADE)), (d) => {
      d.own = Q0;
      d.served = { [Q2]: true };
      d.title = 'automerge:not a key that counts';
      joinTaskQueue(d, Q1);
    });
    expect(servedOf(doc)).toEqual({ [Q1]: true });
    expect(isOnTaskQueue(doc, Q0)).toBe(false);
    expect(isOnTaskQueue(doc, Q2)).toBe(false);
  });
});

// Finding a document that may not have arrived, one try at a time

describe('findWhenThere, each try', () => {
  /** A Repo whose finds answer as `answers` says, in turn: 'never', a handle, or an error. */
  function finds(...answers: ('never' | { late: number; value: any } | { value: any } | { error: string })[]) {
    let i = 0;
    const find = vi.fn(() => {
      const answer = answers[Math.min(i++, answers.length - 1)];
      if (answer === 'never') return new Promise<any>(() => {});
      if ('error' in answer) return Promise.reject(new Error(answer.error));
      if ('late' in answer) return new Promise<any>((resolve) => setTimeout(() => resolve(answer.value), answer.late));
      return Promise.resolve(answer.value);
    });
    return { find };
  }
  const handle = (doc: unknown) => ({ doc: () => doc });
  const watched = (promise: Promise<unknown>) => {
    const got: { value?: any; error?: Error } = {};
    promise.then(
      (value) => void (got.value = value),
      (error) => void (got.error = error),
    );
    return got;
  };

  it('gives up a find that never settles after `each`, and tries again after the wait', async () => {
    const repo = finds('never', { value: handle({ ok: true }) });
    const got = watched(findWhenThere(repo, 'u', { tries: 3, wait: 10, each: 100 }));
    await vi.advanceTimersByTimeAsync(99);
    expect(repo.find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 9);
    expect(repo.find).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repo.find).toHaveBeenCalledTimes(2);
    await settle();
    expect(got.value?.doc()).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is bounded: tries × each and the waits between, then it rejects with what the last try said, and leaves no timer', async () => {
    const repo = finds('never');
    const got = watched(findWhenThere(repo, 'u', { tries: 3, wait: 10, each: 100 }));
    await vi.advanceTimersByTimeAsync(3 * 100 + 10 + 20 - 1);
    expect(got).toEqual({});
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(got.error?.message).toBe('u did not arrive in 100 ms');
    expect(repo.find).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a find that answers within its try is not waited on further, and leaves no timer', async () => {
    const repo = finds({ late: 50, value: handle({ ok: 1 }) });
    const got = watched(findWhenThere(repo, 'u', { tries: 3, each: 100 }));
    await vi.advanceTimersByTimeAsync(50);
    await settle();
    expect(got.value?.doc()).toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a find that answers after its try was given up changes nothing: the next try is what counts', async () => {
    const repo = finds({ late: 150, value: handle({ from: 'late' }) }, 'never', { value: handle({ from: 'third' }) });
    const got = watched(findWhenThere(repo, 'u', { tries: 3, wait: 100, each: 100 }));
    // the first try is given up at 100, its answer comes at 150 during the wait, the second try starts at 200 and is given up at 300
    await vi.advanceTimersByTimeAsync(299);
    expect(got).toEqual({});
    expect(repo.find).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1 + 200);
    await settle();
    expect(got.value?.doc()).toEqual({ from: 'third' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('run with a signal', () => {
  const asking = (repo: Repo, queue: DocHandle<Queue>, signal: AbortSignal, key = 'k') => {
    const views: TaskView[] = [];
    const settled: { value?: unknown; error?: Error } = {};
    const promise = run(repo, queue.url, { importUrl: CODE, key }, (view) => views.push(view), signal).then(
      (value) => void (settled.value = value),
      (error: Error) => void (settled.error = error),
    );
    return { views, settled, promise };
  };
  const stopsOf = (task: DocHandle<Task>) => task.doc()!.runs.filter((r: any) => r.status === 'cancelled' && r.pool === undefined);

  it('aborted before it is called: rejects at once, and makes and lists nothing', async () => {
    const { repo, queue } = world();
    await settle();
    const handles = Object.keys(repo.handles).length;
    const heads = A.getHeads(queue.doc()!);
    const controller = new AbortController();
    controller.abort();
    const { settled, promise } = asking(repo, queue, controller.signal);
    await promise;
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(Object.keys(repo.handles)).toHaveLength(handles);
    expect(A.getHeads(queue.doc()!)).toEqual(heads);
  });

  it('aborted while it asks, before the task is listed: the task it lists is stopped and delisted, and it rejects', async () => {
    const { repo, queue } = world();
    const controller = new AbortController();
    const { settled, promise } = asking(repo, queue, controller.signal);
    controller.abort();
    await settle();
    await promise;
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(entryOf(queue, 'k')).toBeUndefined();
    const made = Object.values(repo.handles).filter((h: any) => h.doc()?.key === 'k') as DocHandle<Task>[];
    expect(made).toHaveLength(1);
    expect(stopsOf(made[0])).toHaveLength(1);
  });

  it('aborted after the task is listed: appends a stop, delists it, and rejects', async () => {
    const { repo, queue } = world();
    const controller = new AbortController();
    const { views, settled, promise } = asking(repo, queue, controller.signal);
    await settle();
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    expect(settled).toEqual({});
    controller.abort();
    await settle();
    await promise;
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(stopsOf(task)).toHaveLength(1);
    expect(entryOf(queue, 'k')).toBeUndefined();
    expect(views.at(-1)?.state).toBe('cancelled');
  });

  it('aborted while a pool runs it: the stop is appended, and it rejects once the pool records the run cancelled', async () => {
    const { repo, queue } = world();
    const controller = new AbortController();
    const { settled, promise } = asking(repo, queue, controller.signal);
    await settle();
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    take(task, 'r');
    beat(task, 'r');
    await settle();
    controller.abort();
    await settle();
    expect(stopsOf(task)).toHaveLength(1);
    expect(settled).toEqual({});
    complete(task, 'r', 'cancelled');
    await settle();
    await promise;
    expect(settled.error?.message).toBe('The task was cancelled');
  });

  it('aborted after the task ended: nothing is written, and what it resolved to stands', async () => {
    const { repo, queue } = world();
    const controller = new AbortController();
    const { settled, promise } = asking(repo, queue, controller.signal);
    await settle();
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    take(task, 'r');
    complete(task, 'r', 'succeeded', { result: 'done' });
    await settle();
    await promise;
    const heads = [A.getHeads(task.doc()!), A.getHeads(queue.doc()!)];
    controller.abort();
    await settle();
    expect(settled).toEqual({ value: 'done' });
    expect([A.getHeads(task.doc()!), A.getHeads(queue.doc()!)]).toEqual(heads);
  });
});

// Having work done from a page

describe('doWork', () => {
  const g = globalThis as any;
  /** The work every test here asks for: it hands its arguments to whatever the test put at globalThis.__work. */
  const WORK = 'data:text/javascript,export default function (input, ctx) { return globalThis.__work(input, ctx, this); }';
  afterEach(() => {
    delete g.accountDocHandle;
    delete g.__work;
  });

  type Setup = 'no account' | 'no storage' | 'no own queue' | 'an own queue nobody is heard serving' | 'an own queue';
  /** A page in one of the setups, with the person's own queue if it has one. */
  function page(setup: Setup) {
    const repo = newRepo();
    let queue: DocHandle<Queue> | undefined;
    if (setup !== 'no account') {
      const account = repo.create<any>({});
      g.accountDocHandle = account;
      if (setup !== 'no storage') {
        const storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
        account.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
        if (setup !== 'no own queue') {
          queue = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
          storage.change((doc) => {
            doc.own = queue!.url;
            doc[queue!.url] = true;
          });
        }
      }
    }
    return { repo, queue };
  }
  /** Every document a Repo has, and its heads: what doing work here must leave as it was. */
  const everything = (repo: Repo) => Object.values(repo.handles).map((h: any) => [h.url, A.getHeads(h.doc())]);

  let servingSeq = 0;
  const serving = (queue: DocHandle<Queue>, pool = 'P', has: string[] = ['browser', `pool:${pool}`]) =>
    queue.emit('ephemeral-message', {
      handle: queue,
      senderId: pool as any,
      message: { type: 'serving', pool, name: `pool ${pool}`, slots: 1, busy: 0, has, from: `stamp ${pool}`, seq: servingSeq++ },
    });

  function doing(repo: Repo, request: { importUrl?: string; input?: unknown; key?: string; needs?: string[]; near?: string } = {}, signal?: AbortSignal) {
    const views: TaskView[] = [];
    const settled: { value?: unknown; error?: Error } = {};
    const promise = doWork(repo, { importUrl: WORK, input: { n: 1 }, key: 'k', ...request }, { onProgress: (view) => views.push(view), signal }).then(
      (value) => void (settled.value = value),
      (error: Error) => void (settled.error = error),
    );
    return { views, settled, promise };
  }
  /** Lets an import (which comes on the real event loop) and the Repo's work go on, moving fake time by `ms` first. */
  async function until(done: () => boolean, ms = 0) {
    if (ms) await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 400 && !done(); i++) {
      await vi.advanceTimersByTimeAsync(0);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const HERE: [Setup, number][] = [
    ['no account', 0],
    ['no storage', 0],
    ['no own queue', 0],
    ['an own queue nobody is heard serving', BEAT_MS + 500],
  ];
  for (const [setup, wait] of HERE) {
    it(`with ${setup}: imports the code and calls it here with (input, ctx), and resolves with what it returned; it writes and makes nothing`, async () => {
      const { repo } = page(setup);
      await settle();
      const before = everything(repo);
      let seen: any;
      g.__work = (input: any, ctx: any, self: any) => {
        seen = { input, ctx, self };
        ctx.log('a line', 1);
        ctx.progress({ stage: 'half' });
        return { n: input.n + 1 };
      };
      const input = { n: 1 };
      const { views, settled } = doing(repo, { input });
      if (wait) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(seen).toBeUndefined();
      }
      await until(() => 'value' in settled || 'error' in settled, wait ? 1 : 0);
      expect(settled).toEqual({ value: { n: 2 } });
      expect(seen.input).toEqual(input);
      expect(seen.input).not.toBe(input);
      expect(seen.self).toBe(seen.ctx);
      expect(Object.keys(seen.ctx).sort()).toEqual(['key', 'log', 'progress', 'repo', 'run', 'signal', 'taskUrl']);
      expect(seen.ctx.repo).toBe(repo);
      expect(seen.ctx.key).toBe('k');
      expect(seen.ctx.taskUrl).toBeNull();
      expect(seen.ctx.run).toMatch(/^[0-9a-f-]{36}$/);
      expect(seen.ctx.signal.aborted).toBe(false);
      expect(views.map((view) => view.state)).toEqual(['running', 'running', 'running', 'succeeded']);
      const last = views.at(-1)!;
      expect(last).toMatchObject({ key: 'k', taskUrl: null, importUrl: WORK, progress: { stage: 'half' }, result: { n: 2 }, error: null, runs: [] });
      expect(last.logs.map((l) => l.message)).toEqual(['a line 1']);
      expect(everything(repo)).toEqual(before);
    });
  }

  it('done here: a throw rejects with its message and is reported failed', async () => {
    const { repo } = page('no account');
    g.__work = () => {
      throw new Error('boom');
    };
    const { views, settled } = doing(repo);
    await until(() => 'error' in settled);
    expect(settled.error?.message).toBe('boom');
    expect(views.at(-1)).toMatchObject({ state: 'failed', error: 'boom' });
    expect(views.at(-1)!.logs.at(-1)?.message).toBe('boom');
  });

  it('done here: code with no default function rejects plainly, and is reported failed', async () => {
    const { repo } = page('no account');
    const { views, settled } = doing(repo, { importUrl: 'data:text/javascript,export const notAFunction = 1' });
    await until(() => 'error' in settled);
    expect(settled.error?.message).toBe("the task's code has no default export to call");
    expect(views.at(-1)?.state).toBe('failed');
  });

  it("done here: aborting the signal aborts ctx.signal with 'cancelled' and rejects at once, though the code goes on and then returns; nothing is heard after", async () => {
    const { repo } = page('no account');
    let ctx: any;
    let finish = (_: unknown) => {};
    g.__work = (_input: unknown, c: any) => {
      ctx = c;
      return new Promise((resolve) => (finish = resolve));
    };
    const controller = new AbortController();
    const { views, settled } = doing(repo, {}, controller.signal);
    await until(() => ctx !== undefined);
    controller.abort();
    await until(() => 'error' in settled);
    expect(ctx.signal.aborted).toBe(true);
    expect(ctx.signal.reason).toBe('cancelled');
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(views.at(-1)?.state).toBe('cancelled');
    const heard = views.length;
    ctx.log('still going');
    finish('a result after all');
    await until(() => false);
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(views).toHaveLength(heard);
  });

  it('done here: a signal aborted before it is called rejects, and the code is not called', async () => {
    const { repo } = page('no account');
    g.__work = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const { settled } = doing(repo, {}, controller.signal);
    await until(() => 'error' in settled);
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(g.__work).not.toHaveBeenCalled();
  });

  it('aborted while it still waits to hear whether a pool serves the own queue: rejects at once, and neither asks nor calls anything, then or once a pool is heard', async () => {
    const { repo, queue } = page('an own queue nobody is heard serving');
    g.__work = vi.fn();
    const controller = new AbortController();
    const { settled } = doing(repo, {}, controller.signal);
    await settle();
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(settled).toEqual({});
    const stoppedAt = Date.now();
    controller.abort();
    await until(() => 'error' in settled);
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(Date.now()).toBe(stoppedAt);
    serving(queue!);
    await until(() => false, BEAT_MS + 500);
    expect(queue!.doc()!.jobs).toEqual({});
    expect(g.__work).not.toHaveBeenCalled();
  });

  it('a signal aborted before it is called, with an own queue a pool is heard serving: rejects, and asks nothing', async () => {
    const { repo, queue } = page('an own queue');
    g.__work = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const { settled } = doing(repo, {}, controller.signal);
    await settle();
    serving(queue!);
    await until(() => 'error' in settled, BEAT_MS + 500);
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(queue!.doc()!.jobs).toEqual({});
    expect(g.__work).not.toHaveBeenCalled();
  });

  /** An own queue a pool is heard serving, and work asked of it. */
  async function asked(signal?: AbortSignal) {
    const { repo, queue } = page('an own queue');
    g.__work = vi.fn();
    const doingIt = doing(repo, {}, signal);
    await settle();
    serving(queue!);
    await until(() => !!entryOf(queue!, 'k'));
    return { repo, queue: queue!, ...doingIt };
  }

  it('with an own queue a pool is heard serving: lists a task under the key with the import url and input, and calls nothing here', async () => {
    const { repo, queue, views } = await asked();
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    expect(task.doc()).toEqual({ importUrl: WORK, input: { n: 1 }, key: 'k', runs: [] });
    expect(g.__work).not.toHaveBeenCalled();
    expect(views.at(-1)).toMatchObject({ state: 'waiting', taskUrl: task.url });
  });

  it('asked: the first asking waits to hear a pool only until one is heard; a later one does not wait at all', async () => {
    const { repo, queue } = page('an own queue');
    g.__work = vi.fn();
    doing(repo, { key: 'first' });
    await settle();
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    expect(entryOf(queue!, 'first')).toBeUndefined();
    serving(queue!);
    await until(() => !!entryOf(queue!, 'first'));
    expect(entryOf(queue!, 'first')).toBeDefined();
    const started = Date.now();
    doing(repo, { key: 'later' });
    await until(() => !!entryOf(queue!, 'later'));
    expect(entryOf(queue!, 'later')).toBeDefined();
    expect(Date.now()).toBe(started);
    expect(g.__work).not.toHaveBeenCalled();
  });

  it('nobody heard: the first asking is done here after a beat and a little; a later one is done here at once', async () => {
    const { repo, queue } = page('an own queue nobody is heard serving');
    g.__work = vi.fn(() => 'here');
    const first = doing(repo, { key: 'first' });
    await settle();
    await vi.advanceTimersByTimeAsync(BEAT_MS + 499);
    expect(g.__work).not.toHaveBeenCalled();
    await until(() => 'value' in first.settled, 1);
    expect(first.settled).toEqual({ value: 'here' });
    const started = Date.now();
    const later = doing(repo, { key: 'later' });
    await until(() => 'value' in later.settled);
    expect(later.settled).toEqual({ value: 'here' });
    expect(Date.now()).toBe(started);
    expect(queue!.doc()!.jobs).toEqual({});
  });

  it("asked: the result of the task's ending run resolves it", async () => {
    const { repo, queue, settled, views } = await asked();
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    take(task, 'r');
    beat(task, 'r', { progress: 'half', logs: [line('going')] });
    await settle();
    expect(views.at(-1)).toMatchObject({ state: 'running', progress: 'half' });
    complete(task, 'r', 'succeeded', { result: { n: 2 } });
    await until(() => 'value' in settled);
    expect(settled).toEqual({ value: { n: 2 } });
    expect(views.at(-1)?.state).toBe('succeeded');
  });

  it('asked: aborting the signal appends a stop to the task and rejects', async () => {
    const controller = new AbortController();
    const { repo, queue, settled } = await asked(controller.signal);
    const task = await repo.find<Task>(entryOf(queue, 'k').taskUrl as AutomergeUrl);
    controller.abort();
    await until(() => 'error' in settled);
    expect(settled.error?.message).toBe('The task was cancelled');
    expect(task.doc()!.runs).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(entryOf(queue, 'k')).toBeUndefined();
  });

  it('code in a package kept in automerge travels: with a pool heard, it is asked of the own queue and not called here', async () => {
    const { repo, queue } = await asked();
    doing(repo, { importUrl: codeIn(PKG), key: 'packaged' });
    await until(() => !!entryOf(queue, 'packaged'));
    expect(entryOf(queue, 'packaged').package).toBe(PKG);
    expect(g.__work).not.toHaveBeenCalled();
  });

  it('code at an http: url (a dev server) is done here at once though a pool is heard: the import is tried here, and nothing is asked', async () => {
    const { repo, queue } = await asked();
    const started = Date.now();
    const here = doing(repo, { importUrl: 'http://localhost:5173/src/task.js', key: 'dev' });
    await until(() => 'error' in here.settled);
    expect(Date.now()).toBe(started);
    // Node cannot import http: urls, so what this page's import said is the failure
    expect(here.views.at(-1)).toMatchObject({ state: 'failed', taskUrl: null, importUrl: 'http://localhost:5173/src/task.js' });
    expect(entryOf(queue, 'dev')).toBeUndefined();
  });

  it('code at a file: url is done here at once though a pool is heard, and resolves with what it returned', async () => {
    const { repo, queue } = await asked();
    const dir = mkdtempSync(join(tmpdir(), 'task-client-'));
    const file = join(dir, 'task.mjs');
    writeFileSync(file, 'export default function (input, ctx) { return globalThis.__work(input, ctx, this); }');
    g.__work = vi.fn((input: { n: number }) => input.n * 10);
    const started = Date.now();
    const here = doing(repo, { importUrl: pathToFileURL(file).href, key: 'local' });
    await until(() => 'value' in here.settled || 'error' in here.settled);
    expect(here.settled).toEqual({ value: 10 });
    expect(Date.now()).toBe(started);
    expect(here.views.at(-1)).toMatchObject({ state: 'succeeded', taskUrl: null });
    expect(entryOf(queue, 'local')).toBeUndefined();
  });

  // What the work needs, and where it is done: each row is a setup, what the
  // pools heard serving the own queue have (none heard: null), what the work
  // needs, and where it goes: asked of the queue at once, asked once the
  // listening for a pool is over (a beat and a little), done here at once or
  // then, or rejected.
  type Where = 'asked at once' | 'asked after the wait' | 'here at once' | 'here after the wait' | 'rejected at once' | 'rejected after the wait';
  const NEED_CASES: [Setup, string[] | null, string[], Where][] = [
    ['an own queue', ['browser'], ['browser'], 'asked at once'],
    ['an own queue', ['node'], ['browser'], 'here after the wait'],
    ['an own queue nobody is heard serving', null, ['browser'], 'here after the wait'],
    ['an own queue', ['node', 'unix'], ['unix'], 'asked at once'],
    ['an own queue', ['node', 'unix'], ['unix', 'node'], 'asked at once'],
    ['an own queue', ['node'], ['unix'], 'asked after the wait'],
    ['an own queue', ['browser'], ['unix'], 'asked after the wait'],
    ['an own queue nobody is heard serving', null, ['unix'], 'asked after the wait'],
    ['an own queue', ['browser', 'pool:P'], ['pool:P'], 'asked at once'],
    ['an own queue', ['browser', 'pool:P'], ['pool:Q'], 'asked after the wait'],
    ['no own queue', null, ['unix'], 'rejected at once'],
    ['no storage', null, ['unix'], 'rejected at once'],
    ['no account', null, ['unix'], 'rejected at once'],
    ['no own queue', null, ['browser'], 'here at once'],
  ];
  for (const [setup, has, needs, where] of NEED_CASES) {
    it(`needing ${JSON.stringify(needs)}, with ${setup}${has ? ` and a pool heard that has ${JSON.stringify(has)}` : ''}: ${where}`, async () => {
      const { repo, queue } = page(setup);
      g.__work = vi.fn(() => 'here');
      const startedAt = Date.now();
      const work = doing(repo, { needs });
      await settle();
      if (has) {
        serving(queue!, 'P', has);
      }
      const decided = () => 'value' in work.settled || 'error' in work.settled || (!!queue && !!entryOf(queue, 'k'));
      if (where.endsWith('after the wait')) {
        await until(decided, BEAT_MS + 499);
        expect(decided(), 'decided before the wait was over').toBe(false);
        await until(decided, 1);
      } else {
        await until(decided);
      }
      expect(decided()).toBe(true);
      expect(Date.now() - startedAt).toBe(where.endsWith('after the wait') ? BEAT_MS + 500 : 0);
      if (where.startsWith('asked')) {
        const task = await repo.find<Task>(entryOf(queue!, 'k').taskUrl as AutomergeUrl);
        expect(task.doc()!.needs).toEqual(needs);
        expect(entryOf(queue!, 'k').needs).toEqual(needs);
        expect(g.__work).not.toHaveBeenCalled();
        expect(work.settled).toEqual({});
        expect(work.views.at(-1)?.state).toBe('waiting');
      } else if (where.startsWith('here')) {
        expect(work.settled).toEqual({ value: 'here' });
        expect(queue ? queue.doc()!.jobs : {}).toEqual({});
      } else {
        expect(work.settled.error?.message).toBe('This work needs a device with unix, and you have no task queue for such a device to serve.');
        expect(g.__work).not.toHaveBeenCalled();
      }
    });
  }

  it('needing what a page lacks, the first asking is made as soon as a pool that has it is heard, not when the wait is over', async () => {
    const { repo, queue } = page('an own queue');
    g.__work = vi.fn();
    const work = doing(repo, { needs: ['unix'] });
    await settle();
    serving(queue!, 'B', ['browser']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(entryOf(queue!, 'k')).toBeUndefined();
    serving(queue!, 'N', ['node', 'unix']);
    const heardAt = Date.now();
    await until(() => !!entryOf(queue!, 'k'));
    expect(Date.now()).toBe(heardAt);
    expect(work.settled).toEqual({});
  });

  it('code that cannot travel, needing what a page lacks, is rejected at once, even with a pool heard that has it', async () => {
    const { repo, queue } = await asked();
    serving(queue, 'N', ['node', 'unix']);
    const here = doing(repo, { importUrl: 'http://localhost:5173/src/task.js', key: 'dev', needs: ['unix'] });
    await until(() => 'error' in here.settled);
    expect(here.settled.error?.message).toBe('This work needs a device with unix, and its code is only on this machine, so no other device can run it.');
    expect(entryOf(queue, 'dev')).toBeUndefined();
  });

  it('the sentence names every need, and a pool: need as one particular device', async () => {
    const { repo } = page('no own queue');
    const cases: [string[], string][] = [
      [['unix', 'gpu'], 'a device with unix and gpu'],
      [['unix', 'gpu', 'ollama'], 'a device with unix, gpu and ollama'],
      [['pool:P'], 'one particular device'],
      [['pool:P', 'unix'], 'one particular device, with unix'],
    ];
    for (const [needs, words] of cases) {
      const work = doing(repo, { needs, key: needs.join() });
      await until(() => 'error' in work.settled);
      expect(work.settled.error?.message).toBe(`This work needs ${words}, and you have no task queue for such a device to serve.`);
    }
  });

  it('needs that are not a list of labels are refused before anything is asked or called', async () => {
    const { repo, queue } = await asked();
    for (const needs of ['unix', [''], [7]]) {
      const work = doing(repo, { needs: needs as never, key: 'bad' });
      await until(() => 'error' in work.settled);
      expect(work.settled.error?.message, JSON.stringify(needs)).toMatch(/list of labels/);
    }
    expect(entryOf(queue, 'bad')).toBeUndefined();
    expect(g.__work).not.toHaveBeenCalled();
  });

  describe('near', () => {
    afterEach(() => {
      delete g.localStorage;
    });
    const storage = (items: Record<string, string>) => ({ getItem: (key: string) => items[key] ?? null });

    it("is this browser's pool id, read from where the pool's host keeps it, when the page can read one", async () => {
      g.localStorage = storage({ [POOL_ID_KEY]: 'this-browser' });
      const { queue } = await asked();
      expect(entryOf(queue, 'k').near).toBe('this-browser');
    });

    it('is left out where the page has no pool id, or cannot read localStorage', async () => {
      g.localStorage = storage({});
      const first = await asked();
      expect('near' in entryOf(first.queue, 'k')).toBe(false);
      // the Repo reads localStorage too; only the pool's key is refused, as blocked site data would refuse the page's own read
      g.localStorage = {
        getItem: (key: string) => {
          if (key === POOL_ID_KEY) {
            throw new Error('blocked');
          }
          return null;
        },
      };
      const second = await asked();
      expect('near' in entryOf(second.queue, 'k')).toBe(false);
    });

    it('is the one the tool gave, when it gave one', async () => {
      g.localStorage = storage({ [POOL_ID_KEY]: 'this-browser' });
      const { repo, queue } = page('an own queue');
      g.__work = vi.fn();
      doing(repo, { near: 'that-machine' });
      await settle();
      serving(queue!);
      await until(() => !!entryOf(queue!, 'k'));
      expect(entryOf(queue!, 'k').near).toBe('that-machine');
    });
  });

  it('asked: asking twice under one key while its task is wanted is one task, and both resolve with its result', async () => {
    const { repo, queue, settled } = await asked();
    const again = doing(repo);
    await settle();
    const tasks = Object.values(repo.handles).filter((h: any) => h.doc()?.key === 'k');
    expect(tasks).toHaveLength(1);
    const task = tasks[0] as DocHandle<Task>;
    expect(entryOf(queue, 'k').taskUrl).toBe(task.url);
    take(task, 'r');
    complete(task, 'r', 'succeeded', { result: 'once' });
    await until(() => 'value' in settled && 'value' in again.settled);
    expect([settled.value, again.settled.value]).toEqual(['once', 'once']);
  });
});

// A page's view of the person's own work

/** A page whose person has got as far as `setup` towards a queue of their own. */
type Setup = 'no account' | 'no storage' | 'storage without own' | 'an own queue';
function person(setup: Setup) {
  const g = globalThis as any;
  const repo = newRepo();
  let account: DocHandle<any> | undefined;
  let storage: DocHandle<any> | undefined;
  let queue: DocHandle<Queue> | undefined;
  if (setup !== 'no account') {
    account = repo.create<any>({});
    g.accountDocHandle = account;
    if (setup !== 'no storage') {
      storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
      account.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage!.url }));
      if (setup === 'an own queue') {
        queue = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
        storage.change((doc) => {
          doc.own = queue!.url;
          doc[queue!.url] = true;
        });
      }
    }
  }
  return { repo, account, storage, queue };
}

/** What ownQueue and the frame's tool-storage provider write the first time, done by hand on an account with no storage yet. */
function makeOwnQueue(repo: Repo, account: DocHandle<any>) {
  const storage = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
  account.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
  const queue = repo.create<Queue>({ '@patchwork': { type: QUEUE_DATATYPE_ID }, title: OWN_QUEUE_TITLE, jobs: {} } as any);
  storage.change((doc) => {
    doc.own = queue.url;
    doc[queue.url] = true;
  });
  return { storage, queue };
}

/** A watchWork that keeps every view it is given. */
function followWork(repo: Repo, key = 'k') {
  const views: TaskView[] = [];
  const stop = watchWork(repo, key, (view) => views.push(view));
  return {
    views,
    stop,
    get last() {
      return views.at(-1)!;
    },
    states: () => views.map((view) => view.state),
  };
}

const MISSING: TaskView = { key: 'k', state: 'missing', taskUrl: null, importUrl: null, input: undefined, progress: null, logs: [], result: undefined, error: null, runs: [] };

describe('watchWork', () => {
  afterEach(() => {
    delete (globalThis as any).accountDocHandle;
  });

  for (const setup of ['no account', 'no storage', 'storage without own'] as const) {
    it(`with ${setup}: reports missing, once, without the clock moving`, async () => {
      const { repo } = person(setup);
      const started = Date.now();
      const work = followWork(repo);
      await settle();
      expect(work.views).toEqual([MISSING]);
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
      expect(work.views).toHaveLength(1);
      work.stop();
    });
  }

  it("is watch's own view of the key on the own queue: missing when the key names nothing there", async () => {
    const { repo, queue } = person('an own queue');
    const work = followWork(repo);
    const watched = follow(repo, queue!.url, 'k');
    await settle();
    expect(work.views).toEqual([MISSING]);
    expect(work.last).toStrictEqual(watched.last);
    work.stop();
    watched.stop();
  });

  it('with a waiting task under the key: waiting, with its task', async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k');
    const work = followWork(repo);
    await settle();
    expect(work.last).toMatchObject({ state: 'waiting', taskUrl: task.url, importUrl: CODE });
    work.stop();
  });

  it("with a running task, heard: running, with its pool's progress, and stalled when its beats stop for the lapse", async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [opened('r')]);
    const work = followWork(repo);
    await settle();
    beat(task, 'r', { progress: 'half' });
    await settle();
    expect(work.last).toMatchObject({ state: 'running', progress: 'half', taskUrl: task.url });
    await vi.advanceTimersByTimeAsync(LAPSE_MS + 1);
    expect(work.last.state).toBe('stalled');
    work.stop();
  });

  it('with a task that has ended: its ending and result', async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [closed('r', 'succeeded')]);
    const work = followWork(repo);
    await settle();
    expect(work.last).toMatchObject({ state: 'succeeded', result: 'done', taskUrl: task.url });
    work.stop();
  });

  it('the person makes their queue while it is watched (storage and all): it reports the work then asked of it', async () => {
    const { repo, account } = person('no storage');
    const work = followWork(repo);
    await settle();
    expect(work.states()).toEqual(['missing']);
    const { queue } = makeOwnQueue(repo, account!);
    await settle();
    expect(work.states()).toEqual(['missing']);
    const { taskUrl } = await ask(repo, queue.url, { importUrl: CODE, key: 'k' });
    await settle();
    expect(work.last).toMatchObject({ state: 'waiting', taskUrl });
    work.stop();
  });

  it('own moving to another queue: what the first said is withdrawn at once, the second is followed, and nothing of the first is heard or held after', async () => {
    const { repo, storage, queue: first } = person('an own queue');
    const firstTask = listed(repo, first!, 'k', [opened('r1')]);
    const second = repo.create<Queue>({ title: 'q2', jobs: {} });
    const secondTask = listed(repo, second, 'k', [opened('r2')]);
    await settle();
    const held = () => [first!.listenerCount('change'), firstTask.listenerCount('change'), firstTask.listenerCount('ephemeral-message')];
    const before = held();
    const work = followWork(repo);
    await settle();
    beat(firstTask, 'r1', { progress: 'first' });
    await settle();
    expect(work.last).toMatchObject({ state: 'running', taskUrl: firstTask.url, progress: 'first' });
    expect(held()).toEqual(before.map((n) => n + 1));

    storage!.change((doc) => (doc.own = second.url));
    expect(work.last).toEqual(MISSING);
    await settle();
    beat(secondTask, 'r2', { progress: 'second' });
    await settle();
    expect(work.last).toMatchObject({ state: 'running', taskUrl: secondTask.url, progress: 'second' });
    expect(held()).toEqual(before);

    const seen = work.views.length;
    beat(firstTask, 'r1', { progress: 'stale' });
    complete(firstTask, 'r1', 'failed');
    first!.change((doc) => delistTask(doc, 'k', firstTask.url));
    await settle();
    expect(work.views.length).toBe(seen);
    work.stop();
  });

  it("the queue's document never arriving: missing at the lapse, once; it goes on looking, and reports the work when the document comes", async () => {
    const { repo, storage } = person('storage without own');
    // the queue and its task exist on another machine only
    const elsewhere = newRepo();
    const queue = elsewhere.create<Queue>({ title: 'q', jobs: {} });
    const task = listed(elsewhere, queue, 'k');
    storage!.change((doc) => (doc.own = queue.url));
    await settle();
    const work = followWork(repo);
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(work.views).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(work.views).toEqual([MISSING]);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(work.views).toEqual([MISSING]);
    replicate(repo, task);
    replicate(repo, queue);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(work.last).toMatchObject({ state: 'waiting', taskUrl: task.url });
    expect(work.states().filter((state) => state === 'missing')).toHaveLength(1);
    expect(work.states()[0]).toBe('missing');
    work.stop();
  });

  it('a storage document that cannot be had is the same: missing at the lapse, once, and followed when it comes', async () => {
    const { repo, account } = person('no storage');
    const elsewhere = newRepo();
    const storage = elsewhere.create<any>({});
    const queue = elsewhere.create<Queue>({ title: 'q', jobs: {} });
    const task = listed(elsewhere, queue, 'k');
    storage.change((doc) => (doc.own = queue.url));
    account!.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
    const work = followWork(repo);
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(work.views).toEqual([]);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(work.views).toEqual([MISSING]);
    for (const handle of [storage, queue, task] as DocHandle<any>[]) replicate(repo, handle);
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(work.states()[0]).toBe('missing');
    expect(new Set(work.states().slice(1))).toEqual(new Set(['waiting']));
    work.stop();
  });

  it('stop() leaves no timer and no listener: on the account, the storage, the queue, the task, or the local channel', async () => {
    const { repo, account, storage, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [opened('r')]);
    await settle();
    const timers = vi.getTimerCount();
    const count = () => [account!.listenerCount('change'), storage!.listenerCount('change'), queue!.listenerCount('change'), task.listenerCount('change'), task.listenerCount('ephemeral-message')];
    const before = count();
    const work = followWork(repo);
    await settle();
    expect(count()).toEqual(before.map((n) => n + 1));
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    work.stop();
    expect(count()).toEqual(before);
    expect(vi.getTimerCount()).toBe(timers);
    const seen = work.views.length;
    const local = new BroadcastChannel(LOCAL_MESSAGES_CHANNEL);
    local.postMessage({ channel: task.url, message: { type: 'task progress', run: 'r', progress: 'after', from: 'neighbour', seq: 1 } });
    beat(task, 'r');
    complete(task, 'r', 'succeeded');
    storage!.change((doc) => delete doc.own);
    await delivered(() => false);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(work.views.length).toBe(seen);
    local.close();
  });

  it('stop() while it is still looking (a queue that has not come, its lapse and its retry pending) leaves no timer either, and reports nothing after', async () => {
    const { repo, storage } = person('storage without own');
    storage!.change((doc) => (doc.own = generateAutomergeUrl()));
    await settle();
    const timers = vi.getTimerCount();
    const work = followWork(repo);
    await settle();
    expect(vi.getTimerCount()).toBeGreaterThan(timers);
    work.stop();
    expect(vi.getTimerCount()).toBe(timers);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(work.views).toEqual([]);
  });

  it('own set later on a storage it already has: missing at once, then the work under the key on the queue it names', async () => {
    const { repo, storage } = person('storage without own');
    const queue = repo.create<Queue>({ title: 'q', jobs: {} });
    const task = listed(repo, queue, 'k');
    const work = followWork(repo);
    await settle();
    expect(work.views).toEqual([MISSING]);
    storage!.change((doc) => (doc.own = queue.url));
    await settle();
    // watch says the same view again once it has the task's document as well as the queue's
    expect([...new Set(work.states())]).toEqual(['missing', 'waiting']);
    expect(work.last.taskUrl).toBe(task.url);
    work.stop();
  });

  it('own taken out of the storage: missing at once, the queue is let go, and its work is heard no more', async () => {
    const { repo, storage, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [opened('r')]);
    await settle();
    const held = () => [queue!.listenerCount('change'), task.listenerCount('change'), task.listenerCount('ephemeral-message')];
    const before = held();
    const work = followWork(repo);
    await settle();
    expect(work.last).toMatchObject({ state: 'running', taskUrl: task.url });
    storage!.change((doc) => delete doc.own);
    expect(work.last).toEqual(MISSING);
    expect(held()).toEqual(before);
    const seen = work.views.length;
    beat(task, 'r', { progress: 'after' });
    complete(task, 'r', 'succeeded');
    await settle();
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    expect(work.views).toHaveLength(seen);
    work.stop();
  });

  it("the account's storage pointer moving to another storage: what the first said is withdrawn at once, the other's queue is followed, and nothing is held on the first", async () => {
    const { repo, account, storage: first, queue: firstQueue } = person('an own queue');
    const firstTask = listed(repo, firstQueue!, 'k');
    const second = repo.create<any>({ '@patchwork': { type: 'patchwork:tool-storage' } });
    const secondQueue = repo.create<Queue>({ title: 'q2', jobs: {} });
    const secondTask = listed(repo, secondQueue, 'k', [opened('r2')]);
    second.change((doc) => (doc.own = secondQueue.url));
    await settle();
    const held = () => [first!.listenerCount('change'), firstQueue!.listenerCount('change'), firstTask.listenerCount('change')];
    const before = held();
    const work = followWork(repo);
    await settle();
    expect(work.last).toMatchObject({ state: 'waiting', taskUrl: firstTask.url });
    account!.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: second.url }));
    expect(work.last).toEqual(MISSING);
    expect(held()).toEqual(before);
    await settle();
    beat(secondTask, 'r2', { progress: 'second' });
    await settle();
    expect(work.last).toMatchObject({ state: 'running', taskUrl: secondTask.url, progress: 'second' });
    const seen = work.views.length;
    first!.change((doc) => (doc.own = generateAutomergeUrl()));
    firstQueue!.change((doc) => delistTask(doc, 'k', firstTask.url));
    await settle();
    expect(work.views).toHaveLength(seen);
    work.stop();
  });

  it("own moving before the first queue's document has come: the queue it names now is followed, and the first arriving later is not heard, nor is a lapse reported", async () => {
    const { repo, storage } = person('storage without own');
    const elsewhere = newRepo();
    const away = elsewhere.create<Queue>({ title: 'away', jobs: {} });
    const awayTask = listed(elsewhere, away, 'k', [closed('r', 'failed')]);
    storage!.change((doc) => (doc.own = away.url));
    const here = repo.create<Queue>({ title: 'here', jobs: {} });
    const hereTask = listed(repo, here, 'k');
    await settle();
    const work = followWork(repo);
    await settle();
    expect(work.views).toEqual([]);
    storage!.change((doc) => (doc.own = here.url));
    await settle();
    expect(work.views.length).toBeGreaterThan(0);
    for (const view of work.views) expect(view).toMatchObject({ state: 'waiting', taskUrl: hereTask.url });
    const seen = work.views.length;
    replicate(repo, awayTask);
    replicate(repo, away);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    await settle();
    expect(work.views).toHaveLength(seen);
    work.stop();
  });

  it('stop() before the storage document has come: no timer, nothing reported, and its coming later changes nothing', async () => {
    const { repo, account } = person('no storage');
    const elsewhere = newRepo();
    const storage = elsewhere.create<any>({});
    account!.change((doc) => (doc.toolStorage = { [TASKS_STORAGE_ID]: storage.url }));
    await settle();
    const timers = vi.getTimerCount();
    const accountHeld = account!.listenerCount('change');
    const work = followWork(repo);
    await settle();
    work.stop();
    expect(vi.getTimerCount()).toBe(timers);
    expect(account!.listenerCount('change')).toBe(accountHeld);
    const control = replicate(repo, elsewhere.create<any>({}));
    const arrived = replicate(repo, storage);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 2);
    await settle();
    expect(work.views).toEqual([]);
    expect(arrived.listenerCount('change')).toBe(control.listenerCount('change'));
  });
});

describe('stopWork', () => {
  afterEach(() => {
    delete (globalThis as any).accountDocHandle;
  });

  for (const setup of ['no account', 'no storage', 'storage without own'] as const) {
    it(`with ${setup}: false, and writes nothing`, async () => {
      const { repo } = person(setup);
      await settle();
      const before = Object.values(repo.handles).map((h: any) => [h.url, A.getHeads(h.doc())]);
      expect(await stopWork(repo, 'k')).toBe(false);
      expect(Object.values(repo.handles).map((h: any) => [h.url, A.getHeads(h.doc())])).toEqual(before);
    });
  }

  it('with nothing under the key on the own queue: false', async () => {
    const { repo } = person('an own queue');
    expect(await stopWork(repo, 'k')).toBe(false);
  });

  it('a waiting task: true; a stop is its only record, and its entry is gone', async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k');
    expect(await stopWork(repo, 'k')).toBe(true);
    expect(task.doc()!.runs).toEqual([expect.objectContaining({ status: 'cancelled' })]);
    expect(entryOf(queue!, 'k')).toBeUndefined();
  });

  it('a running task: true; the stop follows its open run, and its entry is gone', async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [opened('r')]);
    expect(await stopWork(repo, 'k')).toBe(true);
    expect(task.doc()!.runs).toEqual([opened('r'), expect.objectContaining({ status: 'cancelled' })]);
    expect(entryOf(queue!, 'k')).toBeUndefined();
  });

  it('a task that has ended: false, and its runs are as they were', async () => {
    const { repo, queue } = person('an own queue');
    const task = listed(repo, queue!, 'k', [closed('r', 'succeeded')]);
    expect(await stopWork(repo, 'k')).toBe(false);
    expect(task.doc()!.runs).toEqual([closed('r', 'succeeded')]);
  });
});
