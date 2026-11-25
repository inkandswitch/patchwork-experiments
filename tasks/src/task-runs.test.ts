// @vitest-environment node
//
// task-runs.js on real automerge-repo documents: asking for a run and
// stopping it, one look at its task, who serves a queue and a queue as people
// see it, the status a person sees for a run (every run status against every
// task state, and the records a stop and a run leave when they cross), the
// writes to a run document, and the run's side: the guard, finding a run
// document that arrives late, and a run's code from its start to each way it
// ends. A pool's word on a queue's channel is delivered as the sync server
// delivers it, as an `ephemeral-message` on the handle.

import * as A from '@automerge/automerge';
import { initSubduction, Repo, type DocHandle } from '@automerge/automerge-repo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANCELLED_BEFORE,
  CANCELLING,
  EARLIER_OPEN,
  MACHINE_STOPPED,
  NOT_LISTED,
  NOT_RESTARTED,
  RUN_ENDED,
  STOPPED_WITHOUT_IT,
  STOP_REASONS,
  UNHEARD,
  aheadOf,
  askRun,
  cancelRun,
  codeUrl,
  earlier,
  findWhenThere,
  hearServing,
  isQueue,
  isRunEnded,
  lookAtTask,
  makeRunTask,
  markFailed,
  markInterrupted,
  markStopped,
  queueCounts,
  servedBy,
  setPackageUrl,
  shownRun,
} from './task-runs.js';
import { BEAT_MS, allHeard, taskState, type Queue, type Run, type Task } from './task-rules.js';

await initSubduction();

const PACKAGE = 'automerge:2mv3rTpAcL5aUfYiQqb1RnQkQi3P';
const CODE = 'daemon/run-task.mjs';
const TYPE = 'test-run';

const newRepo = () => new Repo({ network: [] } as any);

type RunDoc = {
  '@patchwork': { type: string };
  title: string;
  server: string;
  task: string | null;
  status: string;
  error: string | null;
  finishedAt: number | null;
  stages: { id: string; label: string; status: string; endedAt: number | null; note: string | null }[];
  volume?: { status: string };
};

/** A run document as a package makes one, asked of `server`. */
const newRunDoc = (server: string): RunDoc => ({
  '@patchwork': { type: TYPE },
  title: 'a run',
  server,
  task: null,
  status: 'queued',
  error: null,
  finishedAt: null,
  stages: ['Prepare', 'Mesh', 'Solve'].map((label, i) => ({ id: `s${i}`, label, status: 'pending', endedAt: null, note: null })),
});

/** A run document in the middle of its second stage. */
function going(): RunDoc {
  const run = newRunDoc('automerge:q');
  run.status = 'meshing';
  run.stages[0].status = 'done';
  run.stages[1].status = 'running';
  return run;
}

function world() {
  const repo = newRepo();
  const queue = repo.create<Queue>({ title: 'q', jobs: {} });
  const run = repo.create<RunDoc>(newRunDoc(queue.url));
  return { repo, queue, run };
}

/** Records, as task-rules.js writes them. */
const opened = (id: string, pool = 'P'): Run => ({ id, pool, start: 0 });
const closed = (id: string, status: Run['status'], pool = 'P'): Run => ({ id, pool, start: 0, end: 1, status, result: null, logs: [] });
const stop = (id = 'stop'): Run => ({ id, start: 0, end: 0, status: 'cancelled' });

beforeEach(() => {
  setPackageUrl(PACKAGE);
});
afterEach(() => {
  vi.useRealTimers();
});

// A page's side

