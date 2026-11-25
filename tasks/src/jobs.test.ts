import { describe, expect, it } from 'vitest';
import type { TaskQueueDoc } from './datatype';
import {
  canRun,
  eachWaiting,
  endedBy,
  failedTooOften,
  finishJob,
  forgetJob,
  hasWaitingWork,
  listJob,
  MAX_TRIES,
  takingOf,
  taskResult,
  taskState,
  waitingWork,
} from './jobs';
import { hear, viewOf } from './job-client';

const queue = (over: Partial<TaskQueueDoc> = {}): TaskQueueDoc => ({
  activeRouter: null,
  pending: [],
  done: [],
  doneSet: {},
  ...over,
});
const url = (name: string) => `automerge:${name}` as any;
const run = (status: 'succeeded' | 'failed' | 'cancelled', result?: unknown) => ({
  workerUrl: url('w'),
  status,
  result,
  startTimeMillis: 0,
  endTimeMillis: 1,
});
const Q = url('queue');
const PKG = 'automerge:2KYqboWHPS5rvWsheoLnHgFvE7ou';

describe('what a queue has waiting', () => {
  it('is its pending tasks in order, then its unfinished keyed ones, oldest ask first', () => {
    const q = queue({
      pending: [url('t1'), url('t2')],
      jobs: {
        z: { taskUrl: url('jz'), askedAt: 1, package: PKG },
        a: { taskUrl: url('ja'), askedAt: 2 },
        done: { taskUrl: url('jd'), askedAt: 0, done: true },
      },
    });
    expect(waitingWork(q)).toEqual([
      { taskUrl: url('t1'), key: null, package: undefined },
      { taskUrl: url('t2'), key: null, package: undefined },
      { taskUrl: url('jz'), key: 'z', package: PKG },
      { taskUrl: url('ja'), key: 'a', package: null },
    ]);
    expect([...eachWaiting(q)]).toEqual(waitingWork(q));
  });

  it('breaks a tie in when they were asked by key, the same way for everyone', () => {
    const q = queue({
      jobs: { b: { taskUrl: url('jb'), askedAt: 5 }, a: { taskUrl: url('ja'), askedAt: 5 } },
    });
    expect(waitingWork(q).map((w) => w.key)).toEqual(['a', 'b']);
  });

  it('passes over what is listed under a key but is no entry', () => {
    const q = queue({ jobs: { x: { askedAt: 1 } as any, y: 'nonsense' as any, z: null as any } });
    expect(waitingWork(q)).toEqual([]);
    expect(hasWaitingWork(q)).toBe(false);
  });

  it('a queue from before keys has only its pending tasks', () => {
    expect(waitingWork(queue({ pending: [url('t')] }))).toEqual([
      { taskUrl: url('t'), key: null, package: undefined },
    ]);
    expect(hasWaitingWork(queue())).toBe(false);
    expect(hasWaitingWork(queue({ pending: [url('t')] }))).toBe(true);
  });

  it('has something waiting exactly when a keyed task is unfinished', () => {
    const q = queue({ jobs: { a: { taskUrl: url('ja'), askedAt: 1 } } });
    expect(hasWaitingWork(q)).toBe(true);
    finishJob(q, 'a', url('ja'));
    expect(hasWaitingWork(q)).toBe(false);
  });
});

describe('what a worker takes', () => {
  const pendingTask = { key: null, package: undefined };
  const keyedInPackage = { key: 'k', package: PKG };
  const keyedData = { key: 'k', package: null };

  it('a worker from before any of this takes whatever is on the pending list, and nothing by key', () => {
    const old = takingOf({}, Q);
    expect(old).toEqual({ keyed: false, acceptance: 'any' });
    expect(takingOf(undefined, Q)).toEqual(old);
    expect(canRun(old, pendingTask)).toBe(true);
    expect(canRun(old, keyedInPackage)).toBe(false);
    expect(canRun(old, keyedData)).toBe(false);
  });

  it('a worker that takes any code from a queue takes all of its work', () => {
    const any = takingOf({ accepts: { [Q]: 'any' } }, Q);
    expect(canRun(any, pendingTask)).toBe(true);
    expect(canRun(any, keyedInPackage)).toBe(true);
    expect(canRun(any, keyedData)).toBe(true);
  });

  it("a worker that takes only some packages takes their keyed tasks, and no task it can't tell the code of", () => {
    const some = takingOf({ accepts: { [Q]: [PKG] } }, Q);
    expect(canRun(some, keyedInPackage)).toBe(true);
    expect(canRun(some, { key: 'k', package: 'automerge:another111111111111' })).toBe(false);
    expect(canRun(some, keyedData)).toBe(false);
    expect(canRun(some, pendingTask)).toBe(false);
  });

  it('a worker takes nothing from a queue it says nothing about', () => {
    const other = takingOf({ accepts: { [url('other-queue')]: 'any' } }, Q);
    expect(other).toEqual({ keyed: true, acceptance: undefined });
    expect(canRun(other, pendingTask)).toBe(false);
    expect(canRun(other, keyedInPackage)).toBe(false);
    expect(canRun(takingOf({ accepts: {} }, Q), keyedData)).toBe(false);
  });
});

