// @vitest-environment node
//
// These tests attack the rules in task-rules.js (kit v3). The first half is a
// table of every task the rules can be asked about with up to three records,
// and checks each promise the header makes against expectations written out
// here from the header's words, not from the helpers the rules use. Then the
// one promise everything rests on, that a reading of "ended" is final for a
// reader that has every record and hears every open run, is checked against
// every legal next change of every row and against a record of every kind
// landing at every place in the list. The second half merges real Automerge
// documents, because the rules lean on what a merge does to a list and to a
// map key.
//
// A test named "RULE HOLE: ..." would state a promise the header makes that
// the rules, as written, do not keep, marked `it.fails` so that it passes
// while the hole is there and fails loudly once someone closes it. There is
// none at present.

import * as A from '@automerge/automerge';
import type { AutomergeUrl } from '@automerge/automerge-repo/slim';
import { describe, expect, it } from 'vitest';
import {
  allHeard,
  BEAT_MS,
  claimRun,
  delistTask,
  endRun,
  ending,
  endingRun,
  entryAt,
  type FinalStatus,
  gone,
  type Heard,
  Hearing,
  holder,
  isFinished,
  isHeard,
  isOpen,
  isStop,
  isTask,
  isWanted,
  LAPSE_MS,
  listTask,
  lostCount,
  LOST_TOO_OFTEN,
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
  recordsOf,
  type Run,
  type RunStatus,
  stopReason,
  stopTask,
  type Task,
  taskError,
  taskResult,
  taskState,
  type TaskState,
  waitingWork,
} from './task-rules.js';

// Building tasks

const url = (name: string) => `automerge:${name}` as AutomergeUrl;

/**
 * What a record in the table is, as one listener sees it: an open run it
 * hears or does not, a run its pool completed with one of the five statuses,
 * or a stop (a record with no pool that says `cancelled`).
 */
type Kind = 'heard' | 'unheard' | 'succeeded' | 'failed' | 'cancelled' | 'lost' | 'yielded' | 'stop';
type PoolName = 'P' | 'Q';
interface Spec {
  kind: Kind;
  pool: PoolName | null;
}

const NAMED: Named[] = ['this', 'other', 'none'];
const STATES: TaskState[] = ['waiting', 'running', 'stalled', 'stopping', 'succeeded', 'failed', 'cancelled'];
const STATUSES: RunStatus[] = ['succeeded', 'failed', 'cancelled', 'lost', 'yielded'];
const FINALS: FinalStatus[] = ['succeeded', 'failed', 'cancelled'];

const openKind = (kind: Kind) => kind === 'heard' || kind === 'unheard';
/** "A run in its list that ended it for good": a run its pool completed with a final status. A stop is not a run. */
const finalRunKind = (kind: Kind) => kind === 'succeeded' || kind === 'failed' || kind === 'cancelled';
/** A record that ends the task for some reader: a final run, or a stop. Where there is one, the task is not wanted. */
const finalKind = (kind: Kind) => finalRunKind(kind) || kind === 'stop';
const saysCancelled = (kind: Kind) => kind === 'cancelled' || kind === 'stop';
const statusOfKind = (kind: Kind) => (kind === 'stop' ? 'cancelled' : kind) as FinalStatus;

// A pool only matters for an open run (whose pool may still stop it or be
// barred from claiming again). Runs a pool completed are all P's, so the
// table also shows that a completed run of P's never keeps P from claiming.
const SPECS: Spec[] = [
  { kind: 'heard', pool: 'P' },
  { kind: 'heard', pool: 'Q' },
  { kind: 'unheard', pool: 'P' },
  { kind: 'unheard', pool: 'Q' },
  ...(['succeeded', 'failed', 'cancelled', 'lost', 'yielded'] as const).map((kind): Spec => ({ kind, pool: 'P' })),
  { kind: 'stop', pool: null },
];

const runId = (index: number) => `r${index}`;
/** The last line of a failed run in the table, so that taskError can be checked. */
const failedLine = (id: string) => `${id} broke`;

function makeRun(spec: Spec, index: number): Run {
  const id = runId(index);
  if (spec.kind === 'stop') {
    return { id, start: index, end: index, status: 'cancelled' };
  }
  const run: Run = { id, pool: spec.pool ?? 'P', start: index };
  if (!openKind(spec.kind)) {
    run.end = 100 + index;
    run.status = spec.kind as RunStatus;
    run.result = spec.kind === 'succeeded' ? { from: id } : null;
    run.logs = spec.kind === 'failed' ? [{ timestampMillis: 0, message: failedLine(id) }] : [];
  }
  return run;
}