describe("the run's code", () => {
  it("is named by the package's url and the path within it, given a package when this module isn't loaded from one", () => {
    expect(codeUrl(CODE)).toBe(`/${encodeURIComponent(PACKAGE)}/${CODE}`);
  });
  it("can't be named by a copy not loaded from its package and not told it: a sentence saying so", () => {
    setPackageUrl(null);
    expect(() => codeUrl(CODE)).toThrow(/wasn't loaded from its package/);
  });
});

describe('askRun', () => {
  it("lists a task keyed by the run document's url, with { run } for its input and the package's code; the run document keeps the task's url, in a change with the options given", async () => {
    const { repo, queue, run } = world();
    const taskUrl = await askRun(repo, queue.url, run, CODE, { message: 'asked by Ann' });
    expect(Object.keys(queue.doc().jobs)).toEqual([run.url]);
    expect(queue.doc().jobs[run.url]).toMatchObject({ taskUrl, package: PACKAGE });
    expect((await repo.find<Task>(taskUrl as any)).doc()).toEqual({ importUrl: codeUrl(CODE), input: { run: run.url }, key: run.url, runs: [] });
    expect(run.doc().task).toBe(taskUrl);
    expect(A.getHistory(run.doc()).at(-1)?.change.message).toBe('asked by Ann');
  });
  it('asking twice for one run while its task is wanted is asking once', async () => {
    const { repo, queue, run } = world();
    const first = await askRun(repo, queue.url, run, CODE);
    expect(await askRun(repo, queue.url, run, CODE)).toBe(first);
    expect(Object.keys(queue.doc().jobs)).toEqual([run.url]);
  });
  it("asks nothing when the code can't be named", async () => {
    const { repo, queue, run } = world();
    setPackageUrl(null);
    await expect(askRun(repo, queue.url, run, CODE)).rejects.toThrow(/wasn't loaded from its package/);
    expect(queue.doc().jobs).toEqual({});
    expect(run.doc().task).toBeNull();
  });
});

describe('cancelRun', () => {
  it("a waiting run: a stop in its task, the queue no longer lists it, and the run document isn't written", async () => {
    const { repo, queue, run } = world();
    const taskUrl = await askRun(repo, queue.url, run, CODE);
    const heads = run.heads();
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    const task = (await repo.find<Task>(taskUrl as any)).doc();
    expect(task.runs).toEqual([{ id: expect.any(String), start: expect.any(Number), end: expect.any(Number), status: 'cancelled' }]);
    expect(queue.doc().jobs).toEqual({});
    expect(run.heads()).toEqual(heads);
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: 'cancelled', error: null, runs: task.runs });
  });
  it('a running run: the stop follows its run, and one look reads stopping', async () => {
    const { repo, queue, run } = world();
    const task = await repo.find<Task>((await askRun(repo, queue.url, run, CODE)) as any);
    task.change((doc) => void doc.runs.push(opened('r1')));
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    expect(task.doc().runs.map((it) => it.status ?? 'open')).toEqual(['open', 'cancelled']);
    expect((await lookAtTask(repo, run.doc()))?.state).toBe('stopping');
  });
  it('cancelling twice records one stop; the second is false', async () => {
    const { repo, queue, run } = world();
    const taskUrl = await askRun(repo, queue.url, run, CODE);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(true);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect((await repo.find<Task>(taskUrl as any)).doc().runs).toHaveLength(1);
  });
  it('a run whose task has ended gets no stop, and its stale entry goes', async () => {
    const { repo, queue, run } = world();
    const task = await repo.find<Task>((await askRun(repo, queue.url, run, CODE)) as any);
    task.change((doc) => void doc.runs.push(closed('r1', 'succeeded')));
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect(task.doc().runs).toHaveLength(1);
    expect(queue.doc().jobs).toEqual({});
  });
  it('a run its queue no longer lists, or one that names no queue: false', async () => {
    const { repo, queue, run } = world();
    await askRun(repo, queue.url, run, CODE);
    queue.change((doc) => void delete doc.jobs[run.url]);
    expect(await cancelRun(repo, run.doc(), run.url)).toBe(false);
    expect(await cancelRun(repo, { ...run.doc(), server: '' }, run.url)).toBe(false);
    expect(await cancelRun(repo, null, run.url)).toBe(false);
  });
});

describe('lookAtTask', () => {
  it('one look, every open run counted as going on, with the task\'s runs; null while the run names no task', async () => {
    const { repo, queue, run } = world();
    expect(await lookAtTask(repo, run.doc())).toBeNull();
    const task = await repo.find<Task>((await askRun(repo, queue.url, run, CODE)) as any);
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: 'waiting', error: null, runs: [] });
    task.change((doc) => void doc.runs.push(opened('r1')));
    expect(await lookAtTask(repo, run.doc())).toEqual({ state: 'running', error: null, runs: [opened('r1')] });
    task.change((doc) => void (doc.runs[0] = { ...closed('r1', 'failed'), logs: [{ timestampMillis: 2, message: 'why' }] }));
    expect(await lookAtTask(repo, run.doc())).toMatchObject({ state: 'failed', error: 'why' });
  });
  it("null for a task that can't be found here, or a document that isn't a task", async () => {
    const { repo, queue, run } = world();
    const elsewhere = newRepo().create({ importUrl: 'x', runs: [] }).url;
    expect(await lookAtTask(repo, { ...run.doc(), task: elsewhere })).toBeNull();
    expect(await lookAtTask(repo, { ...run.doc(), task: queue.url })).toBeNull();
  });
});

