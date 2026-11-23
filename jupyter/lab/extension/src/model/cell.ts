import type { Patch } from '@automerge/automerge';
import type {
  CellChange,
  IExecutionState,
  IMapChange,
  ISharedAttachmentsCell,
  ISharedBaseCell,
  ISharedCodeCell,
  ISharedMarkdownCell,
  ISharedRawCell,
  MapChanges,
  SharedCell
} from '@jupyter/ydoc';
import type * as nbformat from '@jupyterlab/nbformat';
import { JSONExt, type PartialJSONValue, UUID } from '@lumino/coreutils';
import { type ISignal, Signal } from '@lumino/signaling';
import { automerge } from './automerge';
import { assign, emptyList, emptyMap, jsonEqual, readString, toAutomerge, toPlain } from './json';
import { asList, deleteText, findCellIndex, insertText, outputsToDoc } from './ops';
import type { CellDoc, NotebookDoc } from './schema';
import { SequenceComposer, textDelta } from './sequence';
import { AutomergeNotebook } from './notebook';
import type { UndoManager } from './undo';

export type AutomergeCell = AutomergeCodeCell | AutomergeMarkdownCell | AutomergeRawCell;

/**
 * Create a cell that lives in its own document, for cell models created
 * outside of a notebook (consoles, clipboard, tests).
 */
export function createStandaloneCell(cell: SharedCell.Cell): AutomergeCell {
  const notebook = new AutomergeNotebook({ disableDocumentWideUndoRedo: true });
  const id = cell.id ?? UUID.uuid4();
  notebook.insertCells(0, [{ ...cell, id }]);
  const model = notebook.cells[0];
  model._markStandalone();
  model.clearUndoHistory();
  return model;
}

/** Instantiate the model class for a cell stored in `notebook` under `id`. */
export function createCellModel(id: string, cellType: string, notebook: AutomergeNotebook): AutomergeCell {
  switch (cellType) {
    case 'code':
      return new AutomergeCodeCell(id, notebook);
    case 'markdown':
      return new AutomergeMarkdownCell(id, notebook);
    default:
      return new AutomergeRawCell(id, notebook);
  }
}

