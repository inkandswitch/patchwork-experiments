// @vitest-environment node
//
// These tests attack the rules in task-rules.js. The first half is a table of
// every task the rules can be asked about with up to three runs, and checks
// each promise the header makes against expectations written out here from
// the header's words, not from the helpers the rules use. The second half
// merges real Automerge documents, because the rules lean on what a merge does
// to a list and to a map key.
//
// A test named "RULE HOLE: ..." states a promise the header makes that the
// rules, as written, do not keep. It is marked `it.fails`, so it passes while
// the hole is there and fails loudly once someone closes it.

import * as A from '@automerge/automerge';
import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { describe, expect, it } from 'vitest';
import {
  allHeard,
  claimRun,
  delistTask,
  endRun,
  ending,
  endingRun,
  entryAt,
  type FinalStatus,
  gone,
  type Heard,
  holder,
  isFinished,
  isHeard,
  isOpen,
  isTask,
  isWanted,
  LAPSE_MS,
  listTask,
  MAX_LOG_LINES,
  MAX_LOST,
  MAX_RESULT_BYTES,
  mayClaim,
  mayDelist,
  mayRelist,
  type Named,
  named,
  orphans,
  type Queue,
  type Run,
  type RunStatus,
  stopReason,
  type Task,
  taskError,
  taskResult,
  taskState,
  type TaskState,
  waitingWork,
} from './task-rules.js';

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