function makeTask(runs: Run[] = []): Task {
  return { importUrl: 'data:text/javascript,export default () => 1', input: null, key: 'K', runs };
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

const labelOf = (specs: Spec[]) => `[${specs.map((s) => (s.pool ? `${s.pool}:${s.kind}` : s.kind)).join(', ')}]`;

/** Every list given, times what the key names. */
const rowsFor = (lists: Spec[][]): Row[] =>
  lists.flatMap((specs) =>
    NAMED.map((is): Row => {
      const heardIds = specs.flatMap((spec, index) => (spec.kind === 'heard' ? [runId(index)] : []));
      return {
        specs,
        is,
        task: makeTask(specs.map(makeRun)),
        heard: hearing(...heardIds),
        label: `${labelOf(specs)}, key names ${is}`,
      };
    }),
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
const firstFinalRun = (specs: Spec[]) => specs.findIndex((spec) => finalRunKind(spec.kind));
const anyFinal = (specs: Spec[]) => specs.some((spec) => finalKind(spec.kind));
const anyStop = (specs: Spec[]) => specs.some((spec) => spec.kind === 'stop');
const isHeldIn = (specs: Spec[]) => specs.some((spec) => spec.kind === 'heard');
const anyOpenIn = (specs: Spec[]) => specs.some((spec) => openKind(spec.kind));

/**
 * The record `endingRun` names, from the header: "the first run that ended it
 * for good, or, if no run did, the first stop".
 */
function expectedEndingRecord(specs: Spec[]): number {
  const run = firstFinalRun(specs);
  return run >= 0 ? run : specs.findIndex((spec) => spec.kind === 'stop');
}

/**
 * Where in the list the ending is read, for a reader: at the first final run,
 * or, when no run ended the task, after every record ("a stop is read last").
 * A heard open run before this place keeps the task from having ended.
 */
const readAt = (specs: Spec[]) => {
  const run = firstFinalRun(specs);
  return run >= 0 ? run : specs.length;
};

/** "The task's HOLDER is its first open run, in list order, that is heard." */
function expectedHolder(specs: Spec[]): string | null {
  const at = specs.findIndex((spec) => spec.kind === 'heard');
  return at < 0 ? null : runId(at);
}

/**
 * "The status of the first run in its list that ended it for good, once no
 * heard open run comes before that run. A stop is read last: it ends a task
 * that no run ended and no heard run still holds. Until then the task has not
 * ended."
 */
function expectedEnding(specs: Spec[]): FinalStatus | null {
  if (specs.slice(0, readAt(specs)).some((spec) => spec.kind === 'heard')) {
    return null;
  }
  const run = firstFinalRun(specs);
  if (run >= 0) {
    return statusOfKind(specs[run].kind);
  }
  return anyStop(specs) ? 'cancelled' : null;
}

/**
 * The ending if there is one; else, held by a heard run, `stopping` when a
 * record says cancelled and `running` otherwise; else `stalled` with runs
 * open and `waiting` without.
 */
function expectedState(specs: Spec[]): TaskState {
  const ended = expectedEnding(specs);
  if (ended) {
    return ended;
  }
  if (isHeldIn(specs)) {
    return specs.some((spec) => saysCancelled(spec.kind)) ? 'stopping' : 'running';
  }
  return anyOpenIn(specs) ? 'stalled' : 'waiting';
}

/** "Still wanted (no record has ended it)." */
const expectedWanted = (specs: Spec[]) => !anyFinal(specs);

/** "Still wanted, its queue lists it under the task's key, nobody heard holds it, and the pool has no open run of it." */
function expectedClaim(row: Row, pool: PoolName): boolean {
  return (
    row.is === 'this' &&
    expectedWanted(row.specs) &&
    !isHeldIn(row.specs) &&
    !row.specs.some((spec) => openKind(spec.kind) && spec.pool === pool)
  );
}

/**
 * In this order: "`yielded`, if the work is done (some run says `succeeded`)";
 * "`cancelled`, if the task has been stopped (a stop, or a run recorded as
 * stopped)"; "`yielded`, if a run before this one in the list ended the task,
 * or its key now names another task, or an earlier run that this pool hears
 * has it". A failure after it, a key naming nothing, and lost runs stop
 * nothing.
 */
function expectedStop(specs: Spec[], is: Named, index: number, hears: (spec: Spec) => boolean): 'cancelled' | 'yielded' | null {
  if (specs.some((spec) => spec.kind === 'succeeded')) {
    return 'yielded';
  }
  if (specs.some((spec) => saysCancelled(spec.kind))) {
    return 'cancelled';
  }
  const before = specs.slice(0, index);
  if (
    before.some((spec) => finalKind(spec.kind)) ||
    is === 'other' ||
    before.some((spec) => openKind(spec.kind) && hears(spec))
  ) {
    return 'yielded';
  }
  return null;
}

/** "What it would have been stopped for (nobody heard), else `lost`, or `failed` when the task has already lost MAX_LOST - 1 runs." */
function expectedGone(specs: Spec[], is: Named, index: number): 'cancelled' | 'yielded' | 'lost' | 'failed' {
  return expectedStop(specs, is, index, () => false) ?? (lostIn(specs) >= MAX_LOST - 1 ? 'failed' : 'lost');
}

const hearsKind = (spec: Spec) => spec.kind === 'heard';

/** The indices of the open runs that a pool has in a row. */
const openRunsOf = (row: Row, pool: PoolName) =>
  row.specs.flatMap((spec, index) => (openKind(spec.kind) && spec.pool === pool ? [index] : []));
const openRuns = (row: Row) => row.specs.flatMap((spec, index) => (openKind(spec.kind) ? [index] : []));

/** The same row as heard by a listener that hears every open run. */
const hearingAll = (row: Row): Row => {
  const specs = row.specs.map((spec): Spec => (spec.kind === 'unheard' ? { ...spec, kind: 'heard' } : spec));
  return { ...row, specs, heard: allHeard };
};

describe('the table', () => {
  it('has every record list of length 0 to 3, times what the key names', () => {
    // 10 record specs (2 open kinds times 2 pools, 5 completed statuses, a stop), lists of 0..3.
    expect(SPECS).toHaveLength(10);
    expect(ALL_RUN_LISTS.length).toBe(1 + 10 + 100 + 1000);
    expect(ROWS.length).toBe((1 + 10 + 100 + 1000) * 3);
    expect(new Set(ROWS.map((row) => row.label)).size).toBe(ROWS.length);
    expect(MAX_LOST).toBe(3);
  });
});

describe('every task with up to three records', () => {
  it('holder: the first open heard run, or null', () => {
    everyRow((row) => {
      const got = holder(row.task, row.heard)?.id ?? null;
      const want = expectedHolder(row.specs);
      return got === want ? null : `holder ${got}, expected ${want}`;
    });
  });

  it('ending: the first final run, unless a heard open run comes before it; with no final run, cancelled on a stop anywhere unless a heard open run is anywhere; else none', () => {
    everyRow((row) => {
      const got = ending(row.task, row.heard);
      const want = expectedEnding(row.specs);
      return got === want ? null : `ending ${got}, expected ${want}`;
    });
  });

  it('ending with allHeard: what a listener that hears every open run reads', () => {
    everyRow((row) => {
      const got = ending(row.task, allHeard);
      const want = expectedEnding(hearingAll(row).specs);
      return got === want ? null : `ending ${got}, expected ${want}`;
    });
  });

  it('endingRun: the first run with a final status, else the first stop, else null; no hearing asked', () => {
    everyRow((row) => {
      const at = expectedEndingRecord(row.specs);
      const got = endingRun(row.task)?.id ?? null;
      const want = at < 0 ? null : runId(at);
      return got === want ? null : `endingRun ${got}, expected ${want}`;
    });
  });

  it('isStop: exactly the records with no pool that say cancelled; a run its pool recorded cancelled is not one', () => {
    everyRow((row) => {
      for (const [index, spec] of row.specs.entries()) {
        if (isStop(row.task.runs[index]) !== (spec.kind === 'stop')) {
          return `isStop(${runId(index)}) ${isStop(row.task.runs[index])}`;
        }
      }
      return null;
    });
  });

  it('recordsOf: every record of the list a task has, in order; lostCount: how many of them say lost', () => {
    everyRow((row) => {
      const records = recordsOf(row.task);
      if (records.length !== row.task.runs.length || records.some((record, at) => record !== row.task.runs[at])) {
        return 'recordsOf is not the records of the list, in order';
      }
      return lostCount(row.task) === lostIn(row.specs) ? null : `lostCount ${lostCount(row.task)}`;
    });
  });

  it('taskState: exactly one of the seven states, the one the header gives', () => {
    everyRow((row) => {
      const got = taskState(row.task, row.heard);
      const want = expectedState(row.specs);
      if (!STATES.includes(got)) {
        return `state ${got}`;
      }
      return got === want ? null : `state ${got}, expected ${want}`;
    });
  });

  it('taskState with allHeard', () => {
    everyRow((row) => {
      const got = taskState(row.task, allHeard);
      const want = expectedState(hearingAll(row).specs);
      return got === want ? null : `state ${got}, expected ${want}`;
    });
  });

  it('isFinished(taskState) exactly when ending is not null', () => {
    everyRow((row) => {
      const finished = isFinished(taskState(row.task, row.heard));
      const ended = ending(row.task, row.heard) !== null;
      return finished === ended ? null : `finished ${finished}, ended ${ended}`;
    });
  });

  it('isWanted: a task no record has ended; no flag, no count', () => {
    everyRow((row) => {
      const got = isWanted(row.task);
      const want = expectedWanted(row.specs);
      return got === want ? null : `isWanted ${got}, expected ${want}`;
    });
  });

  it('isWanted is exactly what a listener that hears nobody reads as not ended', () => {
    everyRow((row) => {
      const wanted = isWanted(row.task);
      const open = ending(row.task, hearsNone) === null;
      return wanted === open ? null : `isWanted ${wanted}, ending with nobody heard ${ending(row.task, hearsNone)}`;
    });
  });

  it('a task that has ended, for any listener, is not wanted', () => {
    everyRow((row) => {
      for (const heard of [row.heard, allHeard, hearsNone]) {
        if (ending(row.task, heard) !== null && isWanted(row.task)) {
          return `ended ${ending(row.task, heard)} and wanted`;
        }
      }
      return null;
    });
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
    });
  });

  it('stopReason for every open run: yielded on any success; else cancelled on any cancelled record (stop or run); else yielded on a final record before it, another key, or an earlier heard run; a failure after it stops nothing', () => {
    everyRow((row) => {
      for (const index of openRuns(row)) {
        const got = stopReason(row.task, runId(index), row.is, row.heard);
        const want = expectedStop(row.specs, row.is, index, hearsKind);
        if (got !== want) {
          return `stopReason(${runId(index)}) ${got}, expected ${want}`;
        }
      }
      return null;
    });
  });

  it("stopReason is 'yielded' for a run that is not in the list, is already complete, or is a stop", () => {
    everyRow((row) => {
      if (stopReason(row.task, 'nobody', row.is, row.heard) !== 'yielded') {
        return 'an unknown run may carry on';
      }
      for (const [index, spec] of row.specs.entries()) {
        if (!openKind(spec.kind) && stopReason(row.task, runId(index), row.is, row.heard) !== 'yielded') {
          return `completed record ${runId(index)} may carry on`;
        }
      }
      return null;
    });
  });

  it('gone for every open run: what it would be stopped for with nobody heard; else failed once two runs are lost, else lost', () => {
    everyRow((row) => {
      for (const index of openRuns(row)) {
        const got = gone(row.task, runId(index), row.is);
        const want = expectedGone(row.specs, row.is, index);
        if (got !== want) {
          return `gone(${runId(index)}) ${got}, expected ${want}`;
        }
      }
      return null;
    });
  });

  it('orphans: the open runs bearing the pool name that it does not have; a stop is no one\'s', () => {
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
    });
  });

  it('mayDelist: the key names this, and some record has ended the task; no hearing asked', () => {
    everyRow((row) => {
      const got = mayDelist(row.task, row.is);
      const want = row.is === 'this' && anyFinal(row.specs);
      return got === want ? null : `mayDelist ${got}, expected ${want}`;
    });
  });

  it('mayRelist: the key names none, the task is wanted, nobody heard holds it, and the lapse has passed', () => {
    const noneSince = 50_000;
    everyRow((row) => {
      for (const waited of [0, LAPSE_MS - 1, LAPSE_MS, LAPSE_MS + 1]) {
        const got = mayRelist(row.task, row.is, row.heard, noneSince, noneSince + waited);
        const want = row.is === 'none' && expectedWanted(row.specs) && !isHeldIn(row.specs) && waited >= LAPSE_MS;
        if (got !== want) {
          return `mayRelist after ${waited} ms ${got}, expected ${want}`;
        }
      }
      return null;
    });
  });

  it('stopTask: appends {id, start, end, status: cancelled} with no pool exactly when no record has ended the task, and says whether it did', () => {
    everyRow((row) => {
      const after = copy(row.task);
      const did = stopTask(after, { id: 'S', at: 7 });
      const want = !anyFinal(row.specs);
      if (did !== want) {
        return `stopTask ${did}, expected ${want}`;
      }
      const added = want ? [{ id: 'S', start: 7, end: 7, status: 'cancelled' }] : [];
      if (JSON.stringify(after.runs) !== JSON.stringify([...row.task.runs, ...added])) {
        return `runs after: ${JSON.stringify(after.runs)}`;
      }
      // once stopped, the task is not wanted, and reads stopping while a heard run holds it, else cancelled
      if (did) {
        const state = taskState(after, row.heard);
        if (isWanted(after) || state !== (isHeldIn(row.specs) ? 'stopping' : 'cancelled')) {
          return `stopped and reads ${state}, wanted ${isWanted(after)}`;
        }
      }
      return null;
    });
  });

  it("taskResult: the result of the record that ended the task, when it succeeded; taskError: that record's last line, for a listener that reads failed", () => {
    everyRow((row) => {
      const at = expectedEndingRecord(row.specs);
      const result = taskResult(row.task);
      const wantResult = at >= 0 && row.specs[at].kind === 'succeeded' ? { from: runId(at) } : undefined;
      if (JSON.stringify(result) !== JSON.stringify(wantResult)) {
        return `taskResult ${JSON.stringify(result)}`;
      }
      const error = taskError(row.task, row.heard);
      const wantError = expectedEnding(row.specs) === 'failed' ? failedLine(runId(at)) : null;
      return error === wantError ? null : `taskError ${error}, expected ${wantError}`;
    });
  });

  it('never leaves a pool both free to claim and carrying on a run of the task', () => {
    everyRow((row) => {
      for (const pool of ['P', 'Q'] as const) {
        const claim = mayClaim(row.task, pool, row.is, row.heard);
        const carriesOn = openRunsOf(row, pool).some((index) => stopReason(row.task, runId(index), row.is, row.heard) === null);
        if (claim && carriesOn) {
          return `${pool} may claim while one of its runs carries on`;
        }
      }
      return null;
    });
  });

  it('Q may not claim while a heard run of P carries on', () => {
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

  it('holder, ending and taskState of a task that is not here yet: null, null, waiting', () => {
    expect(holder(undefined, allHeard)).toBeNull();
    expect(ending(undefined, hearsNone)).toBeNull();
    expect(taskState(undefined, allHeard)).toBe('waiting');
    expect(isWanted(undefined)).toBe(false);
    expect(mayClaim(undefined, 'P', 'this', hearsNone)).toBe(false);
    expect(mayRelist(undefined, 'none', hearsNone, 0, LAPSE_MS * 2)).toBe(false);
    expect(mayDelist(undefined, 'this')).toBe(false);
    expect(orphans(undefined, 'P', () => false)).toEqual([]);
  });

  it('allHeard counts any run, named or not, as heard', () => {
    expect(['r0', 'nobody', ''].every((id) => allHeard(id))).toBe(true);
  });
});