describe('listing, finishing and forgetting', () => {
  it('the first ask under a key is the task; a second changes nothing', () => {
    const q = queue();
    listJob(q, 'k', { taskUrl: url('first'), askedAt: 1, package: PKG });
    listJob(q, 'k', { taskUrl: url('second'), askedAt: 2, package: null });
    expect(q.jobs).toEqual({ k: { taskUrl: url('first'), askedAt: 1, package: PKG } });
  });

  it('an ask replaces what is under the key when that is no entry', () => {
    const q = queue({ jobs: { k: 'nonsense' as any } });
    listJob(q, 'k', { taskUrl: url('t'), askedAt: 1 });
    expect(q.jobs!.k).toEqual({ taskUrl: url('t'), askedAt: 1, package: null });
  });

  it('the task that ran is the one the key names, whichever it had come to name', () => {
    // two asks at once: the key names the one the merge kept, but a router had
    // handed out the other before it knew
    const q = queue();
    listJob(q, 'k', { taskUrl: url('kept'), askedAt: 2 });
    finishJob(q, 'k', url('ran'));
    expect(q.jobs!.k).toEqual({ taskUrl: url('ran'), askedAt: 2, package: null, done: true });
    expect(hasWaitingWork(q)).toBe(false); // so the other is never handed out
  });

  it('a run that finishes after its key was finished or forgotten changes nothing', () => {
    const q = queue();
    listJob(q, 'k', { taskUrl: url('kept'), askedAt: 1 });
    finishJob(q, 'k', url('kept'));
    finishJob(q, 'k', url('ran'));
    expect(q.jobs!.k.taskUrl).toBe(url('kept'));

    forgetJob(q, 'k');
    finishJob(q, 'k', url('ran'));
    expect(q.jobs).toEqual({});
    finishJob(queue(), 'k', url('ran')); // a queue with no keys at all
  });

  it('a forgotten key can be asked for again', () => {
    const q = queue();
    listJob(q, 'k', { taskUrl: url('one'), askedAt: 1 });
    finishJob(q, 'k', url('one'));
    forgetJob(q, 'k');
    listJob(q, 'k', { taskUrl: url('two'), askedAt: 2 });
    expect(q.jobs!.k).toEqual({ taskUrl: url('two'), askedAt: 2, package: null });
  });
});

describe("a task's state, from its own doc", () => {
  const current = { workerUrl: url('w'), assignment: 'a', startTimeMillis: 0 };
  const outcomes = [undefined, 'succeeded', 'failed', 'cancelled'] as const;

  // every combination of: cancelled or not, a run going on or not, and how it
  // ended for good (not yet, or one of the three ways)
  for (const cancelled of [false, true])
    for (const running of [false, true])
      for (const outcome of outcomes) {
        const want = cancelled
          ? running
            ? 'stopping'
            : 'cancelled'
          : (outcome ?? (running ? 'running' : 'waiting'));
        it(`cancelled=${cancelled} running=${running} ended=${outcome}: ${want}`, () => {
          expect(
            taskState({
              current: running ? current : null,
              ...(cancelled ? { cancelled: true as const } : {}),
              ...(outcome ? { outcome } : {}),
            }),
          ).toBe(want);
        });
      }

  it('a task that is not here yet is waiting', () => {
    expect(taskState(undefined)).toBe('waiting');
  });
});

