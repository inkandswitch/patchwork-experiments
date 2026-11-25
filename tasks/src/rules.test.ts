// @vitest-environment node
//
// These tests attack the rules in rules.ts. The first half is a table of every
// task the rules can be asked about with up to three runs, and checks each
// promise the header makes against expectations written out here from the
// header's words, not from the helpers the rules use. The second half merges
// real Automerge documents, because the rules lean on what a merge does to a
// list and to a map key.
//
// A test named "RULE HOLE: ..." states a promise the rules, as written, do not
// keep. It is marked `it.fails`, so it passes while the hole is there and fails
// loudly once someone closes it.

import * as A from '@automerge/automerge';
import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { describe, expect, it } from 'vitest';
import {
  claimRun,
  delistTask,
  endRun,
  ending,
  endingRun,
  type FinalStatus,
  type Heard,
  holder,
  isFinished,
  isHeard,
  isOpen,
  LAPSE_MS,
  listTask,
  MAX_LOG_LINES,
  MAX_RESULT_BYTES,
  mayClaim,
  mayDelist,
  mayRelist,
  type Named,
  named,
  type Queue,
  type Run,
  type RunStatus,
  stopReason,
  type Task,
  taskError,
  taskResult,
  taskState,
  type TaskState,
} from './rules';

// Building tasks

const url = (name: string) => `automerge:${name}` as AutomergeUrl;

/** What a run in the table is, as one listener sees it. */
type Kind = 'heard' | 'unheard' | 'succeeded' | 'failed' | 'cancelled' | 'lost' | 'yielded';
type PoolName = 'P' | 'Q';
interface Spec {
  kind: Kind;
  pool: PoolName;
}

const KINDS: Kind[] = ['heard', 'unheard', 'succeeded', 'failed', 'cancelled', 'lost', 'yielded'];
const NAMED: Named[] = ['this', 'other', 'none'];
const STATES: TaskState[] = ['waiting', 'running', 'stalled', 'stopping', 'succeeded', 'failed', 'cancelled'];
const STATUSES: RunStatus[] = ['succeeded', 'failed', 'cancelled', 'lost', 'yielded'];
const FINALS: FinalStatus[] = ['succeeded', 'failed', 'cancelled'];

const openKind = (kind: Kind) => kind === 'heard' || kind === 'unheard';
const finalKind = (kind: Kind): kind is FinalStatus =>
  kind === 'succeeded' || kind === 'failed' || kind === 'cancelled';

// A pool only matters for an open run (whose pool may still stop it or be
// barred from claiming again). Closed runs are all P's, so the table also
// shows that a closed run of P's never keeps P from claiming.
const SPECS: Spec[] = KINDS.flatMap((kind): Spec[] =>
  openKind(kind) ? [{ kind, pool: 'P' }, { kind, pool: 'Q' }] : [{ kind, pool: 'P' }],
);

const runId = (index: number) => `r${index}`;

function makeRun(spec: Spec, index: number): Run {
  const run: Run = { id: runId(index), pool: spec.pool, start: index };
  if (!openKind(spec.kind)) {
    run.end = 100 + index;
    run.status = spec.kind as RunStatus;
    run.result = spec.kind === 'succeeded' ? { from: runId(index) } : null;
    run.logs = [];
  }
  return run;
}

function makeTask(runs: Run[] = [], flagged = false): Task {
  const task: Task = { importUrl: 'data:text/javascript,export default () => 1', input: null, key: 'K', runs };
  if (flagged) {
    task.cancelled = true;
  }
  return task;
}

const copy = <T>(it: T): T => structuredClone(it);

/** Hears exactly the runs named. */
const hearing =
  (...ids: string[]): Heard =>
  (id) =>
    ids.includes(id);
const hearsAll: Heard = () => true;
const hearsNone: Heard = () => false;

// The table

interface Row {
  specs: Spec[];
  flagged: boolean;
  is: Named;
  task: Task;
  heard: Heard;
  label: string;
}

function runLists(length: number): Spec[][] {
  if (length === 0) {
    return [[]];
  }
  return runLists(length - 1).flatMap((head) => SPECS.map((spec) => [...head, spec]));
}

const ALL_RUN_LISTS = [0, 1, 2, 3].flatMap(runLists);

const ROWS: Row[] = ALL_RUN_LISTS.flatMap((specs) =>
  [false, true].flatMap((flagged) =>
    NAMED.map((is): Row => {
      const task = makeTask(specs.map(makeRun), flagged);
      const heardIds = specs.flatMap((spec, index) => (spec.kind === 'heard' ? [runId(index)] : []));
      return {
        specs,
        flagged,
        is,
        task,
        heard: hearing(...heardIds),
        label: `[${specs.map((s) => `${s.pool}:${s.kind}`).join(', ')}]${flagged ? ' flagged' : ''}, key names ${is}`,
      };
    }),
  ),
);

/** Runs `check` on every row and fails with the rows it complains about. */
function everyRow(check: (row: Row) => string | null | undefined, rows: Row[] = ROWS) {
  const failures: string[] = [];
  for (const row of rows) {
    const why = check(row);
    if (why) {
      failures.push(`${row.label}: ${why}`);
    }
  }
  expect(failures.slice(0, 20), `${failures.length} of ${rows.length} rows`).toEqual([]);
}

// What the header says, spelled out from the kinds alone.

/** "The task's HOLDER is its first open run, in list order, that is heard." */
function expectedHolder(row: Row): string | null {
  const at = row.specs.findIndex((spec) => spec.kind === 'heard');
  return at < 0 ? null : runId(at);
}

const lostIn = (specs: Spec[]) => specs.filter((spec) => spec.kind === 'lost').length;
const firstFinal = (specs: Spec[]) => specs.findIndex((spec) => finalKind(spec.kind));

/**
 * "The status of its first run, in list order, that ended for good. Failing
 * that, `failed` once MAX_LOST of its runs were lost, and `cancelled` once it
 * is flagged."
 */
