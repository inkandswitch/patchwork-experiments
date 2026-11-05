import type { Patch, Prop } from '@automerge/automerge';

export type SequenceOp =
  | { retain: number; from: number }
  | { delete: number; from: number }
  | { insert: number; at: number };

/**
 * Folds the sequential insert/delete patches Automerge emits for one list
 * (or text) into a Quill-style delta against the original sequence, while
 * still being able to tell which original element an intermediate index
 * refers to.
 */
export class SequenceComposer {
  constructor(length: number) {
    this._length = length;
    this._current = length;
    this._runs = length > 0 ? [{ origin: 0, length }] : [];
  }

  get changed(): boolean {
    return this._changed;
  }

  get length(): number {
    return this._current;
  }

  /** Apply a patch whose path ends at an index into this sequence. */
  apply(patch: Patch, index: Prop): void {
    const at = Number(index);
    switch (patch.action) {
      case 'insert':
        this.insert(at, patch.values.length);
        break;
      case 'splice':
        this.insert(at, patch.value.length);
        break;
      case 'del':
        this.delete(at, patch.length ?? 1);
        break;
      case 'put':
        this.delete(at, 1);
        this.insert(at, 1);
        break;
    }
  }

  insert(index: number, count: number): void {
    if (count <= 0) return;
    const i = this._split(index);
    this._runs.splice(i, 0, { origin: null, length: count });
    this._current += count;
    this._changed = true;
  }

  delete(index: number, count: number): void {
    count = Math.min(count, this._current - index);
    if (count <= 0) return;
    const start = this._split(index);
    const end = this._split(index + count);
    this._runs.splice(start, end - start);
    this._current -= count;
    this._changed = true;
  }

  /** The original index of the element now at `index`, or null if it was inserted. */
  originOf(index: number): number | null {
    let pos = 0;
    for (const run of this._runs) {
      if (index < pos + run.length) {
        return run.origin === null ? null : run.origin + (index - pos);
      }
      pos += run.length;
    }
    return null;
  }

  /** The current index of an original element, or null if it was deleted. */
  indexOf(origin: number): number | null {
    let pos = 0;
    for (const run of this._runs) {
      if (run.origin !== null && origin >= run.origin && origin < run.origin + run.length) {
        return pos + (origin - run.origin);
      }
      pos += run.length;
    }
    return null;
  }

  /** The delta from the original sequence; a trailing retain is dropped unless asked for. */
  ops(keepTrailingRetain = false): SequenceOp[] {
    const ops: SequenceOp[] = [];
    let nextOrigin = 0;
    let position = 0;
    for (const run of this._runs) {
      if (run.origin === null) {
        pushOp(ops, { insert: run.length, at: position });
      } else {
        if (run.origin > nextOrigin) {
          pushOp(ops, { delete: run.origin - nextOrigin, from: nextOrigin });
        }
        pushOp(ops, { retain: run.length, from: run.origin });
        nextOrigin = run.origin + run.length;
      }
      position += run.length;
    }
    if (nextOrigin < this._length) {
      pushOp(ops, { delete: this._length - nextOrigin, from: nextOrigin });
    }
    const last = ops[ops.length - 1];
    if (!keepTrailingRetain && last && 'retain' in last) {
      ops.pop();
    }
    return ops;
  }

  /** Split runs so that a run boundary falls exactly at `index`; returns the run index after it. */
  private _split(index: number): number {
    let pos = 0;
    for (let i = 0; i < this._runs.length; i++) {
      if (pos === index) return i;
      const run = this._runs[i];
      if (index < pos + run.length) {
        const head = index - pos;
        this._runs.splice(
          i,
          1,
          { origin: run.origin, length: head },
          { origin: run.origin === null ? null : run.origin + head, length: run.length - head }
        );
        return i + 1;
      }
      pos += run.length;
    }
    return this._runs.length;
  }

  private _changed = false;
  private _current: number;
  private _length: number;
  private _runs: Run[];
}

/** Turn sequence ops over text into a delta of strings, given the resulting text. */
export function textDelta(ops: SequenceOp[], after: string): Array<{ insert?: string; delete?: number; retain?: number }> {
  return ops.map(op => {
    if ('insert' in op) return { insert: after.slice(op.at, op.at + op.insert) };
    if ('delete' in op) return { delete: op.delete };
    return { retain: op.retain };
  });
}

type Run = { origin: number | null; length: number };

function pushOp(ops: SequenceOp[], op: SequenceOp): void {
  const last = ops[ops.length - 1];
  if (last) {
    if ('insert' in op && 'insert' in last) {
      last.insert += op.insert;
      return;
    }
    if ('delete' in op && 'delete' in last) {
      last.delete += op.delete;
      return;
    }
    if ('retain' in op && 'retain' in last && last.from + last.retain === op.from) {
      last.retain += op.retain;
      return;
    }
  }
  ops.push(op);
}