describe('how a run ends a task', () => {
  const failed = (n: number) => Array.from({ length: n }, () => run('failed'));

  it('a success or a cancel ends it; a failure only once there have been enough', () => {
    expect(endedBy('succeeded', { runs: [run('succeeded')] })).toBe('succeeded');
    expect(endedBy('cancelled', { runs: [run('cancelled')] })).toBe('cancelled');
    expect(endedBy('failed', { runs: failed(MAX_TRIES - 1) })).toBeNull();
    expect(endedBy('failed', { runs: failed(MAX_TRIES) })).toBe('failed');
  });

  it('only failed runs count towards too many', () => {
    expect(failedTooOften({ runs: [...failed(MAX_TRIES - 1), run('cancelled')] })).toBe(false);
    expect(failedTooOften({ runs: failed(MAX_TRIES) })).toBe(true);
  });

  it("a task's result is its last successful run's", () => {
    expect(taskResult({ runs: [run('failed'), run('succeeded', 1), run('succeeded', 2)] })).toBe(2);
    expect(taskResult({ runs: [run('failed')] })).toBeUndefined();
    expect(taskResult(undefined)).toBeUndefined();
  });
});

describe('what someone following a keyed task sees', () => {
  const task = (over = {}) => ({ input: 1, importUrl: 'data:x', runs: [] as any[], ...over });
  const listed = queue({ jobs: { k: { taskUrl: url('t'), askedAt: 1 } } });
  const current = { workerUrl: url('w'), assignment: 'a1', startTimeMillis: 0 };
  const progress = (assignment: string, extra: object) =>
    ({ type: 'task progress', from: 'w', seq: 0, assignment, ...extra }) as any;

  it('nothing under the key is missing, whatever else is known', () => {
    expect(viewOf('other', listed, task()).state).toBe('missing');
    expect(viewOf('k', undefined, undefined).state).toBe('missing');
  });

  it('what is heard of a run adds up: the latest progress, every log line', () => {
    let heard = hear({ assignment: null, progress: null, logs: [] }, progress('a1', { progress: 0.2 }));
    heard = hear(heard, progress('a1', { logs: [{ timestampMillis: 1, message: 'one' }] }));
    heard = hear(heard, progress('a1', { progress: 0.6, logs: [{ timestampMillis: 2, message: 'two' }] }));
    expect(heard).toEqual({
      assignment: 'a1',
      progress: 0.6,
      logs: [
        { timestampMillis: 1, message: 'one' },
        { timestampMillis: 2, message: 'two' },
      ],
    });
    const view = viewOf('k', listed, task({ current }), heard);
    expect(view.state).toBe('running');
    expect(view.progress).toBe(0.6);
    expect(view.logs.map((l) => l.message)).toEqual(['one', 'two']);
  });

  it('news of another run starts again from nothing', () => {
    let heard = hear({ assignment: null, progress: null, logs: [] }, progress('a1', { progress: 0.9, logs: [{ timestampMillis: 1, message: 'old' }] }));
    heard = hear(heard, progress('a2', { logs: [{ timestampMillis: 2, message: 'new' }] }));
    expect(heard).toEqual({ assignment: 'a2', progress: null, logs: [{ timestampMillis: 2, message: 'new' }] });
  });

  it("what was heard of an earlier run isn't shown for the one going on", () => {
    const heard = { assignment: 'a0', progress: 0.9, logs: [{ timestampMillis: 1, message: 'old' }] };
    const view = viewOf('k', listed, task({ current }), heard);
    expect(view.progress).toBeNull();
    expect(view.logs).toEqual([]);
  });

  it('once it is over, its log is its last run\'s, and its result or its error is there', () => {
    const logs = [{ timestampMillis: 1, message: 'kept' }];
    const ok = viewOf('k', listed, task({ runs: [{ ...run('succeeded', 42), logs }], outcome: 'succeeded' }));
    expect(ok).toMatchObject({ state: 'succeeded', result: 42, error: null, logs });
    const bad = viewOf('k', listed, task({ runs: [{ ...run('failed'), logs: [{ timestampMillis: 1, message: 'boom' }] }], outcome: 'failed' }));
    expect(bad).toMatchObject({ state: 'failed', result: undefined, error: 'boom' });
  });
});
