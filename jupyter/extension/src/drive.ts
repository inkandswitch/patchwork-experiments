import type { Doc, Heads } from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import type { ISharedDocument } from '@jupyter/ydoc';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { type ISignal, Signal } from '@lumino/signaling';
import type { JSONValue } from '@lumino/coreutils';
import type * as nbformat from '@jupyterlab/nbformat';
import type { PatchworkBridge } from './bridge';
import { adopt } from './model/json';
import { notebookDoc } from './model/ops';
import {
  AutomergeNotebook,
  type DocBackend,
  type DocChange,
  HandleBackend,
  type NotebookDoc,
  automerge
} from './model';

export const DRIVE_NAME = 'Patchwork';

/**
 * A contents drive whose notebooks are Automerge documents in the Patchwork
 * repo. Paths look like `<documentId>/<title>.ipynb`; only the id is used to
 * find the document, the file name follows its title. Everything is saved as
 * it is typed, so saving does nothing.
 */
export class PatchworkDrive implements Contents.IDrive {
  constructor(bridge: PatchworkBridge) {
    this._bridge = bridge;
  }

  readonly name = DRIVE_NAME;
  readonly serverSettings = ServerConnection.makeSettings();

  readonly sharedModelFactory: Contents.ISharedFactory = {
    collaborative: true,
    createNew: options => this._createSharedModel(options)
  };

  get fileChanged(): ISignal<Contents.IDrive, Contents.IChangedArgs> {
    return this._fileChanged;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  async get(localPath: string, options?: Contents.IFetchOptions): Promise<Contents.IModel> {
    const documentId = parseDocumentId(localPath);
    if (!documentId) {
      return directoryModel(localPath);
    }
    const handle = await this._find(documentId);
    const model = notebookModel(localPath, handle);
    if (options?.content && !this._models.has(documentId)) {
      return { ...model, content: notebookContent(handle.doc()), format: 'json' };
    }
    return model;
  }

  async getDownloadUrl(localPath: string): Promise<string> {
    const documentId = parseDocumentId(localPath);
    if (!documentId) throw new Error(`Not a notebook: ${localPath}`);
    const handle = await this._find(documentId);
    const json = JSON.stringify(notebookContent(handle.doc()), null, 1);
    return URL.createObjectURL(new Blob([json], { type: 'application/x-ipynb+json' }));
  }

  async newUntitled(options: Contents.ICreateOptions = {}): Promise<Contents.IModel> {
    if (options.type && options.type !== 'notebook') {
      throw new Error('Only notebooks can be created in Patchwork');
    }
    return this._create({ title: 'Untitled', nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] });
  }

  /** Make a Patchwork notebook from an .ipynb file and open it. */
  async importNotebook(file: File): Promise<Contents.IModel> {
    const notebook = JSON.parse(await file.text()) as nbformat.INotebookContent;
    if (!Array.isArray(notebook?.cells)) throw new Error(`${file.name} is not a Jupyter notebook`);
    return this._create(notebookDoc(notebook, titleFromPath(file.name)));
  }

  private async _create(notebook: NotebookDoc): Promise<Contents.IModel> {
    const initial = adopt({ '@patchwork': { type: 'jupyter-notebook' }, ...notebook }) as NotebookDoc;
    const { repo } = this._bridge;
    const handle = repo.create2 ? await repo.create2(initial) : repo.create(initial);
    this._bridge.onCreate?.(handle.url);
    const model = notebookModel(`${handle.documentId}/${notebook.title}.ipynb`, handle);
    this._fileChanged.emit({ type: 'new', oldValue: null, newValue: model });
    return model;
  }

  async delete(): Promise<void> {
    throw new Error('Delete notebooks from Patchwork');
  }

  async rename(oldLocalPath: string, newLocalPath: string): Promise<Contents.IModel> {
    const documentId = parseDocumentId(oldLocalPath);
    if (!documentId) throw new Error(`Not a notebook: ${oldLocalPath}`);
    const handle = await this._find(documentId);
    if (handle.isReadOnly?.()) throw new Error('Cannot rename a notebook while viewing its history');
    const title = titleFromPath(newLocalPath);
    handle.change(doc => {
      doc.title = title;
    });
    const oldValue = notebookModel(oldLocalPath, handle);
    const newValue = notebookModel(`${documentId}/${title}.ipynb`, handle);
    this._fileChanged.emit({ type: 'rename', oldValue, newValue });
    return newValue;
  }

  async save(localPath: string): Promise<Contents.IModel> {
    return this.get(localPath, { content: false });
  }

  async copy(): Promise<Contents.IModel> {
    throw new Error('Copy notebooks from Patchwork');
  }

  async createCheckpoint(localPath: string): Promise<Contents.ICheckpointModel> {
    return { id: 'automerge', last_modified: (await this.get(localPath)).last_modified };
  }

  async listCheckpoints(): Promise<Contents.ICheckpointModel[]> {
    return [];
  }

  async restoreCheckpoint(): Promise<void> {
    throw new Error('Use Patchwork history to go back in time');
  }