describe('hearServing', () => {
  let seq = 0;
  const serving = (queue: DocHandle<Queue>, more: Record<string, unknown> = {}) =>
    queue.emit('ephemeral-message', {
      handle: queue,
      senderId: 'pool' as any,
      message: { type: 'serving', pool: 'pool-1', name: 'Mac', slots: 2, busy: 0, from: 'a pool', seq: seq++, ...more },
    });

  it('resolves as soon as a machine says it serves, and stops listening', async () => {
    const { repo, queue } = world();
    const before = queue.listenerCount('ephemeral-message');
    const heard = hearServing(repo, queue.url, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    serving(queue);
    expect(await heard).toEqual([{ pool: 'pool-1', name: 'Mac', slots: 2, busy: 0 }]);
    expect(queue.listenerCount('ephemeral-message')).toBe(before);
  });
  it('nobody: [] once the wait is over (by default a little over one beat), and stops listening', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { repo, queue } = world();
    const before = queue.listenerCount('ephemeral-message');
    let pools: unknown = null;
    void hearServing(repo, queue.url).then((it) => (pools = it));
    await vi.advanceTimersByTimeAsync(BEAT_MS + 499);
    expect(pools).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(pools).toEqual([]);
    expect(queue.listenerCount('ephemeral-message')).toBe(before);
  });
});

describe('a queue as people see it', () => {
  const jobs = (...keys: string[]) => ({ jobs: Object.fromEntries(keys.map((key, i) => [key, { taskUrl: `automerge:t${key}`, askedAt: i, package: null }])) });
  it('running is what its machines say they are busy with, never more than it lists', () => {
    expect(queueCounts(jobs('a', 'b', 'c'), [{ busy: 1, slots: 2 }])).toEqual({ listed: 3, running: 1, waiting: 2, slots: 2 });
    expect(queueCounts(jobs('a'), [{ busy: 3, slots: 4 }])).toEqual({ listed: 1, running: 1, waiting: 0, slots: 4 });
    expect(queueCounts(jobs(), [])).toEqual({ listed: 0, running: 0, waiting: 0, slots: 0 });
    expect(queueCounts(undefined, [])).toEqual({ listed: 0, running: 0, waiting: 0, slots: 0 });
  });
  it('how many were asked for before a run, or null when it is not listed', () => {
    expect(aheadOf(jobs('a', 'b', 'c'), 'c')).toBe(2);
    expect(aheadOf(jobs('a', 'b', 'c'), 'a')).toBe(0);
    expect(aheadOf(jobs('a'), 'z')).toBeNull();
    expect(aheadOf(undefined, 'z')).toBeNull();
  });
  it('who serves it: names, and how many at once; nobody is null', () => {
    expect(servedBy([])).toBeNull();
    expect(servedBy([{ name: 'Mac', slots: 1 }])).toBe('Mac');
    expect(servedBy([{ name: '', slots: 3 }, { name: 'Box', slots: 1 }])).toBe('a machine (3 at once), Box');
  });
  it('a task queue is a document with jobs', () => {
    expect(isQueue({ jobs: {} })).toBe(true);
    expect(isQueue({ '@patchwork': { type: TYPE } })).toBe(false);
    expect(isQueue({ jobs: 'x' })).toBe(false);
    expect(isQueue(null)).toBe(false);
  });
});

