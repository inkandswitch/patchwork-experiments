// Evaluating a sheet somewhere else (in a worker), so that long evaluations and searches
// don't share a thread with the UI.
//
// Formulas compile to closures, which can't be sent between threads. So the worker is
// sent the sheet's text and compiles it for itself, and what comes back is data: the
// scenarios, a batch of rows at a time, and how the work is going. The two halves are:
//
//   - EvaluationServer, which lives in the worker (see worker.ts) and does the work: the
//     evaluation of the sheet, and on request a focused search (focus.ts) and an exact
//     count (exact.ts), all in interleaved slices;
//   - RemoteEvaluator, which lives with the UI, and turns the worker's messages back into
//     the Run, Focus and ExactCount objects that the rest of the code works with.
//
// Neither half touches a Worker directly: they are given a function to send messages
// with, and are told about the messages that arrive. (Which is also how they are tested.)

import { ASError } from '../lang/values';
import type { Filters } from './analysis';
import { compileSheet, type CompiledSheet } from './compile';
import { ExactEvaluation, type ExactCount } from './exact';
import { FocusEvaluation, type Focus, type FocusSettings } from './focus';
import { Evaluation, type CellAnalysis, type EvalSettings, type Run } from './run';

type Rows = Record<string, any[]>;

export type ToWorker =
  /** A new version of the sheet. `run` says whether to evaluate it, or just to be ready for the rest. */
  | { type: 'sheet'; sheet: number; data: unknown; settings: EvalSettings; run: boolean }
  | { type: 'sampleMore'; sheet: number; count: number }
  | { type: 'focus'; sheet: number; job: number; filters: Filters; settings: FocusSettings }
  | { type: 'stopFocus' }
  | { type: 'exact'; sheet: number; job: number; filters: Filters }
  | { type: 'stopExact' }
  /** "Are you there?" (Answered with a pong.) */
  | { type: 'ping' };

type RunState = Pick<Run, 'mode' | 'requested' | 'reason' | 'n' | 'target' | 'done' | 'msPerScenario'>;
type FocusState = Omit<Focus, 'columns' | 'filters'>;
type WireAnalysis = Record<string, { histogram?: [any, number][]; stats?: CellAnalysis['stats'] }>;

export type FromWorker =
  /** Rows `from` onwards of the run (everything before was sent earlier), and its state. */
  | { type: 'run'; sheet: number; state: RunState; from: number; rows: Rows; analysis: WireAnalysis }
  | { type: 'focus'; job: number; state: FocusState; from: number; rows: Rows }
  | { type: 'exact'; job: number; count: Omit<ExactCount, 'filters'> }
  | { type: 'pong' };

// Error values are objects of a class, which don't survive being sent. They travel as
// { $error: [short, long] } and are turned back into ASErrors (the same one for the same
// error, since values are grouped by identity).

const encode = (value: unknown) =>
  value instanceof ASError ? { $error: [value.shortMsg, value.msg] } : value;

const revived = new Map<string, ASError>();

function decode(value: any): any {
  if (value === null || typeof value !== 'object' || !('$error' in value)) return value;
  const [shortMsg, msg] = value.$error as [string, string];
  const key = shortMsg + '\n' + msg;
  let error = revived.get(key);
  if (!error) revived.set(key, (error = new ASError(shortMsg, msg)));
  return error;
}

/** Rows `from` to `to` of some columns, ready to send. */
function slice(columns: Rows, from: number, to: number): Rows {
  const rows: Rows = {};
  for (const key in columns) {
    const column = columns[key];
    const part = new Array(to - from);
    for (let i = from; i < to; i++) part[i - from] = encode(column[i]);
    rows[key] = part;
  }
  return rows;
}