// Neither wanted nor ended

describe('the tasks that are neither wanted nor ended', () => {
  // Some record has ended them, so no pool takes them and no asker lists them
  // again; but a heard open run comes before that record, so a listener does
  // not read them as ended. What will change them is that run's pool, or the
  // run going unheard.
  const NEITHER = ROWS.filter((row) => !isWanted(row.task) && ending(row.task, row.heard) === null);

  it('are exactly the rows with a final run and a heard open run before it, and the rows with no final run, a stop, and a heard open run anywhere', () => {
    everyRow((row) => {
      const neither = NEITHER.includes(row);
      const run = firstFinalRun(row.specs);
      const want =
        run >= 0
          ? row.specs.slice(0, run).some((spec) => spec.kind === 'heard')
          : anyStop(row.specs) && isHeldIn(row.specs);
      return neither === want ? null : `neither ${neither}, expected ${want}`;
    });
    // Counted by hand. Of the 10 specs, 2 are heard, 3 are final runs, and 7 are not final runs (heard and
    // unheard of P or Q, lost, yielded, the stop).
    // With a final run: what comes before the first one is drawn from the 7, at least one of them heard;
    // then one of the 3 final runs; then anything. [h, R]: 2 * 3. [h, R, x]: 2 * 3 * 10. [a, b, R] with a
    // heard among a, b: (7 * 7 - 5 * 5) * 3.
    // With no final run: every record is one of the 7, with at least one stop and one heard. Length 2: the
    // heard one first or second, 2 * 2. Length 3: 7^3 - 6^3 (no stop) - 5^3 (none heard) + 4^3 (neither).
    // Times the 3 things the key can name.
    const withRun = 2 * 3 + 2 * 3 * 10 + (7 * 7 - 5 * 5) * 3;
    const withStop = 2 * 2 + (7 ** 3 - 6 ** 3 - 5 ** 3 + 4 ** 3);
    expect([withRun, withStop]).toEqual([138, 70]);
    expect(NEITHER.length).toBe((withRun + withStop) * 3);
  });

  it('read running, or stopping when a record says cancelled; nobody may take them or list them again; the entry may go', () => {
    everyRow((row) => {
      const state = taskState(row.task, row.heard);
      if (state !== (row.specs.some((spec) => saysCancelled(spec.kind)) ? 'stopping' : 'running')) {
        return `state ${state}`;
      }
      for (const heard of [row.heard, hearsNone, allHeard]) {
        if (['P', 'Q', 'R'].some((pool) => mayClaim(row.task, pool, 'this', heard)) || mayRelist(row.task, 'none', heard, 0, LAPSE_MS)) {
          return 'taken or listed again';
        }
      }
      return mayDelist(row.task, row.is) === (row.is === 'this') ? null : 'the entry is kept';
    }, NEITHER);
  });

  it('the holder carries on (the rescue rule) exactly when every record that ends the task says failed and the key does not name another; otherwise it yields to a success before it is cancelled', () => {
    let rescued = 0;
    let successAndStop = 0;
    everyRow((row) => {
      const at = row.specs.findIndex((spec) => spec.kind === 'heard');
      const reason = stopReason(row.task, runId(at), row.is, row.heard);
      const finals = row.specs.filter((spec) => finalKind(spec.kind));
      const carries = finals.every((spec) => spec.kind === 'failed') && row.is !== 'other';
      if (carries) {
        rescued++;
      }
      if ((reason === null) !== carries) {
        return `the holder is told ${reason}`;
      }
      // otherwise it is told why: yielded on a success, else cancelled on a cancelled record, else yielded
      const succeeded = finals.some((spec) => spec.kind === 'succeeded');
      const cancelled = finals.some((spec) => saysCancelled(spec.kind));
      if (succeeded && cancelled) {
        successAndStop++;
      }
      if (!carries && reason !== (!succeeded && cancelled ? 'cancelled' : 'yielded')) {
        return `the holder is told ${reason}`;
      }
      return null;
    }, NEITHER);
    expect(rescued).toBeGreaterThan(0);
    expect(successAndStop).toBeGreaterThan(0);
  });

  it("what its holder's pool then writes ends the task as the list says: the holder's own status if final (it is then the first final run), else as the rest of the list reads", () => {
    everyRow((row) => {
      const at = row.specs.findIndex((spec) => spec.kind === 'heard');
      const id = runId(at);
      const reason = stopReason(row.task, id, row.is, row.heard);
      const statuses: RunStatus[] = reason ? [reason, gone(row.task, id, row.is)] : ['succeeded', 'failed', gone(row.task, id, row.is)];
      for (const status of statuses) {
        const after = copy(row.task);
        endRun(after, id, { status, end: 999 });
        const want = FINALS.includes(status as FinalStatus)
          ? status
          : expectedEnding(row.specs.map((spec, index): Spec => (index === at ? { kind: status as Kind, pool: spec.pool } : spec)));
        if (ending(after, row.heard) !== want) {
          return `${id} ${status}: ending ${ending(after, row.heard)}, expected ${want}`;
        }
      }
      return null;
    }, NEITHER);
  });

  it('a reader with no ears reads them as not ended for ever, if the holder\'s pool is gone for good; a listener reads the ending a lapse after its last word', () => {
    // [A open by a pool gone for good, a stop] and [A open, a failure]
    for (const [second, want] of [
      [{ id: 'S', start: 1, end: 1, status: 'cancelled' } as Run, 'cancelled'],
      [makeRun({ kind: 'failed', pool: 'Q' }, 1), 'failed'],
    ] as const) {
      const task = makeTask([{ id: 'A', pool: 'gone for good', start: 0 }, second]);
      expect(isWanted(task)).toBe(false);
      expect(ending(task, allHeard)).toBeNull();
      const clock = { t: 0, now: () => clock.t };
      const listener = new Hearing(clock);
      listener.saw(task.runs);
      listener.heardFrom('A');
      clock.t = LAPSE_MS - 1;
      expect(ending(task, listener.heard)).toBeNull();
      clock.t = LAPSE_MS;
      expect(ending(task, listener.heard)).toBe(want);
      // and the pool, if it comes back, completes A as gone says, which every reader then reads alike
      endRun(task, 'A', { status: gone(task, 'A', 'none'), end: 2 });
      expect([ending(task, allHeard), ending(task, hearsNone)]).toEqual([want, want]);
    }
  });
});

// What a reading of "ended" may do afterwards

interface Change {
  label: string;
  apply: (task: Task) => void;
  /** Whether a pool that has read this very list could make it (true), or only one that has not read the latest of it. */
  seen: boolean;
  /** The open run it completes, if it completes one. */
  completes?: number;
  status?: RunStatus;
}

/**
 * What the pool of the open run at `index` could write for it having read
 * this list, whatever it hears and whatever its queue says: the reason it is
 * stopped for, or, while it may carry on, how its code ends (returned,
 * threw); and always what `gone` says, since the pool can stop or die at any
 * moment.
 */
function statusesSeen(task: Task, index: number): Set<RunStatus> {
  const id = runId(index);
  const seen = new Set<RunStatus>();
  for (const is of NAMED) {
    seen.add(gone(task, id, is));
    for (const heard of [hearsNone, allHeard, ...task.runs.map((run) => hearing(run.id))]) {
      const reason = stopReason(task, id, is, heard);
      if (reason) {
        seen.add(reason);
      } else {
        seen.add('succeeded').add('failed');
      }
    }
  }
  return seen;
}

/** Every change a document may legally see appended or written next. */
function legalChanges(row: Row): Change[] {
  const changes: Change[] = [];
  // A pool appends a run only when it may take the task; one that hears
  // nobody and has no run of it is the most a pool can be allowed.
  if (mayClaim(row.task, 'R', 'this', hearsNone)) {
    changes.push({ label: 'append', seen: true, apply: (it) => claimRun(it, { id: 'new', pool: 'R', start: 999 }) });
  }
  // An asker stops it (stopTask writes only while no record has ended it).
  changes.push({ label: 'stop', seen: true, apply: (it) => void stopTask(it, { id: 'S', at: 999 }) });
  // Each open run is completed by its pool with any status at all: code can
  // return before its pool has read why it should stop.
  for (const index of openRuns(row)) {
    const seen = statusesSeen(row.task, index);
    for (const status of STATUSES) {
      changes.push({
        label: `complete ${runId(index)} ${status}`,
        seen: seen.has(status),
        completes: index,
        status,
        apply: (it) => endRun(it, runId(index), { status, result: 'late', end: 999 }),
      });
    }
  }
  return changes;
}

/**
 * A reading of "ended", as an asker takes it: the ending, and for a success
 * or a failure the record it was read from, which gives the result or the
 * reason. Which record says `cancelled` gives the asker nothing more.
 */
const readingOf = (task: Task, heard: Heard) => {
  const ended = ending(task, heard);
  return ended === 'succeeded' || ended === 'failed' ? `${ended} by ${endingRun(task)?.id}` : String(ended);
};

/**
 * The records that can land in a list without their writer having seen the
 * ending: a run taken at the same time (open, which a reader that hears every
 * open run hears from first sight, or already completed with any status), or
 * a stop.
 */
