import type { Patch } from '@automerge/automerge';
import type {
  Delta,
  IMapChange,
  ISharedCell,
  ISharedNotebook,
  MapChanges,
  NotebookChange,
  SharedCell,
  StateChange
} from '@jupyter/ydoc';
import type * as nbformat from '@jupyterlab/nbformat';
import { JSONExt, type JSONObject, type JSONValue, type PartialJSONValue, UUID } from '@lumino/coreutils';
import { type ISignal, Signal } from '@lumino/signaling';
import { EphemeralAwareness } from './awareness';
import { type DocBackend, type DocChange, MemoryBackend } from './backend';
import { type AutomergeCell, createCellModel } from './cell';
import { jsonEqual, readString, sortKeys, toPlain } from './json';
import {
  applyUndoOp,
  deleteCells,
  insertCells,
  setNotebookMetadata,
  updateNotebookMetadata
} from './ops';
import type { CellDoc, CellJSON, NotebookDoc } from './schema';
import { SequenceComposer } from './sequence';
import { Session, type Transaction } from './session';
import { UndoManager } from './undo';

export namespace AutomergeNotebook {
  export type IOptions = Omit<ISharedNotebook.IOptions, 'data'> & {
    /** Where the document lives; defaults to a private in-memory document. */
    backend?: DocBackend<NotebookDoc>;
  };
}

/**
 * An ISharedNotebook whose source of truth is an Automerge document, a
 * drop-in for @jupyter/ydoc's YNotebook.
 */
export class AutomergeNotebook implements ISharedNotebook {
  static create(options: ISharedNotebook.IOptions & AutomergeNotebook.IOptions = {}): AutomergeNotebook {
    const notebook = new AutomergeNotebook({
      backend: options.backend,
      disableDocumentWideUndoRedo: options.disableDocumentWideUndoRedo ?? false
    });
    const data: nbformat.INotebookContent = {
      cells: options.data?.cells ?? [],
      nbformat: options.data?.nbformat ?? 4,
      nbformat_minor: options.data?.nbformat_minor ?? 5,
      metadata: options.data?.metadata ?? {}
    };
    notebook.setSource(data as unknown as JSONValue);
    return notebook;
  }

  constructor(options: AutomergeNotebook.IOptions = {}) {
    this._disableDocumentWideUndoRedo = options.disableDocumentWideUndoRedo ?? false;
    this._session = new Session(options.backend ?? new MemoryBackend<NotebookDoc>({}), this._onDocChange);
    this.undoManager = this._createUndoManager();
    this._awareness = new EphemeralAwareness(this._session.backend);
    this.cells = (this._session.doc.cells ?? []).map(cell =>
      createCellModel(readString(cell.id), readString(cell.cell_type), this)
    );
  }

  readonly version: string = '2.0.0';
  readonly cells: AutomergeCell[];
  readonly undoManager: UndoManager;

  get awareness(): any {
    return this._awareness;
  }

  get backend(): DocBackend<NotebookDoc> {
    return this._session.backend;
  }

  /** Whether edits are refused, e.g. while showing a point in history. */
  get readOnly(): boolean {
    return this._session.backend.readOnly?.() ?? false;
  }

  /** The document was swapped for another one, such as a draft or a point in history. */
  get scopeReplaced(): ISignal<this, void> {
    return this._scopeReplaced;
  }

  get changed(): ISignal<this, NotebookChange> {
    return this._changed;
  }