export abstract class AutomergeBaseCell<Metadata extends nbformat.IBaseCellMetadata>
  implements ISharedBaseCell<Metadata>
{
  constructor(id: string, notebook: AutomergeNotebook) {
    this._id = id;
    this._notebook = notebook;
    if (notebook.disableDocumentWideUndoRedo) {
      this._undoManager = notebook._createUndoManager();
    }
  }

  abstract get cell_type(): any;

  get awareness(): any {
    return this._notebook.awareness;
  }

  get changed(): ISignal<this, CellChange> {
    return this._changed;
  }

  get disposed(): ISignal<this, void> {
    return this._disposed;
  }

  get id(): string {
    return this._id;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  get isStandalone(): boolean {
    return this._standalone;
  }

  get metadata(): Partial<Metadata> {
    return this.getMetadata();
  }
  set metadata(value: Partial<Metadata>) {
    this.setMetadata(value);
  }

  get metadataChanged(): ISignal<this, IMapChange> {
    return this._metadataChanged;
  }

  get notebook(): AutomergeNotebook | null {
    return this._standalone ? null : this._notebook;
  }

  get dirty(): boolean {
    return this.notebook?.dirty === true;
  }
  set dirty(value: boolean) {
    if (this.notebook) {
      this.notebook.dirty = value;
    }
  }

  get source(): string {
    return this.getSource();
  }
  set source(value: string) {
    this.setSource(value);
  }

  get undoManager(): UndoManager | null {
    if (this._undoManager) return this._undoManager;
    return this._notebook.disableDocumentWideUndoRedo ? null : this._notebook.undoManager;
  }

  canUndo(): boolean {
    return !!this.undoManager && this.undoManager.undoStack.length > 0;
  }

  canRedo(): boolean {
    return !!this.undoManager && this.undoManager.redoStack.length > 0;
  }

  clearUndoHistory(): void {
    this.undoManager?.clear();
  }

  undo(): boolean {
    const undone = !!this.undoManager?.undo();
    if (undone) this.dirty = true;
    return undone;
  }

  redo(): boolean {
    const redone = !!this.undoManager?.redo();
    if (redone) this.dirty = true;
    return redone;
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    this._undoManager?.destroy();
    if (this._standalone) {
      this._notebook.dispose();
    }
    this._disposed.emit();
    Signal.clearData(this);
  }

  getId(): string {
    return this._id;
  }

  getSource(): string {
    return readString(this._read()?.source);
  }

  setSource(value: string): void {
    const current = this.getSource();
    let start = 0;
    while (start < current.length && start < value.length && current[start] === value[start]) {
      start++;
    }
    let end = 0;
    while (
      end < current.length - start &&
      end < value.length - start &&
      current[current.length - 1 - end] === value[value.length - 1 - end]
    ) {
      end++;
    }
    this.updateSource(start, current.length - end, value.slice(start, value.length - end));
  }

  updateSource(start: number, end: number, value = ''): void {
    this._change((draft, index) => {
      const session = this._notebook._session;
      insertText(session, draft, index, start, value);
      deleteText(session, draft, index, start + value.length, end - start);
    });
    this.dirty = true;
  }

  deleteMetadata(key: string): void {
    if (typeof this.getMetadata(key) === 'undefined') return;
    this._change(
      (_, __, cell) => {
        delete cell.metadata[key];
        const jupyter = this.getMetadata('jupyter') as any;
        if (key === 'collapsed' && jupyter) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { outputs_hidden, ...others } = jupyter;
          if (Object.keys(others).length === 0) {
            delete cell.metadata.jupyter;
          } else {
            assign(cell.metadata, 'jupyter', others);
          }
        } else if (key === 'jupyter') {
          delete cell.metadata.collapsed;
        }
      },
      false
    );
    this.dirty = true;
  }

  getMetadata(): Partial<Metadata>;
  getMetadata(key: string): PartialJSONValue | undefined;
  getMetadata(key?: string): Partial<Metadata> | PartialJSONValue | undefined {
    const metadata = this._read()?.metadata;
    if (metadata === undefined) {
      return typeof key === 'string' ? undefined : ({} as Partial<Metadata>);
    }
    if (typeof key === 'string') {
      const value = metadata[key];
      return value === undefined ? undefined : toPlain(value);
    }
    return toPlain(metadata);
  }

  setMetadata(metadata: Partial<Metadata>): void;
  setMetadata(metadata: string, value: PartialJSONValue): void;
  setMetadata(metadata: Partial<Metadata> | string, value?: PartialJSONValue): void {
    if (typeof metadata === 'string') {
      if (typeof value === 'undefined') {
        throw new TypeError(`Metadata value for ${metadata} cannot be 'undefined'; use deleteMetadata.`);
      }
      const key = metadata;
      if (jsonEqual(this.getMetadata(key) ?? null, value)) {
        return;
      }
      this._change(
        (_, __, cell) => {
          assign(cell.metadata, key, value);
          if (key === 'collapsed') {
            const jupyter = ((this.getMetadata('jupyter') as any) ?? {}) as any;
            if (jupyter.outputs_hidden !== value) {
              this.setMetadata('jupyter', { ...jupyter, outputs_hidden: value });
            }
          } else if (key === 'jupyter') {
            const isHidden = (value as any)['outputs_hidden'];
            if (typeof isHidden !== 'undefined') {
              if (this.getMetadata('collapsed') !== isHidden) {
                this.setMetadata('collapsed', isHidden);
              }
            } else {
              this.deleteMetadata('collapsed');
            }
          }
        },
        false
      );
      this.dirty = true;
    } else {
      const clone = JSONExt.deepCopy(metadata as any) as any;
      if (clone.collapsed != null) {
        clone.jupyter = clone.jupyter || {};
        clone.jupyter.outputs_hidden = clone.collapsed;
      } else if (clone?.jupyter?.outputs_hidden != null) {
        clone.collapsed = clone.jupyter.outputs_hidden;
      }
      if (!jsonEqual(clone, this.getMetadata())) {
        this._change(
          (_, __, cell) => {
            for (const [key, item] of Object.entries(clone)) {
              if (!jsonEqual(toPlain(cell.metadata[key]) ?? null, item ?? null) || !(key in cell.metadata)) {
                assign(cell.metadata, key, item);
              }
            }
          },
          false
        );
        this.dirty = true;
      }
    }
  }

  toJSON(): nbformat.IBaseCell {
    return {
      id: this.getId(),
      cell_type: this.cell_type,
      source: this.getSource(),
      metadata: this.getMetadata() as any
    };
  }

  transact(f: () => void, undoable = true, origin: any = null): void {
    this._notebook._write(undoable ? this.undoManager : null, origin, () => f());
  }

  /** The cell owns a private notebook and is not part of any user-visible one. */
  _markStandalone(): void {
    this._standalone = true;
  }

  /** Translate patches for this cell (paths relative to the cell) into change events. */
  _applyPatches(patches: Patch[], before: CellDoc | undefined, after: CellDoc | undefined, origin: unknown): void {
    if (this._isDisposed || origin === 'silent-change') return;
    const changes: CellChange = {};
    let source: SequenceComposer | null = null;
    let outputs: SequenceComposer | null = null;
    const streams = new Map<number, SequenceComposer>();
    const metadataKeys = new Set<string>();
    const fields = new Set<string>();

    for (const patch of patches) {
      const [field, ...rest] = patch.path;
      switch (field) {
        case 'source':
          source ??= new SequenceComposer(readString(before?.source).length);
          if (rest.length === 0) {
            source.delete(0, source.length);
          } else {
            source.apply(patch, rest[0]);
          }
          break;
        case 'metadata':
          if (rest.length === 0) {
            for (const key of Object.keys(before?.metadata ?? {})) metadataKeys.add(key);
            for (const key of Object.keys(after?.metadata ?? {})) metadataKeys.add(key);
          } else {
            metadataKeys.add(String(rest[0]));
          }
          break;
        case 'outputs': {
          outputs ??= new SequenceComposer(before?.outputs?.length ?? 0);
          if (rest.length === 0) {
            outputs.delete(0, outputs.length);
          } else if (rest.length === 1) {
            outputs.apply(patch, rest[0]);
          } else if (rest[1] === 'text') {
            const origin = outputs.originOf(Number(rest[0]));
            if (origin === null) break;
            let stream = streams.get(origin);
            if (!stream) {
              stream = new SequenceComposer(readString(before?.outputs?.[origin]?.text).length);
              streams.set(origin, stream);
            }
            if (rest.length === 2) {
              stream.delete(0, stream.length);
            } else {
              stream.apply(patch, rest[2]);
            }
          }
          break;
        }
        default:
          fields.add(String(field));
      }
    }

    if (source?.changed) {
      changes.sourceChange = textDelta(source.ops(), readString(after?.source));
    }
    if (metadataKeys.size > 0) {
      const metadataChange = this._metadataChanges(metadataKeys, before?.metadata, after?.metadata);
      if (metadataChange.size > 0) changes.metadataChange = metadataChange;
    }
    for (const [origin, stream] of streams) {
      const index = outputs!.indexOf(origin);
      if (index === null || !stream.changed) continue;
      changes.streamOutputChange = textDelta(stream.ops(), readString(after?.outputs?.[index]?.text)) as any;
      break;
    }
    if (outputs?.changed) {
      changes.outputsChange = outputs.ops().map(op => {
        if ('insert' in op) return { insert: toPlain(after!.outputs!.slice(op.at, op.at + op.insert)) };
        if ('delete' in op) return { delete: op.delete };
        return { retain: op.retain };
      }) as any;
    }
    if (fields.has('execution_count')) {
      changes.executionCountChange = {
        oldValue: before?.execution_count as any,
        newValue: after?.execution_count as any
      };
    }
    if (fields.has('attachments')) {
      changes.attachmentsChange = {
        oldValue: toPlain(before?.attachments),
        newValue: toPlain(after?.attachments)
      };
    }
    if (Object.keys(changes).length > 0) {
      this._changed.emit(changes);
    }
  }

  /** The cell's document as seen by the current transaction. */
  protected _read(): CellDoc | undefined {
    const doc = this._notebook._session.doc;
    const index = findCellIndex(doc, this._id, this._notebook.cells.indexOf(this as any));
    return index >= 0 ? doc.cells![index] : undefined;
  }

  protected _change(
    fn: (draft: NotebookDoc, index: number, cell: CellDoc) => void,
    undoable = true,
    origin: unknown = null
  ): void {
    this._notebook._write(undoable ? this.undoManager : null, origin, draft => {
      const index = findCellIndex(draft, this._id, this._notebook.cells.indexOf(this as any));
      if (index < 0) return;
      const cell = draft.cells![index];
      if (!cell.metadata) cell.metadata = emptyMap();
      fn(draft, index, cell);
    });
  }

  protected _emitChange(changes: CellChange): void {
    this._changed.emit(changes);
  }

  private _metadataChanges(keys: Set<string>, before: Record<string, any> | undefined, after: Record<string, any> | undefined): MapChanges {
    const metadataChange: MapChanges = new Map();
    for (const key of keys) {
      const oldValue = toPlain(before?.[key]);
      const newValue = toPlain(after?.[key]);
      if (oldValue === undefined && newValue === undefined) continue;
      if (oldValue === undefined) {
        metadataChange.set(key, { action: 'add', oldValue });
        this._metadataChanged.emit({ key, newValue, type: 'add' });
      } else if (newValue === undefined) {
        metadataChange.set(key, { action: 'delete', oldValue });
        this._metadataChanged.emit({ key, oldValue, type: 'remove' });
      } else {
        metadataChange.set(key, { action: 'update', oldValue });
        if (!jsonEqual(oldValue, newValue)) {
          this._metadataChanged.emit({ key, type: 'change', oldValue, newValue });
        }
      }
    }
    return metadataChange;
  }

  protected readonly _notebook: AutomergeNotebook;
  private _changed = new Signal<this, CellChange>(this);
  private _disposed = new Signal<this, void>(this);
  private _id: string;
  private _isDisposed = false;
  private _metadataChanged = new Signal<this, IMapChange>(this);
  private _standalone = false;
  private _undoManager: UndoManager | null = null;
}