const INSERTS: { kind: Kind; record: Run }[] = [
  { kind: 'heard', record: { id: 'new', pool: 'R', start: 9 } },
  ...STATUSES.map((status) => ({
    kind: status as Kind,
    record: { id: 'new', pool: 'R', start: 9, end: 9, status, result: status === 'succeeded' ? 'new' : null, logs: [] } as Run,
  })),
  { kind: 'stop', record: { id: 'new', start: 9, end: 9, status: 'cancelled' } },
];

/** The readers the header's promise is made to: they have every record and hear every open run. */
const FULL_READERS: [string, Row[]][] = [
  ['its own hearing, on every row where it hears every open run', ROWS.filter((row) => !row.specs.some((spec) => spec.kind === 'unheard'))],
  ['allHeard, on every row', ROWS.map((row) => ({ ...row, heard: allHeard }))],
];

describe('a reading of "ended"', () => {
  // Each change gives a row of the table again or a list of four, and leaves
  // every run the reader heard heard, so a history of changes is a sequence
  // of the single steps checked here.
  for (const [name, rows] of FULL_READERS) {
    it(`is final for a reader that has every record and hears every open run: no legal next change alters it: ${name}`, () => {
      let exercised = 0;
      let unseen = 0;
      everyRow((row) => {
        const was = readingOf(row.task, row.heard);
        if (ending(row.task, row.heard) === null) {
          return null;
        }
        for (const change of legalChanges(row)) {
          exercised++;
          if (!change.seen) {
            unseen++;
          }
          const after = copy(row.task);
          change.apply(after);
          const now = readingOf(after, row.heard);
          if (now !== was) {
            return `${change.label} (${change.seen ? 'by a pool that read the list' : 'by a pool that had not'}) turns ${was} into ${now}`;
          }
        }
        return null;
      }, rows);
      expect(exercised).toBeGreaterThan(0);
      expect(unseen).toBeGreaterThan(0);
    });

    it(`changes for that reader only by a record that lands before where the ending is read: an open run un-ends it, a final run's status replaces it, nothing else does: ${name}`, () => {
      // A record made without knowledge of the ending can land anywhere at or
      // after the last record its writer had, so every place is tried. The
      // ending is read at the first final run, or after every record when a
      // stop alone ended the task (a stop is read last).
      const counts = { unEnded: 0, replaced: 0, kept: 0, afterKept: 0 };
      everyRow((row) => {
        if (ending(row.task, row.heard) === null) {
          return null;
        }
        const was = readingOf(row.task, row.heard);
        const before = readAt(row.specs);
        for (let at = 0; at <= row.specs.length; at++) {
          for (const { kind, record } of INSERTS) {
            const after = copy(row.task);
            after.runs.splice(at, 0, copy(record));
            const hearsNew: Heard = (id) => id === 'new' || row.heard(id);
            const now = readingOf(after, hearsNew);
            let want = was;
            if (at <= before && kind === 'heard') {
              want = 'null';
            } else if (at <= before && finalRunKind(kind)) {
              want = kind === 'cancelled' ? 'cancelled' : `${kind} by new`;
            }
            if (now !== want) {
              return `${kind} at ${at} reads ${now}, expected ${want}`;
            }
            if (at > before) {
              counts.afterKept++;
            } else if (want === 'null') {
              counts.unEnded++;
            } else if (want !== was) {
              counts.replaced++;
            } else {
              counts.kept++;
            }
          }
        }
        return null;
      }, rows);
      for (const [what, count] of Object.entries(counts)) {
        expect(count, what).toBeGreaterThan(0);
      }
    });
  }

  it('a stop never takes an ending away from a run that finished: a stop at any place in a list a run ended reads the same, for every reader', () => {
    let tried = 0;
    everyRow((row) => {
      if (firstFinalRun(row.specs) < 0) {
        return null;
      }
      for (const heard of [row.heard, allHeard, hearsNone]) {
        const was = readingOf(row.task, heard);
        for (let at = 0; at <= row.specs.length; at++) {
          const after = copy(row.task);
          after.runs.splice(at, 0, { id: 'S', start: 9, end: 9, status: 'cancelled' });
          tried++;
          if (readingOf(after, heard) !== was || JSON.stringify(taskResult(after)) !== JSON.stringify(taskResult(row.task))) {
            return `a stop at ${at} turns ${was} into ${readingOf(after, heard)}`;
          }
        }
      }
      return null;
    });
    expect(tried).toBeGreaterThan(0);
  });

  it('a reading of cancelled by a stop alone is un-ended by a run taken without knowledge of the stop wherever that run lands, after the stop too: a stop is read last', () => {
    // The header's words are "lands earlier in the list"; for a stop, which is
    // read last, every place in the list is earlier than where it is read.
    for (const runs of [[], [makeRun({ kind: 'lost', pool: 'P' }, 0)], [makeRun({ kind: 'yielded', pool: 'P' }, 0)]]) {
      const stopped = makeTask([...runs, { id: 'S', start: 1, end: 1, status: 'cancelled' }]);
      expect(ending(stopped, allHeard)).toBe('cancelled');
      for (let at = 0; at <= stopped.runs.length; at++) {
        const after = copy(stopped);
        after.runs.splice(at, 0, { id: 'B', pool: 'Q', start: 2 });
        expect(taskState(after, allHeard), `B at ${at}`).toBe('stopping');
        expect(stopReason(after, 'B', 'this', allHeard)).toBe('cancelled');
      }
    }
  });

  it('changes, for a reader with its own hearing, only through something it did not have: an open run it does not hear, before where the ending is read, completed with a final status', () => {
    let admittedSeen = 0;
    let admittedUnseen = 0;
    everyRow((row) => {
      if (ending(row.task, row.heard) === null) {
        return null;
      }
      const before = readAt(row.specs);
      for (const change of legalChanges(row)) {
        const after = copy(row.task);
        change.apply(after);
        if (readingOf(after, row.heard) === readingOf(row.task, row.heard)) {
          continue;
        }
        const admitted =
          change.completes !== undefined &&
          change.completes < before &&
          row.specs[change.completes].kind === 'unheard' &&
          FINALS.includes(change.status as FinalStatus);
        if (!admitted) {
          return `${change.label} turns ${readingOf(row.task, row.heard)} into ${readingOf(after, row.heard)}`;
        }
        if (change.seen) {
          admittedSeen++;
        } else {
          admittedUnseen++;
        }
      }
      return null;
    });
    // both kinds of pool make it: one that read the list (the rescue: [A unheard, B failed], A succeeds) and one that had not
    expect(admittedSeen).toBeGreaterThan(0);
    expect(admittedUnseen).toBeGreaterThan(0);
  });

  it('the one way, by name: [A open and unheard, B succeeded] reads succeeded; A, its pool cut off and unaware of B, completes failed: now failed, for everyone', () => {
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }, makeRun({ kind: 'succeeded', pool: 'P' }, 1)]);
    expect(ending(task, hearsNone)).toBe('succeeded');
    // a pool that had read B's success would have yielded
    expect(statusesSeen(task, 0).has('failed')).toBe(false);
    endRun(task, 'A', { status: 'failed', end: 2 });
    expect([ending(task, hearsNone), ending(task, allHeard)]).toEqual(['failed', 'failed']);
  });

  it('a pool that has read a later success never changes the reading by completing its earlier run: it yields, whatever else the list holds, a stop included', () => {
    let exercised = 0;
    let withStop = 0;
    everyRow((row) => {
      if (!row.specs.some((spec) => spec.kind === 'succeeded')) {
        return null;
      }
      for (const index of openRuns(row)) {
        exercised++;
        if (anyStop(row.specs) || row.specs.some((spec) => spec.kind === 'cancelled')) {
          withStop++;
        }
        const seen = statusesSeen(row.task, index);
        if (JSON.stringify([...seen]) !== JSON.stringify(['yielded'])) {
          return `${runId(index)} may be recorded ${[...seen]}`;
        }
      }
      return null;
    });
    expect(exercised).toBeGreaterThan(0);
    expect(withStop).toBeGreaterThan(0);
  });

  it('changes, with no record written, when a run the reader could not hear is heard again (as the header admits): exactly the unheard open runs before where the ending is read', () => {
    let changed = 0;
    let afterAStop = 0;
    everyRow((row) => {
      if (ending(row.task, row.heard) === null) {
        return null;
      }
      const before = readAt(row.specs);
      for (const [index, spec] of row.specs.entries()) {
        if (spec.kind !== 'unheard') {
          continue;
        }
        const again: Heard = (id) => id === runId(index) || row.heard(id);
        const differs = ending(row.task, again) !== ending(row.task, row.heard);
        if (differs !== index < before) {
          return `${runId(index)} heard again: changed ${differs}`;
        }
        if (differs) {
          changed++;
          if (row.specs.slice(0, index).some((it) => it.kind === 'stop')) {
            afterAStop++;
          }
          // to not ended: running, or stopping where a record says cancelled
          if (taskState(row.task, again) !== (row.specs.some((it) => saysCancelled(it.kind)) ? 'stopping' : 'running')) {
            return `reads ${taskState(row.task, again)}`;
          }
        }
      }
      return null;
    });
    expect(changed).toBeGreaterThan(0);
    expect(afterAStop).toBeGreaterThan(0);
  });

  it('heard again, by name: [A open, its pool cut off, B succeeded] reads succeeded; A is heard again before its pool learns of B, and reads running; A yields, and it reads succeeded again', () => {
    // Inside the header's promise: A is "one the reader could not hear (its
    // pool was cut off, not gone) being heard again".
    const clock = { t: 0, now: () => clock.t };
    const reader = new Hearing(clock);
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }, makeRun({ kind: 'succeeded', pool: 'Q' }, 1)]);
    reader.saw(task.runs);
    clock.t = LAPSE_MS;
    expect(taskState(task, reader.heard)).toBe('succeeded');
    reader.heardFrom('A');
    expect(taskState(task, reader.heard)).toBe('running');
    expect(stopReason(task, 'A', 'this', allHeard)).toBe('yielded');
    endRun(task, 'A', { status: 'yielded', end: 2 });
    expect(taskState(task, reader.heard)).toBe('succeeded');
    expect(taskResult(task)).toEqual({ from: 'r1' });
  });

  it('heard again, by name, the rescue: [A open, cut off, B failed] reads failed; A is heard again and reads running; A carries on and succeeds: succeeded', () => {
    const clock = { t: 0, now: () => clock.t };
    const reader = new Hearing(clock);
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }, makeRun({ kind: 'failed', pool: 'Q' }, 1)]);
    reader.saw(task.runs);
    clock.t = LAPSE_MS;
    expect(taskState(task, reader.heard)).toBe('failed');
    reader.heardFrom('A');
    expect(taskState(task, reader.heard)).toBe('running');
    expect(stopReason(task, 'A', 'this', reader.heard)).toBeNull();
    endRun(task, 'A', { status: 'succeeded', result: 'A', end: 2 });
    expect([taskState(task, reader.heard), taskState(task, hearsNone)]).toEqual(['succeeded', 'succeeded']);
  });
});