/** Every run list given, times the flag, times what the key names. */
const rowsFor = (lists: Spec[][]): Row[] =>
  lists.flatMap((specs) =>
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

const ROWS: Row[] = rowsFor(ALL_RUN_LISTS);

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

const lostIn = (specs: Spec[]) => specs.filter((spec) => spec.kind === 'lost').length;
const firstFinal = (specs: Spec[]) => specs.findIndex((spec) => finalKind(spec.kind));
const endedByRun = (row: Row) => firstFinal(row.specs) >= 0;
const isHeldIn = (row: Row) => row.specs.some((spec) => spec.kind === 'heard');
const anyOpenIn = (row: Row) => row.specs.some((spec) => openKind(spec.kind));

/** "The task's HOLDER is its first open run, in list order, that is heard." */
function expectedHolder(row: Row): string | null {
  const at = row.specs.findIndex((spec) => spec.kind === 'heard');
  return at < 0 ? null : runId(at);
}

/**
 * "The status of its first run, in list order, that ended it for good. With
 * no such run, and nobody holding it, it is `failed` once MAX_LOST of its runs
 * were lost, and `cancelled` once it is flagged. Otherwise it has not ended."
 */
function expectedEnding(row: Row): FinalStatus | null {
  if (endedByRun(row)) {
    return row.specs[firstFinal(row.specs)].kind as FinalStatus;
  }
  if (isHeldIn(row)) {
    return null;
  }
  if (lostIn(row.specs) >= 3) {
    return 'failed';
  }
  return row.flagged ? 'cancelled' : null;
}

/**
 * The seven states as the TaskState type's comments put them, written in an
 * order of their own: a run that ended the task says; a held task is
 * `stopping` when flagged and `running` otherwise, however many runs it lost;
 * an unheld one has failed by lost runs or been cancelled by the flag; else
 * `stalled` with open runs and `waiting` without.
 */
function expectedState(row: Row): TaskState {
  if (endedByRun(row)) {
    return row.specs[firstFinal(row.specs)].kind as FinalStatus;
  }
  if (isHeldIn(row)) {
    return row.flagged ? 'stopping' : 'running';
  }
  if (lostIn(row.specs) >= 3) {
    return 'failed';
  }
  if (row.flagged) {
    return 'cancelled';
  }
  return anyOpenIn(row) ? 'stalled' : 'waiting';
}

/** "No run has ended it, it is not flagged, and it has not lost MAX_LOST runs." */
const expectedWanted = (row: Row) => !endedByRun(row) && !row.flagged && lostIn(row.specs) < 3;

/** "Still wanted, its queue lists it under the task's key, nobody heard holds it, and the pool has no open run of it." */
function expectedClaim(row: Row, pool: PoolName): boolean {
  return (
    row.is === 'this' &&
    expectedWanted(row) &&
    !isHeldIn(row) &&
    !row.specs.some((spec) => openKind(spec.kind) && spec.pool === pool)
  );
}

/**
 * "As soon as another run has ended the task, the task is flagged, its key
 * names another task, or an earlier run it can hear holds it. Only the flag
 * makes the run `cancelled`; the others make it `yielded`." A key naming
 * nothing, and lost runs, stop nothing.
 */
function expectedStop(row: Row, index: number): 'cancelled' | 'yielded' | null {
  if (endedByRun(row)) {
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

/** "What it would have been stopped for, or else `lost`", with nobody heard. */
function expectedGone(row: Row): 'cancelled' | 'yielded' | 'lost' {
  if (endedByRun(row)) {
    return 'yielded';
  }
  if (row.flagged) {
    return 'cancelled';
  }
  return row.is === 'other' ? 'yielded' : 'lost';
}

/** The indices of the open runs that a pool has in a row. */
const openRunsOf = (row: Row, pool: PoolName) =>
  row.specs.flatMap((spec, index) => (openKind(spec.kind) && spec.pool === pool ? [index] : []));

/** The same row as heard by a listener that hears every open run. */
const hearingAll = (row: Row): Row => {
  const specs = row.specs.map((spec): Spec => (spec.kind === 'unheard' ? { ...spec, kind: 'heard' } : spec));
  return { ...row, specs, heard: allHeard };
};

describe('the table', () => {
  it('has every run list of length 0 to 3, times the flag, times what the key names', () => {
    // 9 run specs (5 closed kinds, 2 open kinds times 2 pools), lists of 0..3.
    expect(ALL_RUN_LISTS.length).toBe(1 + 9 + 81 + 729);
    expect(ROWS.length).toBe((1 + 9 + 81 + 729) * 2 * 3);
    expect(new Set(ROWS.map((row) => row.label)).size).toBe(ROWS.length);
    expect(MAX_LOST).toBe(3);
  });
});

/**
 * Every promise the table checks, each as its own test, so that it can be
 * asked of other rows too.
 */
function tableTests(rows: () => Row[]) {
  it('holder: the first open heard run, or null', () => {
    everyRow((row) => {
      const got = holder(row.task, row.heard)?.id ?? null;
      const want = expectedHolder(row);
      return got === want ? null : `holder ${got}, expected ${want}`;
    }, rows());
  });

  it("ending: the first final run's status; else null while held; else failed with 3 lost; else cancelled if flagged; else null", () => {
    everyRow((row) => {
      const got = ending(row.task, row.heard);
      const want = expectedEnding(row);
      return got === want ? null : `ending ${got}, expected ${want}`;
    }, rows());
  });

  it('ending with allHeard: what a listener that hears every open run reads', () => {
    everyRow((row) => {
      const got = ending(row.task, allHeard);
      const want = expectedEnding(hearingAll(row));
      return got === want ? null : `ending ${got}, expected ${want}`;
    }, rows());
  });

  it('endingRun: the first run in list order with a final status', () => {
    everyRow((row) => {
      const at = firstFinal(row.specs);
      const got = endingRun(row.task)?.id ?? null;
      const want = at < 0 ? null : runId(at);
      return got === want ? null : `endingRun ${got}, expected ${want}`;
    }, rows());
  });

  it('taskState: exactly one of the seven states, the one the header gives', () => {
    everyRow((row) => {
      const got = taskState(row.task, row.heard);
      const want = expectedState(row);
      if (!STATES.includes(got)) {
        return `state ${got}`;
      }
      return got === want ? null : `state ${got}, expected ${want}`;
    }, rows());
  });

  it('taskState with allHeard', () => {
    everyRow((row) => {
      const got = taskState(row.task, allHeard);
      const want = expectedState(hearingAll(row));
      return got === want ? null : `state ${got}, expected ${want}`;
    }, rows());
  });

  it('isFinished(taskState) exactly when ending is not null', () => {
    everyRow((row) => {
      const finished = isFinished(taskState(row.task, row.heard));
      const ended = ending(row.task, row.heard) !== null;
      return finished === ended ? null : `finished ${finished}, ended ${ended}`;
    }, rows());
  });

  it('isWanted: no run ended it, not flagged, fewer than 3 lost', () => {
    everyRow((row) => {
      const got = isWanted(row.task);
      const want = expectedWanted(row);
      return got === want ? null : `isWanted ${got}, expected ${want}`;
    }, rows());
  });

  it('isWanted is what a listener that hears nobody reads as not ended', () => {
    everyRow((row) => {
      const wanted = isWanted(row.task);
      const open = ending(row.task, hearsNone) === null;
      return wanted === open ? null : `isWanted ${wanted}, ending with nobody heard ${ending(row.task, hearsNone)}`;
    }, rows());
  });

  it('a task that has ended, for any listener, is not wanted', () => {
    everyRow((row) => {
      for (const heard of [row.heard, allHeard, hearsNone]) {
        if (ending(row.task, heard) !== null && isWanted(row.task)) {
          return `ended ${ending(row.task, heard)} and wanted`;
        }
      }
      return null;
    }, rows());
  });

  it('mayClaim for P and for Q: wanted, the key names this, nobody heard holds it, and that pool has no open run', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q'] as const) {
        const got = mayClaim(row.task, pool, row.is, row.heard);
        const want = expectedClaim(row, pool);
        if (got !== want) {
          return `mayClaim(${pool}) ${got}, expected ${want}`;
        }
      }
      return null;
    }, rows());
  });

  it('stopReason for every open run of P and of Q', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q'] as const) {
        for (const index of openRunsOf(row, pool)) {
          const got = stopReason(row.task, runId(index), row.is, row.heard);
          const want = expectedStop(row, index);
          if (got !== want) {
            return `stopReason(${runId(index)}) ${got}, expected ${want}`;
          }
        }
      }
      return null;
    }, rows());
  });

  it("stopReason is 'yielded' for a run that is not in the list or is already complete", () => {
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
    }, rows());
  });

  it('gone for every open run: what it would be stopped for with nobody heard, else lost', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q'] as const) {
        for (const index of openRunsOf(row, pool)) {
          const got = gone(row.task, runId(index), row.is);
          const want = expectedGone(row);
          if (got !== want) {
            return `gone(${runId(index)}) ${got}, expected ${want}`;
          }
        }
      }
      return null;
    }, rows());
  });

  it('orphans: the open runs bearing the pool name that it does not have', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q', 'R'] as const) {
        const mine = row.specs.flatMap((spec, index) => (openKind(spec.kind) && spec.pool === pool ? [runId(index)] : []));
        // having none, and having the first of its open runs
        for (const has of [[], mine.slice(0, 1)]) {
          const got = orphans(row.task, pool, (id) => has.includes(id)).map((run) => run.id);
          const want = mine.filter((id) => !has.includes(id));
          if (got.join() !== want.join()) {
            return `orphans(${pool}, has ${has}) ${got}, expected ${want}`;
          }
        }
      }
      return null;
    }, rows());
  });

  it('mayDelist: the key names this, and the task has ended for this listener', () => {
    everyRow((row) => {
      const got = mayDelist(row.task, row.is, row.heard);
      const want = row.is === 'this' && expectedEnding(row) !== null;
      return got === want ? null : `mayDelist ${got}, expected ${want}`;
    }, rows());
  });

  it('mayRelist: the key names none, the task is wanted, nobody heard holds it, and the lapse has passed', () => {
    const noneSince = 50_000;
    everyRow((row) => {
      for (const waited of [0, LAPSE_MS - 1, LAPSE_MS, LAPSE_MS + 1]) {
        const got = mayRelist(row.task, row.is, row.heard, noneSince, noneSince + waited);
        const want = row.is === 'none' && expectedWanted(row) && !isHeldIn(row) && waited >= LAPSE_MS;
        if (got !== want) {
          return `mayRelist after ${waited} ms ${got}, expected ${want}`;
        }
      }
      return null;
    }, rows());
  });

  it('never leaves a pool both free to claim and carrying on a run of the task', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q'] as const) {
        const claim = mayClaim(row.task, pool, row.is, row.heard);
        const carriesOn = openRunsOf(row, pool).some(
          (index) => stopReason(row.task, runId(index), row.is, row.heard) === null,
        );
        if (claim && carriesOn) {
          return `${pool} may claim while one of its runs carries on`;
        }
      }
      return null;
    }, rows());
  });

  it('the neither-wanted-nor-ended tasks are exactly those held while flagged or with 3 lost and no run ending them', () => {
    everyRow((row) => {
      const neither = !isWanted(row.task) && ending(row.task, row.heard) === null;
      const want = !endedByRun(row) && (row.flagged || lostIn(row.specs) >= 3) && isHeldIn(row);
      if (neither !== want) {
        return `neither ${neither}, expected ${want}`;
      }
      // what such a task reads as, and that no pool takes it again
      if (neither) {
        const state = taskState(row.task, row.heard);
        if (state !== (row.flagged ? 'stopping' : 'running')) {
          return `state ${state}`;
        }
        if (mayClaim(row.task, 'R', row.is, hearsNone) || mayRelist(row.task, 'none', hearsNone, 0, LAPSE_MS)) {
          return 'taken or listed again';
        }
      }
      return null;
    }, rows());
  });
}