  async deleteCheckpoint(): Promise<void> {}

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    for (const model of this._models.values()) model.dispose();
    Signal.clearData(this);
  }

  private _createSharedModel(options: Contents.ISharedFactoryOptions): ISharedDocument | undefined {
    if (options.contentType !== 'notebook') return undefined;
    const documentId = parseDocumentId(options.path);
    if (!documentId) return undefined;
    const handle = this._loaded(documentId);
    const model = new PatchworkNotebook({
      backend: handle ? new HandleBackend(handle) : new DeferredBackend(this._find(documentId)),
      disableDocumentWideUndoRedo: true
    });
    this._models.set(documentId, model);
    model.disposed.connect(() => {
      if (this._models.get(documentId) === model) this._models.delete(documentId);
    });
    return model as unknown as ISharedDocument;
  }

  private async _find(documentId: string): Promise<DocHandle<NotebookDoc>> {
    return this._loaded(documentId) ?? this._bridge.repo.find<NotebookDoc>(`automerge:${documentId}` as any);
  }

  /**
   * The tool's own handle for the notebook it shows: Patchwork points it at
   * the checked-out draft or history position, which a repo lookup would miss.
   */
  private _loaded(documentId: string): DocHandle<NotebookDoc> | undefined {
    const own = this._bridge.handle as DocHandle<NotebookDoc> | undefined;
    if (own?.documentId === documentId && own.isReady()) return own;
    const handles = this._bridge.repo.handles as Record<string, DocHandle<NotebookDoc> | undefined>;
    const handle = handles[documentId];
    return handle?.isReady() ? handle : undefined;
  }

  private _bridge: PatchworkBridge;
  private _fileChanged = new Signal<Contents.IDrive, Contents.IChangedArgs>(this);
  private _isDisposed = false;
  private _models = new Map<string, PatchworkNotebook>();
}

/** Automerge persists every change, so the notebook is never dirty. */
class PatchworkNotebook extends AutomergeNotebook {
  setState(key: string, value: JSONValue): void {
    super.setState(key, key === 'dirty' ? false : value);
  }
}

/**
 * Stands in for a handle that is still loading: the notebook starts empty
 * and receives the whole document as one change once it arrives.
 */
class DeferredBackend implements DocBackend<NotebookDoc> {
  constructor(handle: Promise<DocHandle<NotebookDoc>>) {
    this._placeholder = automerge().init<NotebookDoc>();
    void handle.then(handle => this._load(handle));
  }

  doc(): Doc<NotebookDoc> {
    return this._inner?.doc() ?? this._placeholder;
  }

  readOnly(): boolean {
    return this._inner?.readOnly() ?? false;
  }

  change(fn: (draft: NotebookDoc) => void): DocChange<NotebookDoc> | null {
    if (!this._inner) {
      console.warn('Ignoring a notebook edit made before its document loaded');
      return null;
    }
    return this._inner.change(fn);
  }

  subscribe(listener: (change: DocChange<NotebookDoc>) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  broadcast(message: unknown): void {
    this._inner?.broadcast(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this._messageListeners.add(listener);
    return () => this._messageListeners.delete(listener);
  }

  dispose(): void {
    this._disposed = true;
    this._inner?.dispose();
    this._listeners.clear();
    this._messageListeners.clear();
  }

  private _load(handle: DocHandle<NotebookDoc>): void {
    if (this._disposed) return;
    const A = automerge();
    const after = handle.doc();
    const patches = A.diff(after, [], A.getHeads(after));
    this._inner = new HandleBackend(handle);
    this._inner.subscribe(change => this._emit(change));
    this._inner.onMessage(message => {
      for (const listener of this._messageListeners) listener(message);
    });
    this._emit({ patches, before: this._placeholder, after });
  }

  private _emit(change: DocChange<NotebookDoc>): void {
    for (const listener of this._listeners) listener(change);
  }

  private _disposed = false;
  private _inner: HandleBackend<NotebookDoc> | null = null;
  private _listeners = new Set<(change: DocChange<NotebookDoc>) => void>();
  private _messageListeners = new Set<(message: unknown) => void>();
  private _placeholder: Doc<NotebookDoc>;
}

/** A read-only notebook at fixed heads, for looking at history. */
class SnapshotBackend implements DocBackend<NotebookDoc> {
  constructor(doc: Doc<NotebookDoc>, heads: Heads) {
    this._doc = automerge().view(doc, heads);
  }

  doc(): Doc<NotebookDoc> {
    return this._doc;
  }

  change(): DocChange<NotebookDoc> | null {
    return null;
  }

  subscribe(): () => void {
    return () => undefined;
  }

  broadcast(): void {}

  onMessage(): () => void {
    return () => undefined;
  }

  dispose(): void {}

  private _doc: Doc<NotebookDoc>;
}

function parseDocumentId(path: string): string | null {
  const local = path.startsWith(`${DRIVE_NAME}:`) ? path.slice(DRIVE_NAME.length + 1) : path;
  const [first, second] = local.replace(/^\/+/, '').split('/');
  if (second === undefined) {
    return first?.endsWith('.ipynb') ? first.slice(0, -'.ipynb'.length) : null;
  }
  return first || null;
}

function titleFromPath(path: string): string {
  const name = path.split('/').pop() ?? '';
  return name.replace(/\.ipynb$/, '') || 'Untitled';
}

const EPOCH = new Date(0).toISOString();

function notebookModel(localPath: string, handle: DocHandle<NotebookDoc>): Contents.IModel {
  const title = handle.doc()?.title || 'Untitled';
  return {
    name: `${title}.ipynb`,
    path: localPath,
    type: 'notebook',
    writable: true,
    created: EPOCH,
    last_modified: EPOCH,
    mimetype: 'application/x-ipynb+json',
    content: null,
    format: null
  };
}

function directoryModel(localPath: string): Contents.IModel {
  return {
    name: localPath.split('/').pop() ?? '',
    path: localPath,
    type: 'directory',
    writable: false,
    created: EPOCH,
    last_modified: EPOCH,
    mimetype: '',
    content: [],
    format: 'json'
  };
}

/** The document as nbformat JSON, for consumers that do not use the shared model. */
function notebookContent(doc: Doc<NotebookDoc>): unknown {
  const notebook = new AutomergeNotebook({ backend: new SnapshotBackend(doc, automerge().getHeads(doc)) });
  try {
    return notebook.toJSON();
  } finally {
    notebook.dispose();
  }
}