// The rescue rule

describe('the rescue rule: a failure after a run stops nothing', () => {
  const failedB = makeRun({ kind: 'failed', pool: 'Q' }, 1);
  const rescue = () => makeTask([{ id: 'A', pool: 'P', start: 0 }, { ...failedB, id: 'B' }]);

  it("[A open and heard, B failed]: running; A's pool carries on", () => {
    const task = rescue();
    expect(taskState(task, hearing('A'))).toBe('running');
    expect(stopReason(task, 'A', 'this', hearing('A'))).toBeNull();
    expect(stopReason(task, 'A', 'none', allHeard)).toBeNull();
    // the entry goes all the same: a record has ended the task, and nobody takes it again
    expect(mayDelist(task, 'this')).toBe(true);
    expect(isWanted(task)).toBe(false);
  });

  it('A succeeds: succeeded, with its result, for everyone', () => {
    const task = rescue();
    endRun(task, 'A', { status: 'succeeded', result: 'A', end: 2 });
    for (const heard of [hearing('A'), allHeard, hearsNone]) {
      expect(taskState(task, heard)).toBe('succeeded');
    }
    expect(taskResult(task)).toBe('A');
  });

  it("A fails: failed, A's own failure", () => {
    const task = rescue();
    endRun(task, 'A', { status: 'failed', logs: [{ timestampMillis: 0, message: 'A broke too' }], end: 2 });
    expect(endingRun(task)?.id).toBe('A');
    expect(taskError(task, allHeard)).toBe('A broke too');
  });

  it("A's pool goes silent: failed, B's failure, once a listener has not heard A for the lapse", () => {
    const task = rescue();
    const clock = { t: 0, now: () => clock.t };
    const listener = new Hearing(clock);
    listener.saw(task.runs);
    listener.heardFrom('A');
    clock.t = LAPSE_MS - 1;
    expect(taskState(task, listener.heard)).toBe('running');
    clock.t = LAPSE_MS;
    expect(taskState(task, listener.heard)).toBe('failed');
    expect(taskError(task, listener.heard)).toBe(failedLine('r1'));
  });

  it('[A failed, B open]: B must yield', () => {
    const task = makeTask([{ ...failedB, id: 'A' }, { id: 'B', pool: 'Q', start: 1 }]);
    for (const heard of [hearing('B'), allHeard, hearsNone]) {
      expect(stopReason(task, 'B', 'this', heard)).toBe('yielded');
    }
    expect(gone(task, 'B', 'this')).toBe('yielded');
  });

  it('[A open, B succeeded]: A must yield; until it has, a reader that hears A reads running, one that does not reads succeeded', () => {
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }, makeRun({ kind: 'succeeded', pool: 'Q' }, 1)]);
    for (const heard of [hearing('A'), allHeard, hearsNone]) {
      expect(stopReason(task, 'A', 'this', heard)).toBe('yielded');
    }
    expect(taskState(task, hearing('A'))).toBe('running');
    expect(taskState(task, hearsNone)).toBe('succeeded');
    endRun(task, 'A', { status: 'yielded', end: 2 });
    expect([taskState(task, hearing('A')), taskState(task, hearsNone)]).toEqual(['succeeded', 'succeeded']);
  });

  it('a third loss recorded after an earlier healthy run is a failure after it: the healthy run carries on, and its success is the ending', () => {
    // [H open and heard, lost, lost, A open]: A's pool restarts and records A as gone says
    const lost = (id: string, index: number) => ({ ...makeRun({ kind: 'lost', pool: 'P' }, index), id });
    const task = makeTask([{ id: 'H', pool: 'Q', start: 0 }, lost('l1', 1), lost('l2', 2), { id: 'A', pool: 'P', start: 3 }]);
    expect(gone(task, 'A', 'this')).toBe('failed');
    endRun(task, 'A', { status: gone(task, 'A', 'this'), logs: [{ timestampMillis: 0, message: LOST_TOO_OFTEN }], end: 4 });
    expect(taskState(task, hearing('H'))).toBe('running');
    expect(stopReason(task, 'H', 'this', hearing('H'))).toBeNull();
    // a reader that cannot hear H reads failed meanwhile (the admitted change, if H then succeeds)
    expect(taskError(task, hearsNone)).toBe(LOST_TOO_OFTEN);
    endRun(task, 'H', { status: 'succeeded', result: 'H', end: 5 });
    expect([taskState(task, hearing('H')), taskState(task, hearsNone)]).toEqual(['succeeded', 'succeeded']);
  });
});

describe('the guard the solver packages rely on', () => {
  // A run's code can tell whether an earlier RUN (a record with a pool)
  // precedes it in the list, so that work that must not happen twice is not
  // started over one that may have done it. A stop is not a run.
  const earlierRun = (task: Task, runIdHere: string) => {
    const runs = task.runs;
    const at = runs.findIndex((run) => run.id === runIdHere);
    return runs.slice(0, at).some((r) => r.pool);
  };

  it('is true only for a record with a pool before this run, whatever its status, and never for a stop before or after it', () => {
    const me: Run = { id: 'me', pool: 'P', start: 9 };
    const stop: Run = { id: 'S', start: 1, end: 1, status: 'cancelled' };
    expect(earlierRun(makeTask([me]), 'me')).toBe(false);
    expect(earlierRun(makeTask([stop, me]), 'me')).toBe(false);
    expect(earlierRun(makeTask([me, stop]), 'me')).toBe(false);
    expect(earlierRun(makeTask([stop, stop, me]), 'me')).toBe(false);
    for (const spec of SPECS.filter((it) => it.kind !== 'stop')) {
      const other = { ...makeRun(spec, 0), id: 'other' };
      expect(earlierRun(makeTask([other, me]), 'me'), spec.kind).toBe(true);
      expect(earlierRun(makeTask([stop, other, me]), 'me'), spec.kind).toBe(true);
      expect(earlierRun(makeTask([me, other]), 'me'), spec.kind).toBe(false);
    }
  });
});

// Histories on real Automerge, with real concurrency

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

const ACTOR_ORDERS = [
  ['a', 'b'],
  ['b', 'a'],
] as const;

describe('(1) a stop crossing a claim whose code returns', () => {
  // The asker appends a stop S to a task nobody has taken. At the same time a
  // pool Q, which has not seen S, takes the task (run B), and B's code returns
  // before Q sees S. Both writes are appends at the same place, so the merge
  // orders them by actor: either order can happen. A stop is read last, so
  // both orders read B's success.
  const history = (askerDigit: string, poolDigit: string) => {
    const base = A.from<Task>(makeTask(), actor('0'));
    const asker = A.change(replica(base, askerDigit), (task) => {
      expect(stopTask(task, { id: 'S', at: 1 })).toBe(true);
    });
    const claimed = A.change(replica(base, poolDigit), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 1 });
    });
    const returned = A.change(A.clone(claimed), (task) => {
      expect(stopReason(task, 'B', 'this', hearing('B'))).toBeNull();
      endRun(task, 'B', { status: 'succeeded', result: 'B', end: 2 });
    });
    return { asker, claimed, returned };
  };

  /** What one reader reads of each document it has in turn, with a Hearing of its own that B's pool's beats reach while B is open. */
  const readerOver = (docs: Task[]) => {
    const clock = { t: 0, now: () => clock.t };
    const reader = new Hearing(clock);
    return docs.map((doc) => {
      reader.saw(doc.runs);
      reader.heardFrom('B');
      clock.t += BEAT_MS;
      return taskState(doc, reader.heard);
    });
  };

  it('both list orders happen, depending on the actors; the merge is the same on both replicas', () => {
    const orders = ACTOR_ORDERS.map(([askerDigit, poolDigit]) => {
      const { asker, returned } = history(askerDigit, poolDigit);
      const [one, two] = syncBoth(asker, returned);
      expect(ids(one)).toEqual(ids(two));
      return ids(one).join();
    });
    expect(orders.sort()).toEqual(['B,S', 'S,B']);
  });

  for (const [askerDigit, poolDigit] of ACTOR_ORDERS) {
    const actors = `asker actor ${askerDigit}, pool actor ${poolDigit}`;

    it(`[S, B succeeded] and [B succeeded, S] both read succeeded, with B's result, for every reader on both replicas (${actors})`, () => {
      const { asker, returned } = history(askerDigit, poolDigit);
      for (const merged of syncBoth(asker, returned)) {
        for (const heard of [allHeard, hearsNone, hearing('B'), hearing('S')]) {
          expect(taskState(merged, heard), ids(merged).join()).toBe('succeeded');
        }
        expect(endingRun(merged)?.id).toBe('B');
        expect(taskResult(merged)).toBe('B');
        // and the entry may go, and nobody takes the task again
        expect(isWanted(merged)).toBe(false);
        expect(mayDelist(merged, 'this')).toBe(true);
      }
    });

    it(`Q's reader never leaves succeeded once it has read it: running, succeeded, succeeded (${actors})`, () => {
      const { asker, claimed, returned } = history(askerDigit, poolDigit);
      expect(readerOver([claimed, returned, mergeAll(returned, asker)])).toEqual(['running', 'succeeded', 'succeeded']);
    });

    it(`the asker's reader goes cancelled, then stopping when B arrives open, then succeeded when B's success arrives (${actors})`, () => {
      const { asker, claimed, returned } = history(askerDigit, poolDigit);
      const seesClaim = mergeAll(asker, claimed);
      expect(readerOver([asker, seesClaim, mergeAll(seesClaim, returned)])).toEqual(['cancelled', 'stopping', 'succeeded']);
      // B's pool, had it read the stop while B ran, would have stopped it
      expect(stopReason(seesClaim, 'B', 'this', hearing('B'))).toBe('cancelled');
    });

    it(`or, when Q reads the stop before B's code returns, Q records B cancelled: the asker's reader goes cancelled, stopping, cancelled, and Q's running, cancelled (${actors})`, () => {
      const { asker, claimed } = history(askerDigit, poolDigit);
      const qSees = mergeAll(claimed, asker);
      const reason = stopReason(qSees, 'B', 'this', hearing('B'));
      expect(reason).toBe('cancelled');
      const stoppedB = A.change(A.clone(qSees), (task) => endRun(task, 'B', { status: reason!, end: 2 }));
      const seesClaim = mergeAll(asker, claimed);
      expect(readerOver([asker, seesClaim, mergeAll(seesClaim, stoppedB)])).toEqual(['cancelled', 'stopping', 'cancelled']);
      expect(readerOver([claimed, stoppedB])).toEqual(['running', 'cancelled']);
      for (const merged of syncBoth(asker, stoppedB)) {
        for (const heard of [allHeard, hearsNone]) {
          expect(taskState(merged, heard)).toBe('cancelled');
        }
      }
    });
  }
});

