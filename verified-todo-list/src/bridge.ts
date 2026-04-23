// src/bridge.ts
//
// Glue between automerge-repo's DocHandle and the verified domain spec in
// ./verified/TodoDomain.ts. Each user-facing operation opens a
// DocHandle.change() and performs the same mutation the corresponding Dafny
// function describes.
//
// No CRDT logic lives here - no clocks, no merge, no LWW. Automerge owns
// all of that. Dafny proves that each domain op preserves "no duplicate
// item ids"; Automerge preserves that property across sync because the
// merged state is a map, whose keys are unique by construction.

import type { DocHandle } from '@automerge/automerge-repo';
import type { Item, ItemId, VerifiedTodoDoc } from './verified/TodoDomain';

export type { Item, ItemId, VerifiedTodoDoc };

function ensureItems(d: VerifiedTodoDoc): void {
  if (!d.items) d.items = {};
}

function maxLivePosition(d: VerifiedTodoDoc): number {
  let max = -Infinity;
  const items = d.items ?? {};
  for (const k in items) {
    if (!items[k].deleted && items[k].position > max) {
      max = items[k].position;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// User-facing operations.
//
// mintFreshId is passed in so this module stays side-effect-free. The React
// UI and the action plugins both supply crypto.randomUUID(); any globally
// unique id scheme satisfies the Dafny "iid !in d.items" precondition.
// ---------------------------------------------------------------------------

export function addTodo(
  handle: DocHandle<VerifiedTodoDoc>,
  text: string,
  mintFreshId: () => ItemId = () => crypto.randomUUID(),
): ItemId {
  const iid = mintFreshId();
  handle.change((d) => {
    ensureItems(d);
    const max = maxLivePosition(d);
    const pos = max === -Infinity ? 0 : max + 1;
    d.items[iid] = { text, done: false, position: pos, deleted: false };
  });
  return iid;
}

export function toggleTodo(
  handle: DocHandle<VerifiedTodoDoc>,
  iid: ItemId,
  done: boolean,
): void {
  handle.change((d) => {
    ensureItems(d);
    if (d.items[iid]) d.items[iid].done = done;
  });
}

export function deleteTodo(
  handle: DocHandle<VerifiedTodoDoc>,
  iid: ItemId,
): void {
  handle.change((d) => {
    ensureItems(d);
    if (d.items[iid]) d.items[iid].deleted = true;
  });
}

export function moveTodo(
  handle: DocHandle<VerifiedTodoDoc>,
  iid: ItemId,
  newPosition: number,
): void {
  handle.change((d) => {
    ensureItems(d);
    if (d.items[iid]) d.items[iid].position = newPosition;
  });
}

export function setTitle(
  handle: DocHandle<VerifiedTodoDoc>,
  title: string,
): void {
  handle.change((d) => {
    d.title = title;
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers.
// ---------------------------------------------------------------------------

export type Visible = {
  key: ItemId;
  item: Item;
};

export function visibleItems(doc: VerifiedTodoDoc): Visible[] {
  const items = doc.items ?? {};
  const keys = Object.keys(items).filter((k) => !items[k].deleted);
  keys.sort((i, j) => {
    const pi = items[i].position;
    const pj = items[j].position;
    if (pi !== pj) return pi - pj;
    return i < j ? -1 : i > j ? 1 : 0;
  });
  return keys.map((k) => ({ key: k, item: items[k] }));
}

// Fractional-index midpoint between two positions, or just before/after when
// one side is missing. Good enough for demo-scale lists; in production you
// would want big-rational positions or periodic reallocation.
export function midpointPosition(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  if (before === after) return before + 0.0001;
  return (before + after) / 2;
}
