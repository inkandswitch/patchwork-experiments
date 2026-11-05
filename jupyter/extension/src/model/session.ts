import type { DocBackend, DocChange } from './backend';
import type { UndoManager, UndoOp } from './undo';
import type { NotebookDoc } from './schema';

export type Transaction = {
  origin: unknown;
  recorder: UndoManager | null;
  ops: UndoOp[];
  draft: NotebookDoc;
};

/**
 * Groups writes into a single Automerge change, the equivalent of a Yjs
 * transaction: nested writes join the outermost one, change events are
 * emitted once it commits, and work deferred with `afterCommit` (state
 * notifications) runs after those events.
 */
export class Session {
  constructor(
    backend: DocBackend<NotebookDoc>,
    onChange: (change: DocChange<NotebookDoc>, transaction: Transaction | null) => void
  ) {
    this.backend = backend;
    this._onChange = onChange;
    this._unsubscribe = backend.subscribe(change => this._commit(change, null));
  }

  readonly backend: DocBackend<NotebookDoc>;

  /** The document as seen by the current transaction, or the committed one. */
  get doc(): NotebookDoc {
    return this._transaction?.draft ?? this.backend.doc();
  }

  get transaction(): Transaction | null {
    return this._transaction;
  }

  /** Whether undo operations are being recorded by the current transaction. */
  get recording(): boolean {
    return !!this._transaction?.recorder;
  }

  write(options: { origin?: unknown; recorder?: UndoManager | null }, fn: (draft: NotebookDoc) => void): void {
    if (this._transaction) {
      fn(this._transaction.draft);
      return;
    }
    const transaction: Transaction = {
      origin: options.origin ?? null,
      recorder: options.recorder ?? null,
      ops: [],
      draft: undefined as unknown as NotebookDoc
    };
    this._transaction = transaction;
    let change: DocChange<NotebookDoc> | null;
    try {
      change = this.backend.change(draft => {
        transaction.draft = draft;
        fn(draft);
      });
    } finally {
      this._transaction = null;
    }
    if (transaction.recorder && transaction.ops.length > 0) {
      transaction.recorder.push(transaction.ops);
    }
    this._commit(change, transaction);
  }

  record(op: UndoOp): void {
    this._transaction?.recorder && this._transaction.ops.push(op);
  }

  afterCommit(fn: () => void): void {
    if (this._transaction) {
      this._deferred.push(fn);
    } else {
      fn();
    }
  }

  dispose(): void {
    this._unsubscribe();
    this._deferred = [];
    this.backend.dispose();
  }

  private _commit(change: DocChange<NotebookDoc> | null, transaction: Transaction | null): void {
    if (change) {
      this._onChange(change, transaction);
    }
    const deferred = this._deferred;
    this._deferred = [];
    for (const fn of deferred) fn();
  }

  private _deferred: Array<() => void> = [];
  private _onChange: (change: DocChange<NotebookDoc>, transaction: Transaction | null) => void;
  private _transaction: Transaction | null = null;
  private _unsubscribe: () => void;
}