function expectedEnding(row: Row): FinalStatus | null {
  const at = firstFinal(row.specs);
  if (at >= 0) {
    return row.specs[at].kind as FinalStatus;
  }
  if (lostIn(row.specs) >= 3) {
    return 'failed';
  }
  return row.flagged ? 'cancelled' : null;
}

/**
 * The seven states as the TaskState type's comments put them: `stopping` is
 * flagged with the run that has it not stopped yet; a final state is the
 * ending; `running` is a heard run having it; `stalled` is open runs none of
 * which is heard; `waiting` is nobody having it.
 */
function expectedState(row: Row): TaskState {
  const endedByRunOrLost = firstFinal(row.specs) >= 0 || lostIn(row.specs) >= 3;
  const held = row.specs.some((spec) => spec.kind === 'heard');
  if (row.flagged && !endedByRunOrLost) {
    return held ? 'stopping' : 'cancelled';
  }
  const ended = expectedEnding(row);
  if (ended) {
    return ended;
  }
  if (held) {
    return 'running';
  }
  return row.specs.some((spec) => openKind(spec.kind)) ? 'stalled' : 'waiting';
}

/** "Its queue lists it under its key, it has no ending, nobody heard holds it, and the pool has no open run of it." */
function expectedClaim(row: Row, pool: PoolName): boolean {
  return (
    row.is === 'this' &&
    expectedEnding(row) === null &&
    !row.specs.some((spec) => spec.kind === 'heard') &&
    !row.specs.some((spec) => openKind(spec.kind) && spec.pool === pool)
  );
}

/**
 * Why the open run at `index` is stopped: ended by a run or by lost runs is
 * `yielded` (no second ending); flagged is `cancelled`; a key naming another
 * task or an earlier heard open run is `yielded`; otherwise it carries on.
 */
function expectedStop(row: Row, index: number): 'cancelled' | 'yielded' | null {
  if (firstFinal(row.specs) >= 0 || lostIn(row.specs) >= 3) {
    return 'yielded';
  }
  if (row.flagged) {
    return 'cancelled';
  }
  if (row.is === 'other') {
    return 'yielded';
  }
  if (row.specs.slice(0, index).some((spec) => spec.kind === 'heard')) {
    return 'yielded';
  }
  return null;
}

/** The indices of the open runs that pool P has in a row. */
const openRunsOf = (row: Row, pool: PoolName) =>
  row.specs.flatMap((spec, index) => (openKind(spec.kind) && spec.pool === pool ? [index] : []));

describe('the table', () => {
  it('has every run list of length 0 to 3, times the flag, times what the key names', () => {
    // 9 run specs (5 closed kinds, 2 open kinds times 2 pools), lists of 0..3.
    expect(ALL_RUN_LISTS.length).toBe(1 + 9 + 81 + 729);
    expect(ROWS.length).toBe((1 + 9 + 81 + 729) * 2 * 3);
    expect(new Set(ROWS.map((row) => row.label)).size).toBe(ROWS.length);
  });
});

describe('holder', () => {
  it('is the first open heard run, or null', () => {
    everyRow((row) => {
      const got = holder(row.task, row.heard)?.id ?? null;
      const want = expectedHolder(row);
      return got === want ? null : `holder ${got}, expected ${want}`;
    });
  });

  it('is null for a task that is not here yet', () => {
    expect(holder(undefined, hearsAll)).toBeNull();
  });
});

describe('ending', () => {
  it("is the first final run's status, else failed when 3 runs are lost, else cancelled when flagged, else null", () => {
    everyRow((row) => {
      const got = ending(row.task);
      const want = expectedEnding(row);
      return got === want ? null : `ending ${got}, expected ${want}`;
    });
  });

  it('is null for a task that is not here yet', () => {
    expect(ending(undefined)).toBeNull();
  });
});

describe('taskState', () => {
  it('is exactly one of the seven states', () => {
    everyRow((row) => {
      const got = taskState(row.task, row.heard);
      return STATES.includes(got) ? null : `state ${got}`;
    });
  });

  it("is the state the header's words give", () => {
    everyRow((row) => {
      const got = taskState(row.task, row.heard);
      const want = expectedState(row);
      return got === want ? null : `state ${got}, expected ${want}`;
    });
  });

  it('agrees with holder and ending', () => {
    everyRow((row) => {
      const state = taskState(row.task, row.heard);
      const ended = ending(row.task);
      const held = holder(row.task, row.heard) !== null;
      const anyOpen = row.task.runs.some(isOpen);
      switch (state) {
        case 'stopping':
          return ended === 'cancelled' && held ? null : 'stopping without a flag-ending and a holder';
        case 'running':
          return ended === null && held ? null : 'running without a holder, or after an ending';
        case 'stalled':
          return ended === null && !held && anyOpen ? null : 'stalled but held, ended, or with no open run';
        case 'waiting':
          return ended === null && !anyOpen ? null : 'waiting with an open run or an ending';
        default:
          return isFinished(state) && state === ended ? null : `final state ${state} but ending ${ended}`;
      }
    });
  });

  it('is waiting for a task that is not here yet', () => {
    expect(taskState(undefined, hearsAll)).toBe('waiting');
  });
});

describe('mayClaim', () => {
  it('is true for P exactly when the key names this, there is no ending, no heard open run, and P has no open run', () => {
    everyRow((row) => {
      const got = mayClaim(row.task, 'P', row.is, row.heard);
      const want = expectedClaim(row, 'P');
      return got === want ? null : `mayClaim(P) ${got}, expected ${want}`;
    });
  });

  it('is false for a task that is not here yet', () => {
    expect(mayClaim(undefined, 'P', 'this', hearsNone)).toBe(false);
  });
});