// Every run status against every state a task can be read in (and none known
// yet), for a task a machine took once, one no machine took, and one with
// only a stop. Written out whole: what a person sees for each.
describe('shownRun', () => {
  // `queued`, a working status of a package's own, and the endings
  const STATUSES = ['queued', 'solving', ...RUN_ENDED];
  const TASK_STATES = [null, 'missing', 'waiting', 'running', 'stalled', 'stopping', 'succeeded', 'failed', 'cancelled'];
  const doc = (status: string) => ({ status, error: status === 'failed' ? "the run's own error" : null });
  const task = (state: string | null, runs: Run[]) => (state === null ? null : { state, error: state === 'failed' ? "the task's error" : null, runs });
  const as = (status: string, error: string | null = null, note: string | null = null) => ({ status, error, note });
  const ended = {
    done: TASK_STATES.map(() => as('done')),
    failed: TASK_STATES.map(() => as('failed', "the run's own error")),
    cancelled: TASK_STATES.map(() => as('cancelled')),
  };
  const row = (s: string, { waiting, cancelled }: { waiting: object; cancelled: object }) => [
    as(s),
    as(s),
    waiting,
    as(s),
    as(s, null, UNHEARD),
    as(s, null, CANCELLING),
    as(s),
    as('failed', "the task's error"),
    cancelled,
  ];
  const takenRow = (s: string) => row(s, { waiting: as(s, null, STOPPED_WITHOUT_IT), cancelled: as('cancelled') });
  const neverRow = (s: string) => row(s, { waiting: as(s), cancelled: as('cancelled', null, CANCELLED_BEFORE) });
  const TABLES: Record<string, { runs: Run[]; table: Record<string, object[]> }> = {
    'a machine took it once': { runs: [closed('r1', 'lost')], table: { queued: takenRow('queued'), solving: takenRow('solving'), ...ended } },
    'no machine took it': { runs: [], table: { queued: neverRow('queued'), solving: neverRow('solving'), ...ended } },
    'only a stop': { runs: [stop()], table: { queued: neverRow('queued'), solving: neverRow('solving'), ...ended } },
  };
  it('the tables cover every status', () => {
    for (const { table } of Object.values(TABLES)) expect(Object.keys(table)).toEqual(STATUSES);
  });
  for (const [taken, { runs, table }] of Object.entries(TABLES)) {
    for (const status of STATUSES) {
      for (const [i, state] of TASK_STATES.entries()) {
        it(`a ${status} run document, its task ${state ?? 'not known yet'}, ${taken}`, () => {
          expect(shownRun(doc(status), task(state, runs))).toEqual(table[status][i]);
        });
      }
    }
  }
  it('a failed task with no reason says it failed; a run document not here yet reads queued; runs that are not a list are none', () => {
    expect(shownRun(doc('solving'), { state: 'failed' })).toEqual(as('failed', 'it failed'));
    expect(shownRun(undefined, null)).toEqual(as('queued'));
    expect(shownRun(doc('queued'), { state: 'cancelled', runs: 'x' })).toEqual(as('cancelled', null, CANCELLED_BEFORE));
  });

  // What one look reads (task-rules.js v3: a stop is read last), and what is shown, when a stop and a run cross.
  const look = (runs: Run[]) => ({ state: taskState({ runs }, allHeard), error: null, runs });
  it('a run that succeeded before a stop: succeeded, and the run document says (its own ending is on its way)', () => {
    expect(look([closed('r1', 'succeeded'), stop()]).state).toBe('succeeded');
    expect(shownRun(doc('solving'), look([closed('r1', 'succeeded'), stop()]))).toEqual(as('solving'));
    expect(shownRun(doc('done'), look([closed('r1', 'succeeded'), stop()]))).toEqual(as('done'));
  });
  it('a take that crossed a stop and then succeeded: the stop does not take its ending', () => {
    expect(look([stop(), closed('r1', 'succeeded')]).state).toBe('succeeded');
    expect(shownRun(doc('done'), look([stop(), closed('r1', 'succeeded')]))).toEqual(as('done'));
  });
  it('a run still open before a stop: cancelling while it is heard; cancelled once it is not, and it started', () => {
    expect(shownRun(doc('solving'), look([opened('r1'), stop()]))).toEqual(as('solving', null, CANCELLING));
    const unheard = [opened('r1'), stop()];
    expect(shownRun(doc('solving'), { state: taskState({ runs: unheard }, () => false), error: null, runs: unheard })).toEqual(as('cancelled'));
  });
  it('a take that crossed a stop and was then stopped, or a lost run and then a stop: cancelled, not "before it started"', () => {
    expect(shownRun(doc('queued'), look([stop(), closed('r1', 'cancelled')]))).toEqual(as('cancelled'));
    expect(shownRun(doc('queued'), look([closed('r1', 'lost'), stop()]))).toEqual(as('cancelled'));
  });
});

// Writes to a run document

