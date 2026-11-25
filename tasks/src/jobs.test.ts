import { describe, expect, it } from 'vitest';
import type { TaskQueueDoc } from './datatype';
import {
  canRun,
  eachWaiting,
  finishJob,
  forgetJob,
  hasWaitingWork,
  HEARD_WITHIN_MS,
  isHeard,
  listJob,
  lostRuns,
  lostTooOften,
  MAX_LOST,
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
const run = (
  status: 'succeeded' | 'failed' | 'cancelled' | 'lost',
  result?: unknown,
  name?: string,
) => ({
  workerUrl: url('w'),
  status,
  result,
  startTimeMillis: 0,
  endTimeMillis: 1,
  ...(name ? { run: name } : {}),
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

describe("a task's state, from its own doc and whether its run is heard", () => {
  const current = { workerUrl: url('w'), assignment: 'a', startTimeMillis: 0 };
  const outcomes = [undefined, 'succeeded', 'failed', 'cancelled'] as const;

  // Every combination of: how it ended for good (not yet, or one of the three
  // ways), cancelled or not, a run started or not, and that run heard or not.
  // How it ended is the last word; before that, a run counts only while heard.
  for (const outcome of outcomes)
    for (const cancelled of [false, true])
      for (const started of [false, true])
        for (const heard of [false, true]) {
          const running = started && heard;
          const want =
            outcome ??
            (cancelled ? (running ? 'stopping' : 'cancelled') : running ? 'running' : 'waiting');
          it(`ended=${outcome} cancelled=${cancelled} started=${started} heard=${heard}: ${want}`, () => {
            expect(
              taskState(
                {
                  current: started ? current : null,
                  ...(cancelled ? { cancelled: true as const } : {}),
                  ...(outcome ? { outcome } : {}),
                },
                heard,
              ),
            ).toBe(want);
          });
        }

  it('a task that is not here yet is waiting', () => {
    expect(taskState(undefined)).toBe('waiting');
  });

  it('a run is heard for a while after its last word, or after it was first seen', () => {
    expect(isHeard(1_000, 0, 1_000 + HEARD_WITHIN_MS - 1)).toBe(true);
    expect(isHeard(1_000, 0, 1_000 + HEARD_WITHIN_MS)).toBe(false);
    // never heard: given from when the reader first saw it
    expect(isHeard(null, 5_000, 5_000 + HEARD_WITHIN_MS - 1)).toBe(true);
    expect(isHeard(null, 5_000, 5_000 + HEARD_WITHIN_MS)).toBe(false);
    // once heard, when it was first seen no longer matters
    expect(isHeard(9_000, 0, 9_001)).toBe(true);
  });
});

describe('runs that never said how they ended', () => {
  const lost = (...names: string[]) => names.map((name) => run('lost', undefined, name));

  it('are the ones recorded lost with no record of their own', () => {
    expect(lostRuns({ runs: [] })).toEqual([]);
    expect(lostRuns({ runs: lost('a', 'b') })).toEqual(['a', 'b']);
    // given up for lost, then finished after all: it was only slow to be heard
    expect(lostRuns({ runs: [...lost('a'), run('succeeded', 1, 'a')] })).toEqual([]);
    expect(lostRuns({ runs: [run('failed', undefined, 'a'), ...lost('a', 'b')] })).toEqual(['b']);
  });

  it('count once each, however many later runs said so', () => {
    expect(lostRuns({ runs: lost('a', 'a', 'a') })).toEqual(['a']);
  });

  it('end the task when there have been as many as a task may lose, and not before', () => {
    const names = Array.from({ length: MAX_LOST }, (_, i) => `r${i}`);
    expect(lostTooOften({ runs: lost(...names.slice(1)) })).toBe(false);
    expect(lostTooOften({ runs: lost(...names) })).toBe(true);
    // runs that reported, however they went, are not losses
    expect(
      lostTooOften({ runs: [...lost(...names.slice(1)), run('failed', undefined, 'x'), run('cancelled', undefined, 'y')] }),
    ).toBe(false);
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
    let heard = hear({ assignment: null, progress: null, logs: [], at: null }, progress('a1', { progress: 0.2 }), 10);
    heard = hear(heard, progress('a1', { logs: [{ timestampMillis: 1, message: 'one' }] }), 20);
    heard = hear(heard, progress('a1', { progress: 0.6, logs: [{ timestampMillis: 2, message: 'two' }] }), 30);
    expect(heard).toEqual({
      assignment: 'a1',
      progress: 0.6,
      logs: [
        { timestampMillis: 1, message: 'one' },
        { timestampMillis: 2, message: 'two' },
      ],
      at: 30,
    });
    const view = viewOf('k', listed, task({ current }), heard);
    expect(view.state).toBe('running');
    expect(view.progress).toBe(0.6);
    expect(view.logs.map((l) => l.message)).toEqual(['one', 'two']);
  });

  it('news of another run starts again from nothing', () => {
    let heard = hear({ assignment: null, progress: null, logs: [], at: null }, progress('a1', { progress: 0.9, logs: [{ timestampMillis: 1, message: 'old' }] }), 10);
    heard = hear(heard, progress('a2', { logs: [{ timestampMillis: 2, message: 'new' }] }), 20);
    expect(heard).toEqual({ assignment: 'a2', progress: null, logs: [{ timestampMillis: 2, message: 'new' }], at: 20 });

    // a word with nothing in it but that the run is going on keeps what was heard
    heard = hear(heard, progress('a2', {}), 30);
    expect(heard).toEqual({ assignment: 'a2', progress: null, logs: [{ timestampMillis: 2, message: 'new' }], at: 30 });
  });

  it("what was heard of an earlier run isn't shown for the one going on", () => {
    const heard = { assignment: 'a0', progress: 0.9, logs: [{ timestampMillis: 1, message: 'old' }], at: 1 };
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

  it('a run that is no longer heard is not running: the task waits to be handed out again', () => {
    const view = viewOf('k', listed, task({ current }), undefined, false);
    expect(view.state).toBe('waiting');
  });

  it('a task that failed by losing its runs says so', () => {
    const runs = ['a', 'b', 'c'].map((name) => run('lost', undefined, name));
    const view = viewOf('k', listed, task({ runs, outcome: 'failed' }));
    expect(view).toMatchObject({ state: 'failed', result: undefined });
    expect(view.error).toMatch(/went away/);
  });
});