describe('stopReason', () => {
  it("is null only with no ending by a run, fewer than 3 lost, no flag, a key not naming another, and no earlier heard open run; 'cancelled' only when flagged and nothing ended the task; else 'yielded'", () => {
    everyRow((row) => {
      for (const index of openRunsOf(row, 'P')) {
        const got = stopReason(row.task, runId(index), row.is, row.heard);
        const want = expectedStop(row, index);
        if (got !== want) {
          return `stopReason(${runId(index)}) ${got}, expected ${want}`;
        }
      }
      return null;
    });
  });

  it("is 'yielded' for a run that is not in the list or is already complete", () => {
    everyRow((row) => {
      if (stopReason(row.task, 'nobody', row.is, row.heard) !== 'yielded') {
        return 'an unknown run may carry on';
      }
      for (const [index, spec] of row.specs.entries()) {
        if (!openKind(spec.kind) && stopReason(row.task, runId(index), row.is, row.heard) !== 'yielded') {
          return `completed run ${runId(index)} may carry on`;
        }
      }
      return null;
    });
  });

  it('never leaves a pool both free to claim and carrying on a run of the task', () => {
    everyRow((row) => {
      const claim = mayClaim(row.task, 'P', row.is, row.heard);
      const carriesOn = openRunsOf(row, 'P').some(
        (index) => stopReason(row.task, runId(index), row.is, row.heard) === null,
      );
      return claim && carriesOn ? 'P may claim while one of its runs carries on' : null;
    });
  });
});

describe('a claim never displaces a heard earlier run', () => {
  it('Q may not claim while a run of P that carries on is heard', () => {
    everyRow((row) => {
      for (const index of openRunsOf(row, 'P')) {
        const carriesOn = stopReason(row.task, runId(index), row.is, row.heard) === null;
        if (carriesOn && row.specs[index].kind === 'heard' && mayClaim(row.task, 'Q', row.is, row.heard)) {
          return `Q may claim over heard ${runId(index)}`;
        }
      }
      return null;
    });
  });

  it("when Q claims because it cannot hear P's run, P's run carries on and Q's yields as soon as Q hears P", () => {
    let exercised = 0;
    everyRow((row) => {
      for (const index of openRunsOf(row, 'P')) {
        const p = runId(index);
        if (stopReason(row.task, p, row.is, row.heard) !== null) {
          continue;
        }
        const qHeard: Heard = (id) => id !== p && row.heard(id);
        if (!mayClaim(row.task, 'Q', row.is, qHeard)) {
          continue;
        }
        exercised++;
        const after = copy(row.task);
        claimRun(after, { id: 'rq', pool: 'Q', start: 99 });
        const pHearsQ: Heard = (id) => id === 'rq' || row.heard(id);
        const qHearsP: Heard = (id) => id === p || id === 'rq' || row.heard(id);
        if (stopReason(after, p, row.is, pHearsQ) !== null) {
          return `${p} stopped by Q's later claim`;
        }
        if (stopReason(after, 'rq', row.is, qHeard) !== null) {
          return "Q's run stopped before Q hears P";
        }
        if (stopReason(after, 'rq', row.is, qHearsP) !== 'yielded') {
          return `Q's run does not yield to ${p} once heard`;
        }
      }
      return null;
    });
    expect(exercised).toBeGreaterThan(0);
  });
});

describe('mayDelist', () => {
  it('is true exactly when the key names this and there is an ending', () => {
    everyRow((row) => {
      const got = mayDelist(row.task, row.is);
      const want = row.is === 'this' && expectedEnding(row) !== null;
      return got === want ? null : `mayDelist ${got}, expected ${want}`;
    });
  });
});

describe('mayRelist', () => {
  it('is true exactly when the key names none, there is no ending, no heard open run, and the lapse has passed', () => {
    const noneSince = 50_000;
    everyRow((row) => {
      for (const waited of [0, LAPSE_MS - 1, LAPSE_MS, LAPSE_MS + 1]) {
        const got = mayRelist(row.task, row.is, row.heard, noneSince, noneSince + waited);
        const want =
          row.is === 'none' && expectedEnding(row) === null && expectedHolder(row) === null && waited >= LAPSE_MS;
        if (got !== want) {
          return `mayRelist after ${waited} ms ${got}, expected ${want}`;
        }
      }
      return null;
    });
  });

  it('is false for a task that is not here yet', () => {
    expect(mayRelist(undefined, 'none', hearsNone, 0, LAPSE_MS * 2)).toBe(false);
  });
});

describe('bounded starts', () => {
  it('a task with 3 lost runs has an ending, so nobody may claim it', () => {
    const rows = ROWS.filter((row) => lostIn(row.specs) === 3);
    expect(rows.length).toBe(2 * 3);
    everyRow((row) => {
      if (ending(row.task) !== 'failed') {
        return `ending ${ending(row.task)}`;
      }
      for (const pool of ['P', 'Q', 'R']) {
        if (mayClaim(row.task, pool, row.is, row.heard)) {
          return `${pool} may claim`;
        }
      }
      return null;
    }, rows);
  });
});

// Monotonicity

