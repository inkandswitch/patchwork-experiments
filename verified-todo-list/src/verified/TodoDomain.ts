// src/verified/TodoDomain.ts
//
// Runtime mirror of ../../dafny/TodoDomain.dfy. Every function here
// corresponds line-by-line to a function of the same name in the Dafny
// domain model.
//
// There is deliberately NO CRDT machinery here - no clocks, no merge, no
// LWW. Automerge-repo owns all of that. This module only specifies the
// domain-level mutations our tool performs on a single-replica snapshot
// of the document.
//
// Correspondence (Dafny -> TypeScript):
//   ItemId           -> string (a crypto.randomUUID())
//   Item, Doc        -> Item, VerifiedTodoDoc (same field names)
//   SetTitle         -> setTitle
//   AddTodo          -> addTodo
//   ToggleTodo       -> toggleTodo
//   MoveTodo         -> moveTodo
//   DeleteTodo       -> deleteTodo
//   LiveKeys, View   -> liveKeys, view

export type ItemId = string;

export type Item = {
  text: string;
  done: boolean;
  position: number;
  deleted: boolean;
};

export type VerifiedTodoDoc = {
  title: string;
  items: { [iid: string]: Item };
};

export function emptyDoc(): VerifiedTodoDoc {
  return { title: '', items: {} };
}

// ---------------------------------------------------------------------------
// Domain operations, pure. The bridge performs the equivalent in-place
// mutations against Automerge's proxy object inside DocHandle.change().
// ---------------------------------------------------------------------------

export function setTitle(d: VerifiedTodoDoc, title: string): VerifiedTodoDoc {
  return { ...d, title };
}

export function addTodo(
  d: VerifiedTodoDoc,
  iid: ItemId,
  text: string,
  pos: number,
): VerifiedTodoDoc {
  if (iid in d.items) return d;
  return {
    ...d,
    items: {
      ...d.items,
      [iid]: { text, done: false, position: pos, deleted: false },
    },
  };
}

export function toggleTodo(
  d: VerifiedTodoDoc,
  iid: ItemId,
  done: boolean,
): VerifiedTodoDoc {
  const existing = d.items[iid];
  if (!existing) return d;
  return { ...d, items: { ...d.items, [iid]: { ...existing, done } } };
}

export function moveTodo(
  d: VerifiedTodoDoc,
  iid: ItemId,
  pos: number,
): VerifiedTodoDoc {
  const existing = d.items[iid];
  if (!existing) return d;
  return {
    ...d,
    items: { ...d.items, [iid]: { ...existing, position: pos } },
  };
}

export function deleteTodo(
  d: VerifiedTodoDoc,
  iid: ItemId,
): VerifiedTodoDoc {
  const existing = d.items[iid];
  if (!existing) return d;
  return {
    ...d,
    items: { ...d.items, [iid]: { ...existing, deleted: true } },
  };
}

// ---------------------------------------------------------------------------
// View: live (non-deleted) ids. The Dafny model proves that the SET of
// visible ids is duplicate-free; any sort of a set of distinct ids is
// trivially also duplicate-free, so the runtime sort below introduces no
// new duplication risk.
// ---------------------------------------------------------------------------

export function liveKeys(d: VerifiedTodoDoc): ItemId[] {
  const items = d.items ?? {};
  return Object.keys(items).filter((k) => !items[k].deleted);
}

export function view(d: VerifiedTodoDoc): ItemId[] {
  const items = d.items ?? {};
  return liveKeys(d).sort((i, j) => {
    const pi = items[i].position;
    const pj = items[j].position;
    if (pi !== pj) return pi - pj;
    return i < j ? -1 : i > j ? 1 : 0;
  });
}