function append(columns: Rows, from: number, rows: Rows): void {
  for (const key in rows) {
    const column = (columns[key] ??= []);
    column.length = from; // (drop anything that this batch replaces)
    for (const value of rows[key]) column.push(decode(value));
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const SLICE_MS = 10;
/** The least time between two messages about the same job. */
const REPORT_RUN_MS = 40;
const REPORT_FOCUS_MS = 60;
const REPORT_EXACT_MS = 200;

interface Job<E> {
  id: number;
  work: E;
  /** How many rows have been sent. */
  sent: number;
  reported: number;
}

/** The worker's half. Does the work, a slice at a time, and reports. */
export class EvaluationServer {
  private sheet = -1;
  private compiled: CompiledSheet | null = null;
  private settings: EvalSettings | null = null;
  private evaluation: Job<Evaluation> | null = null;
  private focus: Job<FocusEvaluation> | null = null;
  private exact: Job<ExactEvaluation> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly post: (message: FromWorker) => void) {}

  receive(message: ToWorker): void {
    switch (message.type) {
      case 'ping':
        this.post({ type: 'pong' });
        return;
      case 'sheet':
        // everything that was going on was about the previous version of the sheet
        this.sheet = message.sheet;
        this.compiled = compileSheet(message.data);
        this.settings = message.settings;
        this.focus = this.exact = null;
        this.evaluation = message.run
          ? { id: message.sheet, work: new Evaluation(this.compiled, message.settings), sent: 0, reported: 0 }
          : null;
        break;
      case 'sampleMore':
        if (message.sheet !== this.sheet || !this.compiled || !this.settings) return;
        if (!this.evaluation) {
          // (the first samples were drawn on the other side: draw them again, the same)
          const work = new Evaluation(this.compiled, this.settings);
          work.advance();
          this.evaluation = { id: this.sheet, work, sent: work.run.n, reported: 0 };
        }
        this.evaluation.work.extend(message.count);
        break;
      case 'focus':
        if (message.sheet !== this.sheet || !this.compiled) return;
        this.focus = {
          id: message.job,
          work: new FocusEvaluation(this.compiled, message.filters, message.settings),
          sent: 0,
          reported: 0,
        };
        break;
      case 'stopFocus':
        this.focus = null;
        break;
      case 'exact':
        if (message.sheet !== this.sheet || !this.compiled) return;
        this.exact = {
          id: message.job,
          work: new ExactEvaluation(this.compiled, message.filters),
          sent: 0,
          reported: 0,
        };
        break;
      case 'stopExact':
        this.exact = null;
        break;
    }
    if (this.timer === null) this.timer = setTimeout(this.tick, 0);
  }

  /** Stops everything. */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.evaluation = this.focus = this.exact = null;
  }

  /** One round: a slice of each job that has work left, then a breath (for messages to arrive). */
  private tick = (): void => {
    this.timer = null;
    let busy = false;

    const evaluation = this.evaluation;
    if (evaluation && (!evaluation.work.run.done || evaluation.reported === 0)) {
      const { run } = evaluation.work;
      evaluation.work.advance(SLICE_MS);
      if (run.done || now() - evaluation.reported >= REPORT_RUN_MS) {
        const analysis: WireAnalysis = {};
        for (const { id } of run.compiled.subjects) {
          const subject = run.analysis[id];
          if (!subject) continue;
          analysis[id] = {
            stats: subject.stats,
            histogram: subject.histogram && [...subject.histogram].map(([value, count]) => [encode(value), count]),
          };
        }
        const { mode, requested, reason, n, target, done, msPerScenario } = run;
        this.post({
          type: 'run',
          sheet: evaluation.id,
          state: { mode, requested, reason, n, target, done, msPerScenario },
          from: evaluation.sent,
          rows: slice(run.columns, evaluation.sent, n),
          analysis,
        });
        evaluation.sent = n;
        evaluation.reported = now();
      }
      busy ||= !run.done;
    }

    const focus = this.focus;
    if (focus && (!focus.work.focus.done || focus.reported === 0)) {
      focus.work.advance(SLICE_MS);
      const { columns: _c, filters: _f, ...state } = focus.work.focus;
      if (state.done || now() - focus.reported >= REPORT_FOCUS_MS) {
        this.post({
          type: 'focus',
          job: focus.id,
          state: { ...state },
          from: focus.sent,
          rows: slice(focus.work.focus.columns, focus.sent, state.n),
        });
        focus.sent = state.n;
        focus.reported = now();
      }
      busy ||= !state.done;
    }

    const exact = this.exact;
    if (exact && (!exact.work.count.done || exact.reported === 0)) {
      exact.work.advance(SLICE_MS);
      const { filters: _f, ...count } = exact.work.count;
      if (count.done || now() - exact.reported >= REPORT_EXACT_MS) {
        this.post({ type: 'exact', job: exact.id, count });
        exact.reported = now();
      }
      busy ||= !count.done;
    }

    if (busy) this.timer = setTimeout(this.tick, 0);
  };
}