describe('markStopped', () => {
  it('cancelled: the run says cancelled, and its running stage says it was cancelled', () => {
    const run = going();
    markStopped(run, 'cancelled', 9);
    expect([run.status, run.error, run.finishedAt]).toEqual(['cancelled', null, 9]);
    expect(run.stages.map((it) => it.status)).toEqual(['done', 'failed', 'pending']);
    expect(run.stages[1]).toMatchObject({ endedAt: 9, note: 'cancelled' });
  });
  it('stopping: failed because its machine stopped, and its running stage says stopped', () => {
    const run = going();
    markStopped(run, 'stopping', 9);
    expect([run.status, run.error, run.finishedAt]).toEqual(['failed', MACHINE_STOPPED, 9]);
    expect(run.stages[1]).toMatchObject({ status: 'failed', endedAt: 9, note: 'stopped' });
  });
  it('yielded: nothing is written', () => {
    const run = going();
    const before = structuredClone(run);
    markStopped(run, 'yielded', 9);
    expect(run).toEqual(before);
  });
  it('a run document that says how it ended keeps it, whatever the reason', () => {
    for (const end of RUN_ENDED) {
      for (const reason of STOP_REASONS) {
        const run = { ...going(), status: end, error: end === 'failed' ? 'its own' : null, finishedAt: 5 };
        const before = structuredClone(run);
        markStopped(run, reason, 9);
        expect(run).toEqual(before);
      }
    }
  });
  it('a run document with no stages is written all the same', () => {
    const run: { status?: string; error?: string | null; finishedAt?: number | null } = { status: 'queued' };
    markStopped(run, 'cancelled', 9);
    expect(run).toEqual({ status: 'cancelled', error: null, finishedAt: 9 });
  });
});

describe('markInterrupted and markFailed', () => {
  it('interrupted: failed, not started again, and says so; its running stage failed', () => {
    const run = going();
    markInterrupted(run, 9);
    expect([run.status, run.error, run.finishedAt]).toEqual(['failed', NOT_RESTARTED, 9]);
    expect(run.stages[1]).toMatchObject({ status: 'failed', endedAt: 9 });
  });
  it('a queued run document (its machine stopped before it wrote anything) says the same', () => {
    const run = newRunDoc('automerge:q');
    markInterrupted(run, 9);
    expect([run.status, run.error]).toEqual(['failed', NOT_RESTARTED]);
  });
  it('one that says how it ended keeps it: the machine-stopped sentence stays', () => {
    const run = going();
    markStopped(run, 'stopping', 5);
    markInterrupted(run, 9);
    expect([run.status, run.error, run.finishedAt]).toEqual(['failed', MACHINE_STOPPED, 5]);
  });
  it('failed: with the sentence given, unless it says how it ended', () => {
    const run = going();
    markFailed(run, 'no solver here', 9);
    expect([run.status, run.error, run.finishedAt, run.stages[1].status]).toEqual(['failed', 'no solver here', 9, 'failed']);
    const done = { ...going(), status: 'done' };
    markFailed(done, 'late', 9);
    expect([done.status, done.error]).toEqual(['done', null]);
  });
  it('the endings', () => {
    expect(RUN_ENDED.map(isRunEnded)).toEqual([true, true, true]);
    expect(['queued', 'solving', undefined, null].map(isRunEnded)).toEqual([false, false, false, false]);
  });
});

// The run's side

describe('earlier: what came before a run in its task', () => {
  const cases: [string, Run[], ReturnType<typeof earlier>][] = [
    ["the run's own entry first", [opened('me')], 'none'],
    ['a stop before it (a stop is not a run)', [stop(), opened('me')], 'none'],
    ['a stop after it', [opened('me'), stop()], 'none'],
    ['runs after it', [opened('me'), opened('r2', 'Q'), closed('r3', 'failed')], 'none'],
    ['an earlier run that was lost', [closed('r0', 'lost'), opened('me')], 'closed'],
    ['an earlier run of another pool that yielded', [closed('r0', 'yielded', 'Q'), opened('me')], 'closed'],
    ['a stop, then a run, then it: the run counts', [stop(), closed('r0', 'lost'), opened('me')], 'closed'],
    ['an earlier run of another pool still open', [opened('r0', 'Q'), opened('me')], 'open'],
    ['an earlier run open and another closed: open wins', [closed('r0', 'lost'), opened('r1', 'Q'), opened('me')], 'open'],
  ];
  for (const [what, runs, expected] of cases) {
    it(`${what}: ${expected}`, () => expect(earlier({ runs }, 'me')).toBe(expected));
  }
  it('not in the list, or no list at all: unlisted', () => {
    expect(earlier({ runs: [opened('r0')] }, 'me')).toBe('unlisted');
    expect(earlier({ runs: 'x' as any }, 'me')).toBe('unlisted');
    expect(earlier(undefined, 'me')).toBe('unlisted');
    expect(earlier({ runs: [null as any, opened('me')] }, 'me')).toBe('none');
  });
});