describe('every task with up to three runs', () => {
  tableTests(() => ROWS);

  it('holder, ending and taskState of a task that is not here yet: null, null, waiting', () => {
    expect(holder(undefined, allHeard)).toBeNull();
    expect(ending(undefined, hearsNone)).toBeNull();
    expect(taskState(undefined, allHeard)).toBe('waiting');
    expect(isWanted(undefined)).toBe(false);
    expect(mayClaim(undefined, 'P', 'this', hearsNone)).toBe(false);
    expect(mayRelist(undefined, 'none', hearsNone, 0, LAPSE_MS * 2)).toBe(false);
    expect(mayDelist(undefined, 'this', hearsNone)).toBe(false);
    expect(orphans(undefined, 'P', () => false)).toEqual([]);
  });

  it('allHeard counts any run, named or not, as heard', () => {
    expect(['r0', 'nobody', ''].every((id) => allHeard(id))).toBe(true);
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

describe('bounded starts', () => {
  it('a task with 3 lost runs is not wanted, so nobody may claim it, whatever is heard', () => {
    const rows = ROWS.filter((row) => lostIn(row.specs) === 3);
    expect(rows.length).toBe(2 * 3);
    everyRow((row) => {
      if (isWanted(row.task)) {
        return 'wanted';
      }
      for (const pool of ['P', 'Q', 'R']) {
        for (const heard of [row.heard, hearsNone, allHeard]) {
          if (mayClaim(row.task, pool, row.is, heard)) {
            return `${pool} may claim`;
          }
        }
      }
      return null;
    }, rows);
  });
});

// Lists of three runs cannot hold MAX_LOST lost runs beside anything else, so
// the table above never asks about a task that lost three runs while a run of
// it is still open, finished, or heard. These rows are every list of three
// lost runs with one more run of any kind at any place. One more run is
// enough: once three runs are lost, the ending, the state and every pool's and
// asker's decision depend on no other run but the first one that ended the
// task and the first one heard, and one extra run can put such a run before,
// between or after the lost ones.

const LOST: Spec = { kind: 'lost', pool: 'P' };

const THREE_LOST_AND_ONE = [
  ...new Map(
    SPECS.flatMap((spec) =>
      [0, 1, 2, 3].map((at): Spec[] => {
        const specs = [LOST, LOST, LOST];
        specs.splice(at, 0, spec);
        return specs;
      }),
    ).map((specs) => [specs.map((s) => `${s.pool}:${s.kind}`).join(','), specs] as const),
  ).values(),
];

const LOST_ROWS = rowsFor(THREE_LOST_AND_ONE);

describe('every task with three runs lost and one more', () => {
  it('has the four places for each of the eight other run specs, and the one list of four lost runs', () => {
    expect(THREE_LOST_AND_ONE.length).toBe(8 * 4 + 1);
    expect(LOST_ROWS.length).toBe((8 * 4 + 1) * 2 * 3);
  });

  tableTests(() => LOST_ROWS);

  it('with a run heard and none ending it: running, or stopping if flagged; not ended, not delisted, and the heard run carries on unless flagged or its key names another', () => {
    const rows = LOST_ROWS.filter((row) => isHeldIn(row) && !endedByRun(row));
    // heard of P and of Q, at four places, times the flag, times what the key names
    expect(rows.length).toBe(2 * 4 * 2 * 3);
    everyRow((row) => {
      const state = taskState(row.task, row.heard);
      if (state !== (row.flagged ? 'stopping' : 'running')) {
        return `state ${state}`;
      }
      if (ending(row.task, row.heard) !== null || mayDelist(row.task, row.is, row.heard)) {
        return 'ended or delisted';
      }
      const at = row.specs.findIndex((spec) => spec.kind === 'heard');
      const want = row.flagged ? 'cancelled' : row.is === 'other' ? 'yielded' : null;
      const got = stopReason(row.task, runId(at), row.is, row.heard);
      return got === want ? null : `the heard run is told ${got}, expected ${want}`;
    }, rows);
  });

  it("with nobody heard and nothing ending it: 'failed', flagged or not", () => {
    const rows = LOST_ROWS.filter((row) => !isHeldIn(row) && !endedByRun(row));
    // unheard of P and of Q, and yielded, at four places, and four lost, times the flag, times the key
    expect(rows.length).toBe((3 * 4 + 1) * 2 * 3);
    everyRow((row) => (taskState(row.task, row.heard) === 'failed' ? null : `state ${taskState(row.task, row.heard)}`), rows);
  });
});

// What a reading of "ended" may do afterwards

/** Every change a document may legally see next, with who may make it, on a task as a reader has it. */
function legalChanges(task: Task): { label: string; apply: (task: Task) => void }[] {
  const changes: { label: string; apply: (task: Task) => void }[] = [];
  // A pool appends a run only when it may take the task; one that hears
  // nobody and has no run of it is the most a pool can be allowed.
  if (mayClaim(task, 'R', 'this', hearsNone)) {
    changes.push({ label: 'append', apply: (it) => claimRun(it, { id: 'new', pool: 'R', start: 999 }) });
  }
  for (const run of task.runs.filter(isOpen)) {
    for (const status of STATUSES) {
      changes.push({
        label: `complete ${run.id} ${status}`,
        apply: (it) => endRun(it, run.id, { status, result: 'late', end: 999 }),
      });
    }
  }
  changes.push({
    label: 'flag',
    apply: (it) => {
      it.cancelled = true;
    },
  });
  return changes;
}

describe('a reading of "ended", with every open run heard', () => {
  // Each change is tried on every row read as ended by a listener that hears
  // every open run (the row's own hearing where it hears them all, and
  // allHeard on every row). Each change leaves every open run heard and gives
  // a row of the table again (it completes a run, sets the flag, or appends to
  // a task that, being ended, never takes an append), so a sequence of
  // changes is a sequence of single steps checked here.
  const readers: [string, Row[]][] = [
    ['its own hearing, where it hears every open run', ROWS.filter((row) => !row.specs.some((spec) => spec.kind === 'unheard'))],
    ['allHeard', ROWS.map((row) => ({ ...row, heard: allHeard }))],
  ];

  for (const [name, rows] of readers) {
    it(`with ${name}: no legal change alters it, except completing an earlier open run with a final status after a later run ended the task`, () => {
      let exercised = 0;
      let admitted = 0;
      everyRow((row) => {
        const was = ending(row.task, row.heard);
        if (was === null) {
          return null;
        }
        for (const { label, apply } of legalChanges(row.task)) {
          exercised++;
          const after = copy(row.task);
          apply(after);
          const now = ending(after, row.heard);
          if (now === was && endingRun(after)?.id === endingRun(row.task)?.id) {
            continue;
          }
          // the one admitted: an open run before the run that ended the task is completed with a final status
          const by = firstFinal(row.specs);
          const completed = after.runs.findIndex((run, index) => isOpen(row.task.runs[index] ?? { status: 'lost' }) && !isOpen(run));
          if (by >= 0 && completed >= 0 && completed < by && FINALS.includes(after.runs[completed].status as FinalStatus)) {
            admitted++;
            continue;
          }
          return `${label} turns ${was} into ${now}`;
        }
        return null;
      }, rows);
      expect(exercised).toBeGreaterThan(0);
      expect(admitted).toBeGreaterThan(0);
    });
  }

  it('no ended task ever takes an append: ended for any listener means not wanted', () => {
    everyRow((row) => {
      if (ending(row.task, allHeard) !== null && legalChanges(row.task).some((change) => change.label === 'append')) {
        return 'an ended task may be taken';
      }
      return null;
    });
  });

  it('a pool that has seen the later ending never makes the admitted change: its earlier run yields, which ends nothing', () => {
    let exercised = 0;
    everyRow((row) => {
      const at = firstFinal(row.specs);
      const was = ending(row.task, row.heard);
      for (let earlier = 0; earlier < at; earlier++) {
        if (!openKind(row.specs[earlier].kind)) {
          continue;
        }
        exercised++;
        for (const heard of [row.heard, allHeard, hearsNone]) {
          const why = stopReason(row.task, runId(earlier), row.is, heard);
          if (why !== 'yielded') {
            return `earlier ${runId(earlier)} is told ${why}`;
          }
        }
        if (gone(row.task, runId(earlier), row.is) !== 'yielded') {
          return `earlier ${runId(earlier)} is recorded ${gone(row.task, runId(earlier), row.is)} by its pool after a restart`;
        }
        const after = copy(row.task);
        endRun(after, runId(earlier), { status: 'yielded', end: 999 });
        if (ending(after, row.heard) !== was) {
          return `recording ${runId(earlier)} yielded changes the ending to ${ending(after, row.heard)}`;
        }
      }
      return null;
    });
    expect(exercised).toBeGreaterThan(0);
  });

  it('the admitted change, read by a listener who heard the earlier run all along: the later run ended it, then the earlier one did', () => {
    // The header puts the only change of a reading on "a run the reader could
    // not hear". This history changes a reading where the reader heard the
    // earlier run throughout: its pool was heard here but had not yet
    // received the later run's end when its code returned.
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }, makeRun({ kind: 'succeeded', pool: 'Q' }, 1)]);
    const reader = hearing('A');
    expect(holder(task, reader)?.id).toBe('A');
    expect(ending(task, reader)).toBe('succeeded');
    expect(taskState(task, reader)).toBe('succeeded');
    endRun(task, 'A', { status: 'failed', end: 2 });
    expect(ending(task, reader)).toBe('failed');
  });
});

describe('the three old "finished state flips" histories, replayed', () => {
  // (1) Runs [lost, lost, A open by P]. Q cannot hear A and claims B. P
  // restarts and records A as `gone` says. Then B succeeds.
  const historyOne = () => {
    const task = makeTask([makeRun(LOST, 0), makeRun(LOST, 1), { id: 'A', pool: 'P', start: 2 }]);
    expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
    claimRun(task, { id: 'B', pool: 'Q', start: 3 });
    expect(gone(task, 'A', 'this')).toBe('lost');
    endRun(task, 'A', { status: gone(task, 'A', 'this'), end: 4 });
    return task;
  };

  it('(1) with B heard: running (three lost runs do not end a held task), then succeeded; never failed', () => {
    const task = historyOne();
    expect(task.runs.filter((run) => run.status === 'lost')).toHaveLength(3);
    expect(taskState(task, hearing('B'))).toBe('running');
    expect(stopReason(task, 'B', 'this', hearing('B'))).toBeNull();
    endRun(task, 'B', { status: 'succeeded', result: 1, end: 5 });
    expect(taskState(task, hearing('B'))).toBe('succeeded');
  });

  it('(1) with B not heard: failed, and B succeeding afterwards turns it to succeeded (the admitted flip)', () => {
    const task = historyOne();
    expect(taskState(task, hearsNone)).toBe('failed');
    endRun(task, 'B', { status: 'succeeded', result: 1, end: 5 });
    expect(taskState(task, hearsNone)).toBe('succeeded');
  });

  // (2) A flagged task whose one run A is open. Then A succeeds (its pool had
  // not yet seen the flag).
  const historyTwo = () => makeTask([{ id: 'A', pool: 'P', start: 0 }], true);

  it('(2) with A heard: stopping, then succeeded; never cancelled', () => {
    const task = historyTwo();
    expect(taskState(task, hearing('A'))).toBe('stopping');
    endRun(task, 'A', { status: 'succeeded', result: 1, end: 1 });
    expect(taskState(task, hearing('A'))).toBe('succeeded');
  });

  it('(2) with A not heard: cancelled, then succeeded (the admitted flip)', () => {
    const task = historyTwo();
    expect(taskState(task, hearsNone)).toBe('cancelled');
    endRun(task, 'A', { status: 'succeeded', result: 1, end: 1 });
    expect(taskState(task, hearsNone)).toBe('succeeded');
  });

  // (3) A flagged task with two lost runs and A open. A's pool restarts.
  const historyThree = () =>
    makeTask([makeRun(LOST, 0), makeRun(LOST, 1), { id: 'A', pool: 'P', start: 2 }], true);

  it("(3) A's pool, restarting, records A as cancelled (gone), so the reading stays cancelled for every listener", () => {
    const task = historyThree();
    expect(taskState(task, hearing('A'))).toBe('stopping');
    expect(taskState(task, hearsNone)).toBe('cancelled');
    expect(gone(task, 'A', 'this')).toBe('cancelled');
    endRun(task, 'A', { status: gone(task, 'A', 'this'), end: 3 });
    expect(taskState(task, hearing('A'))).toBe('cancelled');
    expect(taskState(task, hearsNone)).toBe('cancelled');
  });

  it("(3) if A's pool recorded A lost before it saw the flag: with A heard, stopping then failed; with A not heard, cancelled then failed (the admitted flip)", () => {
    const heard = historyThree();
    expect(taskState(heard, hearing('A'))).toBe('stopping');
    endRun(heard, 'A', { status: 'lost', end: 3 });
    expect(taskState(heard, hearing('A'))).toBe('failed');

    const unheard = historyThree();
    expect(taskState(unheard, hearsNone)).toBe('cancelled');
    endRun(unheard, 'A', { status: 'lost', end: 3 });
    expect(taskState(unheard, hearsNone)).toBe('failed');
  });
});

describe('two listeners that hear differently', () => {
  it('read a flagged task with an open run as stopping and as cancelled, and agree once the run is completed as its pool would', () => {
    for (const [status, want] of [
      ['cancelled', 'cancelled'],
      ['succeeded', 'succeeded'],
      ['lost', 'cancelled'],
      ['yielded', 'cancelled'],
    ] as const) {
      const task = makeTask([{ id: 'A', pool: 'P', start: 0 }], true);
      expect(taskState(task, hearing('A'))).toBe('stopping');
      expect(taskState(task, hearsNone)).toBe('cancelled');
      endRun(task, 'A', { status, end: 1 });
      expect([taskState(task, hearing('A')), taskState(task, hearsNone)], status).toEqual([want, want]);
    }
  });

  it('a pool that cannot hear an open run of another pool may delist a flagged task; nothing wanted is lost by it', () => {
    const task = makeTask([{ id: 'A', pool: 'X', start: 0 }], true);
    expect(mayDelist(task, 'this', hearsNone)).toBe(true);
    expect(mayDelist(task, 'this', hearing('A'))).toBe(false);
    expect(isWanted(task)).toBe(false);
    // and nobody lists it again
    expect(mayRelist(task, 'none', hearsNone, 0, LAPSE_MS * 10)).toBe(false);
  });

  it('a flagged task whose open run has a pool gone for good: a reader with no ears reads stopping for ever, a listener cancelled after the lapse', () => {
    const task = makeTask([{ id: 'A', pool: 'gone for good', start: 0 }], true);
    expect(taskState(task, allHeard)).toBe('stopping');
    expect(taskState(task, hearsNone)).toBe('cancelled');
    // and with three lost runs besides, running for ever and failed
    const lostToo = makeTask([makeRun(LOST, 0), makeRun(LOST, 1), makeRun(LOST, 2), { id: 'A', pool: 'gone', start: 3 }]);
    expect(taskState(lostToo, allHeard)).toBe('running');
    expect(taskState(lostToo, hearsNone)).toBe('failed');
  });
});

describe('gone, at a restart', () => {
  it('records lost even with an earlier open run in the list, heard by others or not: who else holds the task is not asked', () => {
    const task = makeTask([{ id: 'E', pool: 'X', start: 0 }, { id: 'M', pool: 'P', start: 1 }]);
    expect(gone(task, 'M', 'this')).toBe('lost');
    // while a pool that hears E would have told M to yield
    expect(stopReason(task, 'M', 'this', hearing('E'))).toBe('yielded');
  });

  it('three lost runs with a fourth run going on that is then lost: running while it is heard, failed after', () => {
    const task = makeTask([makeRun(LOST, 0), makeRun(LOST, 1), makeRun(LOST, 2), { id: 'D', pool: 'P', start: 3 }]);
    expect(taskState(task, hearing('D'))).toBe('running');
    expect(stopReason(task, 'D', 'this', hearing('D'))).toBeNull();
    expect(gone(task, 'D', 'this')).toBe('lost');
    endRun(task, 'D', { status: 'lost', end: 4 });
    expect(taskState(task, hearing('D'))).toBe('failed');
    expect(taskError(task, hearing('D'))).toContain('stopped 3 times');
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

  it("refuses '__proto__' as a key, and writes nothing", () => {
    const queue: Queue = { jobs: {} };
    expect(() => listTask(queue, '__proto__', entry('T1'))).toThrow(/__proto__/);
    expect(Object.getPrototypeOf(queue.jobs)).toBe(Object.prototype);
    expect(waitingWork(queue)).toEqual([]);
  });

  it("lists under 'constructor', 'toString' and 'hasOwnProperty', which a plain object already answers to", () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
      const queue: Queue = { jobs: {} };
      listTask(queue, key, entry('T1'));
      expect(Object.hasOwn(queue.jobs, key), key).toBe(true);
      expect(entryAt(queue, key)?.taskUrl, key).toBe(url('T1'));
    }
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

  it('does nothing to an empty key, a key only the prototype answers to, or a queue with no jobs', () => {
    const queue: Queue = { jobs: {} };
    for (const key of ['K', 'constructor', 'toString', '__proto__']) {
      delistTask(queue, key, url('T1'));
    }
    expect(queue.jobs).toEqual({});
    expect(typeof queue.jobs.toString).toBe('function');
    expect(() => delistTask({} as Queue, 'K', url('T1'))).not.toThrow();
  });
});

describe('named, entryAt and waitingWork', () => {
  it("named says 'this', 'other' or 'none', and treats what is not an entry as none", () => {
    const queue = { jobs: { K: { taskUrl: url('T1'), askedAt: 1, package: null }, J: 'junk' } } as unknown as Queue;
    expect(named(queue, 'K', url('T1'))).toBe('this');
    expect(named(queue, 'K', url('T2'))).toBe('other');
    expect(named(queue, 'J', url('T1'))).toBe('none');
    expect(named(queue, 'X', url('T1'))).toBe('none');
    expect(named(undefined, 'K', url('T1'))).toBe('none');
    expect(entryAt(queue, 'J')).toBeNull();
    expect(entryAt({} as Queue, 'K')).toBeNull();
  });

  // Every key, listed and not, on a plain object and on a real Automerge
  // document: entryAt finds it exactly when named does and waitingWork lists it.
  const KEYS = ['K', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', ''];
  const agree = (queue: Queue, label: string) => {
    const work = waitingWork(queue).map((it) => it.key);
    for (const key of KEYS) {
      const found = entryAt(queue, key);
      const is = named(queue, key, found?.taskUrl ?? url('nothing'));
      expect([found !== null, is !== 'none', work.includes(key)], `${label} ${JSON.stringify(key)}`).toEqual([
        work.includes(key),
        work.includes(key),
        work.includes(key),
      ]);
    }
    return work;
  };

  it('agree for every key, listed or not, on a plain object', () => {
    const empty: Queue = { jobs: {} };
    expect(agree(empty, 'empty')).toEqual([]);
    const full: Queue = { jobs: {} };
    for (const key of KEYS.filter((it) => it !== '__proto__')) {
      listTask(full, key, { taskUrl: url(`T${key}`), askedAt: 1, package: null });
    }
    expect(agree(full, 'full').sort()).toEqual(KEYS.filter((it) => it !== '__proto__').sort());
  });

  it("agree for every key, listed or not, on a real Automerge document, including a '__proto__' written by hand", () => {
    const base = A.from<Queue>({ jobs: {} }, actor('0'));
    expect(agree(base, 'empty')).toEqual([]);
    const doc = A.change(replica(base, 'a'), (queue) => {
      for (const key of KEYS.filter((it) => it !== '__proto__')) {
        listTask(queue, key, { taskUrl: url(`T${key}`), askedAt: 1, package: null });
      }
      // anyone can write a queue: a key the rules refuse, written directly
      (queue.jobs as any)['__proto__'] = { taskUrl: url('Tproto'), askedAt: 0, package: null };
    });
    const merged = A.merge(replica(base, 'b'), doc);
    for (const it of [doc, merged]) {
      expect(agree(it, 'automerge').sort()).toEqual(KEYS.filter((key) => key !== '__proto__').sort());
      expect(named(it, '__proto__', url('Tproto'))).toBe('none');
    }
  });

  it("on a real Automerge document, listTask refuses '__proto__' inside a change, which makes the change throw and write nothing", () => {
    const doc = A.from<Queue>({ jobs: {} }, actor('0'));
    const heads = A.getHeads(doc);
    expect(() =>
      A.change(doc, (queue) => listTask(queue, '__proto__', { taskUrl: url('T1'), askedAt: 1, package: null })),
    ).toThrow(/__proto__/);
    expect(A.getHeads(doc)).toEqual(heads);
    const next = A.change(doc, (queue) => listTask(queue, 'K', { taskUrl: url('T2'), askedAt: 1, package: null }));
    expect(waitingWork(next).map((it) => it.key)).toEqual(['K']);
  });
});

describe('isTask', () => {
  it('is a document with a string importUrl and a list of runs, and nothing else', () => {
    expect(isTask(makeTask())).toBe(true);
    expect(isTask({ importUrl: 'x', runs: [] })).toBe(true);
    for (const it of [
      undefined,
      null,
      'task',
      7,
      [],
      {},
      { importUrl: 'x' },
      { runs: [] },
      { importUrl: 1, runs: [] },
      { importUrl: 'x', runs: {} },
      { importUrl: 'x', runs: 'r' },
    ]) {
      expect(isTask(it), JSON.stringify(it)).toBe(false);
    }
  });

  const NOT_TASKS = [{ title: 'not a task' }, { importUrl: 'x' }, { runs: [] }, { importUrl: 'x', runs: 'r' }] as unknown as Task[];

  it.fails('RULE HOLE: isWanted calls a document that is not a task wanted, so an asker waiting on one lists it again (mayRelist), and no pool will ever delist it', () => {
    for (const notATask of NOT_TASKS) {
      const label = JSON.stringify(notATask);
      expect(mayDelist(notATask, 'this', hearsNone), label).toBe(false);
      expect(isWanted(notATask), label).toBe(false);
      expect(mayRelist(notATask, 'none', hearsNone, 0, LAPSE_MS), label).toBe(false);
    }
  });

  it('a pool never takes a document that is not a task; every reading of it answers without throwing', () => {
    for (const notATask of NOT_TASKS) {
      expect(mayClaim(notATask, 'P', 'this', hearsNone), JSON.stringify(notATask)).toBe(false);
    }
    // a document with no runs at all reads as a task nobody has taken
    const noRuns = { title: 'not a task' } as unknown as Task;
    expect(holder(noRuns, allHeard)).toBeNull();
    expect(ending(noRuns, allHeard)).toBeNull();
    expect(taskState(noRuns, allHeard)).toBe('waiting');
    expect(mayDelist(noRuns, 'this', allHeard)).toBe(false);
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

  it('replaces the open run with a new value rather than writing into it', () => {
    const task = openTask();
    const before = task.runs[0];
    endRun(task, 'A', { status: 'lost', end: 5 });
    expect(task.runs[0]).not.toBe(before);
    expect(before).toEqual({ id: 'A', pool: 'P', start: 0 });
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
    expect(taskError(task, allHeard)).toContain(`${MAX_RESULT_BYTES + 1} bytes`);
  });

  it('counts bytes in UTF-8, not UTF-16 units: a result under the limit in units and twice it in bytes fails', () => {
    // Each of these characters is two UTF-16 units and four UTF-8 bytes.
    const result = '\u{1F600}'.repeat(Math.floor(MAX_RESULT_BYTES / 2) - 2);
    expect(JSON.stringify(result).length).toBeLessThan(MAX_RESULT_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeGreaterThan(MAX_RESULT_BYTES * 1.9);
    const task = openTask();
    endRun(task, 'A', { status: 'succeeded', result, end: 1 });
    expect(task.runs[0].status).toBe('failed');
    // and a result of exactly the limit in bytes, made of characters of two bytes each, is kept
    const exact = 'é'.repeat((MAX_RESULT_BYTES - 2) / 2);
    expect(new TextEncoder().encode(JSON.stringify(exact)).length).toBe(MAX_RESULT_BYTES);
    const kept = openTask();
    endRun(kept, 'A', { status: 'succeeded', result: exact, end: 1 });
    expect(kept.runs[0].status).toBe('succeeded');
  });

  it('fails a run whose result JSON cannot serialise: circular, a BigInt, a function, a symbol', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const result of [circular, 1n, () => 1, Symbol('s')]) {
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

  it('keeps a result as JSON: undefined fields dropped, a Map or a Set an empty object, a Date its string, NaN null; and the change does not throw on real Automerge', () => {
    const cases: [unknown, unknown][] = [
      [{ a: undefined, b: 1 }, { b: 1 }],
      [new Map([[1, 2]]), {}],
      [new Set([1]), {}],
      [{ m: new Map([['k', 'v']]) }, { m: {} }],
      [new Date(0), '1970-01-01T00:00:00.000Z'],
      [[1, undefined, NaN], [1, null, null]],
      [{ toJSON: () => 'mine' }, 'mine'],
    ];
    for (const [result, stored] of cases) {
      const plain = openTask();
      endRun(plain, 'A', { status: 'succeeded', result, end: 1 });
      expect(plain.runs[0].result).toEqual(stored);
      let doc = A.from<Task>(openTask(), actor('0'));
      expect(() => {
        doc = A.change(doc, (task) => endRun(task, 'A', { status: 'succeeded', result, end: 1 }));
      }).not.toThrow();
      expect(doc.runs[0].status).toBe('succeeded');
      expect(doc.runs[0].result).toEqual(stored);
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
    expect(taskError(task, allHeard)).toBe(`line ${MAX_LOG_LINES + 49}`);
  });

  it('keeps exactly MAX_LOG_LINES lines when a result is too big, the last of them the line saying so', () => {
    for (const count of [MAX_LOG_LINES - 1, MAX_LOG_LINES, MAX_LOG_LINES + 1]) {
      const logs = Array.from({ length: count }, (_, n) => line(n));
      const task = openTask();
      endRun(task, 'A', { status: 'succeeded', result: 'x'.repeat(MAX_RESULT_BYTES), logs, end: 1 });
      const kept = task.runs[0].logs ?? [];
      expect(kept.length, `${count} lines`).toBe(Math.min(count + 1, MAX_LOG_LINES));
      expect(kept.at(-1)?.message).toContain('bytes');
      expect(kept.at(-2)).toEqual(line(count - 1));
    }
  });

  it('normalises log lines with odd fields to a number and a string, and drops other fields', () => {
    const task = openTask();
    const odd = [
      { timestampMillis: '5', message: 42, extra: true },
      { timestampMillis: 'soon', message: null },
      { message: 'no time' },
      { timestampMillis: 7 },
    ] as never;
    endRun(task, 'A', { status: 'failed', logs: odd, end: 1 });
    expect(task.runs[0].logs).toEqual([
      { timestampMillis: 5, message: '42' },
      { timestampMillis: 0, message: 'null' },
      { timestampMillis: 0, message: 'no time' },
      { timestampMillis: 7, message: 'undefined' },
    ]);
    // and the change goes through on real Automerge
    let doc = A.from<Task>(openTask(), actor('0'));
    doc = A.change(doc, (it) => endRun(it, 'A', { status: 'failed', logs: odd, end: 1 }));
    expect(doc.runs[0].logs).toEqual(task.runs[0].logs);
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
function actor(digit: string) {
  return digit.repeat(32);
}

const replica = <T>(doc: A.Doc<T>, digit: string) => A.clone(doc, actor(digit));

/** Merges each into a copy of the other: the two replicas after they sync. */
function syncBoth<T>(x: A.Doc<T>, y: A.Doc<T>): [A.Doc<T>, A.Doc<T>] {
  return [A.merge(A.clone(x), y), A.merge(A.clone(y), x)];
}

/** Merges every document into a copy of the first. */
const mergeAll = <T>(first: A.Doc<T>, ...rest: A.Doc<T>[]) => rest.reduce((doc, other) => A.merge(doc, other), A.clone(first));

const ids = (task: Task) => task.runs.map((run) => run.id);

describe('merges', () => {
  const baseTask = (runs: Run[] = [], flagged = false) => A.from<Task>(makeTask(runs, flagged), actor('0'));
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
      expect(holder(doc, allHeard)?.id).toBe(first);
      expect(stopReason(doc, first, 'this', allHeard)).toBeNull();
      expect(stopReason(doc, second, 'this', allHeard)).toBe('yielded');
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
        expect(stopReason(doc, 'C', 'this', allHeard), label).toBe('yielded');
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

    it('listed over an earlier entry while another replica delists that entry: the new entry survives on both, for both actor orders', () => {
      for (const [del, put] of [
        ['a', 'b'],
        ['b', 'a'],
      ]) {
        const base = baseQueue({ K: entry('T0') });
        const delisted = A.change(replica(base, del), (queue) => delistTask(queue, 'K', url('T0')));
        const relisted = A.change(replica(base, put), (queue) => listTask(queue, 'K', entry('T2'), url('T0')));
        for (const doc of syncBoth(delisted, relisted)) {
          expect(named(doc, 'K', url('T2'))).toBe('this');
        }
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
        expect(ending(doc, allHeard)).toBe(first);
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
      expect(ending(doc, hearsNone)).toBe('succeeded');
      expect(taskState(doc, allHeard)).toBe('succeeded');
      expect(taskResult(doc)).toBe(42);
    }
  });

  it("three lost runs recorded by three pools at once read 'failed' everywhere, with no run marked failed", () => {
    const base = baseTask([open('A', 'P'), open('B', 'Q'), open('C', 'R')]);
    const [a, b, c] = (['A', 'B', 'C'] as const).map((id, n) =>
      A.change(replica(base, 'abc'[n]), (task) => endRun(task, id, { status: 'lost', end: 1 })),
    );
    for (const doc of [mergeAll(a, b, c), mergeAll(b, c, a), mergeAll(c, a, b)]) {
      expect(ending(doc, allHeard)).toBe('failed');
      expect(taskState(doc, allHeard)).toBe('failed');
      expect(doc.runs.some((run) => run.status === 'failed')).toBe(false);
      expect(taskError(doc, allHeard)).toContain('stopped 3 times');
      expect(mayClaim(doc, 'S', 'this', hearsNone)).toBe(false);
    }
  });

  describe('one run completed from two replicas at once (the pool before and after a restart)', () => {
    // The old incarnation writes `succeeded` with a result; the new one writes
    // `lost`. endRun puts one new value at the run's place in the list, so the
    // merge keeps one of the two values whole.
    const both = (oldActor: string, newActor: string) => {
      const base = baseTask([open('A', 'P')]);
      const old = A.change(replica(base, oldActor), (task) =>
        endRun(task, 'A', { status: 'succeeded', result: { x: 1, y: 2, z: 3 }, logs: [{ timestampMillis: 1, message: 'old' }], end: 1 }),
      );
      const restarted = A.change(replica(base, newActor), (task) =>
        endRun(task, 'A', { status: 'lost', logs: [{ timestampMillis: 2, message: 'new' }], end: 2 }),
      );
      return { old: old.runs[0], restarted: restarted.runs[0], merged: syncBoth(old, restarted) };
    };

    for (const [oldActor, newActor] of [
      ['a', 'b'],
      ['b', 'a'],
    ]) {
      it(`reads wholly as one of the two writes, the same on both replicas (old actor ${oldActor}, new actor ${newActor})`, () => {
        const { old, restarted, merged } = both(oldActor, newActor);
        const [one, two] = merged;
        expect(one.runs).toEqual(two.runs);
        expect(one.runs).toHaveLength(1);
        const run = copy(one.runs[0]);
        expect([old, restarted].some((write) => JSON.stringify(write) === JSON.stringify(run)), JSON.stringify(run)).toBe(true);
        for (const doc of [one, two]) {
          expect(isOpen(doc.runs[0])).toBe(false);
          expect(ending(doc, allHeard)).toBe(run.status === 'succeeded' ? 'succeeded' : null);
        }
      });
    }

    it('which write stands goes by the actor, so it can be either', () => {
      const standing = [both('a', 'b'), both('b', 'a')].map(({ merged }) => merged[0].runs[0].status).sort();
      expect(standing).toEqual(['lost', 'succeeded']);
    });
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
      expect(stopReason(doc, 'B', 'this', hearing('B'))).toBeNull();
      expect(holder(doc, allHeard)?.id).toBe('A');
      expect(stopReason(doc, 'B', 'this', allHeard)).toBe('yielded');
      expect(stopReason(doc, 'A', 'this', allHeard)).toBeNull();
      expect(taskState(doc, allHeard)).toBe('running');
    }
  });

  it('three pools claiming at once: every merge order gives one list, the first run holds and alone carries on for pools that hear all', () => {
    const base = baseTask();
    const claims = ['a', 'b', 'c'].map((digit, n) =>
      A.change(replica(base, digit), (task) => {
        expect(mayClaim(task, `P${n}`, 'this', hearsNone)).toBe(true);
        claimRun(task, { id: `R${n}`, pool: `P${n}`, start: 1 });
      }),
    );
    const [x, y, z] = claims;
    const replicas = [mergeAll(x, y, z), mergeAll(x, z, y), mergeAll(y, x, z), mergeAll(y, z, x), mergeAll(z, x, y), mergeAll(z, y, x)];
    for (const doc of replicas) {
      expect(ids(doc)).toEqual(ids(replicas[0]));
      const [first, second, third] = ids(doc);
      expect(holder(doc, allHeard)?.id).toBe(first);
      expect(ids(doc).filter((id) => stopReason(doc, id, 'this', allHeard) === null)).toEqual([first]);
      expect(stopReason(doc, third, 'this', hearing(second))).toBe('yielded');
      expect(stopReason(doc, second, 'this', hearing(third))).toBeNull();
      expect(ids(doc).every((id) => stopReason(doc, id, 'this', hearsNone) === null)).toBe(true);
    }
  });

  it('a pool restarting records its run lost while another pool claims the task: one list on both replicas, no ending, one run holds, and the restarted pool may not claim again while it hears that run', () => {
    const base = baseTask([open('A', 'P')]);
    const onQ = A.change(replica(base, 'b'), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 1 });
    });
    const onP = A.change(replica(base, 'a'), (task) => {
      // Its own open run keeps it from claiming until it records that run as gone says.
      expect(mayClaim(task, 'P', 'this', hearsNone)).toBe(false);
      expect(orphans(task, 'P', () => false).map((run) => run.id)).toEqual(['A']);
      endRun(task, 'A', { status: gone(task, 'A', 'this'), end: 1 });
      expect(mayClaim(task, 'P', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'C', pool: 'P', start: 2 });
    });
    const [one, two] = syncBoth(onP, onQ);
    expect(ids(one)).toEqual(ids(two));
    for (const doc of [one, two]) {
      expect(ids(doc)[0]).toBe('A');
      expect(ids(doc).slice(1).sort()).toEqual(['B', 'C']);
      expect(doc.runs.filter((run) => run.status === 'lost').map((run) => run.id)).toEqual(['A']);
      expect(ending(doc, allHeard)).toBeNull();
      const [, first, second] = ids(doc);
      expect(holder(doc, allHeard)?.id).toBe(first);
      expect(stopReason(doc, first, 'this', allHeard)).toBeNull();
      expect(stopReason(doc, second, 'this', allHeard)).toBe('yielded');
      expect(taskState(doc, allHeard)).toBe('running');
      for (const pool of ['P', 'Q']) {
        expect(mayClaim(doc, pool, 'this', allHeard)).toBe(false);
      }
    }
  });

  it('a flag crossing two runs: the first run in list order is the ending, whether it is the one stopped for the flag or the one that succeeded without seeing it', () => {
    for (const [statusA, statusB] of [
      ['succeeded', 'cancelled'],
      ['cancelled', 'succeeded'],
    ] as const) {
      const base = baseTask([open('A', 'P'), open('B', 'Q')]);
      const asker = A.change(replica(base, 'c'), (task) => {
        task.cancelled = true;
      });
      const complete = (id: string, digit: string, status: FinalStatus) => {
        const start = status === 'cancelled' ? A.merge(replica(base, digit), asker) : replica(base, digit);
        return A.change(start, (task) => {
          expect(stopReason(task, id, 'this', hearsNone)).toBe(status === 'cancelled' ? 'cancelled' : null);
          endRun(task, id, { status, result: id, end: 1 });
        });
      };
      const p = complete('A', 'a', statusA);
      const q = complete('B', 'b', statusB);
      for (const doc of [mergeAll(asker, p, q), mergeAll(q, p, asker), mergeAll(p, asker, q)]) {
        expect(ids(doc)).toEqual(['A', 'B']);
        expect(ending(doc, allHeard), `${statusA} then ${statusB}`).toBe(statusA);
        expect(taskState(doc, allHeard)).toBe(statusA);
        expect(taskResult(doc)).toBe(statusA === 'succeeded' ? 'A' : undefined);
      }
    }
  });

  // An ending that no run wrote (three lost runs, or the flag) is read off a
  // replica that has not yet received a claim made at the same time, on a
  // replica where the task was still wanted. When the claim arrives, the open
  // run it adds is heard from first sight, and the reading changes. No run the
  // reader could not hear was completed: the reader had not seen the run at
  // all. Smallest histories below; the first is the old hole (1) with the
  // other replica order.

  it.fails("RULE HOLE: an ending by three lost runs read on the restarted pool's replica changes when a claim made at the same time arrives, for a reader that hears every run", () => {
    const base = baseTask([makeRun(LOST, 0), makeRun(LOST, 1), open('A', 'P')]);
    // Q cannot hear A, and takes the task
    const onQ = A.change(replica(base, 'b'), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 3 });
    });
    // P restarts, and records A as gone says, before it has Q's claim
    const onP = A.change(replica(base, 'a'), (task) => endRun(task, 'A', { status: gone(task, 'A', 'this'), end: 4 }));
    expect(taskState(onP, allHeard)).toBe('failed');
    const merged = A.merge(A.clone(onP), onQ);
    // what it reads now, with every run heard: B holds it, and it has not ended
    expect(taskState(merged, allHeard)).toBe('failed');
  });

  it.fails("RULE HOLE: an ending by the flag read on the asker's replica changes when a claim made at the same time arrives, for a reader that hears every run, and can end up 'succeeded'", () => {
    const base = baseTask();
    const asker = A.change(replica(base, 'a'), (task) => {
      task.cancelled = true;
    });
    expect(taskState(asker, allHeard)).toBe('cancelled');
    const onQ = A.change(replica(base, 'b'), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 1 });
    });
    // Q's code returns before Q has the flag
    const done = A.change(onQ, (task) => endRun(task, 'B', { status: 'succeeded', result: 1, end: 2 }));
    const merged = A.merge(A.clone(asker), done);
    expect(taskState(merged, allHeard)).toBe('cancelled');
  });

  describe('a queue key over a longer history', () => {
    const baseQueue = (jobs: Queue['jobs'] = {}) => A.from<Queue>({ jobs }, actor('0'));
    const entry = (name: string) => ({ taskUrl: url(name), askedAt: 1, package: null });

    it('a replica that last saw the first entry and delists it leaves an entry listed after that one was replaced and delisted in turn', () => {
      for (const [staleActor, liveActor] of [
        ['a', 'b'],
        ['b', 'a'],
      ]) {
        const base = baseQueue({ K: entry('T1') });
        const stale = A.change(replica(base, staleActor), (queue) => delistTask(queue, 'K', url('T1')));
        let live = replica(base, liveActor);
        live = A.change(live, (queue) => listTask(queue, 'K', entry('T2'), url('T1')));
        live = A.change(live, (queue) => delistTask(queue, 'K', url('T2')));
        live = A.change(live, (queue) => listTask(queue, 'K', entry('T3')));
        for (const doc of syncBoth(stale, live)) {
          expect(named(doc, 'K', url('T3')), `stale ${staleActor}`).toBe('this');
        }
      }
    });

    it('a replica that saw the key empty lists while another lists, delists and lists again: one entry survives, the same on both, never the delisted one', () => {
      for (const [staleActor, liveActor] of [
        ['a', 'b'],
        ['b', 'a'],
      ]) {
        const base = baseQueue();
        const stale = A.change(replica(base, staleActor), (queue) => listTask(queue, 'K', entry('T0')));
        let live = replica(base, liveActor);
        live = A.change(live, (queue) => listTask(queue, 'K', entry('T1')));
        live = A.change(live, (queue) => delistTask(queue, 'K', url('T1')));
        live = A.change(live, (queue) => listTask(queue, 'K', entry('T2')));
        const [one, two] = syncBoth(stale, live);
        expect(one.jobs.K.taskUrl).toBe(two.jobs.K.taskUrl);
        expect([url('T0'), url('T2')]).toContain(one.jobs.K.taskUrl);
        for (const doc of [one, two]) {
          expect(named(doc, 'K', url('T1'))).toBe('other');
          expect([named(doc, 'K', url('T0')), named(doc, 'K', url('T2'))].sort()).toEqual(['other', 'this']);
        }
      }
    });
  });
});

// Readings the table does not reach

describe('taskResult and taskError', () => {
  const run = (kind: Kind, index: number) => makeRun({ kind, pool: 'P' }, index);

  it('give a result only for a task that succeeded, from the run that ended it', () => {
    expect(taskResult(makeTask([run('yielded', 0), run('succeeded', 1)]))).toEqual({ from: 'r1' });
    expect(taskResult(makeTask([run('failed', 0), run('succeeded', 1)]))).toBeUndefined();
    expect(taskResult(makeTask([run('lost', 0), run('lost', 1), run('lost', 2)]))).toBeUndefined();
    expect(taskResult(makeTask([], true))).toBeUndefined();
    expect(taskResult(makeTask([{ id: 'A', pool: 'P', start: 0 }]))).toBeUndefined();
    expect(taskResult(undefined)).toBeUndefined();
  });

  it("give a reason only for a task that failed: the failing run's last line, 'failed' without one, or the lost runs once nobody holds it", () => {
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }]);
    endRun(task, 'A', { status: 'failed', logs: [{ timestampMillis: 1, message: 'first' }, { timestampMillis: 2, message: 'boom' }], end: 3 });
    expect(taskError(task, allHeard)).toBe('boom');
    expect(taskError(makeTask([run('failed', 0)]), allHeard)).toBe('failed');
    expect(taskError(makeTask([run('lost', 0), run('lost', 1), run('lost', 2)]), allHeard)).toContain('3 times');
    const held = makeTask([run('lost', 0), run('lost', 1), run('lost', 2), { id: 'D', pool: 'P', start: 3 }]);
    expect(taskError(held, hearing('D'))).toBeNull();
    expect(taskError(held, hearsNone)).toContain('3 times');
    expect(taskError(makeTask([run('succeeded', 0), run('failed', 1)]), allHeard)).toBeNull();
    expect(taskError(makeTask([], true), allHeard)).toBeNull();
    expect(taskError(makeTask([run('lost', 0), run('lost', 1)]), allHeard)).toBeNull();
    expect(taskError(undefined, allHeard)).toBeNull();
  });
});

