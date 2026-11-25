// @vitest-environment node
//
// The asker's side, task-client.js, on real automerge-repo documents. Where
// two askers or an asker and a pool act at once, each has a Repo of its own
// and the documents are merged by hand, in the order a test names. Time is
// vitest's fake clock, so a lapse passes when a test says. A pool's word on a
// task's or a queue's channel is delivered as the sync server would deliver
// it, as an `ephemeral-message` on the handle.

import * as A from '@automerge/automerge';
import { initSubduction, Repo, type AutomergeUrl, type DocHandle } from '@automerge/automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_MESSAGES_CHANNEL,
  ask,
  cancel,
  inSamePackage,
  listen,
  packageOf,
  parseAutomergeImport,
  run,
  send,
  served,
  stamper,
  watch,
  type Serving,
  type TaskView,
} from './task-client.js';
import { BEAT_MS, LAPSE_MS, MAX_LOG_LINES, claimRun, delistTask, endRun, listTask, type Queue, type RunStatus, type Task } from './task-rules.js';

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

/** Lists a task as an asker that wrote the documents itself would, and returns its handle. */
function listed(repo: Repo, queue: DocHandle<Queue>, key: string, runs: Task['runs'] = [], flagged = false) {
  const task = repo.create<Task>({ importUrl: CODE, input: null, key, runs, ...(flagged ? { cancelled: true } : {}) } as Task);
  queue.change((doc) => listTask(doc, key, { taskUrl: task.url, askedAt: Date.now(), package: null }));
  return task;
}

const closed = (id: string, status: RunStatus) => ({ id, pool: 'P', start: 0, end: 1, status, result: status === 'succeeded' ? 'done' : null, logs: [] });
const opened = (id: string) => ({ id, pool: 'P', start: 0 });

// Asking