export class AutomergeCodeCell
  extends AutomergeBaseCell<nbformat.IBaseCellMetadata>
  implements ISharedCodeCell
{
  static create(id?: string): AutomergeCodeCell {
    return createStandaloneCell({ id, cell_type: 'code' }) as AutomergeCodeCell;
  }

  get cell_type(): 'code' {
    return 'code';
  }

  get execution_count(): number | null {
    return this._read()?.execution_count || null;
  }
  set execution_count(count: number | null) {
    this.setExecutionCount(count);
  }

  setExecutionCount(count: number | null): void {
    if (this._read()?.execution_count !== count) {
      this._change((_, __, cell) => {
        cell.execution_count = count;
      }, false);
      this.dirty = true;
    }
  }

  /** Execution state is local to this peer, like the kernel connection driving it. */
  get executionState(): IExecutionState {
    return this._executionState;
  }
  set executionState(state: IExecutionState) {
    if (this._executionState === state) return;
    const oldValue = this._executionState;
    this._executionState = state;
    this._emitChange({ executionStateChange: { oldValue, newValue: state } });
  }

  get outputs(): Array<nbformat.IOutput> {
    return this.getOutputs();
  }
  set outputs(value: Array<nbformat.IOutput>) {
    this.setOutputs(value);
  }

  getOutputs(): Array<nbformat.IOutput> {
    return toPlain(this._read()?.outputs ?? []);
  }

  setOutputs(outputs: Array<nbformat.IOutput>): void {
    this._change((_, __, cell) => {
      if (!cell.outputs) cell.outputs = emptyList();
      asList(cell.outputs).deleteAt(0, cell.outputs.length);
      asList(cell.outputs).insertAt(0, ...outputsToDoc(outputs));
    }, false);
    this.dirty = true;
  }

  removeStreamOutput(index: number, start: number, origin: any = null): void {
    this._change(
      (draft, cellIndex, cell) => {
        const output = cell.outputs?.[index];
        if (!output) return;
        const length = readString(output.text).length - start;
        if (length > 0) automerge().splice(draft, ['cells', cellIndex, 'outputs', index, 'text'], start, length);
      },
      false,
      origin
    );
    this.dirty = true;
  }

  appendStreamOutput(index: number, text: string, origin: any = null): void {
    this._change(
      (draft, cellIndex, cell) => {
        const output = cell.outputs?.[index];
        if (!output || !text) return;
        if (typeof output.text !== 'string') output.text = readString(output.text);
        automerge().splice(draft, ['cells', cellIndex, 'outputs', index, 'text'], output.text.length, 0, text);
      },
      false,
      origin
    );
    this.dirty = true;
  }

  updateOutputs(start: number, end: number, outputs: Array<nbformat.IOutput> = [], origin: any = null): void {
    this._change(
      (_, __, cell) => {
        if (!cell.outputs) cell.outputs = emptyList();
        const length = cell.outputs.length;
        const fin = end < length ? end - start : length - start;
        if (fin > 0) asList(cell.outputs).deleteAt(start, fin);
        if (outputs.length > 0) asList(cell.outputs).insertAt(start, ...outputsToDoc(outputs));
      },
      false,
      origin
    );
    this.dirty = true;
  }

  clearOutputs(origin: any = null): void {
    this._change(
      (_, __, cell) => {
        if (cell.outputs?.length) asList(cell.outputs).deleteAt(0, cell.outputs.length);
      },
      false,
      origin
    );
    this.dirty = true;
  }

  toJSON(): nbformat.ICodeCell {
    return {
      ...(super.toJSON() as nbformat.ICodeCell),
      outputs: this.getOutputs(),
      execution_count: this.execution_count
    };
  }

  private _executionState: IExecutionState = 'idle';
}

