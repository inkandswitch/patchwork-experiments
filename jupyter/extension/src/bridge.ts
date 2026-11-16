import type { Heads } from '@automerge/automerge';
import type { DocHandle, Repo } from '@automerge/automerge-repo';
import type { Automerge } from './model/automerge';
import type { NotebookDoc } from './model';

/**
 * What the Patchwork tool hands to the JupyterLite iframe. The iframe is
 * same-origin, so it uses the parent's repo and Automerge instance directly
 * instead of loading its own copies.
 */
export type PatchworkBridge = {
  Automerge: Automerge;
  repo: Repo & { create2?<T>(initial: T): Promise<DocHandle<T>> };
  user?: { name: string; color: string };
  /** Called with the url of a notebook created from inside Jupyter. */
  onCreate?(url: string): void;
  /** Lets Python in the kernel worker run its own Patchwork node (see pyfs/). */
  kernel?: KernelBridge;
  /**
   * The notebook the tool is showing. Patchwork re-points it in place at the
   * checked-out draft or history position.
   */
  handle?: DocHandle<NotebookDoc>;
  /** What `handle` is diffed against, such as where the checked-out draft forked off. */
  baseline?: Baseline;
};

export type Baseline = {
  /** Heads in `handle`'s history, or null when there is nothing to compare. */
  current(): Heads | null;
  /** Whether cells that didn't change are folded away. */
  collapsed(): boolean;
  subscribe(listener: () => void): () => void;
};

export type KernelBridge = {
  /** The worker module the `patchwork` Python package imports. */
  moduleUrl: string;
  storagePrefix: string;
  syncServer?: string;
};

const BRIDGE_PREFIX = 'patchwork-jupyter:';

declare global {
  interface Window {
    __patchworkJupyter?: Map<string, PatchworkBridge>;
  }
}

/** The bridge registered by the parent page for this iframe, keyed by the iframe's name. */
export function connectBridge(): PatchworkBridge {
  if (!window.name.startsWith(BRIDGE_PREFIX)) {
    throw new Error('The Patchwork Jupyter extension only runs inside the Patchwork notebook tool');
  }
  const token = window.name.slice(BRIDGE_PREFIX.length);
  const bridge = window.parent.__patchworkJupyter?.get(token);
  if (!bridge) {
    throw new Error(`No Patchwork bridge registered for ${token}`);
  }
  return bridge;
}