describe('monotonicity', () => {
  const endedByRun = ROWS.filter((row) => firstFinal(row.specs) >= 0);

  it('appending a run never changes an ending given by a run', () => {
    everyRow((row) => {
      const before = endingRun(row.task)?.id;
      const was = ending(row.task);
      for (const spec of SPECS) {
        const after = copy(row.task);
        after.runs.push(makeRun(spec, after.runs.length));
        if (ending(after) !== was || endingRun(after)?.id !== before) {
          return `appending ${spec.pool}:${spec.kind} gives ${ending(after)}`;
        }
      }
      return null;
    }, endedByRun);
  });

  it('completing a later run never changes an ending given by an earlier run', () => {
    let exercised = 0;
    everyRow((row) => {
      const at = firstFinal(row.specs);
      const was = ending(row.task);
      for (let later = at + 1; later < row.specs.length; later++) {
        if (!openKind(row.specs[later].kind)) {
          continue;
        }
        for (const status of STATUSES) {
          exercised++;
          const after = copy(row.task);
          endRun(after, runId(later), { status, end: 999 });
          if (ending(after) !== was || endingRun(after)?.id !== runId(at)) {
            return `completing ${runId(later)} ${status} gives ${ending(after)}`;
          }
        }
      }
      return null;
    }, endedByRun);
    expect(exercised).toBeGreaterThan(0);
  });

  it('THE ONE ADMITTED FLIP: completing an earlier run with a final status after a later run ended the task changes the ending to the earlier one', () => {
    let exercised = 0;
    everyRow((row) => {
      const at = firstFinal(row.specs);
      for (let earlier = 0; earlier < at; earlier++) {
        if (!openKind(row.specs[earlier].kind)) {
          continue;
        }
        for (const status of FINALS) {
          exercised++;
          const after = copy(row.task);
          endRun(after, runId(earlier), { status, result: 'late', end: 999 });
          if (ending(after) !== status || endingRun(after)?.id !== runId(earlier)) {
            return `completing ${runId(earlier)} ${status} gives ${ending(after)} by ${endingRun(after)?.id}`;
          }
        }
      }
      return null;
    }, endedByRun);
    expect(exercised).toBeGreaterThan(0);
  });

  it('a pool that has seen the later ending never makes that flip: its earlier run yields, which ends nothing', () => {
    everyRow((row) => {
      const at = firstFinal(row.specs);
      const was = ending(row.task);
      for (let earlier = 0; earlier < at; earlier++) {
        if (!openKind(row.specs[earlier].kind)) {
          continue;
        }
        const why = stopReason(row.task, runId(earlier), row.is, row.heard);
        if (why !== 'yielded') {
          return `earlier ${runId(earlier)} is told ${why}`;
        }
        const after = copy(row.task);
        endRun(after, runId(earlier), { status: why, end: 999 });
        if (ending(after) !== was) {
          return `recording ${runId(earlier)} yielded changes the ending to ${ending(after)}`;
        }
      }
      return null;
    }, endedByRun);
  });

  // Each of these is a reader that saw a finished state and then, with no
  // earlier run completing, sees a different one. The contract admits only the
  // flip above, so each is a hole: an asker that stops at the first finished
  // state takes the wrong answer, and the entry is already gone (mayDelist).

  it.fails('RULE HOLE: an ending by three lost runs is replaced by a later run that succeeds', () => {
    // Runs [lost, lost, A open by P]. Q cannot hear A and claims B. P restarts
    // and records A lost: the task has failed. B's pool has not seen that yet
    // and completes B.
    const task = makeTask([
      makeRun({ kind: 'lost', pool: 'P' }, 0),
      makeRun({ kind: 'lost', pool: 'P' }, 1),
      { id: 'A', pool: 'P', start: 2 },
    ]);
    expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
    claimRun(task, { id: 'B', pool: 'Q', start: 3 });
    endRun(task, 'A', { status: 'lost', end: 4 });
    expect(taskState(task, hearsAll)).toBe('failed');
    endRun(task, 'B', { status: 'succeeded', result: 1, end: 5 });
    expect(taskState(task, hearsAll)).toBe('failed');
  });

  it.fails("RULE HOLE: a flagged task whose open run is unheard reads finished 'cancelled', then that run's success makes it 'succeeded'", () => {
    // The run's pool is out of earshot; the asker flags the task. Ruling 1
    // wants a success that crossed the flag to count, so the hole is that
    // taskState already called the task finished while a run that could
    // still end it was open.
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }], true);
    expect(taskState(task, hearsNone)).toBe('cancelled');
    expect(isFinished(taskState(task, hearsNone))).toBe(true);
    endRun(task, 'A', { status: 'succeeded', result: 1, end: 1 });
    expect(taskState(task, hearsNone)).toBe('cancelled');
  });

  it.fails("RULE HOLE: a flagged task with two lost runs reads 'cancelled', then its open run's pool restarts and records it lost, and it reads 'failed'", () => {
    const task = makeTask(
      [makeRun({ kind: 'lost', pool: 'P' }, 0), makeRun({ kind: 'lost', pool: 'P' }, 1), { id: 'A', pool: 'P', start: 2 }],
      true,
    );
    expect(taskState(task, hearsNone)).toBe('cancelled');
    endRun(task, 'A', { status: 'lost', end: 3 });
    expect(taskState(task, hearsNone)).toBe('cancelled');
  });
});

// The changes

describe('listTask', () => {
  const entry = (name: string, askedAt = 1) => ({ taskUrl: url(name), askedAt, package: 'pkg' });

  it('makes `jobs` if a queue has none, and lists under an empty key', () => {
    const queue = {} as Queue;
    listTask(queue, 'K', entry('T1'));
    expect(queue.jobs).toEqual({ K: { taskUrl: url('T1'), askedAt: 1, package: 'pkg' } });
  });

  it('keeps only the three fields of an entry, and turns a missing package into null', () => {
    const queue: Queue = { jobs: {} };
    listTask(queue, 'K', { taskUrl: url('T1'), askedAt: 1, key: 'K', extra: 1 } as never);
    expect(queue.jobs.K).toEqual({ taskUrl: url('T1'), askedAt: 1, package: null });
  });

  it('leaves an entry already listed', () => {
    const queue: Queue = { jobs: { K: entry('T0', 0) } };
    listTask(queue, 'K', entry('T1'));
    expect(queue.jobs.K.taskUrl).toBe(url('T0'));
  });

  it('replaces what is under the key when it is not an entry at all', () => {
    const queue = { jobs: { K: { nonsense: true } } } as unknown as Queue;
    listTask(queue, 'K', entry('T1'));
    expect(queue.jobs.K.taskUrl).toBe(url('T1'));
  });

  it('with `over`, replaces an entry naming that task', () => {
    const queue: Queue = { jobs: { K: entry('T0', 0) } };
    listTask(queue, 'K', entry('T1'), url('T0'));
    expect(queue.jobs.K).toEqual(entry('T1'));
  });

  it('with `over`, leaves an entry naming any other task', () => {
    const queue: Queue = { jobs: { K: entry('T2', 0) } };
    listTask(queue, 'K', entry('T1'), url('T0'));
    expect(queue.jobs.K.taskUrl).toBe(url('T2'));
  });

  it('with `over`, lists under an empty key', () => {
    const queue: Queue = { jobs: {} };
    listTask(queue, 'K', entry('T1'), url('T0'));
    expect(queue.jobs.K.taskUrl).toBe(url('T1'));
  });

  it('touches no other key', () => {
    const queue: Queue = { jobs: { J: entry('T9', 0) } };
    listTask(queue, 'K', entry('T1'), url('T9'));
    expect(queue.jobs.J.taskUrl).toBe(url('T9'));
  });
});