describe('waitingWork', () => {
  const jobs = {
    b: { taskUrl: url('Tb'), askedAt: 5, package: 'pkg' },
    a: { taskUrl: url('Ta'), askedAt: 5, package: null },
    c: { taskUrl: url('Tc'), askedAt: 1 },
    d: 'junk',
    e: { taskUrl: url('Te') },
  };

  it('lists every entry, oldest ask first and by key among asks made at once; a missing ask time counts as 0 and a missing package as null', () => {
    const work = waitingWork({ jobs } as unknown as Queue);
    expect(work.map((it) => it.key)).toEqual(['e', 'c', 'a', 'b']);
    expect(work.find((it) => it.key === 'c')?.package).toBeNull();
    expect(work.find((it) => it.key === 'b')).toEqual({ key: 'b', taskUrl: url('Tb'), askedAt: 5, package: 'pkg' });
    expect(waitingWork(undefined)).toEqual([]);
    expect(waitingWork({} as Queue)).toEqual([]);
  });

  it('gives the same order whatever order the keys were written in', () => {
    const keys = Object.keys(jobs) as (keyof typeof jobs)[];
    const orders = (rest: string[]): string[][] =>
      rest.length === 0 ? [[]] : rest.flatMap((key) => orders(rest.filter((it) => it !== key)).map((tail) => [key, ...tail]));
    const want = waitingWork({ jobs } as unknown as Queue);
    for (const order of orders(keys)) {
      const shuffled = Object.fromEntries(order.map((key) => [key, jobs[key as keyof typeof jobs]]));
      expect(waitingWork({ jobs: shuffled } as unknown as Queue), order.join('')).toEqual(want);
    }
  });
});
