import type { Doc, Patch } from '@automerge/automerge';
import type { DocHandle } from '@automerge/automerge-repo';
import { automerge } from './automerge';

export type DocChange<T> = {
  patches: Patch[];
  before: Doc<T>;
  after: Doc<T>;
  /**
   * The document was swapped for a different one (a draft, or a point in
   * history), so `patches` rebuild it from empty and `before` is unrelated.
   */
  replaced?: boolean;
};

/**
 * Where a shared model keeps its Automerge document: a repo DocHandle in the
 * app, or a plain in-memory document for standalone cells and tests.
 */
export type DocBackend<T> = {
  doc(): Doc<T>;
  /** Apply a local change synchronously, returning its patches (null if nothing changed). */
  change(fn: (draft: T) => void): DocChange<T> | null;
  /** Listen to changes that did not originate from `change`. */
  subscribe(listener: (change: DocChange<T>) => void): () => void;
  /** Whether `change` is refused, e.g. while showing history. */
  readOnly?(): boolean;
  broadcast(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  dispose(): void;
};

export class HandleBackend<T> implements DocBackend<T> {
  constructor(handle: DocHandle<T>) {
    this._handle = handle;
    handle.on('change', this._onChange);
    handle.on('ephemeral-message', this._onEphemeral);
  }

  get handle(): DocHandle<T> {
    return this._handle;
  }

  doc(): Doc<T> {
    return this._handle.doc();
  }

  readOnly(): boolean {
    return !!this._handle.isReadOnly?.();
  }

  change(fn: (draft: T) => void): DocChange<T> | null {
    if (this.readOnly()) return null;
    let result: DocChange<T> | null = null;
    this._changing = true;
    try {
      this._handle.change(fn, {
        patchCallback: (patches, info) => {
          result = { patches, before: info.before, after: info.after };
        }
      });
    } finally {
      this._changing = false;
    }
    return result;
  }

  subscribe(listener: (change: DocChange<T>) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  broadcast(message: unknown): void {
    this._handle.broadcast(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this._messageListeners.add(listener);
    return () => this._messageListeners.delete(listener);
  }

  dispose(): void {
    this._handle.off('change', this._onChange);
    this._handle.off('ephemeral-message', this._onEphemeral);
    this._listeners.clear();
    this._messageListeners.clear();
  }

  /**
   * Patchwork re-points a tool's handle at a draft or a point in history in
   * place, flagging the change `scopeReplaced` with no patches between the two.
   */
  private _onChange = ({ patches, patchInfo, scopeReplaced }: HandleChange<T>) => {
    if (this._changing) return;
    const { before, after } = patchInfo;
    const change: DocChange<T> = scopeReplaced
      ? { patches: rebuildPatches(after), before, after, replaced: true }
      : { patches, before, after };
    for (const listener of this._listeners) listener(change);
  };

  private _onEphemeral = ({ message }: { message: unknown }) => {
    for (const listener of this._messageListeners) listener(message);
  };

  private _changing = false;
  private _handle: DocHandle<T>;
  private _listeners = new Set<(change: DocChange<T>) => void>();
  private _messageListeners = new Set<(message: unknown) => void>();
}

type HandleChange<T> = {
  patches: Patch[];
  patchInfo: { before: Doc<T>; after: Doc<T> };
  scopeReplaced?: boolean;
};

/** Patches that build `doc` from an empty document. */
export function rebuildPatches<T>(doc: Doc<T>): Patch[] {
  const A = automerge();
  return A.diff(doc, [], A.getHeads(doc));
}

export class MemoryBackend<T> implements DocBackend<T> {
  constructor(initial: T) {
    this._doc = automerge().from(initial as Record<string, unknown>) as Doc<T>;
  }

  doc(): Doc<T> {
    return this._doc;
  }

  change(fn: (draft: T) => void): DocChange<T> | null {
    let result: DocChange<T> | null = null;
    this._doc = automerge().change(this._doc, {
      patchCallback: (patches, info) => {
        result = { patches, before: info.before, after: info.after };
      }
    }, fn);
    return result;
  }

  subscribe(): () => void {
    return () => undefined;
  }

  broadcast(): void {}

  onMessage(): () => void {
    return () => undefined;
  }

  dispose(): void {}

  private _doc: Doc<T>;
}