export interface RemoteCallbacks {
  onRun(run: Run): void;
  onFocus(focus: Focus): void;
  onExact(count: ExactCount): void;
}

/** The UI's half. Asks for work, and turns what comes back into runs, focuses and counts. */
export class RemoteEvaluator {
  private sheet = 0;
  private jobs = 0;
  private compiled: CompiledSheet | null = null;
  private columns: Rows = {};
  private focusJob: { id: number; filters: Filters; columns: Rows } | null = null;
  private exactJob: { id: number; filters: Filters } | null = null;

  constructor(
    private readonly send: (message: ToWorker) => void,
    private readonly callbacks: RemoteCallbacks,
  ) {}

  /**
   * Tells the worker about a new version of the sheet (`compiled` is this side's own
   * compilation of the same data), and, if `run`, asks for it to be evaluated.
   */
  setSheet(compiled: CompiledSheet, data: unknown, settings: EvalSettings, run: boolean): void {
    this.sheet++;
    this.compiled = compiled;
    this.columns = {};
    this.focusJob = this.exactJob = null;
    this.send({ type: 'sheet', sheet: this.sheet, data, settings, run });
  }

  /**
   * Takes over the scenarios of a run that was evaluated on this side, so that more
   * samples from the worker have something to be added to.
   */
  adopt(columns: Record<string, any[]>): void {
    this.columns = columns;
  }

  sampleMore(count: number): void {
    this.send({ type: 'sampleMore', sheet: this.sheet, count });
  }

  focus(filters: Filters, settings: FocusSettings): void {
    this.focusJob = { id: ++this.jobs, filters, columns: {} };
    this.send({ type: 'focus', sheet: this.sheet, job: this.focusJob.id, filters, settings });
  }

  stopFocus(): void {
    if (this.focusJob) this.send({ type: 'stopFocus' });
    this.focusJob = null;
  }

  exact(filters: Filters): void {
    this.exactJob = { id: ++this.jobs, filters };
    this.send({ type: 'exact', sheet: this.sheet, job: this.exactJob.id, filters });
  }

  stopExact(): void {
    if (this.exactJob) this.send({ type: 'stopExact' });
    this.exactJob = null;
  }

  receive(message: FromWorker): void {
    switch (message.type) {
      case 'pong':
        break;
      case 'run': {
        if (message.sheet !== this.sheet || !this.compiled) return; // (about an older version)
        append(this.columns, message.from, message.rows);
        const analysis: Record<string, CellAnalysis> = {};
        for (const [id, subject] of Object.entries(message.analysis)) {
          analysis[id] = {
            stats: subject.stats,
            histogram: subject.histogram && new Map(subject.histogram.map(([value, count]) => [decode(value), count])),
          };
        }
        this.callbacks.onRun({ ...message.state, compiled: this.compiled, columns: this.columns, analysis });
        break;
      }
      case 'focus': {
        const job = this.focusJob;
        if (!job || message.job !== job.id) return;
        append(job.columns, message.from, message.rows);
        this.callbacks.onFocus({ ...message.state, filters: job.filters, columns: job.columns });
        break;
      }
      case 'exact': {
        const job = this.exactJob;
        if (!job || message.job !== job.id) return;
        this.callbacks.onExact({ ...message.count, filters: job.filters });
        break;
      }
    }
  }
}