describe('ask', () => {
  it('lists a new task: exactly {importUrl, input, key, runs: []}, the input copied as JSON, and the entry {taskUrl, askedAt, package}', async () => {
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
    expect(queue.doc()!.jobs).toEqual({ k: { taskUrl: got.taskUrl, askedAt, package: PKG } });
    input.n = 2;
    expect((task.doc()!.input as { n: number }).n).toBe(1);

    // with no input, null; code in no package, a null package
    const bare = await ask(repo, queue.url, { importUrl: CODE, key: 'bare' });
    expect((await repo.find<Task>(bare.taskUrl as AutomergeUrl)).doc()!.input).toBeNull();
    expect(entryOf(queue, 'bare').package).toBeNull();
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

  it('asking again under a key whose task has not ended returns the same task and makes none', async () => {
    const cases: [string, Task['runs'], boolean][] = [
      ['waiting', [], false],
      ['an open run', [opened('r')], false],
      ['two lost runs', [closed('a', 'lost'), closed('b', 'lost')], false],
      ['a yielded run', [closed('a', 'yielded')], false],
      ['an open run, flagged', [opened('r')], true],
      ['three lost runs and an open run', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost'), opened('r')], false],
    ];
    for (const [name, runs, flagged] of cases) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs, flagged);
      const create = vi.spyOn(repo, 'create');
      const again = await ask(repo, queue.url, { importUrl: CODE, key: 'k' });
      expect(again, name).toEqual({ key: 'k', taskUrl: task.url });
      expect(create, name).not.toHaveBeenCalled();
      expect(entryOf(queue, 'k').taskUrl, name).toBe(task.url);
    }
  });

  it('asking under a key whose task has ended lists a new task over it: ended by a run, by three lost runs, or by the flag with no open run', async () => {
    const cases: [string, Task['runs'], boolean][] = [
      ['succeeded', [closed('a', 'succeeded')], false],
      ['failed', [closed('a', 'failed')], false],
      ['cancelled by a run', [closed('a', 'cancelled')], false],
      ['a later run succeeded after one yielded', [closed('a', 'yielded'), closed('b', 'succeeded')], false],
      ['three lost', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost')], false],
      ['flagged, no runs', [], true],
      ['flagged, a yielded run', [closed('a', 'yielded')], true],
    ];
    for (const [name, runs, flagged] of cases) {
      const { repo, queue } = world();
      const old = listed(repo, queue, 'k', runs, flagged);
      const before = structuredClone(old.doc());
      const again = await ask(repo, queue.url, { importUrl: CODE, input: 2, key: 'k' });
      expect(again.taskUrl, name).not.toBe(old.url);
      expect(entryOf(queue, 'k').taskUrl, name).toBe(again.taskUrl);
      expect((await repo.find<Task>(again.taskUrl as AutomergeUrl)).doc()!.input, name).toBe(2);
      expect(old.doc(), name).toEqual(before);
    }
  });

  it('a key whose task has an open run is never replaced, even when the task is flagged, or has lost three runs', async () => {
    for (const runs of [[opened('r')], [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost'), opened('r')]]) {
      for (const flagged of [false, true]) {
        const { repo, queue } = world();
        const task = listed(repo, queue, 'k', runs, flagged);
        expect((await ask(repo, queue.url, { importUrl: CODE, key: 'k' })).taskUrl).toBe(task.url);
      }
    }
  });

  it('without a key, each ask gets a key and a task of its own', async () => {
    const { repo, queue } = world();
    const one = await ask(repo, queue.url, { importUrl: CODE, input: 1 });
    const two = await ask(repo, queue.url, { importUrl: CODE, input: 1 });
    expect(one.key).not.toBe(two.key);
    expect(one.taskUrl).not.toBe(two.taskUrl);
    expect(Object.keys(queue.doc()!.jobs).sort()).toEqual([one.key, two.key].sort());
  });

  it("rejects '__proto__' as a key, and lists nothing", async () => {
    const { repo, queue } = world();
    await expect(ask(repo, queue.url, { importUrl: CODE, key: '__proto__' })).rejects.toThrow(/__proto__/);
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
  it('flags the task and deletes its entry, and says so', async () => {
    for (const runs of [[], [opened('r')]]) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs);
      expect(await cancel(repo, queue.url, 'k')).toBe(true);
      expect(task.doc()!.cancelled).toBe(true);
      expect(entryOf(queue, 'k')).toBeUndefined();
      expect(task.doc()!.runs).toEqual(runs);
    }
  });

  it('is false for a key that names nothing, and writes nothing', async () => {
    const { repo, queue } = world();
    const other = listed(repo, queue, 'other');
    const heads = queue.heads();
    for (const key of ['k', 'constructor', '__proto__']) {
      expect(await cancel(repo, queue.url, key), key).toBe(false);
    }
    expect(queue.heads()).toEqual(heads);
    expect(other.doc()!.cancelled).toBeUndefined();
  });

  it('a task already ended by a run is not flagged; its stale entry is removed, and the answer is false', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', [closed('a', status)]);
      expect(await cancel(repo, queue.url, 'k'), status).toBe(false);
      expect(task.doc()!.cancelled, status).toBeUndefined();
      expect(entryOf(queue, 'k'), status).toBeUndefined();
    }
  });

  it('cancelling twice: true, then false; the flag stays', async () => {
    const { repo, queue } = world();
    const task = listed(repo, queue, 'k');
    expect(await cancel(repo, queue.url, 'k')).toBe(true);
    expect(await cancel(repo, queue.url, 'k')).toBe(false);
    expect(task.doc()!.cancelled).toBe(true);
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
    expect(writes).toBe(1);
    await vi.advanceTimersByTimeAsync(LAPSE_MS * 3);
    expect(writes).toBe(1);
    expect(watcher.states()).not.toContain('missing');
    watcher.stop();
  });

  const never: [string, Task['runs'], boolean, boolean][] = [
    ['it has ended by a run', [closed('a', 'succeeded')], false, false],
    ['it is flagged', [], true, false],
    ['it is flagged, with an open run nobody hears', [opened('r')], true, false],
    ['it lost three runs', [closed('a', 'lost'), closed('b', 'lost'), closed('c', 'lost')], false, false],
    ['an open run of it is heard', [opened('r')], false, true],
  ];
  for (const [why, runs, flagged, beating] of never) {
    it(`never lists the task again when ${why}`, async () => {
      const { repo, queue } = world();
      const task = listed(repo, queue, 'k', runs, flagged);
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
    expect(reports.at(-1)).toEqual([{ pool: 'B', name: 'pool B', slots: 2, busy: 1 }]);
    serving(queue, 'A');
    expect(reports.at(-1)?.map((it) => it.pool)).toEqual(['A', 'B']);
    stop();
  });

  it('drops a pool one lapse after its last message, not before', async () => {
    const { repo, queue } = world();
    const { reports, stop } = hear(repo, queue);
    await settle();
    serving(queue, 'A');
    await vi.advanceTimersByTimeAsync(BEAT_MS);
    serving(queue, 'A');
    await vi.advanceTimersByTimeAsync(LAPSE_MS - 1);
    expect(reports.at(-1)?.map((it) => it.pool)).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(1 + LAPSE_MS / 4);
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