describe('delistTask', () => {
  const entry = (name: string) => ({ taskUrl: url(name), askedAt: 1, package: null });

  it('deletes the entry when it names the task', () => {
    const queue: Queue = { jobs: { K: entry('T1'), J: entry('T1') } };
    delistTask(queue, 'K', url('T1'));
    expect(queue.jobs).toEqual({ J: entry('T1') });
  });

  it('leaves an entry naming another task', () => {
    const queue: Queue = { jobs: { K: entry('T2') } };
    delistTask(queue, 'K', url('T1'));
    expect(queue.jobs).toEqual({ K: entry('T2') });
  });

  it('does nothing to an empty key or a queue with no jobs', () => {
    const queue: Queue = { jobs: {} };
    delistTask(queue, 'K', url('T1'));
    expect(queue.jobs).toEqual({});
    expect(() => delistTask({} as Queue, 'K', url('T1'))).not.toThrow();
  });
});

describe('named', () => {
  it("says 'this', 'other' or 'none', and treats what is not an entry as none", () => {
    const queue = { jobs: { K: { taskUrl: url('T1'), askedAt: 1, package: null }, J: 'junk' } } as unknown as Queue;
    expect(named(queue, 'K', url('T1'))).toBe('this');
    expect(named(queue, 'K', url('T2'))).toBe('other');
    expect(named(queue, 'J', url('T1'))).toBe('none');
    expect(named(queue, 'X', url('T1'))).toBe('none');
    expect(named(undefined, 'K', url('T1'))).toBe('none');
  });
});

describe('claimRun', () => {
  it('appends exactly {id, pool, start} at the end of the list', () => {
    const task = makeTask([makeRun({ kind: 'lost', pool: 'P' }, 0)]);
    claimRun(task, { id: 'B', pool: 'Q', start: 7, end: 8, status: 'succeeded' } as never);
    expect(task.runs.map((run) => run.id)).toEqual(['r0', 'B']);
    expect(task.runs[1]).toEqual({ id: 'B', pool: 'Q', start: 7 });
    expect(isOpen(task.runs[1])).toBe(true);
  });
});

describe('endRun', () => {
  const openTask = () => makeTask([{ id: 'A', pool: 'P', start: 0 }]);
  const line = (n: number) => ({ timestampMillis: n, message: `line ${n}` });

  it('completes an open run with end, status, result and logs', () => {
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', result: { x: 1 }, logs: [line(1)], end: 5 });
    expect(task.runs[0]).toEqual({
      id: 'A',
      pool: 'P',
      start: 0,
      end: 5,
      status: 'succeeded',
      result: { x: 1 },
      logs: [line(1)],
    });
  });

  it('completes a run once: a completed run is never rewritten, whatever the second call says', () => {
    for (const first of STATUSES) {
      for (const second of STATUSES) {
        const task = openTask();
        endRun(task, 'A', { status: first, result: 'one', logs: [line(1)], end: 1 });
        const once = copy(task.runs[0]);
        endRun(task, 'A', { status: second, result: 'two', logs: [line(2)], end: 2 });
        expect(task.runs[0], `${first} then ${second}`).toEqual(once);
      }
    }
  });

  it('does nothing for a run that is not in the list', () => {
    const task = openTask();
    endRun(task, 'nobody', { status: 'succeeded', end: 1 });
    expect(task.runs).toEqual(openTask().runs);
  });

  it('keeps a result of exactly MAX_RESULT_BYTES as JSON', () => {
    const task = openTask();
    const result = 'x'.repeat(MAX_RESULT_BYTES - 2);
    endRun(task, 'A', { status: 'succeeded', result, end: 1 });
    expect(task.runs[0].status).toBe('succeeded');
    expect(task.runs[0].result).toBe(result);
  });

  it('fails a run whose result is one more than MAX_RESULT_BYTES, with a line saying so, and keeps no result', () => {
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', result: 'x'.repeat(MAX_RESULT_BYTES - 1), logs: [line(1)], end: 9 });
    const run = task.runs[0];
    expect(run.status).toBe('failed');
    expect(run.result).toBeNull();
    expect(run.logs?.length).toBe(2);
    expect(run.logs?.at(-1)?.message).toContain(`${MAX_RESULT_BYTES + 1} bytes`);
    expect(run.logs?.at(-1)?.timestampMillis).toBe(9);
    expect(taskError(task)).toContain(`${MAX_RESULT_BYTES + 1} bytes`);
  });

  it('fails a run whose result JSON cannot serialise: circular, a BigInt, a function', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const result of [circular, 1n, () => 1]) {
      const task = openTask();
      endRun(task, 'A', { status: 'succeeded', result, end: 1 });
      expect(task.runs[0].status, String(typeof result)).toBe('failed');
      expect(task.runs[0].result).toBeNull();
      expect(task.runs[0].logs?.at(-1)?.message).toBe('its result is not something a document can hold');
    }
  });

  it('keeps a missing result as null', () => {
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', end: 1 });
    expect(task.runs[0].status).toBe('succeeded');
    expect(task.runs[0].result).toBeNull();
    expect(taskResult(task)).toBeNull();
  });

  it('keeps no result for a run that did not succeed', () => {
    for (const status of ['failed', 'cancelled', 'lost', 'yielded'] as const) {
      const task = openTask();
      endRun(task, 'A', { status, result: { x: 1 }, end: 1 });
      expect(task.runs[0].result, status).toBeNull();
    }
  });

  it('keeps only the last MAX_LOG_LINES lines, as copies', () => {
    const logs = Array.from({ length: MAX_LOG_LINES + 50 }, (_, n) => line(n));
    const task = openTask();
    endRun(task, 'A', { status: 'failed', logs, end: 1 });
    const kept = task.runs[0].logs ?? [];
    expect(kept.length).toBe(MAX_LOG_LINES);
    expect(kept[0]).toEqual(line(50));
    expect(kept.at(-1)).toEqual(line(MAX_LOG_LINES + 49));
    expect(kept[0]).not.toBe(logs[50]);
    expect(taskError(task)).toBe(`line ${MAX_LOG_LINES + 49}`);
  });

  it.fails('RULE HOLE: an oversized result with MAX_LOG_LINES lines keeps MAX_LOG_LINES + 1 lines', () => {
    // The lines are cut to MAX_LOG_LINES before the line about the result is added.
    const logs = Array.from({ length: MAX_LOG_LINES }, (_, n) => line(n));
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', result: 'x'.repeat(MAX_RESULT_BYTES), logs, end: 1 });
    expect(task.runs[0].logs?.length).toBeLessThanOrEqual(MAX_LOG_LINES);
  });

  it.fails('RULE HOLE: the result limit counts UTF-16 units, not bytes, so a result of twice MAX_RESULT_BYTES in UTF-8 succeeds', () => {
    // Each of these characters is two UTF-16 units and four UTF-8 bytes.
    const result = '\u{1F600}'.repeat(Math.floor(MAX_RESULT_BYTES / 2) - 2);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeGreaterThan(MAX_RESULT_BYTES * 1.9);
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', result, end: 1 });
    expect(task.runs[0].status).toBe('failed');
  });
});