describe('findWhenThere', () => {
  const arrivesAfter = (n: number) => {
    let asked = 0;
    return { find: async () => (++asked <= n ? Promise.reject(new Error('unavailable')) : { doc: () => ({ ok: true }) }), asked: () => asked };
  };
  const noSleep = { sleep: async () => {} };
  it('returns at once when the document is there', async () => {
    const repo = arrivesAfter(0);
    expect((await findWhenThere(repo, 'u', noSleep)).doc()).toEqual({ ok: true });
    expect(repo.asked()).toBe(1);
  });
  it('asks again until the document arrives', async () => {
    const repo = arrivesAfter(3);
    expect((await findWhenThere(repo, 'u', noSleep)).doc()).toEqual({ ok: true });
    expect(repo.asked()).toBe(4);
  });
  it('gives up after its tries with the last error; a handle with no document is not there either', async () => {
    const repo = arrivesAfter(99);
    await expect(findWhenThere(repo, 'u', { ...noSleep, tries: 3 })).rejects.toThrow('unavailable');
    expect(repo.asked()).toBe(3);
    await expect(findWhenThere({ find: async () => ({ doc: () => undefined }) }, 'u', { ...noSleep, tries: 2 })).rejects.toThrow('u came back empty');
  });
  it('backs off, doubling, at most 8 s', async () => {
    const waits: number[] = [];
    await findWhenThere(arrivesAfter(99), 'u', { tries: 7, wait: 500, sleep: async (ms) => void waits.push(ms) }).catch(() => {});
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
});

describe('makeRunTask', () => {
  const FACTS = { cores: 4, where: 'here' };
  let repo: Repo;
  let run: DocHandle<RunDoc>;
  let calls: any[];
  let awake: number;
  let released: number;

  beforeEach(() => {
    repo = newRepo();
    run = repo.create<RunDoc>(newRunDoc('automerge:q'));
    calls = [];
    awake = 0;
    released = 0;
  });

  /** A task with these records, and a context for the run named `me`. */
  function context(records: Run[], me: string, signal = new AbortController().signal) {
    const task = repo.create<Task>({ importUrl: `/x/${CODE}`, input: { run: run.url }, key: run.url, runs: records });
    const said = { progress: [] as any[], logs: [] as string[] };
    const ctx = { repo, taskUrl: task.url, run: me, signal, log: (m: string) => void said.logs.push(m), progress: (p: unknown) => void said.progress.push(p) };
    return { ctx, said };
  }

  const findNow = (r: any, url: string) => findWhenThere(r, url, { tries: 3, sleep: async () => {} });

  function task(runJob: (job: any) => Promise<string>, more: Partial<Parameters<typeof makeRunTask>[0]> = {}) {
    return makeRunTask({
      type: TYPE,
      what: 'a test run',
      machine: () => FACTS,
      runJob: async (job) => {
        calls.push(job);
        return runJob(job);
      },
      progressOf: (doc) => ({ status: doc?.status ?? null, stage: doc?.stages?.find((it: any) => it.status === 'running')?.label ?? null }),
      awake: () => {
        awake++;
        return () => void released++;
      },
      say: () => {},
      find: findNow,
      ...more,
    });
  }

  const finishes = async ({ handle }: any) => {
    handle.change((doc: RunDoc) => void (doc.status = 'done'));
    return 'done';
  };

  describe('the guard', () => {
    it("the run's own entry first: it runs, handed the repo, the run document, the machine's facts and the signal", async () => {
      const { ctx } = context([opened('r1')], 'r1');
      expect(await task(finishes)({ run: run.url }, ctx)).toEqual({ status: 'done' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ repo, facts: FACTS, signal: ctx.signal });
      expect(calls[0].handle.url).toBe(run.url);
      expect([awake, released]).toEqual([1, 1]);
    });
    it('a stop before it, or after it, is not a run: it runs (its pool stops it for the stop)', async () => {
      for (const records of [[stop('s0'), opened('r1')], [opened('r1'), stop('s1')]]) {
        run.change((doc) => void (doc.status = 'queued'));
        const { ctx } = context(records, 'r1');
        expect(await task(finishes)({ run: run.url }, ctx)).toEqual({ status: 'done' });
      }
      expect(calls).toHaveLength(2);
    });
    it('an earlier run that was lost, or one of another pool that yielded: never runs; the run document says it was interrupted, and the task fails', async () => {
      for (const before of [closed('r0', 'lost'), closed('r0', 'yielded', 'Q'), stop('s0')]) {
        run.change((doc) => {
          doc.status = 'solving';
          doc.error = null;
          doc.finishedAt = null;
          doc.stages[2].status = 'running';
        });
        const records = before.pool ? [before, opened('r1')] : [before, closed('r0', 'lost'), opened('r1')];
        const { ctx, said } = context(records, 'r1');
        await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
        expect([run.doc().status, run.doc().error, run.doc().stages[2].status]).toEqual(['failed', NOT_RESTARTED, 'failed']);
        expect(said.logs).toEqual(['interrupted before: not started again']);
      }
      expect(calls).toHaveLength(0);
      expect(awake).toBe(0);
    });
    it('an earlier run still open (another pool on the queue): never runs, and the run document is not touched', async () => {
      run.change((doc) => void (doc.status = 'solving'));
      const heads = run.heads();
      const { ctx } = context([opened('r0', 'Q'), opened('r1')], 'r1');
      await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(EARLIER_OPEN);
      expect(run.heads()).toEqual(heads);
      expect(calls).toHaveLength(0);
    });
    it('a run document that says its machine stopped keeps saying so', async () => {
      run.change((doc) => markStopped(doc, 'stopping', 5));
      const { ctx } = context([closed('r0', 'lost'), opened('r1')], 'r1');
      await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
      expect([run.doc().status, run.doc().error]).toEqual(['failed', MACHINE_STOPPED]);
    });
    it("what an interrupted run writes is the package's when it says more", async () => {
      const { ctx } = context([closed('r0', 'lost'), opened('r1')], 'r1');
      await expect(task(finishes, { interrupted: (doc, now) => void ((doc.error = 'its own words'), (doc.finishedAt = now)) })({ run: run.url }, ctx)).rejects.toThrow(NOT_RESTARTED);
      expect(run.doc().error).toBe('its own words');
    });
    it("a run that can't find itself in its task doesn't start, and writes nothing", async () => {
      const heads = run.heads();
      const { ctx } = context([opened('r0')], 'r9');
      await expect(task(finishes)({ run: run.url }, ctx)).rejects.toThrow(NOT_LISTED);
      expect(run.heads()).toEqual(heads);
      expect(calls).toHaveLength(0);
    });
  });

  describe('how a run ends', () => {
    it("a run that ends otherwise than done fails the task once, with the run document's error", async () => {
      const { ctx } = context([opened('r1')], 'r1');
      const failing = async ({ handle }: any) => {
        handle.change((doc: RunDoc) => {
          doc.status = 'failed';
          doc.error = 'the solver diverged';
        });
        return 'failed';
      };
      await expect(task(failing)({ run: run.url }, ctx)).rejects.toThrow('the solver diverged');
      expect(calls).toHaveLength(1);
    });
    for (const reason of STOP_REASONS) {
      it(`told to stop (${reason}): lets go of the machine at once, throws the runner's error, and writes nothing of its own`, async () => {
        const abort = new AbortController();
        const { ctx } = context([opened('r1')], 'r1', abort.signal);
        let releasedAtAbort: number | null = null;
        const killed = ({ signal }: any) =>
          new Promise<string>((_, reject) =>
            signal.addEventListener('abort', () => {
              releasedAtAbort = released;
              reject(new Error('the solver stopped (SIGTERM)'));
            }),
          );
        const going = task(killed)({ run: run.url }, ctx);
        await new Promise((resolve) => setTimeout(resolve, 10));
        abort.abort(reason);
        await expect(going).rejects.toThrow('the solver stopped');
        expect([awake, releasedAtAbort]).toEqual([1, 1]);
        expect(run.doc().status).toBe('queued');
      });
    }
    it('told to stop, a runner that returns: it throws anyway, naming the reason', async () => {
      const abort = new AbortController();
      const { ctx } = context([opened('r1')], 'r1', abort.signal);
      const going = task(({ signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve('done'))))({ run: run.url }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 10));
      abort.abort('cancelled');
      await expect(going).rejects.toThrow('stopped (cancelled)');
    });
    it("told to stop, a runner stuck in a wait that watches no signal: it throws after stopWait, with the runner's stop written", async () => {
      const abort = new AbortController();
      const { ctx } = context([opened('r1')], 'r1', abort.signal);
      const stuck = ({ handle, signal }: any) => {
        signal.addEventListener('abort', () => handle.change((doc: RunDoc) => markStopped(doc, signal.reason, 9)));
        return new Promise<string>(() => {});
      };
      const going = task(stuck, { stopWait: 20 })({ run: run.url }, ctx);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const t0 = Date.now();
      abort.abort('cancelled');
      await expect(going).rejects.toThrow('stopped (cancelled)');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
      expect(run.doc().status).toBe('cancelled');
    });
    it('a signal already aborted when the runner starts: stopWait starts at once', async () => {
      const abort = new AbortController();
      abort.abort('stopping');
      const { ctx } = context([opened('r1')], 'r1', abort.signal);
      await expect(task(() => new Promise<string>(() => {}), { stopWait: 5 })({ run: run.url }, ctx)).rejects.toThrow('stopped (stopping)');
    });
    it('a runner that ends by itself is never cut short, and an abort after the end starts no wait', async () => {
      const abort = new AbortController();
      const { ctx } = context([opened('r1')], 'r1', abort.signal);
      const slow = async (job: any) => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return finishes(job);
      };
      expect(await task(slow, { stopWait: 1 })({ run: run.url }, ctx)).toEqual({ status: 'done' });
      abort.abort('cancelled');
      expect(released).toBe(1);
    });
    it('a runner that throws fails the run document as well as the task', async () => {
      const { ctx } = context([opened('r1')], 'r1');
      const throws = async () => {
        throw new Error("the run's setup can't be read");
      };
      await expect(task(throws)({ run: run.url }, ctx)).rejects.toThrow("the run's setup can't be read");
      expect([run.doc().status, run.doc().error]).toEqual(['failed', "the run's setup can't be read"]);
      expect(released).toBe(1);
    });
    it("a machine that can't run it: the run document and the task fail with its sentence, and nothing runs", async () => {
      const { ctx } = context([opened('r1')], 'r1');
      const why = "The machine serving this queue (here) can't run it: no solver found.";
      const machine = () => {
        throw new Error(why);
      };
      await expect(task(finishes, { machine })({ run: run.url }, ctx)).rejects.toThrow(why);
      expect([run.doc().status, run.doc().error]).toEqual(['failed', why]);
      expect([calls.length, awake]).toEqual([0, 0]);
    });
    it("refuses an input that names no run, a run that can't be found, and a document of another type", async () => {
      const { ctx } = context([opened('r1')], 'r1');
      await expect(task(finishes)({}, ctx)).rejects.toThrow(/names no run: its input is \{ run: <a test run's url> \}/);
      await expect(task(finishes)(null, ctx)).rejects.toThrow(/names no run/);
      await expect(task(finishes, { find: async () => Promise.reject(new Error('unavailable')) })({ run: run.url }, ctx)).rejects.toThrow(/unavailable/);
      const other = repo.create({ '@patchwork': { type: 'another-run' } });
      await expect(task(finishes)({ run: other.url }, ctx)).rejects.toThrow(/isn't a test run/);
      expect(calls).toHaveLength(0);
    });
    it('waits for a run document that reaches the machine after its task', async () => {
      const { ctx } = context([opened('r1')], 'r1');
      let asked = 0;
      const late = { find: (url: string) => (url === run.url && ++asked < 3 ? Promise.reject(new Error(`Document ${url} is unavailable`)) : repo.find(url as any)) };
      const out = await task(finishes)({ run: run.url }, { ...ctx, repo: late as any });
      expect([out, asked, calls.length]).toEqual([{ status: 'done' }, 3, 1]);
    });
  });

  it("what a task's view is told: progressOf the run document as it changes, and a log line each time its stage changes", async () => {
    const { ctx, said } = context([opened('r1')], 'r1');
    await task(async ({ handle }) => {
      handle.change((doc: RunDoc) => {
        doc.status = 'meshing';
        doc.stages[0].status = 'running';
      });
      handle.change((doc: RunDoc) => void (doc.title = 'renamed'));
      handle.change((doc: RunDoc) => {
        doc.stages[0].status = 'done';
        doc.stages[1].status = 'running';
      });
      handle.change((doc: RunDoc) => {
        doc.stages[1].status = 'done';
        doc.status = 'done';
      });
      return 'done';
    })({ run: run.url }, ctx);
    expect(said.progress.map((p) => `${p.status}|${p.stage}`)).toEqual(['queued|null', 'meshing|Prepare', 'meshing|Mesh', 'done|null']);
    expect(said.logs).toEqual(['Prepare', 'Mesh', 'done']);
  });
});