  get disposed(): ISignal<this, void> {
    return this._disposed;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  get disableDocumentWideUndoRedo(): boolean {
    return this._disableDocumentWideUndoRedo;
  }

  get metadata(): nbformat.INotebookMetadata {
    return this.getMetadata();
  }
  set metadata(value: nbformat.INotebookMetadata) {
    this.setMetadata(value);
  }

  get metadataChanged(): ISignal<this, IMapChange> {
    return this._metadataChanged;
  }

  get nbformat(): number {
    return this._session.doc.nbformat as number;
  }
  set nbformat(value: number) {
    this._write(null, null, draft => {
      draft.nbformat = value;
    });
  }

  get nbformat_minor(): number {
    return this._session.doc.nbformat_minor as number;
  }
  set nbformat_minor(value: number) {
    this._write(null, null, draft => {
      draft.nbformat_minor = value;
    });
  }

  get source(): JSONValue {
    return this.getSource();
  }
  set source(value: JSONValue) {
    this.setSource(value);
  }

  get state(): JSONObject {
    return JSONExt.deepCopy(Object.fromEntries(this._state) as JSONObject);
  }

  get dirty(): boolean {
    return this._state.get('dirty') === true;
  }
  set dirty(value: boolean) {
    this.setState('dirty', value);
  }

  getState(key: string): JSONValue | undefined {
    const value = this._state.get(key);
    return value === undefined ? value : JSONExt.deepCopy(value);
  }

  /** State (dirty, hash...) is local to this peer and never stored in the document. */
  setState(key: string, value: JSONValue): void {
    const oldValue = this._state.get(key);
    if (jsonEqual(oldValue, value)) return;
    this._state.set(key, value);
    const stateChange: StateChange<any>[] = [{ name: key, oldValue, newValue: value }];
    this._session.afterCommit(() => {
      if (!this._isDisposed) this._changed.emit({ stateChange });
    });
  }

  canUndo(): boolean {
    return this.undoManager.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.undoManager.redoStack.length > 0;
  }

  undo(): boolean {
    const undone = !!this.undoManager.undo();
    if (undone) this.dirty = true;
    return undone;
  }

  redo(): boolean {
    const redone = !!this.undoManager.redo();
    if (redone) this.dirty = true;
    return redone;
  }

  clearUndoHistory(): void {
    this.undoManager.clear();
  }

  transact(f: () => void, undoable = true, origin: any = null): void {
    this._write(undoable ? this.undoManager : null, origin, () => f());
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    for (const cell of this.cells) cell.dispose();
    this._awareness.destroy();
    this.undoManager.destroy();
    this._session.dispose();
    this._disposed.emit();
    Signal.clearData(this);
  }

  getCell(index: number): AutomergeCell {
    return this.cells[index];
  }

  addCell(cell: SharedCell.Cell): AutomergeCell {
    return this.insertCell(this._session.doc.cells?.length ?? 0, cell);
  }

  insertCell(index: number, cell: SharedCell.Cell): AutomergeCell {
    return this.insertCells(index, [cell])[0];
  }

  insertCells(index: number, cells: SharedCell.Cell[]): AutomergeCell[] {
    const prepared = cells.map(cell => ({ ...cell, id: cell.id ?? UUID.uuid4() }) as CellJSON);
    const models = prepared.map(cell => {
      const model = createCellModel(cell.id!, cell.cell_type, this);
      this._pending.set(cell.id!, model);
      return model;
    });
    this.dirty = true;
    this._write(this.undoManager, null, draft => {
      insertCells(this._session, draft, index, prepared);
    });
    return models;
  }

  moveCell(fromIndex: number, toIndex: number): void {
    this.moveCells(fromIndex, toIndex);
  }

  moveCells(fromIndex: number, toIndex: number, n = 1): void {
    const clones = new Array(n).fill(true).map((_, idx) => this.getCell(fromIndex + idx).toJSON() as CellJSON);
    this._write(this.undoManager, null, draft => {
      deleteCells(this._session, draft, fromIndex, n);
      insertCells(this._session, draft, fromIndex > toIndex ? toIndex : toIndex - n + 1, clones);
    });
    this.dirty = true;
  }

  deleteCell(index: number): void {
    this.deleteCellRange(index, index + 1);
  }

  deleteCellRange(from: number, to: number): void {
    this._write(this.undoManager, null, draft => {
      deleteCells(this._session, draft, from, to - from);
    });
    this.dirty = true;
  }

  deleteMetadata(key: string): void {
    if (typeof this.getMetadata(key) === 'undefined') return;
    const allMetadata = this.metadata;
    delete allMetadata[key];
    this.setMetadata(allMetadata);
  }

  getMetadata(): nbformat.INotebookMetadata;
  getMetadata(key: string): PartialJSONValue | undefined;
  getMetadata(key?: string): nbformat.INotebookMetadata | PartialJSONValue | undefined {
    const metadata = this._session.doc.metadata;
    if (typeof key === 'string') {
      const value = metadata?.[key];
      return value === undefined ? undefined : toPlain(value);
    }
    return toPlain(metadata ?? {});
  }

  setMetadata(metadata: nbformat.INotebookMetadata): void;
  setMetadata(metadata: string, value: PartialJSONValue): void;
  setMetadata(metadata: nbformat.INotebookMetadata | string, value?: PartialJSONValue): void {
    if (typeof metadata === 'string') {
      if (typeof value === 'undefined') {
        throw new TypeError(`Metadata value for ${metadata} cannot be 'undefined'; use deleteMetadata.`);
      }
      if (jsonEqual(this.getMetadata(metadata) ?? null, value)) return;
      this.updateMetadata({ [metadata]: value });
      return;
    }
    if (jsonEqual(this.metadata, metadata)) return;
    const clone = JSONExt.deepCopy(metadata as any) as Record<string, unknown>;
    this._write(this.undoManager, null, draft => {
      setNotebookMetadata(this._session, draft, clone);
    });
    this.dirty = true;
  }

  updateMetadata(value: Partial<nbformat.INotebookMetadata>): void {
    const clone = JSONExt.deepCopy(value as any) as Record<string, unknown>;
    this._write(this.undoManager, null, draft => {
      updateNotebookMetadata(this._session, draft, clone);
    });
    this.dirty = true;
  }

  getSource(): JSONValue {
    return this.toJSON() as unknown as JSONValue;
  }

  setSource(value: JSONValue): void {
    this.fromJSON(value as unknown as nbformat.INotebookContent);
    this.dirty = false;
  }

  fromJSON(value: nbformat.INotebookContent): void {
    this.transact(() => {
      this.nbformat = value.nbformat;
      this.nbformat_minor = value.nbformat_minor;
      const metadata = { ...value.metadata };
      if (metadata['orig_nbformat'] !== undefined) {
        delete metadata['orig_nbformat'];
      }
      this.metadata = metadata;
      const useId = value.nbformat === 4 && value.nbformat_minor >= 5;
      const cells = value.cells.map(cell => {
        if (!useId) {
          const { id: _id, ...rest } = cell;
          return rest as SharedCell.Cell;
        }
        return cell as SharedCell.Cell;
      });
      const existing = this._session.doc.cells?.length ?? 0;
      this.insertCells(existing, cells);
      this.deleteCellRange(0, existing);
    });
  }

  toJSON(): nbformat.INotebookContent {
    const pruneCellId = this.nbformat === 4 && this.nbformat_minor <= 4;
    return sortKeys({
      metadata: this.metadata,
      nbformat_minor: this.nbformat_minor,
      nbformat: this.nbformat,
      cells: this.cells.map(cell => {
        const raw = cell.toJSON();
        if (pruneCellId) {
          delete raw.id;
        }
        return raw;
      })
    });
  }

  /** @internal */
  readonly _session: Session;

  /** @internal */
  _write(recorder: UndoManager | null, origin: unknown, fn: (draft: NotebookDoc) => void): void {
    this._session.write({ origin, recorder }, fn);
  }

  /** @internal */
  _createUndoManager(): UndoManager {
    return new UndoManager((manager, ops) => {
      this._write(manager, null, draft => {
        for (const op of ops) applyUndoOp(this._session, draft, op);
      });
    });
  }

  private _onDocChange = (change: DocChange<NotebookDoc>, transaction: Transaction | null): void => {
    if (this._isDisposed) return;
    const origin = transaction?.origin ?? null;
    const previous = this.cells.slice();
    const patches = change.replaced ? [...RESET_PATCHES, ...change.patches] : change.patches;
    const routed = routePatches(patches, previous.length);

    if (routed.cells.changed) {
      this._applyCellsChange(routed.cells, previous, change.after);
    }
    for (const [index, patches] of routed.cellPatches) {
      const model = previous[index];
      const current = routed.cells.indexOf(index);
      if (current === null || model.isDisposed) continue;
      model._applyPatches(patches, change.before.cells?.[index], change.after.cells?.[current], origin);
    }
    if (routed.metadataKeys.size > 0) {
      this._emitMetadataChanges(routed.metadataKeys, change.before.metadata, change.after.metadata);
    }
    for (const key of routed.nbformatKeys) {
      const oldValue = change.before[key];
      this._changed.emit({
        nbformatChanged: { key, oldValue: oldValue ? oldValue : undefined, newValue: change.after[key] }
      });
    }
    if (change.replaced) {
      this.undoManager.clear();
      this._scopeReplaced.emit();
    }
  };

  private _applyCellsChange(cells: SequenceComposer, previous: AutomergeCell[], after: NotebookDoc): void {
    const next: AutomergeCell[] = [];
    const removed: AutomergeCell[] = [];
    const cellsChange: Delta<ISharedCell[]> = [];
    for (const op of cells.ops(true)) {
      if ('retain' in op) {
        next.push(...previous.slice(op.from, op.from + op.retain));
        cellsChange.push({ retain: op.retain });
      } else if ('delete' in op) {
        removed.push(...previous.slice(op.from, op.from + op.delete));
        cellsChange.push({ delete: op.delete });
      } else {
        const inserted = after.cells!.slice(op.at, op.at + op.insert).map(cell => this._modelFor(cell));
        next.push(...inserted);
        cellsChange.push({ insert: inserted });
      }
    }
    if (cellsChange.length > 0 && 'retain' in cellsChange[cellsChange.length - 1]) {
      cellsChange.pop();
    }
    this.cells.splice(0, this.cells.length, ...next);
    for (const cell of removed) cell.dispose();
    this._changed.emit({ cellsChange });
  }

  private _modelFor(cell: CellDoc): AutomergeCell {
    const id = readString(cell.id);
    const pending = this._pending.get(id);
    if (pending) {
      this._pending.delete(id);
      return pending;
    }
    return createCellModel(id, readString(cell.cell_type), this);
  }

  private _emitMetadataChanges(keys: Set<string>, before: Record<string, any> | undefined, after: Record<string, any> | undefined): void {
    if (keys.has('*')) {
      keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    }
    const metadataChange: MapChanges = new Map();
    for (const key of keys) {
      const oldValue = toPlain(before?.[key]);
      const newValue = toPlain(after?.[key]);
      if (oldValue === undefined && newValue === undefined) continue;
      if (oldValue === undefined) {
        metadataChange.set(key, { action: 'add', oldValue });
        this._metadataChanged.emit({ key, type: 'add', newValue });
      } else if (newValue === undefined) {
        metadataChange.set(key, { action: 'delete', oldValue });
        this._metadataChanged.emit({ key, type: 'remove', oldValue });
      } else {
        metadataChange.set(key, { action: 'update', oldValue });
        if (!jsonEqual(oldValue, newValue)) {
          this._metadataChanged.emit({ key, type: 'change', oldValue, newValue });
        }
      }
    }
    if (metadataChange.size > 0) {
      this._changed.emit({ metadataChange });
    }
  }

  private _awareness: EphemeralAwareness;
  private _changed = new Signal<this, NotebookChange>(this);
  private _disableDocumentWideUndoRedo: boolean;
  private _disposed = new Signal<this, void>(this);
  private _scopeReplaced = new Signal<this, void>(this);
  private _isDisposed = false;
  private _metadataChanged = new Signal<this, IMapChange>(this);
  private _pending = new Map<string, AutomergeCell>();
  private _state = new Map<string, JSONValue>();
}

type RoutedPatches = {
  cells: SequenceComposer;
  cellPatches: Map<number, Patch[]>;
  metadataKeys: Set<string>;
  nbformatKeys: Set<'nbformat' | 'nbformat_minor'>;
};

/**
 * Split a change's patches into the cell list delta, per-cell patches keyed
 * by the cell's index before the change, and notebook-level fields.
 */
/** Empties the cells and metadata before a replacement document is applied. */
const RESET_PATCHES: Patch[] = [
  { action: 'put', path: ['cells'], value: [] },
  { action: 'put', path: ['metadata'], value: {} }
];

function routePatches(patches: Patch[], cellCount: number): RoutedPatches {
  const routed: RoutedPatches = {
    cells: new SequenceComposer(cellCount),
    cellPatches: new Map(),
    metadataKeys: new Set(),
    nbformatKeys: new Set()
  };
  for (const patch of patches) {
    const [head, ...rest] = patch.path;
    if (head === 'cells') {
      if (rest.length === 0) {
        routed.cells.delete(0, routed.cells.length);
      } else if (rest.length === 1) {
        routed.cells.apply(patch, rest[0]);
      } else {
        const origin = routed.cells.originOf(Number(rest[0]));
        if (origin === null) continue;
        let list = routed.cellPatches.get(origin);
        if (!list) {
          list = [];
          routed.cellPatches.set(origin, list);
        }
        list.push({ ...patch, path: rest.slice(1) } as Patch);
      }
    } else if (head === 'metadata') {
      if (rest.length === 0) {
        routed.metadataKeys.add('*');
      } else {
        routed.metadataKeys.add(String(rest[0]));
      }
    } else if (head === 'nbformat' || head === 'nbformat_minor') {
      routed.nbformatKeys.add(head);
    }
  }
  return routed;
}