describe('isHeard', () => {
  it('counts a run last heard less than LAPSE_MS ago, and not one heard exactly LAPSE_MS ago', () => {
    expect(isHeard(1_000, 0, 1_000 + LAPSE_MS - 1)).toBe(true);
    expect(isHeard(1_000, 0, 1_000 + LAPSE_MS)).toBe(false);
    expect(isHeard(1_000, 0, 1_000)).toBe(true);
  });

  it('counts a run never heard while it was first seen less than LAPSE_MS ago', () => {
    expect(isHeard(null, 1_000, 1_000)).toBe(true);
    expect(isHeard(null, 1_000, 1_000 + LAPSE_MS - 1)).toBe(true);
    expect(isHeard(null, 1_000, 1_000 + LAPSE_MS)).toBe(false);
  });

  it('honours a last word at time 0 rather than taking it for never heard', () => {
    expect(isHeard(0, 50_000, 50_000)).toBe(false);
  });

  it('goes by the last word once there is one, even when the run was first seen after it', () => {
    // A beat can arrive on the channel before the run arrives in the document.
    expect(isHeard(0, LAPSE_MS, LAPSE_MS + 1)).toBe(false);
  });

  it('counts as heard while the listener clock reads earlier than the last word', () => {
    expect(isHeard(5_000, 0, 1_000)).toBe(true);
  });
});

// Merges on real Automerge

/** An actor id made of one repeated hex digit, so that the actors sort as their digits do. */
const actor = (digit: string) => digit.repeat(32);

const replica = <T>(doc: A.Doc<T>, digit: string) => A.clone(doc, actor(digit));

/** Merges each into a copy of the other: the two replicas after they sync. */
function syncBoth<T>(x: A.Doc<T>, y: A.Doc<T>): [A.Doc<T>, A.Doc<T>] {
  return [A.merge(A.clone(x), y), A.merge(A.clone(y), x)];
}

/** Merges every document into a copy of the first. */
const mergeAll = <T>(first: A.Doc<T>, ...rest: A.Doc<T>[]) => rest.reduce((doc, other) => A.merge(doc, other), A.clone(first));

const ids = (task: Task) => task.runs.map((run) => run.id);