class AutomergeAttachmentsCell
  extends AutomergeBaseCell<nbformat.IBaseCellMetadata>
  implements ISharedAttachmentsCell
{
  get cell_type(): any {
    throw new Error('An attachments cell must have a concrete type');
  }

  get attachments(): nbformat.IAttachments | undefined {
    return this.getAttachments();
  }
  set attachments(value: nbformat.IAttachments | undefined) {
    this.setAttachments(value);
  }

  getAttachments(): nbformat.IAttachments | undefined {
    return toPlain(this._read()?.attachments);
  }

  setAttachments(attachments: nbformat.IAttachments | undefined): void {
    this._change((_, __, cell) => {
      if (attachments == null) {
        delete cell.attachments;
      } else {
        cell.attachments = toAutomerge(attachments) as Record<string, any>;
      }
    }, false);
    this.dirty = true;
  }
}

export class AutomergeRawCell extends AutomergeAttachmentsCell implements ISharedRawCell {
  static create(id?: string): AutomergeRawCell {
    return createStandaloneCell({ id, cell_type: 'raw' }) as AutomergeRawCell;
  }

  get cell_type(): 'raw' {
    return 'raw';
  }

  toJSON(): nbformat.IRawCell {
    return {
      id: this.getId(),
      cell_type: 'raw',
      source: this.getSource(),
      metadata: this.getMetadata() as any,
      attachments: this.getAttachments()
    };
  }
}

export class AutomergeMarkdownCell extends AutomergeAttachmentsCell implements ISharedMarkdownCell {
  static create(id?: string): AutomergeMarkdownCell {
    return createStandaloneCell({ id, cell_type: 'markdown' }) as AutomergeMarkdownCell;
  }

  get cell_type(): 'markdown' {
    return 'markdown';
  }

  toJSON(): nbformat.IMarkdownCell {
    return {
      id: this.getId(),
      cell_type: 'markdown',
      source: this.getSource(),
      metadata: this.getMetadata() as any,
      attachments: this.getAttachments()
    };
  }
}