describe('(2) two lost, an unheard open run, a concurrent claim, and the restart that records the third loss', () => {
  // [lost, lost, A open by P]. Q cannot hear A and takes the task as B. P
  // restarts, finds A, and records it as gone says: the third loss, failed.
  const history = (pDigit: string, qDigit: string) => {
    const lost = (id: string, index: number) => ({ ...makeRun({ kind: 'lost', pool: 'P' }, index), id });
    const base = A.from<Task>(makeTask([lost('l1', 0), lost('l2', 1), { id: 'A', pool: 'P', start: 2 }]), actor('0'));
    const onQ = A.change(replica(base, qDigit), (task) => {
      expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
      claimRun(task, { id: 'B', pool: 'Q', start: 3 });
    });
    const onP = A.change(replica(base, pDigit), (task) => {
      expect(orphans(task, 'P', () => false).map((run) => run.id)).toEqual(['A']);
      const status = gone(task, 'A', 'this');
      expect(status).toBe('failed');
      endRun(task, 'A', { status, logs: [{ timestampMillis: 0, message: LOST_TOO_OFTEN }], end: 4 });
    });
    return { base, onQ, onP };
  };

  for (const [pDigit, qDigit] of ACTOR_ORDERS) {
    it(`no reading of "ended" changes for a reader that hears the runs, in either merge order (P actor ${pDigit}, Q actor ${qDigit})`, () => {
      const { base, onQ, onP } = history(pDigit, qDigit);
      // before: P's reader (it held A) and anyone hearing A read running; Q's reader hears B only, and reads running
      expect(taskState(base, hearing('A'))).toBe('running');
      expect(taskState(onQ, hearing('B'))).toBe('running');
      expect(taskState(onP, allHeard)).toBe('failed');
      expect(taskError(onP, allHeard)).toBe(LOST_TOO_OFTEN);
      for (const merged of [A.merge(A.clone(onP), onQ), A.merge(A.clone(onQ), onP)]) {
        // B was appended after A, so A's record is first: failed, for every reader
        expect(ids(merged)).toEqual(['l1', 'l2', 'A', 'B']);
        for (const heard of [allHeard, hearsNone, hearing('B')]) {
          expect(taskState(merged, heard)).toBe('failed');
        }
        // B yields, and whatever B's pool records, the reading stays failed
        expect(stopReason(merged, 'B', 'this', hearing('B'))).toBe('yielded');
        for (const status of STATUSES) {
          const after = A.change(A.clone(merged), (task) => endRun(task, 'B', { status, result: 'B', end: 5 }));
          expect(taskState(after, allHeard), status).toBe('failed');
        }
      }
    });
  }

  it('two pools recording their third loss at once: both write failed; the first in the list is the ending', () => {
    const lost = (id: string, index: number) => ({ ...makeRun({ kind: 'lost', pool: 'P' }, index), id });
    const base = A.from<Task>(
      makeTask([lost('l1', 0), lost('l2', 1), { id: 'A', pool: 'P', start: 2 }, { id: 'B', pool: 'Q', start: 3 }]),
      actor('0'),
    );
    const record = (id: string, digit: string) =>
      A.change(replica(base, digit), (task) => endRun(task, id, { status: gone(task, id, 'this'), logs: [{ timestampMillis: 0, message: LOST_TOO_OFTEN }], end: 4 }));
    for (const merged of syncBoth(record('A', 'a'), record('B', 'b'))) {
      expect(merged.runs.map((run) => run.status)).toEqual(['lost', 'lost', 'failed', 'failed']);
      expect(endingRun(merged)?.id).toBe('A');
      expect(taskError(merged, allHeard)).toBe(LOST_TOO_OFTEN);
    }
  });

  it('two pools each recording a second loss at once write lost, lost: three lost and no ending, so the task is taken again, and its next loss is its failure', () => {
    const lost = (id: string, index: number) => ({ ...makeRun({ kind: 'lost', pool: 'P' }, index), id });
    const base = A.from<Task>(makeTask([lost('l1', 0), { id: 'A', pool: 'P', start: 1 }, { id: 'B', pool: 'Q', start: 2 }]), actor('0'));
    const record = (id: string, digit: string) => A.change(replica(base, digit), (task) => endRun(task, id, { status: gone(task, id, 'this'), end: 4 }));
    for (const merged of syncBoth(record('A', 'a'), record('B', 'b'))) {
      expect(merged.runs.map((run) => run.status)).toEqual(['lost', 'lost', 'lost']);
      expect(ending(merged, allHeard)).toBeNull();
      expect(isWanted(merged)).toBe(true);
      expect(mayClaim(merged, 'R', 'this', hearsNone)).toBe(true);
      const again = A.change(merged, (task) => claimRun(task, { id: 'C', pool: 'R', start: 5 }));
      expect(gone(again, 'C', 'this')).toBe('failed');
    }
  });
});

describe('(3) a document under an entry that is not a task', () => {
  const NOT_TASKS = [{ title: 'not a task' }, { importUrl: 'x' }, { runs: [] }, { importUrl: 'x', runs: 'r' }, { importUrl: 'x', runs: {} }] as unknown as Task[];

  it('is not wanted, not taken, not listed again, and its entry is not let go by a pool (it has no record that ends it)', () => {
    for (const notATask of NOT_TASKS) {
      const label = JSON.stringify(notATask);
      expect(isTask(notATask), label).toBe(false);
      expect(isWanted(notATask), label).toBe(false);
      for (const heard of [allHeard, hearsNone]) {
        expect(mayClaim(notATask, 'P', 'this', heard), label).toBe(false);
        expect(mayRelist(notATask, 'none', heard, 0, LAPSE_MS), label).toBe(false);
      }
    }
    // one with no runs at all reads as a task nobody has taken, and is never delisted by a pool
    const noRuns = { title: 'not a task' } as unknown as Task;
    expect(holder(noRuns, allHeard)).toBeNull();
    expect(ending(noRuns, allHeard)).toBeNull();
    expect(taskState(noRuns, allHeard)).toBe('waiting');
    expect(mayDelist(noRuns, 'this')).toBe(false);
  });

  /** `runs` as anyone could write it: missing, null, a map, a number, a string. */
  const MALFORMED: [string, unknown][] = [
    ['missing', undefined],
    ['null', null],
    ['{}', {}],
    ['{ r0: an open run }', { r0: { id: 'r0', pool: 'P', start: 0 } }],
    ['5', 5],
    ['a string', 'r0'],
  ];
  const malformed = (runs: unknown) => {
    const doc: Record<string, unknown> = { importUrl: 'data:text/javascript,export default () => 1', input: null, key: 'K' };
    if (runs !== undefined) {
      doc.runs = runs;
    }
    return doc as unknown as Task;
  };

  /** Every exported reading of a task, each as a person or a pool would ask it. */
  const readings = (doc: Task) => ({
    recordsOf: recordsOf(doc),
    isTask: isTask(doc),
    isWanted: isWanted(doc),
    holder: [holder(doc, allHeard), holder(doc, hearsNone)],
    endingRun: endingRun(doc),
    lostCount: lostCount(doc),
    ending: [ending(doc, allHeard), ending(doc, hearsNone)],
    taskState: [taskState(doc, allHeard), taskState(doc, hearsNone)],
    taskResult: taskResult(doc),
    taskError: [taskError(doc, allHeard), taskError(doc, hearsNone)],
    mayClaim: mayClaim(doc, 'P', 'this', hearsNone),
    stopReason: stopReason(doc, 'r0', 'this', allHeard),
    gone: gone(doc, 'r0', 'this'),
    orphans: orphans(doc, 'P', () => false),
    mayDelist: mayDelist(doc, 'this'),
    mayRelist: mayRelist(doc, 'none', hearsNone, 0, LAPSE_MS),
  });
  /** What every reading gives for a document with no records that is not a task. */
  const NO_RECORDS = {
    recordsOf: [],
    isTask: false,
    isWanted: false,
    holder: [null, null],
    endingRun: null,
    lostCount: 0,
    ending: [null, null],
    taskState: ['waiting', 'waiting'],
    taskResult: undefined,
    taskError: [null, null],
    mayClaim: false,
    stopReason: 'yielded',
    gone: 'yielded',
    orphans: [],
    mayDelist: false,
    mayRelist: false,
  };

  it('whose runs are missing, null, a map, a number or a string: every reading returns without throwing and reads no records', () => {
    for (const [name, runs] of MALFORMED) {
      const doc = malformed(runs);
      expect(() => readings(doc), name).not.toThrow();
      expect(readings(doc), name).toEqual(NO_RECORDS);
    }
  });

  it('whose runs are malformed: stopTask refuses it and writes nothing; endRun writes nothing; Hearing.saw takes recordsOf without throwing', () => {
    for (const [name, runs] of MALFORMED) {
      const doc = malformed(runs);
      const before = structuredClone(doc);
      expect(stopTask(doc, { id: 'S', at: 1 }), name).toBe(false);
      endRun(doc, 'r0', { status: 'succeeded', result: 1, end: 2 });
      expect(doc, name).toEqual(before);
      expect(() => new Hearing().saw(recordsOf(doc)), name).not.toThrow();
    }
  });

  it('whose runs are malformed, on a real Automerge document: the same readings, and stopTask inside a change writes nothing', () => {
    for (const [name, runs] of MALFORMED) {
      const doc = A.from<Task>(malformed(runs) as any, actor('0'));
      expect(readings(doc), name).toEqual(NO_RECORDS);
      const after = A.change(doc, (task) => {
        expect(stopTask(task, { id: 'S', at: 1 }), name).toBe(false);
      });
      expect(A.getHeads(after), name).toEqual(A.getHeads(doc));
    }
  });

  it('a list of runs that holds something that is no record (null; anyone can write one) reads as a task without it, and nothing throws', () => {
    // The list is a list, so the document is a task; the entry that is no
    // record is passed over by every reading, and by a listener's Hearing.
    const doc = A.change(A.from<Task>(makeTask(), actor('0')), (task) => {
      (task.runs as unknown as unknown[]).push(null);
    });
    expect(isTask(doc)).toBe(true);
    expect(recordsOf(doc)).toEqual([]);
    expect(() => readings(doc)).not.toThrow();
    expect(() => new Hearing().saw(recordsOf(doc))).not.toThrow();
    expect(taskState(doc, allHeard)).toBe('waiting');
    // a run taken after it is found and completed in its own place in the list
    const taken = A.change(doc, (task) => claimRun(task, { id: 'A', pool: 'P', start: 1 }));
    expect(recordsOf(taken).map((run) => run.id)).toEqual(['A']);
    const done = A.change(taken, (task) => endRun(task, 'A', { status: 'succeeded', result: 1, end: 2 }));
    expect(done.runs[0]).toBeNull();
    expect(done.runs[1]).toMatchObject({ id: 'A', status: 'succeeded', result: 1 });
    expect(taskState(done, allHeard)).toBe('succeeded');
  });
});