describe('merges', () => {
  const baseTask = (runs: Run[] = []) => A.from<Task>(makeTask(runs), actor('0'));
  const open = (id: string, pool: string): Run => ({ id, pool, start: 0 });

  it('two pools claiming at once: both replicas list the two runs in the same order and agree on the holder', () => {
    const base = baseTask();
    const p = A.change(replica(base, 'a'), (task) => {
      expect(mayClaim(task, 'P', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'A', pool: 'P', start: 1 });
    });
    const q = A.change(replica(base, 'b'), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 1 });
    });
    const [onP, onQ] = syncBoth(p, q);
    expect(ids(onP)).toEqual(ids(onQ));
    expect(ids(onP).sort()).toEqual(['A', 'B']);
    const first = ids(onP)[0];
    const second = ids(onP)[1];
    for (const doc of [onP, onQ]) {
      expect(holder(doc, hearsAll)?.id).toBe(first);
      expect(stopReason(doc, first, 'this', hearsAll)).toBeNull();
      expect(stopReason(doc, second, 'this', hearsAll)).toBe('yielded');
    }
  });

  it('a run appended after seeing another lands after it, also beside a third concurrent append, for every order of actors', () => {
    // X, then A and B appended concurrently, then C appended by someone who
    // had seen only [X, A]. Every assignment of actors to A, B and C is tried,
    // since the merge orders concurrent inserts by actor.
    const orders = [
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
      ['b', 'a', 'c'],
      ['b', 'c', 'a'],
      ['c', 'a', 'b'],
      ['c', 'b', 'a'],
    ];
    for (const [forA, forB, forC] of orders) {
      const base = A.change(baseTask(), (task) => claimRun(task, { id: 'X', pool: 'R', start: 0 }));
      const a = A.change(replica(base, forA), (task) => claimRun(task, { id: 'A', pool: 'P', start: 1 }));
      const b = A.change(replica(base, forB), (task) => claimRun(task, { id: 'B', pool: 'Q', start: 1 }));
      const c = A.change(A.merge(replica(base, forC), a), (task) => claimRun(task, { id: 'C', pool: 'S', start: 2 }));
      const replicas = [mergeAll(a, b, c), mergeAll(b, c, a), mergeAll(c, a, b), mergeAll(c, b, a)];
      const label = `A=${forA} B=${forB} C=${forC}`;
      for (const doc of replicas) {
        expect(ids(doc), label).toEqual(ids(replicas[0]));
        expect(ids(doc).indexOf('X'), label).toBe(0);
        expect(ids(doc).indexOf('C'), label).toBeGreaterThan(ids(doc).indexOf('A'));
        expect(stopReason(doc, 'C', 'this', hearsAll), label).toBe('yielded');
      }
    }
  });

  describe('a queue key', () => {
    const baseQueue = (jobs: Queue['jobs'] = {}) => A.from<Queue>({ jobs }, actor('0'));
    const entry = (name: string) => ({ taskUrl: url(name), askedAt: 1, package: null });

    it("listed by two replicas at once keeps one entry, the same on both, 'this' for one task and 'other' for the other", () => {
      const base = baseQueue();
      const one = A.change(replica(base, 'a'), (queue) => listTask(queue, 'K', entry('T1')));
      const two = A.change(replica(base, 'b'), (queue) => listTask(queue, 'K', entry('T2')));
      const [onOne, onTwo] = syncBoth(one, two);
      expect(onOne.jobs.K.taskUrl).toBe(onTwo.jobs.K.taskUrl);
      for (const doc of [onOne, onTwo]) {
        const seen = [named(doc, 'K', url('T1')), named(doc, 'K', url('T2'))].sort();
        expect(seen).toEqual(['other', 'this']);
      }
    });

    it('listed over an earlier entry while another replica delists that entry: the new entry survives on both', () => {
      const base = baseQueue({ K: entry('T0') });
      const delisted = A.change(replica(base, 'a'), (queue) => delistTask(queue, 'K', url('T0')));
      const relisted = A.change(replica(base, 'b'), (queue) => listTask(queue, 'K', entry('T2'), url('T0')));
      for (const doc of syncBoth(delisted, relisted)) {
        expect(named(doc, 'K', url('T2'))).toBe('this');
      }
      // The same with the actors the other way round, since a put and a delete
      // are not ordered by actor, only by what each had seen.
      const delisted2 = A.change(replica(base, 'b'), (queue) => delistTask(queue, 'K', url('T0')));
      const relisted2 = A.change(replica(base, 'a'), (queue) => listTask(queue, 'K', entry('T2'), url('T0')));
      for (const doc of syncBoth(delisted2, relisted2)) {
        expect(named(doc, 'K', url('T2'))).toBe('this');
      }
    });

    it('listed by two replicas at once and then delisted by a replica that has seen both: the key is empty everywhere, and the losing entry does not come back', () => {
      const base = baseQueue();
      const one = A.change(replica(base, 'a'), (queue) => listTask(queue, 'K', entry('T1')));
      const two = A.change(replica(base, 'b'), (queue) => listTask(queue, 'K', entry('T2')));
      const both = A.merge(replica(base, 'c'), A.merge(A.clone(one), two));
      const winner = both.jobs.K.taskUrl;
      const loser = winner === url('T1') ? url('T2') : url('T1');
      const deleted = A.change(both, (queue) => delistTask(queue, 'K', winner));
      for (const doc of [A.merge(A.clone(one), deleted), A.merge(A.clone(two), deleted), deleted]) {
        expect(doc.jobs.K).toBeUndefined();
        expect(A.getConflicts(doc.jobs, 'K')).toBeUndefined();
        expect(named(doc, 'K', loser)).toBe('none');
      }
    });

    it("so the losing task's asker, if it never read 'other', reads 'none' and lists its task again after the lapse: the work is done twice", () => {
      // The asker of the loser had its own entry, then got the merge and the
      // delete together. Its task was never claimed (or its runs yielded to
      // the key naming another), so it has no ending and nobody holds it.
      const loserTask = makeTask([{ ...makeRun({ kind: 'yielded', pool: 'P' }, 0) }]);
      expect(mayRelist(loserTask, 'none', hearsNone, 0, LAPSE_MS - 1)).toBe(false);
      expect(mayRelist(loserTask, 'none', hearsNone, 0, LAPSE_MS)).toBe(true);
    });

    it("listed by two replicas at once and delisted by the winner's replica before it saw the loser: the loser's entry remains", () => {
      const base = baseQueue();
      const one = A.change(replica(base, 'a'), (queue) => listTask(queue, 'K', entry('T1')));
      const two = A.change(replica(base, 'b'), (queue) => listTask(queue, 'K', entry('T2')));
      const winner = A.merge(A.clone(one), two).jobs.K.taskUrl;
      const [winnerSide, loserSide] = winner === url('T1') ? [one, two] : [two, one];
      const loser = loserSide.jobs.K.taskUrl;
      const deleted = A.change(winnerSide, (queue) => delistTask(queue, 'K', winner));
      for (const doc of syncBoth(deleted, loserSide)) {
        expect(named(doc, 'K', loser)).toBe('this');
      }
    });
  });

  it('two pools completing two runs with final statuses at once give one ending, the first run in list order', () => {
    for (const [first, second] of [
      ['failed', 'succeeded'],
      ['succeeded', 'failed'],
      ['cancelled', 'succeeded'],
    ] as const) {
      const base = baseTask([open('A', 'P'), open('B', 'Q')]);
      const p = A.change(replica(base, 'a'), (task) => endRun(task, 'A', { status: first, result: 'a', end: 1 }));
      const q = A.change(replica(base, 'b'), (task) => endRun(task, 'B', { status: second, result: 'b', end: 1 }));
      for (const doc of syncBoth(p, q)) {
        expect(ending(doc)).toBe(first);
        expect(endingRun(doc)?.id).toBe('A');
      }
    }
  });

  it("a cancel flag set at the same time as the run's success reads 'succeeded' on both replicas", () => {
    const base = baseTask([open('A', 'P')]);
    const asker = A.change(replica(base, 'a'), (task) => {
      task.cancelled = true;
    });
    const pool = A.change(replica(base, 'b'), (task) => endRun(task, 'A', { status: 'succeeded', result: 42, end: 1 }));
    for (const doc of syncBoth(asker, pool)) {
      expect(doc.cancelled).toBe(true);
      expect(ending(doc)).toBe('succeeded');
      expect(taskState(doc, hearsAll)).toBe('succeeded');
      expect(taskResult(doc)).toBe(42);
    }
  });

  it("three lost runs recorded by three pools at once read 'failed' everywhere, with no run marked failed", () => {
    const base = baseTask([open('A', 'P'), open('B', 'Q'), open('C', 'R')]);
    const [a, b, c] = (['A', 'B', 'C'] as const).map((id, n) =>
      A.change(replica(base, 'abc'[n]), (task) => endRun(task, id, { status: 'lost', end: 1 })),
    );
    for (const doc of [mergeAll(a, b, c), mergeAll(b, c, a), mergeAll(c, a, b)]) {
      expect(ending(doc)).toBe('failed');
      expect(taskState(doc, hearsAll)).toBe('failed');
      expect(doc.runs.some((run) => run.status === 'failed')).toBe(false);
      expect(taskError(doc)).toContain('stopped 3 times');
      expect(mayClaim(doc, 'S', 'this', hearsNone)).toBe(false);
    }
  });

  describe('one run completed from two replicas at once (the pool before and after a restart)', () => {
    // The old incarnation writes `succeeded` with a result; the new one writes
    // `lost`. Automerge merges each field on its own, by the order of the ops
    // that wrote it, so which write a field comes from depends on how many ops
    // each write spent before that field (a string status is one op per
    // character, an object result one per field).
    const merged = () => {
      const base = baseTask([open('A', 'P')]);
      const old = A.change(replica(base, 'a'), (task) =>
        endRun(task, 'A', { status: 'succeeded', result: { x: 1, y: 2, z: 3 }, logs: [{ timestampMillis: 1, message: 'old' }], end: 1 }),
      );
      const restarted = A.change(replica(base, 'b'), (task) =>
        endRun(task, 'A', { status: 'lost', logs: [{ timestampMillis: 2, message: 'new' }], end: 2 }),
      );
      return syncBoth(old, restarted);
    };

    it("leaves the run complete with one of the two statuses, the same on both replicas: here 'lost', the later actor's", () => {
      const [one, two] = merged();
      expect(one.runs).toEqual(two.runs);
      for (const doc of [one, two]) {
        expect(isOpen(doc.runs[0])).toBe(false);
        expect(['succeeded', 'lost']).toContain(doc.runs[0].status);
        expect(doc.runs[0].status).toBe('lost');
        expect(doc.runs[0].end).toBe(2);
        expect(ending(doc)).toBeNull();
        expect(taskState(doc, hearsAll)).toBe('waiting');
      }
    });

    it('and blends the two writes: the status of one with the result and logs of the other', () => {
      const [one] = merged();
      expect(one.runs[0].status).toBe('lost');
      expect(one.runs[0].result).toEqual({ x: 1, y: 2, z: 3 });
      expect(one.runs[0].logs?.map((it) => it.message)).toEqual(['old']);
    });

    it.fails('RULE HOLE: a run completed twice at once reads wholly as one of the two writes', () => {
      const [one] = merged();
      const run = one.runs[0];
      const wholeOld = run.status === 'succeeded' && run.logs?.[0]?.message === 'old' && run.end === 1;
      const wholeNew = run.status === 'lost' && run.result === null && run.logs?.[0]?.message === 'new' && run.end === 2;
      expect(wholeOld || wholeNew).toBe(true);
    });
  });

  it.fails('RULE HOLE: a result JSON can hold but Automerge cannot (an undefined field, a Map) throws out of endRun instead of failing the run', () => {
    const base = baseTask([open('A', 'P')]);
    for (const result of [{ a: undefined }, new Map([[1, 2]])]) {
      let doc = base;
      expect(() => {
        doc = A.change(base, (task) => endRun(task, 'A', { status: 'succeeded', result, end: 1 }));
      }).not.toThrow();
      expect(doc.runs[0].status).toBe('failed');
    }
  });

  it("case (e): A open, B appended while A is unheard; when A is heard again B yields and A carries on, on both replicas", () => {
    const base = baseTask([open('A', 'P')]);
    const onQ = A.change(replica(base, 'b'), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 1 });
    });
    const onP = replica(base, 'a');
    for (const doc of syncBoth(onP, onQ)) {
      expect(ids(doc)).toEqual(['A', 'B']);
      // While Q still cannot hear A, B carries on.
      expect(stopReason(doc, 'B', 'this', hearing('B'))).toBeNull();
      // Once A is heard, A holds and B gives way.
      expect(holder(doc, hearsAll)?.id).toBe('A');
      expect(stopReason(doc, 'B', 'this', hearsAll)).toBe('yielded');
      expect(stopReason(doc, 'A', 'this', hearsAll)).toBeNull();
      expect(taskState(doc, hearsAll)).toBe('running');
    }
  });
});