describe('stops', () => {
  const baseTask = (runs: Run[] = []) => A.from<Task>(makeTask(runs), actor('0'));
  const open = (id: string, pool: string): Run => ({ id, pool, start: 0 });

  it('two stops at once: two records, both cancelled; the reading is cancelled either way', () => {
    for (const runs of [[], [open('A', 'P')]]) {
      const base = baseTask(runs);
      const one = A.change(replica(base, 'a'), (task) => void stopTask(task, { id: 'S1', at: 1 }));
      const two = A.change(replica(base, 'b'), (task) => void stopTask(task, { id: 'S2', at: 1 }));
      for (const merged of syncBoth(one, two)) {
        expect(merged.runs.filter((run) => !run.pool).map((run) => run.status)).toEqual(['cancelled', 'cancelled']);
        expect(ending(merged, hearsNone)).toBe('cancelled');
        expect(taskState(merged, allHeard)).toBe(runs.length ? 'stopping' : 'cancelled');
      }
    }
  });

  it("a stop appended while the run's pool completes it: the stop lands after the run, whose status is the ending, in either merge order", () => {
    for (const status of STATUSES) {
      const base = baseTask([open('A', 'P')]);
      const asker = A.change(replica(base, 'a'), (task) => void stopTask(task, { id: 'S', at: 1 }));
      const pool = A.change(replica(base, 'b'), (task) => endRun(task, 'A', { status, result: 'A', end: 1 }));
      // before: the asker's reader reads stopping while it hears A, cancelled once it does not
      expect([taskState(asker, hearing('A')), taskState(asker, hearsNone)]).toEqual(['stopping', 'cancelled']);
      for (const merged of [mergeAll(asker, pool), mergeAll(pool, asker)]) {
        expect(ids(merged)).toEqual(['A', 'S']);
        const want = FINALS.includes(status as FinalStatus) ? status : 'cancelled';
        expect([ending(merged, allHeard), ending(merged, hearsNone)], status).toEqual([want, want]);
      }
    }
  });

  it("a stop on a task whose only open run's pool is dead: allHeard reads stopping for ever, a listener cancelled after the lapse; that pool, coming back, records cancelled", () => {
    const task = makeTask([{ id: 'A', pool: 'dead', start: 0 }]);
    expect(stopTask(task, { id: 'S', at: 1 })).toBe(true);
    expect(taskState(task, allHeard)).toBe('stopping');
    expect(taskState(task, hearsNone)).toBe('cancelled');
    expect(isWanted(task)).toBe(false);
    expect(mayDelist(task, 'this')).toBe(true);
    expect(gone(task, 'A', 'this')).toBe('cancelled');
    endRun(task, 'A', { status: gone(task, 'A', 'this'), end: 2 });
    expect(taskState(task, allHeard)).toBe('cancelled');
  });

  it('a stop and an open run whose pool is dead, in either order: a listener reads cancelled a lapse after it first saw the run; allHeard reads stopping for ever', () => {
    // allHeard is used by one-look readers only: openfoam's and fea's
    // lookAtTask (run-tasks.js), which a person's view and an agent tool call
    // once and show, and their net-run probes, which read it after the run has
    // been recorded. None waits on it, so none waits for ever here.
    const dead: Run = { id: 'A', pool: 'dead', start: 0 };
    const stop: Run = { id: 'S', start: 1, end: 1, status: 'cancelled' };
    for (const runs of [
      [dead, stop],
      [stop, dead],
    ]) {
      const task = makeTask(runs);
      const order = ids(task).join();
      expect(isWanted(task), order).toBe(false);
      const clock = { t: 0, now: () => clock.t };
      const listener = new Hearing(clock);
      listener.saw(task.runs);
      for (const t of [0, LAPSE_MS - 1]) {
        clock.t = t;
        expect(taskState(task, listener.heard), `${order} at ${t}`).toBe('stopping');
      }
      clock.t = LAPSE_MS;
      expect(taskState(task, listener.heard), order).toBe('cancelled');
      for (const t of [LAPSE_MS, LAPSE_MS * 100]) {
        clock.t = t;
        expect(taskState(task, allHeard), `${order}: allHeard at ${t}`).toBe('stopping');
      }
      // the dead pool, if it ever comes back, records A as gone says: cancelled, and then every reader agrees
      expect(gone(task, 'A', 'none'), order).toBe('cancelled');
      endRun(task, 'A', { status: 'cancelled', end: 2 });
      expect([taskState(task, allHeard), taskState(task, hearsNone)], order).toEqual(['cancelled', 'cancelled']);
    }
  });

  it('a stop with only closed runs that end nothing (lost, yielded), at any place among them: cancelled, for every reader', () => {
    let tried = 0;
    for (const closed of [[], ['lost'], ['yielded'], ['lost', 'yielded'], ['yielded', 'lost'], ['lost', 'lost']] as const) {
      for (let at = 0; at <= closed.length; at++) {
        const specs: Spec[] = closed.map((kind): Spec => ({ kind, pool: 'P' }));
        specs.splice(at, 0, { kind: 'stop', pool: null });
        const task = makeTask(specs.map(makeRun));
        for (const heard of [allHeard, hearsNone]) {
          expect(taskState(task, heard), labelOf(specs)).toBe('cancelled');
        }
        expect(endingRun(task)?.status, labelOf(specs)).toBe('cancelled');
        expect(isStop(endingRun(task)!)).toBe(true);
        tried++;
      }
    }
    expect(tried).toBe(1 + 2 + 2 + 3 + 3 + 3);
  });

  it('a stop with a failed run, in either order: failed, for every reader, with the failure as the reason; and with a succeeded run, succeeded', () => {
    for (const kind of ['failed', 'succeeded'] as const) {
      for (const specs of [
        [{ kind: 'stop', pool: null }, { kind, pool: 'P' }],
        [{ kind, pool: 'P' }, { kind: 'stop', pool: null }],
      ] as Spec[][]) {
        const task = makeTask(specs.map(makeRun));
        const at = specs.findIndex((spec) => spec.kind === kind);
        for (const heard of [allHeard, hearsNone]) {
          expect(taskState(task, heard), labelOf(specs)).toBe(kind);
        }
        expect(endingRun(task)?.id).toBe(runId(at));
        expect(taskError(task, allHeard)).toBe(kind === 'failed' ? failedLine(runId(at)) : null);
        expect(taskResult(task)).toEqual(kind === 'succeeded' ? { from: runId(at) } : undefined);
      }
    }
  });

  describe('a run that sees both a success and a stop yields: its pool records yielded, and the ending stays the success', () => {
    // [A open by P]. Q cannot hear A and takes the task as B, which succeeds;
    // at the same time an asker stops it. Then P looks at A, having had all
    // of that (fresh), or only some of it (stale).
    const history = (askerDigit: string, qDigit: string) => {
      const base = A.from<Task>(makeTask([{ id: 'A', pool: 'P', start: 0 }]), actor('0'));
      const onQ = A.change(replica(base, qDigit), (task) => {
        expect(mayClaim(task, 'Q', 'this', hearsNone)).toBe(true);
        claimRun(task, { id: 'B', pool: 'Q', start: 1 });
        endRun(task, 'B', { status: 'succeeded', result: 'B', end: 2 });
      });
      const asker = A.change(replica(base, askerDigit), (task) => void stopTask(task, { id: 'S', at: 1 }));
      return { base, onQ, asker };
    };
    /** P completes A as stopReason tells it on what it has, and that reaches everyone. */
    const pActs = (view: A.Doc<Task>, ...rest: A.Doc<Task>[]) => {
      const reason = stopReason(view, 'A', 'this', hearing('A'));
      const status = reason ?? 'succeeded';
      const after = A.change(A.clone(view, actor('f')), (task) => endRun(task, 'A', { status, result: 'A', end: 3 }));
      return { reason, merged: mergeAll(after, ...rest) };
    };

    for (const [askerDigit, qDigit] of ACTOR_ORDERS) {
      const actors = `asker actor ${askerDigit}, Q actor ${qDigit}`;

      it(`fresh: P has B's success and the stop, in either list order: yielded; succeeded by B for every reader (${actors})`, () => {
        const { onQ, asker } = history(askerDigit, qDigit);
        const fresh = mergeAll(onQ, asker);
        expect(ids(fresh).slice(1).sort()).toEqual(['B', 'S']);
        const { reason, merged } = pActs(fresh);
        expect(reason).toBe('yielded');
        for (const heard of [allHeard, hearsNone, hearing('A')]) {
          expect(taskState(merged, heard)).toBe('succeeded');
        }
        expect(taskResult(merged)).toBe('B');
      });

      it(`stale, P has only the success: yielded; succeeded by B (${actors})`, () => {
        const { onQ, asker } = history(askerDigit, qDigit);
        const { reason, merged } = pActs(onQ, asker);
        expect(reason).toBe('yielded');
        expect([taskState(merged, allHeard), taskResult(merged)]).toEqual(['succeeded', 'B']);
      });

      it(`stale, P has only the stop: cancelled, and A is the first final run, so the task reads cancelled; a reader that could not hear A had read succeeded (the admitted change), one that heard A had read stopping (${actors})`, () => {
        const { onQ, asker } = history(askerDigit, qDigit);
        const before = mergeAll(onQ, asker);
        expect([taskState(before, hearsNone), taskState(before, hearing('A'))]).toEqual(['succeeded', 'stopping']);
        const { reason, merged } = pActs(asker, onQ);
        expect(reason).toBe('cancelled');
        for (const heard of [allHeard, hearsNone]) {
          expect(taskState(merged, heard)).toBe('cancelled');
        }
        expect(endingRun(merged)?.id).toBe('A');
      });

      it(`stale, P has neither: A carries on, and its success is the ending, by A (${actors})`, () => {
        const { base, onQ, asker } = history(askerDigit, qDigit);
        const { reason, merged } = pActs(base, onQ, asker);
        expect(reason).toBeNull();
        expect([taskState(merged, hearsNone), taskResult(merged)]).toEqual(['succeeded', 'A']);
      });
    }
  });

  it('recordsOf counts an Automerge list as a list: inside a change (a proxy) and outside it, and a stop written through the proxy is read back', () => {
    const doc = A.from<Task>(makeTask([{ id: 'A', pool: 'P', start: 0 }]), actor('0'));
    expect(Array.isArray(doc.runs)).toBe(true);
    expect(recordsOf(doc).map((run) => run.id)).toEqual(['A']);
    const after = A.change(doc, (task) => {
      expect(Array.isArray(task.runs)).toBe(true);
      expect(recordsOf(task).map((run) => run.id)).toEqual(['A']);
      expect(isTask(task)).toBe(true);
      expect(isWanted(task)).toBe(true);
      expect(stopTask(task, { id: 'S', at: 1 })).toBe(true);
      expect(recordsOf(task).map((run) => run.id)).toEqual(['A', 'S']);
      expect(taskState(task, allHeard)).toBe('stopping');
    });
    const loaded = A.load<Task>(A.save(after));
    expect(recordsOf(loaded).map((run) => run.id)).toEqual(['A', 'S']);
    expect(taskState(loaded, hearsNone)).toBe('cancelled');
  });

  it('stopTask on a task some record has ended writes nothing and says so', () => {
    for (const kind of ['succeeded', 'failed', 'cancelled', 'stop'] as const) {
      const task = makeTask([makeRun({ kind, pool: 'P' }, 0)]);
      const before = copy(task);
      expect(stopTask(task, { id: 'S', at: 1 })).toBe(false);
      expect(task).toEqual(before);
    }
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

  it("a stop appended at the same time as the run's success reads 'succeeded' on both replicas: the stop lands after the run", () => {
    const base = baseTask([open('A', 'P')]);
    const asker = A.change(replica(base, 'a'), (task) => void stopTask(task, { id: 'S', at: 1 }));
    const pool = A.change(replica(base, 'b'), (task) => endRun(task, 'A', { status: 'succeeded', result: 42, end: 1 }));
    for (const doc of syncBoth(asker, pool)) {
      expect(ids(doc)).toEqual(['A', 'S']);
      expect(ending(doc, hearsNone)).toBe('succeeded');
      expect(taskState(doc, allHeard)).toBe('succeeded');
      expect(taskResult(doc)).toBe(42);
    }
  });

  it('three runs lost by three pools at once, each having seen none lost: three lost records, no ending, and the task is wanted; the fourth start is the last', () => {
    const base = baseTask([open('A', 'P'), open('B', 'Q'), open('C', 'R')]);
    const [a, b, c] = (['A', 'B', 'C'] as const).map((id, n) =>
      A.change(replica(base, 'abc'[n]), (task) => endRun(task, id, { status: gone(task, id, 'this'), end: 1 })),
    );
    for (const doc of [mergeAll(a, b, c), mergeAll(b, c, a), mergeAll(c, a, b)]) {
      expect(doc.runs.map((run) => run.status)).toEqual(['lost', 'lost', 'lost']);
      expect(ending(doc, allHeard)).toBeNull();
      expect(taskState(doc, allHeard)).toBe('waiting');
      expect(taskError(doc, allHeard)).toBeNull();
      expect(mayClaim(doc, 'S', 'this', hearsNone)).toBe(true);
      const fourth = A.change(doc, (task) => claimRun(task, { id: 'D', pool: 'S', start: 2 }));
      expect(gone(fourth, 'D', 'this')).toBe('failed');
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

  it('a stop crossing two runs: the first run in list order is the ending, whether it is the one stopped for the stop or the one that succeeded without seeing it', () => {
    for (const [statusA, statusB] of [
      ['succeeded', 'cancelled'],
      ['cancelled', 'succeeded'],
    ] as const) {
      const base = baseTask([open('A', 'P'), open('B', 'Q')]);
      const asker = A.change(replica(base, 'c'), (task) => void stopTask(task, { id: 'S', at: 1 }));
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
        expect(ids(doc)).toEqual(['A', 'B', 'S']);
        expect(ending(doc, allHeard), `${statusA} then ${statusB}`).toBe(statusA);
        expect(taskState(doc, allHeard)).toBe(statusA);
        expect(taskResult(doc)).toBe(statusA === 'succeeded' ? 'A' : undefined);
      }
    }
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

  it('give a result only for a task that succeeded, from the record that ended it', () => {
    expect(taskResult(makeTask([run('yielded', 0), run('succeeded', 1)]))).toEqual({ from: 'r1' });
    expect(taskResult(makeTask([run('failed', 0), run('succeeded', 1)]))).toBeUndefined();
    // a stop is read last: a stop before the success takes nothing from it
    expect(taskResult(makeTask([run('stop', 0), run('succeeded', 1)]))).toEqual({ from: 'r1' });
    expect(taskResult(makeTask([run('stop', 0), run('cancelled', 1), run('succeeded', 2)]))).toBeUndefined();
    expect(taskResult(makeTask([run('stop', 0)]))).toBeUndefined();
    expect(taskResult(makeTask([run('lost', 0), run('lost', 1), run('lost', 2)]))).toBeUndefined();
    expect(taskResult(makeTask([{ id: 'A', pool: 'P', start: 0 }]))).toBeUndefined();
    expect(taskResult(undefined)).toBeUndefined();
  });

  it("give a reason only for a task that failed: the failing record's last line, 'failed' without one; nothing is read from a count", () => {
    const task = makeTask([{ id: 'A', pool: 'P', start: 0 }]);
    endRun(task, 'A', { status: 'failed', logs: [{ timestampMillis: 1, message: 'first' }, { timestampMillis: 2, message: 'boom' }], end: 3 });
    expect(taskError(task, allHeard)).toBe('boom');
    expect(taskError(makeTask([{ id: 'A', pool: 'P', start: 0, end: 1, status: 'failed' }]), allHeard)).toBe('failed');
    // three losses with no record of the third as a failure: not failed
    expect(taskError(makeTask([run('lost', 0), run('lost', 1), run('lost', 2)]), allHeard)).toBeNull();
    // the third loss, as its pool records it
    const third = makeTask([run('lost', 0), run('lost', 1), { id: 'A', pool: 'P', start: 2 }]);
    endRun(third, 'A', { status: gone(third, 'A', 'this'), logs: [{ timestampMillis: 0, message: LOST_TOO_OFTEN }], end: 3 });
    expect(taskError(third, hearsNone)).toBe(LOST_TOO_OFTEN);
    // a failure after a heard run is no answer yet to one who hears it
    const held = makeTask([{ id: 'D', pool: 'P', start: 0 }, run('failed', 1)]);
    expect(taskError(held, hearing('D'))).toBeNull();
    expect(taskError(held, hearsNone)).toBe(failedLine('r1'));
    expect(taskError(makeTask([run('succeeded', 0), run('failed', 1)]), allHeard)).toBeNull();
    expect(taskError(makeTask([run('stop', 0)]), allHeard)).toBeNull();
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
